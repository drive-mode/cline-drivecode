import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteChatCatalogService } from "../../chat-catalog/sqlite-chat-catalog-service";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { SessionSource } from "../../types/common";
import { createSessionCompactionState } from "../models/session-compaction";
import { SessionManualCompactionOperationIntegrityError } from "../models/session-manual-compaction-operation";
import { SessionWriterFenceRejectedError } from "../writer-fence";
import { CoreSessionService } from "./session-service";

const WORKSPACE = resolve("/tmp/persistence-writer-fence-workspace");

function provenance(invocationId: string, occurredAt: string, ownerId: string) {
	return {
		invocationId,
		actor: { kind: "human" as const, id: ownerId },
		source: { kind: "interactive" as const, transport: "cli" },
		occurredAt,
	};
}

describe("managed transcript commit fence", () => {
	const cleanup: Array<() => void> = [];

	afterEach(() => {
		for (const dispose of cleanup.splice(0).reverse()) dispose();
	});

	it("publishes an immutable transcript head only for the current writer generation", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "persistence-writer-fence-"));
		const artifactsDir = join(dataDir, "artifacts");
		let now = new Date("2026-08-14T10:00:00.000Z");
		const clock = () => new Date(now);
		const store = new SqliteSessionStore({ sessionsDir: dataDir, clock });
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		const created = await sessions.createRootSessionWithArtifacts({
			sessionId: "managed-transcript",
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
			prompt: "hello",
		});
		const canonicalPath = created.messagesPath;
		const catalog = new SqliteChatCatalogService({ dataDir, clock });
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		catalog.adoptRootSession({
			chatId: "chat-managed-transcript",
			sessionId: "managed-transcript",
			provenance: provenance("adopt", now.toISOString(), "owner-a"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "managed-transcript",
			expectedRevision: 0,
			ttlMs: 5_000,
			provenance: provenance("acquire", now.toISOString(), "owner-a"),
		});
		const generationOneFence = {
			leaseToken: acquired.leaseToken ?? "",
			revision: acquired.value.revision,
			writerGeneration: acquired.value.writerGeneration,
			expiresAt: acquired.value.expiresAt,
		};
		await expect(
			sessions.createRootSessionWithArtifacts({
				sessionId: "managed-transcript",
				source: SessionSource.CLI,
				pid: process.pid,
				interactive: true,
				provider: "replacement-provider",
				model: "replacement-model",
				cwd: WORKSPACE,
				workspaceRoot: WORKSPACE,
				enableTools: false,
				enableSpawn: false,
				enableTeams: false,
			}),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.deleteSession("managed-transcript"),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		expect(store.get("managed-transcript")).toMatchObject({
			provider: "test-provider",
			model: "test-model",
		});

		await expect(
			sessions.persistSessionMessages("managed-transcript", [
				{ role: "assistant", content: "unfenced" },
			]),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		expect(store.get("managed-transcript")?.messagesPath).toBe(canonicalPath);

		await sessions.persistSessionMessages(
			"managed-transcript",
			[{ role: "assistant", content: "generation one" }],
			undefined,
			generationOneFence,
		);
		const generationOnePath = store.get("managed-transcript")?.messagesPath;
		expect(generationOnePath).toContain(".g1.");
		expect(generationOnePath).not.toBe(canonicalPath);
		expect(readFileSync(generationOnePath ?? "", "utf8")).toContain(
			"generation one",
		);

		await expect(
			sessions.updateSession({
				sessionId: "managed-transcript",
				metadata: { title: "unfenced metadata" },
			}),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.updateSessionStatus("managed-transcript", "idle"),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.writeSessionManifest(created.manifestPath, {
				...created.manifest,
				metadata: { title: "unfenced manifest" },
			}),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);

		await expect(
			sessions.updateSession({
				sessionId: "managed-transcript",
				metadata: { marker: "generation one metadata" },
				writerFence: generationOneFence,
			}),
		).resolves.toMatchObject({ updated: true });
		await expect(
			sessions.updateSessionStatus(
				"managed-transcript",
				"idle",
				null,
				generationOneFence,
			),
		).resolves.toMatchObject({ updated: true });
		await sessions.writeSessionManifest(
			created.manifestPath,
			{
				...created.manifest,
				status: "idle",
				metadata: { title: "generation one manifest" },
			},
			generationOneFence,
		);
		const sourceMessages = [
			{ id: "u1", role: "user" as const, content: "generation one source" },
		];
		const compactionOne = createSessionCompactionState({
			sourceMessages,
			compactedMessages: [
				{ id: "s1", role: "user" as const, content: "generation one summary" },
			],
			conversationId: "managed-transcript",
			updatedAt: "2026-08-14T10:00:01.000Z",
		});
		await sessions.persistSessionCompactionState(
			"managed-transcript",
			compactionOne,
			generationOneFence,
		);
		const generationOneHead =
			store.getCatalogManagedArtifactHead("managed-transcript");
		expect(generationOneHead).toMatchObject({
			writerGeneration: 1,
			messagesPath: generationOnePath,
		});
		expect(generationOneHead?.manifestPath).toContain(".g1.");
		expect(generationOneHead?.compactionPath).toContain(".g1.");
		expect(
			readFileSync(generationOneHead?.compactionPath ?? "", "utf8"),
		).toContain("generation one summary");

		now = new Date("2026-08-14T10:00:06.000Z");
		const takeover = catalog.acquireSessionLease({
			sessionId: "managed-transcript",
			expectedRevision: acquired.value.revision,
			ttlMs: 5_000,
			provenance: provenance("takeover", now.toISOString(), "owner-b"),
		});
		await expect(
			sessions.persistSessionMessages(
				"managed-transcript",
				[{ role: "assistant", content: "stale writer" }],
				undefined,
				generationOneFence,
			),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.updateSession({
				sessionId: "managed-transcript",
				metadata: { title: "stale metadata" },
				writerFence: generationOneFence,
			}),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.updateSessionStatus(
				"managed-transcript",
				"running",
				null,
				generationOneFence,
			),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.writeSessionManifest(
				created.manifestPath,
				{
					...created.manifest,
					metadata: { title: "stale manifest" },
				},
				generationOneFence,
			),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		const staleCompaction = createSessionCompactionState({
			sourceMessages,
			compactedMessages: [
				{ id: "stale", role: "user" as const, content: "stale summary" },
			],
			conversationId: "managed-transcript",
			updatedAt: "2026-08-14T10:00:07.000Z",
		});
		await expect(
			sessions.persistSessionCompactionState(
				"managed-transcript",
				staleCompaction,
				generationOneFence,
			),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		await expect(
			sessions.deleteSessionCompactionState(
				"managed-transcript",
				generationOneFence,
			),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		expect(store.get("managed-transcript")?.messagesPath).toBe(
			generationOnePath,
		);
		expect(store.get("managed-transcript")).toMatchObject({
			status: "idle",
			metadata: { marker: "generation one metadata" },
		});
		expect(store.getCatalogManagedArtifactHead("managed-transcript")).toEqual(
			generationOneHead,
		);

		const generationTwoFence = {
			leaseToken: takeover.leaseToken ?? "",
			revision: takeover.value.revision,
			writerGeneration: takeover.value.writerGeneration,
			expiresAt: takeover.value.expiresAt,
		};
		await sessions.persistSessionMessages(
			"managed-transcript",
			[{ role: "assistant", content: "generation two" }],
			undefined,
			generationTwoFence,
		);
		const generationTwoPath = store.get("managed-transcript")?.messagesPath;
		expect(generationTwoPath).toContain(".g2.");
		expect(readFileSync(generationTwoPath ?? "", "utf8")).toContain(
			"generation two",
		);
		expect(existsSync(generationOnePath ?? "")).toBe(true);
		await sessions.deleteSessionCompactionState(
			"managed-transcript",
			generationTwoFence,
		);
		expect(
			store.getCatalogManagedArtifactHead("managed-transcript")?.compactionPath,
		).toBeUndefined();
	});

	it("commits a manual sidecar with its receipt and replays the exact selected artifact", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "manual-compaction-persist-"));
		const artifactsDir = join(dataDir, "artifacts");
		const now = new Date("2026-08-14T12:00:00.000Z");
		const clock = () => new Date(now);
		const store = new SqliteSessionStore({ sessionsDir: dataDir, clock });
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		const created = await sessions.createRootSessionWithArtifacts({
			sessionId: "managed-manual-compaction",
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
		const canonicalMessages = readFileSync(created.messagesPath, "utf8");
		const catalog = new SqliteChatCatalogService({ dataDir, clock });
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		catalog.adoptRootSession({
			chatId: "chat-managed-manual-compaction",
			sessionId: "managed-manual-compaction",
			provenance: provenance("adopt-manual", now.toISOString(), "owner-a"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "managed-manual-compaction",
			expectedRevision: 0,
			ttlMs: 5_000,
			provenance: provenance("acquire-manual", now.toISOString(), "owner-a"),
		});
		const writerFence = {
			leaseToken: acquired.leaseToken ?? "",
			revision: acquired.value.revision,
			writerGeneration: acquired.value.writerGeneration,
			expiresAt: acquired.value.expiresAt,
		};
		const sourceMessages = [
			{ id: "source", role: "user" as const, content: "canonical source" },
		];
		const manualState = createSessionCompactionState({
			sourceMessages,
			compactedMessages: [
				{ id: "manual", role: "user" as const, content: "manual summary" },
			],
			conversationId: "managed-manual-compaction",
			updatedAt: "2026-08-14T12:00:01.000Z",
		});
		const intentDigest = "a".repeat(64);
		await expect(
			sessions.beginSessionManualCompactionOperation({
				sessionId: "managed-manual-compaction",
				operationId: "manual-operation",
				intentDigest,
				writerFence,
			}),
		).resolves.toMatchObject({ disposition: "started" });
		await expect(
			sessions.persistSessionManualCompactionState({
				sessionId: "managed-manual-compaction",
				operationId: "manual-operation",
				intentDigest,
				state: manualState,
				writerFence,
			}),
		).resolves.toMatchObject({ status: "completed" });
		const selectedManualPath = store.getCatalogManagedArtifactHead(
			"managed-manual-compaction",
		)?.compactionPath;
		if (!selectedManualPath) {
			throw new Error("manual compaction path was not selected");
		}
		expect(selectedManualPath).toContain(".g1.");
		const selectedManualContents = readFileSync(selectedManualPath, "utf8");
		expect(selectedManualContents).toContain("manual summary");
		expect(readFileSync(created.messagesPath, "utf8")).toBe(canonicalMessages);

		const newerState = createSessionCompactionState({
			sourceMessages,
			compactedMessages: [
				{ id: "newer", role: "user" as const, content: "newer summary" },
			],
			conversationId: "managed-manual-compaction",
			updatedAt: "2026-08-14T12:00:02.000Z",
		});
		await sessions.persistSessionCompactionState(
			"managed-manual-compaction",
			newerState,
			writerFence,
		);
		const selectedNewerPath = store.getCatalogManagedArtifactHead(
			"managed-manual-compaction",
		)?.compactionPath;
		expect(selectedNewerPath).not.toBe(selectedManualPath);
		expect(selectedNewerPath?.startsWith(`${selectedManualPath}.g`)).toBe(
			false,
		);
		await expect(
			sessions.beginSessionManualCompactionOperation({
				sessionId: "managed-manual-compaction",
				operationId: "manual-operation",
				intentDigest,
				writerFence,
			}),
		).resolves.toMatchObject({
			disposition: "replay",
			result: {
				outcome: "compacted",
				state: { messages: [{ content: "manual summary" }] },
			},
		});
		const storedReceipt = store.queryOne<{ result_json: string }>(
			`SELECT result_json FROM session_manual_compaction_operations
			 WHERE session_id = ? AND operation_id = ?`,
			["managed-manual-compaction", "manual-operation"],
		);
		if (!storedReceipt) throw new Error("completed receipt was not persisted");
		const legacyResult = JSON.parse(storedReceipt.result_json) as {
			state: { stateDigest?: string };
		};
		delete legacyResult.state.stateDigest;
		const getRawDb = Reflect.get(store, "getRawDb");
		if (typeof getRawDb !== "function") {
			throw new Error("SqliteSessionStore test database hook unavailable");
		}
		const db = Reflect.apply(getRawDb, store, []) as {
			prepare(sql: string): {
				run(...params: unknown[]): unknown;
			};
		};
		db.prepare(
			`UPDATE session_manual_compaction_operations
			 SET result_json = ? WHERE session_id = ? AND operation_id = ?`,
		).run(
			JSON.stringify(legacyResult),
			"managed-manual-compaction",
			"manual-operation",
		);
		await expect(
			sessions.beginSessionManualCompactionOperation({
				sessionId: "managed-manual-compaction",
				operationId: "manual-operation",
				intentDigest,
				writerFence,
			}),
		).resolves.toMatchObject({ disposition: "replay" });
		db.prepare(
			`UPDATE session_manual_compaction_operations
			 SET result_json = ? WHERE session_id = ? AND operation_id = ?`,
		).run(
			storedReceipt.result_json,
			"managed-manual-compaction",
			"manual-operation",
		);

		const tamperedState = JSON.parse(selectedManualContents) as {
			messages: Array<{ content?: string }>;
		};
		if (!tamperedState.messages[0]) {
			throw new Error("manual compaction test sidecar has no summary message");
		}
		tamperedState.messages[0].content = "tampered summary with same counts";
		writeFileSync(selectedManualPath, JSON.stringify(tamperedState), "utf8");
		await expect(
			sessions.beginSessionManualCompactionOperation({
				sessionId: "managed-manual-compaction",
				operationId: "manual-operation",
				intentDigest,
				writerFence,
			}),
		).rejects.toBeInstanceOf(SessionManualCompactionOperationIntegrityError);
		writeFileSync(selectedManualPath, selectedManualContents, "utf8");

		rmSync(selectedManualPath);
		await expect(
			sessions.beginSessionManualCompactionOperation({
				sessionId: "managed-manual-compaction",
				operationId: "manual-operation",
				intentDigest,
				writerFence,
			}),
		).rejects.toBeInstanceOf(SessionManualCompactionOperationIntegrityError);
	});

	it("materializes a reserved root only after catalog adoption and lease acquisition", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "reserved-root-fence-"));
		const artifactsDir = join(dataDir, "artifacts");
		const now = new Date("2026-08-14T11:00:00.000Z");
		const clock = () => new Date(now);
		const store = new SqliteSessionStore({ sessionsDir: dataDir, clock });
		const sessions = new CoreSessionService(store, {
			sessionArtifactsDir: artifactsDir,
		});
		store.create({
			sessionId: "reserved-root",
			source: SessionSource.CLI,
			pid: process.pid,
			startedAt: now.toISOString(),
			status: "idle",
			interactive: true,
			provider: "test-provider",
			model: "test-model",
			cwd: WORKSPACE,
			workspaceRoot: WORKSPACE,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
			updatedAt: now.toISOString(),
		});
		const catalog = new SqliteChatCatalogService({ dataDir, clock });
		cleanup.push(() => {
			catalog.close();
			store.close();
			rmSync(dataDir, { recursive: true, force: true });
		});
		catalog.adoptRootSession({
			chatId: "chat-reserved-root",
			sessionId: "reserved-root",
			provenance: provenance("adopt-reserved", now.toISOString(), "owner-a"),
		});
		const acquired = catalog.acquireSessionLease({
			sessionId: "reserved-root",
			expectedRevision: 0,
			ttlMs: 5_000,
			provenance: provenance("acquire-reserved", now.toISOString(), "owner-a"),
		});
		const writerFence = {
			leaseToken: acquired.leaseToken ?? "",
			revision: acquired.value.revision,
			writerGeneration: acquired.value.writerGeneration,
			expiresAt: acquired.value.expiresAt,
		};

		expect(existsSync(join(artifactsDir, "reserved-root"))).toBe(false);
		await expect(
			sessions.createRootSessionWithArtifacts({
				sessionId: "reserved-root",
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
			}),
		).rejects.toBeInstanceOf(SessionWriterFenceRejectedError);
		expect(existsSync(join(artifactsDir, "reserved-root"))).toBe(false);

		const created = await sessions.createRootSessionWithArtifacts({
			sessionId: "reserved-root",
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
			writerFence,
		});
		const head = store.getCatalogManagedArtifactHead("reserved-root");
		expect(created.messagesPath).toBe(head?.messagesPath);
		expect(created.manifestPath).toBe(head?.manifestPath);
		expect(created.messagesPath).toContain(".g1.");
		expect(created.manifestPath).toContain(".g1.");
		expect(readFileSync(created.messagesPath, "utf8")).toContain(
			'"messages": []',
		);
		expect(readFileSync(created.manifestPath, "utf8")).toContain(
			created.messagesPath,
		);
		expect(store.get("reserved-root")).toMatchObject({
			status: "running",
			messagesPath: created.messagesPath,
		});
	});
});
