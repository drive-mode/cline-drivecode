import type { ChatEventRecord, HubChatProjectionChat } from "@cline/shared";

export const CATALOG_LIFECYCLE_EVENT_TYPES = [
	"chat.created",
	"chat.fork",
	"chat.checkpoint_restore",
	"chat.config_restart",
	"chat.recovery",
	"chat.activity_recorded",
	"chat.active",
	"chat.archived",
	"chat.deleting",
	"chat.renamed",
	"chat.bound",
	"chat.unbound",
	"binding.cleared_for_archive",
	"binding.cleared_for_purge",
	"session.lease_acquired",
	"session.lease_renewed",
	"session.lease_rekeyed",
	"session.lease_released",
	"session.lease_revoked",
	"purge.cleanup_heartbeat",
	"purge.cleanup_started",
	"purge.cleanup_succeeded",
	"purge.finalized",
	"chat.purge_cleanup_failed",
	"chat.purged",
	"chat.audience_assigned",
] as const;

export type CatalogLifecycleEventType =
	(typeof CATALOG_LIFECYCLE_EVENT_TYPES)[number];

/**
 * Payload-free catalog event metadata exposed to trusted local composition.
 * Actor, invocation, source, transport, path, and persisted payload fields are
 * intentionally absent so downstream transports cannot accidentally project
 * them.
 */
export interface CatalogLifecycleEvent {
	readonly sequence: number;
	readonly eventId: string;
	readonly chatId: string;
	readonly eventType: CatalogLifecycleEventType;
	readonly aggregateKind: ChatEventRecord["aggregateKind"];
	readonly aggregateId: string;
	readonly previousRevision: number;
	readonly resultingRevision: number;
	readonly occurredAt: string;
	/** Sessions structurally related to the event's chat, for local filtering. */
	readonly relatedSessionIds: readonly string[];
}

export interface CatalogLifecycleEventBatch {
	/**
	 * Every workspace event at or below this global catalog sequence has been
	 * examined. Callers may advance their cursor even when `events` is empty.
	 */
	readonly throughSequence: number;
	readonly events: readonly CatalogLifecycleEvent[];
	readonly hasMore: boolean;
}

/** Exact event-time state retained for one immutable audience delivery scope. */
export interface CatalogAudienceLifecycleEvent extends CatalogLifecycleEvent {
	readonly projection: HubChatProjectionChat | null;
}

export interface CatalogAudienceLifecycleEventBatch {
	readonly throughSequence: number;
	readonly events: readonly CatalogAudienceLifecycleEvent[];
	readonly hasMore: boolean;
}

/** Trusted, workspace-bound, ordered view over the durable catalog event log. */
export interface CatalogLifecycleEventSource {
	currentSequence(): number;
	listAfter(input: {
		readonly afterSequence: number;
		readonly limit?: number;
	}): CatalogLifecycleEventBatch;
}

/** Audience-bound durable replay source used only by managed caller sockets. */
export interface CatalogAudienceLifecycleEventSource {
	currentSequence(): number;
	listAfter(input: {
		readonly afterSequence: number;
		readonly limit?: number;
	}): CatalogAudienceLifecycleEventBatch;
}

/** One server-issued audience's complete sanitized read/replay boundary. */
export interface CatalogAudienceChatSource
	extends CatalogAudienceLifecycleEventSource {
	createProjectionSnapshot(input: {
		readonly catalogState?: "active" | "archived" | "all";
		readonly maxChats: number;
	}): {
		readonly snapshotSequence: number;
		readonly chats: readonly HubChatProjectionChat[];
	};
	getProjection(input: { readonly chatId: string }): {
		readonly snapshotSequence: number;
		readonly chat: HubChatProjectionChat | null;
	};
	getSessionProjection(input: { readonly sessionId: string }): {
		readonly snapshotSequence: number;
		readonly chat: HubChatProjectionChat | null;
	};
}
