import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	asBool,
	asOptionalString,
	asString,
	ensureDatabaseTenant,
	ensureSessionSchema,
	loadSqliteDb,
	normalizeDatabaseTenantId,
	nowIso,
	type SqliteDb,
	toBoolInt,
} from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import {
	SESSION_MANUAL_COMPACTION_OPERATION_KIND,
	type SessionManualCompactionDurableBeginResult,
	SessionManualCompactionOperationConflictError,
	SessionManualCompactionOperationIntegrityError,
	type SessionManualCompactionOperationReceipt,
	type SessionManualCompactionOperationStatus,
	type SessionManualCompactionReceiptResult,
} from "../../session/models/session-manual-compaction-operation";
import {
	type SessionRow,
	stringifyMetadata,
} from "../../session/models/session-row";
import {
	type SessionManagedArtifactHead,
	type SessionManagedArtifactKind,
	type SessionWriterFenceCredential,
	SessionWriterFenceRejectedError,
} from "../../session/writer-fence";
import {
	isNonTerminalSessionStatus,
	type SessionStatus,
} from "../../types/common";
import type { PersistedSessionUpdateInput } from "../../types/session";
import type { SessionRecord } from "../../types/sessions";
import type { SessionStore } from "../../types/storage";

export interface SqliteSessionStoreOptions {
	sessionsDir?: string;
	tenantId?: string;
	clock?: () => Date;
}

