import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindHubWorkspaceConnectionPolicyToInstalledInstance } from "../hub/server/workspace-capability-authority";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { SessionSource } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import {
	type ChatCatalogAuthorityContext,
	issueChatCatalogAuthority,
} from "./chat-catalog-authority";
import { LocalChatCatalogPort } from "./chat-catalog-port";
import { SqliteChatCatalogService } from "./sqlite-chat-catalog-service";

const WORKSPACE_A = resolve("/tmp/chat-catalog-port-workspace-a");
const WORKSPACE_B = resolve("/tmp/chat-catalog-port-workspace-b");
const NOW = "2026-08-14T10:00:00.000Z";
let confirmationSequence = 0;

function session(
	sessionId: string,
	workspaceRoot = WORKSPACE_A,
): SessionRecord {
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
		cwd: workspaceRoot,
		workspaceRoot,
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt: "2026-08-14T09:01:00.000Z",
	};
}

function authority(
	workspaceKey = WORKSPACE_A,
	options: {
		tenantId?: string;
		principalId?: string;
		actorKind?: "human" | "system";
		audienceId?: string;
		confirmationGrants?: readonly {
			credential: string;
			confirmation: "archive" | "activate" | "purge" | "revoke_lease";
			invocationId: string;
			aggregateKind: "chat" | "lease";
			aggregateId: string;
			expectedRevision: number;
			issuedAt: string;
			expiresAt: string;
		}[];
		mutationFence?: {
			signal: AbortSignal;
			assertActive(): void;
		};
	} = {},
): ChatCatalogAuthorityContext {
	return issueChatCatalogAuthority({
		principalId: options.principalId ?? "user-1",
		tenantId: options.tenantId,
		workspaceKey,
		actorKind: options.actorKind ?? "human",
		source: { kind: "interactive", transport: "cli" },
		...(options.audienceId ? { audienceId: options.audienceId } : {}),
		confirmationGrants: options.confirmationGrants,
		...(options.mutationFence ? { mutationFence: options.mutationFence } : {}),
		clock: () => new Date(NOW),
	});
}

function confirmed(
	confirmation: "archive" | "activate" | "purge" | "revoke_lease",
	invocationId: string,
	aggregateId: string,
	expectedRevision: number,
	workspaceKey = WORKSPACE_A,
	actorKind: "human" | "system" = "human",
): ChatCatalogAuthorityContext {
	return authority(workspaceKey, {
		actorKind,
		confirmationGrants: [
			{
				credential: `local-confirmation-${++confirmationSequence}`,
				confirmation,
				invocationId,
				aggregateKind: confirmation === "revoke_lease" ? "lease" : "chat",
				aggregateId,
				expectedRevision,
				issuedAt: NOW,
				expiresAt: "2026-08-14T10:05:00.000Z",
			},
		],
	});
}

