import { z } from "zod";
import {
	HUB_CHAT_PROJECTION_COMMANDS,
	type HubChatProjectionCommandName,
	type HubReplyEnvelope,
} from "../hub";
import { SESSION_STATUS_VALUES } from "./records";

export const CHAT_PROJECTION_WIRE_VERSION = "v1" as const;
export const CHAT_PROJECTION_MAX_PAGE_SIZE = 100;
export const CHAT_PROJECTION_MAX_SESSIONS_PER_CHAT = 256;
export const CHAT_PROJECTION_MAX_BINDINGS_PER_CHAT = 64;
export const CHAT_PROJECTION_MAX_OUTBOUND_WIRE_BYTES = 768 * 1024;

const OpaqueId = z.string().trim().min(1).max(512);
const OpaqueSnapshotToken = z
	.string()
	.trim()
	.min(1)
	.max(2048)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const Revision = z.number().int().safe().nonnegative();
const Timestamp = z.string().datetime();
const Title = z.string().trim().min(1).max(512);
const OptionalBindingCoordinate = z.string().max(512);

export const HUB_CHAT_PROJECTION_SESSION_SCHEMA = z.strictObject({
	chatId: OpaqueId,
	sessionId: OpaqueId,
	relationKind: z.enum([
		"root",
		"fork",
		"checkpoint_restore",
		"config_restart",
		"recovery",
	]),
	parentSessionId: OpaqueId.optional(),
	ordinal: Revision,
	attachedAt: Timestamp,
	executionStatus: z.enum(SESSION_STATUS_VALUES),
});

export const HUB_CHAT_PROJECTION_BINDING_SCHEMA = z.strictObject({
	bindingId: OpaqueId,
	transport: OpaqueId,
	instanceId: OptionalBindingCoordinate,
	channelId: OptionalBindingCoordinate,
	threadId: OptionalBindingCoordinate,
	participantScope: OptionalBindingCoordinate,
	bound: z.boolean(),
	chatId: OpaqueId.optional(),
	sessionId: OpaqueId.optional(),
	revision: Revision,
	updatedAt: Timestamp,
});

export const HUB_CHAT_PROJECTION_CHAT_SCHEMA = z
	.strictObject({
		chatId: OpaqueId,
		catalogState: z.enum(["active", "archived"]),
		headSessionId: OpaqueId,
		parentChatId: OpaqueId.optional(),
		title: Title.optional(),
		titleSource: OpaqueId.optional(),
		sourceKind: OpaqueId,
		createdAt: Timestamp,
		lastActivityAt: Timestamp,
		archivedAt: Timestamp.optional(),
		revision: Revision,
		sessionCount: Revision,
		bindingCount: Revision,
		sessions: z
			.array(HUB_CHAT_PROJECTION_SESSION_SCHEMA)
			.max(CHAT_PROJECTION_MAX_SESSIONS_PER_CHAT),
		bindings: z
			.array(HUB_CHAT_PROJECTION_BINDING_SCHEMA)
			.max(CHAT_PROJECTION_MAX_BINDINGS_PER_CHAT),
	})
	.superRefine((value, context) => {
		if (value.sessionCount < value.sessions.length) {
			context.addIssue({
				code: "custom",
				path: ["sessionCount"],
				message: "projected session count is below the included lineage",
			});
		}
		if (value.bindingCount < value.bindings.length) {
			context.addIssue({
				code: "custom",
				path: ["bindingCount"],
				message: "projected binding count is below the included summaries",
			});
		}
		const sessionIds = new Set<string>();
		for (const [index, session] of value.sessions.entries()) {
			if (session.chatId !== value.chatId) {
				context.addIssue({
					code: "custom",
					path: ["sessions", index, "chatId"],
					message: "projected session belongs to another chat",
				});
			}
			if (sessionIds.has(session.sessionId)) {
				context.addIssue({
					code: "custom",
					path: ["sessions", index, "sessionId"],
					message: "projected session identity is duplicated",
				});
			}
			sessionIds.add(session.sessionId);
		}
		if (!sessionIds.has(value.headSessionId)) {
			context.addIssue({
				code: "custom",
				path: ["headSessionId"],
				message: "projected head session is absent from chat lineage",
			});
		}

		const bindingIds = new Set<string>();
		for (const [index, binding] of value.bindings.entries()) {
			if (bindingIds.has(binding.bindingId)) {
				context.addIssue({
					code: "custom",
					path: ["bindings", index, "bindingId"],
					message: "projected binding identity is duplicated",
				});
			}
			bindingIds.add(binding.bindingId);
			if (binding.chatId !== undefined && binding.chatId !== value.chatId) {
				context.addIssue({
					code: "custom",
					path: ["bindings", index, "chatId"],
					message: "projected binding belongs to another chat",
				});
			}
		}

		if (value.catalogState === "archived" && value.archivedAt === undefined) {
			context.addIssue({
				code: "custom",
				path: ["archivedAt"],
				message: "archived projection requires an archive timestamp",
			});
		}
		if (value.catalogState === "active" && value.archivedAt !== undefined) {
			context.addIssue({
				code: "custom",
				path: ["archivedAt"],
				message: "active projection cannot carry an archive timestamp",
			});
		}
	});

