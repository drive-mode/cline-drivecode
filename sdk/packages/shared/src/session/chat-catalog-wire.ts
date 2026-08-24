import { z } from "zod";
import {
	HUB_CHAT_CATALOG_COMMANDS,
	type HubChatCatalogCommandName,
	type HubReplyEnvelope,
} from "../hub";
import { SESSION_STATUS_VALUES } from "./records";

export const CHAT_CATALOG_WIRE_VERSION = "v1" as const;

const Id = z.string().trim().min(1).max(512);
const Title = z.string().trim().max(512);
const Revision = z.number().int().safe().nonnegative();
const Timestamp = z.string().datetime();
const Invocation = { invocationId: Id };
const BindingScope = {
	transport: Id,
	instanceId: Id.optional(),
	channelId: Id.optional(),
	threadId: Id.optional(),
	participantScope: Id.optional(),
};

const ChatRecordSchema = z.strictObject({
	chatId: Id,
	workspaceKey: Id,
	catalogState: z.enum(["active", "archived", "deleting"]),
	headSessionId: Id,
	parentChatId: Id.optional(),
	title: Title.optional(),
	titleSource: Id.optional(),
	sourceKind: Id,
	createdAt: Timestamp,
	lastActivityAt: Timestamp,
	archivedAt: Timestamp.optional(),
	revision: Revision,
});

const ChatSessionSchema = z.strictObject({
	chatId: Id,
	sessionId: Id,
	relationKind: z.enum([
		"root",
		"fork",
		"checkpoint_restore",
		"config_restart",
		"recovery",
	]),
	parentSessionId: Id.optional(),
	ordinal: Revision,
	attachedAt: Timestamp,
	executionStatus: z.enum(SESSION_STATUS_VALUES),
});

const BindingSchema = z.strictObject({
	bindingId: Id,
	transport: Id,
	instanceId: z.string().max(512),
	channelId: z.string().max(512),
	threadId: z.string().max(512),
	participantScope: z.string().max(512),
	bound: z.boolean(),
	chatId: Id.optional(),
	sessionId: Id.optional(),
	revision: Revision,
	updatedAt: Timestamp,
});

const ChatDetailSchema = ChatRecordSchema.extend({
	sessions: z.array(ChatSessionSchema),
	bindings: z.array(BindingSchema),
});

export const HUB_CHAT_DETAIL_WIRE_SCHEMA = ChatDetailSchema;
export const HUB_CHAT_BINDING_WIRE_SCHEMA = BindingSchema;

const LeaseSchema = z.strictObject({
	sessionId: Id,
	ownerId: Id,
	active: z.boolean(),
	expiresAt: Timestamp,
	revision: Revision,
	writerGeneration: Revision,
	updatedAt: Timestamp,
});

const ReceiptSchema = z.strictObject({
	invocationId: Id,
	operation: Id,
	aggregateKind: z.enum(["chat", "binding", "lease"]),
	aggregateId: Id,
	applied: z.boolean(),
	replayed: z.boolean(),
	resultingRevision: Revision,
});

function mutationSchema(
	current: z.ZodType,
	operation: z.ZodType,
	aggregateKind: "chat" | "binding" | "lease",
	aggregateIdKey: "chatId" | "bindingId" | "sessionId",
) {
	return z
		.strictObject({
			receipt: ReceiptSchema.extend({
				operation,
				aggregateKind: z.literal(aggregateKind),
			}),
			current,
		})
		.superRefine((value, context) => {
			const currentId = (value.current as Record<string, unknown>)[
				aggregateIdKey
			];
			if (value.receipt.aggregateId !== currentId) {
				context.addIssue({
					code: "custom",
					message: "receipt aggregate does not match current projection",
					path: ["receipt", "aggregateId"],
				});
			}
		});
}

