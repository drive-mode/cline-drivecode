import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
	AgentExtensionCommandInvocationContext,
	AgentExtensionStateMutationRequest,
	AgentExtensionStateSnapshot,
} from "@cline/shared";
import {
	asOptionalString,
	asString,
	loadSqliteDb,
	type SqliteDb,
} from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";

const MAX_VALUE_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 1_000;
const STATE_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const ID_MAX_LENGTH = 512;

function hasControlCharacters(value: string): boolean {
	for (const character of value) {
		if (character.charCodeAt(0) <= 0x1f) return true;
	}
	return false;
}

export interface SqliteExtensionStateStoreOptions {
	dataDir?: string;
}

export interface ApplyExtensionStateMutationInput {
	extensionId: string;
	invocation: AgentExtensionCommandInvocationContext;
	mutation: AgentExtensionStateMutationRequest;
	/** Host snapshot revision shown to the command before it returned. */
	expectedRevision: number;
}

export interface ApplyExtensionStateMutationResult {
	applied: boolean;
	snapshot: AgentExtensionStateSnapshot;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function boundedId(value: string | undefined, label: string): string {
	const trimmed = value?.trim() ?? "";
	if (
		!trimmed ||
		trimmed.length > ID_MAX_LENGTH ||
		hasControlCharacters(trimmed)
	) {
		throw new TypeError(`${label} is missing or invalid`);
	}
	return trimmed;
}

function normalizeJson(
	value: unknown,
	depth = 0,
	counter = { value: 0 },
): JsonValue {
	if (depth > MAX_JSON_DEPTH || ++counter.value > MAX_JSON_NODES) {
		throw new TypeError("extension state value exceeds structural limits");
	}
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError("extension state numbers must be finite");
		}
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => normalizeJson(entry, depth + 1, counter));
	}
	if (typeof value !== "object" || value === null) {
		throw new TypeError("extension state value must be JSON serializable");
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError("extension state value must use plain JSON objects");
	}
	const out: Record<string, JsonValue> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		if (!key || key.length > 128 || hasControlCharacters(key)) {
			throw new TypeError("extension state object key is invalid");
		}
		out[key] = normalizeJson(
			(value as Record<string, unknown>)[key],
			depth + 1,
			counter,
		);
	}
	return out;
}

function canonicalJson(value: unknown): string {
	const json = JSON.stringify(normalizeJson(value));
	if (Buffer.byteLength(json, "utf8") > MAX_VALUE_BYTES) {
		throw new TypeError("extension state value exceeds byte limit");
	}
	return json;
}

function parseJson(value: unknown): unknown {
	if (typeof value !== "string") return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function validateMutation(mutation: AgentExtensionStateMutationRequest): void {
	if (!STATE_KEY_PATTERN.test(mutation.key)) {
		throw new TypeError("extension state key is invalid");
	}
	if (mutation.operation === "replace") {
		if (mutation.value === undefined) {
			throw new TypeError("replace requires an extension state value");
		}
		return;
	}
	if (mutation.operation === "clear") {
		if (mutation.value !== undefined) {
			throw new TypeError("clear cannot include an extension state value");
		}
		return;
	}
	throw new TypeError("extension state operation is invalid");
}

function ensureSchema(db: SqliteDb): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec(`CREATE TABLE IF NOT EXISTS extension_state_scopes (
		workspace_root TEXT NOT NULL,
		session_id TEXT NOT NULL,
		extension_id TEXT NOT NULL,
		revision INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (workspace_root, session_id, extension_id)
	);`);
	db.exec(`CREATE TABLE IF NOT EXISTS extension_state_entries (
		workspace_root TEXT NOT NULL,
		session_id TEXT NOT NULL,
		extension_id TEXT NOT NULL,
		state_key TEXT NOT NULL,
		value_json TEXT NOT NULL,
		revision INTEGER NOT NULL,
		invocation_id TEXT NOT NULL,
		actor_kind TEXT NOT NULL,
		actor_id TEXT,
		source_kind TEXT NOT NULL,
		transport TEXT,
		thread_id TEXT,
		PRIMARY KEY (workspace_root, session_id, extension_id, state_key)
	);`);
	db.exec(`CREATE TABLE IF NOT EXISTS extension_state_invocations (
		workspace_root TEXT NOT NULL,
		session_id TEXT NOT NULL,
		extension_id TEXT NOT NULL,
		invocation_id TEXT NOT NULL,
		mutation_digest TEXT NOT NULL,
		resulting_revision INTEGER NOT NULL,
		applied INTEGER NOT NULL,
		PRIMARY KEY (workspace_root, session_id, extension_id, invocation_id)
	);`);
}