const ListRequest = z
	.strictObject({
		catalogState: z.enum(["active", "archived", "all"]).optional(),
		limit: z
			.number()
			.int()
			.safe()
			.positive()
			.max(CHAT_PROJECTION_MAX_PAGE_SIZE)
			.optional(),
		snapshotId: OpaqueSnapshotToken.optional(),
		cursor: OpaqueSnapshotToken.optional(),
	})
	.superRefine((value, context) => {
		if ((value.snapshotId === undefined) !== (value.cursor === undefined)) {
			context.addIssue({
				code: "custom",
				path: value.snapshotId === undefined ? ["snapshotId"] : ["cursor"],
				message: "projection page cursor and snapshot identity are inseparable",
			});
		}
	});

const GetRequest = z.strictObject({ chatId: OpaqueId });

export const HUB_CHAT_PROJECTION_REQUEST_SCHEMAS = {
	"chat_projection.list": ListRequest,
	"chat_projection.get": GetRequest,
} satisfies Record<HubChatProjectionCommandName, z.ZodType>;

const SnapshotCut = {
	snapshotId: OpaqueSnapshotToken,
	snapshotSequence: Revision,
};

export const HUB_CHAT_PROJECTION_LIST_RESULT_SCHEMA = z
	.strictObject({
		...SnapshotCut,
		chats: z
			.array(HUB_CHAT_PROJECTION_CHAT_SCHEMA)
			.max(CHAT_PROJECTION_MAX_PAGE_SIZE),
		nextCursor: OpaqueSnapshotToken.optional(),
		hasMore: z.boolean(),
	})
	.superRefine((value, context) => {
		if (value.hasMore !== (value.nextCursor !== undefined)) {
			context.addIssue({
				code: "custom",
				path: ["nextCursor"],
				message: "projection continuation does not match page completeness",
			});
		}
		if (value.hasMore && value.chats.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["chats"],
				message: "projection continuation must make bounded progress",
			});
		}
		const chatIds = new Set<string>();
		for (const [index, chat] of value.chats.entries()) {
			if (chatIds.has(chat.chatId)) {
				context.addIssue({
					code: "custom",
					path: ["chats", index, "chatId"],
					message: "projected chat identity is duplicated",
				});
			}
			chatIds.add(chat.chatId);
			const previous = value.chats[index - 1];
			if (!previous) continue;
			const previousActivity = Date.parse(previous.lastActivityAt);
			const activity = Date.parse(chat.lastActivityAt);
			if (
				activity > previousActivity ||
				(activity === previousActivity && chat.chatId < previous.chatId)
			) {
				context.addIssue({
					code: "custom",
					path: ["chats", index],
					message: "projected chats are not in stable activity order",
				});
			}
		}
	});

