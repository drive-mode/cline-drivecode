import { z } from "zod";
import {
	HUB_CHAT_RUNTIME_COMMANDS,
	type HubChatRuntimeCommandName,
	type HubChatRuntimeCursor,
	type HubReplyEnvelope,
} from "../hub";

export const CHAT_RUNTIME_WIRE_VERSION = "v1" as const;
export const CHAT_RUNTIME_MAX_IMAGES = 4;
export const CHAT_RUNTIME_MAX_FILES = 8;
export const CHAT_RUNTIME_MAX_IMAGE_BASE64_CHARS = 512 * 1024;
export const CHAT_RUNTIME_MAX_FILE_CONTENT_CHARS = 256 * 1024;
export const CHAT_RUNTIME_MAX_ATTACHMENT_BUNDLE_CHARS = 640 * 1024;
export const CHAT_RUNTIME_MAX_JSON_CHARS = 256 * 1024;
export const CHAT_RUNTIME_MAX_OUTBOUND_WIRE_BYTES = 768 * 1024;
export const CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE = 256;

const Id = z.string().trim().min(1).max(512);
const ShortName = z.string().trim().min(1).max(256);
const Revision = z.number().int().safe().nonnegative();
const PositiveInteger = z.number().int().safe().positive();
const Timestamp = z.string().datetime();
const Prompt = z
	.string()
	.max(64 * 1024)
	.refine(
		(value) => new TextEncoder().encode(value).byteLength <= 64 * 1024,
		"prompt exceeds the managed runtime byte limit",
	);
const DisplayText = z
	.string()
	.max(256 * 1024)
	.refine(
		(value) => new TextEncoder().encode(value).byteLength <= 256 * 1024,
		"display text exceeds the managed runtime byte limit",
	);
const DisplayDelta = z
	.string()
	.max(128 * 1024)
	.refine(
		(value) => new TextEncoder().encode(value).byteLength <= 128 * 1024,
		"display delta exceeds the managed runtime byte limit",
	);
const SafeSummary = z.string().max(4096);
const SafeReason = z.string().max(2048);

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

const RuntimeStreamId = z
	.string()
	.trim()
	.min(1)
	.max(512)
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._-]*$/,
		"runtime stream id must be one opaque path-safe segment",
	)
	.refine((value) => value !== "." && value !== "..", {
		message: "runtime stream id must be one opaque path-safe segment",
	});

export const HUB_CHAT_RUNTIME_CURSOR_SCHEMA = z.strictObject({
	streamId: RuntimeStreamId,
	sessionSequence: Revision,
});

/** Descriptive profile authority shared by lifecycle admission and hydration. */
export const HUB_CHAT_PROFILE_AUTHORITY_SCHEMA = z.strictObject({
	profileId: Id,
	profileRevision: PositiveInteger,
	authorityClassId: Id,
	policyEpoch: Revision,
	allowedModes: z
		.array(z.enum(["act", "plan", "yolo", "zen"]))
		.min(1)
		.max(4)
		.refine(
			(modes) =>
				new Set(modes).size === modes.length &&
				modes.every((mode, index) => index === 0 || modes[index - 1] < mode),
			"allowed modes must be unique and canonically ordered",
		)
		.readonly(),
});

const SafeFileName = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.refine(
		(value) =>
			value !== "." &&
			value !== ".." &&
			!value.includes("/") &&
			!value.includes("\\") &&
			!value.includes("\0"),
		"file name must be one safe display segment",
	);

const MediaType = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i);

const Base64 = z
	.string()
	.min(1)
	.max(CHAT_RUNTIME_MAX_IMAGE_BASE64_CHARS)
	.regex(
		/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
		"image data must be raw base64 without a data URL prefix",
	);

export const HUB_CHAT_RUNTIME_IMAGE_ATTACHMENT_SCHEMA = z.strictObject({
	mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
	dataBase64: Base64,
});

