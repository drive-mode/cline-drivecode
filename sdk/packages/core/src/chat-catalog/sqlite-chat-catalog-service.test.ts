import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureSessionSchema, loadSqliteDb } from "@cline/shared/db";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { SessionWriterFenceRejectedError } from "../session/writer-fence";
import { SessionSource } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import {
	ChatCatalogError,
	ensureChatCatalogSchema,
	SqliteChatCatalogService,
} from "./sqlite-chat-catalog-service";

const WORKSPACE_A = resolve("/tmp/chat-catalog-workspace-a");
const WORKSPACE_B = resolve("/tmp/chat-catalog-workspace-b");
const LEGACY_PROFILE_AUTHORITY = {
	profileId: "legacy-interactive-v1",
	profileRevision: 1,
	authorityClassId: "cline.chat.authority.interactive-owner.v1",
	policyEpoch: 0,
	connectionPolicyDigest: "a".repeat(64),
	executionPolicyDigest: "b".repeat(64),
	interactive: true,
	allowedModes: ["plan"] as const,
};

function stripAudienceV5Artifacts(db: ReturnType<typeof loadSqliteDb>): void {
	for (const trigger of [
		"trg_chats_audience_immutable",
		"trg_chat_bindings_audience_immutable",
		"trg_chat_purge_tombstones_audience_immutable",
		"trg_chat_purge_attempts_audience_immutable",
		"trg_chat_event_delivery_scope_immutable",
		"trg_chat_audience_manifest_immutable",
		"trg_chat_audience_manifest_delete",
		"trg_chat_audience_evidence_immutable",
		"trg_chat_audience_evidence_delete",
		"trg_chat_audience_assignment_log_immutable",
		"trg_chat_audience_assignment_log_delete",
	]) {
		db.exec(`DROP TRIGGER IF EXISTS ${trigger};`);
	}
	db.exec(`DROP TABLE IF EXISTS chat_audience_assignment_log;`);
	db.exec(`DROP TABLE IF EXISTS chat_audience_migration_state;`);
	db.exec(`DROP TABLE IF EXISTS chat_audience_migration_evidence;`);
	db.exec(`DROP TABLE IF EXISTS chat_audience_migration_manifest;`);
	db.exec(`UPDATE chats SET audience_id = 'audience_unassigned';`);
	db.exec(`UPDATE chat_bindings SET audience_id = 'audience_unassigned';`);
	db.exec(
		`UPDATE chat_purge_tombstones SET audience_id = 'audience_unassigned';`,
	);
	db.exec(
		`UPDATE chat_purge_attempts SET audience_id = 'audience_unassigned';`,
	);
	db.exec(
		`UPDATE chat_event_delivery_scope SET audience_id = NULL, projection_json = NULL;`,
	);
}

