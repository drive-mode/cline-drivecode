import type { SharedSessionStatus } from "./records";

/**
 * Durable quarantine namespace for catalog rows that predate audience
 * authority or cannot be assigned from an exact server-owned migration map.
 * It is never a valid managed connection audience.
 */
export const CHAT_AUDIENCE_UNASSIGNED = "audience_unassigned" as const;

/** Opaque server-issued target namespace; distinct from an authority class. */
export type ChatAudienceId = string;

export const CHAT_CATALOG_STATES = ["active", "archived", "deleting"] as const;
export type ChatCatalogState = (typeof CHAT_CATALOG_STATES)[number];

export const CHAT_SESSION_RELATION_KINDS = [
	"root",
	"fork",
	"checkpoint_restore",
	"config_restart",
	"recovery",
] as const;
export type ChatSessionRelationKind =
	(typeof CHAT_SESSION_RELATION_KINDS)[number];

export const CHAT_MUTATION_ACTOR_KINDS = ["human", "system"] as const;
export type ChatMutationActorKind = (typeof CHAT_MUTATION_ACTOR_KINDS)[number];

export const CHAT_MUTATION_SOURCE_KINDS = [
	"interactive",
	"connector",
	"hub",
	"migration",
	"system",
] as const;
export type ChatMutationSourceKind =
	(typeof CHAT_MUTATION_SOURCE_KINDS)[number];

export interface ChatMutationProvenance {
	invocationId: string;
	occurredAt: string;
	actor: {
		kind: ChatMutationActorKind;
		id?: string;
		label?: string;
	};
	source: {
		kind: ChatMutationSourceKind;
		transport?: string;
		threadId?: string;
		channelId?: string;
	};
}

export interface ChatCatalogRecord {
	chatId: string;
	workspaceKey: string;
	catalogState: ChatCatalogState;
	headSessionId: string;
	parentChatId?: string;
	title?: string;
	titleSource?: string;
	sourceKind: string;
	createdAt: string;
	lastActivityAt: string;
	archivedAt?: string;
	revision: number;
}

export interface ChatSessionRecord {
	chatId: string;
	sessionId: string;
	relationKind: ChatSessionRelationKind;
	parentSessionId?: string;
	ordinal: number;
	attachedAt: string;
	executionStatus: SharedSessionStatus;
}

export interface ChatBindingRecord {
	bindingId: string;
	transport: string;
	instanceId: string;
	channelId: string;
	threadId: string;
	participantScope: string;
	bound: boolean;
	chatId?: string;
	sessionId?: string;
	revision: number;
	updatedAt: string;
}

export interface ChatEventRecord {
	eventId: string;
	chatId: string;
	eventType: string;
	aggregateKind: "chat" | "binding" | "lease" | "purge_attempt";
	aggregateId: string;
	invocationId: string;
	actorKind: ChatMutationActorKind;
	actorId?: string;
	sourceKind: ChatMutationSourceKind;
	transport?: string;
	threadId?: string;
	channelId?: string;
	previousRevision: number;
	resultingRevision: number;
	payload: Record<string, unknown>;
	occurredAt: string;
}

export interface SessionLeaseRecord {
	sessionId: string;
	ownerId: string;
	active: boolean;
	expiresAt: string;
	revision: number;
	/** Monotonic write authority; advances only when a new writer is issued. */
	writerGeneration: number;
	updatedAt: string;
}

export interface ChatDetail extends ChatCatalogRecord {
	sessions: ChatSessionRecord[];
	bindings: ChatBindingRecord[];
}

export interface ChatListCursor {
	lastActivityAt: string;
	chatId: string;
}

export interface ChatPage {
	items: ChatCatalogRecord[];
	nextCursor?: ChatListCursor;
}

export const CHAT_CATALOG_ERROR_CODES = [
	"invalid_input",
	"unsupported_capability",
	"session_not_found",
	"session_already_attached",
	"session_purged",
	"chat_not_found",
	"chat_running",
	"chat_not_active",
	"chat_not_archived",
	"chat_deleting",
	"revision_conflict",
	"binding_conflict",
	"lease_conflict",
	"purge_cleanup_failed",
	"invocation_replay_conflict",
	"lineage_conflict",
	"lifecycle_replay_unavailable",
] as const;
export type ChatCatalogErrorCode = (typeof CHAT_CATALOG_ERROR_CODES)[number];