export const HUB_CHAT_RUNTIME_FILE_ATTACHMENT_SCHEMA = z.strictObject({
	name: SafeFileName,
	mediaType: MediaType.optional(),
	content: z
		.string()
		.max(CHAT_RUNTIME_MAX_FILE_CONTENT_CHARS)
		.refine(
			(value) =>
				new TextEncoder().encode(value).byteLength <=
				CHAT_RUNTIME_MAX_FILE_CONTENT_CHARS,
			"file content exceeds the managed runtime byte limit",
		),
});

export const HUB_CHAT_RUNTIME_ATTACHMENT_BUNDLE_SCHEMA = z
	.strictObject({
		images: z
			.array(HUB_CHAT_RUNTIME_IMAGE_ATTACHMENT_SCHEMA)
			.max(CHAT_RUNTIME_MAX_IMAGES)
			.optional(),
		files: z
			.array(HUB_CHAT_RUNTIME_FILE_ATTACHMENT_SCHEMA)
			.max(CHAT_RUNTIME_MAX_FILES)
			.optional(),
	})
	.superRefine((value, context) => {
		const totalBytes =
			(value.images ?? []).reduce(
				(total, image) => total + image.dataBase64.length,
				0,
			) +
			(value.files ?? []).reduce(
				(total, file) =>
					total +
					new TextEncoder().encode(file.name).byteLength +
					new TextEncoder().encode(file.content).byteLength,
				0,
			);
		if (totalBytes > CHAT_RUNTIME_MAX_ATTACHMENT_BUNDLE_CHARS) {
			context.addIssue({
				code: "custom",
				message: "attachment bundle exceeds the managed runtime limit",
			});
		}
	});

type JsonInspection = {
	valid: boolean;
	reason?: string;
	nodes: number;
};

function inspectBoundedJson(
	value: unknown,
	depth = 0,
	seen = new WeakSet<object>(),
	inspection: JsonInspection = { valid: true, nodes: 0 },
): JsonInspection {
	inspection.nodes += 1;
	if (inspection.nodes > 2048) {
		return {
			...inspection,
			valid: false,
			reason: "JSON value has too many nodes",
		};
	}
	if (depth > 8) {
		return {
			...inspection,
			valid: false,
			reason: "JSON value is too deeply nested",
		};
	}
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		if (typeof value === "string" && value.length > 64 * 1024) {
			return {
				...inspection,
				valid: false,
				reason: "JSON string is too large",
			};
		}
		return inspection;
	}
	if (typeof value === "number") {
		return Number.isFinite(value)
			? inspection
			: { ...inspection, valid: false, reason: "JSON number must be finite" };
	}
	if (typeof value !== "object") {
		return { ...inspection, valid: false, reason: "value must be JSON-only" };
	}
	if (seen.has(value)) {
		return {
			...inspection,
			valid: false,
			reason: "JSON value must not be cyclic",
		};
	}
	seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > 256) {
			return { ...inspection, valid: false, reason: "JSON array is too large" };
		}
		for (const item of value) {
			const result = inspectBoundedJson(item, depth + 1, seen, inspection);
			if (!result.valid) return result;
		}
		seen.delete(value);
		return inspection;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return {
			...inspection,
			valid: false,
			reason: "value must be a plain JSON object",
		};
	}
	const entries = Object.entries(value);
	if (entries.length > 128) {
		return {
			...inspection,
			valid: false,
			reason: "JSON object has too many keys",
		};
	}
	for (const [key, item] of entries) {
		if (key.length === 0 || key.length > 128) {
			return {
				...inspection,
				valid: false,
				reason: "JSON object key is invalid",
			};
		}
		const result = inspectBoundedJson(item, depth + 1, seen, inspection);
		if (!result.valid) return result;
	}
	seen.delete(value);
	return inspection;
}

