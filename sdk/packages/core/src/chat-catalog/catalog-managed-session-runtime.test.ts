import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeHost } from "../runtime/host/local-runtime-host";
import type {
	SessionWriterLeaseTransitionInput,
	SessionWriterLeaseTransitionResult,
} from "../runtime/host/runtime-host";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import type { SessionRow } from "../session/models/session-row";
import { CoreSessionService } from "../session/services/session-service";
import { SessionSource } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import {
	CatalogManagedSessionRuntime,
	createCatalogWriterLeaseVerifier,
} from "./catalog-managed-session-runtime";
import type { ChatCatalogConfirmationGrant } from "./chat-catalog-authority";
import { LocalChatCatalogPort } from "./chat-catalog-port";
import {
	type ManagedProfileAuthority,
	managedProfileAuthorityMetadata,
} from "./managed-profile-authority";
import {
	type ChatCatalogConfirmationTarget,
	ChatSessionLifecycleCoordinator,
} from "./session-lifecycle-coordinator";
import { SqliteChatCatalogService } from "./sqlite-chat-catalog-service";

const WORKSPACE = resolve("/tmp/catalog-managed-runtime-workspace");
const NOW = new Date("2026-08-14T10:00:00.000Z");

function session(sessionId: string): SessionRecord & SessionRow {
	return {
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		startedAt: "2026-08-14T09:00:00.000Z",
		endedAt: "2026-08-14T09:01:00.000Z",
		status: "completed",
		statusLock: 0,
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

describe("CatalogManagedSessionRuntime", () => {
	const cleanup: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of cleanup.splice(0).reverse()) dispose();
	});

	function fixture(sessionId: string, options: { persisted?: boolean } = {}) {
		const dataDir = mkdtempSync(join(tmpdir(), "catalog-managed-runtime-"));
		const store = new SqliteSessionStore({
			sessionsDir: dataDir,
			clock: () => NOW,
		});
		if (options.persisted !== false) {
			store.upsertPersistedSession(session(sessionId));
		}
		const cleanupChatArtifacts = vi.fn(async ({ attemptId }) => ({
			receiptId: `cleanup-${attemptId}`,
		}));
		const catalog = new SqliteChatCatalogService({
			dataDir,
			clock: () => NOW,
			artifactCleanup: { cleanupChatArtifacts },
		});
		const port = new LocalChatCatalogPort({
			service: catalog,
			clock: () => NOW,
		});
		let sequence = 0;
		const coordinator = new ChatSessionLifecycleCoordinator({
			port,
			workspaceKey: WORKSPACE,
			principalId: "human-1",
			source: { kind: "interactive", transport: "cli" },
			clock: () => NOW,
			idFactory: (prefix) => `${prefix}-${++sequence}`,
			confirmationIssuer: {
				issue: (target: ChatCatalogConfirmationTarget) =>
					({
						credential: `credential-${++sequence}`,
						...target,
						issuedAt: NOW.toISOString(),
						expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
					}) satisfies ChatCatalogConfirmationGrant,
			},
		});
		const abort = vi.fn().mockResolvedValue(undefined);
		const stopSession = vi.fn().mockResolvedValue(undefined);
		const quiesceSession = vi.fn().mockResolvedValue({
			sessionId,
			lifecycleEpoch: 1,
			quiescedAt: NOW.toISOString(),
			persistenceDrained: true,
			terminalStatus: "cancelled",
		});
		const startSession = vi.fn().mockResolvedValue({
			sessionId,
			manifest: { session_id: sessionId },
			manifestPath: `/tmp/${sessionId}.json`,
			messagesPath: `/tmp/${sessionId}.messages.json`,
		});
		const runTurn = vi.fn().mockResolvedValue({
			text: "ok",
			finishReason: "completed",
		});
		const updateSessionWriterLease = vi.fn().mockResolvedValue(undefined);
		const transitionSessionWriterLease = vi.fn(
			async (
				_sessionId: string,
				_input: SessionWriterLeaseTransitionInput,
				transition: () => Promise<SessionWriterLeaseTransitionResult<unknown>>,
			) => {
				const result = await transition();
				await result.afterInstall?.();
				return result.value;
			},
		);
		const getSession = vi.fn(async (targetSessionId: string) =>
			store.get(targetSessionId),
		);
		const readSessionMessages = vi.fn().mockResolvedValue([]);
		const commitWorkspaceRestore = vi.fn().mockResolvedValue(undefined);
		const rollbackWorkspaceRestore = vi.fn().mockResolvedValue(undefined);
		const beginWorkspaceRestoreTransaction = vi.fn().mockResolvedValue({
			commit: commitWorkspaceRestore,
			rollback: rollbackWorkspaceRestore,
		});
		const applyWorkspaceCheckpoint = vi.fn().mockResolvedValue(undefined);
		const retainCheckpointRefs = vi.fn().mockResolvedValue(undefined);
		const host = {
			abort,
			getSession,
			quiesceSession,
			readSessionMessages,
			stopSession,
			startSession,
			transitionSessionWriterLease,
			runTurn,
			updateSessionWriterLease,
		};
		const runtime = new CatalogManagedSessionRuntime({
			host: host as never,
			coordinator,
			clock: () => NOW,
			checkpointRestore: {
				beginWorkspaceRestoreTransaction,
				applyWorkspaceCheckpoint,
				retainCheckpointRefs,
			},
		});
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		return {
			applyWorkspaceCheckpoint,
			abort,
			beginWorkspaceRestoreTransaction,
			catalog,
			cleanupChatArtifacts,
			commitWorkspaceRestore,
			coordinator,
			host,
			port,
			quiesceSession,
			readSessionMessages,
			retainCheckpointRefs,
			rollbackWorkspaceRestore,
			runtime,
			startSession,
			stopSession,
			store,
			transitionSessionWriterLease,
		};
	}

	function startInput(sessionId: string, prompt?: string) {
		return {
			config: {
				sessionId,
				providerId: "test-provider",
				modelId: "test-model",
				cwd: WORKSPACE,
				workspaceRoot: WORKSPACE,
				systemPrompt: "test",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			interactive: true,
			...(prompt ? { prompt } : {}),
		};
	}

	function managedStartInput(
		sessionId: string,
		overrides: Partial<ManagedProfileAuthority> = {},
	) {
		return {
			...startInput(sessionId),
			sessionMetadata: managedProfileAuthorityMetadata({
				profileId: "interactive-owner.v1",
				profileRevision: 1,
				authorityClassId: "interactive-owner",
				policyEpoch: 7,
				connectionPolicyDigest: "a".repeat(64),
				executionPolicyDigest: "b".repeat(64),
				interactive: true,
				allowedModes: ["act", "plan"],
				...overrides,
			}),
		};
	}

	it("keeps the credential in trusted core and starts execution only after guarding", async () => {
		const sessionId = "managed-resume";
		const { runtime, host, startSession, catalog } = fixture(sessionId);
		const result = await runtime.resume({
			operationId: "resume-op",
			expectedLeaseRevision: 0,
			startInput: {
				...startInput(sessionId, "continue"),
				userImages: ["image.png"],
				userFiles: ["notes.md"],
			},
		});

		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				interactive: true,
				prompt: undefined,
				writerLease: expect.objectContaining({ revision: 1 }),
			}),
		);
		expect(host.runTurn).toHaveBeenCalledWith({
			sessionId,
			prompt: "continue",
			userImages: ["image.png"],
			userFiles: ["notes.md"],
		});
		expect(JSON.stringify(result)).not.toContain("leaseToken");
		expect(JSON.stringify(result)).not.toContain("secret");

		await runtime.stop(sessionId, "stop-op");
		expect(host.quiesceSession).toHaveBeenCalledWith(
			sessionId,
			"catalog_managed_stop",
		);
		expect(catalog.getSessionLease(sessionId)).toMatchObject({ active: false });
	});

	it("confirms, revokes, and replaces a lost live lease before guarded recovery", async () => {
		const sessionId = "managed-lost-lease";
		const { runtime, coordinator, startSession, catalog } = fixture(sessionId);
		const lost = await coordinator.prepareResume({
			operationId: "prepare-managed-lost-lease",
			sessionId,
			expectedLeaseRevision: 0,
			acquireInvocationId: "lost-lease-acquire",
		});

		const result = await runtime.recoverLostLease({
			operationId: "recover-lost-lease",
			startInput: startInput(sessionId),
		});

		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				writerLease: expect.objectContaining({
					revision: 3,
					writerGeneration: 2,
				}),
			}),
		);
		expect(result).toMatchObject({
			leaseRevision: 3,
		});
		expect(JSON.stringify(result)).not.toContain("leaseToken");
		await expect(coordinator.verifyLease(lost)).rejects.toMatchObject({
			code: "lease_conflict",
		});
		expect(catalog.getSessionLease(sessionId)).toMatchObject({
			active: true,
			revision: 3,
			writerGeneration: 2,
		});
		await runtime.stop(sessionId, "managed-lost-lease-stop");
	});

	it("checks managed profile continuity before replacing a lost lease", async () => {
		const sessionId = "managed-profile-lost-lease";
		const { runtime, coordinator, startSession, catalog, store } =
			fixture(sessionId);
		store.upsertPersistedSession({
			...session(sessionId),
			metadata: managedStartInput(sessionId).sessionMetadata,
		});
		await coordinator.prepareResume({
			operationId: "prepare-managed-foreign-lease",
			sessionId,
			expectedLeaseRevision: 0,
			acquireInvocationId: "managed-profile-lost-acquire",
		});
		const leaseBeforeMismatch = catalog.getSessionLease(sessionId);

		await expect(
			runtime.recoverLostLease({
				operationId: "managed-profile-lost-mismatch",
				startInput: managedStartInput(sessionId, { profileRevision: 2 }),
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(catalog.getSessionLease(sessionId)).toEqual(leaseBeforeMismatch);
		expect(startSession).not.toHaveBeenCalled();

		await expect(
			runtime.recoverLostLease({
				operationId: "managed-profile-lost-match",
				startInput: managedStartInput(sessionId),
			}),
		).resolves.toMatchObject({ chatId: expect.any(String) });
		expect(startSession).toHaveBeenCalledTimes(1);
		await runtime.stop(sessionId, "managed-profile-lost-stop");
	});

	it("disposes guarded sessions through quiescence and lease release", async () => {
		const sessionId = "managed-dispose";
		const { runtime, host, catalog } = fixture(sessionId);
		await runtime.resume({
			operationId: "resume-before-dispose",
			expectedLeaseRevision: 0,
			startInput: startInput(sessionId),
		});

		await runtime.dispose("core-dispose");

		expect(host.quiesceSession).toHaveBeenCalledWith(
			sessionId,
			"catalog_managed_stop",
		);
		expect(catalog.getSessionLease(sessionId)).toMatchObject({ active: false });
		expect(runtime.manages(sessionId)).toBe(false);
	});

	it("records catalog activity after a guarded turn", async () => {
		const sessionId = "managed-activity";
		const { runtime, catalog, store, startSession } = fixture(sessionId);
		await runtime.resume({
			operationId: "resume-before-activity",
			expectedLeaseRevision: 0,
			startInput: startInput(sessionId),
		});

		const activityAt = new Date(NOW.getTime() + 1_000).toISOString();
		const writerFence = startSession.mock.calls[0]?.[0].writerLease;
		if (!writerFence) throw new Error("missing managed fixture");
		store.upsertPersistedSession(
			{ ...session(sessionId), updatedAt: activityAt },
			writerFence,
		);
		await runtime.runTurn({
			operationId: "activity-turn",
			sessionId,
			prompt: "continue",
		});

		expect(catalog.getChatForSession(sessionId)).toMatchObject({
			revision: 2,
			lastActivityAt: activityAt,
		});
		await runtime.stop(sessionId, "activity-stop");
	});

	it("binds and resets through quiescence, CAS unbind, and lease release", async () => {
		const sessionId = "managed-binding";
		const { runtime, catalog, host } = fixture(sessionId);
		await runtime.resume({
			operationId: "resume-before-binding",
			expectedLeaseRevision: 0,
			startInput: startInput(sessionId),
		});
		const target = {
			bindingId: "managed-binding-id",
			transport: "telegram",
			instanceId: "bot-1",
			threadId: "thread-1",
			expectedBindingRevision: 0,
		};

		const bound = await runtime.bind({
			operationId: "bind-managed-session",
			sessionId,
			target,
		});
		expect(bound).toMatchObject({
			bound: true,
			sessionId,
			revision: 1,
		});
		await expect(
			runtime.getBinding({
				transport: "telegram",
				instanceId: "bot-1",
				threadId: "thread-1",
			}),
		).resolves.toEqual(bound);

		const reset = await runtime.reset({
			operationId: "reset-managed-session",
			sessionId,
			binding: {
				...target,
				expectedBindingRevision: bound.revision,
			},
		});

		expect(host.quiesceSession).toHaveBeenCalledWith(
			sessionId,
			"catalog_managed_reset",
		);
		expect(reset).toMatchObject({ bound: false, revision: 2 });
		expect(catalog.getSessionLease(sessionId)).toMatchObject({ active: false });
		expect(runtime.manages(sessionId)).toBe(false);
	});

	it("requires explicit stop-and-archive and clears bindings atomically", async () => {
		const sessionId = "managed-stop-and-archive";
		const { runtime, catalog, store, quiesceSession, startSession } =
			fixture(sessionId);
		const resumed = await runtime.resume({
			operationId: "resume-before-archive",
			expectedLeaseRevision: 0,
			startInput: startInput(sessionId),
		});
		const target = {
			bindingId: "managed-archive-binding",
			transport: "telegram",
			threadId: "managed-archive-thread",
			expectedBindingRevision: 0,
		};
		await runtime.bind({
			operationId: "bind-before-archive",
			sessionId,
			target,
		});
		const writerFence = startSession.mock.calls[0]?.[0].writerLease;
		if (!writerFence) throw new Error("missing managed fixture");
		store.upsertPersistedSession(
			{ ...session(sessionId), status: "running", endedAt: null },
			writerFence,
		);

		await expect(
			runtime.archive({
				operationId: "archive-managed-chat",
				chatId: resumed.chatId,
				expectedRevision: 1,
			}),
		).rejects.toMatchObject({ code: "chat_running" });
		expect(runtime.manages(sessionId)).toBe(true);
		quiesceSession.mockImplementationOnce(async () => {
			store.upsertPersistedSession(
				{ ...session(sessionId), status: "cancelled" },
				writerFence,
			);
			return {
				sessionId,
				lifecycleEpoch: 1,
				quiescedAt: NOW.toISOString(),
				persistenceDrained: true,
				terminalStatus: "cancelled",
			};
		});

		const archived = await runtime.archive({
			operationId: "archive-managed-chat",
			chatId: resumed.chatId,
			expectedRevision: 1,
			stopRunning: true,
			clearBindings: true,
		});

		expect(archived).toMatchObject({
			catalogState: "archived",
			revision: 2,
			bindings: [],
		});
		expect(runtime.manages(sessionId)).toBe(false);
		expect(catalog.getBinding(target)).toMatchObject({
			bound: false,
			revision: 2,
		});
		expect(catalog.getSessionLease(sessionId)).toMatchObject({ active: false });
	});

	it("activates and purges through confirmed sanitized lifecycle methods", async () => {
		const sessionId = "managed-activate-purge";
		const { runtime, coordinator, cleanupChatArtifacts } = fixture(sessionId);
		const active = await coordinator.adoptRoot({ sessionId });
		const archived = await runtime.archive({
			operationId: "archive-before-activate",
			chatId: active.chatId,
			expectedRevision: active.revision,
		});
		const activated = await runtime.activate({
			operationId: "activate-managed-chat",
			chatId: active.chatId,
			expectedRevision: archived.revision,
		});
		expect(activated).toMatchObject({ catalogState: "active", revision: 3 });
		const renamed = await runtime.rename({
			operationId: "rename-managed-chat",
			chatId: active.chatId,
			title: "Managed lifecycle",
			expectedRevision: activated.revision,
		});
		expect(renamed).toMatchObject({
			title: "Managed lifecycle",
			titleSource: "manual",
			revision: 4,
		});
		const rearchived = await runtime.archive({
			operationId: "rearchive-before-purge",
			chatId: active.chatId,
			expectedRevision: renamed.revision,
		});

		const purged = await runtime.purge({
			operationId: "purge-managed-chat",
			chatId: active.chatId,
			expectedRevision: rearchived.revision,
		});
		const purgeReplay = await runtime.purge({
			operationId: "purge-managed-chat",
			chatId: active.chatId,
			expectedRevision: rearchived.revision,
		});

		expect(purged).toEqual({
			chatId: active.chatId,
			sessionIds: [sessionId],
			applied: true,
		});
		expect(purgeReplay).toEqual({
			chatId: active.chatId,
			sessionIds: [sessionId],
			applied: true,
		});
		expect(cleanupChatArtifacts).toHaveBeenCalledOnce();
		expect(JSON.stringify(purged)).not.toContain("credential");
	});

	it("retries a failed purge through the managed coordinator", async () => {
		const sessionId = "managed-purge-retry";
		const { runtime, coordinator, cleanupChatArtifacts } = fixture(sessionId);
		const active = await coordinator.adoptRoot({ sessionId });
		const archived = await runtime.archive({
			operationId: "archive-before-purge-retry",
			chatId: active.chatId,
			expectedRevision: active.revision,
		});
		cleanupChatArtifacts.mockRejectedValueOnce(
			new Error("cleanup unavailable"),
		);
		const purgeInput = {
			operationId: "retry-managed-purge",
			chatId: active.chatId,
			expectedRevision: archived.revision,
		};

		await expect(runtime.purge(purgeInput)).rejects.toMatchObject({
			code: "purge_cleanup_failed",
		});
		await expect(runtime.purge(purgeInput)).resolves.toEqual({
			chatId: active.chatId,
			sessionIds: [sessionId],
			applied: true,
		});
		expect(cleanupChatArtifacts).toHaveBeenCalledTimes(2);
	});

	it("atomically admits and starts a fresh root without exposing its credential", async () => {
		const sessionId = "managed-fresh-root";
		const { runtime, coordinator, startSession, catalog, store } = fixture(
			sessionId,
			{ persisted: false },
		);
		const guardLease = vi.spyOn(coordinator, "guardLease");

		const result = await runtime.startRoot({
			operationId: "fresh-root-op",
			chatId: "fresh-root-chat",
			startInput: startInput(sessionId),
		});

		expect(guardLease).toHaveBeenCalledTimes(1);
		expect(guardLease.mock.invocationCallOrder[0]).toBeLessThan(
			startSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
		);
		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ sessionId }),
				writerLease: expect.objectContaining({
					revision: 1,
					writerGeneration: 1,
				}),
			}),
		);
		expect(store.get(sessionId)).toMatchObject({
			status: "idle",
			messagesPath: undefined,
		});
		expect(catalog.getChat("fresh-root-chat")).toMatchObject({
			headSessionId: sessionId,
		});
		expect(catalog.getSessionLease(sessionId)).toMatchObject({
			active: true,
			revision: 1,
			writerGeneration: 1,
		});
		expect(result).toMatchObject({
			chatId: "fresh-root-chat",
			leaseRevision: 1,
			writerGeneration: 1,
		});
		expect(JSON.stringify(result)).not.toContain("leaseToken");

		await runtime.stop(sessionId, "fresh-root-stop");
	});

	it("renews and projects token-free resident authority for reconnect fencing", async () => {
		const sessionId = "managed-authority-projection";
		const { runtime } = fixture(sessionId, { persisted: false });
		await runtime.startRoot({
			operationId: "managed-authority-root",
			startInput: startInput(sessionId),
		});
		const authoritySignal = runtime.residentAuthoritySignal(sessionId);

		const authority = await runtime.verifyResidentAuthority(sessionId);

		expect(authority).toMatchObject({
			sessionId,
			leaseRevision: 2,
			writerGeneration: 1,
		});
		expect(JSON.stringify(authority)).not.toContain("leaseToken");
		expect(authoritySignal.aborted).toBe(false);
		await runtime.stop(sessionId, "managed-authority-stop");
		expect(authoritySignal.aborted).toBe(true);
		expect(() => runtime.residentAuthoritySignal(sessionId)).toThrow(
			"managed session authority is not resident",
		);
	});

	it("rekeys resident authority behind the host barrier and replays a token-free receipt", async () => {
		const sessionId = "managed-resident-rekey";
		const { runtime, catalog, transitionSessionWriterLease } = fixture(
			sessionId,
			{ persisted: false },
		);
		await runtime.startRoot({
			operationId: "managed-rekey-root",
			startInput: startInput(sessionId),
		});
		const authoritySignal = runtime.residentAuthoritySignal(sessionId);

		const rekeyed = await runtime.rekeyResidentAuthority({
			operationId: "managed-rekey-op",
			sessionId,
			expectedWriterGeneration: 1,
		});
		const replayed = await runtime.rekeyResidentAuthority({
			operationId: "managed-rekey-op",
			sessionId,
			expectedWriterGeneration: 1,
		});

		expect(rekeyed).toMatchObject({
			sessionId,
			leaseRevision: 2,
			writerGeneration: 2,
		});
		expect(replayed).toEqual(rekeyed);
		expect(runtime.residentAuthoritySignal(sessionId)).toBe(authoritySignal);
		expect(authoritySignal.aborted).toBe(false);
		expect(JSON.stringify(rekeyed)).not.toContain("leaseToken");
		expect(transitionSessionWriterLease).toHaveBeenCalledTimes(1);
		expect(transitionSessionWriterLease).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				operationId: "managed-rekey-op",
				expectedLease: expect.objectContaining({
					revision: 1,
					writerGeneration: 1,
				}),
			}),
			expect.any(Function),
		);
		expect(catalog.getSessionLease(sessionId)).toMatchObject({
			active: true,
			revision: 2,
			writerGeneration: 2,
		});
		await expect(
			runtime.rekeyResidentAuthority({
				operationId: "managed-rekey-op",
				sessionId,
				expectedWriterGeneration: 2,
			}),
		).rejects.toMatchObject({ code: "invocation_replay_conflict" });
		await runtime.stop(sessionId, "managed-rekey-stop");
	});

	it("persists profile authority and requires an exact match before resume lease acquisition", async () => {
		const sessionId = "managed-profile-resume";
		const { runtime, catalog, startSession, store } = fixture(sessionId, {
			persisted: false,
		});
		await runtime.startRoot({
			operationId: "managed-profile-root",
			startInput: managedStartInput(sessionId),
		});
		await runtime.stop(sessionId, "managed-profile-stop");
		const leaseBeforeMismatch = catalog.getSessionLease(sessionId);

		await expect(
			runtime.resume({
				operationId: "managed-profile-mismatch",
				startInput: managedStartInput(sessionId, {
					profileId: "automation.v1",
					authorityClassId: "automation",
					allowedModes: ["act"],
				}),
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(catalog.getSessionLease(sessionId)).toEqual(leaseBeforeMismatch);
		expect(startSession).toHaveBeenCalledTimes(1);
		expect(store.get(sessionId)?.metadata).toEqual(
			managedStartInput(sessionId).sessionMetadata,
		);

		await expect(
			runtime.resume({
				operationId: "managed-profile-match",
				startInput: managedStartInput(sessionId),
			}),
		).resolves.toMatchObject({ chatId: `chat_${sessionId}` });
		expect(startSession).toHaveBeenCalledTimes(2);
		await runtime.stop(sessionId, "managed-profile-final-stop");
	});

	it("rejects a per-turn mode outside the persisted profile ceiling", async () => {
		const sessionId = "managed-profile-turn-mode";
		const { runtime, host, startSession, store } = fixture(sessionId, {
			persisted: false,
		});
		await runtime.startRoot({
			operationId: "managed-profile-turn-root",
			startInput: managedStartInput(sessionId),
		});

		await expect(
			runtime.runTurn({
				operationId: "managed-profile-turn-yolo",
				sessionId,
				prompt: "widen mode",
				mode: "yolo",
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(host.runTurn).not.toHaveBeenCalled();

		await expect(
			runtime.runTurn({
				operationId: "managed-profile-turn-act",
				sessionId,
				prompt: "continue",
				mode: "act",
			}),
		).resolves.toMatchObject({ text: "ok" });
		expect(host.runTurn).toHaveBeenCalledTimes(1);
		const writerFence = startSession.mock.calls[0]?.[0].writerLease;
		if (!writerFence) throw new Error("missing managed profile writer fence");
		store.upsertPersistedSession(
			{ ...session(sessionId), metadata: null },
			writerFence,
		);
		await expect(
			runtime.runTurn({
				operationId: "managed-profile-turn-missing-stamp",
				sessionId,
				prompt: "continue without authority",
				mode: "act",
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(host.runTurn).toHaveBeenCalledTimes(1);
		await runtime.stop(sessionId, "managed-profile-turn-stop");
	});

	it("preserves headless profile interactivity through admission and host startup", async () => {
		const sessionId = "managed-profile-headless";
		const { runtime, startSession, store } = fixture(sessionId, {
			persisted: false,
		});
		const headless = managedStartInput(sessionId, { interactive: false });

		await runtime.startRoot({
			operationId: "managed-profile-headless-root",
			startInput: { ...headless, interactive: false },
		});

		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({ interactive: false }),
		);
		expect(store.get(sessionId)).toMatchObject({ interactive: false });
		await runtime.stop(sessionId, "managed-profile-headless-stop");
	});

	it("rejects profile changes on related starts except explicit config restart", async () => {
		const childSessionId = "managed-profile-related-child";
		const parentSessionId = "managed-profile-related-parent";
		const { runtime, catalog, startSession, store } = fixture(childSessionId, {
			persisted: false,
		});
		store.upsertPersistedSession({
			...session(parentSessionId),
			metadata: managedStartInput(parentSessionId).sessionMetadata,
		});
		catalog.adoptRootSession({
			chatId: "managed-profile-related-source",
			sessionId: parentSessionId,
			provenance: {
				invocationId: "managed-profile-related-adopt",
				occurredAt: NOW.toISOString(),
				actor: { kind: "human", id: "human-1" },
				source: { kind: "interactive", transport: "cli" },
			},
		});
		const unauthorizedProfile = managedStartInput(childSessionId, {
			profileId: "automation.v1",
			authorityClassId: "automation",
			allowedModes: ["act"],
		});
		const revisedProfile = managedStartInput(childSessionId, {
			profileRevision: 2,
			policyEpoch: 8,
			connectionPolicyDigest: "c".repeat(64),
			executionPolicyDigest: "d".repeat(64),
			allowedModes: ["act"],
		});
		const parentChat = catalog.getChat("managed-profile-related-source");
		if (!parentChat) throw new Error("missing managed profile parent chat");

		await expect(
			runtime.startRelated({
				operationId: "managed-profile-related-recovery",
				chatId: "managed-profile-related-rejected",
				parentSessionId,
				relationKind: "recovery",
				startInput: unauthorizedProfile,
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(startSession).not.toHaveBeenCalled();

		await expect(
			runtime.startRelated({
				operationId: "managed-profile-related-config-restart",
				chatId: "managed-profile-related-source",
				parentSessionId,
				relationKind: "config_restart",
				expectedRevision: parentChat.revision,
				startInput: unauthorizedProfile,
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(startSession).not.toHaveBeenCalled();

		await expect(
			runtime.startRelated({
				operationId: "managed-profile-related-config-restart-revision",
				chatId: "managed-profile-related-source",
				parentSessionId,
				relationKind: "config_restart",
				expectedRevision: parentChat.revision,
				startInput: revisedProfile,
			}),
		).resolves.toMatchObject({ chatId: "managed-profile-related-source" });
		expect(startSession).toHaveBeenCalledTimes(1);
		await runtime.stop(childSessionId, "managed-profile-related-stop");
	});

	it("atomically admits related lineage before guarded host startup", async () => {
		const sessionId = "managed-related";
		const parentSessionId = "managed-related-parent";
		const { runtime, coordinator, startSession, catalog, store } = fixture(
			sessionId,
			{ persisted: false },
		);
		store.upsertPersistedSession(session(parentSessionId));
		catalog.adoptRootSession({
			chatId: "managed-related-source-chat",
			sessionId: parentSessionId,
			provenance: {
				invocationId: "managed-related-source-adopt",
				occurredAt: NOW.toISOString(),
				actor: { kind: "human", id: "human-1" },
				source: { kind: "interactive", transport: "cli" },
			},
		});
		const guardLease = vi.spyOn(coordinator, "guardLease");

		const result = await runtime.startRelated({
			operationId: "managed-related-op",
			chatId: "managed-related-chat",
			parentSessionId,
			relationKind: "fork",
			startInput: startInput(sessionId),
		});

		expect(guardLease.mock.invocationCallOrder[0]).toBeLessThan(
			startSession.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
		expect(result).toMatchObject({
			chatId: "managed-related-chat",
			leaseRevision: 1,
		});
		expect(catalog.getChat("managed-related-chat")).toMatchObject({
			parentChatId: "managed-related-source-chat",
			headSessionId: sessionId,
			sessions: [
				expect.objectContaining({
					sessionId,
					parentSessionId,
					relationKind: "fork",
				}),
			],
		});
		expect(store.getCatalogManagedArtifactHead(sessionId)).toBeDefined();
		expect(JSON.stringify(result)).not.toContain("leaseToken");
		await runtime.stop(sessionId, "managed-related-stop");
	});

	it("prepares checkpoint state before atomically admitting and guarding its restored writer", async () => {
		const sessionId = "managed-checkpoint-restored";
		const parentSessionId = "managed-checkpoint-source";
		const {
			runtime,
			coordinator,
			startSession,
			catalog,
			store,
			readSessionMessages,
			beginWorkspaceRestoreTransaction,
			applyWorkspaceCheckpoint,
			retainCheckpointRefs,
			commitWorkspaceRestore,
		} = fixture(sessionId, { persisted: false });
		store.upsertPersistedSession({
			...session(parentSessionId),
			metadata: {
				checkpoint: {
					latest: { ref: "checkpoint-2", createdAt: 2, runCount: 2 },
					history: [
						{ ref: "checkpoint-1", createdAt: 1, runCount: 1 },
						{ ref: "checkpoint-2", createdAt: 2, runCount: 2 },
					],
				},
			},
		});
		catalog.adoptRootSession({
			chatId: "managed-checkpoint-source-chat",
			sessionId: parentSessionId,
			provenance: {
				invocationId: "managed-checkpoint-source-adopt",
				occurredAt: NOW.toISOString(),
				actor: { kind: "human", id: "human-1" },
				source: { kind: "interactive", transport: "cli" },
			},
		});
		readSessionMessages.mockResolvedValue([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "first response" },
			{ role: "user", content: "edit me" },
		]);
		const guardLease = vi.spyOn(coordinator, "guardLease");

		const result = await runtime.restoreCheckpoint({
			operationId: "managed-checkpoint-restore",
			chatId: "managed-checkpoint-restored-chat",
			parentSessionId,
			checkpointRunCount: 2,
			restore: {
				workspace: true,
				omitCheckpointMessageFromSession: true,
			},
			startInput: startInput(sessionId),
		});

		expect(readSessionMessages.mock.invocationCallOrder[0]).toBeLessThan(
			guardLease.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
		expect(guardLease.mock.invocationCallOrder[0]).toBeLessThan(
			beginWorkspaceRestoreTransaction.mock.invocationCallOrder[0] ??
				Number.MAX_SAFE_INTEGER,
		);
		expect(
			beginWorkspaceRestoreTransaction.mock.invocationCallOrder[0],
		).toBeLessThan(
			applyWorkspaceCheckpoint.mock.invocationCallOrder[0] ??
				Number.MAX_SAFE_INTEGER,
		);
		expect(applyWorkspaceCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(
			startSession.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
		expect(startSession.mock.invocationCallOrder[0]).toBeLessThan(
			retainCheckpointRefs.mock.invocationCallOrder[0] ??
				Number.MAX_SAFE_INTEGER,
		);
		expect(retainCheckpointRefs.mock.invocationCallOrder[0]).toBeLessThan(
			commitWorkspaceRestore.mock.invocationCallOrder[0] ??
				Number.MAX_SAFE_INTEGER,
		);
		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				initialMessages: [
					{ role: "user", content: "first" },
					{ role: "assistant", content: "first response" },
				],
				sessionMetadata: expect.objectContaining({
					checkpoint: expect.objectContaining({
						latest: expect.objectContaining({ runCount: 2 }),
					}),
				}),
			}),
		);
		expect(result).toMatchObject({
			chatId: "managed-checkpoint-restored-chat",
			checkpoint: { ref: "checkpoint-2", runCount: 2 },
			messages: [
				{ role: "user", content: "first" },
				{ role: "assistant", content: "first response" },
				{ role: "user", content: "edit me" },
			],
		});
		expect(catalog.getChat("managed-checkpoint-restored-chat")).toMatchObject({
			parentChatId: "managed-checkpoint-source-chat",
			headSessionId: sessionId,
			sessions: [
				expect.objectContaining({
					sessionId,
					parentSessionId,
					relationKind: "checkpoint_restore",
				}),
			],
		});
		expect(JSON.stringify(result)).not.toContain("leaseToken");
		await runtime.stop(sessionId, "managed-checkpoint-stop");
	});

	it("does not admit a replacement when checkpoint preparation fails", async () => {
		const sessionId = "managed-checkpoint-invalid";
		const parentSessionId = "managed-checkpoint-invalid-source";
		const { runtime, catalog, store, startSession, readSessionMessages } =
			fixture(sessionId, { persisted: false });
		store.upsertPersistedSession(session(parentSessionId));
		catalog.adoptRootSession({
			chatId: "managed-checkpoint-invalid-source-chat",
			sessionId: parentSessionId,
			provenance: {
				invocationId: "managed-checkpoint-invalid-adopt",
				occurredAt: NOW.toISOString(),
				actor: { kind: "human", id: "human-1" },
				source: { kind: "interactive", transport: "cli" },
			},
		});
		readSessionMessages.mockResolvedValue([
			{ role: "user", content: "no checkpoint exists" },
		]);

		await expect(
			runtime.restoreCheckpoint({
				operationId: "managed-checkpoint-invalid",
				chatId: "managed-checkpoint-should-not-exist",
				parentSessionId,
				checkpointRunCount: 1,
				restore: { workspace: false },
				startInput: startInput(sessionId),
			}),
		).rejects.toThrow();
		expect(startSession).not.toHaveBeenCalled();
		expect(
			catalog.getChat("managed-checkpoint-should-not-exist"),
		).toBeUndefined();
		expect(store.get(sessionId)).toBeUndefined();
	});

	it("retains authority after a failed start until quiescence can be proven", async () => {
		const sessionId = "managed-failed-start";
		const { runtime, startSession, abort, stopSession, catalog } =
			fixture(sessionId);
		startSession.mockRejectedValueOnce(new Error("start failed"));

		await expect(
			runtime.resume({
				operationId: "failed-start-op",
				expectedLeaseRevision: 0,
				startInput: startInput(sessionId),
			}),
		).rejects.toThrow("start failed");
		expect(abort).toHaveBeenCalled();
		expect(stopSession).toHaveBeenCalled();
		expect(catalog.getSessionLease(sessionId)).toMatchObject({
			active: true,
		});
		expect(runtime.manages(sessionId)).toBe(true);
	});

	it("does not release authority when runtime stop fails", async () => {
		const sessionId = "managed-stop-failed";
		const { runtime, quiesceSession, abort, catalog } = fixture(sessionId);
		await runtime.resume({
			operationId: "resume-before-stop-failure",
			expectedLeaseRevision: 0,
			startInput: startInput(sessionId),
		});
		quiesceSession.mockRejectedValueOnce(new Error("stop failed"));

		await expect(runtime.stop(sessionId, "stop-failed-op")).rejects.toThrow(
			"stop failed",
		);
		expect(abort).toHaveBeenCalled();
		expect(catalog.getSessionLease(sessionId)).toMatchObject({
			active: true,
		});
		expect(runtime.manages(sessionId)).toBe(true);
	});

	it("replays release after its applied reply is lost", async () => {
		const sessionId = "managed-release-reply-lost";
		const { runtime, port, catalog } = fixture(sessionId);
		await runtime.resume({
			operationId: "resume-before-lost-release",
			expectedLeaseRevision: 0,
			startInput: startInput(sessionId),
		});
		const release = port.releaseSessionLease.bind(port);
		vi.spyOn(port, "releaseSessionLease").mockImplementationOnce(
			async (...args) => {
				await release(...args);
				throw new Error("simulated lost release reply");
			},
		);

		await expect(runtime.stop(sessionId, "lost-release-op")).rejects.toThrow(
			"simulated lost release reply",
		);
		expect(catalog.getSessionLease(sessionId)).toMatchObject({ active: false });
		await expect(
			runtime.stop(sessionId, "lost-release-op"),
		).resolves.toBeUndefined();
		expect(port.releaseSessionLease).toHaveBeenCalledTimes(2);
	});

	it("releases SQLite authority only after local terminal persistence is quiesced", async () => {
		const sessionId = "managed-local-runtime";
		const dataDir = mkdtempSync(join(tmpdir(), "catalog-managed-local-"));
		const artifactsDir = join(dataDir, "artifacts");
		const store = new SqliteSessionStore({
			sessionsDir: dataDir,
			clock: () => NOW,
		});
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		await sessions.createRootSessionWithArtifacts({
			sessionId,
			source: SessionSource.CLI,
			pid: process.pid,
			interactive: true,
			provider: "test-provider",
			model: "test-model",
			cwd: WORKSPACE,
			workspaceRoot: WORKSPACE,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
		});
		const catalog = new SqliteChatCatalogService({
			dataDir,
			clock: () => NOW,
		});
		const port = new LocalChatCatalogPort({
			service: catalog,
			clock: () => NOW,
		});
		let sequence = 0;
		const coordinator = new ChatSessionLifecycleCoordinator({
			port,
			workspaceKey: WORKSPACE,
			principalId: "human-local",
			source: { kind: "interactive", transport: "cli" },
			clock: () => NOW,
			idFactory: (prefix) => `${prefix}-local-${++sequence}`,
			confirmationIssuer: {
				issue: (target: ChatCatalogConfirmationTarget) => ({
					credential: `credential-local-${++sequence}`,
					...target,
					issuedAt: NOW.toISOString(),
					expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
				}),
			},
		});
		catalog.adoptRootSession({
			chatId: "chat-managed-local",
			sessionId,
			provenance: {
				invocationId: "adopt-local",
				actor: { kind: "human", id: "human-local" },
				source: { kind: "interactive", transport: "cli" },
				occurredAt: NOW.toISOString(),
			},
		});
		const agentShutdown = vi.fn().mockResolvedValue(undefined);
		const runtimeShutdown = vi.fn().mockResolvedValue(undefined);
		const agent = {
			run: vi.fn(),
			continue: vi.fn(),
			restore: vi.fn(),
			getMessages: vi
				.fn()
				.mockReturnValue([{ role: "user", content: "resume managed session" }]),
			getAgentId: vi.fn().mockReturnValue("agent-local"),
			getConversationId: vi.fn().mockReturnValue(sessionId),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => undefined),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: agentShutdown,
			updateConnection: vi.fn(),
		};
		const host = new LocalRuntimeHost({
			distinctId: "managed-local-test",
			sessionService: sessions,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: runtimeShutdown,
				}),
			} as never,
			createAgent: () => agent as never,
			writerLeaseVerifier: createCatalogWriterLeaseVerifier(coordinator),
		});
		const runtime = new CatalogManagedSessionRuntime({ host, coordinator });
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});

		await runtime.resume({
			operationId: "resume-local",
			expectedLeaseRevision: 0,
			startInput: {
				...startInput(sessionId),
				initialMessages: [{ role: "user", content: "resume managed session" }],
			},
		});
		await runtime.stop(sessionId, "stop-local");

		expect(agentShutdown).toHaveBeenCalledWith("catalog_managed_stop");
		expect(runtimeShutdown).toHaveBeenCalledWith("catalog_managed_stop");
		expect(store.get(sessionId)).toMatchObject({ status: "cancelled" });
		expect(store.getCatalogManagedArtifactHead(sessionId)).toMatchObject({
			writerGeneration: 1,
			manifestPath: expect.stringContaining(".g1."),
		});
		expect(catalog.getSessionLease(sessionId)).toMatchObject({ active: false });
	});
});
