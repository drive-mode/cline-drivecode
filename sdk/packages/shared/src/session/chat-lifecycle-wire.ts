import { z } from "zod";
import {
	HUB_CHAT_LIFECYCLE_COMMANDS,
	type HubChatLifecycleCommandName,
	type HubReplyEnvelope,
} from "../hub";
import {
	HUB_CHAT_BINDING_WIRE_SCHEMA,
	HUB_CHAT_DETAIL_WIRE_SCHEMA,
} from "./chat-catalog-wire";
import {
	HUB_CHAT_PROFILE_AUTHORITY_SCHEMA,
	HUB_CHAT_RUNTIME_ATTACHMENT_BUNDLE_SCHEMA,
} from "./chat-runtime-wire";

export const CHAT_LIFECYCLE_WIRE_VERSION = "v1" as const;
export const CHAT_LIFECYCLE_MAX_RUN_TURN_BYTES = 768 * 1024;

const Id = z.string().trim().min(1).max(512);
const SessionId = z
	.string()
	.trim()
	.min(1)
	.max(512)
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._-]*$/,
		"session id must be one path-safe segment",
	)
	.refine((value) => value !== "." && value !== "..", {
		message: "session id must be one path-safe segment",
	});
const Title = z.string().trim().min(1).max(512);
const Revision = z.number().int().safe().nonnegative();
const PositiveInteger = z.number().int().safe().positive();
const Timestamp = z.string().datetime();
const Prompt = z.string().max(256 * 1024);

const RelativeCwd = z
	.string()
	.trim()
	.min(1)
	.max(1024)
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.startsWith("\\") &&
			!/^[A-Za-z]:[\\/]/.test(value) &&
			!value.split(/[\\/]+/).includes(".."),
		"relative cwd must stay within the authenticated workspace",
	);

export const HUB_CHAT_LIFECYCLE_START_PROFILE_SCHEMA = z.strictObject({
	/** Opaque host-managed runtime profile. It is not a provider credential. */
	profileId: Id,
	interactive: z.boolean().optional(),
	mode: z.enum(["act", "plan", "yolo"]).optional(),
	relativeCwd: RelativeCwd.optional(),
});

export const HUB_CHAT_LIFECYCLE_BINDING_SCOPE_SCHEMA = z.strictObject({
	/** Opaque host policy selecting and validating one connector namespace. */
	profileId: Id,
	instanceId: Id.optional(),
	channelId: Id.optional(),
	threadId: Id.optional(),
	participantScope: Id.optional(),
});

const BindingTarget = HUB_CHAT_LIFECYCLE_BINDING_SCOPE_SCHEMA.extend({
	bindingId: Id,
	expectedBindingRevision: Revision,
});

const StartCommon = {
	operationId: Id,
	sessionId: SessionId,
	leaseTtlMs: PositiveInteger.max(10 * 60_000).optional(),
	start: HUB_CHAT_LIFECYCLE_START_PROFILE_SCHEMA,
};

const StartRoot = z.strictObject({
	...StartCommon,
	chatId: Id.optional(),
	title: Title.optional(),
	titleSource: Id.optional(),
});

const StartRelated = z
	.strictObject({
		...StartCommon,
		chatId: Id,
		parentSessionId: SessionId,
		relationKind: z.enum([
			"fork",
			"checkpoint_restore",
			"config_restart",
			"recovery",
		]),
		expectedRevision: Revision.optional(),
		title: Title.optional(),
		titleSource: Id.optional(),
	})
	.superRefine((value, context) => {
		const requiresRevision =
			value.relationKind === "config_restart" ||
			value.relationKind === "recovery";
		if (requiresRevision !== (value.expectedRevision !== undefined)) {
			context.addIssue({
				code: "custom",
				path: ["expectedRevision"],
				message:
					"expected revision is required only for successor relationships",
			});
		}
	});

const RestoreCheckpoint = z.strictObject({
	...StartCommon,
	chatId: Id,
	parentSessionId: SessionId,
	checkpointRunCount: Revision,
	restore: z
		.strictObject({
			messages: z.boolean().optional(),
			workspace: z.boolean().optional(),
			omitCheckpointMessageFromSession: z.boolean().optional(),
		})
		.optional(),
	title: Title.optional(),
	titleSource: Id.optional(),
});