export const HUB_CHAT_RUNTIME_BOUNDED_JSON_OBJECT_SCHEMA = z
	.record(z.string(), z.unknown())
	.superRefine((value, context) => {
		const inspection = inspectBoundedJson(value);
		if (!inspection.valid) {
			context.addIssue({
				code: "custom",
				message: inspection.reason ?? "invalid bounded JSON object",
			});
			return;
		}
		let serialized: string;
		try {
			serialized = JSON.stringify(value);
		} catch {
			context.addIssue({
				code: "custom",
				message: "JSON value is not serializable",
			});
			return;
		}
		if (serialized.length > CHAT_RUNTIME_MAX_JSON_CHARS) {
			context.addIssue({
				code: "custom",
				message: "JSON value exceeds the managed runtime limit",
			});
		}
	});

export const HUB_CHAT_RUNTIME_ATTACHMENT_SUMMARY_SCHEMA = z.strictObject({
	kind: z.enum(["image", "file"]),
	name: SafeFileName.optional(),
	mediaType: MediaType.optional(),
	sizeBytes: Revision.optional(),
});

export const HUB_CHAT_RUNTIME_PENDING_PROMPT_SCHEMA = z.strictObject({
	promptId: Id,
	prompt: Prompt,
	delivery: z.enum(["queue", "steer"]),
	mode: z.enum(["act", "plan", "yolo"]).optional(),
	attachments: z.array(HUB_CHAT_RUNTIME_ATTACHMENT_SUMMARY_SCHEMA).max(12),
});

export const HUB_CHAT_RUNTIME_MESSAGE_SCHEMA = z.strictObject({
	messageId: Id,
	sequence: Revision,
	role: z.enum(["user", "assistant", "tool", "notice"]),
	timestamp: Timestamp.optional(),
	text: DisplayText,
	attachments: z.array(HUB_CHAT_RUNTIME_ATTACHMENT_SUMMARY_SCHEMA).max(12),
	tool: z
		.strictObject({
			toolCallId: Id,
			toolName: ShortName,
			status: z.enum(["started", "running", "completed", "failed"]),
			summary: SafeSummary.optional(),
		})
		.optional(),
});

export const HUB_CHAT_RUNTIME_CHECKPOINT_SCHEMA = z.strictObject({
	createdAt: z.number().finite().nonnegative(),
	runCount: Revision,
	kind: z.enum(["stash", "commit"]).optional(),
});

export const HUB_CHAT_RUNTIME_USAGE_SCHEMA = z.strictObject({
	inputTokens: z.number().finite().nonnegative(),
	outputTokens: z.number().finite().nonnegative(),
	cacheReadTokens: z.number().finite().nonnegative(),
	cacheWriteTokens: z.number().finite().nonnegative(),
	totalCost: z.number().finite().nonnegative(),
});

export const HUB_CHAT_RUNTIME_COMPACTION_SUMMARY_SCHEMA = z.strictObject({
	version: Revision,
	updatedAt: Timestamp.optional(),
	sourceMessageCount: Revision,
	compactedMessageCount: Revision,
	conversationId: Id.optional(),
});

const OperationAndSession = {
	operationId: Id,
	sessionId: SessionId,
};

const PendingPromptListResult = z.strictObject({
	sessionId: SessionId,
	prompts: z.array(HUB_CHAT_RUNTIME_PENDING_PROMPT_SCHEMA).max(20),
	nextCursor: Id.optional(),
	hasMore: z.boolean(),
});

const PendingPromptMutationResult = PendingPromptListResult.extend({
	prompt: HUB_CHAT_RUNTIME_PENDING_PROMPT_SCHEMA.optional(),
	updated: z.boolean().optional(),
	removed: z.boolean().optional(),
});

const CapabilityResponse = z
	.strictObject({
		...OperationAndSession,
		runId: Id,
		requestId: Id,
		capability: ShortName,
		result: HUB_CHAT_RUNTIME_BOUNDED_JSON_OBJECT_SCHEMA.optional(),
		error: SafeReason.optional(),
	})
	.superRefine((value, context) => {
		if ((value.result === undefined) === (value.error === undefined)) {
			context.addIssue({
				code: "custom",
				message: "exactly one capability result or error is required",
			});
		}
	});