const adoptMutation = mutationSchema(
	ChatDetailSchema,
	z.literal("adopt_root"),
	"chat",
	"chatId",
);
const branchMutation = mutationSchema(
	ChatDetailSchema,
	z.enum(["record_branch:fork", "record_branch:checkpoint_restore"]),
	"chat",
	"chatId",
);
const successorMutation = mutationSchema(
	ChatDetailSchema,
	z.enum(["attach_successor:config_restart", "attach_successor:recovery"]),
	"chat",
	"chatId",
);
const activityMutation = mutationSchema(
	ChatDetailSchema,
	z.literal("record_chat_activity"),
	"chat",
	"chatId",
);
const renameMutation = mutationSchema(
	ChatDetailSchema,
	z.literal("rename_chat"),
	"chat",
	"chatId",
);
const archiveMutation = mutationSchema(
	ChatDetailSchema,
	z.literal("archive_chat"),
	"chat",
	"chatId",
);
const activateMutation = mutationSchema(
	ChatDetailSchema,
	z.literal("activate_chat"),
	"chat",
	"chatId",
);
const bindMutation = mutationSchema(
	BindingSchema,
	z.literal("bind_chat"),
	"binding",
	"bindingId",
);
const unbindMutation = mutationSchema(
	BindingSchema,
	z.literal("unbind_chat"),
	"binding",
	"bindingId",
);
const acquireMutation = z
	.strictObject({
		receipt: ReceiptSchema.extend({
			operation: z.literal("acquire_session_lease"),
			aggregateKind: z.literal("lease"),
		}),
		current: LeaseSchema,
		leaseToken: Id.optional(),
	})
	.superRefine((value, context) => {
		if (value.receipt.aggregateId !== value.current.sessionId) {
			context.addIssue({
				code: "custom",
				message: "receipt aggregate does not match current projection",
				path: ["receipt", "aggregateId"],
			});
		}
		const fresh = value.receipt.applied && !value.receipt.replayed;
		if (fresh !== (value.leaseToken !== undefined)) {
			context.addIssue({
				code: "custom",
				message: "lease token presence does not match fresh acquisition",
				path: ["leaseToken"],
			});
		}
	});
const releaseMutation = mutationSchema(
	LeaseSchema,
	z.literal("release_session_lease"),
	"lease",
	"sessionId",
);
const renewMutation = mutationSchema(
	LeaseSchema,
	z.literal("renew_session_lease"),
	"lease",
	"sessionId",
);
const revokeMutation = mutationSchema(
	LeaseSchema,
	z.literal("revoke_session_lease"),
	"lease",
	"sessionId",
);

const confirmedChat = {
	chatId: Id,
	expectedRevision: Revision,
	...Invocation,
	confirmationCredential: Id,
};

export const HUB_CHAT_CATALOG_REQUEST_SCHEMAS = {
	"chat_catalog.list": z.strictObject({
		catalogState: z.enum(["active", "archived", "all"]).optional(),
		sourceKind: Id.optional(),
		limit: z.number().int().safe().positive().optional(),
		cursor: z
			.strictObject({ lastActivityAt: Timestamp, chatId: Id })
			.optional(),
	}),
	"chat_catalog.get": z.strictObject({ chatId: Id }),
	"chat_catalog.adopt_root": z.strictObject({
		chatId: Id,
		sessionId: Id,
		title: Title.optional(),
		titleSource: Id.optional(),
		...Invocation,
	}),
	"chat_catalog.record_branch": z.strictObject({
		chatId: Id,
		sessionId: Id,
		sourceChatId: Id,
		sourceSessionId: Id,
		relationKind: z.enum(["fork", "checkpoint_restore"]),
		title: Title.optional(),
		titleSource: Id.optional(),
		...Invocation,
	}),
	"chat_catalog.attach_successor": z.strictObject({
		chatId: Id,
		sessionId: Id,
		parentSessionId: Id,
		relationKind: z.enum(["config_restart", "recovery"]),
		expectedRevision: Revision,
		...Invocation,
	}),
	"chat_catalog.record_activity": z.strictObject({
		chatId: Id,
		sessionId: Id,
		expectedRevision: Revision,
		...Invocation,
	}),
	"chat_catalog.rename": z.strictObject({
		chatId: Id,
		title: z.string().trim().min(1).max(512),
		expectedRevision: Revision,
		...Invocation,
	}),
	"chat_catalog.archive": z.strictObject({
		...confirmedChat,
		stopRunningIntent: z.boolean().optional(),
		clearBindings: z.boolean().optional(),
	}),
	"chat_catalog.activate": z.strictObject(confirmedChat),
	"chat_catalog.bind": z.strictObject({
		...BindingScope,
		bindingId: Id,
		chatId: Id,
		sessionId: Id,
		expectedBindingRevision: Revision,
		...Invocation,
	}),
	"chat_catalog.unbind": z.strictObject({
		...BindingScope,
		expectedBindingId: Id,
		expectedChatId: Id,
		expectedSessionId: Id,
		expectedBindingRevision: Revision,
		...Invocation,
	}),
	"chat_catalog.lease.get": z.strictObject({ sessionId: Id }),
	"chat_catalog.lease.verify": z.strictObject({
		sessionId: Id,
		leaseToken: Id,
		expectedRevision: Revision,
	}),
	"chat_catalog.lease.acquire": z.strictObject({
		sessionId: Id,
		expectedRevision: Revision,
		ttlMs: z.number().int().safe().positive().optional(),
		...Invocation,
	}),
	"chat_catalog.lease.renew": z.strictObject({
		sessionId: Id,
		leaseToken: Id,
		expectedRevision: Revision,
		ttlMs: z.number().int().safe().positive().optional(),
		...Invocation,
	}),
	"chat_catalog.lease.release": z.strictObject({
		sessionId: Id,
		leaseToken: Id,
		expectedRevision: Revision,
		...Invocation,
	}),
	"chat_catalog.lease.revoke": z.strictObject({
		sessionId: Id,
		expectedRevision: Revision,
		...Invocation,
		confirmationCredential: Id,
	}),
	"chat_catalog.purge": z.strictObject(confirmedChat),
} satisfies Record<HubChatCatalogCommandName, z.ZodType>;