const Resume = z.strictObject({
	...StartCommon,
	expectedLeaseRevision: Revision.optional(),
});

const RecoverLostLease = z.strictObject(StartCommon);

const RunTurn = z
	.strictObject({
		operationId: Id,
		sessionId: SessionId,
		prompt: Prompt,
		attachments: HUB_CHAT_RUNTIME_ATTACHMENT_BUNDLE_SCHEMA.optional(),
		mode: z.enum(["act", "plan", "yolo"]).optional(),
		delivery: z.enum(["queue", "steer"]).optional(),
		timeoutMs: PositiveInteger.max(24 * 60 * 60_000).optional(),
	})
	.superRefine((value, context) => {
		const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
		if (bytes > CHAT_LIFECYCLE_MAX_RUN_TURN_BYTES) {
			context.addIssue({
				code: "custom",
				message: "managed run turn exceeds the default transport byte limit",
			});
		}
	});

const ChatRevisionMutation = z.strictObject({
	operationId: Id,
	chatId: Id,
	expectedRevision: Revision,
});

export const HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS = {
	"chat_lifecycle.start_root": StartRoot,
	"chat_lifecycle.start_related": StartRelated,
	"chat_lifecycle.restore_checkpoint": RestoreCheckpoint,
	"chat_lifecycle.resume": Resume,
	"chat_lifecycle.recover_lost_lease": RecoverLostLease,
	"chat_lifecycle.run_turn": RunTurn,
	"chat_lifecycle.binding.get": HUB_CHAT_LIFECYCLE_BINDING_SCOPE_SCHEMA,
	"chat_lifecycle.bind": z.strictObject({
		operationId: Id,
		sessionId: SessionId,
		target: BindingTarget,
	}),
	"chat_lifecycle.reset": z.strictObject({
		operationId: Id,
		sessionId: SessionId,
		binding: BindingTarget.optional(),
	}),
	"chat_lifecycle.archive": z.strictObject({
		operationId: Id,
		chatId: Id,
		expectedRevision: Revision,
		stopRunning: z.boolean().optional(),
		clearBindings: z.boolean().optional(),
	}),
	"chat_lifecycle.activate": ChatRevisionMutation,
	"chat_lifecycle.rename": ChatRevisionMutation.extend({ title: Title }),
	"chat_lifecycle.purge": ChatRevisionMutation,
	"chat_lifecycle.stop": z.strictObject({
		operationId: Id,
		sessionId: SessionId,
	}),
} satisfies Record<HubChatLifecycleCommandName, z.ZodType>;

const UsageSummary = z.strictObject({
	inputTokens: z.number().finite().nonnegative(),
	outputTokens: z.number().finite().nonnegative(),
	cacheReadTokens: z.number().finite().nonnegative(),
	cacheWriteTokens: z.number().finite().nonnegative(),
	totalCost: z.number().finite().nonnegative(),
});

export const HUB_CHAT_LIFECYCLE_TURN_SUMMARY_SCHEMA = z.strictObject({
	text: z.string().max(256 * 1024),
	usage: UsageSummary,
	iterations: Revision,
	finishReason: Id,
	model: z.strictObject({ id: Id, provider: Id }),
	startedAt: Timestamp,
	endedAt: Timestamp,
	durationMs: z.number().finite().nonnegative(),
});

export const HUB_CHAT_LIFECYCLE_PROFILE_AUTHORITY_SCHEMA =
	HUB_CHAT_PROFILE_AUTHORITY_SCHEMA;

const StartResult = z.strictObject({
	sessionId: SessionId,
	chatId: Id,
	leaseRevision: Revision,
	writerGeneration: z.number().int().safe().positive(),
	leaseExpiresAt: Timestamp,
	profileAuthority: HUB_CHAT_LIFECYCLE_PROFILE_AUTHORITY_SCHEMA,
	turn: HUB_CHAT_LIFECYCLE_TURN_SUMMARY_SCHEMA.optional(),
});