export const HUB_CHAT_RUNTIME_SESSION_CONTINUITY_SCHEMA = z.discriminatedUnion(
	"state",
	[
		z.strictObject({
			sessionId: SessionId,
			state: z.literal("not_resident"),
		}),
		z.strictObject({
			sessionId: SessionId,
			state: z.literal("owned_elsewhere"),
		}),
		z.strictObject({
			sessionId: SessionId,
			state: z.literal("orphaned"),
			writerGeneration: PositiveInteger,
			runtimeBaseline: HUB_CHAT_RUNTIME_CURSOR_SCHEMA,
		}),
	],
);

export const HUB_CHAT_RUNTIME_SESSION_HYDRATION_SCHEMA = z.strictObject({
	sessionId: SessionId,
	chatId: Id,
	writerGeneration: PositiveInteger,
	profileAuthority: HUB_CHAT_PROFILE_AUTHORITY_SCHEMA,
	requestedBaseline: HUB_CHAT_RUNTIME_CURSOR_SCHEMA,
	runtimeBaseline: HUB_CHAT_RUNTIME_CURSOR_SCHEMA,
	replayAvailable: z.boolean(),
	messages: z.array(HUB_CHAT_RUNTIME_MESSAGE_SCHEMA).max(32),
	messagesTruncated: z.boolean(),
	pendingPrompts: z.array(HUB_CHAT_RUNTIME_PENDING_PROMPT_SCHEMA).max(20),
	pendingPromptsTruncated: z.boolean(),
	checkpoints: z.array(HUB_CHAT_RUNTIME_CHECKPOINT_SCHEMA).max(64),
	checkpointsTruncated: z.boolean(),
	usage: HUB_CHAT_RUNTIME_USAGE_SCHEMA.optional(),
	aggregateUsage: HUB_CHAT_RUNTIME_USAGE_SCHEMA.optional(),
	compaction: HUB_CHAT_RUNTIME_COMPACTION_SUMMARY_SCHEMA.nullable(),
});

export const HUB_CHAT_RUNTIME_REQUEST_SCHEMAS = {
	"chat_runtime.abort": z.strictObject({
		...OperationAndSession,
		runId: Id,
		reason: SafeReason.optional(),
	}),
	"chat_runtime.session.continuity": z.strictObject({
		sessionId: SessionId,
	}),
	"chat_runtime.session.hydrate": z.strictObject({
		sessionId: SessionId,
		expectedWriterGeneration: PositiveInteger,
		baseline: HUB_CHAT_RUNTIME_CURSOR_SCHEMA,
	}),
	"chat_runtime.session.reclaim": z.strictObject({
		...OperationAndSession,
		expectedWriterGeneration: PositiveInteger,
	}),
	"chat_runtime.session.reclaim.cancel": z.strictObject({
		...OperationAndSession,
		expectedWriterGeneration: PositiveInteger,
	}),
	"chat_runtime.approval.respond": z.strictObject({
		...OperationAndSession,
		runId: Id,
		approvalId: Id,
		decision: z.enum(["approve", "deny"]),
		reason: SafeReason.optional(),
	}),
	"chat_runtime.pending_prompts.list": z.strictObject({
		sessionId: SessionId,
		cursor: Id.optional(),
		limit: PositiveInteger.max(20).optional(),
	}),
	"chat_runtime.pending_prompts.update": z
		.strictObject({
			...OperationAndSession,
			promptId: Id,
			prompt: Prompt.optional(),
			mode: z.enum(["act", "plan", "yolo"]).optional(),
			delivery: z.enum(["queue", "steer"]).optional(),
		})
		.superRefine((value, context) => {
			if (
				value.prompt === undefined &&
				value.mode === undefined &&
				value.delivery === undefined
			) {
				context.addIssue({
					code: "custom",
					message: "pending prompt update requires a mutable field",
				});
			}
		}),
	"chat_runtime.pending_prompts.remove": z.strictObject({
		...OperationAndSession,
		promptId: Id,
	}),
	"chat_runtime.messages.list": z.strictObject({
		sessionId: SessionId,
		cursor: Id.optional(),
		limit: PositiveInteger.max(200).optional(),
	}),
	"chat_runtime.checkpoints.list": z.strictObject({
		sessionId: SessionId,
		limit: PositiveInteger.max(200).optional(),
	}),
	"chat_runtime.usage.get": z.strictObject({ sessionId: SessionId }),
	"chat_runtime.compaction.get": z.strictObject({ sessionId: SessionId }),
	"chat_runtime.compaction.run": z.strictObject({
		...OperationAndSession,
		reason: SafeReason.optional(),
	}),
	"chat_runtime.capability.respond": CapabilityResponse,
} satisfies Record<HubChatRuntimeCommandName, z.ZodType>;

