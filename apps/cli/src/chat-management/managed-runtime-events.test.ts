import type { ManagedHubChatRuntimeEvent } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	InvalidManagedRuntimeEventError,
	reduceManagedRuntimeEvent,
} from "./managed-runtime-events";

function runtimeEvent(
	payload: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
): ManagedHubChatRuntimeEvent {
	return {
		version: "v1",
		event: "chat.runtime",
		eventId: "event-1",
		streamId: "stream-1",
		sessionId: "session-1",
		timestamp: 100,
		processSequence: 4,
		sessionSequence: 2,
		...overrides,
		payload,
	} as unknown as ManagedHubChatRuntimeEvent;
}

const PROMPT = {
	promptId: "prompt-1",
	prompt: "Continue",
	delivery: "queue",
	attachments: [],
} as const;

const USAGE = {
	inputTokens: 10,
	outputTokens: 20,
	cacheReadTokens: 3,
	cacheWriteTokens: 4,
	totalCost: 0.01,
} as const;

const COMPACTION = {
	version: 2,
	sourceMessageCount: 20,
	compactedMessageCount: 8,
} as const;

const EVENT_CASES: ReadonlyArray<
	readonly [name: string, payload: Record<string, unknown>, appKind: string]
> = [
	[
		"run start",
		{ kind: "run.started", operationId: "turn-1", runId: "run-1" },
		"run.started",
	],
	[
		"run heartbeat",
		{ kind: "run.heartbeat", runId: "run-1", elapsedMs: 20 },
		"run.heartbeat",
	],
	["run abort", { kind: "run.aborted", runId: "run-1" }, "run.aborted"],
	[
		"run completion",
		{ kind: "run.completed", runId: "run-1", finishReason: "done" },
		"run.completed",
	],
	[
		"run failure",
		{ kind: "run.failed", runId: "run-1", error: "safe" },
		"run.failed",
	],
	[
		"assistant delta",
		{ kind: "assistant.delta", runId: "run-1", text: "delta" },
		"assistant.delta",
	],
	[
		"assistant finish",
		{ kind: "assistant.finished", runId: "run-1", text: "done" },
		"assistant.finished",
	],
	[
		"reasoning delta",
		{ kind: "reasoning.delta", runId: "run-1", text: "delta" },
		"reasoning.delta",
	],
	[
		"reasoning finish",
		{ kind: "reasoning.finished", runId: "run-1", text: "done" },
		"reasoning.finished",
	],
	[
		"tool start",
		{
			kind: "tool.started",
			runId: "run-1",
			toolCallId: "tool-1",
			toolName: "bash",
			status: "started",
		},
		"tool.status",
	],
	[
		"tool update",
		{
			kind: "tool.updated",
			runId: "run-1",
			toolCallId: "tool-1",
			toolName: "bash",
			status: "running",
			summary: "safe summary",
		},
		"tool.status",
	],
	[
		"tool finish",
		{
			kind: "tool.finished",
			runId: "run-1",
			toolCallId: "tool-1",
			toolName: "bash",
			status: "completed",
		},
		"tool.status",
	],
	[
		"approval request",
		{
			kind: "approval.requested",
			runId: "run-1",
			approvalId: "approval-1",
			toolCallId: "tool-1",
			toolName: "bash",
			policy: "owner",
			summary: "safe summary",
			expiresAt: "2026-08-17T12:05:00.000Z",
		},
		"approval.requested",
	],
	[
		"approval resolution",
		{
			kind: "approval.resolved",
			approvalId: "approval-1",
			decision: "approve",
		},
		"approval.resolved",
	],
	[
		"pending prompt snapshot",
		{
			kind: "pending_prompts.changed",
			prompts: [PROMPT],
			hasMore: false,
		},
		"pending_prompts.changed",
	],
	[
		"pending prompt submission",
		{ kind: "pending_prompt.submitted", prompt: PROMPT },
		"pending_prompt.submitted",
	],
	[
		"usage",
		{ kind: "usage.updated", usage: USAGE, aggregateUsage: USAGE },
		"usage.updated",
	],
	[
		"compaction start",
		{ kind: "compaction.started", operationId: "compact-1" },
		"compaction.started",
	],
	[
		"compaction completion",
		{
			kind: "compaction.completed",
			operationId: "compact-1",
			state: COMPACTION,
		},
		"compaction.completed",
	],
	[
		"compaction skip",
		{
			kind: "compaction.skipped",
			operationId: "compact-1",
			reason: "not needed",
		},
		"compaction.skipped",
	],
	[
		"compaction failure",
		{
			kind: "compaction.failed",
			operationId: "compact-1",
			error: "safe",
		},
		"compaction.failed",
	],
	[
		"question request",
		{
			kind: "capability.requested",
			runId: "run-1",
			requestId: "request-1",
			capability: "tool_executor.askQuestion",
			request: { question: "Choose", options: ["A", "B"] },
			expiresAt: "2026-08-17T12:05:00.000Z",
		},
		"question.requested",
	],
	[
		"question cancellation",
		{
			kind: "capability.cancelled",
			runId: "run-1",
			requestId: "request-1",
			capability: "tool_executor.askQuestion",
			reason: "cancelled",
		},
		"question.cancelled",
	],
];

