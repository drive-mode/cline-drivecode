import type { ManagedHubChatRuntimeEvent } from "@cline/core";
import {
	CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE,
	HUB_CHAT_RUNTIME_EVENT_SCHEMA,
} from "@cline/shared";

const ASK_QUESTION_CAPABILITY = "tool_executor.askQuestion";
const MAX_QUESTION_BYTES = 16 * 1024;
const MAX_OPTION_BYTES = 4 * 1024;

type StrictRuntimePayload = ManagedHubChatRuntimeEvent["payload"];
type Payload<Kind extends StrictRuntimePayload["kind"]> = Extract<
	StrictRuntimePayload,
	{ kind: Kind }
>;
type PendingPrompt = Payload<"pending_prompt.submitted">["prompt"];
type Usage = NonNullable<Payload<"usage.updated">["usage"]>;
type CompactionState = Payload<"compaction.completed">["state"];

type DeepReadonly<Value> = Value extends readonly unknown[]
	? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
	: Value extends object
		? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
		: Value;

type ManagedInteractiveRuntimeEventData =
	| { kind: "run.started"; operationId: string; runId: string }
	| { kind: "run.heartbeat"; runId: string; elapsedMs: number }
	| { kind: "run.aborted"; runId: string; reason?: string }
	| { kind: "run.completed"; runId: string; finishReason?: string }
	| { kind: "run.failed"; runId: string; error: string }
	| { kind: "assistant.delta"; runId: string; text: string }
	| { kind: "assistant.finished"; runId: string; text: string }
	| { kind: "reasoning.delta"; runId: string; text: string }
	| { kind: "reasoning.finished"; runId: string; text: string }
	| {
			kind: "tool.status";
			runId: string;
			toolCallId: string;
			toolName: string;
			status: "started" | "running" | "completed" | "failed";
			summary?: string;
			error?: string;
	  }
	| {
			kind: "approval.requested";
			runId: string;
			approvalId: string;
			toolCallId: string;
			toolName: string;
			policy: string;
			summary?: string;
			expiresAt: string;
	  }
	| {
			kind: "approval.resolved";
			approvalId: string;
			decision: "approve" | "deny";
			reason?: string;
	  }
	| {
			kind: "pending_prompts.changed";
			prompts: readonly PendingPrompt[];
			nextCursor?: string;
			hasMore: boolean;
	  }
	| { kind: "pending_prompt.submitted"; prompt: PendingPrompt }
	| {
			kind: "usage.updated";
			usage?: Usage;
			aggregateUsage?: Usage;
	  }
	| { kind: "compaction.started"; operationId: string }
	| {
			kind: "compaction.completed";
			operationId: string;
			state: CompactionState;
	  }
	| { kind: "compaction.skipped"; operationId: string; reason: string }
	| { kind: "compaction.failed"; operationId: string; error: string }
	| {
			kind: "question.requested";
			runId: string;
			requestId: string;
			question: string;
			options: readonly string[];
			expiresAt: string;
	  }
	| {
			kind: "question.cancelled";
			runId: string;
			requestId: string;
			reason: string;
	  };

export type ManagedInteractiveRuntimeEvent = DeepReadonly<
	{
		eventId: string;
		sessionId: string;
		sequenceStart: number;
		sequenceEnd: number;
		timestamp: number;
	} & ManagedInteractiveRuntimeEventData
>;

export class InvalidManagedRuntimeEventError extends Error {
	readonly code = "invalid_managed_runtime_event";

	constructor() {
		super("Managed runtime event cannot be reduced for the interactive app.");
		this.name = "InvalidManagedRuntimeEventError";
	}
}

function freezeData<Value>(value: Value): Value {
	if (!value || typeof value !== "object") return value;
	const pending: object[] = [value];
	const seen = new WeakSet<object>();
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (!candidate || seen.has(candidate)) continue;
		seen.add(candidate);
		for (const nested of Object.values(candidate)) {
			if (nested && typeof nested === "object") pending.push(nested);
		}
		Object.freeze(candidate);
	}
	return value;
}

