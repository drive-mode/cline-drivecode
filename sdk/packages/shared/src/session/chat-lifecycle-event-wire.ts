import { z } from "zod";
import type { HubEventEnvelope } from "../hub";
import {
	CHAT_LIFECYCLE_WIRE_VERSION,
	HUB_CHAT_LIFECYCLE_CHAT_DETAIL_SCHEMA,
} from "./chat-lifecycle-wire";
import { HUB_CHAT_PROJECTION_CHAT_SCHEMA } from "./chat-projection-wire";

export const HUB_CHAT_LIFECYCLE_REPLAY_UNAVAILABLE_ERROR_CODE =
	"lifecycle_replay_unavailable" as const;

const Id = z.string().trim().min(1).max(512);
const Revision = z.number().int().safe().nonnegative();
const PositiveSequence = z.number().int().safe().positive();
const Timestamp = z.string().datetime();
const SessionId = z
	.string()
	.trim()
	.min(1)
	.max(512)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
	.refine((value) => value !== "." && value !== "..");

export const HUB_CHAT_LIFECYCLE_EVENT_SUBSCRIPTION_SCHEMA = z.strictObject({
	sessionId: SessionId.optional(),
});

export const HUB_CHAT_LIFECYCLE_EVENT_SCHEMA = z.strictObject({
	version: z.literal(CHAT_LIFECYCLE_WIRE_VERSION),
	event: z.literal("chat.changed"),
	eventId: Id,
	sessionId: SessionId.optional(),
	timestamp: z.number().int().safe().nonnegative(),
	payload: z.strictObject({
		chatId: Id,
		eventType: Id,
		aggregateKind: z.enum(["chat", "binding", "lease", "purge_attempt"]),
		aggregateId: Id,
		previousRevision: Revision,
		resultingRevision: Revision,
		occurredAt: Timestamp,
		chat: HUB_CHAT_LIFECYCLE_CHAT_DETAIL_SCHEMA.nullable(),
	}),
});

export type HubChatLifecycleEventSubscription = z.infer<
	typeof HUB_CHAT_LIFECYCLE_EVENT_SUBSCRIPTION_SCHEMA
>;

export function parseHubChatLifecycleEventSubscription(
	input: unknown,
): HubChatLifecycleEventSubscription {
	return HUB_CHAT_LIFECYCLE_EVENT_SUBSCRIPTION_SCHEMA.parse(input ?? {});
}

export function parseHubChatLifecycleWireEvent(
	input: unknown,
): HubEventEnvelope {
	return HUB_CHAT_LIFECYCLE_EVENT_SCHEMA.parse(input) as HubEventEnvelope;
}

/**
 * CA-0 reconciliation contracts are additive while the existing head-only
 * daemon route remains hard gated. The production route must not select these
 * schemas until audience authorization and retained replay land together.
 */
export const HUB_CHAT_LIFECYCLE_RECONCILIATION_SUBSCRIPTION_SCHEMA =
	z.strictObject({
		afterSequence: Revision,
	});

export const HUB_CHAT_LIFECYCLE_RECONCILED_EVENT_SCHEMA = z
	.strictObject({
		version: z.literal(CHAT_LIFECYCLE_WIRE_VERSION),
		event: z.literal("chat.changed"),
		eventId: Id,
		timestamp: z.number().int().safe().nonnegative(),
		catalogSequence: PositiveSequence,
		previousDeliveredSequence: Revision,
		payload: z.strictObject({
			chatId: Id,
			eventType: Id,
			aggregateKind: z.enum(["chat", "binding", "lease", "purge_attempt"]),
			aggregateId: Id,
			previousRevision: Revision,
			resultingRevision: Revision,
			occurredAt: Timestamp,
			chat: HUB_CHAT_PROJECTION_CHAT_SCHEMA.nullable(),
		}),
	})
	.superRefine((value, context) => {
		if (value.previousDeliveredSequence >= value.catalogSequence) {
			context.addIssue({
				code: "custom",
				path: ["previousDeliveredSequence"],
				message: "lifecycle delivery chain must advance",
			});
		}
		if (
			value.payload.chat?.chatId !== undefined &&
			value.payload.chat.chatId !== value.payload.chatId
		) {
			context.addIssue({
				code: "custom",
				path: ["payload", "chat", "chatId"],
				message: "lifecycle projection belongs to another chat",
			});
		}
	});

export const HUB_CHAT_LIFECYCLE_READY_SCHEMA = z
	.strictObject({
		version: z.literal(CHAT_LIFECYCLE_WIRE_VERSION),
		stream: z.literal("chat.changed"),
		afterSequence: Revision,
		throughSequence: Revision,
	})
	.superRefine((value, context) => {
		if (value.throughSequence < value.afterSequence) {
			context.addIssue({
				code: "custom",
				path: ["throughSequence"],
				message: "lifecycle ready sequence precedes its accepted cursor",
			});
		}
	});

export type HubChatLifecycleReconciliationSubscription = z.infer<
	typeof HUB_CHAT_LIFECYCLE_RECONCILIATION_SUBSCRIPTION_SCHEMA
>;
export type HubChatLifecycleReconciledWireEvent = z.infer<
	typeof HUB_CHAT_LIFECYCLE_RECONCILED_EVENT_SCHEMA
>;
export type HubChatLifecycleReady = z.infer<
	typeof HUB_CHAT_LIFECYCLE_READY_SCHEMA
>;

export function parseHubChatLifecycleReconciliationSubscription(
	input: unknown,
): HubChatLifecycleReconciliationSubscription {
	return HUB_CHAT_LIFECYCLE_RECONCILIATION_SUBSCRIPTION_SCHEMA.parse(input);
}

export function parseHubChatLifecycleReconciledWireEvent(
	input: unknown,
): HubChatLifecycleReconciledWireEvent {
	return HUB_CHAT_LIFECYCLE_RECONCILED_EVENT_SCHEMA.parse(input);
}

export function parseHubChatLifecycleReady(
	input: unknown,
): HubChatLifecycleReady {
	return HUB_CHAT_LIFECYCLE_READY_SCHEMA.parse(input);
}