export const HUB_CHAT_PROJECTION_GET_RESULT_SCHEMA = z
	.strictObject({
		...SnapshotCut,
		chat: HUB_CHAT_PROJECTION_CHAT_SCHEMA.nullable(),
	})
	.superRefine((value, context) => {
		if (value.chat && value.chat.chatId.length === 0) {
			context.addIssue({
				code: "custom",
				path: ["chat", "chatId"],
				message: "projected chat identity is invalid",
			});
		}
	});

export const HUB_CHAT_PROJECTION_RESULT_SCHEMAS = {
	"chat_projection.list": HUB_CHAT_PROJECTION_LIST_RESULT_SCHEMA,
	"chat_projection.get": HUB_CHAT_PROJECTION_GET_RESULT_SCHEMA,
} satisfies Record<HubChatProjectionCommandName, z.ZodType>;

export type HubChatProjectionChat = z.infer<
	typeof HUB_CHAT_PROJECTION_CHAT_SCHEMA
>;
export type HubChatProjectionListRequest = z.infer<typeof ListRequest>;
export type HubChatProjectionGetRequest = z.infer<typeof GetRequest>;
export type HubChatProjectionListResult = z.infer<
	typeof HUB_CHAT_PROJECTION_LIST_RESULT_SCHEMA
>;
export type HubChatProjectionGetResult = z.infer<
	typeof HUB_CHAT_PROJECTION_GET_RESULT_SCHEMA
>;

export function parseHubChatProjectionWireRequest(input: {
	version: unknown;
	command: unknown;
	payload: unknown;
}): {
	version: typeof CHAT_PROJECTION_WIRE_VERSION;
	command: HubChatProjectionCommandName;
	payload: Record<string, unknown>;
} {
	const version = z.literal(CHAT_PROJECTION_WIRE_VERSION).parse(input.version);
	const command = z.enum(HUB_CHAT_PROJECTION_COMMANDS).parse(input.command);
	const payload = HUB_CHAT_PROJECTION_REQUEST_SCHEMAS[command].parse(
		input.payload ?? {},
	);
	return { version, command, payload: payload as Record<string, unknown> };
}

export function parseHubChatProjectionWireResult(
	command: HubChatProjectionCommandName,
	input: unknown,
): unknown {
	const parsed = HUB_CHAT_PROJECTION_RESULT_SCHEMAS[command].parse(input);
	assertOutboundWireSize(parsed);
	return parsed;
}

export function parseHubChatProjectionWireReply(
	command: HubChatProjectionCommandName,
	input: unknown,
): HubReplyEnvelope {
	const success = z.strictObject({
		version: z.literal(CHAT_PROJECTION_WIRE_VERSION),
		requestId: OpaqueId.optional(),
		ok: z.literal(true),
		payload: z.strictObject({
			result: HUB_CHAT_PROJECTION_RESULT_SCHEMAS[command],
		}),
	});
	const failure = z.strictObject({
		version: z.literal(CHAT_PROJECTION_WIRE_VERSION),
		requestId: OpaqueId.optional(),
		ok: z.literal(false),
		error: z.strictObject({
			code: OpaqueId,
			message: z.string().min(1).max(2048),
			details: z.record(z.string(), z.unknown()).optional(),
		}),
	});
	const parsed = z.union([success, failure]).parse(input);
	assertOutboundWireSize(parsed);
	return parsed as HubReplyEnvelope;
}

function assertOutboundWireSize(input: unknown): void {
	if (
		new TextEncoder().encode(JSON.stringify(input)).byteLength >
		CHAT_PROJECTION_MAX_OUTBOUND_WIRE_BYTES
	) {
		throw new Error(
			"managed projection output exceeds the transport byte limit",
		);
	}
}