function assertBoundedEventGraph(value: unknown): void {
	let nodes = 0;
	const ancestors = new WeakSet<object>();
	const inspect = (candidate: unknown, depth: number): void => {
		nodes += 1;
		if (nodes > 4096 || depth > 16) {
			throw new InvalidManagedRuntimeEventError();
		}
		if (!candidate || typeof candidate !== "object") return;
		if (ancestors.has(candidate)) {
			throw new InvalidManagedRuntimeEventError();
		}
		const prototype = Object.getPrototypeOf(candidate);
		if (
			prototype !== Object.prototype &&
			prototype !== null &&
			prototype !== Array.prototype
		) {
			throw new InvalidManagedRuntimeEventError();
		}
		ancestors.add(candidate);
		for (const nested of Object.values(candidate)) inspect(nested, depth + 1);
		ancestors.delete(candidate);
	};
	inspect(value, 0);
}

function opaqueId(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 512 ||
		value.trim() !== value
	) {
		throw new InvalidManagedRuntimeEventError();
	}
	return value;
}

function eventBase(event: ManagedHubChatRuntimeEvent) {
	if (
		event.version !== "v1" ||
		event.event !== "chat.runtime" ||
		!Number.isSafeInteger(event.timestamp) ||
		event.timestamp < 0 ||
		!Number.isSafeInteger(event.processSequence) ||
		event.processSequence < 1 ||
		!Number.isSafeInteger(event.sessionSequence) ||
		event.sessionSequence < 1
	) {
		throw new InvalidManagedRuntimeEventError();
	}
	const sequenceStart = event.sessionSequenceStart ?? event.sessionSequence;
	if (
		!Number.isSafeInteger(sequenceStart) ||
		sequenceStart < 1 ||
		sequenceStart > event.sessionSequence ||
		(event.sessionSequenceStart !== undefined &&
			sequenceStart === event.sessionSequence) ||
		event.sessionSequence - sequenceStart >=
			CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE ||
		(sequenceStart !== event.sessionSequence &&
			event.payload.kind !== "assistant.delta")
	) {
		throw new InvalidManagedRuntimeEventError();
	}
	return {
		eventId: opaqueId(event.eventId),
		sessionId: opaqueId(event.sessionId),
		sequenceStart,
		sequenceEnd: event.sessionSequence,
		timestamp: event.timestamp,
	};
}

function boundedText(value: unknown, maximumBytes: number): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		new TextEncoder().encode(value).byteLength > maximumBytes
	) {
		throw new InvalidManagedRuntimeEventError();
	}
	return value;
}

function askQuestionRequest(value: unknown): {
	question: string;
	options: readonly string[];
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new InvalidManagedRuntimeEventError();
	}
	const request = value as Record<string, unknown>;
	if (
		Object.keys(request).length !== 2 ||
		!("question" in request) ||
		!("options" in request) ||
		!Array.isArray(request.options) ||
		request.options.length < 2 ||
		request.options.length > 5
	) {
		throw new InvalidManagedRuntimeEventError();
	}
	return {
		question: boundedText(request.question, MAX_QUESTION_BYTES),
		options: request.options.map((option) =>
			boundedText(option, MAX_OPTION_BYTES),
		),
	};
}

function assertNever(value: never): never {
	void value;
	throw new InvalidManagedRuntimeEventError();
}

/**
 * Exhaustively converts the strict Core event to a detached app event. It
 * removes stream/process transport metadata and never reconstructs raw tool
 * input, output, credentials, paths, or provider-native messages.
 */
