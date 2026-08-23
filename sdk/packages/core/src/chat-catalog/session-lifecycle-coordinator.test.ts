import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { SessionSource } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import type { ChatCatalogConfirmationGrant } from "./chat-catalog-authority";
import { LocalChatCatalogPort } from "./chat-catalog-port";
import {
	type ChatCatalogConfirmationIssuer,
	type ChatCatalogConfirmationTarget,
	ChatSessionLifecycleCoordinator,
} from "./session-lifecycle-coordinator";
import { SqliteChatCatalogService } from "./sqlite-chat-catalog-service";

const WORKSPACE = resolve("/tmp/chat-session-lifecycle-workspace");
const NOW = new Date("2026-08-14T10:00:00.000Z");

function session(sessionId: string): SessionRecord {
	return {
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		startedAt: "2026-08-14T09:00:00.000Z",
		endedAt: "2026-08-14T09:01:00.000Z",
		status: "completed",
		interactive: true,
		provider: "test-provider",
		model: "test-model",
		cwd: WORKSPACE,
		workspaceRoot: WORKSPACE,
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-08-14T09:01:00.000Z",
	};
}

describe("ChatSessionLifecycleCoordinator", () => {
	const tempDirs: string[] = [];
	const stores: SqliteSessionStore[] = [];
	const catalogs: SqliteChatCatalogService[] = [];

	function fixture(
		principalId = "human-1",
		clock: () => Date = () => NOW,
		confirmationIssuer?: ChatCatalogConfirmationIssuer,
	) {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-lifecycle-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		const catalog = new SqliteChatCatalogService({
			dataDir,
			clock,
		});
		const port = new LocalChatCatalogPort({
			service: catalog,
			clock,
		});
		stores.push(store);
		catalogs.push(catalog);
		let sequence = 0;
		const coordinator = new ChatSessionLifecycleCoordinator({
			port,
			workspaceKey: WORKSPACE,
			principalId,
			source: { kind: "interactive", transport: "cli" },
			clock,
			idFactory: (prefix) => `${prefix}-${++sequence}`,
			confirmationIssuer: confirmationIssuer ?? {
				issue: (target: ChatCatalogConfirmationTarget) =>
					({
						credential: `credential-${++sequence}`,
						...target,
						issuedAt: clock().toISOString(),
						expiresAt: new Date(clock().getTime() + 60_000).toISOString(),
					}) satisfies ChatCatalogConfirmationGrant,
			},
		});
		return { store, catalog, port, coordinator };
	}

	afterEach(() => {
		for (const catalog of catalogs.splice(0)) catalog.close();
		for (const store of stores.splice(0)) store.close();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("adopts one root across retries and records fork and recovery lineage", async () => {
		const { store, coordinator } = fixture();
		for (const id of ["root", "recovery", "fork"]) store.create(session(id));

		const root = await coordinator.adoptRoot({ sessionId: "root" });
		const retried = await coordinator.adoptRoot({ sessionId: "root" });
		const recovered = await coordinator.recordRecovery({
			operationId: "recover-root",
			missingSessionId: "root",
			replacementSessionId: "recovery",
		});
		const fork = await coordinator.recordBranch({
			operationId: "fork-recovery",
			sourceSessionId: "recovery",
			sessionId: "fork",
			relationKind: "fork",
		});
		const recoveredRetry = await coordinator.recordRecovery({
			operationId: "recover-root",
			missingSessionId: "root",
			replacementSessionId: "recovery",
		});
		const forkRetry = await coordinator.recordBranch({
			operationId: "fork-recovery",
			sourceSessionId: "recovery",
			sessionId: "fork",
			relationKind: "fork",
		});

		expect(retried.chatId).toBe(root.chatId);
		expect(recoveredRetry).toEqual(recovered);
		expect(forkRetry).toEqual(fork);
		expect(recovered.sessions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					sessionId: "recovery",
					parentSessionId: "root",
					relationKind: "recovery",
				}),
			]),
		);
		expect(fork).toMatchObject({
			catalogState: "active",
			parentChatId: root.chatId,
		});
		expect(fork.sessions[0]).toMatchObject({
			sessionId: "fork",
			parentSessionId: "recovery",
			relationKind: "fork",
		});
	});

	it("activates an archived chat and allows exactly one resume lease winner", async () => {
		const first = fixture("human-1");
		first.store.create(session("resume"));
		const adopted = await first.coordinator.adoptRoot({ sessionId: "resume" });
		first.catalog.archiveChat({
			chatId: adopted.chatId,
			expectedRevision: adopted.revision,
			provenance: {
				invocationId: "archive-fixture",
				occurredAt: NOW.toISOString(),
				actor: { kind: "human", id: "human-1" },
				source: { kind: "interactive" },
			},
		});

		const winner = await first.coordinator.prepareResume({
			operationId: "prepare-resume-winner",
			sessionId: "resume",
		});
		expect(winner.chat.catalogState).toBe("active");
		expect(winner.leaseToken).toBeTruthy();
		const renewed = await first.coordinator.renewLease(winner);
		expect(renewed.revision).toBe(winner.revision + 1);
		expect(
			first.catalog.verifySessionLease({
				sessionId: renewed.sessionId,
				leaseToken: renewed.leaseToken,
				expectedRevision: renewed.revision,
			}),
		).toMatchObject({ active: true, revision: renewed.revision });
		await expect(first.coordinator.renewLease(winner)).rejects.toMatchObject({
			code: "revision_conflict",
		});

		const contender = new ChatSessionLifecycleCoordinator({
			port: first.port,
			workspaceKey: WORKSPACE,
			principalId: "human-2",
			source: { kind: "interactive", transport: "cli" },
			clock: () => NOW,
			idFactory: (prefix) => `${prefix}-contender`,
			confirmationIssuer: {
				issue: () => {
					throw new Error("not expected");
				},
			},
		});
		await expect(
			contender.prepareResume({
				operationId: "prepare-resume-contender",
				sessionId: "resume",
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
	});

	it("confirms stop-and-archive before atomically clearing bindings", async () => {
		let sequence = 0;
		const confirmationTargets: ChatCatalogConfirmationTarget[] = [];
		const { store, coordinator } = fixture("human-1", () => NOW, {
			issue: async (target) => {
				confirmationTargets.push(target);
				return {
					credential: `credential-exact-replay-${++sequence}`,
					...target,
					issuedAt: NOW.toISOString(),
					expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
				};
			},
		});
		store.create(session("archive-bound"));
		const chat = await coordinator.adoptRoot({ sessionId: "archive-bound" });
		await coordinator.bind({
			operationId: "bind-before-archive",
			chatId: chat.chatId,
			sessionId: "archive-bound",
			target: {
				bindingId: "binding-before-archive",
				transport: "telegram",
				threadId: "thread-before-archive",
				expectedBindingRevision: 0,
			},
		});
		const stopSessions = vi.fn(async () => undefined);

		const archived = await coordinator.archive({
			operationId: "stop-and-archive",
			chatId: chat.chatId,
			expectedRevision: chat.revision,
			clearBindings: true,
			stopSessions,
		});

		expect(stopSessions).toHaveBeenCalledWith(
			expect.objectContaining({ chatId: chat.chatId, revision: 1 }),
		);
		expect(archived).toMatchObject({
			catalogState: "archived",
			revision: 2,
			bindings: [],
		});
		await expect(
			coordinator.getBinding({
				transport: "telegram",
				threadId: "thread-before-archive",
			}),
		).resolves.toMatchObject({ bound: false, revision: 2 });
		const activated = await coordinator.activate({
			operationId: "activate-after-archive",
			chatId: chat.chatId,
			expectedRevision: archived.revision,
		});
		expect(activated).toMatchObject({
			catalogState: "active",
			revision: 3,
		});
		await expect(
			coordinator.archive({
				operationId: "stop-and-archive",
				chatId: chat.chatId,
				expectedRevision: chat.revision,
				clearBindings: true,
				stopSessions,
			}),
		).resolves.toMatchObject({ catalogState: "active", revision: 3 });
		expect(stopSessions).toHaveBeenCalledTimes(1);
		const archiveConfirmations = confirmationTargets.filter(
			(target) => target.confirmation === "archive",
		);
		expect(archiveConfirmations).toHaveLength(2);
		expect(archiveConfirmations[1]).toEqual(archiveConfirmations[0]);
		await expect(
			coordinator.activate({
				operationId: "stale-activate",
				chatId: chat.chatId,
				expectedRevision: 0,
			}),
		).rejects.toMatchObject({ code: "revision_conflict" });
	});

	it("rejects stale approval before archive side effects when revision changes during the prompt", async () => {
		let prompted: ChatCatalogConfirmationTarget | undefined;
		let resolveConfirmation: (() => void) | undefined;
		const confirmationIssuer: ChatCatalogConfirmationIssuer = {
			issue: (target) => {
				prompted = target;
				return new Promise<ChatCatalogConfirmationGrant>((resolveGrant) => {
					resolveConfirmation = () =>
						resolveGrant({
							credential: "credential-delayed-archive",
							...target,
							issuedAt: NOW.toISOString(),
							expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
						});
				});
			},
		};
		const { store, coordinator } = fixture(
			"human-1",
			() => NOW,
			confirmationIssuer,
		);
		store.create(session("archive-revision-race"));
		const chat = await coordinator.adoptRoot({
			sessionId: "archive-revision-race",
		});
		const stopSessions = vi.fn(async () => undefined);
		const pendingArchive = coordinator.archive({
			operationId: "archive-revision-race",
			chatId: chat.chatId,
			expectedRevision: chat.revision,
			stopSessions,
		});
		await vi.waitFor(() => expect(prompted).toBeDefined());

		const renamed = await coordinator.rename({
			operationId: "rename-during-archive-prompt",
			chatId: chat.chatId,
			expectedRevision: chat.revision,
			title: "Newer revision",
		});
		resolveConfirmation?.();

		await expect(pendingArchive).rejects.toMatchObject({
			code: "revision_conflict",
		});
		expect(stopSessions).not.toHaveBeenCalled();
		expect(await coordinator.get(chat.chatId)).toMatchObject({
			revision: renamed.revision,
			title: "Newer revision",
			catalogState: "active",
		});
	});

	it("rejects a stale archive snapshot changed before the confirmation read without stopping", async () => {
		const { store, catalog, port, coordinator } = fixture();
		store.create(session("archive-pre-prompt-race"));
		const chat = await coordinator.adoptRoot({
			sessionId: "archive-pre-prompt-race",
		});
		const originalGet = port.getChat.bind(port);
		let firstRead = true;
		vi.spyOn(port, "getChat").mockImplementation(async (authority, chatId) => {
			const snapshot = await originalGet(authority, chatId);
			if (firstRead) {
				firstRead = false;
				catalog.renameChat({
					chatId: chat.chatId,
					title: "Changed before confirmation read",
					expectedRevision: chat.revision,
					provenance: {
						invocationId: "rename-before-confirmation-read",
						occurredAt: NOW.toISOString(),
						actor: { kind: "human", id: "human-2" },
						source: { kind: "interactive" },
					},
				});
			}
			return snapshot;
		});
		const stopSessions = vi.fn(async () => undefined);

		await expect(
			coordinator.archive({
				operationId: "archive-pre-prompt-race",
				chatId: chat.chatId,
				expectedRevision: chat.revision,
				stopSessions,
			}),
		).rejects.toMatchObject({ code: "revision_conflict" });
		expect(stopSessions).not.toHaveBeenCalled();
		expect(await coordinator.get(chat.chatId)).toMatchObject({
			title: "Changed before confirmation read",
			catalogState: "active",
			revision: chat.revision + 1,
		});
	});

	it("derives one stable archived-resume activation target across an exact retry", async () => {
		let sequence = 0;
		const confirmationTargets: ChatCatalogConfirmationTarget[] = [];
		const { store, catalog, port, coordinator } = fixture(
			"human-1",
			() => NOW,
			{
				issue: async (target) => {
					confirmationTargets.push(target);
					return {
						credential: `credential-resume-retry-${++sequence}`,
						...target,
						issuedAt: NOW.toISOString(),
						expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
					};
				},
			},
		);
		store.create(session("resume-exact-retry"));
		const chat = await coordinator.adoptRoot({
			sessionId: "resume-exact-retry",
		});
		catalog.archiveChat({
			chatId: chat.chatId,
			expectedRevision: chat.revision,
			provenance: {
				invocationId: "archive-before-resume-exact-retry",
				occurredAt: NOW.toISOString(),
				actor: { kind: "human", id: "human-1" },
				source: { kind: "interactive" },
			},
		});
		const activate = port.activateChat.bind(port);
		let rejectBeforeCommit = true;
		vi.spyOn(port, "activateChat").mockImplementation(
			async (authority, input) => {
				if (rejectBeforeCommit) {
					rejectBeforeCommit = false;
					throw new Error("simulated activation failure before commit");
				}
				return await activate(authority, input);
			},
		);
		const resume = {
			operationId: "resume-exact-retry-operation",
			sessionId: "resume-exact-retry",
		};

		await expect(coordinator.prepareResume(resume)).rejects.toThrow(
			"simulated activation failure before commit",
		);
		await expect(coordinator.prepareResume(resume)).resolves.toMatchObject({
			sessionId: "resume-exact-retry",
			chat: { chatId: chat.chatId, catalogState: "active" },
		});
		expect(confirmationTargets).toHaveLength(2);
		expect(confirmationTargets[1]).toEqual(confirmationTargets[0]);
		expect(confirmationTargets[0]?.invocationId).toMatch(/^[a-f0-9]{64}$/);
	});

	it("renames a chat through a stable revisioned operation", async () => {
		const { store, coordinator } = fixture();
		store.create(session("rename-chat"));
		const chat = await coordinator.adoptRoot({ sessionId: "rename-chat" });

		const renamed = await coordinator.rename({
			operationId: "rename-chat-operation",
			chatId: chat.chatId,
			title: "Incident follow-up",
			expectedRevision: chat.revision,
		});

		expect(renamed).toMatchObject({
			title: "Incident follow-up",
			titleSource: "manual",
			revision: 2,
		});
		await expect(
			coordinator.rename({
				operationId: "rename-chat-operation",
				chatId: chat.chatId,
				title: "Incident follow-up",
				expectedRevision: chat.revision,
			}),
		).resolves.toMatchObject({ title: "Incident follow-up", revision: 2 });
		await expect(
			coordinator.rename({
				operationId: "stale-rename-operation",
				chatId: chat.chatId,
				title: "Stale title",
				expectedRevision: chat.revision,
			}),
		).rejects.toMatchObject({ code: "revision_conflict" });
	});

	it("stops before CAS unbind and releases the writer lease without archiving", async () => {
		const { store, coordinator } = fixture();
		store.create(session("bound"));
		const chat = await coordinator.adoptRoot({ sessionId: "bound" });
		const binding = await coordinator.bind({
			operationId: "bind-bound",
			chatId: chat.chatId,
			sessionId: "bound",
			target: {
				bindingId: "binding-1",
				transport: "slack",
				instanceId: "workspace-1",
				channelId: "channel-1",
				threadId: "thread-1",
				expectedBindingRevision: 0,
			},
		});
		const lease = await coordinator.prepareResume({
			operationId: "prepare-bound-reset",
			sessionId: "bound",
		});
		const stop = vi.fn(async () => undefined);

		const reset = await coordinator.reset({
			operationId: "reset-bound",
			sessionId: "bound",
			stop,
			binding: {
				bindingId: binding.bindingId,
				transport: binding.transport,
				instanceId: binding.instanceId,
				channelId: binding.channelId,
				threadId: binding.threadId,
				participantScope: binding.participantScope,
				expectedBindingRevision: binding.revision,
			},
			lease,
		});

		expect(stop).toHaveBeenCalledWith("bound");
		expect(reset.binding).toMatchObject({ bound: false, revision: 2 });
		expect(reset.lease).toMatchObject({ active: false, revision: 2 });
		expect((await coordinator.findChatForSession("bound"))?.catalogState).toBe(
			"active",
		);
	});

	it("does not clear a newer binding with a stale cached revision", async () => {
		const { store, coordinator } = fixture();
		store.create(session("stale"));
		const chat = await coordinator.adoptRoot({ sessionId: "stale" });
		const first = await coordinator.bind({
			operationId: "bind-stale-first",
			chatId: chat.chatId,
			sessionId: "stale",
			target: {
				bindingId: "binding-stale",
				transport: "discord",
				threadId: "thread-stale",
				expectedBindingRevision: 0,
			},
		});
		await coordinator.reset({
			operationId: "reset-stale-first",
			sessionId: "stale",
			stop: async () => undefined,
			binding: {
				bindingId: first.bindingId,
				transport: first.transport,
				threadId: first.threadId,
				expectedBindingRevision: first.revision,
			},
		});
		const rebound = await coordinator.bind({
			operationId: "bind-stale-rebound",
			chatId: chat.chatId,
			sessionId: "stale",
			target: {
				bindingId: first.bindingId,
				transport: first.transport,
				threadId: first.threadId,
				expectedBindingRevision: 2,
			},
		});

		await expect(
			coordinator.reset({
				operationId: "reset-stale-old",
				sessionId: "stale",
				stop: async () => undefined,
				binding: {
					bindingId: first.bindingId,
					transport: first.transport,
					threadId: first.threadId,
					expectedBindingRevision: first.revision,
				},
			}),
		).rejects.toMatchObject({ code: "revision_conflict" });
		expect(rebound).toMatchObject({ bound: true, revision: 3 });
	});

	it("binds reset CAS to the observed binding, chat, and session identity", async () => {
		const { store, catalog, coordinator } = fixture();
		store.create(session("session-a"));
		store.create(session("session-b"));
		const chatA = await coordinator.adoptRoot({ sessionId: "session-a" });
		const chatB = await coordinator.adoptRoot({ sessionId: "session-b" });
		await coordinator.bind({
			operationId: "bind-session-a",
			chatId: chatA.chatId,
			sessionId: "session-a",
			target: {
				bindingId: "binding-a",
				transport: "slack",
				threadId: "thread-a",
				expectedBindingRevision: 0,
			},
		});
		const bindingB = await coordinator.bind({
			operationId: "bind-session-b",
			chatId: chatB.chatId,
			sessionId: "session-b",
			target: {
				bindingId: "binding-b",
				transport: "slack",
				threadId: "thread-b",
				expectedBindingRevision: 0,
			},
		});

		await expect(
			coordinator.reset({
				operationId: "substituted-reset",
				sessionId: "session-a",
				stop: async () => undefined,
				binding: {
					bindingId: bindingB.bindingId,
					transport: bindingB.transport,
					threadId: bindingB.threadId,
					expectedBindingRevision: bindingB.revision,
				},
			}),
		).rejects.toMatchObject({ code: "binding_conflict" });
		expect(
			catalog.getBinding({ transport: "slack", threadId: "thread-b" }),
		).toMatchObject({
			bound: true,
			chatId: chatB.chatId,
			sessionId: "session-b",
		});
	});

	it("replays completed reset steps before retrying a failed lease release", async () => {
		const { store, port, coordinator } = fixture();
		store.create(session("reset-retry"));
		const chat = await coordinator.adoptRoot({ sessionId: "reset-retry" });
		const binding = await coordinator.bind({
			operationId: "bind-reset-retry",
			chatId: chat.chatId,
			sessionId: "reset-retry",
			target: {
				bindingId: "binding-reset-retry",
				transport: "discord",
				threadId: "thread-reset-retry",
				expectedBindingRevision: 0,
			},
		});
		const lease = await coordinator.prepareResume({
			operationId: "prepare-reset-retry",
			sessionId: "reset-retry",
		});
		const release = port.releaseSessionLease.bind(port);
		vi.spyOn(port, "releaseSessionLease")
			.mockRejectedValueOnce(new Error("simulated release transport loss"))
			.mockImplementation(release);
		const resetInput = {
			operationId: "reset-retry-operation",
			sessionId: "reset-retry",
			stop: vi.fn(async () => undefined),
			binding: {
				bindingId: binding.bindingId,
				transport: binding.transport,
				threadId: binding.threadId,
				expectedBindingRevision: binding.revision,
			},
			lease,
		};

		await expect(coordinator.reset(resetInput)).rejects.toThrow(
			"simulated release transport loss",
		);
		await expect(coordinator.reset(resetInput)).resolves.toMatchObject({
			binding: { bound: false, revision: 2 },
			lease: { active: false, revision: 2 },
		});
	});

	it("recovers a lost acquire reply through confirmed revoke and replacement", async () => {
		const { store, port, coordinator } = fixture();
		store.create(session("lost-acquire"));
		let inaccessibleToken = "";
		let loseReply = true;
		const acquire = port.acquireSessionLease.bind(port);
		vi.spyOn(port, "acquireSessionLease").mockImplementation(
			async (...args) => {
				const result = await acquire(...args);
				if (loseReply) {
					loseReply = false;
					inaccessibleToken = result.leaseToken ?? "";
					throw new Error("simulated acquire reply loss");
				}
				return result;
			},
		);

		await expect(
			coordinator.prepareResume({
				operationId: "prepare-lost-acquire",
				sessionId: "lost-acquire",
				acquireInvocationId: "stable-lost-acquire",
				expectedLeaseRevision: 0,
			}),
		).rejects.toThrow("simulated acquire reply loss");
		await expect(
			coordinator.prepareResume({
				operationId: "prepare-lost-acquire",
				sessionId: "lost-acquire",
				acquireInvocationId: "stable-lost-acquire",
				expectedLeaseRevision: 0,
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		const replacement = await coordinator.recoverLostResumeLease({
			operationId: "recover-lost-acquire",
			sessionId: "lost-acquire",
		});
		expect(inaccessibleToken).toBeTruthy();
		expect(replacement.leaseToken).toBeTruthy();
		expect(replacement.leaseToken).not.toBe(inaccessibleToken);
	});

	it("renews guarded leases and aborts the writer when renewal fencing is lost", async () => {
		const { store, port, coordinator } = fixture();
		store.create(session("guarded"));
		const acquired = await coordinator.prepareResume({
			operationId: "prepare-guarded",
			sessionId: "guarded",
		});
		const guard = await coordinator.guardLease(acquired, {
			leaseTtlMs: 60_000,
			renewEveryMs: 30_000,
		});
		expect(await guard.verify()).toMatchObject({
			active: true,
			revision: acquired.revision,
		});
		const renewed = await guard.renewNow();
		expect(renewed.revision).toBe(acquired.revision + 1);
		await expect(coordinator.verifyLease(acquired)).rejects.toMatchObject({
			code: "lease_conflict",
		});

		vi.spyOn(port, "renewSessionLease").mockRejectedValueOnce(
			new Error("simulated lease fence loss"),
		);
		await expect(guard.renewNow()).rejects.toThrow(
			"simulated lease fence loss",
		);
		expect(guard.signal.aborted).toBe(true);
		await guard.stop({ release: false });
	});

	it("rekeys a guarded writer, invalidates the old token, and replays a lost reply", async () => {
		const { store, port, coordinator } = fixture();
		store.create(session("guarded-rekey"));
		const acquired = await coordinator.prepareResume({
			operationId: "prepare-guarded-rekey",
			sessionId: "guarded-rekey",
		});
		const originalRekey = port.rekeySessionLease.bind(port);
		vi.spyOn(port, "rekeySessionLease")
			.mockImplementationOnce(async (...args) => {
				await originalRekey(...args);
				throw new Error("simulated rekey reply loss");
			})
			.mockImplementation(originalRekey);
		const updates: string[] = [];
		const guard = await coordinator.guardLease(acquired, {
			leaseTtlMs: 60_000,
			renewEveryMs: 30_000,
			onRenewed: (handle) => {
				updates.push(handle.leaseToken);
			},
		});

		const rekeyed = await guard.rekeyNow({
			operationId: "guarded-rekey-transition",
			expectedWriterGeneration: 1,
		});
		const replayed = await guard.rekeyNow({
			operationId: "guarded-rekey-transition",
			expectedWriterGeneration: 1,
		});
		const installed = guard.confirmRekeyInstalled({
			operationId: "guarded-rekey-transition",
			expectedWriterGeneration: 1,
		});

		expect(rekeyed).toMatchObject({ revision: 2, writerGeneration: 2 });
		expect(rekeyed.leaseToken).not.toBe(acquired.leaseToken);
		expect(replayed).toEqual(rekeyed);
		expect(installed).toEqual(rekeyed);
		expect(port.rekeySessionLease).toHaveBeenCalledTimes(2);
		expect(updates).toEqual([]);
		await expect(coordinator.verifyLease(acquired)).rejects.toMatchObject({
			code: "lease_conflict",
		});
		await expect(guard.verify()).resolves.toMatchObject({
			revision: 2,
			writerGeneration: 2,
		});
		await expect(
			guard.rekeyNow({
				operationId: "stale-rekey-transition",
				expectedWriterGeneration: 1,
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(guard.signal.aborted).toBe(false);
		await guard.stop({ release: false });
	});

	it("serializes renewal before rekey and releases the rekeyed credential on stop", async () => {
		const { store, catalog, port, coordinator } = fixture();
		store.create(session("renew-rekey-stop"));
		const acquired = await coordinator.prepareResume({
			operationId: "prepare-renew-rekey-stop",
			sessionId: "renew-rekey-stop",
		});
		const originalRenew = port.renewSessionLease.bind(port);
		let announceRenewed: () => void = () => undefined;
		let releaseRenewReply: () => void = () => undefined;
		const renewed = new Promise<void>((resolveRenewed) => {
			announceRenewed = resolveRenewed;
		});
		const renewReplyGate = new Promise<void>((resolveReply) => {
			releaseRenewReply = resolveReply;
		});
		vi.spyOn(port, "renewSessionLease").mockImplementation(async (...args) => {
			const result = await originalRenew(...args);
			announceRenewed();
			await renewReplyGate;
			return result;
		});
		const rekeySpy = vi.spyOn(port, "rekeySessionLease");
		const guard = await coordinator.guardLease(acquired, {
			leaseTtlMs: 60_000,
			renewEveryMs: 30_000,
		});

		const renewal = guard.renewNow();
		await renewed;
		const rekey = guard.rekeyNow({
			operationId: "renew-then-rekey",
			expectedWriterGeneration: 1,
		});
		expect(rekeySpy).not.toHaveBeenCalled();
		releaseRenewReply();

		await expect(renewal).resolves.toMatchObject({
			revision: 2,
			writerGeneration: 1,
		});
		await expect(rekey).resolves.toMatchObject({
			revision: 3,
			writerGeneration: 2,
		});
		guard.confirmRekeyInstalled({
			operationId: "renew-then-rekey",
			expectedWriterGeneration: 1,
		});
		await expect(
			guard.stop({
				release: true,
				operationId: "release-after-rekey",
			}),
		).resolves.toMatchObject({ active: false, revision: 4 });
		expect(catalog.getSessionLease("renew-rekey-stop")).toMatchObject({
			active: false,
			revision: 4,
			writerGeneration: 2,
		});
	});

	it("reserves renewals until a host barrier confirms the rekey installation", async () => {
		const { store, port, coordinator } = fixture();
		store.create(session("barrier-rekey"));
		const acquired = await coordinator.prepareResume({
			operationId: "prepare-barrier-rekey",
			sessionId: "barrier-rekey",
		});
		const originalRenew = port.renewSessionLease.bind(port);
		let releaseRenewal: () => void = () => undefined;
		let announceRenewal: () => void = () => undefined;
		const renewalStarted = new Promise<void>((resolve) => {
			announceRenewal = resolve;
		});
		const renewalGate = new Promise<void>((resolve) => {
			releaseRenewal = resolve;
		});
		vi.spyOn(port, "renewSessionLease").mockImplementation(async (...args) => {
			const result = await originalRenew(...args);
			announceRenewal();
			await renewalGate;
			return result;
		});
		const guard = await coordinator.guardLease(acquired, {
			leaseTtlMs: 60_000,
			renewEveryMs: 30_000,
		});
		const rekeySpy = vi.spyOn(port, "rekeySessionLease");

		const renewal = guard.renewNow();
		await renewalStarted;
		let releaseBarrier: () => void = () => undefined;
		let announceBarrier: () => void = () => undefined;
		const barrierStarted = new Promise<void>((resolve) => {
			announceBarrier = resolve;
		});
		const barrierGate = new Promise<void>((resolve) => {
			releaseBarrier = resolve;
		});
		const transition = guard.rekeyWithBarrier(
			{
				operationId: "barrier-rekey-transition",
				expectedWriterGeneration: 1,
			},
			async ({ current, commit, confirmInstalled }) => {
				expect(current).toMatchObject({ revision: 2, writerGeneration: 1 });
				announceBarrier();
				await barrierGate;
				const rekeyed = await commit();
				confirmInstalled();
				return {
					revision: rekeyed.revision,
					writerGeneration: rekeyed.writerGeneration,
				};
			},
		);
		expect(rekeySpy).not.toHaveBeenCalled();
		releaseRenewal();
		await renewal;
		await barrierStarted;
		const renewalDuringBarrier = guard.renewNow();
		expect(rekeySpy).not.toHaveBeenCalled();
		releaseBarrier();

		await expect(transition).resolves.toEqual({
			revision: 3,
			writerGeneration: 2,
		});
		await expect(renewalDuringBarrier).resolves.toMatchObject({
			revision: 3,
			writerGeneration: 2,
		});
		expect(rekeySpy).toHaveBeenCalledTimes(1);
		expect(guard.signal.aborted).toBe(false);
		await guard.stop({ release: false });
	});

	it("releases the applied renewal revision when stop races its reply", async () => {
		const { store, catalog, port, coordinator } = fixture();
		store.create(session("renew-stop-race"));
		const acquired = await coordinator.prepareResume({
			operationId: "prepare-renew-stop-race",
			sessionId: "renew-stop-race",
		});
		const originalRenew = port.renewSessionLease.bind(port);
		let announceApplied: () => void = () => undefined;
		let releaseReply: () => void = () => undefined;
		const applied = new Promise<void>((resolveApplied) => {
			announceApplied = resolveApplied;
		});
		const replyGate = new Promise<void>((resolveReply) => {
			releaseReply = resolveReply;
		});
		vi.spyOn(port, "renewSessionLease").mockImplementation(async (...args) => {
			const result = await originalRenew(...args);
			announceApplied();
			await replyGate;
			return result;
		});
		const guard = await coordinator.guardLease(acquired, {
			leaseTtlMs: 60_000,
			renewEveryMs: 30_000,
		});

		const renewal = guard.renewNow();
		await applied;
		const stopping = guard.stop({
			release: true,
			operationId: "renew-stop-race-release",
		});
		releaseReply();

		await expect(renewal).resolves.toMatchObject({ revision: 2 });
		await expect(stopping).resolves.toMatchObject({
			active: false,
			revision: 3,
		});
		expect(catalog.getSessionLease("renew-stop-race")).toMatchObject({
			active: false,
			revision: 3,
		});
	});

	it("uses the authoritative expiry and aborts even while renewal is stalled", async () => {
		vi.useFakeTimers();
		try {
			let now = new Date(NOW);
			const { store, port, coordinator } = fixture("human-1", () => now);
			store.create(session("short-lease"));
			const acquired = await coordinator.prepareResume({
				operationId: "prepare-short-lease",
				sessionId: "short-lease",
				leaseTtlMs: 5_000,
			});
			vi.spyOn(port, "renewSessionLease").mockImplementation(
				() => new Promise(() => undefined),
			);
			const guard = await coordinator.guardLease(acquired, {
				leaseTtlMs: 60_000,
				renewEveryMs: 20_000,
			});

			now = new Date(NOW.getTime() + 2_500);
			await vi.advanceTimersByTimeAsync(2_500);
			expect(port.renewSessionLease).toHaveBeenCalledTimes(1);
			expect(guard.signal.aborted).toBe(false);

			now = new Date(NOW.getTime() + 5_000);
			await vi.advanceTimersByTimeAsync(2_500);
			expect(guard.signal.aborted).toBe(true);
			await guard.stop({ release: false });
		} finally {
			vi.useRealTimers();
		}
	});
});