export const HUB_CHAT_RUNTIME_RESULT_SCHEMAS = {
	"chat_runtime.abort": z.strictObject({
		sessionId: SessionId,
		operationId: Id,
		runId: Id,
		accepted: z.boolean(),
	}),
	"chat_runtime.session.continuity": HUB_CHAT_RUNTIME_SESSION_CONTINUITY_SCHEMA,
	"chat_runtime.session.hydrate": HUB_CHAT_RUNTIME_SESSION_HYDRATION_SCHEMA,
	"chat_runtime.session.reclaim": z.strictObject({
		sessionId: SessionId,
		leaseRevision: PositiveInteger,
		writerGeneration: PositiveInteger,
		leaseExpiresAt: Timestamp,
		ownerTransferred: z.boolean(),
	}),
	"chat_runtime.session.reclaim.cancel": z.strictObject({
		...OperationAndSession,
		writerGeneration: PositiveInteger,
		cancellationAccepted: z.boolean(),
	}),
	"chat_runtime.approval.respond": z.strictObject({
		sessionId: SessionId,
		operationId: Id,
		runId: Id,
		approvalId: Id,
		decision: z.enum(["approve", "deny"]),
	}),
	"chat_runtime.pending_prompts.list": PendingPromptListResult,
	"chat_runtime.pending_prompts.update": PendingPromptMutationResult,
	"chat_runtime.pending_prompts.remove": PendingPromptMutationResult,
	"chat_runtime.messages.list": z.strictObject({
		sessionId: SessionId,
		messages: z.array(HUB_CHAT_RUNTIME_MESSAGE_SCHEMA).max(200),
		nextCursor: Id.optional(),
		hasMore: z.boolean(),
	}),
	"chat_runtime.checkpoints.list": z.strictObject({
		sessionId: SessionId,
		checkpoints: z.array(HUB_CHAT_RUNTIME_CHECKPOINT_SCHEMA).max(200),
	}),
	"chat_runtime.usage.get": z.strictObject({
		sessionId: SessionId,
		usage: HUB_CHAT_RUNTIME_USAGE_SCHEMA.optional(),
		aggregateUsage: HUB_CHAT_RUNTIME_USAGE_SCHEMA.optional(),
	}),
	"chat_runtime.compaction.get": z.strictObject({
		sessionId: SessionId,
		state: HUB_CHAT_RUNTIME_COMPACTION_SUMMARY_SCHEMA.nullable(),
	}),
	"chat_runtime.compaction.run": z
		.strictObject({
			sessionId: SessionId,
			operationId: Id,
			outcome: z.enum(["completed", "skipped"]),
			state: HUB_CHAT_RUNTIME_COMPACTION_SUMMARY_SCHEMA.optional(),
		})
		.superRefine((value, context) => {
			if ((value.outcome === "completed") !== (value.state !== undefined)) {
				context.addIssue({
					code: "custom",
					message:
						"completed compaction requires state and skipped compaction forbids it",
				});
			}
		}),
	"chat_runtime.capability.respond": z.strictObject({
		sessionId: SessionId,
		operationId: Id,
		runId: Id,
		requestId: Id,
		accepted: z.boolean(),
	}),
} satisfies Record<HubChatRuntimeCommandName, z.ZodType>;