function parseManualCompactionReceiptResult(
	value: unknown,
): SessionManualCompactionReceiptResult | undefined {
	if (value === null || value === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(String(value));
	} catch {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	const result = parsed as Record<string, unknown>;
	if (
		typeof result.operationId !== "string" ||
		!result.operationId ||
		typeof result.sessionId !== "string" ||
		!result.sessionId
	) {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	if (result.outcome === "skipped") {
		return {
			operationId: result.operationId,
			sessionId: result.sessionId,
			outcome: "skipped",
		};
	}
	const state = result.state;
	if (
		result.outcome !== "compacted" ||
		!state ||
		typeof state !== "object" ||
		Array.isArray(state)
	) {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	const summary = state as Record<string, unknown>;
	if (
		summary.version !== 1 ||
		typeof summary.updatedAt !== "string" ||
		!Number.isFinite(Date.parse(summary.updatedAt)) ||
		!Number.isSafeInteger(summary.sourceMessageCount) ||
		Number(summary.sourceMessageCount) < 0 ||
		!Number.isSafeInteger(summary.compactedMessageCount) ||
		Number(summary.compactedMessageCount) < 0 ||
		(summary.stateDigest !== undefined &&
			(typeof summary.stateDigest !== "string" ||
				!/^[0-9a-f]{64}$/.test(summary.stateDigest))) ||
		(summary.conversationId !== undefined &&
			typeof summary.conversationId !== "string")
	) {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	return {
		operationId: result.operationId,
		sessionId: result.sessionId,
		outcome: "compacted",
		state: {
			version: 1,
			updatedAt: summary.updatedAt,
			sourceMessageCount: Number(summary.sourceMessageCount),
			compactedMessageCount: Number(summary.compactedMessageCount),
			...(typeof summary.stateDigest === "string"
				? { stateDigest: summary.stateDigest }
				: {}),
			...(typeof summary.conversationId === "string"
				? { conversationId: summary.conversationId }
				: {}),
		},
	};
}

function patchManualCompactionReceipt(
	row: Record<string, unknown>,
): SessionManualCompactionOperationReceipt {
	const status = String(
		row.status ?? "",
	) as SessionManualCompactionOperationStatus;
	if (
		!(
			["running", "completed", "skipped", "failed", "indeterminate"] as const
		).includes(status)
	) {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	const receipt: SessionManualCompactionOperationReceipt = {
		sessionId: asString(row.session_id),
		writerGeneration: Number(row.writer_generation),
		operationKind: SESSION_MANUAL_COMPACTION_OPERATION_KIND,
		operationId: asString(row.operation_id),
		intentDigest: asString(row.intent_digest),
		status,
		startedAt: asString(row.started_at),
		updatedAt: asString(row.updated_at),
	};
	const result = parseManualCompactionReceiptResult(row.result_json);
	if (result) receipt.result = result;
	const compactionPath = asOptionalString(row.compaction_path);
	if (compactionPath) receipt.compactionPath = compactionPath;
	if (
		!receipt.sessionId ||
		row.operation_kind !== SESSION_MANUAL_COMPACTION_OPERATION_KIND ||
		!Number.isSafeInteger(receipt.writerGeneration) ||
		receipt.writerGeneration < 1 ||
		!receipt.operationId ||
		!/^[0-9a-f]{64}$/.test(receipt.intentDigest) ||
		!Number.isFinite(Date.parse(receipt.startedAt)) ||
		!Number.isFinite(Date.parse(receipt.updatedAt)) ||
		(status === "completed" || status === "skipped") !== Boolean(result) ||
		(status === "completed" && !compactionPath) ||
		(status !== "completed" && Boolean(compactionPath)) ||
		(Boolean(result) &&
			(result?.operationId !== receipt.operationId ||
				result.sessionId !== receipt.sessionId ||
				(status === "completed") !== (result.outcome === "compacted")))
	) {
		throw new SessionManualCompactionOperationIntegrityError();
	}
	return receipt;
}

export class SqliteSessionStore implements SessionStore {
	private readonly sessionsDirPath: string;
	private readonly tenantId: string;
	private readonly clock: () => Date;
	private db: SqliteDb | undefined;

	constructor(options: SqliteSessionStoreOptions = {}) {
		this.tenantId = normalizeDatabaseTenantId(options.tenantId ?? "local");
		if (this.tenantId !== "local" && !options.sessionsDir) {
			throw new Error(
				"nonlocal tenant session storage requires an explicit directory",
			);
		}
		this.sessionsDirPath = options.sessionsDir ?? resolveDbDataDir();
		this.clock = options.clock ?? (() => new Date());
	}

	init(): void {
		this.getRawDb();
	}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	sessionDbPath(): string {
		return join(this.ensureSessionsDir(), "sessions.db");
	}

	tenantKey(): string {
		return this.tenantId;
	}

	private getRawDb(): SqliteDb {
		if (this.db) {
			return this.db;
		}
		const candidate = loadSqliteDb(this.sessionDbPath());
		try {
			ensureDatabaseTenant(candidate, this.tenantId);
			ensureSessionSchema(candidate, {
				includeLegacyMigrations: true,
				tenantId: this.tenantId,
			});
			this.db = candidate;
			return candidate;
		} catch (error) {
			candidate.close?.();
			throw error;
		}
	}

	close(): void {
		this.db?.close?.();
		this.db = undefined;
	}

	runAuxiliaryMutation(
		sql: string,
		params: unknown[] = [],
	): { changes?: number } {
		const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();
		if (
			!/^insert into subagent_spawn_queue\b/.test(normalized) &&
			!/^update subagent_spawn_queue\b/.test(normalized)
		) {
			throw new Error(
				"raw session-table mutations are forbidden; use a fenced store operation",
			);
		}
		return this.getRawDb()
			.prepare(sql)
			.run(...params);
	}

	queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
		this.assertReadOnlyQuery(sql);
		const row = this.getRawDb()
			.prepare(sql)
			.get(...params);
		return (row as T | null) ?? undefined;
	}

	queryAll<T>(sql: string, params: unknown[] = []): T[] {
		this.assertReadOnlyQuery(sql);
		return this.getRawDb()
			.prepare(sql)
			.all(...params) as T[];
	}

	private assertReadOnlyQuery(sql: string): void {
		if (!/^select\b/i.test(sql.trim())) {
			throw new Error("session store query APIs accept SELECT statements only");
		}
	}

	isCatalogManaged(sessionId: string): boolean {
		return Boolean(
			this.queryOne(
				`SELECT session_id FROM session_writer_heads WHERE session_id = ?`,
				[sessionId],
			),
		);
	}

	getCatalogManagedArtifactHead(
		sessionId: string,
	): SessionManagedArtifactHead | undefined {
		const row = this.queryOne<Record<string, unknown>>(
			`SELECT * FROM session_writer_heads WHERE session_id = ?`,
			[sessionId],
		);
		if (!row) return undefined;
		return {
			sessionId: String(row.session_id ?? ""),
			commitSequence: Number(row.commit_sequence ?? 0),
			leaseRevision: Number(row.lease_revision ?? 0),
			writerGeneration: Number(row.writer_generation ?? 0),
			...(typeof row.messages_path === "string"
				? { messagesPath: row.messages_path }
				: {}),
			...(typeof row.compaction_path === "string"
				? { compactionPath: row.compaction_path }
				: {}),
			...(typeof row.manifest_path === "string"
				? { manifestPath: row.manifest_path }
				: {}),
			managedAt: String(row.managed_at ?? ""),
			updatedAt: String(row.updated_at ?? ""),
		};
	}

	#runSessionWriterMutation<T>(
		input: {
			sessionId: string;
			writerFence?: SessionWriterFenceCredential;
		},
		operation: (db: SqliteDb) => { value: T; applied: boolean },
	): T {
		const db = this.getRawDb();
		db.exec("BEGIN IMMEDIATE;");
		try {
			const head = db
				.prepare(`SELECT * FROM session_writer_heads WHERE session_id = ?`)
				.get(input.sessionId);
			let leaseRevision: number | undefined;
			let writerGeneration: number | undefined;
			if (head) {
				const fence = input.writerFence;
				if (!fence) {
					throw new SessionWriterFenceRejectedError(
						input.sessionId,
						"catalog-managed session mutation requires writer authority",
					);
				}
				const now = this.clock();
				if (!Number.isFinite(now.getTime())) {
					throw new SessionWriterFenceRejectedError(
						input.sessionId,
						"writer authority clock is invalid",
					);
				}
				const lease = db
					.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
					.get(input.sessionId);
				const expectedDigest = createHash("sha256")
					.update(fence.leaseToken)
					.digest("hex");
				const actualDigest = String(lease?.lease_token_hash ?? "");
				const expectedBytes = Buffer.from(expectedDigest, "hex");
				const actualBytes = Buffer.from(actualDigest, "hex");
				const tokenMatches =
					expectedBytes.length === actualBytes.length &&
					timingSafeEqual(expectedBytes, actualBytes);
				leaseRevision = Number(lease?.revision ?? -1);
				writerGeneration = Number(lease?.writer_generation ?? -1);
				if (
					!lease ||
					Number(lease.is_active ?? 0) !== 1 ||
					String(lease.expires_at ?? "") <= now.toISOString() ||
					!tokenMatches ||
					!Number.isSafeInteger(leaseRevision) ||
					!Number.isSafeInteger(writerGeneration) ||
					writerGeneration !== fence.writerGeneration
				) {
					throw new SessionWriterFenceRejectedError(input.sessionId);
				}
			} else if (input.writerFence) {
				throw new SessionWriterFenceRejectedError(
					input.sessionId,
					"session was not enrolled in catalog-managed persistence",
				);
			}

			const result = operation(db);
			if (head && result.applied) {
				db.prepare(
					`UPDATE session_writer_heads
					 SET commit_sequence = commit_sequence + 1,
					     lease_revision = ?, writer_generation = ?, updated_at = ?
					 WHERE session_id = ?`,
				).run(
					leaseRevision,
					writerGeneration,
					this.clock().toISOString(),
					input.sessionId,
				);
			}
			db.exec("COMMIT;");
			return result.value;
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	commitCatalogManagedArtifact(input: {
		sessionId: string;
		kind: SessionManagedArtifactKind;
		path?: string;
		writerFence: SessionWriterFenceCredential;
	}): SessionManagedArtifactHead {
		this.#runSessionWriterMutation(input, (db) => {
			const column =
				input.kind === "messages"
					? "messages_path"
					: input.kind === "compaction"
						? "compaction_path"
						: "manifest_path";
			db.prepare(
				`UPDATE session_writer_heads SET ${column} = ? WHERE session_id = ?`,
			).run(input.path ?? null, input.sessionId);
			if (input.kind === "messages") {
				db.prepare(
					`UPDATE sessions SET messages_path = ? WHERE session_id = ?`,
				).run(input.path, input.sessionId);
			}
			return {
				value: undefined,
				applied: true,
			};
		});
		const head = this.getCatalogManagedArtifactHead(input.sessionId);
		if (!head) {
			throw new SessionWriterFenceRejectedError(
				input.sessionId,
				"managed artifact head disappeared after commit",
			);
		}
		return head;
	}

	beginCatalogManagedManualCompaction(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		writerFence: SessionWriterFenceCredential;
	}): SessionManualCompactionDurableBeginResult {
		if (
			!input.operationId.trim() ||
			!/^[0-9a-f]{64}$/.test(input.intentDigest)
		) {
			throw new SessionManualCompactionOperationConflictError(
				"manual compaction operation identity is invalid",
			);
		}
		return this.#runSessionWriterMutation<SessionManualCompactionDurableBeginResult>(
			input,
			(db) => {
				const updatedAt = this.clock().toISOString();
				let row = db
					.prepare(
						`SELECT * FROM session_manual_compaction_operations
					 WHERE session_id = ? AND operation_kind = ? AND operation_id = ?`,
					)
					.get(
						input.sessionId,
						SESSION_MANUAL_COMPACTION_OPERATION_KIND,
						input.operationId,
					);
				if (!row) {
					const running = db
						.prepare(
							`SELECT * FROM session_manual_compaction_operations
							 WHERE session_id = ? AND operation_kind = ? AND status = 'running'`,
						)
						.get(input.sessionId, SESSION_MANUAL_COMPACTION_OPERATION_KIND);
					if (running) {
						return {
							value: {
								disposition: "in_progress",
								receipt: patchManualCompactionReceipt(running),
							},
							applied: false,
						};
					}
					db.prepare(
						`INSERT INTO session_manual_compaction_operations (
						session_id, writer_generation, operation_kind, operation_id,
						intent_digest, status, result_json, compaction_path,
						started_at, updated_at
					) VALUES (?, ?, ?, ?, ?, 'running', NULL, NULL, ?, ?)`,
					).run(
						input.sessionId,
						input.writerFence.writerGeneration,
						SESSION_MANUAL_COMPACTION_OPERATION_KIND,
						input.operationId,
						input.intentDigest,
						updatedAt,
						updatedAt,
					);
					row = db
						.prepare(
							`SELECT * FROM session_manual_compaction_operations
						 WHERE session_id = ? AND operation_kind = ? AND operation_id = ?`,
						)
						.get(
							input.sessionId,
							SESSION_MANUAL_COMPACTION_OPERATION_KIND,
							input.operationId,
						);
					if (!row) {
						throw new SessionManualCompactionOperationIntegrityError(
							"manual compaction running receipt disappeared",
						);
					}
					return {
						value: {
							disposition: "started",
							receipt: patchManualCompactionReceipt(row),
						},
						applied: true,
					};
				}
				const receipt = patchManualCompactionReceipt(row);
				if (receipt.intentDigest !== input.intentDigest) {
					throw new SessionManualCompactionOperationConflictError(
						"manual compaction operation was reused with changed intent",
					);
				}
				if (receipt.status === "running") {
					return {
						value: { disposition: "in_progress", receipt },
						applied: false,
					};
				}
				const disposition =
					receipt.status === "completed" || receipt.status === "skipped"
						? "replay"
						: receipt.status === "failed"
							? "failed"
							: "indeterminate";
				return { value: { disposition, receipt }, applied: false };
			},
		);
	}

	recoverCatalogManagedManualCompactions(input: {
		sessionId: string;
		writerFence: SessionWriterFenceCredential;
	}): number {
		return this.#runSessionWriterMutation(input, (db) => {
			const changed = db
				.prepare(
					`UPDATE session_manual_compaction_operations
					 SET status = 'indeterminate', updated_at = ?
					 WHERE session_id = ? AND operation_kind = ? AND status = 'running'`,
				)
				.run(
					this.clock().toISOString(),
					input.sessionId,
					SESSION_MANUAL_COMPACTION_OPERATION_KIND,
				);
			const recovered = changed.changes ?? 0;
			return { value: recovered, applied: recovered > 0 };
		});
	}

	commitCatalogManagedManualCompaction(input: {
		sessionId: string;
		operationId: string;
		intentDigest: string;
		status: "completed" | "skipped" | "failed";
		result?: SessionManualCompactionReceiptResult;
		compactionPath?: string;
		writerFence: SessionWriterFenceCredential;
	}): SessionManualCompactionOperationReceipt {
		const expectsResult =
			input.status === "completed" || input.status === "skipped";
		if (
			!input.operationId.trim() ||
			!/^[0-9a-f]{64}$/.test(input.intentDigest) ||
			expectsResult !== Boolean(input.result) ||
			(input.status === "completed") !== Boolean(input.compactionPath) ||
			(input.result !== undefined &&
				(input.result.operationId !== input.operationId ||
					input.result.sessionId !== input.sessionId ||
					(input.status === "completed") !==
						(input.result.outcome === "compacted")))
		) {
			throw new SessionManualCompactionOperationConflictError(
				"manual compaction terminal receipt is invalid",
			);
		}
		return this.#runSessionWriterMutation(input, (db) => {
			const row = db
				.prepare(
					`SELECT * FROM session_manual_compaction_operations
					 WHERE session_id = ? AND operation_kind = ? AND operation_id = ?`,
				)
				.get(
					input.sessionId,
					SESSION_MANUAL_COMPACTION_OPERATION_KIND,
					input.operationId,
				);
			if (!row) {
				throw new SessionManualCompactionOperationConflictError(
					"manual compaction has no running receipt",
				);
			}
			const current = patchManualCompactionReceipt(row);
			if (current.intentDigest !== input.intentDigest) {
				throw new SessionManualCompactionOperationConflictError(
					"manual compaction operation was reused with changed intent",
				);
			}
			if (current.writerGeneration !== input.writerFence.writerGeneration) {
				throw new SessionManualCompactionOperationConflictError(
					"manual compaction belongs to a different writer generation",
				);
			}
			const resultJson = input.result ? JSON.stringify(input.result) : null;
			if (current.status !== "running") {
				const sameTerminal =
					current.status === input.status &&
					(JSON.stringify(current.result) ?? null) === resultJson &&
					current.compactionPath === input.compactionPath;
				if (sameTerminal) return { value: current, applied: false };
				throw new SessionManualCompactionOperationConflictError(
					"manual compaction operation is already terminal",
				);
			}
			if (input.status === "completed") {
				const head = db
					.prepare(
						`UPDATE session_writer_heads
					 SET compaction_path = ? WHERE session_id = ?`,
					)
					.run(input.compactionPath, input.sessionId);
				if ((head.changes ?? 0) !== 1) {
					throw new SessionManualCompactionOperationIntegrityError(
						"manual compaction artifact head disappeared",
					);
				}
			}
			const updatedAt = this.clock().toISOString();
			const changed = db
				.prepare(
					`UPDATE session_manual_compaction_operations
					 SET status = ?, result_json = ?, compaction_path = ?, updated_at = ?
					 WHERE session_id = ? AND writer_generation = ?
					   AND operation_kind = ? AND operation_id = ? AND status = 'running'`,
				)
				.run(
					input.status,
					resultJson,
					input.compactionPath ?? null,
					updatedAt,
					input.sessionId,
					input.writerFence.writerGeneration,
					SESSION_MANUAL_COMPACTION_OPERATION_KIND,
					input.operationId,
				);
			if ((changed.changes ?? 0) !== 1) {
				throw new SessionManualCompactionOperationConflictError(
					"manual compaction lost its running receipt",
				);
			}
			const terminal = db
				.prepare(
					`SELECT * FROM session_manual_compaction_operations
					 WHERE session_id = ? AND operation_kind = ? AND operation_id = ?`,
				)
				.get(
					input.sessionId,
					SESSION_MANUAL_COMPACTION_OPERATION_KIND,
					input.operationId,
				);
			if (!terminal) throw new SessionManualCompactionOperationIntegrityError();
			return {
				value: patchManualCompactionReceipt(terminal),
				applied: true,
			};
		});
	}

	upsertPersistedSession(
		row: SessionRow,
		writerFence?: SessionWriterFenceCredential,
	): void {
		this.#runSessionWriterMutation(
			{ sessionId: row.sessionId, writerFence },
			(db) => {
				db.prepare(
					`INSERT INTO sessions (
					session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
					provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
					parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
					metadata_json, transcript_path, hook_path, messages_path, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(session_id) DO UPDATE SET
					source = excluded.source,
					pid = excluded.pid,
					started_at = excluded.started_at,
					ended_at = excluded.ended_at,
					exit_code = excluded.exit_code,
					status = excluded.status,
					status_lock = excluded.status_lock,
					interactive = excluded.interactive,
					provider = excluded.provider,
					model = excluded.model,
					cwd = excluded.cwd,
					workspace_root = excluded.workspace_root,
					team_name = excluded.team_name,
					enable_tools = excluded.enable_tools,
					enable_spawn = excluded.enable_spawn,
					enable_teams = excluded.enable_teams,
					parent_session_id = excluded.parent_session_id,
					parent_agent_id = excluded.parent_agent_id,
					agent_id = excluded.agent_id,
					conversation_id = excluded.conversation_id,
					is_subagent = excluded.is_subagent,
					prompt = excluded.prompt,
					metadata_json = excluded.metadata_json,
					transcript_path = excluded.transcript_path,
					hook_path = excluded.hook_path,
					messages_path = excluded.messages_path,
					updated_at = excluded.updated_at`,
				).run(
					row.sessionId,
					row.source,
					row.pid,
					row.startedAt,
					row.endedAt ?? null,
					row.exitCode ?? null,
					row.status,
					row.statusLock,
					row.interactive ? 1 : 0,
					row.provider,
					row.model,
					row.cwd,
					row.workspaceRoot,
					row.teamName ?? null,
					row.enableTools ? 1 : 0,
					row.enableSpawn ? 1 : 0,
					row.enableTeams ? 1 : 0,
					row.parentSessionId ?? null,
					row.parentAgentId ?? null,
					row.agentId ?? null,
					row.conversationId ?? null,
					row.isSubagent ? 1 : 0,
					row.prompt ?? null,
					stringifyMetadata(row.metadata),
					"",
					row.hookPath ?? "",
					row.messagesPath ?? null,
					row.updatedAt,
				);
				return { value: undefined, applied: true };
			},
		);
	}

	reservePersistedSession(row: SessionRow): boolean {
		return this.#runSessionWriterMutation(
			{ sessionId: row.sessionId },
			(db) => {
				const changed = db
					.prepare(
						`INSERT INTO sessions (
							session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
							provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
							parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
							metadata_json, transcript_path, hook_path, messages_path, updated_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(session_id) DO NOTHING`,
					)
					.run(
						row.sessionId,
						row.source,
						row.pid,
						row.startedAt,
						row.endedAt ?? null,
						row.exitCode ?? null,
						row.status,
						row.statusLock,
						row.interactive ? 1 : 0,
						row.provider,
						row.model,
						row.cwd,
						row.workspaceRoot,
						row.teamName ?? null,
						row.enableTools ? 1 : 0,
						row.enableSpawn ? 1 : 0,
						row.enableTeams ? 1 : 0,
						row.parentSessionId ?? null,
						row.parentAgentId ?? null,
						row.agentId ?? null,
						row.conversationId ?? null,
						row.isSubagent ? 1 : 0,
						row.prompt ?? null,
						stringifyMetadata(row.metadata),
						"",
						row.hookPath ?? "",
						row.messagesPath ?? null,
						row.updatedAt,
					);
				const created = (changed.changes ?? 0) > 0;
				return { value: created, applied: created };
			},
		);
	}

	updatePersistedSession(input: PersistedSessionUpdateInput): {
		updated: boolean;
		statusLock: number;
	} {
		return this.#runSessionWriterMutation(input, (db) => {
			if (input.setRunning) {
				if (input.expectedStatusLock === undefined) {
					return {
						value: { updated: false, statusLock: 0 },
						applied: false,
					};
				}
				const changed = db
					.prepare(
						`UPDATE sessions
						 SET status = 'running', ended_at = NULL, exit_code = NULL,
						     updated_at = ?, status_lock = ?, parent_session_id = ?,
						     parent_agent_id = ?, agent_id = ?, conversation_id = ?,
						     is_subagent = 1, prompt = COALESCE(prompt, ?)
						 WHERE session_id = ? AND status_lock = ?`,
					)
					.run(
						nowIso(),
						input.expectedStatusLock + 1,
						input.parentSessionId ?? null,
						input.parentAgentId ?? null,
						input.agentId ?? null,
						input.conversationId ?? null,
						input.prompt ?? null,
						input.sessionId,
						input.expectedStatusLock,
					);
				const updated = (changed.changes ?? 0) > 0;
				return {
					value: {
						updated,
						statusLock: updated ? input.expectedStatusLock + 1 : 0,
					},
					applied: updated,
				};
			}

			const fields: string[] = [];
			const params: unknown[] = [];
			for (const [field, value] of [
				["status", input.status],
				["ended_at", input.endedAt],
				["exit_code", input.exitCode],
				["prompt", input.prompt],
				["parent_session_id", input.parentSessionId],
				["parent_agent_id", input.parentAgentId],
				["agent_id", input.agentId],
				["conversation_id", input.conversationId],
			] as const) {
				if (value !== undefined) {
					fields.push(`${field} = ?`);
					params.push(value ?? null);
				}
			}
			if (input.metadata !== undefined) {
				fields.push("metadata_json = ?");
				params.push(stringifyMetadata(input.metadata));
			}
			if (fields.length === 0) {
				const row = db
					.prepare(`SELECT status_lock FROM sessions WHERE session_id = ?`)
					.get(input.sessionId);
				return {
					value: {
						updated: Boolean(row),
						statusLock: Number(row?.status_lock ?? 0),
					},
					applied: false,
				};
			}

			let statusLock = 0;
			if (input.expectedStatusLock !== undefined) {
				statusLock = input.expectedStatusLock + 1;
				fields.push("status_lock = ?");
				params.push(statusLock);
			}
			if (!input.preserveUpdatedAt) {
				fields.push("updated_at = ?");
				params.push(nowIso());
			}
			let sql = `UPDATE sessions SET ${fields.join(", ")} WHERE session_id = ?`;
			params.push(input.sessionId);
			if (input.expectedStatusLock !== undefined) {
				sql += " AND status_lock = ?";
				params.push(input.expectedStatusLock);
			}
			const changed = db.prepare(sql).run(...params);
			const updated = (changed.changes ?? 0) > 0;
			if (!updated) {
				return {
					value: { updated: false, statusLock: 0 },
					applied: false,
				};
			}
			if (input.expectedStatusLock === undefined) {
				const row = db
					.prepare(`SELECT status_lock FROM sessions WHERE session_id = ?`)
					.get(input.sessionId);
				statusLock = Number(row?.status_lock ?? 0);
			}
			return {
				value: { updated: true, statusLock },
				applied: true,
			};
		});
	}

	create(record: SessionRecord): void {
		const now = nowIso();
		this.#runSessionWriterMutation({ sessionId: record.sessionId }, (db) => {
			db.prepare(
				`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				record.sessionId,
				record.source,
				record.pid,
				record.startedAt,
				record.endedAt ?? null,
				record.exitCode ?? null,
				record.status,
				0,
				toBoolInt(record.interactive),
				record.provider,
				record.model,
				record.cwd,
				record.workspaceRoot,
				record.teamName ?? null,
				toBoolInt(record.enableTools),
				toBoolInt(record.enableSpawn),
				toBoolInt(record.enableTeams),
				record.parentSessionId ?? null,
				record.parentAgentId ?? null,
				record.agentId ?? null,
				record.conversationId ?? null,
				toBoolInt(record.isSubagent),
				record.prompt ?? null,
				record.metadata ? JSON.stringify(record.metadata) : null,
				"",
				record.hookPath ?? "",
				record.messagesPath ?? null,
				now,
			);
			return { value: undefined, applied: true };
		});
	}

	update(
		record: Partial<Omit<SessionRecord, "messagesPath">> & {
			sessionId: string;
			messagesPath?: string | null;
		},
	): void {
		const fields: string[] = [];
		const params: unknown[] = [];
		if (record.endedAt !== undefined) {
			fields.push("ended_at = ?");
			params.push(record.endedAt);
		}
		if (record.exitCode !== undefined) {
			fields.push("exit_code = ?");
			params.push(record.exitCode);
		}
		if (record.status !== undefined) {
			fields.push("status = ?");
			params.push(record.status);
		}
		if (record.prompt !== undefined) {
			fields.push("prompt = ?");
			params.push(record.prompt);
		}
		if (record.metadata !== undefined) {
			fields.push("metadata_json = ?");
			params.push(record.metadata ? JSON.stringify(record.metadata) : null);
		}
		if (record.parentSessionId !== undefined) {
			fields.push("parent_session_id = ?");
			params.push(record.parentSessionId);
		}
		if (record.parentAgentId !== undefined) {
			fields.push("parent_agent_id = ?");
			params.push(record.parentAgentId);
		}
		if (record.agentId !== undefined) {
			fields.push("agent_id = ?");
			params.push(record.agentId);
		}
		if (record.conversationId !== undefined) {
			fields.push("conversation_id = ?");
			params.push(record.conversationId);
		}
		if (record.messagesPath !== undefined) {
			fields.push("messages_path = ?");
			params.push(record.messagesPath);
		}
		if (record.updatedAt !== undefined) {
			fields.push("updated_at = ?");
			params.push(record.updatedAt);
		}
		if (fields.length === 0) {
			return;
		}
		if (record.updatedAt === undefined) {
			fields.push("updated_at = ?");
			params.push(nowIso());
		}
		params.push(record.sessionId);
		this.#runSessionWriterMutation({ sessionId: record.sessionId }, (db) => {
			const changed = db
				.prepare(
					`UPDATE sessions SET ${fields.join(", ")} WHERE session_id = ?`,
				)
				.run(...params);
			return {
				value: undefined,
				applied: (changed.changes ?? 0) > 0,
			};
		});
	}

	updateStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): void {
		this.update({
			sessionId,
			status,
			endedAt: isNonTerminalSessionStatus(status) ? null : nowIso(),
			exitCode: isNonTerminalSessionStatus(status)
				? null
				: (exitCode ?? (status === "failed" ? 1 : 0)),
		});
	}

	get(sessionId: string): SessionRecord | undefined {
		const row = this.queryOne<Record<string, unknown>>(
			`SELECT session_id, source, pid, started_at, ended_at, exit_code, status, interactive,
				provider, model, cwd, workspace_root, team_name,
				enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent,
				prompt, metadata_json, hook_path, messages_path, updated_at
			 FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		if (!row) {
			return undefined;
		}
		return {
			sessionId: asString(row.session_id),
			source: asString(row.source) as SessionRecord["source"],
			pid: Number(row.pid ?? 0),
			startedAt: asString(row.started_at),
			endedAt: (row.ended_at as string | null | undefined) ?? null,
			exitCode: (row.exit_code as number | null | undefined) ?? null,
			status: asString(row.status) as SessionRecord["status"],
			interactive: asBool(row.interactive),
			provider: asString(row.provider),
			model: asString(row.model),
			cwd: asString(row.cwd),
			workspaceRoot: asString(row.workspace_root),
			teamName: asOptionalString(row.team_name),
			enableTools: asBool(row.enable_tools),
			enableSpawn: asBool(row.enable_spawn),
			enableTeams: asBool(row.enable_teams),
			parentSessionId: asOptionalString(row.parent_session_id),
			parentAgentId: asOptionalString(row.parent_agent_id),
			agentId: asOptionalString(row.agent_id),
			conversationId: asOptionalString(row.conversation_id),
			isSubagent: asBool(row.is_subagent),
			prompt: asOptionalString(row.prompt),
			metadata: (() => {
				const raw = asOptionalString(row.metadata_json);
				if (!raw) {
					return undefined;
				}
				try {
					const parsed = JSON.parse(raw) as unknown;
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						return parsed as Record<string, unknown>;
					}
				} catch {
					// Ignore malformed metadata payloads.
				}
				return undefined;
			})(),
			hookPath: asOptionalString(row.hook_path),
			messagesPath: asOptionalString(row.messages_path),
			updatedAt: asOptionalString(row.updated_at) ?? nowIso(),
		};
	}

	list(limit = 200): SessionRecord[] {
		const rows = this.queryAll<Record<string, unknown>>(
			`SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT ?`,
			[limit],
		);
		const result: SessionRecord[] = [];
		for (const row of rows) {
			const item = this.get(asString(row.session_id));
			if (item) {
				result.push(item);
			}
		}
		return result;
	}

	/**
	 * Child sessions — subagent runs and team-task runs — recorded under a
	 * parent, oldest first so a caller can present them in spawn order.
	 */
	listChildren(parentSessionId: string, limit = 200): SessionRecord[] {
		const rows = this.queryAll<Record<string, unknown>>(
			`SELECT session_id FROM sessions WHERE parent_session_id = ?
			 ORDER BY started_at ASC LIMIT ?`,
			[parentSessionId, limit],
		);
		const result: SessionRecord[] = [];
		for (const row of rows) {
			const item = this.get(asString(row.session_id));
			if (item) {
				result.push(item);
			}
		}
		return result;
	}

	delete(sessionId: string, cascade = false): boolean {
		return this.#runSessionWriterMutation({ sessionId }, (db) => {
			if (cascade) {
				const managedChild = db
					.prepare(
						`SELECT h.session_id
							 FROM session_writer_heads h
							 JOIN sessions s ON s.session_id = h.session_id
							 WHERE s.parent_session_id = ?
							 LIMIT 1`,
					)
					.get(sessionId);
				if (managedChild) {
					throw new SessionWriterFenceRejectedError(
						String(managedChild.session_id ?? sessionId),
						"generic cascade deletion cannot remove catalog-managed sessions",
					);
				}
			}
			const changed =
				db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId)
					.changes ?? 0;
			if (cascade) {
				db.prepare(`DELETE FROM sessions WHERE parent_session_id = ?`).run(
					sessionId,
				);
			}
			return { value: changed > 0, applied: changed > 0 };
		});
	}
}