async function initializeCatalogInChild(
	dataDir: string,
	tenantId: string,
	startAt: number,
): Promise<{ code: number | null; stderr: string }> {
	const serviceUrl = new URL(
		"./sqlite-chat-catalog-service.ts",
		import.meta.url,
	).href;
	const child = spawn(
		"bun",
		[
			"-e",
			`import { SqliteChatCatalogService } from ${JSON.stringify(serviceUrl)};
			 const delay = Math.max(0, Number(process.env.CHAT_CATALOG_CONCURRENT_START_AT) - Date.now());
			 if (delay > 0) await Bun.sleep(delay);
			 const service = new SqliteChatCatalogService({
			   dataDir: process.env.CHAT_CATALOG_CONCURRENT_DIR,
			   tenantId: process.env.CHAT_CATALOG_CONCURRENT_TENANT,
			 });
			 service.getChat("concurrent-missing-chat");
			 service.close();`,
		],
		{
			env: {
				...process.env,
				CHAT_CATALOG_CONCURRENT_DIR: dataDir,
				CHAT_CATALOG_CONCURRENT_TENANT: tenantId,
				CHAT_CATALOG_CONCURRENT_START_AT: String(startAt),
			},
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	const code = await new Promise<number | null>((resolveExit, rejectExit) => {
		child.once("error", rejectExit);
		child.once("exit", resolveExit);
	});
	return { code, stderr };
}

function provenance(
	invocationId: string,
	occurredAt = "2026-08-14T10:00:00.000Z",
	actorKind: "human" | "system" = "human",
	actorId = actorKind === "human" ? "user-1" : "core",
) {
	return {
		invocationId,
		occurredAt,
		actor: { kind: actorKind, id: actorId },
		source: { kind: "interactive" as const, transport: "cli" },
	};
}

function session(
	sessionId: string,
	workspaceRoot = WORKSPACE_A,
	status: SessionRecord["status"] = "completed",
): SessionRecord {
	return {
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		startedAt: "2026-08-14T09:00:00.000Z",
		endedAt: status === "completed" ? "2026-08-14T09:01:00.000Z" : null,
		status,
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

function rootAdmission(
	sessionId: string,
	chatId: string,
	invocationId = `admit-${sessionId}`,
) {
	return {
		chatId,
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
		metadata: { operationId: invocationId },
		provenance: provenance(invocationId),
	};
}

function relatedAdmission(
	sessionId: string,
	chatId: string,
	parentSessionId: string,
	relationKind: "fork" | "checkpoint_restore" | "config_restart" | "recovery",
	invocationId = `admit-${relationKind}-${sessionId}`,
) {
	return {
		...rootAdmission(sessionId, chatId, invocationId),
		parentSessionId,
		relationKind,
		...(relationKind === "config_restart" || relationKind === "recovery"
			? { expectedRevision: 1 }
			: {}),
	};
}

function expectCatalogCode(callback: () => unknown, code: string): void {
	let thrown: unknown;
	try {
		callback();
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(ChatCatalogError);
	expect((thrown as ChatCatalogError).code).toBe(code);
}

describe("SqliteChatCatalogService", () => {
	const tempDirs: string[] = [];
	const stores: SqliteSessionStore[] = [];
	const catalogs: SqliteChatCatalogService[] = [];

	function fixture() {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		const catalog = new SqliteChatCatalogService({ dataDir });
		stores.push(store);
		catalogs.push(catalog);
		return { dataDir, store, catalog };
	}

	function createSession(
		store: SqliteSessionStore,
		record: SessionRecord,
		activityAt = record.updatedAt,
	): void {
		store.create(record);
		store.update({ sessionId: record.sessionId, updatedAt: activityAt });
	}

	afterEach(() => {
		for (const catalog of catalogs.splice(0)) catalog.close();
		for (const store of stores.splice(0)) store.close();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("atomically admits a root session, chat membership, and first writer lease", () => {
		const { store, catalog } = fixture();
		const input = rootAdmission("session-admit", "chat-admit");

		const admitted = catalog.admitRootSession(input);

		expect(admitted).toMatchObject({
			applied: true,
			chat: {
				chatId: "chat-admit",
				headSessionId: "session-admit",
				catalogState: "active",
			},
			lease: {
				sessionId: "session-admit",
				active: true,
				revision: 1,
				writerGeneration: 1,
			},
		});
		expect(admitted.leaseToken).toEqual(expect.any(String));
		expect(store.get("session-admit")).toMatchObject({
			status: "idle",
			messagesPath: undefined,
			metadata: { operationId: "admit-session-admit" },
		});
		expect(
			store.queryOne<Record<string, unknown>>(
				`SELECT commit_sequence, lease_revision, writer_generation,
				        messages_path, manifest_path, compaction_path
				 FROM session_writer_heads WHERE session_id = ?`,
				["session-admit"],
			),
		).toMatchObject({
			commit_sequence: 0,
			lease_revision: 1,
			writer_generation: 1,
			messages_path: null,
			manifest_path: null,
			compaction_path: null,
		});
		expect(
			store
				.queryAll<{ event_type: string }>(
					`SELECT event_type FROM chat_events WHERE chat_id = ? ORDER BY event_sequence`,
					["chat-admit"],
				)
				.map((row) => row.event_type),
		).toEqual(["chat.created", "session.lease_acquired"]);

		const replay = catalog.admitRootSession(input);
		expect(replay.applied).toBe(false);
		expect(replay.leaseToken).toBeUndefined();
		expect(replay.lease).toEqual(admitted.lease);
		expectCatalogCode(
			() => catalog.admitRootSession({ ...input, model: "changed-model" }),
			"invocation_replay_conflict",
		);
	});

	it("resolves session projections only inside the immutable audience and outside deletion", async () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-audience-lookup"));
		catalog.adoptRootSession({
			chatId: "chat-audience-lookup",
			sessionId: "session-audience-lookup",
			audienceId: "aud_lookup_owner_v1",
			provenance: provenance("adopt-audience-lookup"),
		});

		const authorized = catalog.getAudienceSessionProjection({
			sessionId: "session-audience-lookup",
			workspaceKey: WORKSPACE_A,
			audienceId: "aud_lookup_owner_v1",
		});
		expect(authorized).toMatchObject({
			snapshotSequence: 1,
			chat: {
				chatId: "chat-audience-lookup",
				headSessionId: "session-audience-lookup",
			},
		});
		expect(Object.isFrozen(authorized)).toBe(true);
		expect(
			catalog.getAudienceSessionProjection({
				sessionId: "session-audience-lookup",
				workspaceKey: WORKSPACE_A,
				audienceId: "aud_lookup_foreign_v1",
			}),
		).toEqual({ snapshotSequence: 1, chat: null });
		expect(
			catalog.getAudienceSessionProjection({
				sessionId: "session-audience-lookup",
				workspaceKey: WORKSPACE_B,
				audienceId: "aud_lookup_owner_v1",
			}),
		).toEqual({ snapshotSequence: 1, chat: null });

		catalog.archiveChat({
			chatId: "chat-audience-lookup",
			expectedRevision: 1,
			provenance: provenance("archive-audience-lookup"),
		});
		catalog.close();
		const deleting = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup: {
				cleanupChatArtifacts: async () => {
					throw new Error("hold deletion open");
				},
			},
		});
		catalogs.push(deleting);
		await expect(
			deleting.purgeChat({
				chatId: "chat-audience-lookup",
				expectedRevision: 2,
				provenance: provenance("purge-audience-lookup"),
			}),
		).rejects.toMatchObject({ code: "purge_cleanup_failed" });
		expect(
			deleting.getAudienceSessionProjection({
				sessionId: "session-audience-lookup",
				workspaceKey: WORKSPACE_A,
				audienceId: "aud_lookup_owner_v1",
			}),
		).toMatchObject({ chat: null });
	});

	it("rolls back a newly reserved session when root admission conflicts", () => {
		const { store, catalog } = fixture();
		createSession(store, session("existing-session"));
		catalog.adoptRootSession({
			chatId: "existing-chat",
			sessionId: "existing-session",
			provenance: provenance("adopt-existing"),
		});

		expectCatalogCode(
			() =>
				catalog.admitRootSession(
					rootAdmission("rolled-back-session", "existing-chat"),
				),
			"lineage_conflict",
		);
		expect(store.get("rolled-back-session")).toBeUndefined();
		expect(catalog.getSessionLease("rolled-back-session")).toBeUndefined();
	});

	it("atomically admits a derived chat and its first fenced writer", () => {
		const { store, catalog } = fixture();
		createSession(store, session("branch-source"));
		catalog.adoptRootSession({
			chatId: "branch-source-chat",
			sessionId: "branch-source",
			provenance: provenance("adopt-branch-source"),
		});
		const input = relatedAdmission(
			"branch-child",
			"branch-child-chat",
			"branch-source",
			"fork",
		);

		const admitted = catalog.admitRelatedSession(input);

		expect(admitted).toMatchObject({
			applied: true,
			chat: {
				chatId: "branch-child-chat",
				parentChatId: "branch-source-chat",
				headSessionId: "branch-child",
				revision: 1,
				sessions: [
					expect.objectContaining({
						sessionId: "branch-child",
						parentSessionId: "branch-source",
						relationKind: "fork",
					}),
				],
			},
			lease: {
				sessionId: "branch-child",
				active: true,
				revision: 1,
				writerGeneration: 1,
			},
		});
		expect(admitted.leaseToken).toEqual(expect.any(String));
		expect(store.get("branch-child")).toMatchObject({
			status: "idle",
			messagesPath: undefined,
		});
		expect(store.getCatalogManagedArtifactHead("branch-child")).toMatchObject({
			commitSequence: 0,
			leaseRevision: 1,
			writerGeneration: 1,
		});
		expect(
			store
				.queryAll<{ event_type: string }>(
					`SELECT event_type FROM chat_events WHERE chat_id = ? ORDER BY event_sequence`,
					["branch-child-chat"],
				)
				.map((row) => row.event_type),
		).toEqual(["chat.fork", "session.lease_acquired"]);

		const replay = catalog.admitRelatedSession(input);
		expect(replay.applied).toBe(false);
		expect(replay.leaseToken).toBeUndefined();
		expect(replay.chat).toEqual(admitted.chat);
		expectCatalogCode(
			() =>
				catalog.admitRelatedSession({
					...input,
					relationKind: "checkpoint_restore",
				}),
			"invocation_replay_conflict",
		);
	});

	it("atomically admits a successor and rolls back failed CAS reservations", () => {
		const { store, catalog } = fixture();
		createSession(store, session("successor-source"));
		catalog.adoptRootSession({
			chatId: "successor-chat",
			sessionId: "successor-source",
			provenance: provenance("adopt-successor-source"),
		});
		const input = relatedAdmission(
			"successor-recovery",
			"successor-chat",
			"successor-source",
			"recovery",
		);

		const admitted = catalog.admitRelatedSession(input);

		expect(admitted.chat).toMatchObject({
			chatId: "successor-chat",
			headSessionId: "successor-recovery",
			revision: 2,
			sessions: expect.arrayContaining([
				expect.objectContaining({
					sessionId: "successor-recovery",
					parentSessionId: "successor-source",
					relationKind: "recovery",
					ordinal: 1,
				}),
			]),
		});
		expect(admitted.lease).toMatchObject({
			sessionId: "successor-recovery",
			active: true,
			writerGeneration: 1,
		});
		expect(admitted.leaseToken).toEqual(expect.any(String));

		const replay = catalog.admitRelatedSession(input);
		expect(replay.applied).toBe(false);
		expect(replay.leaseToken).toBeUndefined();

		expectCatalogCode(
			() =>
				catalog.admitRelatedSession({
					...relatedAdmission(
						"successor-rolled-back",
						"successor-chat",
						"successor-recovery",
						"config_restart",
					),
					expectedRevision: 1,
				}),
			"revision_conflict",
		);
		expect(store.get("successor-rolled-back")).toBeUndefined();
		expect(catalog.getSessionLease("successor-rolled-back")).toBeUndefined();
	});

	it("lists workspace-scoped chats by lifecycle, source, and stable activity cursor", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-a-new"), "2026-08-14T09:03:00.000Z");
		createSession(store, session("session-a-old"), "2026-08-14T09:02:00.000Z");
		createSession(
			store,
			{ ...session("session-b", WORKSPACE_B), source: SessionSource.API },
			"2026-08-14T09:04:00.000Z",
		);

		catalog.adoptRootSession({
			chatId: "chat-a-new",
			sessionId: "session-a-new",
			provenance: provenance("adopt-a-new"),
		});
		catalog.adoptRootSession({
			chatId: "chat-a-old",
			sessionId: "session-a-old",
			provenance: provenance("adopt-a-old"),
		});
		catalog.adoptRootSession({
			chatId: "chat-b",
			sessionId: "session-b",
			provenance: provenance("adopt-b"),
		});

		const first = catalog.listChats({ workspaceKey: WORKSPACE_A, limit: 1 });
		expect(first.items.map((chat) => chat.chatId)).toEqual(["chat-a-new"]);
		expect(first.nextCursor).toBeDefined();
		expect(
			catalog
				.listChats({
					workspaceKey: WORKSPACE_A,
					limit: 1,
					cursor: first.nextCursor,
				})
				.items.map((chat) => chat.chatId),
		).toEqual(["chat-a-old"]);
		expect(
			catalog
				.listChats({
					workspaceKey: WORKSPACE_B,
					sourceKind: SessionSource.API,
				})
				.items.map((chat) => chat.chatId),
		).toEqual(["chat-b"]);

		catalog.archiveChat({
			chatId: "chat-a-new",
			expectedRevision: 1,
			provenance: provenance("archive-a-new"),
		});
		expect(
			catalog
				.listChats({ workspaceKey: WORKSPACE_A })
				.items.map((chat) => chat.chatId),
		).toEqual(["chat-a-old"]);
		expect(
			catalog.listChats({
				workspaceKey: WORKSPACE_A,
				catalogState: "archived",
			}).items[0],
		).toMatchObject({ chatId: "chat-a-new", catalogState: "archived" });
		expect(catalog.getChat("chat-a-new")?.sessions[0]?.executionStatus).toBe(
			"completed",
		);
	});

	it("enforces human provenance, CAS, running guards, and content-bound replay", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-cas"));
		const adopt = {
			chatId: "chat-cas",
			sessionId: "session-cas",
			provenance: provenance("adopt-cas"),
		};
		expect(catalog.adoptRootSession(adopt).applied).toBe(true);
		expect(catalog.adoptRootSession(adopt).applied).toBe(false);
		expectCatalogCode(
			() =>
				catalog.adoptRootSession({
					...adopt,
					title: "changed intent",
				}),
			"invocation_replay_conflict",
		);
		expectCatalogCode(
			() =>
				catalog.archiveChat({
					chatId: "chat-cas",
					expectedRevision: 1,
					provenance: provenance("adopt-cas"),
				}),
			"invocation_replay_conflict",
		);
		expectCatalogCode(
			() =>
				catalog.archiveChat({
					chatId: "chat-cas",
					expectedRevision: 1,
					provenance: provenance("system-archive", undefined, "system"),
				}),
			"invalid_input",
		);

		store.update({ sessionId: "session-cas", status: "running" });
		expectCatalogCode(
			() =>
				catalog.archiveChat({
					chatId: "chat-cas",
					expectedRevision: 1,
					provenance: provenance("running-archive"),
				}),
			"chat_running",
		);
		store.update({ sessionId: "session-cas", status: "completed" });
		expectCatalogCode(
			() =>
				catalog.archiveChat({
					chatId: "chat-cas",
					expectedRevision: 0,
					provenance: provenance("stale-archive"),
				}),
			"revision_conflict",
		);
		expect(
			catalog.archiveChat({
				chatId: "chat-cas",
				expectedRevision: 1,
				provenance: provenance("valid-archive"),
			}).value,
		).toMatchObject({ catalogState: "archived", revision: 2 });
	});

	it("archives and clears bindings in one catalog transaction", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-archive-reset"));
		catalog.adoptRootSession({
			chatId: "chat-archive-reset",
			sessionId: "session-archive-reset",
			provenance: provenance("adopt-archive-reset"),
		});
		const scope = {
			transport: "telegram",
			instanceId: "bot-archive-reset",
			threadId: "thread-archive-reset",
		};
		catalog.bindChat({
			...scope,
			bindingId: "binding-archive-reset",
			chatId: "chat-archive-reset",
			sessionId: "session-archive-reset",
			expectedBindingRevision: 0,
			provenance: provenance("bind-archive-reset"),
		});
		const input = {
			chatId: "chat-archive-reset",
			expectedRevision: 1,
			clearBindings: true,
			provenance: provenance("archive-and-reset"),
		};

		expect(catalog.archiveChat(input)).toMatchObject({
			applied: true,
			value: { catalogState: "archived", revision: 2, bindings: [] },
		});
		expect(catalog.getBinding(scope)).toMatchObject({
			bound: false,
			revision: 2,
		});
		expect(catalog.archiveChat(input)).toMatchObject({
			applied: false,
			value: { catalogState: "archived", revision: 2 },
		});
		expect(
			catalog.listEvents("chat-archive-reset").map((event) => event.eventType),
		).toContain("binding.cleared_for_archive");
	});

	it("renames active or archived chats with revisioned idempotency", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-rename"));
		catalog.adoptRootSession({
			chatId: "chat-rename",
			sessionId: "session-rename",
			title: "Generated title",
			titleSource: "prompt",
			provenance: provenance("adopt-rename"),
		});
		const rename = {
			chatId: "chat-rename",
			title: "Quarterly research",
			expectedRevision: 1,
			provenance: provenance("rename-chat"),
		};

		expect(catalog.renameChat(rename)).toMatchObject({
			applied: true,
			value: {
				title: "Quarterly research",
				titleSource: "manual",
				revision: 2,
			},
		});
		expect(catalog.renameChat(rename)).toMatchObject({
			applied: false,
			value: { title: "Quarterly research", revision: 2 },
		});
		expect(() =>
			catalog.renameChat({ ...rename, title: "Changed replay" }),
		).toThrow();
		expect(
			catalog.listEvents("chat-rename").map((event) => event.eventType),
		).toContain("chat.renamed");
	});

	it("rejects legacy session deletion from an independent SQLite connection", () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-protected"));
		catalog.adoptRootSession({
			chatId: "chat-protected",
			sessionId: "session-protected",
			provenance: provenance("adopt-protected"),
		});
		const legacyStore = new SqliteSessionStore({ sessionsDir: dataDir });
		stores.push(legacyStore);

		expect(() => legacyStore.delete("session-protected")).toThrow();
		expect(catalog.getChat("chat-protected")).toMatchObject({
			headSessionId: "session-protected",
			sessions: [{ sessionId: "session-protected" }],
		});
	});

	it("fails closed on malformed or future catalog schemas", () => {
		const malformedDir = mkdtempSync(join(tmpdir(), "chat-catalog-malformed-"));
		const futureDir = mkdtempSync(join(tmpdir(), "chat-catalog-future-"));
		tempDirs.push(malformedDir, futureDir);
		const malformedDb = loadSqliteDb(join(malformedDir, "sessions.db"));
		ensureSessionSchema(malformedDb, { includeLegacyMigrations: true });
		malformedDb.exec(`CREATE TABLE chats (chat_id TEXT PRIMARY KEY);`);
		expectCatalogCode(
			() => ensureChatCatalogSchema(malformedDb),
			"unsupported_capability",
		);
		expect(
			malformedDb
				.prepare(
					`SELECT name FROM sqlite_master
					 WHERE type = 'table' AND name = 'chat_catalog_schema'`,
				)
				.get(),
		).toBeNull();
		expect(
			malformedDb
				.prepare(
					`SELECT name FROM sqlite_master
					 WHERE type = 'table' AND name = 'chat_sessions'`,
				)
				.get(),
		).toBeNull();
		malformedDb.close?.();

		const futureDb = loadSqliteDb(join(futureDir, "sessions.db"));
		ensureSessionSchema(futureDb, { includeLegacyMigrations: true });
		futureDb.exec(`CREATE TABLE chat_catalog_schema (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			version INTEGER NOT NULL
		);`);
		futureDb.exec(
			`INSERT INTO chat_catalog_schema (singleton, version) VALUES (1, 6);`,
		);
		expectCatalogCode(
			() => ensureChatCatalogSchema(futureDb),
			"unsupported_capability",
		);
		futureDb.close?.();
	});

	it("backfills writer heads when migrating existing v2 leases", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-v2-lease-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		store.create(session("session-v2-lease"));
		const catalog = new SqliteChatCatalogService({ dataDir });
		catalog.adoptRootSession({
			chatId: "chat-v2-lease",
			sessionId: "session-v2-lease",
			provenance: provenance("adopt-v2-lease"),
		});
		catalog.acquireSessionLease({
			sessionId: "session-v2-lease",
			expectedRevision: 0,
			ttlMs: 5_000,
			provenance: provenance("acquire-v2-lease"),
		});
		catalog.close();
		store.close();

		const legacyDb = loadSqliteDb(join(dataDir, "sessions.db"));
		stripAudienceV5Artifacts(legacyDb);
		legacyDb.exec(`DROP TABLE session_writer_heads;`);
		legacyDb.exec(
			`UPDATE chat_catalog_schema SET version = 2 WHERE singleton = 1;`,
		);
		ensureChatCatalogSchema(legacyDb);
		expect(
			legacyDb
				.prepare(
					`SELECT lease_revision, writer_generation
					 FROM session_writer_heads WHERE session_id = ?`,
				)
				.get("session-v2-lease"),
		).toMatchObject({ lease_revision: 2, writer_generation: 2 });
		legacyDb.close?.();

		const migratedStore = new SqliteSessionStore({ sessionsDir: dataDir });
		expect(() =>
			migratedStore.update({
				sessionId: "session-v2-lease",
				status: "failed",
			}),
		).toThrow(SessionWriterFenceRejectedError);
		migratedStore.close();
	});

	it("freezes copied-v4 audience evidence and assigns exactly once across restarts", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-v4-audience-"));
		tempDirs.push(dataDir);
		const seed = new SqliteChatCatalogService({ dataDir });
		catalogs.push(seed);
		seed.admitRootSession({
			chatId: "chat-v4-exact",
			sessionId: "session-v4-exact",
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
			metadata: {
				__clineManagedProfileAuthorityV1: LEGACY_PROFILE_AUTHORITY,
			},
			provenance: provenance("seed-v4-exact"),
		});
		seed.close();

		const phaseOne = loadSqliteDb(join(dataDir, "sessions.db"));
		stripAudienceV5Artifacts(phaseOne);
		phaseOne.exec(
			`UPDATE chat_catalog_schema SET version = 4 WHERE singleton = 1;`,
		);
		ensureChatCatalogSchema(phaseOne);
		const manifest = phaseOne
			.prepare(
				`SELECT legacy_event_high_water FROM chat_audience_migration_manifest
				 WHERE singleton = 1`,
			)
			.get();
		expect(manifest).toMatchObject({ legacy_event_high_water: 2 });
		expect(
			phaseOne
				.prepare(`SELECT audience_id FROM chats WHERE chat_id = ?`)
				.get("chat-v4-exact"),
		).toMatchObject({ audience_id: "audience_unassigned" });
		phaseOne.close?.();

		// Simulate a process crash/restart between the committed evidence cut and
		// reconciliation. Live metadata is mutable afterward and must be ignored.
		const reconciled = loadSqliteDb(join(dataDir, "sessions.db"));
		reconciled
			.prepare(`UPDATE sessions SET metadata_json = ? WHERE session_id = ?`)
			.run("{}", "session-v4-exact");
		ensureChatCatalogSchema(reconciled, "local", {
			audienceMigrationMappings: [
				{
					profileAuthority: LEGACY_PROFILE_AUTHORITY,
					audienceId: "aud_exact_owner_v1",
				},
			],
		});
		expect(
			reconciled
				.prepare(`SELECT audience_id, revision FROM chats WHERE chat_id = ?`)
				.get("chat-v4-exact"),
		).toMatchObject({ audience_id: "aud_exact_owner_v1", revision: 2 });
		expect(
			reconciled
				.prepare(
					`SELECT audience_id, projection_json
					 FROM chat_event_delivery_scope
					 WHERE event_sequence <= ?
					 ORDER BY event_sequence ASC`,
				)
				.all(manifest?.legacy_event_high_water),
		).toEqual([
			{ audience_id: null, projection_json: null },
			{ audience_id: null, projection_json: null },
		]);
		expect(
			reconciled
				.prepare(
					`SELECT COUNT(*) AS count FROM chat_audience_assignment_log
					 WHERE chat_id = ?`,
				)
				.get("chat-v4-exact"),
		).toMatchObject({ count: 1 });
		const assignment = reconciled
			.prepare(
				`SELECT scope.audience_id, scope.projection_json
				 FROM chat_audience_assignment_log log
				 JOIN chat_event_delivery_scope scope
				   ON scope.event_sequence = log.event_sequence
				 WHERE log.chat_id = ?`,
			)
			.get("chat-v4-exact");
		expect(assignment?.audience_id).toBe("aud_exact_owner_v1");
		expect(JSON.parse(String(assignment?.projection_json))).toMatchObject({
			chatId: "chat-v4-exact",
			revision: 2,
		});
		reconciled.close?.();

		const restarted = loadSqliteDb(join(dataDir, "sessions.db"));
		ensureChatCatalogSchema(restarted, "local", {
			audienceMigrationMappings: [
				{
					profileAuthority: LEGACY_PROFILE_AUTHORITY,
					audienceId: "aud_exact_owner_v1",
				},
			],
		});
		expect(
			restarted
				.prepare(
					`SELECT COUNT(*) AS count FROM chat_audience_assignment_log
					 WHERE chat_id = ?`,
				)
				.get("chat-v4-exact"),
		).toMatchObject({ count: 1 });
		restarted.close?.();
	});

	it("quarantines a copied-v4 chat when an exact stamp maps ambiguously", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-v4-ambiguous-"));
		tempDirs.push(dataDir);
		const seed = new SqliteChatCatalogService({ dataDir });
		catalogs.push(seed);
		seed.admitRootSession({
			chatId: "chat-v4-ambiguous",
			sessionId: "session-v4-ambiguous",
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
			metadata: {
				__clineManagedProfileAuthorityV1: LEGACY_PROFILE_AUTHORITY,
			},
			provenance: provenance("seed-v4-ambiguous"),
		});
		seed.close();
		const copied = loadSqliteDb(join(dataDir, "sessions.db"));
		stripAudienceV5Artifacts(copied);
		copied.exec(
			`UPDATE chat_catalog_schema SET version = 4 WHERE singleton = 1;`,
		);
		ensureChatCatalogSchema(copied, "local", {
			audienceMigrationMappings: [
				{
					profileAuthority: LEGACY_PROFILE_AUTHORITY,
					audienceId: "aud_candidate_a",
				},
				{
					profileAuthority: LEGACY_PROFILE_AUTHORITY,
					audienceId: "aud_candidate_b",
				},
			],
		});
		expect(
			copied
				.prepare(
					`SELECT c.audience_id, state.migration_status, state.reason_code
					 FROM chats c JOIN chat_audience_migration_state state
					   ON state.chat_id = c.chat_id WHERE c.chat_id = ?`,
				)
				.get("chat-v4-ambiguous"),
		).toMatchObject({
			audience_id: "audience_unassigned",
			migration_status: "quarantined",
			reason_code: "ambiguous_mapping",
		});
		expect(
			copied
				.prepare(`SELECT COUNT(*) AS count FROM chat_audience_assignment_log`)
				.get(),
		).toMatchObject({ count: 0 });
		copied.close?.();
	});

	it("explicitly assigns a quarantined copied-v4 chat without reviving its writer", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-v4-owner-"));
		tempDirs.push(dataDir);
		const seed = new SqliteChatCatalogService({ dataDir });
		seed.admitRootSession({
			chatId: "chat-v4-owner",
			sessionId: "session-v4-owner",
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
			provenance: provenance("seed-v4-owner"),
		});
		seed.close();

		const copied = loadSqliteDb(join(dataDir, "sessions.db"));
		stripAudienceV5Artifacts(copied);
		copied.exec(
			`UPDATE chat_catalog_schema SET version = 4 WHERE singleton = 1;`,
		);
		ensureChatCatalogSchema(copied);
		expect(
			copied
				.prepare(
					`SELECT migration_status, reason_code
					 FROM chat_audience_migration_state WHERE chat_id = ?`,
				)
				.get("chat-v4-owner"),
		).toMatchObject({
			migration_status: "quarantined",
			reason_code: "malformed_metadata",
		});
		copied.close?.();

		const owner = new SqliteChatCatalogService({ dataDir });
		catalogs.push(owner);
		const inventory = owner.listUnassignedAudienceChats({
			workspaceKey: WORKSPACE_A,
		});
		expect(inventory.items).toEqual([
			expect.objectContaining({
				chatId: "chat-v4-owner",
				revision: 1,
				sessionCount: 1,
			}),
		]);
		expect(owner.getSessionLease("session-v4-owner")).toMatchObject({
			active: false,
			revision: 2,
			writerGeneration: 2,
		});

		const assigned = owner.assignChatAudience({
			chatId: "chat-v4-owner",
			audienceId: "aud_explicit_owner_v1",
			expectedRevision: 1,
			reason: "owner reviewed legacy chat",
			provenance: provenance("assign-v4-owner"),
		});
		expect(assigned).toMatchObject({
			applied: true,
			value: { chatId: "chat-v4-owner", revision: 2 },
		});
		expect(
			owner.listUnassignedAudienceChats({ workspaceKey: WORKSPACE_A }).items,
		).toEqual([]);
		expect(owner.getSessionLease("session-v4-owner")).toMatchObject({
			active: false,
			revision: 2,
			writerGeneration: 2,
		});
		const replay = owner.listAudienceEventsAfter({
			workspaceKey: WORKSPACE_A,
			audienceId: "aud_explicit_owner_v1",
			afterSequence: 0,
		});
		expect(replay.events).toEqual([
			expect.objectContaining({
				sequence: 3,
				eventType: "chat.audience_assigned",
				projection: expect.objectContaining({
					chatId: "chat-v4-owner",
					revision: 2,
				}),
			}),
		]);
		expect(replay.throughSequence).toBe(3);

		const idempotent = owner.assignChatAudience({
			chatId: "chat-v4-owner",
			audienceId: "aud_explicit_owner_v1",
			expectedRevision: 1,
			reason: "owner reviewed legacy chat",
			provenance: provenance("assign-v4-owner"),
		});
		expect(idempotent).toMatchObject({ applied: false });
		expect(owner.listEvents("chat-v4-owner")).toHaveLength(3);
		expect(() =>
			owner.assignChatAudience({
				chatId: "chat-v4-owner",
				audienceId: "aud_other_owner_v1",
				expectedRevision: 2,
				reason: "attempt ownership rewrite",
				provenance: provenance("reassign-v4-owner"),
			}),
		).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
	});

	it("fails closed when CHECK or UNIQUE constraint definitions drift", () => {
		const checkDir = mkdtempSync(join(tmpdir(), "chat-catalog-check-drift-"));
		const uniqueDir = mkdtempSync(join(tmpdir(), "chat-catalog-unique-drift-"));
		tempDirs.push(checkDir, uniqueDir);

		const checkDb = loadSqliteDb(join(checkDir, "sessions.db"));
		ensureSessionSchema(checkDb, { includeLegacyMigrations: true });
		ensureChatCatalogSchema(checkDb);
		checkDb.exec(`DROP TABLE chat_catalog_schema;`);
		checkDb.exec(`CREATE TABLE chat_catalog_schema (
			singleton INTEGER PRIMARY KEY,
			version INTEGER NOT NULL,
			string_decoy TEXT DEFAULT 'CHECK (singleton = 1)',
			comment_decoy TEXT /* CHECK (singleton = 1) */
		);`);
		checkDb.exec(
			`INSERT INTO chat_catalog_schema (singleton, version) VALUES (1, 3);`,
		);
		expectCatalogCode(
			() => ensureChatCatalogSchema(checkDb),
			"unsupported_capability",
		);
		checkDb.close?.();

		const uniqueDb = loadSqliteDb(join(uniqueDir, "sessions.db"));
		ensureSessionSchema(uniqueDb, { includeLegacyMigrations: true });
		ensureChatCatalogSchema(uniqueDb);
		uniqueDb.exec(`DROP TABLE chat_bindings;`);
		uniqueDb.exec(`CREATE TABLE chat_bindings (
			binding_id TEXT PRIMARY KEY,
			transport TEXT NOT NULL,
			instance_id TEXT NOT NULL DEFAULT '',
			channel_id TEXT NOT NULL DEFAULT '',
			thread_id TEXT NOT NULL DEFAULT '',
			participant_scope TEXT NOT NULL DEFAULT '',
			is_bound INTEGER NOT NULL CHECK (is_bound IN (0, 1)),
			chat_id TEXT,
			session_id TEXT,
			revision INTEGER NOT NULL CHECK (revision >= 0),
			updated_at TEXT NOT NULL
		);`);
		uniqueDb.exec(`CREATE INDEX idx_chat_bindings_chat
			ON chat_bindings(chat_id, is_bound);`);
		expectCatalogCode(
			() => ensureChatCatalogSchema(uniqueDb),
			"unsupported_capability",
		);
		uniqueDb.close?.();
	});

	it("serializes concurrent migration and first-tenant provisioning", async () => {
		const migrationDir = mkdtempSync(
			join(tmpdir(), "chat-catalog-concurrent-migration-"),
		);
		const tenantDir = mkdtempSync(
			join(tmpdir(), "chat-catalog-concurrent-tenant-"),
		);
		tempDirs.push(migrationDir, tenantDir);

		const migrationStartAt = Date.now() + 500;
		const migrations = await Promise.all([
			initializeCatalogInChild(migrationDir, "local", migrationStartAt),
			initializeCatalogInChild(migrationDir, "local", migrationStartAt),
		]);
		expect(migrations).toEqual([
			expect.objectContaining({ code: 0 }),
			expect.objectContaining({ code: 0 }),
		]);
		const migratedDb = loadSqliteDb(join(migrationDir, "sessions.db"));
		expect(
			migratedDb
				.prepare(`SELECT version FROM chat_catalog_schema WHERE singleton = 1`)
				.get(),
		).toMatchObject({ version: 5 });
		ensureChatCatalogSchema(migratedDb);
		migratedDb.close?.();

		const tenantStartAt = Date.now() + 500;
		const contenders = await Promise.all([
			initializeCatalogInChild(tenantDir, "tenant-concurrent-a", tenantStartAt),
			initializeCatalogInChild(tenantDir, "tenant-concurrent-b", tenantStartAt),
		]);
		expect(contenders.filter((result) => result.code === 0)).toHaveLength(1);
		expect(contenders.filter((result) => result.code !== 0)).toHaveLength(1);
		expect(contenders.find((result) => result.code !== 0)?.stderr).toContain(
			"database is assigned to another tenant",
		);
		const tenantDb = loadSqliteDb(join(tenantDir, "sessions.db"));
		const owner = tenantDb
			.prepare(`SELECT tenant_id FROM database_tenant WHERE singleton = 1`)
			.get();
		expect(["tenant-concurrent-a", "tenant-concurrent-b"]).toContain(
			String(owner?.tenant_id),
		);
		tenantDb.close?.();
	});

	it("durably assigns a catalog database to one tenant and preserves legacy local ownership", () => {
		expectCatalogCode(
			() => new SqliteChatCatalogService({ tenantId: "tenant-without-path" }),
			"invalid_input",
		);
		expect(
			() => new SqliteSessionStore({ tenantId: "tenant-without-path" }),
		).toThrow();
		const dataDir = mkdtempSync(join(tmpdir(), "chat-catalog-tenant-owner-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		stores.push(store);
		createSession(store, session("session-tenant-owner"));
		const original = new SqliteChatCatalogService({ dataDir });
		catalogs.push(original);
		original.adoptRootSession({
			chatId: "chat-tenant-owner",
			sessionId: "session-tenant-owner",
			provenance: provenance("adopt-tenant-owner"),
		});
		original.close();

		const migrationDb = loadSqliteDb(join(dataDir, "sessions.db"));
		stripAudienceV5Artifacts(migrationDb);
		migrationDb.exec(`DROP TABLE database_tenant;`);
		migrationDb.exec(
			`UPDATE chat_catalog_schema SET version = 1 WHERE singleton = 1;`,
		);
		migrationDb.close?.();

		const attemptedClaim = new SqliteChatCatalogService({
			dataDir,
			tenantId: "tenant-other",
		});
		catalogs.push(attemptedClaim);
		expectCatalogCode(
			() => attemptedClaim.getChat("chat-tenant-owner"),
			"unsupported_capability",
		);
		attemptedClaim.close();
		const rejectedMigrationDb = loadSqliteDb(join(dataDir, "sessions.db"));
		expect(
			rejectedMigrationDb
				.prepare(
					`SELECT name FROM sqlite_master
					 WHERE type = 'table' AND name = 'database_tenant'`,
				)
				.get(),
		).toBeNull();
		expect(
			rejectedMigrationDb
				.prepare(`SELECT version FROM chat_catalog_schema WHERE singleton = 1`)
				.get(),
		).toMatchObject({ version: 1 });
		rejectedMigrationDb.close?.();

		const recovered = new SqliteChatCatalogService({
			dataDir,
			tenantId: "local",
		});
		catalogs.push(recovered);
		expect(recovered.getChat("chat-tenant-owner")).toMatchObject({
			chatId: "chat-tenant-owner",
		});
		recovered.close();
		const verifiedDb = loadSqliteDb(join(dataDir, "sessions.db"));
		expect(
			verifiedDb
				.prepare(`SELECT tenant_id FROM database_tenant WHERE singleton = 1`)
				.get(),
		).toMatchObject({ tenant_id: "local" });
		verifiedDb.close?.();
	});

	it("isolates invocation, binding, purge-attempt, and tombstone identifiers by tenant database", async () => {
		const scope = {
			transport: "slack",
			instanceId: "shared-instance",
			channelId: "shared-channel",
			threadId: "shared-thread",
		};
		for (const tenantId of ["tenant-a", "tenant-b"]) {
			const dataDir = mkdtempSync(join(tmpdir(), `chat-catalog-${tenantId}-`));
			tempDirs.push(dataDir);
			const store = new SqliteSessionStore({ sessionsDir: dataDir, tenantId });
			stores.push(store);
			createSession(store, session("session-shared"));
			const catalog = new SqliteChatCatalogService({
				dataDir,
				tenantId,
				artifactCleanup: {
					cleanupChatArtifacts: async ({ attemptId }) => ({
						receiptId: `${tenantId}:${attemptId}`,
					}),
				},
			});
			catalogs.push(catalog);
			catalog.adoptRootSession({
				chatId: "chat-shared",
				sessionId: "session-shared",
				provenance: provenance("invocation-adopt-shared"),
			});
			catalog.bindChat({
				...scope,
				bindingId: "binding-shared",
				chatId: "chat-shared",
				sessionId: "session-shared",
				expectedBindingRevision: 0,
				provenance: provenance("invocation-bind-shared"),
			});
			catalog.archiveChat({
				chatId: "chat-shared",
				expectedRevision: 1,
				provenance: provenance("invocation-archive-shared"),
			});
			expect(
				await catalog.purgeChat({
					chatId: "chat-shared",
					expectedRevision: 2,
					provenance: provenance("invocation-purge-shared"),
				}),
			).toMatchObject({ purged: true, sessionIds: ["session-shared"] });
			expect(
				catalog.getMutationOutcome("invocation-purge-shared"),
			).toMatchObject({
				operation: "purge_chat",
				applied: true,
			});
			expect(catalog.getBinding(scope)).toMatchObject({
				bindingId: "binding-shared",
				bound: false,
			});
			expect(catalog.isSessionPurged("session-shared")).toBe(true);
			expect(
				store.queryOne(
					`SELECT attempt_id, attempt_state FROM chat_purge_attempts
					 WHERE attempt_id = ?`,
					["invocation-purge-shared"],
				),
			).toMatchObject({
				attempt_id: "invocation-purge-shared",
				attempt_state: "finalized",
			});
			expect(
				store.queryOne(
					`SELECT session_id, purge_state FROM chat_purge_tombstones
					 WHERE session_id = ?`,
					["session-shared"],
				),
			).toMatchObject({ session_id: "session-shared", purge_state: "purged" });
		}

		const tenantADataDir = tempDirs.at(-2);
		if (!tenantADataDir) throw new Error("tenant A fixture was not created");
		const crossTenant = new SqliteChatCatalogService({
			dataDir: tenantADataDir,
			tenantId: "tenant-b",
		});
		catalogs.push(crossTenant);
		expectCatalogCode(
			() => crossTenant.getMutationOutcome("invocation-purge-shared"),
			"unsupported_capability",
		);
		expectCatalogCode(
			() => crossTenant.getMutationOutcome("invocation-purge-shared"),
			"unsupported_capability",
		);
		const crossTenantStore = new SqliteSessionStore({
			sessionsDir: tenantADataDir,
			tenantId: "tenant-b",
		});
		stores.push(crossTenantStore);
		expect(() => crossTenantStore.queryAll(`SELECT * FROM sessions`)).toThrow();
		expect(() => crossTenantStore.queryAll(`SELECT * FROM sessions`)).toThrow();
	});

	it("retains binding revisions so a stale clear cannot erase a newer bind", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-binding"));
		catalog.adoptRootSession({
			chatId: "chat-binding",
			sessionId: "session-binding",
			provenance: provenance("adopt-binding"),
		});
		const scope = {
			transport: "slack",
			instanceId: "workspace-1",
			channelId: "channel-1",
			threadId: "thread-1",
		};
		expect(
			catalog.bindChat({
				...scope,
				bindingId: "binding-1",
				chatId: "chat-binding",
				sessionId: "session-binding",
				expectedBindingRevision: 0,
				provenance: {
					...provenance("bind-1"),
					source: {
						kind: "connector",
						transport: "slack",
						threadId: "thread-1",
						channelId: "channel-1",
					},
				},
			}).value.revision,
		).toBe(1);
		expect(
			catalog.unbindChat({
				...scope,
				expectedBindingId: "binding-1",
				expectedChatId: "chat-binding",
				expectedSessionId: "session-binding",
				expectedBindingRevision: 1,
				provenance: provenance("unbind-1"),
			}).value,
		).toMatchObject({ bound: false, revision: 2 });
		expectCatalogCode(
			() =>
				catalog.bindChat({
					...scope,
					bindingId: "binding-other",
					chatId: "chat-binding",
					sessionId: "session-binding",
					expectedBindingRevision: 2,
					provenance: provenance("bind-wrong-id"),
				}),
			"binding_conflict",
		);
		expect(
			catalog.bindChat({
				...scope,
				bindingId: "binding-1",
				chatId: "chat-binding",
				sessionId: "session-binding",
				expectedBindingRevision: 2,
				provenance: provenance("bind-2"),
			}).value,
		).toMatchObject({ bound: true, revision: 3 });
		expectCatalogCode(
			() =>
				catalog.unbindChat({
					...scope,
					expectedBindingId: "binding-1",
					expectedChatId: "chat-binding",
					expectedSessionId: "session-binding",
					expectedBindingRevision: 1,
					provenance: provenance("stale-unbind"),
				}),
			"revision_conflict",
		);
		expect(catalog.getBinding(scope)).toMatchObject({
			bound: true,
			revision: 3,
		});
		expect(
			catalog
				.listEvents("chat-binding")
				.filter((event) => event.aggregateKind === "binding")
				.map((event) => ({
					type: event.eventType,
					id: event.aggregateId,
					previous: event.previousRevision,
					resulting: event.resultingRevision,
				})),
		).toEqual([
			{ type: "chat.bound", id: "binding-1", previous: 0, resulting: 1 },
			{ type: "chat.unbound", id: "binding-1", previous: 1, resulting: 2 },
			{ type: "chat.bound", id: "binding-1", previous: 2, resulting: 3 },
		]);
		expect(
			catalog
				.listEvents("chat-binding")
				.find((event) => event.invocationId === "bind-1"),
		).toMatchObject({
			sourceKind: "connector",
			transport: "slack",
			threadId: "thread-1",
			channelId: "channel-1",
		});
	});

	it("grants one live writer lease and allows CAS takeover after expiry", () => {
		const { dataDir, store, catalog } = fixture();
		catalog.close();
		let authorityNow = new Date("2026-08-14T10:00:00.000Z");
		const clock = () => new Date(authorityNow);
		const authority = new SqliteChatCatalogService({ dataDir, clock });
		const contender = new SqliteChatCatalogService({ dataDir, clock });
		catalogs.push(authority);
		catalogs.push(contender);
		createSession(store, session("session-lease"));
		authority.adoptRootSession({
			chatId: "chat-lease",
			sessionId: "session-lease",
			provenance: provenance("adopt-lease"),
		});
		const firstGrant = authority.acquireSessionLease({
			sessionId: "session-lease",
			expectedRevision: 0,
			ttlMs: 300_000,
			provenance: provenance(
				"lease-a",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-a",
			),
		});
		expect(firstGrant.value).toMatchObject({
			ownerId: "owner-a",
			active: true,
			revision: 1,
		});
		expect(firstGrant.leaseToken).toBeTruthy();
		expect(
			store.queryOne(
				`SELECT commit_sequence, lease_revision FROM session_writer_heads
				 WHERE session_id = ?`,
				["session-lease"],
			),
		).toMatchObject({ commit_sequence: 0, lease_revision: 1 });
		expect(firstGrant.value).not.toHaveProperty("leaseToken");
		expect(authority.getSessionLease("session-lease")).not.toHaveProperty(
			"leaseToken",
		);
		const renewed = authority.renewSessionLease({
			sessionId: "session-lease",
			leaseToken: firstGrant.leaseToken ?? "",
			expectedRevision: 1,
			ttlMs: 300_000,
			provenance: provenance(
				"renew-lease-a",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-a",
			),
		});
		expect(renewed.value).toMatchObject({
			ownerId: "owner-a",
			active: true,
			revision: 2,
		});
		expect(
			authority.verifySessionLease({
				sessionId: "session-lease",
				leaseToken: firstGrant.leaseToken ?? "",
				expectedRevision: 2,
			}),
		).toMatchObject({ active: true, revision: 2 });
		expectCatalogCode(
			() =>
				authority.verifySessionLease({
					sessionId: "session-lease",
					leaseToken: firstGrant.leaseToken ?? "",
					expectedRevision: 1,
				}),
			"lease_conflict",
		);
		expectCatalogCode(
			() =>
				authority.acquireSessionLease({
					sessionId: "session-lease",
					expectedRevision: 2,
					ttlMs: 300_001,
					provenance: provenance("lease-too-long"),
				}),
			"invalid_input",
		);
		expectCatalogCode(
			() =>
				contender.acquireSessionLease({
					sessionId: "session-lease",
					expectedRevision: 2,
					ttlMs: 300_000,
					provenance: provenance(
						"lease-b-blocked",
						"2026-08-14T10:01:00.000Z",
						"human",
						"owner-b",
					),
				}),
			"lease_conflict",
		);
		authorityNow = new Date("2026-08-14T10:05:01.000Z");
		const secondGrant = contender.acquireSessionLease({
			sessionId: "session-lease",
			expectedRevision: 2,
			ttlMs: 299_000,
			provenance: provenance(
				"lease-b-takeover",
				"2026-08-14T10:05:01.000Z",
				"human",
				"owner-b",
			),
		});
		expect(secondGrant.value).toMatchObject({
			ownerId: "owner-b",
			active: true,
			revision: 3,
		});
		expectCatalogCode(
			() =>
				authority.releaseSessionLease({
					sessionId: "session-lease",
					leaseToken: firstGrant.leaseToken ?? "",
					expectedRevision: 2,
					provenance: provenance(
						"stale-release-a",
						"2026-08-14T10:05:01.000Z",
						"human",
						"owner-a",
					),
				}),
			"lease_conflict",
		);
		expect(
			contender.releaseSessionLease({
				sessionId: "session-lease",
				leaseToken: secondGrant.leaseToken ?? "",
				expectedRevision: 3,
				provenance: provenance(
					"release-b",
					"2026-08-14T10:05:01.000Z",
					"human",
					"owner-b",
				),
			}).value,
		).toMatchObject({ ownerId: "owner-b", active: false, revision: 4 });
	});

	it("atomically rekeys a live writer lease and replays its in-process credential", () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-rekey"));
		catalog.adoptRootSession({
			chatId: "chat-rekey",
			sessionId: "session-rekey",
			provenance: provenance("adopt-rekey"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "session-rekey",
			expectedRevision: 0,
			provenance: provenance(
				"acquire-rekey",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-rekey",
			),
		});
		const oldToken = acquired.leaseToken ?? "";
		const input = {
			sessionId: "session-rekey",
			leaseToken: oldToken,
			expectedRevision: 1,
			expectedWriterGeneration: 1,
			provenance: provenance(
				"rekey-live-writer",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-rekey",
			),
		};

		const rekeyed = catalog.rekeySessionLease(input);

		expect(rekeyed).toMatchObject({
			applied: true,
			value: {
				active: true,
				revision: 2,
				writerGeneration: 2,
			},
		});
		expect(rekeyed.leaseToken).toBeTruthy();
		expect(rekeyed.leaseToken).not.toBe(oldToken);
		expect(
			catalog.verifySessionLease({
				sessionId: "session-rekey",
				leaseToken: rekeyed.leaseToken,
				expectedRevision: 2,
			}),
		).toMatchObject({ writerGeneration: 2 });
		expectCatalogCode(
			() =>
				catalog.verifySessionLease({
					sessionId: "session-rekey",
					leaseToken: oldToken,
					expectedRevision: 2,
				}),
			"lease_conflict",
		);
		expect(
			store.queryOne(
				`SELECT commit_sequence, lease_revision, writer_generation
				 FROM session_writer_heads WHERE session_id = ?`,
				["session-rekey"],
			),
		).toMatchObject({
			commit_sequence: 0,
			lease_revision: 2,
			writer_generation: 2,
		});
		const replay = catalog.rekeySessionLease(input);
		expect(replay).toMatchObject({
			applied: false,
			value: { revision: 2, writerGeneration: 2 },
			leaseToken: rekeyed.leaseToken,
		});
		expectCatalogCode(
			() =>
				catalog.rekeySessionLease({
					...input,
					expectedWriterGeneration: 2,
				}),
			"invocation_replay_conflict",
		);
		expect(
			catalog
				.listEvents("chat-rekey")
				.find((event) => event.eventType === "session.lease_rekeyed"),
		).toMatchObject({
			aggregateKind: "lease",
			aggregateId: "session-rekey",
			previousRevision: 1,
			resultingRevision: 2,
			payload: { writerGeneration: 2 },
		});
		expect(JSON.stringify(catalog.listEvents("chat-rekey"))).not.toContain(
			rekeyed.leaseToken,
		);

		catalog.close();
		const reopened = new SqliteChatCatalogService({ dataDir });
		catalogs.push(reopened);
		expectCatalogCode(
			() => reopened.rekeySessionLease(input),
			"lease_conflict",
		);
		expect(
			reopened.verifySessionLease({
				sessionId: "session-rekey",
				leaseToken: rekeyed.leaseToken,
				expectedRevision: 2,
			}),
		).toMatchObject({ writerGeneration: 2 });
	});

	it("revokes a lost lease credential without making tokens recoverable", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-lost-token"));
		catalog.adoptRootSession({
			chatId: "chat-lost-token",
			sessionId: "session-lost-token",
			provenance: provenance("adopt-lost-token"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "session-lost-token",
			expectedRevision: 0,
			provenance: provenance(
				"acquire-lost-token",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-lost-token",
			),
		});
		const oldToken = acquired.leaseToken ?? "";
		expect(oldToken).toBeTruthy();
		const acquireReplay = catalog.acquireSessionLease({
			sessionId: "session-lost-token",
			expectedRevision: 0,
			provenance: provenance(
				"acquire-lost-token",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-lost-token",
			),
		});
		expect(acquireReplay).toMatchObject({
			applied: false,
			value: { active: true, revision: 1 },
		});
		expect(acquireReplay.leaseToken).toBeUndefined();
		expectCatalogCode(
			() =>
				catalog.revokeSessionLease({
					sessionId: "session-lost-token",
					expectedRevision: 1,
					provenance: provenance(
						"system-revoke-lost-token",
						"2026-08-14T10:00:00.000Z",
						"system",
						"owner-lost-token",
					),
				}),
			"invalid_input",
		);
		expectCatalogCode(
			() =>
				catalog.revokeSessionLease({
					sessionId: "session-lost-token",
					expectedRevision: 1,
					provenance: provenance(
						"wrong-owner-revoke-lost-token",
						"2026-08-14T10:00:00.000Z",
						"human",
						"other-owner",
					),
				}),
			"lease_conflict",
		);
		const revokeInput = {
			sessionId: "session-lost-token",
			expectedRevision: 1,
			provenance: provenance(
				"revoke-lost-token",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-lost-token",
			),
		};
		expect(catalog.revokeSessionLease(revokeInput)).toMatchObject({
			applied: true,
			value: { active: false, revision: 2 },
		});
		expect(catalog.revokeSessionLease(revokeInput)).toMatchObject({
			applied: false,
			value: { active: false, revision: 2 },
		});
		const replacement = catalog.acquireSessionLease({
			sessionId: "session-lost-token",
			expectedRevision: 2,
			provenance: provenance(
				"replace-lost-token",
				"2026-08-14T10:00:00.000Z",
				"human",
				"owner-lost-token",
			),
		});
		expect(replacement.value).toMatchObject({ active: true, revision: 3 });
		expect(replacement.leaseToken).not.toBe(oldToken);
		expectCatalogCode(
			() =>
				catalog.releaseSessionLease({
					sessionId: "session-lost-token",
					leaseToken: oldToken,
					expectedRevision: 3,
					provenance: provenance(
						"release-old-lost-token",
						"2026-08-14T10:00:00.000Z",
						"human",
						"owner-lost-token",
					),
				}),
			"lease_conflict",
		);
		expect(
			catalog
				.listEvents("chat-lost-token")
				.find((event) => event.eventType === "session.lease_revoked"),
		).toMatchObject({
			aggregateKind: "lease",
			aggregateId: "session-lost-token",
			previousRevision: 1,
			resultingRevision: 2,
		});
	});

	it("appends recovery successors, advances activity, and guards every member and lease", () => {
		const { dataDir, store, catalog } = fixture();
		catalog.close();
		const authorityNow = new Date("2026-08-14T11:00:00.000Z");
		const authority = new SqliteChatCatalogService({
			dataDir,
			clock: () => new Date(authorityNow),
		});
		catalogs.push(authority);
		createSession(store, session("session-root"), "2026-08-14T09:01:00.000Z");
		createSession(
			store,
			session("session-recovery"),
			"2026-08-14T09:05:00.000Z",
		);
		authority.adoptRootSession({
			chatId: "chat-recovery",
			sessionId: "session-root",
			provenance: provenance("adopt-recovery-root"),
		});
		const attached = authority.attachSuccessorSession({
			chatId: "chat-recovery",
			sessionId: "session-recovery",
			parentSessionId: "session-root",
			relationKind: "recovery",
			expectedRevision: 1,
			provenance: provenance("attach-recovery"),
		});
		expect(attached.value).toMatchObject({
			headSessionId: "session-recovery",
			lastActivityAt: "2026-08-14T09:05:00.000Z",
			revision: 2,
			sessions: [
				{ sessionId: "session-root", ordinal: 0, relationKind: "root" },
				{
					sessionId: "session-recovery",
					parentSessionId: "session-root",
					ordinal: 1,
					relationKind: "recovery",
				},
			],
		});
		store.update({
			sessionId: "session-recovery",
			updatedAt: "2026-08-14T09:10:00.000Z",
		});
		expect(
			authority.recordChatActivity({
				chatId: "chat-recovery",
				sessionId: "session-recovery",
				expectedRevision: 2,
				provenance: provenance("record-recovery-activity"),
			}).value,
		).toMatchObject({
			lastActivityAt: "2026-08-14T09:10:00.000Z",
			revision: 3,
			catalogState: "active",
		});

		store.update({ sessionId: "session-root", status: "running" });
		expectCatalogCode(
			() =>
				authority.archiveChat({
					chatId: "chat-recovery",
					expectedRevision: 3,
					provenance: provenance("archive-running-member"),
				}),
			"chat_running",
		);
		store.update({ sessionId: "session-root", status: "completed" });
		const grant = authority.acquireSessionLease({
			sessionId: "session-recovery",
			expectedRevision: 0,
			provenance: provenance(
				"lease-recovery",
				"2026-08-14T11:00:00.000Z",
				"human",
				"owner-recovery",
			),
		});
		expectCatalogCode(
			() =>
				authority.archiveChat({
					chatId: "chat-recovery",
					expectedRevision: 3,
					provenance: provenance("archive-live-lease"),
				}),
			"lease_conflict",
		);
		authority.releaseSessionLease({
			sessionId: "session-recovery",
			leaseToken: grant.leaseToken ?? "",
			expectedRevision: 1,
			provenance: provenance(
				"release-recovery",
				"2026-08-14T11:00:00.000Z",
				"human",
				"owner-recovery",
			),
		});
		expect(
			authority.archiveChat({
				chatId: "chat-recovery",
				expectedRevision: 3,
				provenance: provenance("archive-recovery"),
			}).value,
		).toMatchObject({ catalogState: "archived", revision: 4 });
	});

	it("retains failed cleanup evidence and finalizes only with a cleanup receipt", async () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-source"));
		createSession(store, session("session-branch"));
		createSession(store, session("session-deleting-branch"));
		catalog.adoptRootSession({
			chatId: "chat-source",
			sessionId: "session-source",
			provenance: provenance("adopt-source"),
		});
		catalog.recordBranch({
			chatId: "chat-branch",
			sessionId: "session-branch",
			sourceChatId: "chat-source",
			sourceSessionId: "session-source",
			relationKind: "fork",
			provenance: provenance("fork-branch"),
		});
		const purgeBindingScope = {
			transport: "slack",
			instanceId: "workspace-1",
			channelId: "channel-purge",
			threadId: "thread-purge",
		};
		catalog.bindChat({
			...purgeBindingScope,
			bindingId: "binding-purge",
			chatId: "chat-source",
			sessionId: "session-source",
			expectedBindingRevision: 0,
			provenance: provenance("bind-source"),
		});
		catalog.archiveChat({
			chatId: "chat-source",
			expectedRevision: 1,
			provenance: provenance("archive-source"),
		});
		const purgeInput = {
			chatId: "chat-source",
			expectedRevision: 2,
			provenance: provenance("purge-source"),
		};
		await expect(catalog.purgeChat(purgeInput)).rejects.toMatchObject({
			code: "unsupported_capability",
		});
		expect(catalog.getChat("chat-source")).toMatchObject({
			catalogState: "archived",
			revision: 2,
		});
		catalog.close();
		let cleanupAttempts = 0;
		const artifactCleanup = {
			cleanupChatArtifacts: async (input: {
				chatId: string;
				sessionIds: string[];
				attemptId: string;
			}) => {
				cleanupAttempts += 1;
				if (cleanupAttempts === 1) throw new Error("simulated cleanup failure");
				return {
					receiptId: `${input.attemptId}:${input.chatId}:${input.sessionIds.join(",")}`,
				};
			},
		};
		const failedCatalog = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup,
		});
		catalogs.push(failedCatalog);
		await expect(failedCatalog.purgeChat(purgeInput)).rejects.toMatchObject({
			code: "purge_cleanup_failed",
		});
		failedCatalog.close();
		const recoveredCatalog = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup,
		});
		catalogs.push(recoveredCatalog);
		expect(recoveredCatalog.isSessionTombstoned("session-source")).toBe(true);
		expect(recoveredCatalog.isSessionPurged("session-source")).toBe(false);
		expect(recoveredCatalog.getBinding(purgeBindingScope)).toMatchObject({
			bound: false,
			revision: 2,
		});
		expectCatalogCode(
			() =>
				recoveredCatalog.recordBranch({
					chatId: "chat-from-deleting",
					sessionId: "session-deleting-branch",
					sourceChatId: "chat-source",
					sourceSessionId: "session-source",
					relationKind: "fork",
					provenance: provenance("fork-from-deleting"),
				}),
			"chat_deleting",
		);
		expectCatalogCode(
			() =>
				recoveredCatalog.adoptRootSession({
					chatId: "chat-resurrecting-during-cleanup",
					sessionId: "session-source",
					provenance: provenance("resurrect-during-cleanup"),
				}),
			"session_purged",
		);
		expect(await recoveredCatalog.purgeChat(purgeInput)).toMatchObject({
			applied: true,
			purged: true,
			sessionIds: ["session-source"],
		});
		expect(await recoveredCatalog.purgeChat(purgeInput)).toMatchObject({
			applied: false,
			purged: true,
			sessionIds: ["session-source"],
		});
		expect(recoveredCatalog.getChat("chat-source")).toBeUndefined();
		expect(recoveredCatalog.getChat("chat-branch")).toMatchObject({
			parentChatId: "chat-source",
		});
		expect(recoveredCatalog.isSessionPurged("session-source")).toBe(true);
		expectCatalogCode(
			() =>
				recoveredCatalog.adoptRootSession({
					chatId: "chat-resurrected",
					sessionId: "session-source",
					provenance: provenance("resurrect-source"),
				}),
			"session_purged",
		);
		expect(
			recoveredCatalog
				.listEvents("chat-source")
				.map((event) => event.eventType),
		).toEqual([
			"chat.created",
			"chat.bound",
			"chat.archived",
			"binding.cleared_for_purge",
			"chat.deleting",
			"purge.cleanup_started",
			"chat.purge_cleanup_failed",
			"purge.cleanup_started",
			"purge.cleanup_succeeded",
			"chat.purged",
			"purge.finalized",
		]);
	});

	it("claims one live purge cleanup attempt across concurrent retries", async () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-concurrent-purge"));
		catalog.adoptRootSession({
			chatId: "chat-concurrent-purge",
			sessionId: "session-concurrent-purge",
			provenance: provenance("adopt-concurrent-purge"),
		});
		catalog.archiveChat({
			chatId: "chat-concurrent-purge",
			expectedRevision: 1,
			provenance: provenance("archive-concurrent-purge"),
		});
		catalog.close();

		let cleanupCalls = 0;
		let finishCleanup: ((value: { receiptId: string }) => void) | undefined;
		const cleanupPending = new Promise<{ receiptId: string }>((resolve) => {
			finishCleanup = resolve;
		});
		const artifactCleanup = {
			cleanupChatArtifacts: async () => {
				cleanupCalls += 1;
				return cleanupPending;
			},
		};
		let authorityNow = new Date("2026-08-14T10:00:00.000Z");
		const clock = () => new Date(authorityNow);
		const purgeCatalog = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup,
			clock,
			purgeAttemptStaleMs: 30,
			purgeAttemptHeartbeatMs: 5,
		});
		const retryCatalog = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup,
			clock,
			purgeAttemptStaleMs: 30,
			purgeAttemptHeartbeatMs: 5,
		});
		catalogs.push(purgeCatalog, retryCatalog);
		const input = {
			chatId: "chat-concurrent-purge",
			expectedRevision: 2,
			provenance: provenance("purge-concurrent"),
		};
		const first = purgeCatalog.purgeChat(input);
		expect(cleanupCalls).toBe(1);
		authorityNow = new Date("2026-08-14T10:01:00.000Z");
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
		await expect(retryCatalog.purgeChat(input)).rejects.toMatchObject({
			code: "chat_deleting",
		});
		expect(cleanupCalls).toBe(1);
		expect(
			purgeCatalog
				.listEvents("chat-concurrent-purge")
				.some((event) => event.eventType === "purge.cleanup_heartbeat"),
		).toBe(true);
		finishCleanup?.({ receiptId: "cleanup-concurrent" });
		await expect(first).resolves.toMatchObject({
			applied: true,
			purged: true,
		});
		expect(cleanupCalls).toBe(1);
	});

	it("aborts cleanup and disposes renewal when heartbeat fencing is lost", async () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-purge-fence-loss"));
		catalog.adoptRootSession({
			chatId: "chat-purge-fence-loss",
			sessionId: "session-purge-fence-loss",
			provenance: provenance("adopt-purge-fence-loss"),
		});
		catalog.archiveChat({
			chatId: "chat-purge-fence-loss",
			expectedRevision: 1,
			provenance: provenance("archive-purge-fence-loss"),
		});
		catalog.close();

		let aborted = false;
		const fencedCatalog = new SqliteChatCatalogService({
			dataDir,
			purgeAttemptStaleMs: 30,
			purgeAttemptHeartbeatMs: 5,
			artifactCleanup: {
				cleanupChatArtifacts: async ({ signal }) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => {
								aborted = true;
								reject(signal.reason);
							},
							{ once: true },
						);
					}),
			},
		});
		catalogs.push(fencedCatalog);
		const purge = fencedCatalog.purgeChat({
			chatId: "chat-purge-fence-loss",
			expectedRevision: 2,
			provenance: provenance("purge-fence-loss"),
		});
		const competingDb = loadSqliteDb(join(dataDir, "sessions.db"));
		try {
			competingDb
				.prepare(
					`UPDATE chat_purge_attempts SET revision = revision + 1
					 WHERE attempt_id = ?`,
				)
				.run("purge-fence-loss");
		} finally {
			competingDb.close?.();
		}
		await expect(purge).rejects.toMatchObject({ code: "purge_cleanup_failed" });
		expect(aborted).toBe(true);
		const afterAbort = store.queryOne(
			`SELECT revision FROM chat_purge_attempts WHERE attempt_id = ?`,
			["purge-fence-loss"],
		);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
		expect(
			store.queryOne(
				`SELECT revision FROM chat_purge_attempts WHERE attempt_id = ?`,
				["purge-fence-loss"],
			),
		).toEqual(afterAbort);
	});

	it("reads only immutable workspace-scoped event metadata while advancing across foreign and legacy rows", () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-events-a", WORKSPACE_A));
		createSession(store, session("session-events-b", WORKSPACE_B));
		catalog.adoptRootSession({
			chatId: "chat-events-a",
			sessionId: "session-events-a",
			provenance: {
				...provenance("adopt-events-a"),
				actor: { kind: "human" as const, id: "private-actor-a" },
				source: {
					kind: "connector" as const,
					transport: "private-transport",
					threadId: "private-thread",
				},
			},
		});
		catalog.adoptRootSession({
			chatId: "chat-events-b",
			sessionId: "session-events-b",
			provenance: provenance("adopt-events-b"),
		});

		const first = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: 0,
			limit: 1,
		});
		expect(first.events).toHaveLength(1);
		expect(first.events[0]).toMatchObject({
			chatId: "chat-events-a",
			eventType: "chat.created",
			relatedSessionIds: ["session-events-a"],
		});
		expect(first.throughSequence).toBe(catalog.currentEventSequence());
		expect(first.hasMore).toBe(false);
		const serialized = JSON.stringify(first);
		expect(serialized).not.toContain("private-actor-a");
		expect(serialized).not.toContain("private-transport");
		expect(serialized).not.toContain("private-thread");
		expect(serialized).not.toContain("invocationId");
		expect(serialized).not.toContain("payload");

		const db = loadSqliteDb(join(dataDir, "sessions.db"));
		try {
			db.prepare(
				`INSERT INTO chat_events (
					event_id, chat_id, event_type, aggregate_kind, aggregate_id,
					invocation_id, actor_kind, actor_id, source_kind, transport,
					thread_id, channel_id, previous_revision, resulting_revision,
					payload_json, occurred_at
				 ) VALUES (?, ?, ?, 'chat', ?, ?, 'system', NULL, 'system',
				           NULL, NULL, NULL, 0, 0, '{}', ?)`,
			).run(
				"legacy-unscoped-event",
				"chat-events-a",
				"chat.legacy_unscoped",
				"chat-events-a",
				"legacy-unscoped-invocation",
				"2026-08-14T10:01:00.000Z",
			);
		} finally {
			db.close?.();
		}
		const afterLegacy = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: first.throughSequence,
		});
		expect(afterLegacy.events).toEqual([]);
		expect(afterLegacy.throughSequence).toBe(catalog.currentEventSequence());
	});

	it("observes committed events from an independent catalog connection", () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-cross-connection-events"));
		catalog.adoptRootSession({
			chatId: "chat-cross-connection-events",
			sessionId: "session-cross-connection-events",
			provenance: provenance("adopt-cross-connection-events"),
		});
		const reader = new SqliteChatCatalogService({ dataDir });
		catalogs.push(reader);
		const liveCut = reader.currentEventSequence();
		catalog.renameChat({
			chatId: "chat-cross-connection-events",
			title: "Observed across connections",
			expectedRevision: 1,
			provenance: provenance("rename-cross-connection-events"),
		});
		const page = reader.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: liveCut,
		});
		expect(page.events).toHaveLength(1);
		expect(page.events[0]).toMatchObject({
			chatId: "chat-cross-connection-events",
			eventType: "chat.renamed",
			previousRevision: 1,
			resultingRevision: 2,
		});
		expect(page.throughSequence).toBe(reader.currentEventSequence());
	});

	it("retains event-time session membership and pages in strict sequence order", () => {
		const { store, catalog } = fixture();
		createSession(store, session("session-snapshot-root"));
		catalog.adoptRootSession({
			chatId: "chat-snapshot",
			sessionId: "session-snapshot-root",
			provenance: provenance("adopt-snapshot-root"),
		});
		createSession(store, session("session-snapshot-next"));
		catalog.attachSuccessorSession({
			chatId: "chat-snapshot",
			sessionId: "session-snapshot-next",
			parentSessionId: "session-snapshot-root",
			relationKind: "recovery",
			expectedRevision: 1,
			provenance: provenance("attach-snapshot-next"),
		});
		catalog.renameChat({
			chatId: "chat-snapshot",
			title: "Snapshot renamed",
			expectedRevision: 2,
			provenance: provenance("rename-snapshot"),
		});

		const first = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: 0,
			limit: 2,
		});
		expect(first.events.map((event) => event.sequence)).toEqual(
			[...first.events.map((event) => event.sequence)].sort((a, b) => a - b),
		);
		expect(first.events[0]?.relatedSessionIds).toEqual([
			"session-snapshot-root",
		]);
		expect(first.hasMore).toBe(true);
		const second = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: first.throughSequence,
			limit: 2,
		});
		const combined = [...first.events, ...second.events];
		expect(new Set(combined.map((event) => event.eventId)).size).toBe(
			combined.length,
		);
		expect(combined.at(-1)?.relatedSessionIds).toEqual([
			"session-snapshot-root",
			"session-snapshot-next",
		]);
		expect(second.hasMore).toBe(false);
	});

	it("keeps final purge events in their original workspace when a chat id is reused", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "chat-event-reuse-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		stores.push(store);
		const catalog = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup: {
				cleanupChatArtifacts: async () => ({
					receiptId: "purge-reuse-receipt",
				}),
			},
		});
		catalogs.push(catalog);
		createSession(store, session("session-reused-old", WORKSPACE_A));
		catalog.adoptRootSession({
			chatId: "chat-reused",
			sessionId: "session-reused-old",
			provenance: provenance("adopt-reused-old"),
		});
		catalog.archiveChat({
			chatId: "chat-reused",
			expectedRevision: 1,
			provenance: provenance("archive-reused-old"),
		});
		await catalog.purgeChat({
			chatId: "chat-reused",
			expectedRevision: 2,
			provenance: provenance("purge-reused-old"),
		});
		const oldHighWater = catalog.currentEventSequence();
		const oldEvents = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: 0,
		});
		expect(oldEvents.events.map((event) => event.eventType)).toContain(
			"chat.purged",
		);
		expect(oldEvents.events.map((event) => event.eventType)).toContain(
			"purge.finalized",
		);

		createSession(store, session("session-reused-new", WORKSPACE_B));
		catalog.adoptRootSession({
			chatId: "chat-reused",
			sessionId: "session-reused-new",
			provenance: provenance("adopt-reused-new"),
		});
		const newWorkspaceEvents = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_B,
			afterSequence: 0,
		});
		expect(newWorkspaceEvents.events).toHaveLength(1);
		expect(newWorkspaceEvents.events[0]).toMatchObject({
			eventType: "chat.created",
			relatedSessionIds: ["session-reused-new"],
		});
		const oldWorkspaceTail = catalog.listWorkspaceEventsAfter({
			workspaceKey: WORKSPACE_A,
			afterSequence: oldHighWater,
		});
		expect(oldWorkspaceTail.events).toEqual([]);
		expect(oldWorkspaceTail.throughSequence).toBe(
			catalog.currentEventSequence(),
		);
	});

	it("prevents purge receipt and finalization after authority revocation", async () => {
		const { dataDir, store, catalog } = fixture();
		createSession(store, session("session-purge-authority-loss"));
		catalog.adoptRootSession({
			chatId: "chat-purge-authority-loss",
			sessionId: "session-purge-authority-loss",
			provenance: provenance("adopt-purge-authority-loss"),
		});
		catalog.archiveChat({
			chatId: "chat-purge-authority-loss",
			expectedRevision: 1,
			provenance: provenance("archive-purge-authority-loss"),
		});
		catalog.close();

		const controller = new AbortController();
		const revoked = new Error("workspace revoked after cleanup");
		const purgeCatalog = new SqliteChatCatalogService({
			dataDir,
			artifactCleanup: {
				cleanupChatArtifacts: async () => {
					controller.abort(revoked);
					return { receiptId: "cleanup-complete-before-revocation" };
				},
			},
		});
		catalogs.push(purgeCatalog);
		await expect(
			purgeCatalog.purgeChat(
				{
					chatId: "chat-purge-authority-loss",
					expectedRevision: 2,
					provenance: provenance("purge-authority-loss"),
				},
				{
					signal: controller.signal,
					assertActive: () => controller.signal.throwIfAborted(),
				},
			),
		).rejects.toBe(revoked);
		expect(purgeCatalog.getChat("chat-purge-authority-loss")).toMatchObject({
			catalogState: "deleting",
			revision: 3,
		});
		const eventTypes = purgeCatalog
			.listEvents("chat-purge-authority-loss")
			.map((event) => event.eventType);
		expect(eventTypes).toContain("purge.cleanup_started");
		expect(eventTypes).not.toContain("purge.cleanup_succeeded");
		expect(eventTypes).not.toContain("chat.purged");
	});
});