export const HUB_CHAT_LIFECYCLE_CHAT_DETAIL_SCHEMA =
	HUB_CHAT_DETAIL_WIRE_SCHEMA.omit({
		workspaceKey: true,
	});

export const HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS = {
	"chat_lifecycle.start_root": StartResult,
	"chat_lifecycle.start_related": StartResult,
	"chat_lifecycle.restore_checkpoint": StartResult.extend({
		checkpoint: z.strictObject({
			createdAt: z.number().finite().nonnegative(),
			runCount: Revision,
			kind: z.enum(["stash", "commit"]).optional(),
		}),
		restoredMessageCount: Revision,
	}),
	"chat_lifecycle.resume": StartResult,
	"chat_lifecycle.recover_lost_lease": StartResult,
	"chat_lifecycle.run_turn": z.strictObject({
		turn: HUB_CHAT_LIFECYCLE_TURN_SUMMARY_SCHEMA.nullable(),
	}),
	"chat_lifecycle.binding.get": HUB_CHAT_BINDING_WIRE_SCHEMA.nullable(),
	"chat_lifecycle.bind": HUB_CHAT_BINDING_WIRE_SCHEMA,
	"chat_lifecycle.reset": HUB_CHAT_BINDING_WIRE_SCHEMA.nullable(),
	"chat_lifecycle.archive": HUB_CHAT_LIFECYCLE_CHAT_DETAIL_SCHEMA,
	"chat_lifecycle.activate": HUB_CHAT_LIFECYCLE_CHAT_DETAIL_SCHEMA,
	"chat_lifecycle.rename": HUB_CHAT_LIFECYCLE_CHAT_DETAIL_SCHEMA,
	"chat_lifecycle.purge": z.strictObject({
		chatId: Id,
		sessionIds: z.array(SessionId),
		applied: z.boolean(),
	}),
	"chat_lifecycle.stop": z.strictObject({ stopped: z.literal(true) }),
} satisfies Record<HubChatLifecycleCommandName, z.ZodType>;

export type HubChatLifecycleStartProfile = z.infer<
	typeof HUB_CHAT_LIFECYCLE_START_PROFILE_SCHEMA
>;
export type HubChatLifecycleBindingScope = z.infer<
	typeof HUB_CHAT_LIFECYCLE_BINDING_SCOPE_SCHEMA
>;
export type HubChatLifecycleProfileAuthority = z.infer<
	typeof HUB_CHAT_LIFECYCLE_PROFILE_AUTHORITY_SCHEMA
>;
export type HubChatLifecycleRequestPayload<
	Command extends HubChatLifecycleCommandName,
> = z.input<(typeof HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS)[Command]>;
export type HubChatLifecycleResult<
	Command extends HubChatLifecycleCommandName,
> = z.output<(typeof HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS)[Command]>;

export function parseHubChatLifecycleWireRequest(input: {
	version: unknown;
	command: unknown;
	payload: unknown;
}): {
	version: typeof CHAT_LIFECYCLE_WIRE_VERSION;
	command: HubChatLifecycleCommandName;
	payload: Record<string, unknown>;
} {
	const version = z.literal(CHAT_LIFECYCLE_WIRE_VERSION).parse(input.version);
	const command = z.enum(HUB_CHAT_LIFECYCLE_COMMANDS).parse(input.command);
	const payload = HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS[command].parse(
		input.payload ?? {},
	);
	return { version, command, payload: payload as Record<string, unknown> };
}

export function parseHubChatLifecycleWireResult(
	command: HubChatLifecycleCommandName,
	input: unknown,
): unknown {
	return HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS[command].parse(input);
}

export function parseHubChatLifecycleWireReply(
	command: HubChatLifecycleCommandName,
	input: unknown,
): HubReplyEnvelope {
	const success = z.strictObject({
		version: z.literal(CHAT_LIFECYCLE_WIRE_VERSION),
		requestId: Id.optional(),
		ok: z.literal(true),
		payload: z.strictObject({
			result: HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS[command],
		}),
	});
	const failure = z.strictObject({
		version: z.literal(CHAT_LIFECYCLE_WIRE_VERSION),
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
