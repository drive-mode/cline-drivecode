import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import type {
	ChatBindingRecord,
	ChatCatalogErrorCode,
	ChatCatalogRecord,
	ChatCatalogState,
	ChatDetail,
	ChatEventRecord,
	ChatListCursor,
	ChatMutationProvenance,
	ChatPage,
	ChatSessionRecord,
	ChatSessionRelationKind,
	HubChatProjectionChat,
	SessionLeaseRecord,
	SharedSessionStatus,
} from "@cline/shared";
import {
	CHAT_AUDIENCE_UNASSIGNED,
	CHAT_PROJECTION_MAX_BINDINGS_PER_CHAT,
	CHAT_PROJECTION_MAX_SESSIONS_PER_CHAT,
	HUB_CHAT_PROJECTION_CHAT_SCHEMA,
} from "@cline/shared";
import {
	asOptionalString,
	asString,
	ensureDatabaseTenant,
	ensureSessionSchema,
	loadSqliteDb,
	type SqliteDb,
	SqliteTenantOwnershipError,
} from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import {
	type ReserveCatalogRootSessionInput,
	stringifyMetadata,
} from "../session/models/session-row";
import type { ChatCatalogMutationFence } from "./chat-catalog-authority";
import type {
	CatalogAudienceLifecycleEvent,
	CatalogAudienceLifecycleEventBatch,
	CatalogLifecycleEvent,
	CatalogLifecycleEventBatch,
	CatalogLifecycleEventType,
} from "./chat-catalog-event-source";
import { CATALOG_LIFECYCLE_EVENT_TYPES } from "./chat-catalog-event-source";
import {
	type ManagedProfileAuthority,
	normalizeManagedProfileAuthority,
	readManagedProfileAuthority,
} from "./managed-profile-authority";

const CHAT_CATALOG_SCHEMA_VERSION = 5;
const MAX_ID_LENGTH = 512;
const MAX_TITLE_LENGTH = 512;
const DEFAULT_LEASE_TTL_MS = 60_000;
const MAX_LEASE_TTL_MS = 5 * 60_000;
const DEFAULT_PURGE_ATTEMPT_STALE_MS = 5 * 60_000;
const DEFAULT_EVENT_BATCH_LIMIT = 256;
const MAX_EVENT_BATCH_LIMIT = 1_024;
const MAX_REKEY_REPLAY_CREDENTIALS = 1_024;
const CHAT_AUDIENCE_MIGRATION_FORMAT_VERSION = 1;
const LOCAL_CATALOG_AUDIENCE_ID = "aud_local_catalog_v1";
const catalogLifecycleEventTypes = new Set<string>(
	CATALOG_LIFECYCLE_EVENT_TYPES,
);

type RawRow = Record<string, unknown>;

function assertMutationFence(
	fence: ChatCatalogMutationFence | undefined,
): void {
	if (!fence) return;
	fence.signal.throwIfAborted();
	fence.assertActive();
	fence.signal.throwIfAborted();
}

export class ChatCatalogError extends Error {
	constructor(
		public readonly code: ChatCatalogErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ChatCatalogError";
	}
}

export interface SqliteChatCatalogServiceOptions {
	dataDir?: string;
	/** One catalog database is durably assigned to exactly one tenant. */
	tenantId?: string;
	clock?: () => Date;
	defaultLeaseTtlMs?: number;
	maxLeaseTtlMs?: number;
	purgeAttemptStaleMs?: number;
	purgeAttemptHeartbeatMs?: number;
	artifactCleanup?: ChatArtifactCleanupPort;
	/**
	 * Exact, server-owned mappings used only to upgrade pre-audience rows. The
	 * complete reserved writer-fenced stamp must match byte-for-byte after
	 * canonical JSON normalization; duplicate stamps mapped to different
	 * audiences remain quarantined.
	 */
	audienceMigrationMappings?: readonly ChatAudienceMigrationMapping[];
}

export interface ChatAudienceMigrationMapping {
	readonly profileAuthority: ManagedProfileAuthority;
	readonly audienceId: string;
}

export interface ChatArtifactCleanupPort {
	/**
	 * Must be idempotent for one attemptId and must honor `signal` before every
	 * destructive effect. Core aborts immediately if heartbeat fencing is lost.
	 */
	cleanupChatArtifacts(input: {
		chatId: string;
		sessionIds: string[];
		attemptId: string;
		signal: AbortSignal;
	}): Promise<{ receiptId: string }>;
}

export interface AdoptRootSessionInput {
	chatId: string;
	sessionId: string;
	/** Trusted catalog authority; never accepted from a managed wire payload. */
	audienceId?: string;
	title?: string;
	titleSource?: string;
	provenance: ChatMutationProvenance;
}

/**
 * Trusted local admission input for a brand-new writable root session.
 *
 * Session reservation, root-chat membership, and the initial writer lease are
 * committed in one SQLite transaction. Callers must not materialize artifacts
 * until this operation returns the fresh lease credential.
 */
export interface AdmitRootSessionInput extends ReserveCatalogRootSessionInput {
	chatId: string;
	/** Trusted catalog authority; never accepted from a managed wire payload. */
	audienceId?: string;
	title?: string;
	titleSource?: string;
	ttlMs?: number;
	provenance: ChatMutationProvenance;
}

export interface AdmitRootSessionResult {
	applied: boolean;
	chat: ChatDetail;
	lease: SessionLeaseRecord;
	/** Returned only by the transaction winner; never persisted in plaintext. */
	leaseToken?: string;
}

/**
 * Trusted local admission for a writable session with explicit chat lineage.
 *
 * Branch relations create a new derived chat. Successor relations advance the
 * current chat head under revision CAS. In both cases the inert session row,
 * membership, writer head, and first lease commit before artifacts may exist.
 */
export interface AdmitRelatedSessionInput
	extends ReserveCatalogRootSessionInput {
	chatId: string;
	/** Trusted catalog authority; never accepted from a managed wire payload. */
	audienceId?: string;
	parentSessionId: string;
	relationKind: Extract<
		ChatSessionRelationKind,
		"fork" | "checkpoint_restore" | "config_restart" | "recovery"
	>;
	/** Required only for config_restart/recovery and forbidden for branches. */
	expectedRevision?: number;
	title?: string;
	titleSource?: string;
	ttlMs?: number;
	provenance: ChatMutationProvenance;
}

export type AdmitRelatedSessionResult = AdmitRootSessionResult;

export interface RecordBranchInput {
	chatId: string;
	sessionId: string;
	sourceChatId: string;
	sourceSessionId: string;
	relationKind: Extract<ChatSessionRelationKind, "fork" | "checkpoint_restore">;
	title?: string;
	titleSource?: string;
	provenance: ChatMutationProvenance;
}

export interface AttachSuccessorSessionInput {
	chatId: string;
	sessionId: string;
	parentSessionId: string;
	relationKind: Extract<ChatSessionRelationKind, "config_restart" | "recovery">;
	expectedRevision: number;
	provenance: ChatMutationProvenance;
}

export interface RecordChatActivityInput {
	chatId: string;
	sessionId: string;
	expectedRevision: number;
	provenance: ChatMutationProvenance;
}

export interface ChatLifecycleMutationInput {
	chatId: string;
	expectedRevision: number;
	/** Confirmation-bound declaration that callers quiesced running members. */
	stopRunningIntent?: boolean;
	/** Atomically clear current bindings when archiving. */
	clearBindings?: boolean;
	provenance: ChatMutationProvenance;
}

export interface RenameChatInput {
	chatId: string;
	title: string;
	expectedRevision: number;
	provenance: ChatMutationProvenance;
}

export interface ChatMutationResult<T> {
	applied: boolean;
	value: T;
}

export interface ListChatsInput {
	workspaceKey: string;
	/** Optional trusted target scope. The quarantine namespace is always empty. */
	audienceId?: string;
	catalogState?: "active" | "archived" | "all";
	sourceKind?: string;
	limit?: number;
	cursor?: ChatListCursor;
}

export interface ChatBindingScope {
	transport: string;
	instanceId?: string;
	channelId?: string;
	threadId?: string;
	participantScope?: string;
}

export interface BindChatInput extends ChatBindingScope {
	bindingId: string;
	chatId: string;
	sessionId: string;
	expectedBindingRevision: number;
	provenance: ChatMutationProvenance;
}

export interface UnbindChatInput extends ChatBindingScope {
	expectedBindingId: string;
	expectedChatId: string;
	expectedSessionId: string;
	expectedBindingRevision: number;
	provenance: ChatMutationProvenance;
}

export interface AcquireSessionLeaseInput {
	sessionId: string;
	expectedRevision: number;
	ttlMs?: number;
	provenance: ChatMutationProvenance;
}

export interface ReleaseSessionLeaseInput {
	sessionId: string;
	leaseToken: string;
	expectedRevision: number;
	provenance: ChatMutationProvenance;
}

export interface RenewSessionLeaseInput extends ReleaseSessionLeaseInput {
	ttlMs?: number;
}

export interface RekeySessionLeaseInput extends RenewSessionLeaseInput {
	expectedWriterGeneration: number;
}

export interface RekeySessionLeaseResult
	extends ChatMutationResult<SessionLeaseRecord> {
	leaseToken: string;
}

export interface VerifySessionLeaseInput {
	sessionId: string;
	leaseToken: string;
	expectedRevision: number;
}

export interface RevokeSessionLeaseInput {
	sessionId: string;
	expectedRevision: number;
	provenance: ChatMutationProvenance;
}

export interface AcquireSessionLeaseResult
	extends ChatMutationResult<SessionLeaseRecord> {
	leaseToken?: string;
}

export type PurgeChatInput = ChatLifecycleMutationInput;

export interface PurgeChatResult {
	applied: boolean;
	purged: boolean;
	chatId: string;
	sessionIds: string[];
}

export interface ChatAudienceInventoryCursor {
	readonly chatId: string;
}

export interface ChatAudienceInventoryItem {
	readonly chatId: string;
	readonly workspaceKey: string;
	readonly revision: number;
	readonly sessionCount: number;
}

export interface ChatAudienceInventoryPage {
	readonly items: readonly ChatAudienceInventoryItem[];
	readonly nextCursor?: ChatAudienceInventoryCursor;
}

export interface AssignChatAudienceInput {
	readonly chatId: string;
	readonly audienceId: string;
	readonly expectedRevision: number;
	readonly reason: string;
	readonly provenance: ChatMutationProvenance;
}

export interface CatalogAudienceProjectionSnapshot {
	readonly snapshotSequence: number;
	readonly chats: readonly HubChatProjectionChat[];
}

export interface CatalogAudienceProjectionGetResult {
	readonly snapshotSequence: number;
	readonly chat: HubChatProjectionChat | null;
}

export interface StoredChatMutationOutcome {
	invocationId: string;
	operation: string;
	resultChatId?: string;
	resultRevision: number;
	applied: boolean;
}

interface FinalizePurgeInput extends ChatLifecycleMutationInput {
	attemptId: string;
	receiptId: string;
	intentDigest: string;
}

function hasControlCharacters(value: string): boolean {
	for (const character of value) {
		if (character.charCodeAt(0) <= 0x1f) return true;
	}
	return false;
}

function boundedRequired(
	value: string | undefined,
	label: string,
	maxLength = MAX_ID_LENGTH,
): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed || trimmed.length > maxLength || hasControlCharacters(trimmed)) {
		throw new ChatCatalogError(
			"invalid_input",
			`${label} is missing or invalid`,
		);
	}
	return trimmed;
}

function boundedOptional(
	value: string | undefined,
	label: string,
	maxLength = MAX_ID_LENGTH,
): string {
	const trimmed = value?.trim() ?? "";
	if (trimmed.length > maxLength || hasControlCharacters(trimmed)) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	return trimmed;
}

function boundedErrorMessage(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error);
	return Array.from(raw)
		.map((character) => (character.charCodeAt(0) <= 0x1f ? " " : character))
		.join("")
		.trim()
		.slice(0, 1024);
}

function validRevision(value: number, label = "expected revision"): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	return value;
}

function canonicalTime(value: string, label: string): string {
	const input = boundedRequired(value, label, 128);
	const timestamp = new Date(input);
	if (!Number.isFinite(timestamp.getTime())) {
		throw new ChatCatalogError("invalid_input", `${label} is invalid`);
	}
	return timestamp.toISOString();
}

function canonicalWorkspace(value: string | undefined, label: string): string {
	const workspace = boundedRequired(value, label);
	if (!isAbsolute(workspace)) {
		throw new ChatCatalogError("invalid_input", `${label} must be absolute`);
	}
	return resolve(workspace);
}

function normalizeAudienceId(
	value: string | undefined,
	label = "audience id",
	options: { allowUnassigned?: boolean } = {},
): string {
	const audienceId = boundedRequired(value, label);
	if (!options.allowUnassigned && audienceId === CHAT_AUDIENCE_UNASSIGNED) {
		throw new ChatCatalogError(
			"unsupported_capability",
			`${label} cannot use the catalog quarantine namespace`,
		);
	}
	return audienceId;
}

function admissionAudienceId(input: {
	trustedAudienceId?: string;
	metadata: Readonly<Record<string, unknown>>;
}): string {
	if (input.trustedAudienceId !== undefined) {
		return normalizeAudienceId(input.trustedAudienceId);
	}
	return LOCAL_CATALOG_AUDIENCE_ID;
}

interface NormalizedAudienceMigrationMapping {
	readonly stampJson: string;
	readonly audienceId: string;
}

function normalizeAudienceMigrationMappings(
	input: readonly ChatAudienceMigrationMapping[] | undefined,
): readonly NormalizedAudienceMigrationMapping[] {
	if (!input) return Object.freeze([]);
	if (!Array.isArray(input) || input.length > 1_024) {
		throw new ChatCatalogError(
			"invalid_input",
			"audience migration mapping set is invalid",
		);
	}
	return Object.freeze(
		input.map((mapping) => {
			if (
				!mapping.profileAuthority ||
				typeof mapping.profileAuthority !== "object" ||
				Array.isArray(mapping.profileAuthority)
			) {
				throw new ChatCatalogError(
					"invalid_input",
					"audience migration profile stamp is invalid",
				);
			}
			let profileAuthority: ManagedProfileAuthority;
			try {
				profileAuthority = normalizeManagedProfileAuthority(
					mapping.profileAuthority,
				);
			} catch {
				throw new ChatCatalogError(
					"invalid_input",
					"audience migration profile stamp is invalid",
				);
			}
			return Object.freeze({
				stampJson: canonicalJson(profileAuthority),
				audienceId: normalizeAudienceId(mapping.audienceId),
			});
		}),
	);
}

function parseDeliverySessionIds(value: unknown): readonly string[] {
	try {
		const parsed = JSON.parse(asString(value));
		if (!Array.isArray(parsed)) throw new Error("not an array");
		const sessionIds = parsed.map((sessionId) =>
			boundedRequired(
				typeof sessionId === "string" ? sessionId : undefined,
				"event session id",
			),
		);
		if (
			sessionIds.length === 0 ||
			new Set(sessionIds).size !== sessionIds.length
		) {
			throw new Error("invalid membership snapshot");
		}
		return Object.freeze(sessionIds);
	} catch {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog event delivery membership is invalid",
		);
	}
}

function parseCatalogLifecycleEventType(
	value: unknown,
): CatalogLifecycleEventType {
	const eventType = asString(value);
	if (!catalogLifecycleEventTypes.has(eventType)) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog lifecycle event type is unsupported",
		);
	}
	return eventType as CatalogLifecycleEventType;
}

function canonicalValue(value: unknown): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new ChatCatalogError(
				"invalid_input",
				"intent contains non-finite number",
			);
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (typeof value !== "object" || value === null) {
		throw new ChatCatalogError(
			"invalid_input",
			"intent is not JSON serializable",
		);
	}
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		result[key] = canonicalValue((value as Record<string, unknown>)[key]);
	}
	return result;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalValue(value));
}

function digestIntent(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function digestLeaseToken(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function phaseProvenance(
	provenance: ChatMutationProvenance,
	phase: string,
): ChatMutationProvenance {
	return {
		...provenance,
		invocationId: createHash("sha256")
			.update(`${provenance.invocationId}:${phase}`)
			.digest("hex"),
	};
}

function secureDigestEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left, "hex");
	const rightBytes = Buffer.from(right, "hex");
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

function parsePayload(value: unknown): Record<string, unknown> {
	if (typeof value !== "string") return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function normalizeProvenance(
	input: ChatMutationProvenance,
): ChatMutationProvenance {
	if (input.actor.kind !== "human" && input.actor.kind !== "system") {
		throw new ChatCatalogError("invalid_input", "actor kind is invalid");
	}
	if (
		!["interactive", "connector", "hub", "migration", "system"].includes(
			input.source.kind,
		)
	) {
		throw new ChatCatalogError("invalid_input", "source kind is invalid");
	}
	return {
		invocationId: boundedRequired(input.invocationId, "invocation id"),
		occurredAt: canonicalTime(input.occurredAt, "occurred at"),
		actor: {
			kind: input.actor.kind,
			...(boundedOptional(input.actor.id, "actor id")
				? { id: boundedOptional(input.actor.id, "actor id") }
				: {}),
			...(boundedOptional(input.actor.label, "actor label")
				? { label: boundedOptional(input.actor.label, "actor label") }
				: {}),
		},
		source: {
			kind: input.source.kind,
			...(boundedOptional(input.source.transport, "transport")
				? { transport: boundedOptional(input.source.transport, "transport") }
				: {}),
			...(boundedOptional(input.source.threadId, "thread id")
				? { threadId: boundedOptional(input.source.threadId, "thread id") }
				: {}),
			...(boundedOptional(input.source.channelId, "channel id")
				? { channelId: boundedOptional(input.source.channelId, "channel id") }
				: {}),
		},
	};
}

function requireHuman(provenance: ChatMutationProvenance): void {
	if (provenance.actor.kind !== "human") {
		throw new ChatCatalogError(
			"invalid_input",
			"lifecycle mutation requires a host-attributed human actor",
		);
	}
}

function requireActorId(provenance: ChatMutationProvenance): string {
	return boundedRequired(provenance.actor.id, "actor id");
}

function normalizeScope(input: ChatBindingScope): Required<ChatBindingScope> {
	return {
		transport: boundedRequired(input.transport, "binding transport"),
		instanceId: boundedOptional(input.instanceId, "binding instance id"),
		channelId: boundedOptional(input.channelId, "binding channel id"),
		threadId: boundedOptional(input.threadId, "binding thread id"),
		participantScope: boundedOptional(
			input.participantScope,
			"binding participant scope",
		),
	};
}

function mapChat(row: RawRow): ChatCatalogRecord {
	return {
		chatId: asString(row.chat_id),
		workspaceKey: asString(row.workspace_key),
		catalogState: asString(row.catalog_state) as ChatCatalogState,
		headSessionId: asString(row.head_session_id),
		...(asOptionalString(row.parent_chat_id)
			? { parentChatId: asOptionalString(row.parent_chat_id) }
			: {}),
		...(asOptionalString(row.title)
			? { title: asOptionalString(row.title) }
			: {}),
		...(asOptionalString(row.title_source)
			? { titleSource: asOptionalString(row.title_source) }
			: {}),
		sourceKind: asString(row.source_kind),
		createdAt: asString(row.created_at),
		lastActivityAt: asString(row.last_activity_at),
		...(asOptionalString(row.archived_at)
			? { archivedAt: asOptionalString(row.archived_at) }
			: {}),
		revision: Number(row.revision ?? 0),
	};
}

function mapBinding(row: RawRow): ChatBindingRecord {
	return {
		bindingId: asString(row.binding_id),
		transport: asString(row.transport),
		instanceId: asString(row.instance_id),
		channelId: asString(row.channel_id),
		threadId: asString(row.thread_id),
		participantScope: asString(row.participant_scope),
		bound: Number(row.is_bound ?? 0) === 1,
		...(asOptionalString(row.chat_id)
			? { chatId: asOptionalString(row.chat_id) }
			: {}),
		...(asOptionalString(row.session_id)
			? { sessionId: asOptionalString(row.session_id) }
			: {}),
		revision: Number(row.revision ?? 0),
		updatedAt: asString(row.updated_at),
	};
}

function mapLease(row: RawRow): SessionLeaseRecord {
	return {
		sessionId: asString(row.session_id),
		ownerId: asString(row.owner_id),
		active: Number(row.is_active ?? 0) === 1,
		expiresAt: asString(row.expires_at),
		revision: Number(row.revision ?? 0),
		writerGeneration: Number(row.writer_generation ?? 0),
		updatedAt: asString(row.updated_at),
	};
}

function mapProjectionSession(row: RawRow): ChatSessionRecord {
	return {
		chatId: asString(row.chat_id),
		sessionId: asString(row.session_id),
		relationKind: asString(row.relation_kind) as ChatSessionRelationKind,
		...(asOptionalString(row.parent_session_id)
			? { parentSessionId: asOptionalString(row.parent_session_id) }
			: {}),
		ordinal: validRevision(Number(row.ordinal ?? 0), "session ordinal"),
		attachedAt: canonicalTime(asString(row.attached_at), "session attachment"),
		executionStatus: asString(row.status) as SharedSessionStatus,
	};
}

function projectChatRow(
	db: SqliteDb,
	row: RawRow,
): HubChatProjectionChat | null {
	const state = asString(row.catalog_state);
	if (state === "deleting") return null;
	if (state !== "active" && state !== "archived") {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog chat lifecycle state is invalid",
		);
	}
	const chatId = asString(row.chat_id);
	const headSessionId = asString(row.head_session_id);
	const sessionCount = validRevision(
		Number(
			db
				.prepare(
					`SELECT COUNT(*) AS count FROM chat_sessions WHERE chat_id = ?`,
				)
				.get(chatId)?.count ?? 0,
		),
		"chat session count",
	);
	const sessionRows = db
		.prepare(
			`SELECT cs.chat_id, cs.session_id, cs.relation_kind,
			        cs.parent_session_id, cs.ordinal, cs.attached_at, s.status
			 FROM chat_sessions cs
			 JOIN sessions s ON s.session_id = cs.session_id
			 WHERE cs.chat_id = ?
			 ORDER BY cs.ordinal ASC, cs.session_id ASC
			 LIMIT ?`,
		)
		.all(chatId, CHAT_PROJECTION_MAX_SESSIONS_PER_CHAT)
		.map(mapProjectionSession);
	if (!sessionRows.some((session) => session.sessionId === headSessionId)) {
		const head = db
			.prepare(
				`SELECT cs.chat_id, cs.session_id, cs.relation_kind,
				        cs.parent_session_id, cs.ordinal, cs.attached_at, s.status
				 FROM chat_sessions cs
				 JOIN sessions s ON s.session_id = cs.session_id
				 WHERE cs.chat_id = ? AND cs.session_id = ?`,
			)
			.get(chatId, headSessionId);
		if (!head) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog head session is missing from chat lineage",
			);
		}
		if (sessionRows.length >= CHAT_PROJECTION_MAX_SESSIONS_PER_CHAT) {
			sessionRows.pop();
		}
		sessionRows.push(mapProjectionSession(head));
		sessionRows.sort(
			(left, right) =>
				left.ordinal - right.ordinal ||
				left.sessionId.localeCompare(right.sessionId),
		);
	}
	const bindingCount = validRevision(
		Number(
			db
				.prepare(
					`SELECT COUNT(*) AS count FROM chat_bindings
					 WHERE chat_id = ? AND is_bound = 1`,
				)
				.get(chatId)?.count ?? 0,
		),
		"chat binding count",
	);
	const bindings = db
		.prepare(
			`SELECT * FROM chat_bindings
			 WHERE chat_id = ? AND is_bound = 1
			 ORDER BY transport, instance_id, channel_id, thread_id,
			          participant_scope, binding_id
			 LIMIT ?`,
		)
		.all(chatId, CHAT_PROJECTION_MAX_BINDINGS_PER_CHAT)
		.map(mapBinding);
	try {
		return HUB_CHAT_PROJECTION_CHAT_SCHEMA.parse({
			chatId,
			catalogState: state,
			headSessionId,
			...(asOptionalString(row.parent_chat_id)
				? { parentChatId: asOptionalString(row.parent_chat_id) }
				: {}),
			...(asOptionalString(row.title)
				? { title: asOptionalString(row.title) }
				: {}),
			...(asOptionalString(row.title_source)
				? { titleSource: asOptionalString(row.title_source) }
				: {}),
			sourceKind: asString(row.source_kind),
			createdAt: canonicalTime(asString(row.created_at), "chat creation time"),
			lastActivityAt: canonicalTime(
				asString(row.last_activity_at),
				"chat activity time",
			),
			...(asOptionalString(row.archived_at)
				? {
						archivedAt: canonicalTime(
							asOptionalString(row.archived_at) as string,
							"chat archive time",
						),
					}
				: {}),
			revision: validRevision(Number(row.revision ?? 0), "chat revision"),
			sessionCount,
			bindingCount,
			sessions: sessionRows,
			bindings,
		});
	} catch (error) {
		if (error instanceof ChatCatalogError) throw error;
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog chat projection is invalid",
		);
	}
}