export const HUB_CHAT_CATALOG_RESULT_SCHEMAS = {
	"chat_catalog.list": z.strictObject({
		items: z.array(ChatRecordSchema),
		nextCursor: z
			.strictObject({ lastActivityAt: Timestamp, chatId: Id })
			.optional(),
	}),
	"chat_catalog.get": ChatDetailSchema.nullable(),
	"chat_catalog.adopt_root": adoptMutation,
	"chat_catalog.record_branch": branchMutation,
	"chat_catalog.attach_successor": successorMutation,
	"chat_catalog.record_activity": activityMutation,
	"chat_catalog.rename": renameMutation,
	"chat_catalog.archive": archiveMutation,
	"chat_catalog.activate": activateMutation,
	"chat_catalog.bind": bindMutation,
	"chat_catalog.unbind": unbindMutation,
	"chat_catalog.lease.get": LeaseSchema.nullable(),
	"chat_catalog.lease.verify": LeaseSchema,
	"chat_catalog.lease.acquire": acquireMutation,
	"chat_catalog.lease.renew": renewMutation,
	"chat_catalog.lease.release": releaseMutation,
	"chat_catalog.lease.revoke": revokeMutation,
	"chat_catalog.purge": z.strictObject({
		receipt: ReceiptSchema.extend({
			operation: z.literal("purge_chat"),
			aggregateKind: z.literal("chat"),
		}),
		sessionIds: z.array(Id),
	}),
} satisfies Record<HubChatCatalogCommandName, z.ZodType>;

export function parseHubChatCatalogWireRequest(input: {
	version: unknown;
	command: unknown;
	payload: unknown;
}): {
	version: typeof CHAT_CATALOG_WIRE_VERSION;
	command: HubChatCatalogCommandName;
	payload: Record<string, unknown>;
} {
	const version = z.literal(CHAT_CATALOG_WIRE_VERSION).parse(input.version);
	const command = z.enum(HUB_CHAT_CATALOG_COMMANDS).parse(input.command);
	const payload = HUB_CHAT_CATALOG_REQUEST_SCHEMAS[command].parse(
		input.payload ?? {},
	);
	return { version, command, payload: payload as Record<string, unknown> };
}

export function parseHubChatCatalogWireReply(
	command: HubChatCatalogCommandName,
	input: unknown,
): HubReplyEnvelope {
	const success = z.strictObject({
		version: z.literal(CHAT_CATALOG_WIRE_VERSION),
		requestId: Id.optional(),
		ok: z.literal(true),
		payload: z.strictObject({
			result: HUB_CHAT_CATALOG_RESULT_SCHEMAS[command],
		}),
	});
	const failure = z.strictObject({
		version: z.literal(CHAT_CATALOG_WIRE_VERSION),
		requestId: Id.optional(),
		ok: z.literal(false),
		error: z.strictObject({
			code: Id,
			message: z.string().min(1).max(2048),
			details: z.record(z.string(), z.unknown()).optional(),
		}),
	});
	return z.union([success, failure]).parse(input) as HubReplyEnvelope;
}
