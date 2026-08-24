import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { BasicLogger } from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";
import { nowIso } from "../../services/session-artifacts";
import type { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import type { SessionMessagesArtifactUploader } from "../../types/session";
import type {
	SessionManualCompactionDurableBeginResult,
	SessionManualCompactionOperationReceipt,
	SessionManualCompactionReceiptResult,
} from "../models/session-manual-compaction-operation";
import {
	type CreateRootSessionInput,
	patchSqliteRow,
	type ReserveCatalogRootSessionInput,
	SESSION_SELECT_COLUMNS,
	type SessionRow,
} from "../models/session-row";
import type {
	SessionManagedArtifactHead,
	SessionManagedArtifactKind,
	SessionWriterFenceCredential,
} from "../writer-fence";
import type {
	PersistedSessionUpdateInput,
	SessionPersistenceAdapter,
} from "./persistence-service";
import { UnifiedSessionPersistenceService } from "./persistence-service";

export class CatalogSessionReservationConflictError extends Error {
	constructor(readonly sessionId: string) {
		super(`catalog session reservation conflicts with session ${sessionId}`);
		this.name = "CatalogSessionReservationConflictError";
	}
}

class LocalSessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(
		private readonly store: SqliteSessionStore,
		private readonly sessionsDirPath: string = resolveSessionDataDir(),
	) {}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	async upsertSession(
		row: SessionRow,
		writerFence?: SessionWriterFenceCredential,
	): Promise<void> {
		this.store.upsertPersistedSession(row, writerFence);
	}

	async getSession(sessionId: string): Promise<SessionRow | undefined> {
		const row = this.store.queryOne<Record<string, unknown>>(
			`SELECT ${SESSION_SELECT_COLUMNS} FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		return row ? patchSqliteRow(row) : undefined;
	}

	async listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRow[]> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];
		if (options.parentSessionId) {
			whereClauses.push("parent_session_id = ?");
			params.push(options.parentSessionId);
		}
		if (options.status) {
			whereClauses.push("status = ?");
			params.push(options.status);
		}
		const where =
			whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
		return this.store
			.queryAll<Record<string, unknown>>(
				`SELECT ${SESSION_SELECT_COLUMNS}
				 FROM sessions
				 ${where}
				 ORDER BY started_at DESC
				 LIMIT ?`,
				[...params, options.limit],
			)
			.map(patchSqliteRow);
	}

	async updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		return this.store.updatePersistedSession(input);
	}

	async isCatalogManaged(sessionId: string): Promise<boolean> {
		return this.store.isCatalogManaged(sessionId);
	}

	async getCatalogManagedArtifactHead(
		sessionId: string,
	): Promise<SessionManagedArtifactHead | undefined> {
		return this.store.getCatalogManagedArtifactHead(sessionId);
	}

	async commitCatalogManagedArtifact(input: {
		sessionId: string;
		kind: SessionManagedArtifactKind;
		path?: string;
		writerFence: SessionWriterFenceCredential;
	}): Promise<SessionManagedArtifactHead> {
		return this.store.commitCatalogManagedArtifact(input);
	}

	async beginCatalogManagedManualCompaction(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		writerFence: SessionWriterFenceCredential;
	}): Promise<SessionManualCompactionDurableBeginResult> {
		return this.store.beginCatalogManagedManualCompaction(input);
	}

	async recoverCatalogManagedManualCompactions(input: {
		sessionId: string;
		writerFence: SessionWriterFenceCredential;
	}): Promise<number> {
		return this.store.recoverCatalogManagedManualCompactions(input);
	}

	async commitCatalogManagedManualCompaction(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		status: "completed" | "skipped" | "failed";
		result?: SessionManualCompactionReceiptResult;
		compactionPath?: string;
		writerFence: SessionWriterFenceCredential;
	}): Promise<SessionManualCompactionOperationReceipt> {
		return this.store.commitCatalogManagedManualCompaction(input);
	}

	async deleteSession(sessionId: string, cascade: boolean): Promise<boolean> {
		return this.store.delete(sessionId, cascade);
	}

	async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		this.store.runAuxiliaryMutation(
			`INSERT INTO subagent_spawn_queue (root_session_id, parent_agent_id, task, system_prompt, created_at, consumed_at)
			 VALUES (?, ?, ?, ?, ?, NULL)`,
			[
				input.rootSessionId,
				input.parentAgentId,
				input.task ?? null,
				input.systemPrompt ?? null,
				nowIso(),
			],
		);
	}

	async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		const row = this.store.queryOne<{ id?: number; task?: string | null }>(
			`SELECT id, task FROM subagent_spawn_queue
			 WHERE root_session_id = ? AND parent_agent_id = ? AND consumed_at IS NULL
			 ORDER BY id ASC LIMIT 1`,
			[rootSessionId, parentAgentId],
		);
		if (!row || typeof row.id !== "number") {
			return undefined;
		}
		this.store.runAuxiliaryMutation(
			`UPDATE subagent_spawn_queue SET consumed_at = ? WHERE id = ?`,
			[nowIso(), row.id],
		);
		return row.task ?? undefined;
	}
}

export class CoreSessionService extends UnifiedSessionPersistenceService {
	constructor(
		private readonly store: SqliteSessionStore,
		options: {
			sessionArtifactsDir?: string;
			messagesArtifactUploader?: SessionMessagesArtifactUploader;
			logger?: BasicLogger;
		} = {},
	) {
		super(
			new LocalSessionPersistenceAdapter(store, options.sessionArtifactsDir),
			options,
		);
	}

	catalogStorageIdentity(): { dataDir: string; tenantId: string } {
		return {
			dataDir: dirname(this.store.sessionDbPath()),
			tenantId: this.store.tenantKey(),
		};
	}

	reserveCatalogRootSession(input: ReserveCatalogRootSessionInput): {
		created: boolean;
		sessionId: string;
	} {
		const sessionId = input.sessionId.trim();
		if (!sessionId) {
			throw new CatalogSessionReservationConflictError(input.sessionId);
		}
		const expected: SessionRow = {
			sessionId,
			source: input.source,
			pid: input.pid,
			startedAt: input.startedAt,
			endedAt: null,
			exitCode: null,
			status: "idle",
			statusLock: 0,
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspaceRoot: input.workspaceRoot,
			teamName: input.teamName ?? null,
			enableTools: input.enableTools,
			enableSpawn: input.enableSpawn,
			enableTeams: input.enableTeams,
			parentSessionId: null,
			parentAgentId: null,
			agentId: null,
			conversationId: null,
			isSubagent: false,
			prompt: input.prompt?.trim() || null,
			metadata: input.metadata ?? null,
			hookPath: "",
			messagesPath: null,
			updatedAt: input.startedAt,
		};
		const created = this.store.reservePersistedSession(expected);
		if (!created) {
			const current = this.store.get(sessionId);
			const expectedIdentity = {
				...expected,
				updatedAt: undefined,
				statusLock: undefined,
			};
			const currentIdentity = current
				? {
						...current,
						endedAt: current.endedAt ?? null,
						exitCode: current.exitCode ?? null,
						teamName: current.teamName ?? null,
						parentSessionId: current.parentSessionId ?? null,
						parentAgentId: current.parentAgentId ?? null,
						agentId: current.agentId ?? null,
						conversationId: current.conversationId ?? null,
						prompt: current.prompt ?? null,
						metadata: current.metadata ?? null,
						hookPath: current.hookPath ?? "",
						messagesPath: current.messagesPath ?? null,
						updatedAt: undefined,
						statusLock: undefined,
					}
				: undefined;
			if (!isDeepStrictEqual(currentIdentity, expectedIdentity)) {
				throw new CatalogSessionReservationConflictError(sessionId);
			}
		}
		return { created, sessionId };
	}

	deleteCatalogRootReservation(sessionIdInput: string): boolean {
		const sessionId = sessionIdInput.trim();
		const current = sessionId ? this.store.get(sessionId) : undefined;
		if (!current) return false;
		if (
			this.store.isCatalogManaged(sessionId) ||
			current.status !== "idle" ||
			current.messagesPath
		) {
			throw new CatalogSessionReservationConflictError(sessionId);
		}
		return this.store.delete(sessionId);
	}

	createRootSession(input: CreateRootSessionInput): void {
		this.store.upsertPersistedSession({
			...input,
			endedAt: null,
			exitCode: null,
			status: "running",
			statusLock: 0,
			parentSessionId: null,
			parentAgentId: null,
			agentId: null,
			conversationId: null,
			isSubagent: false,
			hookPath: "",
			updatedAt: nowIso(),
		});
	}
}

export type {
	CreateRootSessionInput,
	CreateRootSessionWithArtifactsInput,
	ReserveCatalogRootSessionInput,
	RootSessionArtifacts,
	SessionRow,
	UpsertSubagentInput,
} from "../models/session-row";