export class SqliteExtensionStateStore {
	private readonly dataDir: string;
	private db: SqliteDb | undefined;

	constructor(options: SqliteExtensionStateStoreOptions = {}) {
		this.dataDir = options.dataDir ?? resolveDbDataDir();
	}

	dbPath(): string {
		return resolve(this.dataDir, "extension-state.db");
	}

	private getDb(): SqliteDb {
		if (!this.db) {
			this.db = loadSqliteDb(this.dbPath());
			ensureSchema(this.db);
		}
		return this.db;
	}

	close(): void {
		this.db?.close?.();
		this.db = undefined;
	}

	applyMutation(
		input: ApplyExtensionStateMutationInput,
	): ApplyExtensionStateMutationResult {
		const workspaceRoot = resolve(
			boundedId(input.invocation.workspaceRoot, "workspace root"),
		);
		const sessionId = boundedId(input.invocation.task.sessionId, "session id");
		const extensionId = boundedId(input.extensionId, "extension id");
		boundedId(input.invocation.invocationId, "invocation id");
		if (input.invocation.actor.kind !== "human") {
			throw new TypeError(
				"only a host-attributed human invocation may mutate extension state",
			);
		}
		validateMutation(input.mutation);
		if (
			!Number.isSafeInteger(input.expectedRevision) ||
			input.expectedRevision < 0
		) {
			throw new TypeError("expected extension state revision is invalid");
		}
		const valueJson =
			input.mutation.operation === "replace"
				? canonicalJson(input.mutation.value)
				: undefined;
		const mutationDigest = createHash("sha256")
			.update(
				canonicalJson({
					key: input.mutation.key,
					operation: input.mutation.operation,
					...(valueJson === undefined ? {} : { value: parseJson(valueJson) }),
				}),
			)
			.digest("hex");
		const db = this.getDb();
		let applied = false;
		db.exec("BEGIN IMMEDIATE;");
		try {
			const replay = db
				.prepare(
					`SELECT mutation_digest FROM extension_state_invocations
					 WHERE workspace_root = ? AND session_id = ? AND extension_id = ? AND invocation_id = ?`,
				)
				.get(
					workspaceRoot,
					sessionId,
					extensionId,
					input.invocation.invocationId,
				);
			if (replay) {
				if (asString(replay.mutation_digest) !== mutationDigest) {
					throw new TypeError(
						"invocation id was replayed with a different mutation",
					);
				}
				db.exec("COMMIT;");
				return {
					applied: false,
					snapshot: this.snapshot({ workspaceRoot, sessionId, extensionId }),
				};
			}
			const currentScope = db
				.prepare(
					`SELECT revision FROM extension_state_scopes
					 WHERE workspace_root = ? AND session_id = ? AND extension_id = ?`,
				)
				.get(workspaceRoot, sessionId, extensionId);
			const currentRevision = Number(currentScope?.revision ?? 0);
			if (currentRevision !== input.expectedRevision) {
				throw new TypeError(
					"extension state changed while the command was running",
				);
			}
			const existing = db
				.prepare(
					`SELECT value_json FROM extension_state_entries
					 WHERE workspace_root = ? AND session_id = ? AND extension_id = ? AND state_key = ?`,
				)
				.get(workspaceRoot, sessionId, extensionId, input.mutation.key);
			const changed =
				input.mutation.operation === "clear"
					? Boolean(existing)
					: asOptionalString(existing?.value_json) !== valueJson;
			if (changed) {
				db.prepare(
					`INSERT INTO extension_state_scopes (workspace_root, session_id, extension_id, revision)
					 VALUES (?, ?, ?, 1)
					 ON CONFLICT(workspace_root, session_id, extension_id)
					 DO UPDATE SET revision = revision + 1`,
				).run(workspaceRoot, sessionId, extensionId);
				const scope = db
					.prepare(
						`SELECT revision FROM extension_state_scopes
						 WHERE workspace_root = ? AND session_id = ? AND extension_id = ?`,
					)
					.get(workspaceRoot, sessionId, extensionId);
				const revision = Number(scope?.revision ?? 0);
				if (input.mutation.operation === "clear") {
					db.prepare(
						`DELETE FROM extension_state_entries
						 WHERE workspace_root = ? AND session_id = ? AND extension_id = ? AND state_key = ?`,
					).run(workspaceRoot, sessionId, extensionId, input.mutation.key);
				} else {
					db.prepare(
						`INSERT INTO extension_state_entries (
							workspace_root, session_id, extension_id, state_key, value_json, revision,
							invocation_id, actor_kind, actor_id, source_kind, transport, thread_id
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(workspace_root, session_id, extension_id, state_key) DO UPDATE SET
							value_json = excluded.value_json,
							revision = excluded.revision,
							invocation_id = excluded.invocation_id,
							actor_kind = excluded.actor_kind,
							actor_id = excluded.actor_id,
							source_kind = excluded.source_kind,
							transport = excluded.transport,
							thread_id = excluded.thread_id`,
					).run(
						workspaceRoot,
						sessionId,
						extensionId,
						input.mutation.key,
						valueJson,
						revision,
						input.invocation.invocationId,
						input.invocation.actor.kind,
						input.invocation.actor.id?.trim() || null,
						input.invocation.source.kind,
						input.invocation.source.transport?.trim() || null,
						input.invocation.source.threadId?.trim() || null,
					);
				}
				applied = true;
			}
			const resultingScope = db
				.prepare(
					`SELECT revision FROM extension_state_scopes
					 WHERE workspace_root = ? AND session_id = ? AND extension_id = ?`,
				)
				.get(workspaceRoot, sessionId, extensionId);
			db.prepare(
				`INSERT INTO extension_state_invocations (
					workspace_root, session_id, extension_id, invocation_id,
					mutation_digest, resulting_revision, applied
				) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			).run(
				workspaceRoot,
				sessionId,
				extensionId,
				input.invocation.invocationId,
				mutationDigest,
				Number(resultingScope?.revision ?? currentRevision),
				applied ? 1 : 0,
			);
			db.exec("COMMIT;");
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
		return {
			applied,
			snapshot: this.snapshot({ workspaceRoot, sessionId, extensionId }),
		};
	}

	snapshot(input: {
		workspaceRoot: string;
		sessionId: string;
		extensionId: string;
	}): AgentExtensionStateSnapshot {
		const workspaceRoot = resolve(
			boundedId(input.workspaceRoot, "workspace root"),
		);
		const sessionId = boundedId(input.sessionId, "session id");
		const extensionId = boundedId(input.extensionId, "extension id");
		const db = this.getDb();
		const scope = db
			.prepare(
				`SELECT revision FROM extension_state_scopes
				 WHERE workspace_root = ? AND session_id = ? AND extension_id = ?`,
			)
			.get(workspaceRoot, sessionId, extensionId);
		const rows = db
			.prepare(
				`SELECT state_key, value_json, revision, invocation_id, actor_kind,
					actor_id, source_kind, transport, thread_id
				 FROM extension_state_entries
				 WHERE workspace_root = ? AND session_id = ? AND extension_id = ?
				 ORDER BY state_key ASC`,
			)
			.all(workspaceRoot, sessionId, extensionId);
		const entries: AgentExtensionStateSnapshot["entries"] = {};
		for (const row of rows) {
			const key = asString(row.state_key);
			entries[key] = {
				value: parseJson(row.value_json),
				revision: Number(row.revision ?? 0),
				provenance: {
					invocationId: asString(row.invocation_id),
					actorKind: asString(
						row.actor_kind,
					) as AgentExtensionStateSnapshot["entries"][string]["provenance"]["actorKind"],
					...(asOptionalString(row.actor_id)
						? { actorId: asOptionalString(row.actor_id) }
						: {}),
					sourceKind: asString(
						row.source_kind,
					) as AgentExtensionStateSnapshot["entries"][string]["provenance"]["sourceKind"],
					...(asOptionalString(row.transport)
						? { transport: asOptionalString(row.transport) }
						: {}),
					...(asOptionalString(row.thread_id)
						? { threadId: asOptionalString(row.thread_id) }
						: {}),
				},
			};
		}
		return {
			workspaceRoot,
			sessionId,
			extensionId,
			revision: Number(scope?.revision ?? 0),
			entries,
		};
	}
}