function parseStoredProjection(value: unknown): HubChatProjectionChat | null {
	try {
		const parsed = JSON.parse(asString(value)) as unknown;
		return parsed === null
			? null
			: HUB_CHAT_PROJECTION_CHAT_SCHEMA.parse(parsed);
	} catch {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog event projection is invalid",
		);
	}
}

function appendCatalogEvent(
	db: SqliteDb,
	input: {
		chatId: string;
		eventType: CatalogLifecycleEventType;
		aggregateKind: ChatEventRecord["aggregateKind"];
		aggregateId: string;
		provenance: ChatMutationProvenance;
		previousRevision: number;
		resultingRevision: number;
		payload?: Record<string, unknown>;
	},
): number {
	const chat = db
		.prepare(`SELECT * FROM chats WHERE chat_id = ?`)
		.get(input.chatId);
	if (!chat) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog event delivery scope requires a live chat",
		);
	}
	const workspaceKey = canonicalWorkspace(
		asString(chat.workspace_key),
		"event workspace key",
	);
	const audienceId = normalizeAudienceId(
		asString(chat.audience_id),
		"event audience id",
	);
	const sessionIds = db
		.prepare(
			`SELECT session_id FROM chat_sessions
			 WHERE chat_id = ? ORDER BY ordinal ASC, session_id ASC`,
		)
		.all(input.chatId)
		.map((row) => asString(row.session_id));
	if (sessionIds.length === 0) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog event delivery scope requires event-time chat membership",
		);
	}
	const projection = projectChatRow(db, chat);
	const eventId = randomUUID();
	db.prepare(
		`INSERT INTO chat_events (
			event_id, chat_id, event_type, aggregate_kind, aggregate_id,
			invocation_id, actor_kind, actor_id, source_kind, transport, thread_id,
			channel_id, previous_revision,
			resulting_revision, payload_json, occurred_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		eventId,
		input.chatId,
		input.eventType,
		input.aggregateKind,
		input.aggregateId,
		input.provenance.invocationId,
		input.provenance.actor.kind,
		input.provenance.actor.id ?? null,
		input.provenance.source.kind,
		input.provenance.source.transport ?? null,
		input.provenance.source.threadId ?? null,
		input.provenance.source.channelId ?? null,
		input.previousRevision,
		input.resultingRevision,
		canonicalJson(input.payload ?? {}),
		input.provenance.occurredAt,
	);
	const event = db
		.prepare(`SELECT event_sequence FROM chat_events WHERE event_id = ?`)
		.get(eventId);
	const eventSequence = validRevision(
		Number(event?.event_sequence ?? -1),
		"event sequence",
	);
	db.prepare(
		`INSERT INTO chat_event_delivery_scope (
			event_sequence, workspace_key, audience_id, session_ids_json,
			projection_json
		 ) VALUES (?, ?, ?, ?, ?)`,
	).run(
		eventSequence,
		workspaceKey,
		audienceId,
		canonicalJson(sessionIds),
		canonicalJson(projection),
	);
	return eventSequence;
}

const CHAT_CATALOG_V1_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS chats (
		chat_id TEXT PRIMARY KEY,
		workspace_key TEXT NOT NULL,
		audience_id TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512),
		catalog_state TEXT NOT NULL CHECK (catalog_state IN ('active', 'archived', 'deleting')),
		head_session_id TEXT NOT NULL,
		parent_chat_id TEXT,
		title TEXT,
		title_source TEXT,
		source_kind TEXT NOT NULL,
		created_at TEXT NOT NULL,
		last_activity_at TEXT NOT NULL,
		archived_at TEXT,
		revision INTEGER NOT NULL CHECK (revision >= 0),
		FOREIGN KEY (head_session_id) REFERENCES sessions(session_id) ON DELETE RESTRICT
	);`,
	`CREATE TABLE IF NOT EXISTS chat_sessions (
		session_id TEXT PRIMARY KEY,
		chat_id TEXT NOT NULL,
		relation_kind TEXT NOT NULL CHECK (relation_kind IN ('root', 'fork', 'checkpoint_restore', 'config_restart', 'recovery')),
		parent_session_id TEXT,
		ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
		attached_at TEXT NOT NULL,
		UNIQUE (chat_id, ordinal),
		FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE,
		FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE RESTRICT
	);`,
	`CREATE TABLE IF NOT EXISTS chat_bindings (
		binding_id TEXT PRIMARY KEY,
		audience_id TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512),
		transport TEXT NOT NULL,
		instance_id TEXT NOT NULL DEFAULT '',
		channel_id TEXT NOT NULL DEFAULT '',
		thread_id TEXT NOT NULL DEFAULT '',
		participant_scope TEXT NOT NULL DEFAULT '',
		is_bound INTEGER NOT NULL CHECK (is_bound IN (0, 1)),
		chat_id TEXT,
		session_id TEXT,
		revision INTEGER NOT NULL CHECK (revision >= 0),
		updated_at TEXT NOT NULL,
		UNIQUE (transport, instance_id, channel_id, thread_id, participant_scope)
	);`,
	`CREATE TABLE IF NOT EXISTS chat_events (
		event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		event_id TEXT NOT NULL UNIQUE,
		chat_id TEXT NOT NULL,
		event_type TEXT NOT NULL,
		aggregate_kind TEXT NOT NULL CHECK (aggregate_kind IN ('chat', 'binding', 'lease', 'purge_attempt')),
		aggregate_id TEXT NOT NULL,
		invocation_id TEXT NOT NULL,
		actor_kind TEXT NOT NULL,
		actor_id TEXT,
		source_kind TEXT NOT NULL,
		transport TEXT,
		thread_id TEXT,
		channel_id TEXT,
		previous_revision INTEGER NOT NULL,
		resulting_revision INTEGER NOT NULL,
		payload_json TEXT NOT NULL,
		occurred_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS chat_event_delivery_scope (
		event_sequence INTEGER PRIMARY KEY,
		workspace_key TEXT NOT NULL,
		audience_id TEXT,
		session_ids_json TEXT NOT NULL,
		projection_json TEXT,
		FOREIGN KEY (event_sequence) REFERENCES chat_events(event_sequence) ON DELETE CASCADE
	);`,
	`CREATE TABLE IF NOT EXISTS chat_mutation_invocations (
		invocation_id TEXT PRIMARY KEY,
		operation TEXT NOT NULL,
		intent_digest TEXT NOT NULL,
		result_chat_id TEXT,
		result_revision INTEGER NOT NULL,
		applied INTEGER NOT NULL CHECK (applied IN (0, 1))
	);`,
	`CREATE TABLE IF NOT EXISTS session_leases (
		session_id TEXT PRIMARY KEY,
		owner_id TEXT NOT NULL,
		lease_token_hash TEXT NOT NULL,
		is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
		expires_at TEXT NOT NULL,
		revision INTEGER NOT NULL CHECK (revision >= 0),
		writer_generation INTEGER NOT NULL CHECK (writer_generation >= 0),
		updated_at TEXT NOT NULL,
		FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
	);`,
	`CREATE TABLE IF NOT EXISTS session_writer_heads (
		session_id TEXT PRIMARY KEY,
		commit_sequence INTEGER NOT NULL DEFAULT 0 CHECK (commit_sequence >= 0),
		lease_revision INTEGER NOT NULL DEFAULT 0 CHECK (lease_revision >= 0),
		writer_generation INTEGER NOT NULL DEFAULT 0 CHECK (writer_generation >= 0),
		messages_path TEXT,
		compaction_path TEXT,
		manifest_path TEXT,
		managed_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
	);`,
	`CREATE TABLE IF NOT EXISTS chat_purge_tombstones (
		session_id TEXT PRIMARY KEY,
		chat_id TEXT NOT NULL,
		audience_id TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512),
		purge_state TEXT NOT NULL CHECK (purge_state IN ('deleting', 'purged')),
		started_at TEXT NOT NULL,
		finalized_at TEXT,
		started_invocation_id TEXT NOT NULL,
		finalized_invocation_id TEXT
	);`,
	`CREATE TABLE IF NOT EXISTS chat_purge_attempts (
		attempt_id TEXT PRIMARY KEY,
		chat_id TEXT NOT NULL,
		audience_id TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512),
		intent_digest TEXT NOT NULL,
		session_ids_json TEXT NOT NULL,
		attempt_state TEXT NOT NULL CHECK (attempt_state IN ('pending', 'failed', 'succeeded', 'finalized')),
		revision INTEGER NOT NULL CHECK (revision >= 1),
		cleanup_receipt_digest TEXT,
		error_code TEXT,
		error_message TEXT,
		started_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS chat_audience_migration_manifest (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		source_schema_version INTEGER NOT NULL CHECK (source_schema_version BETWEEN 0 AND 4),
		legacy_event_high_water INTEGER NOT NULL CHECK (legacy_event_high_water >= 0),
		migration_format_version INTEGER NOT NULL CHECK (migration_format_version = ${CHAT_AUDIENCE_MIGRATION_FORMAT_VERSION}),
		captured_at TEXT NOT NULL,
		evidence_digest TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS chat_audience_migration_evidence (
		chat_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
		writer_generation INTEGER,
		evidence_status TEXT NOT NULL CHECK (evidence_status IN ('valid', 'missing_stamp', 'malformed_metadata', 'malformed_stamp', 'unfenced_or_incomplete')),
		stamp_json TEXT,
		stamp_digest TEXT,
		captured_at TEXT NOT NULL,
		PRIMARY KEY (chat_id, session_id)
	);`,
	`CREATE TABLE IF NOT EXISTS chat_audience_migration_state (
		chat_id TEXT PRIMARY KEY,
		migration_status TEXT NOT NULL CHECK (migration_status IN ('pending', 'quarantined', 'assigned')),
		reason_code TEXT NOT NULL,
		evidence_digest TEXT NOT NULL,
		resolver_version TEXT,
		audience_id TEXT,
		assignment_event_sequence INTEGER,
		updated_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS chat_audience_assignment_log (
		assignment_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id TEXT NOT NULL,
		previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
		resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 1),
		audience_id TEXT NOT NULL CHECK (length(audience_id) BETWEEN 1 AND 512),
		assignment_kind TEXT NOT NULL CHECK (assignment_kind IN ('exact_profile_stamp', 'explicit_owner')),
		resolver_version TEXT,
		evidence_digest TEXT,
		event_sequence INTEGER NOT NULL UNIQUE,
		actor_kind TEXT NOT NULL,
		actor_id TEXT,
		occurred_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS idx_chats_workspace_state_activity
	 ON chats(workspace_key, catalog_state, last_activity_at DESC, chat_id ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_sessions_chat
	 ON chat_sessions(chat_id, ordinal ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_sessions_parent
	 ON chat_sessions(parent_session_id, relation_kind);`,
	`CREATE INDEX IF NOT EXISTS idx_chats_parent
	 ON chats(parent_chat_id);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_events_chat
	 ON chat_events(chat_id, event_sequence ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_event_delivery_workspace_sequence
	 ON chat_event_delivery_scope(workspace_key, event_sequence ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_event_delivery_audience_sequence
	 ON chat_event_delivery_scope(workspace_key, audience_id, event_sequence ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chats_workspace_audience_state_activity
	 ON chats(workspace_key, audience_id, catalog_state, last_activity_at DESC, chat_id ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_bindings_chat
	 ON chat_bindings(chat_id, is_bound);`,
	`CREATE INDEX IF NOT EXISTS idx_session_leases_expiry
	 ON session_leases(is_active, expires_at);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_purge_attempts_chat
	 ON chat_purge_attempts(chat_id, updated_at DESC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_purge_attempts_audience
	 ON chat_purge_attempts(chat_id, audience_id);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_audience_evidence_chat
	 ON chat_audience_migration_evidence(chat_id, ordinal ASC, session_id ASC);`,
	`CREATE INDEX IF NOT EXISTS idx_chat_audience_state_status
	 ON chat_audience_migration_state(migration_status, chat_id ASC);`,
] as const;

const CHAT_CATALOG_REQUIRED_COLUMNS = {
	database_tenant: ["singleton", "tenant_id"],
	chats: [
		"chat_id",
		"workspace_key",
		"audience_id",
		"catalog_state",
		"head_session_id",
		"parent_chat_id",
		"last_activity_at",
		"revision",
	],
	chat_sessions: [
		"session_id",
		"chat_id",
		"relation_kind",
		"parent_session_id",
		"ordinal",
	],
	chat_bindings: [
		"binding_id",
		"audience_id",
		"transport",
		"is_bound",
		"chat_id",
		"session_id",
		"revision",
	],
	chat_events: [
		"event_sequence",
		"event_id",
		"chat_id",
		"event_type",
		"aggregate_kind",
		"aggregate_id",
		"invocation_id",
		"previous_revision",
		"resulting_revision",
	],
	chat_event_delivery_scope: [
		"event_sequence",
		"workspace_key",
		"audience_id",
		"session_ids_json",
		"projection_json",
	],
	chat_mutation_invocations: [
		"invocation_id",
		"operation",
		"intent_digest",
		"result_revision",
	],
	session_leases: [
		"session_id",
		"owner_id",
		"lease_token_hash",
		"is_active",
		"expires_at",
		"revision",
		"writer_generation",
	],
	session_writer_heads: [
		"session_id",
		"commit_sequence",
		"lease_revision",
		"writer_generation",
		"messages_path",
		"compaction_path",
		"manifest_path",
		"managed_at",
		"updated_at",
	],
	chat_purge_tombstones: [
		"session_id",
		"chat_id",
		"audience_id",
		"purge_state",
		"started_invocation_id",
	],
	chat_purge_attempts: [
		"attempt_id",
		"chat_id",
		"audience_id",
		"intent_digest",
		"session_ids_json",
		"attempt_state",
		"revision",
		"cleanup_receipt_digest",
	],
	chat_audience_migration_manifest: [
		"singleton",
		"source_schema_version",
		"legacy_event_high_water",
		"migration_format_version",
		"captured_at",
		"evidence_digest",
	],
	chat_audience_migration_evidence: [
		"chat_id",
		"session_id",
		"ordinal",
		"writer_generation",
		"evidence_status",
		"stamp_json",
		"stamp_digest",
		"captured_at",
	],
	chat_audience_migration_state: [
		"chat_id",
		"migration_status",
		"reason_code",
		"evidence_digest",
		"resolver_version",
		"audience_id",
		"assignment_event_sequence",
		"updated_at",
	],
	chat_audience_assignment_log: [
		"assignment_sequence",
		"chat_id",
		"previous_revision",
		"resulting_revision",
		"audience_id",
		"assignment_kind",
		"event_sequence",
		"actor_kind",
		"occurred_at",
	],
} as const;

const CHAT_CATALOG_REQUIRED_INDEXES = [
	"idx_chats_workspace_state_activity",
	"idx_chat_sessions_chat",
	"idx_chat_sessions_parent",
	"idx_chats_parent",
	"idx_chat_events_chat",
	"idx_chat_event_delivery_workspace_sequence",
	"idx_chat_event_delivery_audience_sequence",
	"idx_chats_workspace_audience_state_activity",
	"idx_chat_bindings_chat",
	"idx_session_leases_expiry",
	"idx_chat_purge_attempts_chat",
	"idx_chat_purge_attempts_audience",
	"idx_chat_audience_evidence_chat",
	"idx_chat_audience_state_status",
] as const;

const CHAT_CATALOG_REQUIRED_TRIGGERS = [
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
] as const;

const CHAT_CATALOG_REQUIRED_CHECKS = {
	database_tenant: ["singleton = 1"],
	chat_catalog_schema: ["singleton = 1"],
	chats: [
		"catalog_state IN ('active', 'archived', 'deleting')",
		"revision >= 0",
		"length(audience_id) BETWEEN 1 AND 512",
	],
	chat_sessions: [
		"relation_kind IN ('root', 'fork', 'checkpoint_restore', 'config_restart', 'recovery')",
		"ordinal >= 0",
	],
	chat_bindings: [
		"is_bound IN (0, 1)",
		"revision >= 0",
		"length(audience_id) BETWEEN 1 AND 512",
	],
	chat_events: [
		"aggregate_kind IN ('chat', 'binding', 'lease', 'purge_attempt')",
	],
	chat_mutation_invocations: ["applied IN (0, 1)"],
	session_leases: [
		"is_active IN (0, 1)",
		"revision >= 0",
		"writer_generation >= 0",
	],
	session_writer_heads: [
		"commit_sequence >= 0",
		"lease_revision >= 0",
		"writer_generation >= 0",
	],
	chat_purge_tombstones: [
		"purge_state IN ('deleting', 'purged')",
		"length(audience_id) BETWEEN 1 AND 512",
	],
	chat_purge_attempts: [
		"attempt_state IN ('pending', 'failed', 'succeeded', 'finalized')",
		"revision >= 1",
		"length(audience_id) BETWEEN 1 AND 512",
	],
	chat_audience_migration_manifest: [
		"singleton = 1",
		"source_schema_version BETWEEN 0 AND 4",
		"legacy_event_high_water >= 0",
		`migration_format_version = ${CHAT_AUDIENCE_MIGRATION_FORMAT_VERSION}`,
	],
	chat_audience_migration_evidence: [
		"ordinal >= 0",
		"evidence_status IN ('valid', 'missing_stamp', 'malformed_metadata', 'malformed_stamp', 'unfenced_or_incomplete')",
	],
	chat_audience_migration_state: [
		"migration_status IN ('pending', 'quarantined', 'assigned')",
	],
	chat_audience_assignment_log: [
		"previous_revision >= 0",
		"resulting_revision >= 1",
		"length(audience_id) BETWEEN 1 AND 512",
		"assignment_kind IN ('exact_profile_stamp', 'explicit_owner')",
	],
} as const;

const CHAT_CATALOG_REQUIRED_UNIQUE_COLUMNS = {
	chat_sessions: [["chat_id", "ordinal"]],
	chat_bindings: [
		[
			"transport",
			"instance_id",
			"channel_id",
			"thread_id",
			"participant_scope",
		],
	],
	chat_events: [["event_id"]],
	chat_audience_assignment_log: [["event_sequence"]],
} as const;

function skipSqlQuoted(sql: string, start: number): number {
	const opening = sql[start];
	const closing = opening === "[" ? "]" : opening;
	let offset = start + 1;
	while (offset < sql.length) {
		if (sql[offset] !== closing) {
			offset += 1;
			continue;
		}
		if (sql[offset + 1] === closing) {
			offset += 2;
			continue;
		}
		return offset + 1;
	}
	return sql.length;
}

function skipSqlComment(sql: string, start: number): number | undefined {
	if (sql.startsWith("--", start)) {
		const newline = sql.indexOf("\n", start + 2);
		return newline === -1 ? sql.length : newline + 1;
	}
	if (sql.startsWith("/*", start)) {
		const closing = sql.indexOf("*/", start + 2);
		return closing === -1 ? sql.length : closing + 2;
	}
	return undefined;
}

function normalizeCheckExpression(value: string): string {
	let normalized = "";
	let offset = 0;
	while (offset < value.length) {
		const commentEnd = skipSqlComment(value, offset);
		if (commentEnd !== undefined) {
			offset = commentEnd;
			continue;
		}
		const character = value[offset];
		if (character === "'") {
			const quotedEnd = skipSqlQuoted(value, offset);
			normalized += value.slice(offset, quotedEnd);
			offset = quotedEnd;
			continue;
		}
		if (character === '"' || character === "`" || character === "[") {
			const quotedEnd = skipSqlQuoted(value, offset);
			normalized += value.slice(offset + 1, quotedEnd - 1).toLowerCase();
			offset = quotedEnd;
			continue;
		}
		if (/\s/.test(character)) {
			offset += 1;
			continue;
		}
		normalized += character.toLowerCase();
		offset += 1;
	}
	return normalized;
}

function extractCheckExpressions(value: unknown): Set<string> {
	if (typeof value !== "string" || !value.trim()) return new Set();
	const expressions = new Set<string>();
	let offset = 0;
	while (offset < value.length) {
		const commentEnd = skipSqlComment(value, offset);
		if (commentEnd !== undefined) {
			offset = commentEnd;
			continue;
		}
		const character = value[offset];
		if (
			character === "'" ||
			character === '"' ||
			character === "`" ||
			character === "["
		) {
			offset = skipSqlQuoted(value, offset);
			continue;
		}
		const candidate = value.slice(offset, offset + 5);
		const previous = value[offset - 1] ?? "";
		const following = value[offset + 5] ?? "";
		if (
			candidate.toLowerCase() !== "check" ||
			/[a-z0-9_]/i.test(previous) ||
			/[a-z0-9_]/i.test(following)
		) {
			offset += 1;
			continue;
		}
		let opening = offset + 5;
		while (opening < value.length) {
			const triviaCommentEnd = skipSqlComment(value, opening);
			if (triviaCommentEnd !== undefined) {
				opening = triviaCommentEnd;
				continue;
			}
			if (!/\s/.test(value[opening] ?? "")) break;
			opening += 1;
		}
		if (value[opening] !== "(") {
			offset += 5;
			continue;
		}
		let depth = 1;
		let cursor = opening + 1;
		while (cursor < value.length && depth > 0) {
			const nestedCommentEnd = skipSqlComment(value, cursor);
			if (nestedCommentEnd !== undefined) {
				cursor = nestedCommentEnd;
				continue;
			}
			const nested = value[cursor];
			if (
				nested === "'" ||
				nested === '"' ||
				nested === "`" ||
				nested === "["
			) {
				cursor = skipSqlQuoted(value, cursor);
				continue;
			}
			if (nested === "(") depth += 1;
			if (nested === ")") depth -= 1;
			if (depth === 0) {
				expressions.add(
					normalizeCheckExpression(value.slice(opening + 1, cursor)),
				);
				offset = cursor + 1;
				break;
			}
			cursor += 1;
		}
		if (depth > 0) offset = value.length;
	}
	return expressions;
}