const RunStarted = z.strictObject({
	kind: z.literal("run.started"),
	operationId: Id,
	runId: Id,
});
const RunHeartbeat = z.strictObject({
	kind: z.literal("run.heartbeat"),
	runId: Id,
	elapsedMs: z.number().finite().nonnegative(),
});
const RunAborted = z.strictObject({
	kind: z.literal("run.aborted"),
	runId: Id,
	reason: SafeReason.optional(),
});
const RunCompleted = z.strictObject({
	kind: z.literal("run.completed"),
	runId: Id,
	finishReason: ShortName.optional(),
});
const RunFailed = z.strictObject({
	kind: z.literal("run.failed"),
	runId: Id,
	error: SafeReason,
});
const AssistantDelta = z.strictObject({
	kind: z.literal("assistant.delta"),
	runId: Id,
	text: DisplayDelta,
});
const AssistantFinished = z.strictObject({
	kind: z.literal("assistant.finished"),
	runId: Id,
	text: DisplayText,
});
const ReasoningDelta = z.strictObject({
	kind: z.literal("reasoning.delta"),
	runId: Id,
	text: DisplayDelta,
});
const ReasoningFinished = z.strictObject({
	kind: z.literal("reasoning.finished"),
	runId: Id,
	text: DisplayText,
});
const ToolStatus = z.strictObject({
	kind: z.enum(["tool.started", "tool.updated", "tool.finished"]),
	runId: Id,
	toolCallId: Id,
	toolName: ShortName,
	status: z.enum(["started", "running", "completed", "failed"]),
	summary: SafeSummary.optional(),
	error: SafeReason.optional(),
});
const ApprovalRequested = z.strictObject({
	kind: z.literal("approval.requested"),
	runId: Id,
	approvalId: Id,
	toolCallId: Id,
	toolName: ShortName,
	policy: ShortName,
	summary: SafeSummary.optional(),
	expiresAt: Timestamp,
});
const ApprovalResolved = z.strictObject({
	kind: z.literal("approval.resolved"),
	approvalId: Id,
	decision: z.enum(["approve", "deny"]),
	reason: SafeReason.optional(),
});
const PendingPromptsChanged = z.strictObject({
	kind: z.literal("pending_prompts.changed"),
	prompts: z.array(HUB_CHAT_RUNTIME_PENDING_PROMPT_SCHEMA).max(20),
	nextCursor: Id.optional(),
	hasMore: z.boolean(),
});
const PendingPromptSubmitted = z.strictObject({
	kind: z.literal("pending_prompt.submitted"),
	prompt: HUB_CHAT_RUNTIME_PENDING_PROMPT_SCHEMA,
});
const UsageUpdated = z.strictObject({
	kind: z.literal("usage.updated"),
	usage: HUB_CHAT_RUNTIME_USAGE_SCHEMA.optional(),
	aggregateUsage: HUB_CHAT_RUNTIME_USAGE_SCHEMA.optional(),
});
const CompactionStarted = z.strictObject({
	kind: z.literal("compaction.started"),
	operationId: Id,
});
const CompactionCompleted = z.strictObject({
	kind: z.literal("compaction.completed"),
	operationId: Id,
	state: HUB_CHAT_RUNTIME_COMPACTION_SUMMARY_SCHEMA,
});
const CompactionSkipped = z.strictObject({
	kind: z.literal("compaction.skipped"),
	operationId: Id,
	reason: SafeReason,
});
const CompactionFailed = z.strictObject({
	kind: z.literal("compaction.failed"),
	operationId: Id,
	error: SafeReason,
});
const CapabilityRequested = z.strictObject({
	kind: z.literal("capability.requested"),
	runId: Id,
	requestId: Id,
	capability: ShortName,
	request: HUB_CHAT_RUNTIME_BOUNDED_JSON_OBJECT_SCHEMA,
	expiresAt: Timestamp,
});
const CapabilityCancelled = z.strictObject({
	kind: z.literal("capability.cancelled"),
	runId: Id,
	requestId: Id,
	capability: ShortName,
	reason: SafeReason,
});

