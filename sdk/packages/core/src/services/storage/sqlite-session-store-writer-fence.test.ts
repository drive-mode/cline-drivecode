import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteChatCatalogService } from "../../chat-catalog/sqlite-chat-catalog-service";
import { SessionManualCompactionOperationConflictError } from "../../session/models/session-manual-compaction-operation";
import { SessionWriterFenceRejectedError } from "../../session/writer-fence";
import { SessionSource } from "../../types/common";
import type { SessionRecord } from "../../types/sessions";
import { SqliteSessionStore } from "./sqlite-session-store";

const WORKSPACE = resolve("/tmp/session-writer-fence-workspace");

function session(sessionId: string): SessionRecord {
	return {
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		startedAt: "2026-08-14T09:00:00.000Z",
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

function provenance(invocationId: string, occurredAt: string, ownerId: string) {
	return {
		invocationId,
		actor: { kind: "human" as const, id: ownerId },
		source: { kind: "interactive" as const, transport: "cli" },
		occurredAt,
	};
}

describe("SqliteSessionStore catalog writer fence", () => {
	const cleanup: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of cleanup.splice(0).reverse()) dispose();
	});

	it("rejects direct, expired, superseded-token, and wrong-generation commits", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "session-writer-fence-"));
		let now = new Date("2026-08-14T10:00:00.000Z");
		const clock = () => new Date(now);
		const store = new SqliteSessionStore({ sessionsDir: dataDir, clock });
		store.create(session("managed"));
		const catalog = new SqliteChatCatalogService({ dataDir, clock });
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		catalog.adoptRootSession({
			chatId: "chat-managed",
			sessionId: "managed",
			provenance: provenance("adopt", now.toISOString(), "owner-a"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "managed",
			expectedRevision: 0,
			ttlMs: 5_000,
			provenance: provenance("acquire", now.toISOString(), "owner-a"),
		});
		const token = acquired.leaseToken ?? "";
		expect(store.isCatalogManaged("managed")).toBe(true);
		expect(() =>
			store.create({ ...session("managed"), provider: "bypass-provider" }),
		).toThrow(SessionWriterFenceRejectedError);
		expect(() =>
			store.update({ sessionId: "managed", status: "running" }),
		).toThrow(SessionWriterFenceRejectedError);
		expect(() => store.updateStatus("managed", "failed", 1)).toThrow(
			SessionWriterFenceRejectedError,
		);
		expect(() => store.delete("managed")).toThrow(
			SessionWriterFenceRejectedError,
		);
		expect(() =>
			store.runAuxiliaryMutation(
				`UPDATE sessions SET status = 'failed' WHERE session_id = ?`,
				["managed"],
			),
		).toThrow("raw session-table mutations are forbidden");
		expect(() =>
			store.queryOne(
				`UPDATE sessions SET status = 'failed' WHERE session_id = ? RETURNING session_id`,
				["managed"],
			),
		).toThrow("query APIs accept SELECT statements only");
		expect(() =>
			store.queryAll(
				`DELETE FROM sessions WHERE session_id = ? RETURNING session_id`,
				["managed"],
			),
		).toThrow("query APIs accept SELECT statements only");
		expect(store.get("managed")).toMatchObject({
			provider: "test-provider",
			status: "completed",
		});

		expect("runSessionWriterMutation" in store).toBe(false);
		store.create(session("decoy"));
		expect(() =>
			store.updatePersistedSession({
				sessionId: "decoy",
				status: "failed",
				writerFence: {
					leaseToken: token,
					revision: 1,
					writerGeneration: acquired.value.writerGeneration,
					expiresAt: acquired.value.expiresAt,
				},
			}),
		).toThrow(SessionWriterFenceRejectedError);
		expect(store.get("managed")?.status).toBe("completed");

		expect(
			store.commitCatalogManagedArtifact({
				sessionId: "managed",
				kind: "messages",
				path: "/tmp/messages-generation-1.json",
				writerFence: {
					leaseToken: token,
					revision: 1,
					writerGeneration: acquired.value.writerGeneration,
					expiresAt: acquired.value.expiresAt,
				},
			}),
		).toMatchObject({
			commitSequence: 1,
			leaseRevision: 1,
			writerGeneration: 1,
			messagesPath: "/tmp/messages-generation-1.json",
		});

		const renewed = catalog.renewSessionLease({
			sessionId: "managed",
			leaseToken: token,
			expectedRevision: 1,
			ttlMs: 5_000,
			provenance: provenance("renew", now.toISOString(), "owner-a"),
		});
		expect(() =>
			store.commitCatalogManagedArtifact({
				sessionId: "managed",
				kind: "compaction",
				path: "/tmp/stale-generation.json",
				writerFence: {
					leaseToken: token,
					revision: renewed.value.revision,
					writerGeneration: acquired.value.writerGeneration + 1,
					expiresAt: renewed.value.expiresAt,
				},
			}),
		).toThrow(SessionWriterFenceRejectedError);
		expect(
			store.commitCatalogManagedArtifact({
				sessionId: "managed",
				kind: "compaction",
				path: "/tmp/compaction-generation-2.json",
				writerFence: {
					leaseToken: token,
					revision: 2,
					writerGeneration: renewed.value.writerGeneration,
					expiresAt: renewed.value.expiresAt,
				},
			}),
		).toMatchObject({
			commitSequence: 2,
			leaseRevision: 2,
			writerGeneration: 1,
		});

		now = new Date("2026-08-14T10:00:06.000Z");
		expect(() =>
			store.commitCatalogManagedArtifact({
				sessionId: "managed",
				kind: "messages",
				path: "/tmp/expired.json",
				writerFence: {
					leaseToken: token,
					revision: 2,
					writerGeneration: renewed.value.writerGeneration,
					expiresAt: renewed.value.expiresAt,
				},
			}),
		).toThrow(SessionWriterFenceRejectedError);

		const takeover = catalog.acquireSessionLease({
			sessionId: "managed",
			expectedRevision: 2,
			ttlMs: 5_000,
			provenance: provenance("takeover", now.toISOString(), "owner-b"),
		});
		expect(() =>
			store.commitCatalogManagedArtifact({
				sessionId: "managed",
				kind: "messages",
				path: "/tmp/old-token.json",
				writerFence: {
					leaseToken: token,
					revision: 2,
					writerGeneration: renewed.value.writerGeneration,
					expiresAt: renewed.value.expiresAt,
				},
			}),
		).toThrow(SessionWriterFenceRejectedError);
		expect(
			store.commitCatalogManagedArtifact({
				sessionId: "managed",
				kind: "messages",
				path: "/tmp/new-token.json",
				writerFence: {
					leaseToken: takeover.leaseToken ?? "",
					revision: takeover.value.revision,
					writerGeneration: takeover.value.writerGeneration,
					expiresAt: takeover.value.expiresAt,
				},
			}),
		).toMatchObject({
			commitSequence: 3,
			leaseRevision: 3,
			writerGeneration: 2,
			messagesPath: "/tmp/new-token.json",
		});
	});

	it("durably claims, atomically completes, replays, and recovers manual compaction operations", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "manual-compaction-receipt-"));
		let now = new Date("2026-08-14T10:00:00.000Z");
		const clock = () => new Date(now);
		const store = new SqliteSessionStore({ sessionsDir: dataDir, clock });
		store.create(session("managed-compaction"));
		const catalog = new SqliteChatCatalogService({ dataDir, clock });
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		catalog.adoptRootSession({
			chatId: "chat-managed-compaction",
			sessionId: "managed-compaction",
			provenance: provenance("adopt-compaction", now.toISOString(), "owner-a"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "managed-compaction",
			expectedRevision: 0,
			ttlMs: 5_000,
			provenance: provenance(
				"acquire-compaction",
				now.toISOString(),
				"owner-a",
			),
		});
		const firstFence = {
			leaseToken: acquired.leaseToken ?? "",
			revision: acquired.value.revision,
			writerGeneration: acquired.value.writerGeneration,
			expiresAt: acquired.value.expiresAt,
		};
		const completedDigest = "a".repeat(64);
		const completed = store.beginCatalogManagedManualCompaction({
			sessionId: "managed-compaction",
			operationId: "operation-completed",
			intentDigest: completedDigest,
			writerFence: firstFence,
		});
		expect(completed).toMatchObject({
			disposition: "started",
			receipt: { status: "running", writerGeneration: 1 },
		});
		expect(
			store.commitCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-completed",
				intentDigest: completedDigest,
				status: "completed",
				result: {
					operationId: "operation-completed",
					sessionId: "managed-compaction",
					outcome: "compacted",
					state: {
						version: 1,
						updatedAt: now.toISOString(),
						sourceMessageCount: 8,
						compactedMessageCount: 2,
						stateDigest: "f".repeat(64),
					},
				},
				compactionPath: "/tmp/managed-compaction.g1.json",
				writerFence: firstFence,
			}),
		).toMatchObject({ status: "completed" });
		expect(
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-completed",
				intentDigest: completedDigest,
				writerFence: firstFence,
			}),
		).toMatchObject({ disposition: "replay" });
		expect(
			store.getCatalogManagedArtifactHead("managed-compaction"),
		).toMatchObject({
			commitSequence: 2,
			compactionPath: "/tmp/managed-compaction.g1.json",
		});
		expect(() =>
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-completed",
				intentDigest: "b".repeat(64),
				writerFence: firstFence,
			}),
		).toThrow(SessionManualCompactionOperationConflictError);

		const competingStore = new SqliteSessionStore({
			sessionsDir: dataDir,
			clock,
		});
		competingStore.init();
		cleanup.push(() => competingStore.close());
		store.beginCatalogManagedManualCompaction({
			sessionId: "managed-compaction",
			operationId: "operation-live",
			intentDigest: "8".repeat(64),
			writerFence: firstFence,
		});
		expect(
			competingStore.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-competing-store",
				intentDigest: "7".repeat(64),
				writerFence: firstFence,
			}),
		).toMatchObject({
			disposition: "in_progress",
			receipt: { operationId: "operation-live" },
		});
		expect(
			store.queryAll(
				`SELECT operation_id FROM session_manual_compaction_operations
				 WHERE session_id = ? AND status = 'running'`,
				["managed-compaction"],
			),
		).toHaveLength(1);
		expect(
			store.recoverCatalogManagedManualCompactions({
				sessionId: "managed-compaction",
				writerFence: firstFence,
			}),
		).toBe(1);

		const rollbackDigest = "e".repeat(64);
		store.beginCatalogManagedManualCompaction({
			sessionId: "managed-compaction",
			operationId: "operation-rollback",
			intentDigest: rollbackDigest,
			writerFence: firstFence,
		});
		const getRawDb = Reflect.get(store, "getRawDb");
		if (typeof getRawDb !== "function") {
			throw new Error("SqliteSessionStore test database hook unavailable");
		}
		const db = Reflect.apply(getRawDb, store, []) as {
			exec(sql: string): void;
		};
		db.exec(`CREATE TRIGGER abort_manual_compaction_completion
			BEFORE UPDATE OF status ON session_manual_compaction_operations
			WHEN NEW.status = 'completed'
			BEGIN
				SELECT RAISE(ABORT, 'forced receipt failure');
			END;`);
		expect(() =>
			store.commitCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-rollback",
				intentDigest: rollbackDigest,
				status: "completed",
				result: {
					operationId: "operation-rollback",
					sessionId: "managed-compaction",
					outcome: "compacted",
					state: {
						version: 1,
						updatedAt: now.toISOString(),
						sourceMessageCount: 8,
						compactedMessageCount: 2,
						stateDigest: "f".repeat(64),
					},
				},
				compactionPath: "/tmp/must-rollback.json",
				writerFence: firstFence,
			}),
		).toThrow("forced receipt failure");
		db.exec("DROP TRIGGER abort_manual_compaction_completion;");
		expect(
			store.getCatalogManagedArtifactHead("managed-compaction"),
		).toMatchObject({ compactionPath: "/tmp/managed-compaction.g1.json" });
		expect(
			store.queryOne(
				`SELECT status FROM session_manual_compaction_operations
				 WHERE session_id = ? AND operation_id = ?`,
				["managed-compaction", "operation-rollback"],
			),
		).toMatchObject({ status: "running" });
		expect(
			store.recoverCatalogManagedManualCompactions({
				sessionId: "managed-compaction",
				writerFence: firstFence,
			}),
		).toBe(1);

		const failedDigest = "9".repeat(64);
		store.beginCatalogManagedManualCompaction({
			sessionId: "managed-compaction",
			operationId: "operation-failed",
			intentDigest: failedDigest,
			writerFence: firstFence,
		});
		const failedReceipt = store.commitCatalogManagedManualCompaction({
			sessionId: "managed-compaction",
			operationId: "operation-failed",
			intentDigest: failedDigest,
			status: "failed",
			writerFence: firstFence,
		});
		expect(
			store.commitCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-failed",
				intentDigest: failedDigest,
				status: "failed",
				writerFence: firstFence,
			}),
		).toEqual(failedReceipt);

		const orphanDigest = "c".repeat(64);
		expect(
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-orphaned",
				intentDigest: orphanDigest,
				writerFence: firstFence,
			}),
		).toMatchObject({ disposition: "started" });

		now = new Date("2026-08-14T10:00:06.000Z");
		const takeover = catalog.acquireSessionLease({
			sessionId: "managed-compaction",
			expectedRevision: 1,
			ttlMs: 5_000,
			provenance: provenance(
				"takeover-compaction",
				now.toISOString(),
				"owner-b",
			),
		});
		const successorFence = {
			leaseToken: takeover.leaseToken ?? "",
			revision: takeover.value.revision,
			writerGeneration: takeover.value.writerGeneration,
			expiresAt: takeover.value.expiresAt,
		};
		expect(
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-successor",
				intentDigest: "d".repeat(64),
				writerFence: successorFence,
			}),
		).toMatchObject({
			disposition: "in_progress",
			receipt: { operationId: "operation-orphaned" },
		});
		expect(
			store.recoverCatalogManagedManualCompactions({
				sessionId: "managed-compaction",
				writerFence: successorFence,
			}),
		).toBe(1);
		expect(
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-orphaned",
				intentDigest: orphanDigest,
				writerFence: successorFence,
			}),
		).toMatchObject({ disposition: "indeterminate" });
		expect(
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-successor",
				intentDigest: "d".repeat(64),
				writerFence: successorFence,
			}),
		).toMatchObject({
			disposition: "started",
			receipt: { writerGeneration: 2 },
		});
		expect(
			store.queryOne(
				`SELECT status FROM session_manual_compaction_operations
				 WHERE session_id = ? AND operation_id = ?`,
				["managed-compaction", "operation-orphaned"],
			),
		).toMatchObject({ status: "indeterminate" });
		expect(
			store.beginCatalogManagedManualCompaction({
				sessionId: "managed-compaction",
				operationId: "operation-completed",
				intentDigest: completedDigest,
				writerFence: successorFence,
			}),
		).toMatchObject({ disposition: "replay" });
		expect(
			store.queryAll(
				`SELECT operation_id FROM session_manual_compaction_operations
				 WHERE session_id = ? AND operation_id = ?`,
				["managed-compaction", "operation-completed"],
			),
		).toHaveLength(1);
	});
});