function pragmaArgument(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function hasUniqueColumns(
	db: SqliteDb,
	table: string,
	requiredColumns: readonly string[],
): boolean {
	const indexes = db
		.prepare(`PRAGMA index_list(${pragmaArgument(table)});`)
		.all()
		.filter(
			(row) => Number(row.unique ?? 0) === 1 && Number(row.partial ?? 0) === 0,
		);
	return indexes.some((index) => {
		const indexName = asString(index.name);
		const columns = db
			.prepare(`PRAGMA index_info(${pragmaArgument(indexName)});`)
			.all()
			.sort((left, right) => Number(left.seqno ?? 0) - Number(right.seqno ?? 0))
			.map((row) => asString(row.name));
		return (
			columns.length === requiredColumns.length &&
			columns.every((column, offset) => column === requiredColumns[offset])
		);
	});
}

function validateChatCatalogSchema(db: SqliteDb): void {
	for (const [table, requiredColumns] of Object.entries(
		CHAT_CATALOG_REQUIRED_COLUMNS,
	)) {
		const columns = new Set(
			db
				.prepare(`PRAGMA table_info(${table});`)
				.all()
				.map((row) => asString(row.name)),
		);
		for (const column of requiredColumns) {
			if (!columns.has(column)) {
				throw new ChatCatalogError(
					"unsupported_capability",
					`chat catalog schema drift: ${table}.${column} is missing`,
				);
			}
		}
	}
	const indexes = new Set(
		db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
			.all()
			.map((row) => asString(row.name)),
	);
	for (const index of CHAT_CATALOG_REQUIRED_INDEXES) {
		if (!indexes.has(index)) {
			throw new ChatCatalogError(
				"unsupported_capability",
				`chat catalog schema drift: index ${index} is missing`,
			);
		}
	}
	const triggers = new Set(
		db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
			.all()
			.map((row) => asString(row.name)),
	);
	for (const trigger of CHAT_CATALOG_REQUIRED_TRIGGERS) {
		if (!triggers.has(trigger)) {
			throw new ChatCatalogError(
				"unsupported_capability",
				`chat catalog schema drift: trigger ${trigger} is missing`,
			);
		}
	}
	const tableChecks = new Map(
		db
			.prepare(
				`SELECT name, sql FROM sqlite_master
				 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
			)
			.all()
			.map((row) => [asString(row.name), extractCheckExpressions(row.sql)]),
	);
	for (const [table, checks] of Object.entries(CHAT_CATALOG_REQUIRED_CHECKS)) {
		const definitions = tableChecks.get(table) ?? new Set<string>();
		for (const check of checks) {
			if (!definitions.has(normalizeCheckExpression(check))) {
				throw new ChatCatalogError(
					"unsupported_capability",
					`chat catalog schema drift: ${table} CHECK (${check}) is missing`,
				);
			}
		}
	}
	for (const [table, uniqueDefinitions] of Object.entries(
		CHAT_CATALOG_REQUIRED_UNIQUE_COLUMNS,
	)) {
		for (const columns of uniqueDefinitions) {
			if (!hasUniqueColumns(db, table, columns)) {
				throw new ChatCatalogError(
					"unsupported_capability",
					`chat catalog schema drift: ${table} unique (${columns.join(", ")}) is missing`,
				);
			}
		}
	}
	const requiredForeignKeys = [
		["chats", "sessions"],
		["chat_sessions", "chats"],
		["chat_sessions", "sessions"],
		["session_leases", "sessions"],
		["session_writer_heads", "sessions"],
		["chat_event_delivery_scope", "chat_events"],
	] as const;
	for (const [table, target] of requiredForeignKeys) {
		const targets = db
			.prepare(`PRAGMA foreign_key_list(${table});`)
			.all()
			.map((row) => asString(row.table));
		if (!targets.includes(target)) {
			throw new ChatCatalogError(
				"unsupported_capability",
				`chat catalog schema drift: ${table} foreign key to ${target} is missing`,
			);
		}
	}
}

function ensureCatalogDatabaseTenant(db: SqliteDb, tenantId: string): void {
	try {
		ensureDatabaseTenant(db, tenantId);
	} catch (error) {
		if (error instanceof SqliteTenantOwnershipError) {
			throw new ChatCatalogError("unsupported_capability", error.message);
		}
		throw error;
	}
}

function ensureAudienceV5SchemaObjects(db: SqliteDb): void {
	db.exec(`CREATE TABLE IF NOT EXISTS chat_audience_migration_manifest (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		source_schema_version INTEGER NOT NULL CHECK (source_schema_version BETWEEN 0 AND 4),
		legacy_event_high_water INTEGER NOT NULL CHECK (legacy_event_high_water >= 0),
		migration_format_version INTEGER NOT NULL CHECK (migration_format_version = ${CHAT_AUDIENCE_MIGRATION_FORMAT_VERSION}),
		captured_at TEXT NOT NULL,
		evidence_digest TEXT NOT NULL
	);`);
	db.exec(`CREATE TABLE IF NOT EXISTS chat_audience_migration_evidence (
		chat_id TEXT NOT NULL,
		session_id TEXT NOT NULL,
		ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
		writer_generation INTEGER,
		evidence_status TEXT NOT NULL CHECK (evidence_status IN ('valid', 'missing_stamp', 'malformed_metadata', 'malformed_stamp', 'unfenced_or_incomplete')),
		stamp_json TEXT,
		stamp_digest TEXT,
		captured_at TEXT NOT NULL,
		PRIMARY KEY (chat_id, session_id)
	);`);
	db.exec(`CREATE TABLE IF NOT EXISTS chat_audience_migration_state (
		chat_id TEXT PRIMARY KEY,
		migration_status TEXT NOT NULL CHECK (migration_status IN ('pending', 'quarantined', 'assigned')),
		reason_code TEXT NOT NULL,
		evidence_digest TEXT NOT NULL,
		resolver_version TEXT,
		audience_id TEXT,
		assignment_event_sequence INTEGER,
		updated_at TEXT NOT NULL
	);`);
	db.exec(`CREATE TABLE IF NOT EXISTS chat_audience_assignment_log (
		assignment_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id TEXT NOT NULL,
		previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
		resulting_revision INTEGER NOT NULL CHECK (resulting_revision >= 1),
		audience_id TEXT NOT NULL CHECK (length(audience_id) BETWEEN 1 AND 512),
		assignment_kind TEXT NOT NULL CHECK (assignment_kind IN ('exact_profile_stamp', 'explicit_owner')),
		resolver_version TEXT,
		evidence_digest TEXT,
		event_sequence INTEGER NOT NULL UNIQUE,
		actor_kind TEXT NOT NULL,
		actor_id TEXT,
		occurred_at TEXT NOT NULL
	);`);
	db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_event_delivery_audience_sequence
		ON chat_event_delivery_scope(workspace_key, audience_id, event_sequence ASC);`);
	db.exec(`CREATE INDEX IF NOT EXISTS idx_chats_workspace_audience_state_activity
		ON chats(workspace_key, audience_id, catalog_state, last_activity_at DESC, chat_id ASC);`);
	db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_purge_attempts_audience
		ON chat_purge_attempts(chat_id, audience_id);`);
	db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_audience_evidence_chat
		ON chat_audience_migration_evidence(chat_id, ordinal ASC, session_id ASC);`);
	db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_audience_state_status
		ON chat_audience_migration_state(migration_status, chat_id ASC);`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chats_audience_immutable
		BEFORE UPDATE OF audience_id ON chats
		WHEN OLD.audience_id <> NEW.audience_id
		 AND (OLD.audience_id <> '${CHAT_AUDIENCE_UNASSIGNED}'
		      OR NEW.audience_id = '${CHAT_AUDIENCE_UNASSIGNED}')
		BEGIN SELECT RAISE(ABORT, 'chat audience is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_bindings_audience_immutable
		BEFORE UPDATE OF audience_id ON chat_bindings
		WHEN OLD.audience_id <> NEW.audience_id
		 AND (OLD.audience_id <> '${CHAT_AUDIENCE_UNASSIGNED}'
		      OR NEW.audience_id = '${CHAT_AUDIENCE_UNASSIGNED}')
		BEGIN SELECT RAISE(ABORT, 'binding audience is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_purge_tombstones_audience_immutable
		BEFORE UPDATE OF audience_id ON chat_purge_tombstones
		WHEN OLD.audience_id <> NEW.audience_id
		 AND (OLD.audience_id <> '${CHAT_AUDIENCE_UNASSIGNED}'
		      OR NEW.audience_id = '${CHAT_AUDIENCE_UNASSIGNED}')
		BEGIN SELECT RAISE(ABORT, 'purge tombstone audience is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_purge_attempts_audience_immutable
		BEFORE UPDATE OF audience_id ON chat_purge_attempts
		WHEN OLD.audience_id <> NEW.audience_id
		 AND (OLD.audience_id <> '${CHAT_AUDIENCE_UNASSIGNED}'
		      OR NEW.audience_id = '${CHAT_AUDIENCE_UNASSIGNED}')
		BEGIN SELECT RAISE(ABORT, 'purge attempt audience is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_event_delivery_scope_immutable
		BEFORE UPDATE ON chat_event_delivery_scope
		BEGIN SELECT RAISE(ABORT, 'event delivery scope is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_audience_manifest_immutable
		BEFORE UPDATE ON chat_audience_migration_manifest
		BEGIN SELECT RAISE(ABORT, 'audience migration manifest is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_audience_manifest_delete
		BEFORE DELETE ON chat_audience_migration_manifest
		BEGIN SELECT RAISE(ABORT, 'audience migration manifest is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_audience_evidence_immutable
		BEFORE UPDATE ON chat_audience_migration_evidence
		BEGIN SELECT RAISE(ABORT, 'audience migration evidence is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_audience_evidence_delete
		BEFORE DELETE ON chat_audience_migration_evidence
		BEGIN SELECT RAISE(ABORT, 'audience migration evidence is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_audience_assignment_log_immutable
		BEFORE UPDATE ON chat_audience_assignment_log
		BEGIN SELECT RAISE(ABORT, 'audience assignment log is immutable'); END;`);
	db.exec(`CREATE TRIGGER IF NOT EXISTS trg_chat_audience_assignment_log_delete
		BEFORE DELETE ON chat_audience_assignment_log
		BEGIN SELECT RAISE(ABORT, 'audience assignment log is immutable'); END;`);
}

type AudienceMigrationEvidenceStatus =
	| "valid"
	| "missing_stamp"
	| "malformed_metadata"
	| "malformed_stamp"
	| "unfenced_or_incomplete";

interface FrozenAudienceMigrationEvidence {
	readonly status: AudienceMigrationEvidenceStatus;
	readonly stampJson?: string;
	readonly stampDigest?: string;
}

function freezeManagedProfileEvidence(
	metadataJson: unknown,
): FrozenAudienceMigrationEvidence {
	if (typeof metadataJson !== "string") {
		return Object.freeze({ status: "malformed_metadata" });
	}
	let metadata: unknown;
	try {
		metadata = JSON.parse(metadataJson) as unknown;
	} catch {
		return Object.freeze({ status: "malformed_metadata" });
	}
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return Object.freeze({ status: "malformed_metadata" });
	}
	let stamp: ManagedProfileAuthority | undefined;
	try {
		stamp = readManagedProfileAuthority(metadata as Record<string, unknown>);
	} catch {
		return Object.freeze({ status: "malformed_stamp" });
	}
	if (!stamp) return Object.freeze({ status: "missing_stamp" });
	const stampJson = canonicalJson(stamp);
	return Object.freeze({
		status: "valid",
		stampJson,
		stampDigest: createHash("sha256").update(stampJson).digest("hex"),
	});
}

function validMigrationClock(clock: () => Date): string {
	const value = clock();
	if (!Number.isFinite(value.getTime())) {
		throw new ChatCatalogError(
			"invalid_input",
			"audience migration clock is invalid",
		);
	}
	return value.toISOString();
}

function captureAudienceMigrationEvidence(
	db: SqliteDb,
	input: { sourceSchemaVersion: number; clock: () => Date },
): void {
	const existing = db
		.prepare(
			`SELECT singleton FROM chat_audience_migration_manifest WHERE singleton = 1`,
		)
		.get();
	if (existing) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"chat audience migration manifest already exists before v5 capture",
		);
	}
	const capturedAt = validMigrationClock(input.clock);
	const legacyEventHighWater = validRevision(
		Number(
			db
				.prepare(
					`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence FROM chat_events`,
				)
				.get()?.event_sequence ?? 0,
		),
		"legacy event high water",
	);
	const chats = db
		.prepare(`SELECT chat_id, head_session_id FROM chats ORDER BY chat_id ASC`)
		.all();
	const manifestEvidence: unknown[] = [];
	for (const chat of chats) {
		const chatId = asString(chat.chat_id);
		const headSessionId = asString(chat.head_session_id);
		const members = db
			.prepare(
				`SELECT cs.session_id, cs.ordinal, s.metadata_json,
			        writer.writer_generation
			 FROM chat_sessions cs
			 LEFT JOIN sessions s ON s.session_id = cs.session_id
			 LEFT JOIN session_writer_heads writer
			   ON writer.session_id = cs.session_id
			 WHERE cs.chat_id = ?
			 ORDER BY cs.ordinal ASC, cs.session_id ASC`,
			)
			.all(chatId);
		const chatEvidence: unknown[] = [];
		let reasonCode =
			members.length === 0 ? "missing_members" : "awaiting_mapping";
		let allValid = members.length > 0;
		let hasRoot = false;
		let hasHead = false;
		for (const member of members) {
			const sessionId = asString(member.session_id);
			const ordinal = validRevision(
				Number(member.ordinal ?? -1),
				"migration member ordinal",
			);
			hasRoot ||= ordinal === 0;
			hasHead ||= sessionId === headSessionId;
			const writerGeneration =
				member.writer_generation === null ||
				member.writer_generation === undefined
					? undefined
					: validRevision(
							Number(member.writer_generation),
							"migration writer generation",
						);
			const frozen =
				writerGeneration === undefined
					? Object.freeze<FrozenAudienceMigrationEvidence>({
							status: "unfenced_or_incomplete",
						})
					: freezeManagedProfileEvidence(member.metadata_json);
			if (frozen.status !== "valid") {
				allValid = false;
				if (reasonCode === "awaiting_mapping") reasonCode = frozen.status;
			}
			db.prepare(
				`INSERT INTO chat_audience_migration_evidence (
					chat_id, session_id, ordinal, writer_generation,
					evidence_status, stamp_json, stamp_digest, captured_at
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				chatId,
				sessionId,
				ordinal,
				writerGeneration ?? null,
				frozen.status,
				frozen.stampJson ?? null,
				frozen.stampDigest ?? null,
				capturedAt,
			);
			chatEvidence.push({
				sessionId,
				ordinal,
				writerGeneration: writerGeneration ?? null,
				status: frozen.status,
				stampDigest: frozen.stampDigest ?? null,
			});
		}
		if (!hasRoot || !hasHead) {
			allValid = false;
			reasonCode = "unfenced_or_incomplete";
		}
		const evidenceDigest = createHash("sha256")
			.update(canonicalJson(chatEvidence))
			.digest("hex");
		db.prepare(
			`INSERT INTO chat_audience_migration_state (
				chat_id, migration_status, reason_code, evidence_digest,
				resolver_version, audience_id, assignment_event_sequence, updated_at
			 ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)`,
		).run(
			chatId,
			allValid ? "pending" : "quarantined",
			reasonCode,
			evidenceDigest,
			capturedAt,
		);
		manifestEvidence.push({ chatId, evidenceDigest, reasonCode });
	}

	// Quarantined legacy sessions must not remain writable. Randomizing the
	// credential and advancing both lease fences makes a copied v4 database inert.
	const leases = db
		.prepare(
			`SELECT l.session_id, l.revision, l.writer_generation
			 FROM session_leases l
			 JOIN chat_sessions cs ON cs.session_id = l.session_id
			 JOIN chats c ON c.chat_id = cs.chat_id
			 WHERE c.audience_id = ? AND l.is_active = 1
			 ORDER BY l.session_id ASC`,
		)
		.all(CHAT_AUDIENCE_UNASSIGNED);
	for (const lease of leases) {
		const sessionId = asString(lease.session_id);
		const nextRevision = validRevision(Number(lease.revision ?? 0)) + 1;
		const nextGeneration =
			validRevision(Number(lease.writer_generation ?? 0)) + 1;
		db.prepare(
			`UPDATE session_leases
			 SET lease_token_hash = ?, is_active = 0, expires_at = ?, revision = ?,
			     writer_generation = ?, updated_at = ?
			 WHERE session_id = ?`,
		).run(
			digestLeaseToken(randomBytes(32).toString("base64url")),
			capturedAt,
			nextRevision,
			nextGeneration,
			capturedAt,
			sessionId,
		);
		db.prepare(
			`UPDATE session_writer_heads
			 SET lease_revision = ?, writer_generation = ?, updated_at = ?
			 WHERE session_id = ?`,
		).run(nextRevision, nextGeneration, capturedAt, sessionId);
	}

	const evidenceDigest = createHash("sha256")
		.update(canonicalJson(manifestEvidence))
		.digest("hex");
	db.prepare(
		`INSERT INTO chat_audience_migration_manifest (
			singleton, source_schema_version, legacy_event_high_water,
			migration_format_version, captured_at, evidence_digest
		 ) VALUES (1, ?, ?, ?, ?, ?)`,
	).run(
		input.sourceSchemaVersion,
		legacyEventHighWater,
		CHAT_AUDIENCE_MIGRATION_FORMAT_VERSION,
		capturedAt,
		evidenceDigest,
	);
}

function audienceMigrationResolverVersion(
	mappings: readonly NormalizedAudienceMigrationMapping[],
): string {
	return createHash("sha256")
		.update(
			canonicalJson(
				mappings
					.map((mapping) => [mapping.stampJson, mapping.audienceId])
					.sort((left, right) =>
						canonicalJson(left).localeCompare(canonicalJson(right)),
					),
			),
		)
		.digest("hex");
}

function markAudienceMigrationQuarantined(
	db: SqliteDb,
	input: {
		chatId: string;
		reasonCode: string;
		resolverVersion: string;
		updatedAt: string;
	},
): void {
	db.prepare(
		`UPDATE chat_audience_migration_state
		 SET migration_status = 'quarantined', reason_code = ?,
		     resolver_version = ?, audience_id = NULL,
		     assignment_event_sequence = NULL, updated_at = ?
		 WHERE chat_id = ? AND migration_status <> 'assigned'`,
	).run(input.reasonCode, input.resolverVersion, input.updatedAt, input.chatId);
}

function reconcileAudienceMigrationAssignments(
	db: SqliteDb,
	input: {
		mappings: readonly NormalizedAudienceMigrationMapping[];
		clock: () => Date;
	},
): void {
	if (input.mappings.length === 0) return;
	const resolverVersion = audienceMigrationResolverVersion(input.mappings);
	const audiencesByStamp = new Map<string, Set<string>>();
	for (const mapping of input.mappings) {
		let audiences = audiencesByStamp.get(mapping.stampJson);
		if (!audiences) {
			audiences = new Set();
			audiencesByStamp.set(mapping.stampJson, audiences);
		}
		audiences.add(mapping.audienceId);
	}
	const candidates = db
		.prepare(
			`SELECT c.chat_id, c.revision, state.evidence_digest
			 FROM chats c
			 JOIN chat_audience_migration_state state ON state.chat_id = c.chat_id
			 WHERE c.audience_id = ? AND state.migration_status <> 'assigned'
			 ORDER BY c.chat_id ASC`,
		)
		.all(CHAT_AUDIENCE_UNASSIGNED);
	for (const candidate of candidates) {
		const chatId = asString(candidate.chat_id);
		const updatedAt = validMigrationClock(input.clock);
		const memberCount = validRevision(
			Number(
				db
					.prepare(
						`SELECT COUNT(*) AS count FROM chat_sessions WHERE chat_id = ?`,
					)
					.get(chatId)?.count ?? 0,
			),
			"migration member count",
		);
		const evidence = db
			.prepare(
				`SELECT evidence_status, stamp_json
				 FROM chat_audience_migration_evidence
				 WHERE chat_id = ? ORDER BY ordinal ASC, session_id ASC`,
			)
			.all(chatId);
		if (
			memberCount < 1 ||
			evidence.length !== memberCount ||
			evidence.some((row) => asString(row.evidence_status) !== "valid")
		) {
			markAudienceMigrationQuarantined(db, {
				chatId,
				reasonCode: "unfenced_or_incomplete",
				resolverVersion,
				updatedAt,
			});
			continue;
		}
		const resolvedAudiences = new Set<string>();
		let resolutionFailure:
			| "unmapped"
			| "ambiguous_mapping"
			| "conflicting_chat_audiences"
			| undefined;
		for (const row of evidence) {
			const stampJson = asString(row.stamp_json);
			const mapped = audiencesByStamp.get(stampJson);
			if (!mapped || mapped.size === 0) {
				resolutionFailure = "unmapped";
				break;
			}
			if (mapped.size !== 1) {
				resolutionFailure = "ambiguous_mapping";
				break;
			}
			resolvedAudiences.add([...mapped][0] as string);
		}
		if (resolvedAudiences.size > 1) {
			resolutionFailure = "conflicting_chat_audiences";
		}
		if (resolutionFailure || resolvedAudiences.size !== 1) {
			markAudienceMigrationQuarantined(db, {
				chatId,
				reasonCode: resolutionFailure ?? "unmapped",
				resolverVersion,
				updatedAt,
			});
			continue;
		}
		const audienceId = [...resolvedAudiences][0] as string;
		const previousRevision = validRevision(
			Number(candidate.revision ?? 0),
			"chat revision",
		);
		const conflictingBinding = db
			.prepare(
				`SELECT 1 FROM chat_bindings
				 WHERE chat_id = ? AND audience_id <> ? AND audience_id <> ? LIMIT 1`,
			)
			.get(chatId, audienceId, CHAT_AUDIENCE_UNASSIGNED);
		if (conflictingBinding) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"audience migration found a conflicting binding namespace",
			);
		}
		const changed = db
			.prepare(
				`UPDATE chats SET audience_id = ?, revision = revision + 1
				 WHERE chat_id = ? AND audience_id = ? AND revision = ?`,
			)
			.run(
				audienceId,
				chatId,
				CHAT_AUDIENCE_UNASSIGNED,
				previousRevision,
			).changes;
		if (changed !== 1) continue;
		db.prepare(
			`UPDATE chat_bindings SET audience_id = ?
			 WHERE chat_id = ? AND audience_id = ?`,
		).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED);
		db.prepare(
			`UPDATE chat_purge_tombstones SET audience_id = ?
			 WHERE chat_id = ? AND audience_id = ?`,
		).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED);
		db.prepare(
			`UPDATE chat_purge_attempts SET audience_id = ?
			 WHERE chat_id = ? AND audience_id = ?`,
		).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED);
		const provenance: ChatMutationProvenance = {
			invocationId: createHash("sha256")
				.update(
					`audience-migration\0${chatId}\0${audienceId}\0${previousRevision}\0${resolverVersion}`,
				)
				.digest("hex"),
			occurredAt: updatedAt,
			actor: { kind: "system", id: "chat-audience-migration" },
			source: { kind: "migration", transport: "sqlite" },
		};
		const eventSequence = appendCatalogEvent(db, {
			chatId,
			eventType: "chat.audience_assigned",
			aggregateKind: "chat",
			aggregateId: chatId,
			provenance,
			previousRevision,
			resultingRevision: previousRevision + 1,
			payload: { assignmentKind: "exact_profile_stamp" },
		});
		const evidenceDigest = asString(candidate.evidence_digest);
		db.prepare(
			`INSERT INTO chat_audience_assignment_log (
				chat_id, previous_revision, resulting_revision, audience_id,
				assignment_kind, resolver_version, evidence_digest, event_sequence,
				actor_kind, actor_id, occurred_at
			 ) VALUES (?, ?, ?, ?, 'exact_profile_stamp', ?, ?, ?, ?, ?, ?)`,
		).run(
			chatId,
			previousRevision,
			previousRevision + 1,
			audienceId,
			resolverVersion,
			evidenceDigest,
			eventSequence,
			provenance.actor.kind,
			provenance.actor.id ?? null,
			updatedAt,
		);
		db.prepare(
			`UPDATE chat_audience_migration_state
			 SET migration_status = 'assigned', reason_code = 'exact_profile_stamp',
			     resolver_version = ?, audience_id = ?, assignment_event_sequence = ?,
			     updated_at = ?
			 WHERE chat_id = ?`,
		).run(resolverVersion, audienceId, eventSequence, updatedAt, chatId);
	}
}

function validateAudienceMigrationIntegrity(db: SqliteDb): void {
	const manifest = db
		.prepare(
			`SELECT legacy_event_high_water, migration_format_version
			 FROM chat_audience_migration_manifest WHERE singleton = 1`,
		)
		.get();
	if (!manifest) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"chat catalog v5 is missing its audience migration manifest",
		);
	}
	if (
		Number(manifest.migration_format_version) !==
		CHAT_AUDIENCE_MIGRATION_FORMAT_VERSION
	) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"chat audience migration format is unsupported",
		);
	}
	const legacyEventHighWater = validRevision(
		Number(manifest.legacy_event_high_water ?? -1),
		"legacy event high water",
	);
	const invalidScopedEvent = db
		.prepare(
			`SELECT e.event_sequence
			 FROM chat_events e
			 LEFT JOIN chat_event_delivery_scope scope
			   ON scope.event_sequence = e.event_sequence
			 WHERE e.event_sequence > ?
			   AND (scope.event_sequence IS NULL OR scope.audience_id IS NULL
			        OR scope.audience_id = ? OR scope.projection_json IS NULL)
			 LIMIT 1`,
		)
		.get(legacyEventHighWater, CHAT_AUDIENCE_UNASSIGNED);
	if (invalidScopedEvent) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"post-migration catalog event delivery scope is incomplete",
		);
	}
}

export interface EnsureChatCatalogSchemaOptions {
	readonly audienceMigrationMappings?: readonly ChatAudienceMigrationMapping[];
	readonly clock?: () => Date;
}

export function ensureChatCatalogSchema(
	db: SqliteDb,
	tenantId = "local",
	options: EnsureChatCatalogSchemaOptions = {},
): void {
	const requestedTenantId = boundedRequired(tenantId, "catalog tenant id");
	ensureCatalogDatabaseTenant(db, requestedTenantId);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec("PRAGMA foreign_keys = ON;");
	const mappings = normalizeAudienceMigrationMappings(
		options.audienceMigrationMappings,
	);
	const clock = options.clock ?? (() => new Date());
	db.exec("BEGIN IMMEDIATE;");
	let schemaTransactionOpen = true;
	try {
		db.exec(`CREATE TABLE IF NOT EXISTS chat_catalog_schema (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			version INTEGER NOT NULL
		);`);
		db.prepare(
			`INSERT OR IGNORE INTO chat_catalog_schema (singleton, version) VALUES (1, 0)`,
		).run();
		const row = db
			.prepare(`SELECT version FROM chat_catalog_schema WHERE singleton = 1`)
			.get();
		const version = Number(row?.version ?? 0);
		if (version > CHAT_CATALOG_SCHEMA_VERSION) {
			throw new ChatCatalogError(
				"unsupported_capability",
				`chat catalog schema ${version} is newer than supported version ${CHAT_CATALOG_SCHEMA_VERSION}`,
			);
		}
		if (version < 1) {
			try {
				for (const statement of CHAT_CATALOG_V1_STATEMENTS) db.exec(statement);
			} catch (error) {
				throw new ChatCatalogError(
					"unsupported_capability",
					`chat catalog schema migration failed: ${boundedErrorMessage(error)}`,
				);
			}
			db.prepare(
				`UPDATE chat_catalog_schema SET version = 1 WHERE singleton = 1`,
			).run();
		}
		if (version < 2) {
			db.prepare(
				`UPDATE chat_catalog_schema SET version = 2 WHERE singleton = 1`,
			).run();
		}
		if (version < 3) {
			const leaseColumns = new Set(
				db
					.prepare(`PRAGMA table_info(session_leases);`)
					.all()
					.map((column) => asString(column.name)),
			);
			if (!leaseColumns.has("writer_generation")) {
				db.exec(
					`ALTER TABLE session_leases ADD COLUMN writer_generation INTEGER NOT NULL DEFAULT 0 CHECK (writer_generation >= 0);`,
				);
				db.exec(
					`UPDATE session_leases SET writer_generation = revision WHERE writer_generation = 0;`,
				);
			}
			db.exec(`CREATE TABLE IF NOT EXISTS session_writer_heads (
				session_id TEXT PRIMARY KEY,
				commit_sequence INTEGER NOT NULL DEFAULT 0 CHECK (commit_sequence >= 0),
				lease_revision INTEGER NOT NULL DEFAULT 0 CHECK (lease_revision >= 0),
				writer_generation INTEGER NOT NULL DEFAULT 0 CHECK (writer_generation >= 0),
				messages_path TEXT,
				compaction_path TEXT,
				manifest_path TEXT,
				managed_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
			);`);
			db.exec(`INSERT OR IGNORE INTO session_writer_heads (
				session_id, commit_sequence, lease_revision, writer_generation,
				messages_path, compaction_path, manifest_path, managed_at, updated_at
			)
			SELECT l.session_id, 0, l.revision, l.writer_generation,
			       s.messages_path, NULL, NULL, l.updated_at, l.updated_at
			FROM session_leases l
			JOIN sessions s ON s.session_id = l.session_id;`);
			db.prepare(
				`UPDATE chat_catalog_schema SET version = 3 WHERE singleton = 1`,
			).run();
		}
		if (version < 4) {
			db.exec(`CREATE TABLE IF NOT EXISTS chat_event_delivery_scope (
				event_sequence INTEGER PRIMARY KEY,
				workspace_key TEXT NOT NULL,
				session_ids_json TEXT NOT NULL,
				FOREIGN KEY (event_sequence) REFERENCES chat_events(event_sequence) ON DELETE CASCADE
			);`);
			db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_event_delivery_workspace_sequence
				ON chat_event_delivery_scope(workspace_key, event_sequence ASC);`);
			// Legacy audit rows intentionally remain without delivery scope. Rebuilding
			// scope from mutable chat/tombstone state could misattribute a reused ID.
			db.prepare(
				`UPDATE chat_catalog_schema SET version = 4 WHERE singleton = 1`,
			).run();
		}
		if (version < 5) {
			const addColumn = (
				table: string,
				column: string,
				definition: string,
			): void => {
				const columns = new Set(
					db
						.prepare(`PRAGMA table_info(${table});`)
						.all()
						.map((row) => asString(row.name)),
				);
				if (!columns.has(column)) {
					db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
				}
			};
			addColumn(
				"chats",
				"audience_id",
				`TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512)`,
			);
			addColumn(
				"chat_bindings",
				"audience_id",
				`TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512)`,
			);
			addColumn(
				"chat_purge_tombstones",
				"audience_id",
				`TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512)`,
			);
			addColumn(
				"chat_purge_attempts",
				"audience_id",
				`TEXT NOT NULL DEFAULT '${CHAT_AUDIENCE_UNASSIGNED}' CHECK (length(audience_id) BETWEEN 1 AND 512)`,
			);
			addColumn("chat_event_delivery_scope", "audience_id", "TEXT");
			addColumn("chat_event_delivery_scope", "projection_json", "TEXT");
			// Existing event rows deliberately retain NULL audience/projection and are
			// therefore audit-only. Current chat state must never reconstruct scope.
			ensureAudienceV5SchemaObjects(db);
			captureAudienceMigrationEvidence(db, {
				sourceSchemaVersion: version,
				clock,
			});
			db.prepare(
				`UPDATE chat_catalog_schema SET version = 5 WHERE singleton = 1`,
			).run();
		}
		validateChatCatalogSchema(db);
		validateAudienceMigrationIntegrity(db);
		db.exec("COMMIT;");
		schemaTransactionOpen = false;
	} catch (error) {
		if (schemaTransactionOpen) db.exec("ROLLBACK;");
		throw error;
	}
	if (mappings.length === 0) return;
	db.exec("BEGIN IMMEDIATE;");
	try {
		reconcileAudienceMigrationAssignments(db, { mappings, clock });
		validateChatCatalogSchema(db);
		validateAudienceMigrationIntegrity(db);
		db.exec("COMMIT;");
	} catch (error) {
		db.exec("ROLLBACK;");
		throw error;
	}
}