export const HUB_CHAT_RUNTIME_EVENT_PAYLOAD_SCHEMA = z.discriminatedUnion(
	"kind",
	[
		RunStarted,
		RunHeartbeat,
		RunAborted,
		RunCompleted,
		RunFailed,
		AssistantDelta,
		AssistantFinished,
		ReasoningDelta,
		ReasoningFinished,
		ToolStatus,
		ApprovalRequested,
		ApprovalResolved,
		PendingPromptsChanged,
		PendingPromptSubmitted,
		UsageUpdated,
		CompactionStarted,
		CompactionCompleted,
		CompactionSkipped,
		CompactionFailed,
		CapabilityRequested,
		CapabilityCancelled,
	],
);

export const HUB_CHAT_RUNTIME_EVENT_SUBSCRIPTION_SCHEMA = z
	.strictObject({
		sessionId: SessionId.optional(),
		cursor: HUB_CHAT_RUNTIME_CURSOR_SCHEMA.optional(),
	})
	.superRefine((value, context) => {
		if (value.cursor && !value.sessionId) {
			context.addIssue({
				code: "custom",
				path: ["cursor"],
				message: "runtime recovery cursor requires one session scope",
			});
		}
	});

export const HUB_CHAT_RUNTIME_EVENT_SCHEMA = z
	.strictObject({
		version: z.literal(CHAT_RUNTIME_WIRE_VERSION),
		event: z.literal("chat.runtime"),
		eventId: Id,
		streamId: RuntimeStreamId,
		sessionId: SessionId,
		timestamp: z.number().int().safe().nonnegative(),
		processSequence: PositiveInteger,
		/** Inclusive start when additive delivery compresses multiple events. */
		sessionSequenceStart: PositiveInteger.optional(),
		/** Inclusive end; singleton events omit sessionSequenceStart. */
		sessionSequence: PositiveInteger,
		payload: HUB_CHAT_RUNTIME_EVENT_PAYLOAD_SCHEMA,
	})
	.superRefine((value, context) => {
		const start = value.sessionSequenceStart ?? value.sessionSequence;
		if (
			value.sessionSequenceStart !== undefined &&
			start === value.sessionSequence
		) {
			context.addIssue({
				code: "custom",
				path: ["sessionSequenceStart"],
				message: "singleton events must omit sessionSequenceStart",
			});
		}
		if (start > value.sessionSequence) {
			context.addIssue({
				code: "custom",
				path: ["sessionSequenceStart"],
				message: "session sequence range must not regress",
			});
			return;
		}
		if (
			value.sessionSequence - start >=
			CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE
		) {
			context.addIssue({
				code: "custom",
				path: ["sessionSequenceStart"],
				message: "session sequence range exceeds the coalescing limit",
			});
		}
		if (
			start !== value.sessionSequence &&
			value.payload.kind !== "assistant.delta"
		) {
			context.addIssue({
				code: "custom",
				path: ["payload", "kind"],
				message: "multi-sequence ranges require assistant.delta payloads",
			});
		}
	});

export type HubChatRuntimeAttachments = z.infer<
	typeof HUB_CHAT_RUNTIME_ATTACHMENT_BUNDLE_SCHEMA