export function reduceManagedRuntimeEvent(
	event: ManagedHubChatRuntimeEvent,
): ManagedInteractiveRuntimeEvent {
	assertBoundedEventGraph(event);
	const parsed = HUB_CHAT_RUNTIME_EVENT_SCHEMA.safeParse(event);
	if (!parsed.success) throw new InvalidManagedRuntimeEventError();
	const strictEvent = parsed.data as ManagedHubChatRuntimeEvent;
	const base = eventBase(strictEvent);
	const payload = strictEvent.payload;
	let reduced: ManagedInteractiveRuntimeEventData;
	switch (payload.kind) {
		case "run.started":
			reduced = {
				kind: payload.kind,
				operationId: payload.operationId,
				runId: payload.runId,
			};
			break;
		case "run.heartbeat":
			reduced = {
				kind: payload.kind,
				runId: payload.runId,
				elapsedMs: payload.elapsedMs,
			};
			break;
		case "run.aborted":
			reduced = {
				kind: payload.kind,
				runId: payload.runId,
				...(payload.reason ? { reason: payload.reason } : {}),
			};
			break;
		case "run.completed":
			reduced = {
				kind: payload.kind,
				runId: payload.runId,
				...(payload.finishReason ? { finishReason: payload.finishReason } : {}),
			};
			break;
		case "run.failed":
			reduced = {
				kind: payload.kind,
				runId: payload.runId,
				error: payload.error,
			};
			break;
		case "assistant.delta":
		case "assistant.finished":
		case "reasoning.delta":
		case "reasoning.finished":
			reduced = {
				kind: payload.kind,
				runId: payload.runId,
				text: payload.text,
			};
			break;
		case "tool.started":
		case "tool.updated":
		case "tool.finished":
			reduced = {
				kind: "tool.status",
				runId: payload.runId,
				toolCallId: payload.toolCallId,
				toolName: payload.toolName,
				status: payload.status,
				...(payload.summary ? { summary: payload.summary } : {}),
				...(payload.error ? { error: payload.error } : {}),
			};
			break;
		case "approval.requested":
			reduced = {
				kind: payload.kind,
				runId: payload.runId,
				approvalId: payload.approvalId,
				toolCallId: payload.toolCallId,
				toolName: payload.toolName,
				policy: payload.policy,
				...(payload.summary ? { summary: payload.summary } : {}),
				expiresAt: payload.expiresAt,
			};
			break;
		case "approval.resolved":
			reduced = {
				kind: payload.kind,
				approvalId: payload.approvalId,
				decision: payload.decision,
				...(payload.reason ? { reason: payload.reason } : {}),
			};
			break;
		case "pending_prompts.changed":
			reduced = {
				kind: payload.kind,
				prompts: payload.prompts,
				...(payload.nextCursor ? { nextCursor: payload.nextCursor } : {}),
				hasMore: payload.hasMore,
			};
			break;
		case "pending_prompt.submitted":
			reduced = { kind: payload.kind, prompt: payload.prompt };
			break;
		case "usage.updated":
			reduced = {
				kind: payload.kind,
				...(payload.usage ? { usage: payload.usage } : {}),
				...(payload.aggregateUsage
					? { aggregateUsage: payload.aggregateUsage }
					: {}),
			};
			break;
		case "compaction.started":
			reduced = { kind: payload.kind, operationId: payload.operationId };
			break;
		case "compaction.completed":
			reduced = {
				kind: payload.kind,
				operationId: payload.operationId,
				state: payload.state,
			};
			break;
		case "compaction.skipped":
			reduced = {
				kind: payload.kind,
				operationId: payload.operationId,
				reason: payload.reason,
			};
			break;
		case "compaction.failed":
			reduced = {
				kind: payload.kind,
				operationId: payload.operationId,
				error: payload.error,
			};
			break;
		case "capability.requested": {
			if (payload.capability !== ASK_QUESTION_CAPABILITY) {
				throw new InvalidManagedRuntimeEventError();
			}
			const request = askQuestionRequest(payload.request);
			reduced = {
				kind: "question.requested",
				runId: payload.runId,
				requestId: payload.requestId,
				question: request.question,
				options: request.options,
				expiresAt: payload.expiresAt,
			};
			break;
		}
		case "capability.cancelled":
			if (payload.capability !== ASK_QUESTION_CAPABILITY) {
				throw new InvalidManagedRuntimeEventError();
			}
			reduced = {
				kind: "question.cancelled",
				runId: payload.runId,
				requestId: payload.requestId,
				reason: payload.reason,
			};
			break;
		default:
			return assertNever(payload);
	}
	return freezeData(structuredClone({ ...base, ...reduced }));
}