interface ReplayRow {
	intentDigest: string;
	resultChatId?: string;
	resultRevision: number;
	applied: boolean;
}

export class SqliteChatCatalogService {
	private readonly dataDir: string;
	private readonly tenantId: string;
	private readonly clock: () => Date;
	private readonly defaultLeaseTtlMs: number;
	private readonly maxLeaseTtlMs: number;
	private readonly purgeAttemptStaleMs: number;
	private readonly purgeAttemptHeartbeatMs: number;
	private readonly artifactCleanup: ChatArtifactCleanupPort | undefined;
	private readonly audienceMigrationMappings: readonly ChatAudienceMigrationMapping[];
	private readonly rekeyReplayCredentials = new Map<string, string>();
	private db: SqliteDb | undefined;

	constructor(options: SqliteChatCatalogServiceOptions = {}) {
		this.dataDir = options.dataDir ?? resolveDbDataDir();
		this.tenantId = boundedRequired(
			options.tenantId ?? "local",
			"catalog tenant id",
		);
		if (this.tenantId !== "local" && !options.dataDir) {
			throw new ChatCatalogError(
				"invalid_input",
				"nonlocal tenant catalog storage requires an explicit data directory",
			);
		}
		this.clock = options.clock ?? (() => new Date());
		this.maxLeaseTtlMs = options.maxLeaseTtlMs ?? MAX_LEASE_TTL_MS;
		this.defaultLeaseTtlMs = options.defaultLeaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
		this.purgeAttemptStaleMs =
			options.purgeAttemptStaleMs ?? DEFAULT_PURGE_ATTEMPT_STALE_MS;
		this.purgeAttemptHeartbeatMs =
			options.purgeAttemptHeartbeatMs ??
			Math.max(1, Math.floor(this.purgeAttemptStaleMs / 3));
		this.artifactCleanup = options.artifactCleanup;
		this.audienceMigrationMappings = Object.freeze(
			normalizeAudienceMigrationMappings(options.audienceMigrationMappings).map(
				(mapping) =>
					Object.freeze({
						profileAuthority: normalizeManagedProfileAuthority(
							JSON.parse(mapping.stampJson) as ManagedProfileAuthority,
						),
						audienceId: mapping.audienceId,
					}),
			),
		);
		if (
			!Number.isSafeInteger(this.maxLeaseTtlMs) ||
			this.maxLeaseTtlMs < 1 ||
			!Number.isSafeInteger(this.defaultLeaseTtlMs) ||
			this.defaultLeaseTtlMs < 1 ||
			this.defaultLeaseTtlMs > this.maxLeaseTtlMs ||
			!Number.isSafeInteger(this.purgeAttemptStaleMs) ||
			this.purgeAttemptStaleMs < 2 ||
			!Number.isSafeInteger(this.purgeAttemptHeartbeatMs) ||
			this.purgeAttemptHeartbeatMs < 1 ||
			this.purgeAttemptHeartbeatMs >= this.purgeAttemptStaleMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"catalog timing configuration is invalid",
			);
		}
	}

	dbPath(): string {
		return join(this.dataDir, "sessions.db");
	}

	tenantKey(): string {
		return this.tenantId;
	}

	/** Eagerly validates tenant ownership, migrations, and catalog schema. */
	init(): void {
		this.getDb();
	}

	private getDb(): SqliteDb {
		if (!this.db) {
			const candidate = loadSqliteDb(this.dbPath());
			try {
				ensureCatalogDatabaseTenant(candidate, this.tenantId);
				ensureSessionSchema(candidate, {
					includeLegacyMigrations: true,
					tenantId: this.tenantId,
				});
				ensureChatCatalogSchema(candidate, this.tenantId, {
					audienceMigrationMappings: this.audienceMigrationMappings,
					clock: this.clock,
				});
				this.db = candidate;
			} catch (error) {
				candidate.close?.();
				throw error;
			}
		}
		return this.db;
	}

	close(): void {
		this.db?.close?.();
		this.db = undefined;
		this.rekeyReplayCredentials.clear();
	}

	private rememberRekeyCredential(
		invocationId: string,
		leaseToken: string,
	): void {
		this.rekeyReplayCredentials.delete(invocationId);
		this.rekeyReplayCredentials.set(invocationId, leaseToken);
		while (this.rekeyReplayCredentials.size > MAX_REKEY_REPLAY_CREDENTIALS) {
			const oldest = this.rekeyReplayCredentials.keys().next().value;
			if (typeof oldest !== "string") break;
			this.rekeyReplayCredentials.delete(oldest);
		}
	}

	private transaction<T>(operation: (db: SqliteDb) => T): T {
		const db = this.getDb();
		db.exec("BEGIN IMMEDIATE;");
		try {
			const result = operation(db);
			db.exec("COMMIT;");
			return result;
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	private replay(
		db: SqliteDb,
		provenance: ChatMutationProvenance,
		operation: string,
		intentDigest: string,
	): ReplayRow | undefined {
		const row = db
			.prepare(
				`SELECT operation, intent_digest, result_chat_id, result_revision, applied
				 FROM chat_mutation_invocations
				 WHERE invocation_id = ?`,
			)
			.get(provenance.invocationId);
		if (!row) return undefined;
		if (
			asString(row.operation) !== operation ||
			asString(row.intent_digest) !== intentDigest
		) {
			throw new ChatCatalogError(
				"invocation_replay_conflict",
				"invocation was replayed with different intent",
			);
		}
		return {
			intentDigest,
			...(asOptionalString(row.result_chat_id)
				? { resultChatId: asOptionalString(row.result_chat_id) }
				: {}),
			resultRevision: Number(row.result_revision ?? 0),
			applied: Number(row.applied ?? 0) === 1,
		};
	}

	private recordReplay(
		db: SqliteDb,
		input: {
			provenance: ChatMutationProvenance;
			operation: string;
			intentDigest: string;
			chatId?: string;
			resultRevision: number;
			applied: boolean;
		},
	): void {
		db.prepare(
			`INSERT INTO chat_mutation_invocations (
				invocation_id, operation, intent_digest, result_chat_id,
				result_revision, applied
			) VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			input.provenance.invocationId,
			input.operation,
			input.intentDigest,
			input.chatId ?? null,
			input.resultRevision,
			input.applied ? 1 : 0,
		);
	}

	private recordEvent(
		db: SqliteDb,
		input: {
			chatId: string;
			eventType: CatalogLifecycleEventType;
			aggregateKind: ChatEventRecord["aggregateKind"];
			aggregateId: string;
			provenance: ChatMutationProvenance;
			previousRevision: number;
			resultingRevision: number;
			payload?: Record<string, unknown>;
		},
	): void {
		appendCatalogEvent(db, input);
	}

	private requireChatRow(db: SqliteDb, chatId: string): RawRow {
		const row = db.prepare(`SELECT * FROM chats WHERE chat_id = ?`).get(chatId);
		if (!row) {
			throw new ChatCatalogError(
				"chat_not_found",
				`chat ${chatId} was not found`,
			);
		}
		return row;
	}

	private requireSessionRow(db: SqliteDb, sessionId: string): RawRow {
		const row = db
			.prepare(
				`SELECT session_id, source, started_at, status, workspace_root,
					is_subagent, updated_at
				 FROM sessions WHERE session_id = ?`,
			)
			.get(sessionId);
		if (!row) {
			throw new ChatCatalogError(
				"session_not_found",
				`session ${sessionId} was not found`,
			);
		}
		return row;
	}

	admitRootSession(input: AdmitRootSessionInput): AdmitRootSessionResult {
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const source = boundedRequired(String(input.source), "session source", 128);
		const provider = boundedRequired(input.provider, "session provider");
		const model = boundedRequired(input.model, "session model");
		const cwd = canonicalWorkspace(input.cwd, "session cwd");
		const workspaceRoot = canonicalWorkspace(
			input.workspaceRoot,
			"workspace root",
		);
		const startedAt = canonicalTime(input.startedAt, "session start time");
		const teamName = boundedOptional(input.teamName, "team name") || null;
		const prompt = input.prompt?.trim() || null;
		const metadata = input.metadata ?? {};
		const metadataJson = stringifyMetadata(metadata);
		const audienceId = admissionAudienceId({
			trustedAudienceId: input.audienceId,
			metadata,
		});
		const title = boundedOptional(input.title, "chat title", MAX_TITLE_LENGTH);
		const titleSource = boundedOptional(input.titleSource, "title source", 128);
		if (!Number.isSafeInteger(input.pid) || input.pid < 0) {
			throw new ChatCatalogError("invalid_input", "session pid is invalid");
		}
		for (const [label, value] of [
			["interactive", input.interactive],
			["enable tools", input.enableTools],
			["enable spawn", input.enableSpawn],
			["enable teams", input.enableTeams],
		] as const) {
			if (typeof value !== "boolean") {
				throw new ChatCatalogError(
					"invalid_input",
					`session ${label} flag is invalid`,
				);
			}
		}
		const ttlMs = input.ttlMs ?? this.defaultLeaseTtlMs;
		if (
			!Number.isSafeInteger(ttlMs) ||
			ttlMs < 1 ||
			ttlMs > this.maxLeaseTtlMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease TTL is outside the configured authority limit",
			);
		}
		const provenance = normalizeProvenance(input.provenance);
		const ownerId = requireActorId(provenance);
		const now = this.clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
		const sessionIdentity = {
			sessionId,
			source,
			pid: input.pid,
			startedAt,
			endedAt: null,
			exitCode: null,
			status: "idle",
			statusLock: 0,
			interactive: input.interactive,
			provider,
			model,
			cwd,
			workspaceRoot,
			teamName,
			enableTools: input.enableTools,
			enableSpawn: input.enableSpawn,
			enableTeams: input.enableTeams,
			parentSessionId: null,
			parentAgentId: null,
			agentId: null,
			conversationId: null,
			isSubagent: false,
			prompt,
			metadata,
			hookPath: "",
			messagesPath: null,
			updatedAt: startedAt,
		};
		const operation = "admit_root_session";
		const intentDigest = digestIntent({
			chatId,
			audienceId,
			session: sessionIdentity,
			title,
			titleSource,
			ownerId,
			ttlMs,
		});
		const outcome = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) {
				return { applied: false } as const;
			}
			if (
				db
					.prepare(`SELECT 1 FROM chat_purge_tombstones WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_purged",
					`session ${sessionId} was previously purged`,
				);
			}
			const existingSession = db
				.prepare(`SELECT * FROM sessions WHERE session_id = ?`)
				.get(sessionId);
			if (existingSession) {
				const existingIdentity = {
					sessionId: asString(existingSession.session_id),
					source: asString(existingSession.source),
					pid: Number(existingSession.pid),
					startedAt: asString(existingSession.started_at),
					endedAt: asOptionalString(existingSession.ended_at) ?? null,
					exitCode:
						existingSession.exit_code === null ||
						existingSession.exit_code === undefined
							? null
							: Number(existingSession.exit_code),
					status: asString(existingSession.status),
					statusLock: Number(existingSession.status_lock ?? 0),
					interactive: Number(existingSession.interactive ?? 0) === 1,
					provider: asString(existingSession.provider),
					model: asString(existingSession.model),
					cwd: asString(existingSession.cwd),
					workspaceRoot: asString(existingSession.workspace_root),
					teamName: asOptionalString(existingSession.team_name) ?? null,
					enableTools: Number(existingSession.enable_tools ?? 0) === 1,
					enableSpawn: Number(existingSession.enable_spawn ?? 0) === 1,
					enableTeams: Number(existingSession.enable_teams ?? 0) === 1,
					parentSessionId:
						asOptionalString(existingSession.parent_session_id) ?? null,
					parentAgentId:
						asOptionalString(existingSession.parent_agent_id) ?? null,
					agentId: asOptionalString(existingSession.agent_id) ?? null,
					conversationId:
						asOptionalString(existingSession.conversation_id) ?? null,
					isSubagent: Number(existingSession.is_subagent ?? 0) === 1,
					prompt: asOptionalString(existingSession.prompt) ?? null,
					metadata: parsePayload(existingSession.metadata_json),
					hookPath: asOptionalString(existingSession.hook_path) ?? "",
					messagesPath: asOptionalString(existingSession.messages_path) ?? null,
					updatedAt: asString(existingSession.updated_at),
				};
				if (digestIntent(existingIdentity) !== digestIntent(sessionIdentity)) {
					throw new ChatCatalogError(
						"session_already_attached",
						"session id conflicts with an existing durable session",
					);
				}
			} else {
				db.prepare(
					`INSERT INTO sessions (
						session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
						provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
						parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
						metadata_json, transcript_path, hook_path, messages_path, updated_at
					) VALUES (?, ?, ?, ?, NULL, NULL, 'idle', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?, '', '', NULL, ?)`,
				).run(
					sessionId,
					source,
					input.pid,
					startedAt,
					input.interactive ? 1 : 0,
					provider,
					model,
					cwd,
					workspaceRoot,
					teamName,
					input.enableTools ? 1 : 0,
					input.enableSpawn ? 1 : 0,
					input.enableTeams ? 1 : 0,
					prompt,
					metadataJson,
					startedAt,
				);
			}
			if (
				db
					.prepare(`SELECT 1 FROM chat_sessions WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_already_attached",
					"session is already attached to a chat",
				);
			}
			if (db.prepare(`SELECT 1 FROM chats WHERE chat_id = ?`).get(chatId)) {
				throw new ChatCatalogError(
					"lineage_conflict",
					`chat id ${chatId} already exists`,
				);
			}
			if (
				db
					.prepare(`SELECT 1 FROM session_leases WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"new session already has lease history",
				);
			}
			db.prepare(
				`INSERT INTO chats (
					chat_id, workspace_key, audience_id, catalog_state, head_session_id,
					parent_chat_id, title, title_source, source_kind, created_at,
					last_activity_at, archived_at, revision
				) VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, ?, ?, ?, NULL, 1)`,
			).run(
				chatId,
				workspaceRoot,
				audienceId,
				sessionId,
				title || null,
				titleSource || null,
				source,
				provenance.occurredAt,
				startedAt,
			);
			db.prepare(
				`INSERT INTO chat_sessions (
					session_id, chat_id, relation_kind, parent_session_id,
					ordinal, attached_at
				) VALUES (?, ?, 'root', NULL, 0, ?)`,
			).run(sessionId, chatId, provenance.occurredAt);
			const leaseToken = randomBytes(32).toString("base64url");
			db.prepare(
				`INSERT INTO session_leases (
					session_id, owner_id, lease_token_hash, is_active,
					expires_at, revision, writer_generation, updated_at
				) VALUES (?, ?, ?, 1, ?, 1, 1, ?)`,
			).run(
				sessionId,
				ownerId,
				digestLeaseToken(leaseToken),
				expiresAt,
				provenance.occurredAt,
			);
			db.prepare(
				`INSERT INTO session_writer_heads (
					session_id, commit_sequence, lease_revision, writer_generation,
					managed_at, updated_at
				) VALUES (?, 0, 1, 1, ?, ?)`,
			).run(sessionId, provenance.occurredAt, provenance.occurredAt);
			this.recordEvent(db, {
				chatId,
				eventType: "chat.created",
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: 0,
				resultingRevision: 1,
				payload: { sessionId, relationKind: "root" },
			});
			this.recordEvent(db, {
				chatId,
				eventType: "session.lease_acquired",
				aggregateKind: "lease",
				aggregateId: sessionId,
				provenance,
				previousRevision: 0,
				resultingRevision: 1,
				payload: {
					sessionId,
					ownerId,
					expiresAt,
					leaseRevision: 1,
					writerGeneration: 1,
				},
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: 1,
				applied: true,
			});
			return { applied: true, leaseToken } as const;
		});
		const chat = this.getChat(chatId);
		const lease = this.getSessionLease(sessionId);
		if (!chat || !lease) {
			throw new ChatCatalogError(
				"lease_conflict",
				"committed root admission projection is missing",
			);
		}
		return {
			applied: outcome.applied,
			chat,
			lease,
			...(outcome.applied ? { leaseToken: outcome.leaseToken } : {}),
		};
	}

	admitRelatedSession(
		input: AdmitRelatedSessionInput,
	): AdmitRelatedSessionResult {
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const parentSessionId = boundedRequired(
			input.parentSessionId,
			"parent session id",
		);
		if (sessionId === parentSessionId) {
			throw new ChatCatalogError(
				"lineage_conflict",
				"related session must differ from its parent",
			);
		}
		const relationKind = input.relationKind;
		const isBranch =
			relationKind === "fork" || relationKind === "checkpoint_restore";
		if (
			!isBranch &&
			relationKind !== "config_restart" &&
			relationKind !== "recovery"
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"related session relation kind is invalid",
			);
		}
		if (isBranch && input.expectedRevision !== undefined) {
			throw new ChatCatalogError(
				"invalid_input",
				"branch admission does not accept an expected revision",
			);
		}
		let expectedRevision: number | undefined;
		if (!isBranch) {
			if (input.expectedRevision === undefined) {
				throw new ChatCatalogError(
					"invalid_input",
					"successor admission requires an expected revision",
				);
			}
			expectedRevision = validRevision(input.expectedRevision);
		}
		const source = boundedRequired(String(input.source), "session source", 128);
		const provider = boundedRequired(input.provider, "session provider");
		const model = boundedRequired(input.model, "session model");
		const cwd = canonicalWorkspace(input.cwd, "session cwd");
		const workspaceRoot = canonicalWorkspace(
			input.workspaceRoot,
			"workspace root",
		);
		const startedAt = canonicalTime(input.startedAt, "session start time");
		const teamName = boundedOptional(input.teamName, "team name") || null;
		const prompt = input.prompt?.trim() || null;
		const metadata = input.metadata ?? {};
		const metadataJson = stringifyMetadata(metadata);
		const audienceId = admissionAudienceId({
			trustedAudienceId: input.audienceId,
			metadata,
		});
		const title = boundedOptional(input.title, "chat title", MAX_TITLE_LENGTH);
		const titleSource = boundedOptional(input.titleSource, "title source", 128);
		if (!isBranch && (title || titleSource)) {
			throw new ChatCatalogError(
				"invalid_input",
				"successor admission cannot replace chat title",
			);
		}
		if (!Number.isSafeInteger(input.pid) || input.pid < 0) {
			throw new ChatCatalogError("invalid_input", "session pid is invalid");
		}
		for (const [label, value] of [
			["interactive", input.interactive],
			["enable tools", input.enableTools],
			["enable spawn", input.enableSpawn],
			["enable teams", input.enableTeams],
		] as const) {
			if (typeof value !== "boolean") {
				throw new ChatCatalogError(
					"invalid_input",
					`session ${label} flag is invalid`,
				);
			}
		}
		const ttlMs = input.ttlMs ?? this.defaultLeaseTtlMs;
		if (
			!Number.isSafeInteger(ttlMs) ||
			ttlMs < 1 ||
			ttlMs > this.maxLeaseTtlMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease TTL is outside the configured authority limit",
			);
		}
		const provenance = normalizeProvenance(input.provenance);
		const ownerId = requireActorId(provenance);
		const now = this.clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
		const sessionIdentity = {
			sessionId,
			source,
			pid: input.pid,
			startedAt,
			endedAt: null,
			exitCode: null,
			status: "idle",
			statusLock: 0,
			interactive: input.interactive,
			provider,
			model,
			cwd,
			workspaceRoot,
			teamName,
			enableTools: input.enableTools,
			enableSpawn: input.enableSpawn,
			enableTeams: input.enableTeams,
			parentSessionId: null,
			parentAgentId: null,
			agentId: null,
			conversationId: null,
			isSubagent: false,
			prompt,
			metadata,
			hookPath: "",
			messagesPath: null,
			updatedAt: startedAt,
		};
		const operation = `admit_related_session:${relationKind}`;
		const intentDigest = digestIntent({
			chatId,
			audienceId,
			parentSessionId,
			relationKind,
			...(expectedRevision === undefined ? {} : { expectedRevision }),
			session: sessionIdentity,
			title,
			titleSource,
			ownerId,
			ttlMs,
		});
		const outcome = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) {
				return { applied: false } as const;
			}
			if (
				db
					.prepare(`SELECT 1 FROM chat_purge_tombstones WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_purged",
					`session ${sessionId} was previously purged`,
				);
			}
			const existingSession = db
				.prepare(`SELECT * FROM sessions WHERE session_id = ?`)
				.get(sessionId);
			if (existingSession) {
				const existingIdentity = {
					sessionId: asString(existingSession.session_id),
					source: asString(existingSession.source),
					pid: Number(existingSession.pid),
					startedAt: asString(existingSession.started_at),
					endedAt: asOptionalString(existingSession.ended_at) ?? null,
					exitCode:
						existingSession.exit_code === null ||
						existingSession.exit_code === undefined
							? null
							: Number(existingSession.exit_code),
					status: asString(existingSession.status),
					statusLock: Number(existingSession.status_lock ?? 0),
					interactive: Number(existingSession.interactive ?? 0) === 1,
					provider: asString(existingSession.provider),
					model: asString(existingSession.model),
					cwd: asString(existingSession.cwd),
					workspaceRoot: asString(existingSession.workspace_root),
					teamName: asOptionalString(existingSession.team_name) ?? null,
					enableTools: Number(existingSession.enable_tools ?? 0) === 1,
					enableSpawn: Number(existingSession.enable_spawn ?? 0) === 1,
					enableTeams: Number(existingSession.enable_teams ?? 0) === 1,
					parentSessionId:
						asOptionalString(existingSession.parent_session_id) ?? null,
					parentAgentId:
						asOptionalString(existingSession.parent_agent_id) ?? null,
					agentId: asOptionalString(existingSession.agent_id) ?? null,
					conversationId:
						asOptionalString(existingSession.conversation_id) ?? null,
					isSubagent: Number(existingSession.is_subagent ?? 0) === 1,
					prompt: asOptionalString(existingSession.prompt) ?? null,
					metadata: parsePayload(existingSession.metadata_json),
					hookPath: asOptionalString(existingSession.hook_path) ?? "",
					messagesPath: asOptionalString(existingSession.messages_path) ?? null,
					updatedAt: asString(existingSession.updated_at),
				};
				if (digestIntent(existingIdentity) !== digestIntent(sessionIdentity)) {
					throw new ChatCatalogError(
						"session_already_attached",
						"session id conflicts with an existing durable session",
					);
				}
			} else {
				db.prepare(
					`INSERT INTO sessions (
						session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
						provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
						parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
						metadata_json, transcript_path, hook_path, messages_path, updated_at
					) VALUES (?, ?, ?, ?, NULL, NULL, 'idle', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?, ?, '', '', NULL, ?)`,
				).run(
					sessionId,
					source,
					input.pid,
					startedAt,
					input.interactive ? 1 : 0,
					provider,
					model,
					cwd,
					workspaceRoot,
					teamName,
					input.enableTools ? 1 : 0,
					input.enableSpawn ? 1 : 0,
					input.enableTeams ? 1 : 0,
					prompt,
					metadataJson,
					startedAt,
				);
			}
			if (
				db
					.prepare(`SELECT 1 FROM chat_sessions WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_already_attached",
					"session is already attached to a chat",
				);
			}
			if (
				db
					.prepare(`SELECT 1 FROM session_leases WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"new session already has lease history",
				);
			}
			const parent = db
				.prepare(
					`SELECT cs.chat_id, c.workspace_key, c.audience_id, c.catalog_state,
					        c.head_session_id, c.last_activity_at, c.revision
					 FROM chat_sessions cs
					 JOIN chats c ON c.chat_id = cs.chat_id
					 WHERE cs.session_id = ?`,
				)
				.get(parentSessionId);
			if (!parent) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"related parent session is not attached to a chat",
				);
			}
			const parentChatId = asString(parent.chat_id);
			const parentAudienceId = normalizeAudienceId(
				asString(parent.audience_id),
				"parent chat audience",
				{ allowUnassigned: true },
			);
			if (parentAudienceId !== audienceId) {
				throw new ChatCatalogError(
					"session_not_found",
					"related parent session was not found",
				);
			}
			if (workspaceRoot !== asString(parent.workspace_key)) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"related session workspace differs from its parent chat",
				);
			}
			let previousRevision = 0;
			let resultingRevision = 1;
			if (isBranch) {
				if (asString(parent.catalog_state) === "deleting") {
					throw new ChatCatalogError(
						"chat_deleting",
						"cannot derive a chat from a deleting source",
					);
				}
				if (db.prepare(`SELECT 1 FROM chats WHERE chat_id = ?`).get(chatId)) {
					throw new ChatCatalogError(
						"lineage_conflict",
						`chat id ${chatId} already exists`,
					);
				}
				db.prepare(
					`INSERT INTO chats (
						chat_id, workspace_key, audience_id, catalog_state, head_session_id,
						parent_chat_id, title, title_source, source_kind, created_at,
						last_activity_at, archived_at, revision
					) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
				).run(
					chatId,
					workspaceRoot,
					audienceId,
					sessionId,
					parentChatId,
					title || null,
					titleSource || null,
					source,
					provenance.occurredAt,
					startedAt,
				);
				db.prepare(
					`INSERT INTO chat_sessions (
						session_id, chat_id, relation_kind, parent_session_id,
						ordinal, attached_at
					) VALUES (?, ?, ?, ?, 0, ?)`,
				).run(
					sessionId,
					chatId,
					relationKind,
					parentSessionId,
					provenance.occurredAt,
				);
			} else {
				if (chatId !== parentChatId) {
					throw new ChatCatalogError(
						"lineage_conflict",
						"successor target differs from the parent chat",
					);
				}
				if (asString(parent.catalog_state) !== "active") {
					throw new ChatCatalogError(
						asString(parent.catalog_state) === "deleting"
							? "chat_deleting"
							: "chat_not_active",
						"successor sessions require an active chat",
					);
				}
				previousRevision = Number(parent.revision ?? 0);
				if (previousRevision !== expectedRevision) {
					throw new ChatCatalogError(
						"revision_conflict",
						"chat changed before successor admission",
					);
				}
				if (asString(parent.head_session_id) !== parentSessionId) {
					throw new ChatCatalogError(
						"lineage_conflict",
						"successor parent is not the current chat head",
					);
				}
				resultingRevision = previousRevision + 1;
				const activityAt =
					startedAt > asString(parent.last_activity_at)
						? startedAt
						: asString(parent.last_activity_at);
				const ordinal = Number(
					db
						.prepare(
							`SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
							 FROM chat_sessions WHERE chat_id = ?`,
						)
						.get(chatId)?.ordinal ?? 0,
				);
				db.prepare(
					`INSERT INTO chat_sessions (
						session_id, chat_id, relation_kind, parent_session_id,
						ordinal, attached_at
					) VALUES (?, ?, ?, ?, ?, ?)`,
				).run(
					sessionId,
					chatId,
					relationKind,
					parentSessionId,
					ordinal,
					provenance.occurredAt,
				);
				db.prepare(
					`UPDATE chats
					 SET head_session_id = ?, last_activity_at = ?, revision = ?
					 WHERE chat_id = ? AND revision = ?`,
				).run(
					sessionId,
					activityAt,
					resultingRevision,
					chatId,
					previousRevision,
				);
			}
			const leaseToken = randomBytes(32).toString("base64url");
			db.prepare(
				`INSERT INTO session_leases (
					session_id, owner_id, lease_token_hash, is_active,
					expires_at, revision, writer_generation, updated_at
				) VALUES (?, ?, ?, 1, ?, 1, 1, ?)`,
			).run(
				sessionId,
				ownerId,
				digestLeaseToken(leaseToken),
				expiresAt,
				provenance.occurredAt,
			);
			db.prepare(
				`INSERT INTO session_writer_heads (
					session_id, commit_sequence, lease_revision, writer_generation,
					managed_at, updated_at
				) VALUES (?, 0, 1, 1, ?, ?)`,
			).run(sessionId, provenance.occurredAt, provenance.occurredAt);
			this.recordEvent(db, {
				chatId,
				eventType: `chat.${relationKind}`,
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision,
				resultingRevision,
				payload: { parentChatId, parentSessionId, sessionId },
			});
			this.recordEvent(db, {
				chatId,
				eventType: "session.lease_acquired",
				aggregateKind: "lease",
				aggregateId: sessionId,
				provenance,
				previousRevision: 0,
				resultingRevision: 1,
				payload: {
					sessionId,
					ownerId,
					expiresAt,
					leaseRevision: 1,
					writerGeneration: 1,
				},
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return { applied: true, leaseToken } as const;
		});
		const chat = this.getChat(chatId);
		const lease = this.getSessionLease(sessionId);
		if (!chat || !lease) {
			throw new ChatCatalogError(
				"lease_conflict",
				"committed related admission projection is missing",
			);
		}
		return {
			applied: outcome.applied,
			chat,
			lease,
			...(outcome.applied ? { leaseToken: outcome.leaseToken } : {}),
		};
	}

	adoptRootSession(
		input: AdoptRootSessionInput,
	): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const audienceId =
			input.audienceId === undefined
				? LOCAL_CATALOG_AUDIENCE_ID
				: normalizeAudienceId(input.audienceId);
		const title = boundedOptional(input.title, "chat title", MAX_TITLE_LENGTH);
		const titleSource = boundedOptional(input.titleSource, "title source", 128);
		const provenance = normalizeProvenance(input.provenance);
		const operation = "adopt_root";
		const intentDigest = digestIntent({
			chatId,
			sessionId,
			audienceId,
			title,
			titleSource,
		});
		const applied = this.transaction((db) => {
			const replay = this.replay(db, provenance, operation, intentDigest);
			if (replay) return false;
			if (
				db
					.prepare(`SELECT 1 FROM chat_purge_tombstones WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_purged",
					`session ${sessionId} was previously purged`,
				);
			}
			const session = this.requireSessionRow(db, sessionId);
			if (Number(session.is_subagent ?? 0) === 1) {
				throw new ChatCatalogError(
					"invalid_input",
					"subagent sessions cannot be adopted as root chats",
				);
			}
			const attached = db
				.prepare(`SELECT chat_id FROM chat_sessions WHERE session_id = ?`)
				.get(sessionId);
			if (attached) {
				if (asString(attached.chat_id) !== chatId) {
					throw new ChatCatalogError(
						"session_already_attached",
						`session ${sessionId} is already attached to another chat`,
					);
				}
				const existing = this.requireChatRow(db, chatId);
				this.recordReplay(db, {
					provenance,
					operation,
					intentDigest,
					chatId,
					resultRevision: Number(existing.revision ?? 0),
					applied: false,
				});
				return false;
			}
			if (db.prepare(`SELECT 1 FROM chats WHERE chat_id = ?`).get(chatId)) {
				throw new ChatCatalogError(
					"lineage_conflict",
					`chat id ${chatId} already exists`,
				);
			}
			const workspaceKey = canonicalWorkspace(
				asString(session.workspace_root),
				"workspace root",
			);
			const activityAt = canonicalTime(
				asOptionalString(session.updated_at) ?? asString(session.started_at),
				"session activity time",
			);
			db.prepare(
				`INSERT INTO chats (
					chat_id, workspace_key, audience_id, catalog_state, head_session_id,
					parent_chat_id, title, title_source, source_kind, created_at,
					last_activity_at, archived_at, revision
				) VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, ?, ?, ?, NULL, 1)`,
			).run(
				chatId,
				workspaceKey,
				audienceId,
				sessionId,
				title || null,
				titleSource || null,
				asString(session.source),
				provenance.occurredAt,
				activityAt,
			);
			db.prepare(
				`INSERT INTO chat_sessions (
					session_id, chat_id, relation_kind, parent_session_id,
					ordinal, attached_at
				) VALUES (?, ?, 'root', NULL, 0, ?)`,
			).run(sessionId, chatId, provenance.occurredAt);
			this.recordEvent(db, {
				chatId,
				eventType: "chat.created",
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: 0,
				resultingRevision: 1,
				payload: { sessionId, relationKind: "root" },
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: 1,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value)
			throw new ChatCatalogError("chat_not_found", "created chat missing");
		return { applied, value };
	}

	recordBranch(input: RecordBranchInput): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const sourceChatId = boundedRequired(input.sourceChatId, "source chat id");
		const sourceSessionId = boundedRequired(
			input.sourceSessionId,
			"source session id",
		);
		const title = boundedOptional(input.title, "chat title", MAX_TITLE_LENGTH);
		const titleSource = boundedOptional(input.titleSource, "title source", 128);
		const provenance = normalizeProvenance(input.provenance);
		const operation = `record_branch:${input.relationKind}`;
		const intentDigest = digestIntent({
			chatId,
			sessionId,
			sourceChatId,
			sourceSessionId,
			relationKind: input.relationKind,
			title,
			titleSource,
		});
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			if (
				db
					.prepare(`SELECT 1 FROM chat_purge_tombstones WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_purged",
					`session ${sessionId} was previously purged`,
				);
			}
			const sourceChat = this.requireChatRow(db, sourceChatId);
			if (asString(sourceChat.catalog_state) === "deleting") {
				throw new ChatCatalogError(
					"chat_deleting",
					"cannot derive a chat from a deleting source",
				);
			}
			const sourceAudienceId = normalizeAudienceId(
				asString(sourceChat.audience_id),
				"source chat audience",
			);
			const sourceMembership = db
				.prepare(
					`SELECT 1 FROM chat_sessions WHERE chat_id = ? AND session_id = ?`,
				)
				.get(sourceChatId, sourceSessionId);
			if (!sourceMembership) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"source session does not belong to source chat",
				);
			}
			const session = this.requireSessionRow(db, sessionId);
			if (Number(session.is_subagent ?? 0) === 1) {
				throw new ChatCatalogError(
					"invalid_input",
					"subagent sessions cannot become derived chats",
				);
			}
			if (
				db
					.prepare(`SELECT 1 FROM chat_sessions WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_already_attached",
					`session ${sessionId} is already attached`,
				);
			}
			if (db.prepare(`SELECT 1 FROM chats WHERE chat_id = ?`).get(chatId)) {
				throw new ChatCatalogError(
					"lineage_conflict",
					`chat id ${chatId} already exists`,
				);
			}
			const workspaceKey = canonicalWorkspace(
				asString(session.workspace_root),
				"workspace root",
			);
			if (workspaceKey !== asString(sourceChat.workspace_key)) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"branch session workspace differs from source chat",
				);
			}
			const activityAt = canonicalTime(
				asOptionalString(session.updated_at) ?? asString(session.started_at),
				"session activity time",
			);
			db.prepare(
				`INSERT INTO chats (
					chat_id, workspace_key, audience_id, catalog_state, head_session_id,
					parent_chat_id, title, title_source, source_kind, created_at,
					last_activity_at, archived_at, revision
				) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
			).run(
				chatId,
				workspaceKey,
				sourceAudienceId,
				sessionId,
				sourceChatId,
				title || null,
				titleSource || null,
				asString(session.source),
				provenance.occurredAt,
				activityAt,
			);
			db.prepare(
				`INSERT INTO chat_sessions (
					session_id, chat_id, relation_kind, parent_session_id,
					ordinal, attached_at
				) VALUES (?, ?, ?, ?, 0, ?)`,
			).run(
				sessionId,
				chatId,
				input.relationKind,
				sourceSessionId,
				provenance.occurredAt,
			);
			this.recordEvent(db, {
				chatId,
				eventType: `chat.${input.relationKind}`,
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: 0,
				resultingRevision: 1,
				payload: { sourceChatId, sourceSessionId, sessionId },
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: 1,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value)
			throw new ChatCatalogError("chat_not_found", "created branch missing");
		return { applied, value };
	}

	attachSuccessorSession(
		input: AttachSuccessorSessionInput,
	): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const parentSessionId = boundedRequired(
			input.parentSessionId,
			"parent session id",
		);
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		const operation = `attach_successor:${input.relationKind}`;
		const intentDigest = digestIntent({
			chatId,
			sessionId,
			parentSessionId,
			relationKind: input.relationKind,
			expectedRevision,
		});
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			if (
				db
					.prepare(`SELECT 1 FROM chat_purge_tombstones WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_purged",
					`session ${sessionId} was previously purged`,
				);
			}
			const chat = this.requireChatRow(db, chatId);
			if (asString(chat.catalog_state) !== "active") {
				throw new ChatCatalogError(
					asString(chat.catalog_state) === "deleting"
						? "chat_deleting"
						: "chat_not_active",
					"successor sessions require an active chat",
				);
			}
			const currentRevision = Number(chat.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before successor attachment",
				);
			}
			if (asString(chat.head_session_id) !== parentSessionId) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"successor parent is not the current chat head",
				);
			}
			if (
				!db
					.prepare(
						`SELECT 1 FROM chat_sessions WHERE chat_id = ? AND session_id = ?`,
					)
					.get(chatId, parentSessionId)
			) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"successor parent does not belong to chat",
				);
			}
			if (
				db
					.prepare(`SELECT 1 FROM chat_sessions WHERE session_id = ?`)
					.get(sessionId)
			) {
				throw new ChatCatalogError(
					"session_already_attached",
					`session ${sessionId} is already attached`,
				);
			}
			const session = this.requireSessionRow(db, sessionId);
			if (Number(session.is_subagent ?? 0) === 1) {
				throw new ChatCatalogError(
					"invalid_input",
					"subagent sessions cannot become chat successors",
				);
			}
			const workspaceKey = canonicalWorkspace(
				asString(session.workspace_root),
				"workspace root",
			);
			if (workspaceKey !== asString(chat.workspace_key)) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"successor session workspace differs from chat",
				);
			}
			const ordinalRow = db
				.prepare(
					`SELECT COALESCE(MAX(ordinal), -1) + 1 AS next_ordinal
					 FROM chat_sessions WHERE chat_id = ?`,
				)
				.get(chatId);
			const ordinal = Number(ordinalRow?.next_ordinal ?? 0);
			const activityAt = canonicalTime(
				asOptionalString(session.updated_at) ?? asString(session.started_at),
				"session activity time",
			);
			const lastActivityAt =
				activityAt > asString(chat.last_activity_at)
					? activityAt
					: asString(chat.last_activity_at);
			const resultingRevision = currentRevision + 1;
			db.prepare(
				`INSERT INTO chat_sessions (
					session_id, chat_id, relation_kind, parent_session_id,
					ordinal, attached_at
				) VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				sessionId,
				chatId,
				input.relationKind,
				parentSessionId,
				ordinal,
				provenance.occurredAt,
			);
			db.prepare(
				`UPDATE chats SET head_session_id = ?, last_activity_at = ?, revision = ?
				 WHERE chat_id = ? AND revision = ?`,
			).run(
				sessionId,
				lastActivityAt,
				resultingRevision,
				chatId,
				currentRevision,
			);
			this.recordEvent(db, {
				chatId,
				eventType: `chat.${input.relationKind}`,
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: { sessionId, parentSessionId, ordinal },
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value)
			throw new ChatCatalogError("chat_not_found", "updated chat missing");
		return { applied, value };
	}

	recordChatActivity(
		input: RecordChatActivityInput,
	): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		const operation = "record_chat_activity";
		const applied = this.transaction((db) => {
			const sessionActivity = db
				.prepare(`SELECT updated_at FROM sessions WHERE session_id = ?`)
				.get(sessionId);
			if (!sessionActivity) {
				throw new ChatCatalogError(
					"session_not_found",
					`session ${sessionId} was not found`,
				);
			}
			const activityAt = canonicalTime(
				asString(sessionActivity.updated_at),
				"session activity time",
			);
			const intentDigest = digestIntent({
				chatId,
				sessionId,
				expectedRevision,
				activityAt,
			});
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			const chat = this.requireChatRow(db, chatId);
			if (asString(chat.catalog_state) === "deleting") {
				throw new ChatCatalogError(
					"chat_deleting",
					"chat purge is in progress",
				);
			}
			const currentRevision = Number(chat.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before activity update",
				);
			}
			if (
				!db
					.prepare(
						`SELECT 1 FROM chat_sessions WHERE chat_id = ? AND session_id = ?`,
					)
					.get(chatId, sessionId)
			) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"activity session does not belong to chat",
				);
			}
			if (activityAt <= asString(chat.last_activity_at)) {
				this.recordReplay(db, {
					provenance,
					operation,
					intentDigest,
					chatId,
					resultRevision: currentRevision,
					applied: false,
				});
				return false;
			}
			const resultingRevision = currentRevision + 1;
			db.prepare(
				`UPDATE chats SET last_activity_at = ?, revision = ?
				 WHERE chat_id = ? AND revision = ?`,
			).run(activityAt, resultingRevision, chatId, currentRevision);
			this.recordEvent(db, {
				chatId,
				eventType: "chat.activity_recorded",
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: { sessionId, activityAt },
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value)
			throw new ChatCatalogError("chat_not_found", "updated chat missing");
		return { applied, value };
	}

	getMutationOutcome(
		invocationIdInput: string,
	): StoredChatMutationOutcome | undefined {
		const invocationId = boundedRequired(invocationIdInput, "invocation id");
		const row = this.getDb()
			.prepare(
				`SELECT invocation_id, operation, result_chat_id,
				 result_revision, applied FROM chat_mutation_invocations
				 WHERE invocation_id = ?`,
			)
			.get(invocationId);
		if (!row) return undefined;
		return {
			invocationId: asString(row.invocation_id),
			operation: asString(row.operation),
			...(asOptionalString(row.result_chat_id)
				? { resultChatId: asOptionalString(row.result_chat_id) }
				: {}),
			resultRevision: Number(row.result_revision ?? 0),
			applied: Number(row.applied ?? 0) === 1,
		};
	}

	getSessionWorkspaceKey(sessionIdInput: string): string | undefined {
		const sessionId = boundedRequired(sessionIdInput, "session id");
		const row = this.getDb()
			.prepare(`SELECT workspace_root FROM sessions WHERE session_id = ?`)
			.get(sessionId);
		return row
			? canonicalWorkspace(asString(row.workspace_root), "workspace root")
			: undefined;
	}

	listWorkspaceKeys(): string[] {
		return this.getDb()
			.prepare(
				`SELECT DISTINCT workspace_key
				 FROM chats
				 WHERE catalog_state <> 'deleting'
				 ORDER BY workspace_key ASC`,
			)
			.all()
			.map((row) =>
				canonicalWorkspace(asString(row.workspace_key), "workspace key"),
			);
	}

	getChatForSession(sessionIdInput: string): ChatDetail | undefined {
		const sessionId = boundedRequired(sessionIdInput, "session id");
		const row = this.getDb()
			.prepare(`SELECT chat_id FROM chat_sessions WHERE session_id = ?`)
			.get(sessionId);
		const chatId = asOptionalString(row?.chat_id);
		return chatId ? this.getChat(chatId) : undefined;
	}

	getPurgedChatWorkspaceKey(chatIdInput: string): string | undefined {
		const chatId = boundedRequired(chatIdInput, "chat id");
		const rows = this.getDb()
			.prepare(
				`SELECT DISTINCT s.workspace_root
				 FROM chat_purge_tombstones tombstone
				 JOIN sessions s ON s.session_id = tombstone.session_id
				 WHERE tombstone.chat_id = ? AND tombstone.purge_state = 'purged'`,
			)
			.all(chatId);
		if (rows.length === 0) return undefined;
		const workspaceKeys = new Set(
			rows.map((row) =>
				canonicalWorkspace(asString(row.workspace_root), "workspace root"),
			),
		);
		if (workspaceKeys.size !== 1) {
			throw new ChatCatalogError(
				"lineage_conflict",
				"purged chat spans multiple workspaces",
			);
		}
		return [...workspaceKeys][0];
	}

	getPurgedChatAudienceId(chatIdInput: string): string | undefined {
		const chatId = boundedRequired(chatIdInput, "chat id");
		const rows = this.getDb()
			.prepare(
				`SELECT DISTINCT audience_id FROM chat_purge_tombstones
				 WHERE chat_id = ? AND purge_state = 'purged'`,
			)
			.all(chatId);
		if (rows.length === 0) return undefined;
		const audienceIds = new Set(
			rows.map((row) =>
				normalizeAudienceId(asString(row.audience_id), "purged chat audience", {
					allowUnassigned: true,
				}),
			),
		);
		if (audienceIds.size !== 1) {
			throw new ChatCatalogError(
				"lineage_conflict",
				"purged chat spans multiple audiences",
			);
		}
		return [...audienceIds][0];
	}

	getSessionAudienceScope(
		sessionIdInput: string,
	):
		| { readonly workspaceKey: string; readonly audienceId: string }
		| undefined {
		const sessionId = boundedRequired(sessionIdInput, "session id");
		const row = this.getDb()
			.prepare(
				`SELECT c.workspace_key, c.audience_id
				 FROM chat_sessions cs
				 JOIN chats c ON c.chat_id = cs.chat_id
				 WHERE cs.session_id = ?`,
			)
			.get(sessionId);
		return row
			? Object.freeze({
					workspaceKey: canonicalWorkspace(
						asString(row.workspace_key),
						"session workspace",
					),
					audienceId: normalizeAudienceId(
						asString(row.audience_id),
						"session audience",
						{ allowUnassigned: true },
					),
				})
			: undefined;
	}

	hasAudienceSession(input: {
		sessionId: string;
		workspaceKey: string;
		audienceId: string;
	}): boolean {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		return Boolean(
			this.getDb()
				.prepare(
					`SELECT 1 FROM chat_sessions cs
					 JOIN chats c ON c.chat_id = cs.chat_id
					 WHERE cs.session_id = ? AND c.workspace_key = ?
					   AND c.audience_id = ?`,
				)
				.get(sessionId, workspaceKey, audienceId),
		);
	}

	private mapChatDetail(db: SqliteDb, row: RawRow): ChatDetail {
		const chatId = asString(row.chat_id);
		const sessions = db
			.prepare(
				`SELECT cs.chat_id, cs.session_id, cs.relation_kind,
					cs.parent_session_id, cs.ordinal, cs.attached_at, s.status
				 FROM chat_sessions cs
				 JOIN sessions s ON s.session_id = cs.session_id
				 WHERE cs.chat_id = ? ORDER BY cs.ordinal ASC`,
			)
			.all(chatId)
			.map(mapProjectionSession);
		const bindings = db
			.prepare(
				`SELECT * FROM chat_bindings
				 WHERE chat_id = ? AND is_bound = 1
				 ORDER BY transport, instance_id, channel_id, thread_id, participant_scope`,
			)
			.all(chatId)
			.map(mapBinding);
		return { ...mapChat(row), sessions, bindings };
	}

	getChat(chatIdInput: string): ChatDetail | undefined {
		const chatId = boundedRequired(chatIdInput, "chat id");
		const db = this.getDb();
		const row = db.prepare(`SELECT * FROM chats WHERE chat_id = ?`).get(chatId);
		return row ? this.mapChatDetail(db, row) : undefined;
	}

	getAudienceChat(input: {
		chatId: string;
		workspaceKey: string;
		audienceId: string;
	}): ChatDetail | undefined {
		const chatId = boundedRequired(input.chatId, "chat id");
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		const db = this.getDb();
		db.exec("BEGIN;");
		try {
			const row = db
				.prepare(
					`SELECT * FROM chats
					 WHERE chat_id = ? AND workspace_key = ? AND audience_id = ?`,
				)
				.get(chatId, workspaceKey, audienceId);
			const detail = row ? this.mapChatDetail(db, row) : undefined;
			db.exec("COMMIT;");
			return detail;
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	listChats(input: ListChatsInput): ChatPage {
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const state = input.catalogState ?? "active";
		if (state !== "active" && state !== "archived" && state !== "all") {
			throw new ChatCatalogError(
				"invalid_input",
				"catalog state filter is invalid",
			);
		}
		const limit = input.limit ?? 50;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new ChatCatalogError("invalid_input", "chat page limit is invalid");
		}
		const clauses = ["workspace_key = ?", "catalog_state != 'deleting'"];
		const params: unknown[] = [workspaceKey];
		if (input.audienceId !== undefined) {
			const audienceId = normalizeAudienceId(input.audienceId);
			clauses.push("audience_id = ?");
			params.push(audienceId);
		}
		if (state !== "all") {
			clauses.push("catalog_state = ?");
			params.push(state);
		}
		if (input.sourceKind !== undefined) {
			clauses.push("source_kind = ?");
			params.push(boundedRequired(input.sourceKind, "source kind", 128));
		}
		if (input.cursor) {
			clauses.push(
				"(last_activity_at < ? OR (last_activity_at = ? AND chat_id > ?))",
			);
			const cursorTime = canonicalTime(
				input.cursor.lastActivityAt,
				"cursor activity time",
			);
			params.push(
				cursorTime,
				cursorTime,
				boundedRequired(input.cursor.chatId, "cursor chat id"),
			);
		}
		const rows = this.getDb()
			.prepare(
				`SELECT * FROM chats WHERE ${clauses.join(" AND ")}
				 ORDER BY last_activity_at DESC, chat_id ASC LIMIT ?`,
			)
			.all(...params, limit + 1)
			.map(mapChat);
		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit);
		const tail = hasMore ? items.at(-1) : undefined;
		return {
			items,
			...(tail
				? {
						nextCursor: {
							lastActivityAt: tail.lastActivityAt,
							chatId: tail.chatId,
						},
					}
				: {}),
		};
	}

	createAudienceProjectionSnapshot(input: {
		workspaceKey: string;
		audienceId: string;
		catalogState?: "active" | "archived" | "all";
		maxChats: number;
	}): CatalogAudienceProjectionSnapshot {
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		const state = input.catalogState ?? "all";
		if (state !== "active" && state !== "archived" && state !== "all") {
			throw new ChatCatalogError(
				"invalid_input",
				"catalog state filter is invalid",
			);
		}
		if (
			!Number.isSafeInteger(input.maxChats) ||
			input.maxChats < 1 ||
			input.maxChats > 4_096
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"projection snapshot chat bound is invalid",
			);
		}
		const db = this.getDb();
		db.exec("BEGIN;");
		try {
			const snapshotSequence = validRevision(
				Number(
					db
						.prepare(
							`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence
							 FROM chat_events`,
						)
						.get()?.event_sequence ?? 0,
				),
				"projection snapshot sequence",
			);
			const clauses = [
				"workspace_key = ?",
				"audience_id = ?",
				"catalog_state <> 'deleting'",
			];
			const params: unknown[] = [workspaceKey, audienceId];
			if (state !== "all") {
				clauses.push("catalog_state = ?");
				params.push(state);
			}
			const rows = db
				.prepare(
					`SELECT * FROM chats WHERE ${clauses.join(" AND ")}
					 ORDER BY last_activity_at DESC, chat_id ASC LIMIT ?`,
				)
				.all(...params, input.maxChats + 1);
			if (rows.length > input.maxChats) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"projection snapshot capacity was exceeded",
				);
			}
			const chats = rows.map((row) => {
				const projection = projectChatRow(db, row);
				if (!projection) {
					throw new ChatCatalogError(
						"unsupported_capability",
						"projection snapshot selected a deleting chat",
					);
				}
				return projection;
			});
			db.exec("COMMIT;");
			return Object.freeze({
				snapshotSequence,
				chats: Object.freeze(chats),
			});
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	getAudienceProjection(input: {
		chatId: string;
		workspaceKey: string;
		audienceId: string;
	}): CatalogAudienceProjectionGetResult {
		const chatId = boundedRequired(input.chatId, "chat id");
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		const db = this.getDb();
		db.exec("BEGIN;");
		try {
			const snapshotSequence = validRevision(
				Number(
					db
						.prepare(
							`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence
							 FROM chat_events`,
						)
						.get()?.event_sequence ?? 0,
				),
				"projection snapshot sequence",
			);
			const row = db
				.prepare(
					`SELECT * FROM chats WHERE chat_id = ? AND workspace_key = ?
					 AND audience_id = ? AND catalog_state <> 'deleting'`,
				)
				.get(chatId, workspaceKey, audienceId);
			const chat = row ? projectChatRow(db, row) : null;
			db.exec("COMMIT;");
			return Object.freeze({ snapshotSequence, chat });
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	getAudienceSessionProjection(input: {
		sessionId: string;
		workspaceKey: string;
		audienceId: string;
	}): CatalogAudienceProjectionGetResult {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		const db = this.getDb();
		db.exec("BEGIN;");
		try {
			const snapshotSequence = validRevision(
				Number(
					db
						.prepare(
							`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence
							 FROM chat_events`,
						)
						.get()?.event_sequence ?? 0,
				),
				"projection snapshot sequence",
			);
			const row = db
				.prepare(
					`SELECT c.* FROM chat_sessions cs
					 JOIN chats c ON c.chat_id = cs.chat_id
					 WHERE cs.session_id = ? AND c.workspace_key = ?
					   AND c.audience_id = ? AND c.catalog_state <> 'deleting'`,
				)
				.get(sessionId, workspaceKey, audienceId);
			const chat = row ? projectChatRow(db, row) : null;
			db.exec("COMMIT;");
			return Object.freeze({ snapshotSequence, chat });
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	listUnassignedAudienceChats(input: {
		workspaceKey: string;
		limit?: number;
		cursor?: ChatAudienceInventoryCursor;
	}): ChatAudienceInventoryPage {
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const limit = input.limit ?? 100;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new ChatCatalogError(
				"invalid_input",
				"audience migration inventory limit is invalid",
			);
		}
		const cursor = input.cursor
			? boundedRequired(input.cursor.chatId, "inventory cursor chat id")
			: undefined;
		const rows = this.getDb()
			.prepare(
				`SELECT c.chat_id, c.workspace_key, c.revision,
				        COUNT(cs.session_id) AS session_count
				 FROM chats c
				 LEFT JOIN chat_sessions cs ON cs.chat_id = c.chat_id
				 WHERE c.workspace_key = ? AND c.audience_id = ?
				   AND (? IS NULL OR c.chat_id > ?)
				 GROUP BY c.chat_id, c.workspace_key, c.revision
				 ORDER BY c.chat_id ASC LIMIT ?`,
			)
			.all(
				workspaceKey,
				CHAT_AUDIENCE_UNASSIGNED,
				cursor ?? null,
				cursor ?? null,
				limit + 1,
			);
		const hasMore = rows.length > limit;
		const selected = hasMore ? rows.slice(0, limit) : rows;
		const items = selected.map((row) =>
			Object.freeze({
				chatId: asString(row.chat_id),
				workspaceKey: canonicalWorkspace(
					asString(row.workspace_key),
					"inventory workspace",
				),
				revision: validRevision(
					Number(row.revision ?? 0),
					"inventory revision",
				),
				sessionCount: validRevision(
					Number(row.session_count ?? 0),
					"inventory session count",
				),
			}),
		);
		const tail = hasMore ? items.at(-1) : undefined;
		return Object.freeze({
			items: Object.freeze(items),
			...(tail ? { nextCursor: Object.freeze({ chatId: tail.chatId }) } : {}),
		});
	}

	assignChatAudience(
		input: AssignChatAudienceInput,
	): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const audienceId = normalizeAudienceId(input.audienceId);
		const expectedRevision = validRevision(input.expectedRevision);
		const reason = boundedRequired(input.reason, "audience assignment reason");
		const provenance = normalizeProvenance(input.provenance);
		requireHuman(provenance);
		const operation = "assign_chat_audience";
		const intentDigest = digestIntent({
			chatId,
			audienceId,
			expectedRevision,
			reason,
		});
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			const chat = this.requireChatRow(db, chatId);
			const currentAudienceId = normalizeAudienceId(
				asString(chat.audience_id),
				"chat audience",
				{ allowUnassigned: true },
			);
			if (currentAudienceId !== CHAT_AUDIENCE_UNASSIGNED) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat audience is already assigned and immutable",
				);
			}
			const currentRevision = validRevision(
				Number(chat.revision ?? 0),
				"chat revision",
			);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before audience assignment",
				);
			}
			db.prepare(
				`UPDATE chats SET audience_id = ?, revision = revision + 1
				 WHERE chat_id = ? AND audience_id = ? AND revision = ?`,
			).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED, currentRevision);
			db.prepare(
				`UPDATE chat_bindings SET audience_id = ?
				 WHERE chat_id = ? AND audience_id = ?`,
			).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED);
			db.prepare(
				`UPDATE chat_purge_tombstones SET audience_id = ?
				 WHERE chat_id = ? AND audience_id = ?`,
			).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED);
			db.prepare(
				`UPDATE chat_purge_attempts SET audience_id = ?
				 WHERE chat_id = ? AND audience_id = ?`,
			).run(audienceId, chatId, CHAT_AUDIENCE_UNASSIGNED);
			const eventSequence = appendCatalogEvent(db, {
				chatId,
				eventType: "chat.audience_assigned",
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision: currentRevision + 1,
				payload: { assignmentKind: "explicit_owner", reason },
			});
			const state = db
				.prepare(
					`SELECT evidence_digest FROM chat_audience_migration_state
					 WHERE chat_id = ?`,
				)
				.get(chatId);
			const evidenceDigest = asOptionalString(state?.evidence_digest);
			db.prepare(
				`INSERT INTO chat_audience_assignment_log (
					chat_id, previous_revision, resulting_revision, audience_id,
					assignment_kind, resolver_version, evidence_digest, event_sequence,
					actor_kind, actor_id, occurred_at
				 ) VALUES (?, ?, ?, ?, 'explicit_owner', NULL, ?, ?, ?, ?, ?)`,
			).run(
				chatId,
				currentRevision,
				currentRevision + 1,
				audienceId,
				evidenceDigest ?? null,
				eventSequence,
				provenance.actor.kind,
				provenance.actor.id ?? null,
				provenance.occurredAt,
			);
			const stateDigest =
				evidenceDigest ??
				createHash("sha256")
					.update(`explicit-owner\0${chatId}\0${reason}`)
					.digest("hex");
			db.prepare(
				`INSERT INTO chat_audience_migration_state (
					chat_id, migration_status, reason_code, evidence_digest,
					resolver_version, audience_id, assignment_event_sequence, updated_at
				 ) VALUES (?, 'assigned', 'explicit_owner', ?, NULL, ?, ?, ?)
				 ON CONFLICT(chat_id) DO UPDATE SET
					migration_status = 'assigned', reason_code = 'explicit_owner',
					resolver_version = NULL, audience_id = excluded.audience_id,
					assignment_event_sequence = excluded.assignment_event_sequence,
					updated_at = excluded.updated_at`,
			).run(
				chatId,
				stateDigest,
				audienceId,
				eventSequence,
				provenance.occurredAt,
			);
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: currentRevision + 1,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value) {
			throw new ChatCatalogError(
				"chat_not_found",
				"assigned chat projection is missing",
			);
		}
		return { applied, value };
	}

	private transitionLifecycle(
		input: ChatLifecycleMutationInput,
		targetState: "active" | "archived" | "deleting",
		operation: string,
	): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		requireHuman(provenance);
		const clearBindings = input.clearBindings === true;
		const stopRunningIntent = input.stopRunningIntent === true;
		if ((clearBindings || stopRunningIntent) && targetState !== "archived") {
			throw new ChatCatalogError(
				"invalid_input",
				"archive effects are supported only while archiving",
			);
		}
		const intentDigest = digestIntent({
			chatId,
			targetState,
			expectedRevision,
			clearBindings,
			stopRunningIntent,
		});
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			const chat = this.requireChatRow(db, chatId);
			const currentState = asString(chat.catalog_state) as ChatCatalogState;
			const currentRevision = Number(chat.revision ?? 0);
			if (currentState === "deleting") {
				throw new ChatCatalogError(
					"chat_deleting",
					"chat purge is in progress",
				);
			}
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before lifecycle mutation",
				);
			}
			const boundBindingExists = clearBindings
				? Boolean(
						db
							.prepare(
								`SELECT 1 FROM chat_bindings
								 WHERE chat_id = ? AND is_bound = 1 LIMIT 1`,
							)
							.get(chatId),
					)
				: false;
			if (currentState === targetState && !boundBindingExists) {
				this.recordReplay(db, {
					provenance,
					operation,
					intentDigest,
					chatId,
					resultRevision: currentRevision,
					applied: false,
				});
				return false;
			}
			if (targetState === "archived" || targetState === "deleting") {
				const runningSession = db
					.prepare(
						`SELECT s.session_id FROM chat_sessions cs
						 JOIN sessions s ON s.session_id = cs.session_id
						 WHERE cs.chat_id = ? AND s.status IN ('idle', 'running', 'pending')
						 LIMIT 1`,
					)
					.get(chatId);
				if (runningSession) {
					throw new ChatCatalogError(
						"chat_running",
						"all chat sessions must be stopped before lifecycle mutation",
					);
				}
				const authorityNow = this.clock();
				if (!Number.isFinite(authorityNow.getTime())) {
					throw new ChatCatalogError(
						"invalid_input",
						"authority clock is invalid",
					);
				}
				const liveLease = db
					.prepare(
						`SELECT sl.session_id FROM chat_sessions cs
						 JOIN session_leases sl ON sl.session_id = cs.session_id
						 WHERE cs.chat_id = ? AND sl.is_active = 1 AND sl.expires_at > ?
						 LIMIT 1`,
					)
					.get(chatId, authorityNow.toISOString());
				if (liveLease) {
					throw new ChatCatalogError(
						"lease_conflict",
						"live writer lease must be released before lifecycle mutation",
					);
				}
			}
			if (targetState === "deleting" && currentState !== "archived") {
				throw new ChatCatalogError(
					"chat_not_archived",
					"chat must be archived before purge",
				);
			}
			if (targetState === "active" && currentState !== "archived") {
				throw new ChatCatalogError(
					"chat_not_archived",
					"only an archived chat can be activated",
				);
			}
			const resultingRevision = currentRevision + 1;
			const archivedAt =
				targetState === "archived"
					? provenance.occurredAt
					: targetState === "active"
						? null
						: (asOptionalString(chat.archived_at) ?? null);
			db.prepare(
				`UPDATE chats SET catalog_state = ?, archived_at = ?, revision = ?
				 WHERE chat_id = ? AND revision = ?`,
			).run(
				targetState,
				archivedAt,
				resultingRevision,
				chatId,
				currentRevision,
			);
			let clearedBindings:
				| Array<{
						bindingId: string;
						previousRevision: number;
						resultingRevision: number;
				  }>
				| undefined;
			if (clearBindings) {
				clearedBindings = db
					.prepare(
						`SELECT binding_id, revision FROM chat_bindings
						 WHERE chat_id = ? AND is_bound = 1 ORDER BY binding_id`,
					)
					.all(chatId)
					.map((row) => ({
						bindingId: asString(row.binding_id),
						previousRevision: Number(row.revision ?? 0),
						resultingRevision: Number(row.revision ?? 0) + 1,
					}));
				db.prepare(
					`UPDATE chat_bindings SET is_bound = 0, chat_id = NULL,
					 session_id = NULL, revision = revision + 1, updated_at = ?
					 WHERE chat_id = ? AND is_bound = 1`,
				).run(provenance.occurredAt, chatId);
				for (const binding of clearedBindings) {
					this.recordEvent(db, {
						chatId,
						eventType: "binding.cleared_for_archive",
						aggregateKind: "binding",
						aggregateId: binding.bindingId,
						provenance,
						previousRevision: binding.previousRevision,
						resultingRevision: binding.resultingRevision,
						payload: { chatId },
					});
				}
			}
			let purgePayload: Record<string, unknown> | undefined;
			if (targetState === "deleting") {
				const audienceId = normalizeAudienceId(
					asString(chat.audience_id),
					"purge audience",
				);
				const sessionIds = db
					.prepare(
						`SELECT session_id FROM chat_sessions WHERE chat_id = ? ORDER BY ordinal`,
					)
					.all(chatId)
					.map((row) => asString(row.session_id));
				for (const sessionId of sessionIds) {
					db.prepare(
						`INSERT INTO chat_purge_tombstones (
							session_id, chat_id, audience_id, purge_state, started_at, finalized_at,
							started_invocation_id, finalized_invocation_id
						) VALUES (?, ?, ?, 'deleting', ?, NULL, ?, NULL)`,
					).run(
						sessionId,
						chatId,
						audienceId,
						provenance.occurredAt,
						provenance.invocationId,
					);
				}
				const clearedBindings = db
					.prepare(
						`SELECT binding_id, revision FROM chat_bindings
						 WHERE chat_id = ? AND is_bound = 1 ORDER BY binding_id`,
					)
					.all(chatId)
					.map((row) => ({
						bindingId: asString(row.binding_id),
						previousRevision: Number(row.revision ?? 0),
						resultingRevision: Number(row.revision ?? 0) + 1,
					}));
				db.prepare(
					`UPDATE chat_bindings SET is_bound = 0, chat_id = NULL,
					 session_id = NULL, revision = revision + 1, updated_at = ?
					 WHERE chat_id = ? AND is_bound = 1`,
				).run(provenance.occurredAt, chatId);
				for (const binding of clearedBindings) {
					this.recordEvent(db, {
						chatId,
						eventType: "binding.cleared_for_purge",
						aggregateKind: "binding",
						aggregateId: binding.bindingId,
						provenance,
						previousRevision: binding.previousRevision,
						resultingRevision: binding.resultingRevision,
						payload: { chatId },
					});
				}
				purgePayload = { sessionIds, clearedBindings };
			}
			this.recordEvent(db, {
				chatId,
				eventType: `chat.${targetState}`,
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				...(purgePayload || clearedBindings
					? {
							payload: {
								...(purgePayload ?? {}),
								...(clearedBindings ? { clearedBindings } : {}),
							},
						}
					: {}),
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value)
			throw new ChatCatalogError("chat_not_found", "mutated chat missing");
		return { applied, value };
	}

	renameChat(input: RenameChatInput): ChatMutationResult<ChatDetail> {
		const chatId = boundedRequired(input.chatId, "chat id");
		const title = boundedRequired(input.title, "chat title", MAX_TITLE_LENGTH);
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		requireHuman(provenance);
		const intentDigest = digestIntent({ chatId, title, expectedRevision });
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, "rename_chat", intentDigest)) {
				return false;
			}
			const chat = this.requireChatRow(db, chatId);
			if (asString(chat.catalog_state) === "deleting") {
				throw new ChatCatalogError(
					"chat_deleting",
					"chat purge is in progress",
				);
			}
			const currentRevision = Number(chat.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before rename",
				);
			}
			if (
				asOptionalString(chat.title) === title &&
				asOptionalString(chat.title_source) === "manual"
			) {
				this.recordReplay(db, {
					provenance,
					operation: "rename_chat",
					intentDigest,
					chatId,
					resultRevision: currentRevision,
					applied: false,
				});
				return false;
			}
			const resultingRevision = currentRevision + 1;
			db.prepare(
				`UPDATE chats SET title = ?, title_source = 'manual', revision = ?
				 WHERE chat_id = ? AND revision = ?`,
			).run(title, resultingRevision, chatId, currentRevision);
			this.recordEvent(db, {
				chatId,
				eventType: "chat.renamed",
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: { titleSource: "manual" },
			});
			this.recordReplay(db, {
				provenance,
				operation: "rename_chat",
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getChat(chatId);
		if (!value) {
			throw new ChatCatalogError("chat_not_found", "renamed chat missing");
		}
		return { applied, value };
	}

	archiveChat(
		input: ChatLifecycleMutationInput,
	): ChatMutationResult<ChatDetail> {
		return this.transitionLifecycle(input, "archived", "archive_chat");
	}

	activateChat(
		input: ChatLifecycleMutationInput,
	): ChatMutationResult<ChatDetail> {
		return this.transitionLifecycle(input, "active", "activate_chat");
	}

	private beginPurgePhase(
		input: ChatLifecycleMutationInput,
	): ChatMutationResult<ChatDetail> {
		return this.transitionLifecycle(input, "deleting", "begin_purge");
	}

	private workspaceForChatEvidence(
		db: SqliteDb,
		chatId: string,
	): string | undefined {
		const live = db
			.prepare(`SELECT workspace_key FROM chats WHERE chat_id = ?`)
			.get(chatId);
		if (live) {
			return canonicalWorkspace(asString(live.workspace_key), "workspace key");
		}
		const rows = db
			.prepare(
				`SELECT DISTINCT s.workspace_root
				 FROM chat_purge_tombstones tombstone
				 JOIN sessions s ON s.session_id = tombstone.session_id
				 WHERE tombstone.chat_id = ?`,
			)
			.all(chatId);
		const workspaces = new Set(
			rows.map((row) =>
				canonicalWorkspace(asString(row.workspace_root), "workspace root"),
			),
		);
		if (workspaces.size > 1) {
			throw new ChatCatalogError(
				"lineage_conflict",
				"chat workspace evidence is inconsistent",
			);
		}
		return [...workspaces][0];
	}

	private bindingWorkspaceKey(db: SqliteDb, binding: RawRow): string {
		let chatId = asOptionalString(binding.chat_id);
		if (!chatId) {
			const event = db
				.prepare(
					`SELECT chat_id FROM chat_events
					 WHERE aggregate_kind = 'binding' AND aggregate_id = ?
					 ORDER BY event_sequence DESC LIMIT 1`,
				)
				.get(asString(binding.binding_id));
			chatId = asOptionalString(event?.chat_id);
		}
		const workspaceKey = chatId
			? this.workspaceForChatEvidence(db, chatId)
			: undefined;
		if (!workspaceKey) {
			throw new ChatCatalogError(
				"binding_conflict",
				"binding has no authoritative workspace evidence",
			);
		}
		return workspaceKey;
	}

	getBinding(scopeInput: ChatBindingScope): ChatBindingRecord | undefined {
		const scope = normalizeScope(scopeInput);
		const row = this.getDb()
			.prepare(
				`SELECT * FROM chat_bindings WHERE transport = ? AND instance_id = ?
				 AND channel_id = ? AND thread_id = ? AND participant_scope = ?`,
			)
			.get(
				scope.transport,
				scope.instanceId,
				scope.channelId,
				scope.threadId,
				scope.participantScope,
			);
		return row ? mapBinding(row) : undefined;
	}

	getAudienceBinding(
		scopeInput: ChatBindingScope,
		input: { workspaceKey: string; audienceId: string },
	): ChatBindingRecord | undefined {
		const scope = normalizeScope(scopeInput);
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		const db = this.getDb();
		const row = db
			.prepare(
				`SELECT * FROM chat_bindings WHERE transport = ? AND instance_id = ?
				 AND channel_id = ? AND thread_id = ? AND participant_scope = ?
				 AND audience_id = ?`,
			)
			.get(
				scope.transport,
				scope.instanceId,
				scope.channelId,
				scope.threadId,
				scope.participantScope,
				audienceId,
			);
		if (!row || this.bindingWorkspaceKey(db, row) !== workspaceKey) {
			return undefined;
		}
		return mapBinding(row);
	}

	getBindingAudienceScope(
		scopeInput: ChatBindingScope,
	):
		| { readonly workspaceKey: string; readonly audienceId: string }
		| undefined {
		const scope = normalizeScope(scopeInput);
		const db = this.getDb();
		const row = db
			.prepare(
				`SELECT * FROM chat_bindings WHERE transport = ? AND instance_id = ?
				 AND channel_id = ? AND thread_id = ? AND participant_scope = ?`,
			)
			.get(
				scope.transport,
				scope.instanceId,
				scope.channelId,
				scope.threadId,
				scope.participantScope,
			);
		return row
			? Object.freeze({
					workspaceKey: this.bindingWorkspaceKey(db, row),
					audienceId: normalizeAudienceId(
						asString(row.audience_id),
						"binding audience",
						{ allowUnassigned: true },
					),
				})
			: undefined;
	}

	getBindingWorkspaceKey(scopeInput: ChatBindingScope): string | undefined {
		const scope = normalizeScope(scopeInput);
		const db = this.getDb();
		const row = db
			.prepare(
				`SELECT * FROM chat_bindings WHERE transport = ? AND instance_id = ?
				 AND channel_id = ? AND thread_id = ? AND participant_scope = ?`,
			)
			.get(
				scope.transport,
				scope.instanceId,
				scope.channelId,
				scope.threadId,
				scope.participantScope,
			);
		return row ? this.bindingWorkspaceKey(db, row) : undefined;
	}

	bindChat(input: BindChatInput): ChatMutationResult<ChatBindingRecord> {
		const scope = normalizeScope(input);
		const bindingId = boundedRequired(input.bindingId, "binding id");
		const chatId = boundedRequired(input.chatId, "chat id");
		const sessionId = boundedRequired(input.sessionId, "session id");
		const expectedRevision = validRevision(
			input.expectedBindingRevision,
			"expected binding revision",
		);
		const provenance = normalizeProvenance(input.provenance);
		const operation = "bind_chat";
		const intentDigest = digestIntent({
			scope,
			bindingId,
			chatId,
			sessionId,
			expectedRevision,
		});
		const applied = this.transaction((db) => {
			const replay = this.replay(db, provenance, operation, intentDigest);
			const chat = this.requireChatRow(db, chatId);
			const chatAudienceId = normalizeAudienceId(
				asString(chat.audience_id),
				"chat audience",
				{ allowUnassigned: true },
			);
			const current = db
				.prepare(
					`SELECT * FROM chat_bindings WHERE transport = ? AND instance_id = ?
					 AND channel_id = ? AND thread_id = ? AND participant_scope = ?`,
				)
				.get(
					scope.transport,
					scope.instanceId,
					scope.channelId,
					scope.threadId,
					scope.participantScope,
				);
			const currentRevision = Number(current?.revision ?? 0);
			if (current && asString(current.binding_id) !== bindingId) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding scope is owned by a different binding id",
				);
			}
			if (
				current &&
				normalizeAudienceId(asString(current.audience_id), "binding audience", {
					allowUnassigned: true,
				}) !== chatAudienceId
			) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding scope belongs to a different audience",
				);
			}
			if (
				current &&
				this.bindingWorkspaceKey(db, current) !==
					canonicalWorkspace(asString(chat.workspace_key), "workspace key")
			) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding scope belongs to a different workspace",
				);
			}
			if (replay) return false;
			if (asString(chat.catalog_state) !== "active") {
				throw new ChatCatalogError(
					asString(chat.catalog_state) === "deleting"
						? "chat_deleting"
						: "chat_not_active",
					"only an active chat can be bound",
				);
			}
			if (
				!db
					.prepare(
						`SELECT 1 FROM chat_sessions WHERE chat_id = ? AND session_id = ?`,
					)
					.get(chatId, sessionId)
			) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"bound session does not belong to chat",
				);
			}
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"binding changed before bind",
				);
			}
			const unchanged =
				current &&
				Number(current.is_bound ?? 0) === 1 &&
				asString(current.chat_id) === chatId &&
				asString(current.session_id) === sessionId;
			if (unchanged) {
				this.recordReplay(db, {
					provenance,
					operation,
					intentDigest,
					chatId,
					resultRevision: currentRevision,
					applied: false,
				});
				return false;
			}
			const resultingRevision = currentRevision + 1;
			if (!current) {
				db.prepare(
					`INSERT INTO chat_bindings (
						binding_id, audience_id, transport, instance_id, channel_id, thread_id,
						participant_scope, is_bound, chat_id, session_id, revision,
						updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
				).run(
					bindingId,
					chatAudienceId,
					scope.transport,
					scope.instanceId,
					scope.channelId,
					scope.threadId,
					scope.participantScope,
					chatId,
					sessionId,
					resultingRevision,
					provenance.occurredAt,
				);
			} else {
				db.prepare(
					`UPDATE chat_bindings SET is_bound = 1, chat_id = ?, session_id = ?,
					 revision = ?, updated_at = ? WHERE binding_id = ?`,
				).run(
					chatId,
					sessionId,
					resultingRevision,
					provenance.occurredAt,
					asString(current.binding_id),
				);
			}
			this.recordEvent(db, {
				chatId,
				eventType: "chat.bound",
				aggregateKind: "binding",
				aggregateId: current ? asString(current.binding_id) : bindingId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: { ...scope, sessionId, bindingRevision: resultingRevision },
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getBinding(scope);
		if (!value)
			throw new ChatCatalogError("binding_conflict", "bound row missing");
		return { applied, value };
	}

	unbindChat(
		input: UnbindChatInput,
		authorizedWorkspaceKeyInput?: string,
		authorizedAudienceIdInput?: string,
	): ChatMutationResult<ChatBindingRecord> {
		const scope = normalizeScope(input);
		const expectedRevision = validRevision(
			input.expectedBindingRevision,
			"expected binding revision",
		);
		const expectedBindingId = boundedRequired(
			input.expectedBindingId,
			"expected binding id",
		);
		const expectedChatId = boundedRequired(
			input.expectedChatId,
			"expected chat id",
		);
		const expectedSessionId = boundedRequired(
			input.expectedSessionId,
			"expected session id",
		);
		const provenance = normalizeProvenance(input.provenance);
		const authorizedWorkspaceKey = authorizedWorkspaceKeyInput
			? canonicalWorkspace(
					authorizedWorkspaceKeyInput,
					"authorized workspace key",
				)
			: undefined;
		const authorizedAudienceId = authorizedAudienceIdInput
			? normalizeAudienceId(authorizedAudienceIdInput, "authorized audience")
			: undefined;
		const operation = "unbind_chat";
		const intentDigest = digestIntent({
			scope,
			expectedBindingId,
			expectedChatId,
			expectedSessionId,
			expectedRevision,
		});
		const applied = this.transaction((db) => {
			const replay = this.replay(db, provenance, operation, intentDigest);
			const current = db
				.prepare(
					`SELECT * FROM chat_bindings WHERE transport = ? AND instance_id = ?
					 AND channel_id = ? AND thread_id = ? AND participant_scope = ?`,
				)
				.get(
					scope.transport,
					scope.instanceId,
					scope.channelId,
					scope.threadId,
					scope.participantScope,
				);
			if (!current) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding does not exist",
				);
			}
			if (
				authorizedWorkspaceKey &&
				this.bindingWorkspaceKey(db, current) !== authorizedWorkspaceKey
			) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding scope belongs to a different workspace",
				);
			}
			if (
				authorizedAudienceId &&
				normalizeAudienceId(asString(current.audience_id), "binding audience", {
					allowUnassigned: true,
				}) !== authorizedAudienceId
			) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding scope belongs to a different audience",
				);
			}
			if (replay) return false;
			if (
				Number(current.is_bound ?? 0) !== 1 ||
				asString(current.binding_id) !== expectedBindingId ||
				asOptionalString(current.chat_id) !== expectedChatId ||
				asOptionalString(current.session_id) !== expectedSessionId
			) {
				throw new ChatCatalogError(
					"binding_conflict",
					"binding identity changed before unbind",
				);
			}
			const currentRevision = Number(current.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"binding changed before unbind",
				);
			}
			const chatId = asOptionalString(current.chat_id);
			const resultingRevision = currentRevision + 1;
			db.prepare(
				`UPDATE chat_bindings SET is_bound = 0, chat_id = NULL,
				 session_id = NULL, revision = ?, updated_at = ? WHERE binding_id = ?`,
			).run(
				resultingRevision,
				provenance.occurredAt,
				asString(current.binding_id),
			);
			if (chatId) {
				this.recordEvent(db, {
					chatId,
					eventType: "chat.unbound",
					aggregateKind: "binding",
					aggregateId: asString(current.binding_id),
					provenance,
					previousRevision: currentRevision,
					resultingRevision,
					payload: { ...scope, bindingRevision: resultingRevision },
				});
			}
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				...(chatId ? { chatId } : {}),
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getBinding(scope);
		if (!value)
			throw new ChatCatalogError("binding_conflict", "binding row missing");
		return { applied, value };
	}

	getSessionLease(sessionIdInput: string): SessionLeaseRecord | undefined {
		const sessionId = boundedRequired(sessionIdInput, "session id");
		const row = this.getDb()
			.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
			.get(sessionId);
		return row ? mapLease(row) : undefined;
	}

	acquireSessionLease(
		input: AcquireSessionLeaseInput,
	): AcquireSessionLeaseResult {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const expectedRevision = validRevision(input.expectedRevision);
		const ttlMs = input.ttlMs ?? this.defaultLeaseTtlMs;
		if (
			!Number.isSafeInteger(ttlMs) ||
			ttlMs < 1 ||
			ttlMs > this.maxLeaseTtlMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease TTL is outside the configured authority limit",
			);
		}
		const provenance = normalizeProvenance(input.provenance);
		const ownerId = requireActorId(provenance);
		const now = this.clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const nowIso = now.toISOString();
		const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
		const operation = "acquire_session_lease";
		const intentDigest = digestIntent({
			sessionId,
			ownerId,
			expectedRevision,
			ttlMs,
		});
		const outcome = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) {
				return { applied: false } as const;
			}
			const membership = db
				.prepare(
					`SELECT c.chat_id, c.catalog_state, c.revision
					 FROM chat_sessions cs JOIN chats c ON c.chat_id = cs.chat_id
					 WHERE cs.session_id = ?`,
				)
				.get(sessionId);
			if (!membership) {
				throw new ChatCatalogError(
					"session_not_found",
					"session is not attached to a chat",
				);
			}
			if (asString(membership.catalog_state) !== "active") {
				throw new ChatCatalogError(
					asString(membership.catalog_state) === "deleting"
						? "chat_deleting"
						: "chat_not_active",
					"session lease requires an active chat",
				);
			}
			const current = db
				.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
				.get(sessionId);
			const currentRevision = Number(current?.revision ?? 0);
			const held =
				current &&
				Number(current.is_active ?? 0) === 1 &&
				asString(current.expires_at) > nowIso;
			if (held) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session already has a live writer lease",
				);
			}
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"lease changed before acquisition",
				);
			}
			const resultingRevision = currentRevision + 1;
			const currentWriterGeneration = Number(current?.writer_generation ?? 0);
			const resultingWriterGeneration = currentWriterGeneration + 1;
			const leaseToken = randomBytes(32).toString("base64url");
			const leaseTokenHash = digestLeaseToken(leaseToken);
			if (!current) {
				db.prepare(
					`INSERT INTO session_leases (
						session_id, owner_id, lease_token_hash, is_active,
						expires_at, revision, writer_generation, updated_at
					) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
				).run(
					sessionId,
					ownerId,
					leaseTokenHash,
					expiresAt,
					resultingRevision,
					resultingWriterGeneration,
					provenance.occurredAt,
				);
			} else {
				db.prepare(
					`UPDATE session_leases SET owner_id = ?, lease_token_hash = ?,
						 is_active = 1, expires_at = ?, revision = ?, writer_generation = ?, updated_at = ?
					 WHERE session_id = ?`,
				).run(
					ownerId,
					leaseTokenHash,
					expiresAt,
					resultingRevision,
					resultingWriterGeneration,
					provenance.occurredAt,
					sessionId,
				);
			}
			db.prepare(
				`INSERT OR IGNORE INTO session_writer_heads (
					session_id, commit_sequence, lease_revision, writer_generation,
					managed_at, updated_at
				) VALUES (?, 0, ?, ?, ?, ?)`,
			).run(
				sessionId,
				resultingRevision,
				resultingWriterGeneration,
				provenance.occurredAt,
				provenance.occurredAt,
			);
			const chatId = asString(membership.chat_id);
			this.recordEvent(db, {
				chatId,
				eventType: "session.lease_acquired",
				aggregateKind: "lease",
				aggregateId: sessionId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: {
					sessionId,
					ownerId,
					expiresAt,
					leaseRevision: resultingRevision,
					writerGeneration: resultingWriterGeneration,
				},
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return { applied: true, leaseToken } as const;
		});
		const value = this.getSessionLease(sessionId);
		if (!value)
			throw new ChatCatalogError("lease_conflict", "lease row missing");
		return {
			applied: outcome.applied,
			value,
			...(outcome.applied ? { leaseToken: outcome.leaseToken } : {}),
		};
	}

	verifySessionLease(input: VerifySessionLeaseInput): SessionLeaseRecord {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const leaseToken = boundedRequired(input.leaseToken, "lease token");
		const expectedRevision = validRevision(input.expectedRevision);
		const now = this.clock();
		if (!Number.isFinite(now.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const current = this.getDb()
			.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
			.get(sessionId);
		if (
			!current ||
			Number(current.is_active ?? 0) !== 1 ||
			asString(current.expires_at) <= now.toISOString() ||
			Number(current.revision ?? 0) !== expectedRevision ||
			!secureDigestEqual(
				asString(current.lease_token_hash),
				digestLeaseToken(leaseToken),
			)
		) {
			throw new ChatCatalogError(
				"lease_conflict",
				"session writer lease is missing, expired, superseded, or invalid",
			);
		}
		return mapLease(current);
	}

	renewSessionLease(
		input: RenewSessionLeaseInput,
	): ChatMutationResult<SessionLeaseRecord> {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const leaseToken = boundedRequired(input.leaseToken, "lease token");
		const expectedRevision = validRevision(input.expectedRevision);
		const ttlMs = input.ttlMs ?? this.defaultLeaseTtlMs;
		if (
			!Number.isSafeInteger(ttlMs) ||
			ttlMs < 1 ||
			ttlMs > this.maxLeaseTtlMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease TTL is outside the configured authority limit",
			);
		}
		const provenance = normalizeProvenance(input.provenance);
		const ownerId = requireActorId(provenance);
		const renewedAt = this.clock();
		if (!Number.isFinite(renewedAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const renewedAtIso = renewedAt.toISOString();
		const expiresAt = new Date(renewedAt.getTime() + ttlMs).toISOString();
		const operation = "renew_session_lease";
		const intentDigest = digestIntent({
			sessionId,
			ownerId,
			leaseToken,
			expectedRevision,
			ttlMs,
		});
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			const current = db
				.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
				.get(sessionId);
			if (
				!current ||
				Number(current.is_active ?? 0) !== 1 ||
				asString(current.expires_at) <= renewedAtIso
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session writer lease is missing or expired",
				);
			}
			if (
				asString(current.owner_id) !== ownerId ||
				!secureDigestEqual(
					asString(current.lease_token_hash),
					digestLeaseToken(leaseToken),
				)
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session lease owner or credential differs",
				);
			}
			const currentRevision = Number(current.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"lease changed before renewal",
				);
			}
			const membership = db
				.prepare(`SELECT chat_id FROM chat_sessions WHERE session_id = ?`)
				.get(sessionId);
			const chatId = asString(membership?.chat_id);
			if (!chatId) {
				throw new ChatCatalogError(
					"session_not_found",
					"session is not attached to a chat",
				);
			}
			const resultingRevision = currentRevision + 1;
			db.prepare(
				`UPDATE session_leases SET expires_at = ?, revision = ?, updated_at = ?
				 WHERE session_id = ?`,
			).run(expiresAt, resultingRevision, renewedAtIso, sessionId);
			this.recordEvent(db, {
				chatId,
				eventType: "session.lease_renewed",
				aggregateKind: "lease",
				aggregateId: sessionId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: {
					sessionId,
					ownerId,
					expiresAt,
					leaseRevision: resultingRevision,
				},
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getSessionLease(sessionId);
		if (!value) {
			throw new ChatCatalogError("lease_conflict", "lease row missing");
		}
		return { applied, value };
	}

	rekeySessionLease(input: RekeySessionLeaseInput): RekeySessionLeaseResult {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const leaseToken = boundedRequired(input.leaseToken, "lease token");
		const expectedRevision = validRevision(input.expectedRevision);
		const expectedWriterGeneration = validRevision(
			input.expectedWriterGeneration,
			"expected writer generation",
		);
		if (expectedWriterGeneration < 1) {
			throw new ChatCatalogError(
				"invalid_input",
				"expected writer generation is invalid",
			);
		}
		const ttlMs = input.ttlMs ?? this.defaultLeaseTtlMs;
		if (
			!Number.isSafeInteger(ttlMs) ||
			ttlMs < 1 ||
			ttlMs > this.maxLeaseTtlMs
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"lease TTL is outside the configured authority limit",
			);
		}
		const provenance = normalizeProvenance(input.provenance);
		const ownerId = requireActorId(provenance);
		const rekeyedAt = this.clock();
		if (!Number.isFinite(rekeyedAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const rekeyedAtIso = rekeyedAt.toISOString();
		const expiresAt = new Date(rekeyedAt.getTime() + ttlMs).toISOString();
		const operation = "rekey_session_lease";
		const intentDigest = digestIntent({
			sessionId,
			ownerId,
			leaseToken,
			expectedRevision,
			expectedWriterGeneration,
			ttlMs,
		});
		const candidateToken = randomBytes(32).toString("base64url");
		const outcome = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) {
				return { applied: false } as const;
			}
			const current = db
				.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
				.get(sessionId);
			if (
				!current ||
				Number(current.is_active ?? 0) !== 1 ||
				asString(current.expires_at) <= rekeyedAtIso
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session writer lease is missing or expired",
				);
			}
			if (
				asString(current.owner_id) !== ownerId ||
				!secureDigestEqual(
					asString(current.lease_token_hash),
					digestLeaseToken(leaseToken),
				)
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session lease owner or credential differs",
				);
			}
			const currentRevision = Number(current.revision ?? 0);
			const currentWriterGeneration = Number(current.writer_generation ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"lease changed before rekey",
				);
			}
			if (currentWriterGeneration !== expectedWriterGeneration) {
				throw new ChatCatalogError(
					"lease_conflict",
					"writer generation changed before rekey",
				);
			}
			const membership = db
				.prepare(`SELECT chat_id FROM chat_sessions WHERE session_id = ?`)
				.get(sessionId);
			const chatId = asString(membership?.chat_id);
			if (!chatId) {
				throw new ChatCatalogError(
					"session_not_found",
					"session is not attached to a chat",
				);
			}
			const writerHead = db
				.prepare(
					`SELECT writer_generation FROM session_writer_heads
					 WHERE session_id = ?`,
				)
				.get(sessionId);
			if (
				!writerHead ||
				Number(writerHead.writer_generation ?? 0) !== expectedWriterGeneration
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"managed writer head differs before rekey",
				);
			}
			const resultingRevision = currentRevision + 1;
			const resultingWriterGeneration = currentWriterGeneration + 1;
			db.prepare(
				`UPDATE session_leases
				 SET lease_token_hash = ?, expires_at = ?, revision = ?,
				     writer_generation = ?, updated_at = ?
				 WHERE session_id = ?`,
			).run(
				digestLeaseToken(candidateToken),
				expiresAt,
				resultingRevision,
				resultingWriterGeneration,
				rekeyedAtIso,
				sessionId,
			);
			db.prepare(
				`UPDATE session_writer_heads
				 SET lease_revision = ?, writer_generation = ?, updated_at = ?
				 WHERE session_id = ?`,
			).run(
				resultingRevision,
				resultingWriterGeneration,
				rekeyedAtIso,
				sessionId,
			);
			this.recordEvent(db, {
				chatId,
				eventType: "session.lease_rekeyed",
				aggregateKind: "lease",
				aggregateId: sessionId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: {
					sessionId,
					ownerId,
					expiresAt,
					leaseRevision: resultingRevision,
					writerGeneration: resultingWriterGeneration,
				},
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return { applied: true, leaseToken: candidateToken } as const;
		});
		if (outcome.applied) {
			this.rememberRekeyCredential(provenance.invocationId, outcome.leaseToken);
		}
		const replacementToken = outcome.applied
			? outcome.leaseToken
			: this.rekeyReplayCredentials.get(provenance.invocationId);
		if (!replacementToken) {
			throw new ChatCatalogError(
				"lease_conflict",
				"rekey credential is unavailable after authority-process loss",
			);
		}
		const value = this.getSessionLease(sessionId);
		if (!value) {
			throw new ChatCatalogError("lease_conflict", "lease row missing");
		}
		return { applied: outcome.applied, value, leaseToken: replacementToken };
	}

	releaseSessionLease(
		input: ReleaseSessionLeaseInput,
	): ChatMutationResult<SessionLeaseRecord> {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const leaseToken = boundedRequired(input.leaseToken, "lease token");
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		const ownerId = requireActorId(provenance);
		const releasedAt = this.clock();
		if (!Number.isFinite(releasedAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const releasedAtIso = releasedAt.toISOString();
		const operation = "release_session_lease";
		const intentDigest = digestIntent({
			sessionId,
			ownerId,
			leaseToken,
			expectedRevision,
		});
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			const current = db
				.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
				.get(sessionId);
			if (!current) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session lease does not exist",
				);
			}
			if (
				asString(current.owner_id) !== ownerId ||
				!secureDigestEqual(
					asString(current.lease_token_hash),
					digestLeaseToken(leaseToken),
				)
			) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session lease owner differs",
				);
			}
			const currentRevision = Number(current.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"lease changed before release",
				);
			}
			const membership = db
				.prepare(`SELECT chat_id FROM chat_sessions WHERE session_id = ?`)
				.get(sessionId);
			const chatId = asString(membership?.chat_id);
			if (Number(current.is_active ?? 0) === 0) {
				this.recordReplay(db, {
					provenance,
					operation,
					intentDigest,
					...(chatId ? { chatId } : {}),
					resultRevision: currentRevision,
					applied: false,
				});
				return false;
			}
			const resultingRevision = currentRevision + 1;
			db.prepare(
				`UPDATE session_leases SET is_active = 0, expires_at = ?, revision = ?,
				 updated_at = ? WHERE session_id = ?`,
			).run(releasedAtIso, resultingRevision, releasedAtIso, sessionId);
			if (chatId) {
				this.recordEvent(db, {
					chatId,
					eventType: "session.lease_released",
					aggregateKind: "lease",
					aggregateId: sessionId,
					provenance,
					previousRevision: currentRevision,
					resultingRevision,
					payload: { sessionId, ownerId, leaseRevision: resultingRevision },
				});
			}
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				...(chatId ? { chatId } : {}),
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getSessionLease(sessionId);
		if (!value)
			throw new ChatCatalogError("lease_conflict", "lease row missing");
		return { applied, value };
	}

	revokeSessionLease(
		input: RevokeSessionLeaseInput,
	): ChatMutationResult<SessionLeaseRecord> {
		const sessionId = boundedRequired(input.sessionId, "session id");
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		requireHuman(provenance);
		const ownerId = requireActorId(provenance);
		const revokedAt = this.clock();
		if (!Number.isFinite(revokedAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const revokedAtIso = revokedAt.toISOString();
		const operation = "revoke_session_lease";
		const intentDigest = digestIntent({ sessionId, ownerId, expectedRevision });
		const applied = this.transaction((db) => {
			if (this.replay(db, provenance, operation, intentDigest)) return false;
			const current = db
				.prepare(`SELECT * FROM session_leases WHERE session_id = ?`)
				.get(sessionId);
			if (!current) {
				throw new ChatCatalogError(
					"lease_conflict",
					"session lease does not exist",
				);
			}
			if (asString(current.owner_id) !== ownerId) {
				throw new ChatCatalogError(
					"lease_conflict",
					"only the current lease owner can revoke a lost credential",
				);
			}
			const currentRevision = Number(current.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"lease changed before revocation",
				);
			}
			const membership = db
				.prepare(`SELECT chat_id FROM chat_sessions WHERE session_id = ?`)
				.get(sessionId);
			if (!membership) {
				throw new ChatCatalogError(
					"session_not_found",
					"session is not attached to a chat",
				);
			}
			const chatId = asString(membership.chat_id);
			if (Number(current.is_active ?? 0) === 0) {
				this.recordReplay(db, {
					provenance,
					operation,
					intentDigest,
					chatId,
					resultRevision: currentRevision,
					applied: false,
				});
				return false;
			}
			const resultingRevision = currentRevision + 1;
			const revokedTokenHash = digestLeaseToken(
				randomBytes(32).toString("base64url"),
			);
			db.prepare(
				`UPDATE session_leases SET lease_token_hash = ?, is_active = 0,
				 expires_at = ?, revision = ?, updated_at = ? WHERE session_id = ?`,
			).run(
				revokedTokenHash,
				revokedAtIso,
				resultingRevision,
				revokedAtIso,
				sessionId,
			);
			this.recordEvent(db, {
				chatId,
				eventType: "session.lease_revoked",
				aggregateKind: "lease",
				aggregateId: sessionId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision,
				payload: { sessionId, ownerId, leaseRevision: resultingRevision },
			});
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: resultingRevision,
				applied: true,
			});
			return true;
		});
		const value = this.getSessionLease(sessionId);
		if (!value)
			throw new ChatCatalogError("lease_conflict", "lease row missing");
		return { applied, value };
	}

	private startPurgeClaimHeartbeat(input: {
		attemptId: string;
		chatId: string;
		provenance: ChatMutationProvenance;
		claimRevision: number;
		mutationFence?: ChatCatalogMutationFence;
	}): { failure: Promise<never>; stop: () => number } {
		let claimRevision = input.claimRevision;
		let heartbeatError: unknown;
		let stopped = false;
		let rejectFailure: (error: unknown) => void = () => {};
		const failure = new Promise<never>((_resolve, reject) => {
			rejectFailure = reject;
		});
		void failure.catch(() => {});
		let timer: ReturnType<typeof setInterval>;
		const renew = () => {
			if (stopped || heartbeatError) return;
			try {
				assertMutationFence(input.mutationFence);
				const heartbeatAt = this.clock();
				if (!Number.isFinite(heartbeatAt.getTime())) {
					throw new ChatCatalogError(
						"invalid_input",
						"authority clock is invalid",
					);
				}
				const heartbeatAtIso = heartbeatAt.toISOString();
				const previousRevision = claimRevision;
				this.transaction((db) => {
					assertMutationFence(input.mutationFence);
					const changed = db
						.prepare(
							`UPDATE chat_purge_attempts SET revision = revision + 1,
							 updated_at = ? WHERE attempt_id = ?
							 AND attempt_state = 'pending' AND revision = ?`,
						)
						.run(heartbeatAtIso, input.attemptId, previousRevision).changes;
					if (changed !== 1) {
						throw new ChatCatalogError(
							"purge_cleanup_failed",
							"purge cleanup claim changed before heartbeat",
						);
					}
					this.recordEvent(db, {
						chatId: input.chatId,
						eventType: "purge.cleanup_heartbeat",
						aggregateKind: "purge_attempt",
						aggregateId: input.attemptId,
						provenance: {
							...input.provenance,
							occurredAt: heartbeatAtIso,
						},
						previousRevision,
						resultingRevision: previousRevision + 1,
					});
				});
				claimRevision = previousRevision + 1;
			} catch (error) {
				heartbeatError = error;
				stopped = true;
				clearInterval(timer);
				rejectFailure(error);
			}
		};
		timer = setInterval(renew, this.purgeAttemptHeartbeatMs);
		timer.unref?.();
		return {
			failure,
			stop: () => {
				if (!stopped) {
					stopped = true;
					clearInterval(timer);
				}
				if (heartbeatError) throw heartbeatError;
				return claimRevision;
			},
		};
	}

	async purgeChat(
		input: PurgeChatInput,
		mutationFence?: ChatCatalogMutationFence,
	): Promise<PurgeChatResult> {
		if (!this.artifactCleanup) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"purge requires an artifact cleanup authority",
			);
		}
		const chatId = boundedRequired(input.chatId, "chat id");
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		requireHuman(provenance);
		const operation = "purge_chat";
		const intentDigest = digestIntent({ chatId, expectedRevision });
		const replayed = this.transaction((db) => {
			assertMutationFence(mutationFence);
			return this.replay(db, provenance, operation, intentDigest);
		});
		if (replayed) {
			const sessionIds = this.getDb()
				.prepare(
					`SELECT session_id FROM chat_purge_tombstones WHERE chat_id = ?
					 ORDER BY session_id`,
				)
				.all(chatId)
				.map((row) => asString(row.session_id));
			return { applied: false, purged: true, chatId, sessionIds };
		}

		let chat = this.getChat(chatId);
		if (!chat) {
			throw new ChatCatalogError(
				"chat_not_found",
				`chat ${chatId} was not found`,
			);
		}
		if (chat.catalogState === "archived") {
			assertMutationFence(mutationFence);
			chat = this.beginPurgePhase({
				chatId,
				expectedRevision,
				provenance: phaseProvenance(provenance, "begin-purge"),
			}).value;
		} else if (chat.catalogState === "deleting") {
			const existingAttempt = this.getDb()
				.prepare(
					`SELECT intent_digest FROM chat_purge_attempts
					 WHERE attempt_id = ? AND chat_id = ?`,
				)
				.get(provenance.invocationId, chatId);
			if (
				chat.revision !== expectedRevision &&
				asString(existingAttempt?.intent_digest) !== intentDigest
			) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before purge retry",
				);
			}
		} else {
			throw new ChatCatalogError(
				"chat_not_archived",
				"chat must be archived before purge",
			);
		}

		const deletingRevision = chat.revision;
		const sessionIds = this.getDb()
			.prepare(
				`SELECT session_id FROM chat_purge_tombstones
				 WHERE chat_id = ? AND purge_state = 'deleting' ORDER BY session_id`,
			)
			.all(chatId)
			.map((row) => asString(row.session_id));
		if (sessionIds.length === 0) {
			throw new ChatCatalogError(
				"lineage_conflict",
				"deleting chat has no cleanup target",
			);
		}
		const sessionIdsJson = canonicalJson(sessionIds);
		const claimNow = this.clock();
		if (!Number.isFinite(claimNow.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const claimAt = claimNow.toISOString();
		const initialClaimRevision = this.transaction((db) => {
			assertMutationFence(mutationFence);
			const audienceId = normalizeAudienceId(
				asString(
					db
						.prepare(`SELECT audience_id FROM chats WHERE chat_id = ?`)
						.get(chatId)?.audience_id,
				),
				"purge attempt audience",
			);
			const existing = db
				.prepare(
					`SELECT chat_id, audience_id, intent_digest, session_ids_json, attempt_state,
					 revision, updated_at
					 FROM chat_purge_attempts WHERE attempt_id = ?`,
				)
				.get(provenance.invocationId);
			if (
				existing &&
				(asString(existing.chat_id) !== chatId ||
					asString(existing.audience_id) !== audienceId ||
					asString(existing.intent_digest) !== intentDigest ||
					asString(existing.session_ids_json) !== sessionIdsJson)
			) {
				throw new ChatCatalogError(
					"invocation_replay_conflict",
					"purge attempt was replayed with different cleanup intent",
				);
			}
			const previousAttemptRevision = Number(existing?.revision ?? 0);
			const resultingAttemptRevision = previousAttemptRevision + 1;
			if (existing) {
				const state = asString(existing.attempt_state);
				const updatedAt = new Date(asString(existing.updated_at)).getTime();
				const isLiveClaim =
					(state === "pending" || state === "succeeded") &&
					Number.isFinite(updatedAt) &&
					claimNow.getTime() - updatedAt < this.purgeAttemptStaleMs;
				if (isLiveClaim) {
					throw new ChatCatalogError(
						"chat_deleting",
						"purge cleanup is already in progress",
					);
				}
				db.prepare(
					`UPDATE chat_purge_attempts SET attempt_state = 'pending',
					 revision = revision + 1,
					 cleanup_receipt_digest = NULL, error_code = NULL,
					 error_message = NULL, updated_at = ? WHERE attempt_id = ?`,
				).run(claimAt, provenance.invocationId);
			} else {
				db.prepare(
					`INSERT INTO chat_purge_attempts (
						attempt_id, chat_id, audience_id, intent_digest, session_ids_json,
						attempt_state, revision, cleanup_receipt_digest, error_code,
						error_message, started_at, updated_at
					) VALUES (?, ?, ?, ?, ?, 'pending', 1, NULL, NULL, NULL, ?, ?)`,
				).run(
					provenance.invocationId,
					chatId,
					audienceId,
					intentDigest,
					sessionIdsJson,
					claimAt,
					claimAt,
				);
			}
			this.recordEvent(db, {
				chatId,
				eventType: "purge.cleanup_started",
				aggregateKind: "purge_attempt",
				aggregateId: provenance.invocationId,
				provenance,
				previousRevision: previousAttemptRevision,
				resultingRevision: resultingAttemptRevision,
				payload: { sessionIds },
			});
			return resultingAttemptRevision;
		});
		const heartbeat = this.startPurgeClaimHeartbeat({
			attemptId: provenance.invocationId,
			chatId,
			provenance,
			claimRevision: initialClaimRevision,
			...(mutationFence ? { mutationFence } : {}),
		});

		let receiptId: string;
		let claimRevision = initialClaimRevision;
		const cleanupAbort = new AbortController();
		const abortCleanup = () => cleanupAbort.abort(mutationFence?.signal.reason);
		mutationFence?.signal.addEventListener("abort", abortCleanup, {
			once: true,
		});
		let cleanup: Promise<{ receiptId: string }> | undefined;
		try {
			assertMutationFence(mutationFence);
			cleanup = Promise.resolve(
				this.artifactCleanup.cleanupChatArtifacts({
					chatId,
					sessionIds: [...sessionIds],
					attemptId: provenance.invocationId,
					signal: cleanupAbort.signal,
				}),
			);
			const receipt = await Promise.race([cleanup, heartbeat.failure]);
			receiptId = boundedRequired(receipt.receiptId, "cleanup receipt id");
			claimRevision = heartbeat.stop();
		} catch (error) {
			cleanupAbort.abort(error);
			await cleanup?.catch(() => undefined);
			try {
				claimRevision = heartbeat.stop();
			} catch (heartbeatFailure) {
				throw new ChatCatalogError(
					"purge_cleanup_failed",
					`purge cleanup claim was lost: ${boundedErrorMessage(heartbeatFailure)}`,
				);
			}
			const failedAt = this.clock();
			if (!Number.isFinite(failedAt.getTime())) {
				throw new ChatCatalogError(
					"invalid_input",
					"authority clock is invalid",
				);
			}
			const failedAtIso = failedAt.toISOString();
			const errorMessage = boundedErrorMessage(error);
			this.transaction((db) => {
				assertMutationFence(mutationFence);
				const changed = db
					.prepare(
						`UPDATE chat_purge_attempts SET attempt_state = 'failed',
					 revision = revision + 1,
					 error_code = 'artifact_cleanup_failed', error_message = ?,
					 updated_at = ? WHERE attempt_id = ? AND attempt_state = 'pending'
					 AND revision = ?`,
					)
					.run(
						errorMessage,
						failedAtIso,
						provenance.invocationId,
						claimRevision,
					).changes;
				if (changed !== 1) return;
				this.recordEvent(db, {
					chatId,
					eventType: "chat.purge_cleanup_failed",
					aggregateKind: "purge_attempt",
					aggregateId: provenance.invocationId,
					provenance,
					previousRevision: claimRevision,
					resultingRevision: claimRevision + 1,
					payload: {
						attemptId: provenance.invocationId,
						errorCode: "artifact_cleanup_failed",
					},
				});
			});
			throw new ChatCatalogError(
				"purge_cleanup_failed",
				"artifact cleanup failed; purge remains retryable",
			);
		} finally {
			mutationFence?.signal.removeEventListener("abort", abortCleanup);
		}

		const receiptDigest = digestIntent({
			attemptId: provenance.invocationId,
			chatId,
			sessionIds,
			receiptId,
		});
		const succeededAt = this.clock();
		if (!Number.isFinite(succeededAt.getTime())) {
			throw new ChatCatalogError("invalid_input", "authority clock is invalid");
		}
		const succeededAtIso = succeededAt.toISOString();
		this.transaction((db) => {
			assertMutationFence(mutationFence);
			const changed = db
				.prepare(
					`UPDATE chat_purge_attempts SET attempt_state = 'succeeded',
					 revision = revision + 1,
					 cleanup_receipt_digest = ?, error_code = NULL,
					 error_message = NULL, updated_at = ?
					 WHERE attempt_id = ? AND attempt_state = 'pending'
					 AND revision = ?`,
				)
				.run(
					receiptDigest,
					succeededAtIso,
					provenance.invocationId,
					claimRevision,
				).changes;
			if (changed !== 1) {
				throw new ChatCatalogError(
					"purge_cleanup_failed",
					"cleanup attempt changed before receipt persistence",
				);
			}
			this.recordEvent(db, {
				chatId,
				eventType: "purge.cleanup_succeeded",
				aggregateKind: "purge_attempt",
				aggregateId: provenance.invocationId,
				provenance,
				previousRevision: claimRevision,
				resultingRevision: claimRevision + 1,
				payload: { sessionIds },
			});
		});
		assertMutationFence(mutationFence);
		return this.finalizePurgePhase({
			chatId,
			expectedRevision: deletingRevision,
			provenance,
			attemptId: provenance.invocationId,
			receiptId,
			intentDigest,
		});
	}

	private finalizePurgePhase(input: FinalizePurgeInput): PurgeChatResult {
		const chatId = boundedRequired(input.chatId, "chat id");
		const expectedRevision = validRevision(input.expectedRevision);
		const provenance = normalizeProvenance(input.provenance);
		const attemptId = boundedRequired(input.attemptId, "purge attempt id");
		const receiptId = boundedRequired(input.receiptId, "cleanup receipt id");
		const operation = "purge_chat";
		const intentDigest = input.intentDigest;
		return this.transaction((db) => {
			const replay = this.replay(db, provenance, operation, intentDigest);
			if (replay) {
				const sessionIds = db
					.prepare(
						`SELECT session_id FROM chat_purge_tombstones WHERE chat_id = ?
						 ORDER BY session_id`,
					)
					.all(chatId)
					.map((row) => asString(row.session_id));
				return { applied: false, purged: true, chatId, sessionIds };
			}
			const chat = this.requireChatRow(db, chatId);
			if (asString(chat.catalog_state) !== "deleting") {
				throw new ChatCatalogError(
					"chat_deleting",
					"chat must be in deleting state before purge finalization",
				);
			}
			const currentRevision = Number(chat.revision ?? 0);
			if (currentRevision !== expectedRevision) {
				throw new ChatCatalogError(
					"revision_conflict",
					"chat changed before purge finalization",
				);
			}
			const sessionIds = db
				.prepare(
					`SELECT session_id FROM chat_purge_tombstones
					 WHERE chat_id = ? AND purge_state = 'deleting' ORDER BY session_id`,
				)
				.all(chatId)
				.map((row) => asString(row.session_id));
			if (sessionIds.length === 0) {
				throw new ChatCatalogError(
					"lineage_conflict",
					"deleting chat has no pending purge tombstones",
				);
			}
			const attempt = db
				.prepare(
					`SELECT session_ids_json, attempt_state, cleanup_receipt_digest, revision
					 FROM chat_purge_attempts WHERE attempt_id = ? AND chat_id = ?`,
				)
				.get(attemptId, chatId);
			const expectedReceiptDigest = digestIntent({
				attemptId,
				chatId,
				sessionIds,
				receiptId,
			});
			if (
				!attempt ||
				asString(attempt.attempt_state) !== "succeeded" ||
				asString(attempt.session_ids_json) !== canonicalJson(sessionIds) ||
				asString(attempt.cleanup_receipt_digest) !== expectedReceiptDigest
			) {
				throw new ChatCatalogError(
					"purge_cleanup_failed",
					"purge finalization requires a matching successful cleanup receipt",
				);
			}
			for (const sessionId of sessionIds) {
				db.prepare(`DELETE FROM session_leases WHERE session_id = ?`).run(
					sessionId,
				);
			}
			this.recordEvent(db, {
				chatId,
				eventType: "chat.purged",
				aggregateKind: "chat",
				aggregateId: chatId,
				provenance,
				previousRevision: currentRevision,
				resultingRevision: currentRevision,
				payload: { sessionIds },
			});
			db.prepare(
				`UPDATE chat_purge_tombstones SET purge_state = 'purged',
				 finalized_at = ?, finalized_invocation_id = ?
				 WHERE chat_id = ? AND purge_state = 'deleting'`,
			).run(provenance.occurredAt, provenance.invocationId, chatId);
			db.prepare(
				`UPDATE chat_purge_attempts SET attempt_state = 'finalized',
				 revision = revision + 1, updated_at = ? WHERE attempt_id = ?`,
			).run(provenance.occurredAt, attemptId);
			const previousAttemptRevision = Number(attempt.revision ?? 0);
			this.recordEvent(db, {
				chatId,
				eventType: "purge.finalized",
				aggregateKind: "purge_attempt",
				aggregateId: attemptId,
				provenance,
				previousRevision: previousAttemptRevision,
				resultingRevision: previousAttemptRevision + 1,
				payload: { sessionIds },
			});
			db.prepare(`DELETE FROM chat_sessions WHERE chat_id = ?`).run(chatId);
			db.prepare(`DELETE FROM chats WHERE chat_id = ?`).run(chatId);
			this.recordReplay(db, {
				provenance,
				operation,
				intentDigest,
				chatId,
				resultRevision: currentRevision,
				applied: true,
			});
			return { applied: true, purged: true, chatId, sessionIds };
		});
	}

	isSessionPurged(sessionIdInput: string): boolean {
		const sessionId = boundedRequired(sessionIdInput, "session id");
		return Boolean(
			this.getDb()
				.prepare(
					`SELECT 1 FROM chat_purge_tombstones
					 WHERE session_id = ? AND purge_state = 'purged'`,
				)
				.get(sessionId),
		);
	}

	isSessionTombstoned(sessionIdInput: string): boolean {
		const sessionId = boundedRequired(sessionIdInput, "session id");
		return Boolean(
			this.getDb()
				.prepare(`SELECT 1 FROM chat_purge_tombstones WHERE session_id = ?`)
				.get(sessionId),
		);
	}

	currentEventSequence(): number {
		const row = this.getDb()
			.prepare(
				`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence
				 FROM chat_events`,
			)
			.get();
		return validRevision(Number(row?.event_sequence ?? 0), "event sequence");
	}

	listWorkspaceEventsAfter(input: {
		workspaceKey: string;
		afterSequence: number;
		limit?: number;
	}): CatalogLifecycleEventBatch {
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const afterSequence = validRevision(input.afterSequence, "event sequence");
		const limit = input.limit ?? DEFAULT_EVENT_BATCH_LIMIT;
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > MAX_EVENT_BATCH_LIMIT
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"event batch limit is invalid",
			);
		}
		const db = this.getDb();
		db.exec("BEGIN;");
		try {
			const highWaterRow = db
				.prepare(
					`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence
					 FROM chat_events`,
				)
				.get();
			const highWater = validRevision(
				Number(highWaterRow?.event_sequence ?? 0),
				"event sequence",
			);
			if (afterSequence > highWater) {
				throw new ChatCatalogError(
					"lifecycle_replay_unavailable",
					"lifecycle cursor is ahead of the retained catalog head",
				);
			}
			if (highWater === afterSequence) {
				db.exec("COMMIT;");
				return Object.freeze({
					throughSequence: afterSequence,
					events: Object.freeze([]),
					hasMore: false,
				});
			}
			const rows = db
				.prepare(
					`SELECT e.event_sequence, e.event_id, e.chat_id, e.event_type,
					        e.aggregate_kind, e.aggregate_id, e.previous_revision,
					        e.resulting_revision, e.occurred_at,
					        scope.session_ids_json
					 FROM chat_event_delivery_scope scope
					 JOIN chat_events e ON e.event_sequence = scope.event_sequence
					 WHERE scope.workspace_key = ?
					   AND e.event_sequence > ? AND e.event_sequence <= ?
					 ORDER BY e.event_sequence ASC
					 LIMIT ?`,
				)
				.all(workspaceKey, afterSequence, highWater, limit + 1);
			const hasMore = rows.length > limit;
			const selected = hasMore ? rows.slice(0, limit) : rows;
			const events = selected.map(
				(row): CatalogLifecycleEvent =>
					Object.freeze({
						sequence: validRevision(
							Number(row.event_sequence ?? 0),
							"event sequence",
						),
						eventId: asString(row.event_id),
						chatId: asString(row.chat_id),
						eventType: parseCatalogLifecycleEventType(row.event_type),
						aggregateKind: asString(
							row.aggregate_kind,
						) as ChatEventRecord["aggregateKind"],
						aggregateId: asString(row.aggregate_id),
						previousRevision: validRevision(
							Number(row.previous_revision ?? 0),
							"previous revision",
						),
						resultingRevision: validRevision(
							Number(row.resulting_revision ?? 0),
							"resulting revision",
						),
						occurredAt: canonicalTime(asString(row.occurred_at), "event time"),
						relatedSessionIds: parseDeliverySessionIds(row.session_ids_json),
					}),
			);
			const throughSequence = hasMore
				? (events.at(-1)?.sequence ?? afterSequence)
				: highWater;
			db.exec("COMMIT;");
			return Object.freeze({
				throughSequence,
				events: Object.freeze(events),
				hasMore,
			});
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	listAudienceEventsAfter(input: {
		workspaceKey: string;
		audienceId: string;
		afterSequence: number;
		limit?: number;
	}): CatalogAudienceLifecycleEventBatch {
		const workspaceKey = canonicalWorkspace(
			input.workspaceKey,
			"workspace key",
		);
		const audienceId = normalizeAudienceId(input.audienceId);
		const afterSequence = validRevision(input.afterSequence, "event sequence");
		const limit = input.limit ?? DEFAULT_EVENT_BATCH_LIMIT;
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > MAX_EVENT_BATCH_LIMIT
		) {
			throw new ChatCatalogError(
				"invalid_input",
				"event batch limit is invalid",
			);
		}
		const db = this.getDb();
		db.exec("BEGIN;");
		try {
			const highWater = validRevision(
				Number(
					db
						.prepare(
							`SELECT COALESCE(MAX(event_sequence), 0) AS event_sequence
							 FROM chat_events`,
						)
						.get()?.event_sequence ?? 0,
				),
				"event sequence",
			);
			if (afterSequence > highWater) {
				throw new ChatCatalogError(
					"lifecycle_replay_unavailable",
					"lifecycle cursor is ahead of the retained catalog head",
				);
			}
			if (highWater === afterSequence) {
				db.exec("COMMIT;");
				return Object.freeze({
					throughSequence: afterSequence,
					events: Object.freeze([]),
					hasMore: false,
				});
			}
			const rows = db
				.prepare(
					`SELECT e.event_sequence, e.event_id, e.chat_id, e.event_type,
					        e.aggregate_kind, e.aggregate_id, e.previous_revision,
					        e.resulting_revision, e.occurred_at,
					        scope.session_ids_json, scope.projection_json
					 FROM chat_event_delivery_scope scope
					 JOIN chat_events e ON e.event_sequence = scope.event_sequence
					 WHERE scope.workspace_key = ? AND scope.audience_id = ?
					   AND scope.projection_json IS NOT NULL
					   AND e.event_sequence > ? AND e.event_sequence <= ?
					 ORDER BY e.event_sequence ASC LIMIT ?`,
				)
				.all(workspaceKey, audienceId, afterSequence, highWater, limit + 1);
			const hasMore = rows.length > limit;
			const selected = hasMore ? rows.slice(0, limit) : rows;
			const events = selected.map(
				(row): CatalogAudienceLifecycleEvent =>
					Object.freeze({
						sequence: validRevision(
							Number(row.event_sequence ?? 0),
							"event sequence",
						),
						eventId: asString(row.event_id),
						chatId: asString(row.chat_id),
						eventType: parseCatalogLifecycleEventType(row.event_type),
						aggregateKind: asString(
							row.aggregate_kind,
						) as ChatEventRecord["aggregateKind"],
						aggregateId: asString(row.aggregate_id),
						previousRevision: validRevision(
							Number(row.previous_revision ?? 0),
							"previous revision",
						),
						resultingRevision: validRevision(
							Number(row.resulting_revision ?? 0),
							"resulting revision",
						),
						occurredAt: canonicalTime(asString(row.occurred_at), "event time"),
						relatedSessionIds: parseDeliverySessionIds(row.session_ids_json),
						projection: parseStoredProjection(row.projection_json),
					}),
			);
			const throughSequence = hasMore
				? (events.at(-1)?.sequence ?? afterSequence)
				: highWater;
			db.exec("COMMIT;");
			return Object.freeze({
				throughSequence,
				events: Object.freeze(events),
				hasMore,
			});
		} catch (error) {
			db.exec("ROLLBACK;");
			throw error;
		}
	}

	listEvents(chatIdInput: string): ChatEventRecord[] {
		const chatId = boundedRequired(chatIdInput, "chat id");
		return this.getDb()
			.prepare(
				`SELECT * FROM chat_events WHERE chat_id = ?
				 ORDER BY event_sequence ASC`,
			)
			.all(chatId)
			.map(
				(row): ChatEventRecord => ({
					eventId: asString(row.event_id),
					chatId: asString(row.chat_id),
					eventType: asString(row.event_type),
					aggregateKind: asString(
						row.aggregate_kind,
					) as ChatEventRecord["aggregateKind"],
					aggregateId: asString(row.aggregate_id),
					invocationId: asString(row.invocation_id),
					actorKind: asString(row.actor_kind) as ChatEventRecord["actorKind"],
					...(asOptionalString(row.actor_id)
						? { actorId: asOptionalString(row.actor_id) }
						: {}),
					sourceKind: asString(
						row.source_kind,
					) as ChatEventRecord["sourceKind"],
					...(asOptionalString(row.transport)
						? { transport: asOptionalString(row.transport) }
						: {}),
					...(asOptionalString(row.thread_id)
						? { threadId: asOptionalString(row.thread_id) }
						: {}),
					...(asOptionalString(row.channel_id)
						? { channelId: asOptionalString(row.channel_id) }
						: {}),
					previousRevision: Number(row.previous_revision ?? 0),
					resultingRevision: Number(row.resulting_revision ?? 0),
					payload: parsePayload(row.payload_json),
					occurredAt: asString(row.occurred_at),
				}),
			);
	}
}