describe("LocalChatCatalogPort", () => {
	const tempDirs: string[] = [];
	const stores: SqliteSessionStore[] = [];
	const catalogs: SqliteChatCatalogService[] = [];

	function fixture(options: { cleanup?: boolean } = {}) {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-port-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		const catalog = new SqliteChatCatalogService({
			dataDir,
			clock: () => new Date("2026-08-14T10:00:00.000Z"),
			...(options.cleanup
				? {
						artifactCleanup: {
							cleanupChatArtifacts: async (input: {
								chatId: string;
								sessionIds: string[];
								attemptId: string;
							}) => ({
								receiptId: `${input.attemptId}:${input.chatId}:${input.sessionIds.join(",")}`,
							}),
						},
					}
				: {}),
		});
		const port = new LocalChatCatalogPort({
			service: catalog,
			clock: () => new Date("2026-08-14T10:00:00.000Z"),
		});
		stores.push(store);
		catalogs.push(catalog);
		return { dataDir, store, catalog, port };
	}

	function createSession(
		store: SqliteSessionStore,
		record: SessionRecord,
	): void {
		store.create(record);
	}

	afterEach(() => {
		for (const catalog of catalogs.splice(0)) catalog.close();
		for (const store of stores.splice(0)) store.close();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects structurally forged authority contexts", async () => {
		const { port } = fixture();
		const forged = {
			principalId: "user-1",
			tenantId: "local",
			workspaceKey: WORKSPACE_A,
			actorKind: "human",
			source: { kind: "interactive", transport: "cli" },
			confirmationGrants: [],
		} as ChatCatalogAuthorityContext;

		await expect(
			port.listChats(forged, { workspaceKey: WORKSPACE_A }),
		).rejects.toMatchObject({ code: "invalid_input" });
	});

	it("reasserts host mutation authority after reads and before SQLite entry", async () => {
		const { store, catalog, port } = fixture();
		createSession(store, session("session-fenced"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-fenced",
			sessionId: "session-fenced",
			invocationId: "adopt-fenced",
		});
		const rename = vi.spyOn(catalog, "renameChat");
		const controller = new AbortController();
		const revoked = new Error("revoked at final mutation boundary");
		const fenced = authority(WORKSPACE_A, {
			mutationFence: {
				signal: controller.signal,
				assertActive: () => {
					throw revoked;
				},
			},
		});

		await expect(
			port.renameChat(fenced, {
				chatId: "chat-fenced",
				title: "must not commit",
				expectedRevision: 1,
				invocationId: "rename-fenced",
			}),
		).rejects.toBe(revoked);
		expect(rename).not.toHaveBeenCalled();
		const chat = catalog.getChat("chat-fenced");
		expect(chat).toMatchObject({ revision: 1 });
		expect(chat?.title).toBeUndefined();
	});

	it("enforces tenant and workspace authority before reads or mutations", async () => {
		const { dataDir, store, catalog, port } = fixture();
		expect(
			() => new LocalChatCatalogPort({ service: catalog, tenantId: "other" }),
		).toThrowError(expect.objectContaining({ code: "invalid_input" }));
		createSession(store, session("session-a"));
		const wrongTenantService = new SqliteChatCatalogService({
			dataDir,
			tenantId: "other",
		});
		catalogs.push(wrongTenantService);
		const wrongTenantPort = new LocalChatCatalogPort({
			service: wrongTenantService,
			tenantId: "other",
		});
		await expect(
			wrongTenantPort.listChats(authority(WORKSPACE_A, { tenantId: "other" }), {
				workspaceKey: WORKSPACE_A,
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		await port.adoptRootSession(authority(), {
			chatId: "chat-a",
			sessionId: "session-a",
			invocationId: "adopt-a",
		});

		await expect(
			port.listChats(authority(WORKSPACE_A, { tenantId: "other" }), {
				workspaceKey: WORKSPACE_A,
			}),
		).rejects.toMatchObject({ code: "chat_not_found" });
		await expect(
			port.listChats(authority(WORKSPACE_B), { workspaceKey: WORKSPACE_A }),
		).rejects.toMatchObject({ code: "chat_not_found" });
		expect(
			await port.getChat(authority(WORKSPACE_B), "chat-a"),
		).toBeUndefined();
		await expect(
			port.archiveChat(
				confirmed(
					"archive",
					"cross-workspace-archive",
					"chat-a",
					1,
					WORKSPACE_B,
				),
				{
					chatId: "chat-a",
					expectedRevision: 1,
					invocationId: "cross-workspace-archive",
				},
			),
		).rejects.toMatchObject({ code: "chat_not_found" });
	});

	it("authorizes audience before known-id read, mutation, lease, and binding disclosure", async () => {
		const { catalog, port } = fixture();
		const connectorTemplate = {
			authorityClassId: "connector.slack.v1",
			audienceId: "aud_connector_slack_bootstrap_v1",
			policyEpoch: 1,
			allowedStartProfileIds: ["connector.slack.v1"],
			allowedBindingProfileIds: ["connector.slack.v1"],
		};
		const audienceA = bindHubWorkspaceConnectionPolicyToInstalledInstance(
			connectorTemplate,
			"slack:installation-a",
		).audienceId;
		const audienceB = bindHubWorkspaceConnectionPolicyToInstalledInstance(
			connectorTemplate,
			"slack:installation-b",
		).audienceId;
		expect(audienceA).not.toBe(audienceB);
		const ownerA = authority(WORKSPACE_A, { audienceId: audienceA });
		const ownerB = authority(WORKSPACE_A, { audienceId: audienceB });
		const admit = (chatId: string, sessionId: string, audienceId: string) =>
			catalog.admitRootSession({
				chatId,
				audienceId,
				sessionId,
				source: SessionSource.CLI,
				pid: process.pid,
				startedAt: "2026-08-14T09:00:00.000Z",
				interactive: true,
				provider: "test-provider",
				model: "test-model",
				cwd: WORKSPACE_A,
				workspaceRoot: WORKSPACE_A,
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				metadata: {},
				provenance: {
					invocationId: `admit-${chatId}`,
					occurredAt: "2026-08-14T09:00:00.000Z",
					actor: { kind: "human", id: "user-1" },
					source: { kind: "interactive", transport: "cli" },
				},
			});
		admit("chat-audience-a", "session-audience-a", audienceA);
		admit("chat-audience-b", "session-audience-b", audienceB);
		await port.bindChat(ownerB, {
			bindingId: "binding-audience-b",
			transport: "slack",
			instanceId: "installation-b",
			chatId: "chat-audience-b",
			sessionId: "session-audience-b",
			expectedBindingRevision: 0,
			invocationId: "bind-audience-b",
		});

		expect(
			(await port.listChats(ownerA, { workspaceKey: WORKSPACE_A })).items.map(
				(chat) => chat.chatId,
			),
		).toEqual(["chat-audience-a"]);
		expect(await port.getChat(ownerA, "chat-audience-b")).toBeUndefined();
		expect(await port.getChat(ownerA, "chat-unknown")).toBeUndefined();
		expect(
			await port.getSessionLease(ownerA, "session-audience-b"),
		).toBeUndefined();
		expect(
			await port.getSessionLease(ownerA, "session-unknown"),
		).toBeUndefined();
		expect(
			await port.getBinding(ownerA, {
				transport: "slack",
				instanceId: "installation-b",
			}),
		).toBeUndefined();
		expect(
			await port.getBinding(ownerA, {
				transport: "slack",
				instanceId: "installation-unknown",
			}),
		).toBeUndefined();

		const rename = vi.spyOn(catalog, "renameChat");
		for (const chatId of ["chat-audience-b", "chat-unknown"]) {
			await expect(
				port.renameChat(ownerA, {
					chatId,
					title: "Must not disclose",
					expectedRevision: 1,
					invocationId: `rename-${chatId}`,
				}),
			).rejects.toMatchObject({ code: "chat_not_found" });
			await expect(
				port.archiveChat(ownerA, {
					chatId,
					expectedRevision: 1,
					invocationId: `archive-${chatId}`,
				}),
			).rejects.toMatchObject({ code: "chat_not_found" });
		}
		expect(rename).not.toHaveBeenCalled();

		for (const sessionId of ["session-audience-b", "session-unknown"]) {
			await expect(
				port.acquireSessionLease(ownerA, {
					sessionId,
					expectedRevision: 1,
					invocationId: `acquire-${sessionId}`,
				}),
			).rejects.toMatchObject({ code: "session_not_found" });
			await expect(
				port.recordChatActivity(ownerA, {
					chatId: "chat-audience-a",
					sessionId,
					expectedRevision: 1,
					invocationId: `activity-${sessionId}`,
				}),
			).rejects.toMatchObject({ code: "session_not_found" });
		}

		for (const instanceId of ["installation-b", "installation-unknown"]) {
			await expect(
				port.unbindChat(ownerA, {
					transport: "slack",
					instanceId,
					expectedBindingId: "binding-audience-b",
					expectedChatId: "chat-audience-b",
					expectedSessionId: "session-audience-b",
					expectedBindingRevision: 1,
					invocationId: `unbind-${instanceId}`,
				}),
			).rejects.toMatchObject({ code: "binding_conflict" });
		}
	});

	it("requires host-observed human confirmation for lifecycle mutations", async () => {
		const { store, port } = fixture();
		createSession(store, session("session-confirmation"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-confirmation",
			sessionId: "session-confirmation",
			invocationId: "adopt-confirmation",
		});
		const archive = {
			chatId: "chat-confirmation",
			expectedRevision: 1,
			invocationId: "archive-confirmation",
		};

		await expect(port.archiveChat(authority(), archive)).rejects.toMatchObject({
			code: "invalid_input",
		});
		await expect(
			port.archiveChat(
				confirmed("archive", "wrong-invocation", "chat-confirmation", 1),
				archive,
			),
		).rejects.toMatchObject({ code: "invalid_input" });
		await expect(
			port.archiveChat(
				confirmed("archive", "archive-confirmation", "chat-confirmation", 2),
				archive,
			),
		).rejects.toMatchObject({ code: "invalid_input" });
		expect(() =>
			authority(WORKSPACE_A, {
				confirmationGrants: [
					{
						credential: "expired-confirmation",
						confirmation: "archive",
						invocationId: "archive-confirmation",
						aggregateKind: "chat",
						aggregateId: "chat-confirmation",
						expectedRevision: 1,
						issuedAt: "2026-08-14T09:50:00.000Z",
						expiresAt: "2026-08-14T09:59:00.000Z",
					},
				],
			}),
		).toThrowError(expect.objectContaining({ code: "invalid_input" }));
		expect(() =>
			authority(WORKSPACE_A, {
				confirmationGrants: [
					{
						credential: "overlong-confirmation",
						confirmation: "archive",
						invocationId: "archive-confirmation",
						aggregateKind: "chat",
						aggregateId: "chat-confirmation",
						expectedRevision: 1,
						issuedAt: NOW,
						expiresAt: "2026-08-14T10:10:00.001Z",
					},
				],
			}),
		).toThrowError(expect.objectContaining({ code: "invalid_input" }));
		expect(() =>
			confirmed(
				"archive",
				"archive-confirmation",
				"chat-confirmation",
				1,
				WORKSPACE_A,
				"system",
			),
		).toThrowError(expect.objectContaining({ code: "invalid_input" }));
		const oneTime = confirmed(
			"archive",
			"archive-confirmation",
			"chat-confirmation",
			1,
		);
		expect(await port.archiveChat(oneTime, archive)).toMatchObject({
			current: { catalogState: "archived", revision: 2 },
		});
		await expect(port.archiveChat(oneTime, archive)).rejects.toMatchObject({
			code: "invalid_input",
		});
	});

	it("separates immutable replay receipts from the current projection", async () => {
		const { store, port } = fixture();
		createSession(store, session("session-replay"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-replay",
			sessionId: "session-replay",
			invocationId: "adopt-replay",
		});
		const archiveInput = {
			chatId: "chat-replay",
			expectedRevision: 1,
			invocationId: "archive-replay",
		};
		const first = await port.archiveChat(
			confirmed("archive", "archive-replay", "chat-replay", 1),
			archiveInput,
		);
		expect(first.receipt).toMatchObject({
			operation: "archive_chat",
			applied: true,
			replayed: false,
			resultingRevision: 2,
		});
		expect(Object.isFrozen(first.receipt)).toBe(true);

		await port.activateChat(
			confirmed("activate", "activate-after-archive", "chat-replay", 2),
			{
				chatId: "chat-replay",
				expectedRevision: 2,
				invocationId: "activate-after-archive",
			},
		);
		const replay = await port.archiveChat(
			confirmed("archive", "archive-replay", "chat-replay", 1),
			archiveInput,
		);
		expect(replay.receipt).toMatchObject({
			applied: true,
			replayed: true,
			resultingRevision: 2,
		});
		expect(replay.current).toMatchObject({
			catalogState: "active",
			revision: 3,
		});
	});

	it("authorizes post-delete purge replay from durable workspace evidence", async () => {
		const { store, port } = fixture({ cleanup: true });
		createSession(store, session("session-purge"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-purge",
			sessionId: "session-purge",
			invocationId: "adopt-purge",
		});
		await port.archiveChat(
			confirmed("archive", "archive-purge", "chat-purge", 1),
			{
				chatId: "chat-purge",
				expectedRevision: 1,
				invocationId: "archive-purge",
			},
		);
		const purgeInput = {
			chatId: "chat-purge",
			expectedRevision: 2,
			invocationId: "purge-replay",
		};
		const first = await port.purgeChat(
			confirmed("purge", "purge-replay", "chat-purge", 2),
			purgeInput,
		);
		expect(first).toMatchObject({
			receipt: { replayed: false, applied: true },
			sessionIds: ["session-purge"],
		});

		await expect(
			port.purgeChat(
				confirmed("purge", "purge-replay", "chat-purge", 2, WORKSPACE_B),
				purgeInput,
			),
		).rejects.toMatchObject({ code: "chat_not_found" });
		const replay = await port.purgeChat(
			confirmed("purge", "purge-replay", "chat-purge", 2),
			purgeInput,
		);
		expect(replay).toMatchObject({
			receipt: { replayed: true, applied: true },
			sessionIds: ["session-purge"],
		});
	});

	it("keeps binding scope ownership in its original workspace", async () => {
		const { store, catalog, port } = fixture();
		createSession(store, session("session-binding-a", WORKSPACE_A));
		createSession(store, session("session-binding-b", WORKSPACE_B));
		await port.adoptRootSession(authority(WORKSPACE_A), {
			chatId: "chat-binding-a",
			sessionId: "session-binding-a",
			invocationId: "adopt-binding-a",
		});
		await port.adoptRootSession(authority(WORKSPACE_B), {
			chatId: "chat-binding-b",
			sessionId: "session-binding-b",
			invocationId: "adopt-binding-b",
		});
		const scope = {
			transport: "slack",
			instanceId: "instance-shared",
			channelId: "channel-shared",
			threadId: "thread-shared",
		};
		await port.bindChat(authority(WORKSPACE_B), {
			...scope,
			bindingId: "binding-shared",
			chatId: "chat-binding-b",
			sessionId: "session-binding-b",
			expectedBindingRevision: 0,
			invocationId: "bind-binding-b",
		});

		await expect(
			port.bindChat(authority(WORKSPACE_A), {
				...scope,
				bindingId: "binding-shared",
				chatId: "chat-binding-a",
				sessionId: "session-binding-a",
				expectedBindingRevision: 1,
				invocationId: "takeover-binding-a",
			}),
		).rejects.toMatchObject({ code: "chat_not_found" });
		expect(() =>
			catalog.bindChat({
				...scope,
				bindingId: "binding-shared",
				chatId: "chat-binding-a",
				sessionId: "session-binding-a",
				expectedBindingRevision: 1,
				provenance: {
					invocationId: "service-takeover-binding-a",
					occurredAt: "2026-08-14T10:00:00.000Z",
					actor: { kind: "human", id: "user-1" },
					source: { kind: "interactive" },
				},
			}),
		).toThrowError(expect.objectContaining({ code: "binding_conflict" }));
		expect(() =>
			catalog.unbindChat(
				{
					...scope,
					expectedBindingId: "binding-shared",
					expectedChatId: "chat-binding-b",
					expectedSessionId: "session-binding-b",
					expectedBindingRevision: 1,
					provenance: {
						invocationId: "service-unbind-binding-a",
						occurredAt: "2026-08-14T10:00:00.000Z",
						actor: { kind: "human", id: "user-1" },
						source: { kind: "interactive" },
					},
				},
				WORKSPACE_A,
			),
		).toThrowError(expect.objectContaining({ code: "binding_conflict" }));
		await port.unbindChat(authority(WORKSPACE_B), {
			...scope,
			expectedBindingId: "binding-shared",
			expectedChatId: "chat-binding-b",
			expectedSessionId: "session-binding-b",
			expectedBindingRevision: 1,
			invocationId: "unbind-binding-b",
		});
		await expect(
			port.bindChat(authority(WORKSPACE_A), {
				...scope,
				bindingId: "binding-shared",
				chatId: "chat-binding-a",
				sessionId: "session-binding-a",
				expectedBindingRevision: 2,
				invocationId: "takeover-unbound-binding-a",
			}),
		).rejects.toMatchObject({ code: "chat_not_found" });
	});

	it("derives lease ownership from the issued principal", async () => {
		const { store, port } = fixture();
		createSession(store, session("session-lease"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-lease",
			sessionId: "session-lease",
			invocationId: "adopt-lease",
		});
		const lease = await port.acquireSessionLease(
			authority(WORKSPACE_A, { principalId: "lease-owner" }),
			{
				sessionId: "session-lease",
				expectedRevision: 0,
				ttlMs: 5_000,
				invocationId: "acquire-lease",
			},
		);
		expect(lease.current).toMatchObject({
			ownerId: "lease-owner",
			active: true,
			revision: 1,
		});
		expect(lease.leaseToken).toBeTruthy();
	});

	it("keeps lease rekey credentials inside the trusted local port", async () => {
		const { store, port } = fixture();
		createSession(store, session("session-rekey"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-rekey",
			sessionId: "session-rekey",
			invocationId: "adopt-rekey",
		});
		const acquired = await port.acquireSessionLease(authority(), {
			sessionId: "session-rekey",
			expectedRevision: 0,
			invocationId: "acquire-rekey",
		});
		const rekey = port.rekeySessionLease;
		expect(rekey).toBeTypeOf("function");
		if (!rekey) throw new Error("local rekey capability missing");
		const input = {
			sessionId: "session-rekey",
			leaseToken: acquired.leaseToken ?? "",
			expectedRevision: 1,
			expectedWriterGeneration: 1,
			invocationId: "rekey-resident-writer",
		};

		const result = await rekey.call(port, authority(), input);
		const replay = await rekey.call(port, authority(), input);

		expect(result).toMatchObject({
			receipt: {
				operation: "rekey_session_lease",
				replayed: false,
				resultingRevision: 2,
			},
			current: { revision: 2, writerGeneration: 2 },
		});
		expect(result.leaseToken).toBeTruthy();
		expect(result.leaseToken).not.toBe(acquired.leaseToken);
		expect(replay).toMatchObject({
			receipt: { replayed: true, resultingRevision: 2 },
			leaseToken: result.leaseToken,
		});
		await expect(
			rekey.call(port, authority(WORKSPACE_A, { principalId: "other" }), {
				...input,
				invocationId: "rekey-wrong-owner",
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
	});

	it("recovers an inaccessible lease token through owner-confirmed revocation", async () => {
		const { store, port } = fixture();
		createSession(store, session("session-lost-lease"));
		await port.adoptRootSession(authority(), {
			chatId: "chat-lost-lease",
			sessionId: "session-lost-lease",
			invocationId: "adopt-lost-lease",
		});
		const acquireInput = {
			sessionId: "session-lost-lease",
			expectedRevision: 0,
			ttlMs: 5_000,
			invocationId: "acquire-lost-lease",
		};
		const acquired = await port.acquireSessionLease(authority(), acquireInput);
		const oldToken = acquired.leaseToken ?? "";
		expect(oldToken).toBeTruthy();
		const acquireReplay = await port.acquireSessionLease(
			authority(),
			acquireInput,
		);
		expect(acquireReplay).toMatchObject({
			receipt: { applied: true, replayed: true, resultingRevision: 1 },
			current: { active: true, revision: 1 },
		});
		expect(acquireReplay.leaseToken).toBeUndefined();
		expect(
			await port.getSessionLease(authority(), "session-lost-lease"),
		).toMatchObject({ ownerId: "user-1", active: true, revision: 1 });
		expect(
			await port.getSessionLease(authority(WORKSPACE_B), "session-lost-lease"),
		).toBeUndefined();

		const revokeInput = {
			sessionId: "session-lost-lease",
			expectedRevision: 1,
			invocationId: "revoke-lost-lease",
		};
		const spentConfirmation = confirmed(
			"revoke_lease",
			"revoke-lost-lease",
			"session-lost-lease",
			1,
		);
		const revoked = await port.revokeSessionLease(
			spentConfirmation,
			revokeInput,
		);
		expect(revoked).toMatchObject({
			receipt: {
				operation: "revoke_session_lease",
				applied: true,
				replayed: false,
				resultingRevision: 2,
			},
			current: { active: false, revision: 2 },
		});
		await expect(
			port.revokeSessionLease(spentConfirmation, revokeInput),
		).rejects.toMatchObject({ code: "invalid_input" });
		const revokeReplay = await port.revokeSessionLease(
			confirmed("revoke_lease", "revoke-lost-lease", "session-lost-lease", 1),
			revokeInput,
		);
		expect(revokeReplay).toMatchObject({
			receipt: { applied: true, replayed: true, resultingRevision: 2 },
			current: { active: false, revision: 2 },
		});

		const replacement = await port.acquireSessionLease(authority(), {
			sessionId: "session-lost-lease",
			expectedRevision: 2,
			ttlMs: 5_000,
			invocationId: "reacquire-lost-lease",
		});
		expect(replacement).toMatchObject({
			current: { active: true, revision: 3 },
		});
		expect(replacement.leaseToken).toBeTruthy();
		expect(replacement.leaseToken).not.toBe(oldToken);
		await expect(
			port.releaseSessionLease(authority(), {
				sessionId: "session-lost-lease",
				leaseToken: oldToken,
				expectedRevision: 3,
				invocationId: "release-old-lost-lease",
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		await expect(
			port.releaseSessionLease(
				authority(WORKSPACE_A, { principalId: "other" }),
				{
					sessionId: "session-lost-lease",
					leaseToken: replacement.leaseToken ?? "",
					expectedRevision: 3,
					invocationId: "release-other-lost-lease",
				},
			),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(
			await port.releaseSessionLease(authority(), {
				sessionId: "session-lost-lease",
				leaseToken: replacement.leaseToken ?? "",
				expectedRevision: 3,
				invocationId: "release-replacement-lost-lease",
			}),
		).toMatchObject({ current: { active: false, revision: 4 } });
	});
});