>;
export type HubChatRuntimeEventSubscription = z.infer<
	typeof HUB_CHAT_RUNTIME_EVENT_SUBSCRIPTION_SCHEMA
>;
export type HubChatRuntimeWireEvent = z.infer<
	typeof HUB_CHAT_RUNTIME_EVENT_SCHEMA
>;
export type HubChatRuntimeRequestPayload<
	Command extends HubChatRuntimeCommandName,
> = z.input<(typeof HUB_CHAT_RUNTIME_REQUEST_SCHEMAS)[Command]>;
export type HubChatRuntimeResult<Command extends HubChatRuntimeCommandName> =
	z.output<(typeof HUB_CHAT_RUNTIME_RESULT_SCHEMAS)[Command]>;

export function getHubChatRuntimeSessionSequenceRange(
	event: HubChatRuntimeWireEvent,
): { readonly start: number; readonly end: number } {
	return {
		start: event.sessionSequenceStart ?? event.sessionSequence,
		end: event.sessionSequence,
	};
}

export function parseHubChatRuntimeCursor(
	input: unknown,
): HubChatRuntimeCursor {
	return HUB_CHAT_RUNTIME_CURSOR_SCHEMA.parse(input);
}

export function parseHubChatRuntimeWireRequest(input: {
	version: unknown;
	command: unknown;
	payload: unknown;
}): {
	version: typeof CHAT_RUNTIME_WIRE_VERSION;
	command: HubChatRuntimeCommandName;
	payload: Record<string, unknown>;
} {
	const version = z.literal(CHAT_RUNTIME_WIRE_VERSION).parse(input.version);
	const command = z.enum(HUB_CHAT_RUNTIME_COMMANDS).parse(input.command);
	const payload = HUB_CHAT_RUNTIME_REQUEST_SCHEMAS[command].parse(
		input.payload ?? {},
	);
	return { version, command, payload: payload as Record<string, unknown> };
}

export function parseHubChatRuntimeWireResult(
	command: HubChatRuntimeCommandName,
	input: unknown,
): unknown {
	const parsed = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[command].parse(input);
	assertOutboundWireSize(parsed);
	return parsed;
}

export function parseHubChatRuntimeWireReply(
	command: HubChatRuntimeCommandName,
	input: unknown,
): HubReplyEnvelope {
	const success = z.strictObject({
		version: z.literal(CHAT_RUNTIME_WIRE_VERSION),
		requestId: Id.optional(),
		ok: z.literal(true),
		payload: z.strictObject({
			result: HUB_CHAT_RUNTIME_RESULT_SCHEMAS[command],
		}),
	});
	const failure = z.strictObject({
		version: z.literal(CHAT_RUNTIME_WIRE_VERSION),
		requestId: Id.optional(),
		ok: z.literal(false),
		error: z.strictObject({
			code: Id,
			message: z.string().min(1).max(2048),
			details: z.record(z.string(), z.unknown()).optional(),
		}),
	});
	const parsed = z.union([success, failure]).parse(input);
	assertOutboundWireSize(parsed);
	return parsed as HubReplyEnvelope;
}

export function parseHubChatRuntimeEventSubscription(
	input: unknown,
): HubChatRuntimeEventSubscription {
	return HUB_CHAT_RUNTIME_EVENT_SUBSCRIPTION_SCHEMA.parse(input ?? {});
}

export function parseHubChatRuntimeWireEvent(
	input: unknown,
): HubChatRuntimeWireEvent {
	const parsed = HUB_CHAT_RUNTIME_EVENT_SCHEMA.parse(input);
	assertOutboundWireSize(parsed);
	return parsed;
}

function assertOutboundWireSize(input: unknown): void {
	if (
		new TextEncoder().encode(JSON.stringify(input)).byteLength >
		CHAT_RUNTIME_MAX_OUTBOUND_WIRE_BYTES
	) {
		throw new Error("managed runtime output exceeds the transport byte limit");
	}
}