describe("reduceManagedRuntimeEvent", () => {
	it.each(EVENT_CASES)("reduces %s exhaustively", (_name, payload, appKind) => {
		const reduced = reduceManagedRuntimeEvent(runtimeEvent(payload));

		expect(reduced.kind).toBe(appKind);
		expect(reduced).toMatchObject({
			eventId: "event-1",
			sessionId: "session-1",
			sequenceStart: 2,
			sequenceEnd: 2,
			timestamp: 100,
		});
	});

	it("detaches, deeply freezes, and strips transport metadata", () => {
		const source = runtimeEvent({
			kind: "pending_prompts.changed",
			prompts: [PROMPT],
			hasMore: false,
		}) as unknown as Record<string, unknown>;
		const reduced = reduceManagedRuntimeEvent(
			source as unknown as ManagedHubChatRuntimeEvent,
		);

		expect(reduced).toMatchObject({ sequenceStart: 2, sequenceEnd: 2 });
		expect("streamId" in reduced).toBe(false);
		expect("processSequence" in reduced).toBe(false);
		expect("payload" in reduced).toBe(false);
		expect(Object.isFrozen(reduced)).toBe(true);
		if (reduced.kind !== "pending_prompts.changed") {
			throw new Error("missing pending prompt event");
		}
		expect(Object.isFrozen(reduced.prompts)).toBe(true);
		expect(Object.isFrozen(reduced.prompts[0])).toBe(true);
		expect(reduced.prompts).not.toBe(
			(source.payload as { prompts: unknown[] }).prompts,
		);
	});

	it("accepts only assistant deltas as a valid coalesced range", () => {
		const reduced = reduceManagedRuntimeEvent(
			runtimeEvent(
				{ kind: "assistant.delta", runId: "run-1", text: "delta" },
				{ sessionSequenceStart: 1 },
			),
		);

		expect(reduced).toMatchObject({
			kind: "assistant.delta",
			sequenceStart: 1,
			sequenceEnd: 2,
		});
	});

	it.each([
		[
			"an equal explicit sequence start",
			{ sessionSequenceStart: 2 },
			{ kind: "assistant.delta", runId: "run-1", text: "delta" },
		],
		[
			"a multi-sequence non-delta event",
			{ sessionSequenceStart: 1 },
			{ kind: "pending_prompts.changed", prompts: [], hasMore: false },
		],
		[
			"an oversized coalesced range",
			{ sessionSequenceStart: 1, sessionSequence: 257 },
			{ kind: "assistant.delta", runId: "run-1", text: "delta" },
		],
		[
			"an invalid process sequence",
			{ processSequence: 0 },
			{ kind: "usage.updated" },
		],
	] as const)("rejects %s", (_name, overrides, payload) => {
		expect(() =>
			reduceManagedRuntimeEvent(runtimeEvent(payload, overrides)),
		).toThrow(InvalidManagedRuntimeEventError);
	});

	it("maps the only granted capability to a frozen question contract", () => {
		const reduced = reduceManagedRuntimeEvent(
			runtimeEvent({
				kind: "capability.requested",
				runId: "run-1",
				requestId: "request-1",
				capability: "tool_executor.askQuestion",
				request: { question: "Choose", options: ["A", "B"] },
				expiresAt: "2026-08-17T12:05:00.000Z",
			}),
		);

		expect(reduced).toMatchObject({
			kind: "question.requested",
			question: "Choose",
			options: ["A", "B"],
		});
		if (reduced.kind !== "question.requested") {
			throw new Error("missing question request");
		}
		expect(Object.isFrozen(reduced.options)).toBe(true);
		expect("capability" in reduced).toBe(false);
		expect("request" in reduced).toBe(false);
	});

	it.each([
		[
			"unknown capability",
			"tool_executor.other",
			{ question: "Q", options: ["A", "B"] },
		],
		["missing options", "tool_executor.askQuestion", { question: "Q" }],
		[
			"one option",
			"tool_executor.askQuestion",
			{ question: "Q", options: ["A"] },
		],
		[
			"extra request field",
			"tool_executor.askQuestion",
			{ question: "Q", options: ["A", "B"], private: "no" },
		],
	])("rejects %s", (_name, capability, request) => {
		expect(() =>
			reduceManagedRuntimeEvent(
				runtimeEvent({
					kind: "capability.requested",
					runId: "run-1",
					requestId: "request-1",
					capability,
					request,
					expiresAt: "2026-08-17T12:05:00.000Z",
				}),
			),
		).toThrow(InvalidManagedRuntimeEventError);
	});

	it("rejects raw tool or nested prompt fields from a forged typed event", () => {
		expect(() =>
			reduceManagedRuntimeEvent(
				runtimeEvent({
					kind: "tool.finished",
					runId: "run-1",
					toolCallId: "tool-1",
					toolName: "bash",
					status: "completed",
					summary: "safe summary",
					input: { command: "private" },
					output: "private output",
				}),
			),
		).toThrow(InvalidManagedRuntimeEventError);
		expect(() =>
			reduceManagedRuntimeEvent(
				runtimeEvent({
					kind: "pending_prompt.submitted",
					prompt: { ...PROMPT, credential: "private" },
				}),
			),
		).toThrow(InvalidManagedRuntimeEventError);
	});

	it("rejects cyclic or excessively deep event objects before cloning", () => {
		const cyclic = runtimeEvent({
			kind: "usage.updated",
		}) as unknown as Record<string, unknown>;
		cyclic.self = cyclic;
		expect(() =>
			reduceManagedRuntimeEvent(
				cyclic as unknown as ManagedHubChatRuntimeEvent,
			),
		).toThrow(InvalidManagedRuntimeEventError);
	});

	it("rejects malformed envelopes and unknown payload kinds", () => {
		expect(() =>
			reduceManagedRuntimeEvent(
				runtimeEvent(
					{ kind: "assistant.delta", runId: "run-1", text: "x" },
					{ sessionSequence: 0 },
				),
			),
		).toThrow(InvalidManagedRuntimeEventError);
		expect(() =>
			reduceManagedRuntimeEvent(runtimeEvent({ kind: "future.event" })),
		).toThrow(InvalidManagedRuntimeEventError);
	});
});
