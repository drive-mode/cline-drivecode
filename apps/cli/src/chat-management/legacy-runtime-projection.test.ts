import {
	HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS,
	HUB_CHAT_RUNTIME_RESULT_SCHEMAS,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	InvalidLegacyRuntimeProjectionError,
	projectLegacyCheckpointPage,
	projectLegacyCompactionResult,
	projectLegacyCompactionSnapshot,
	projectLegacyPendingPromptMutation,
	projectLegacyPendingPromptPage,
	projectLegacyTurnResult,
	projectLegacyUsageSnapshot,
} from "./legacy-runtime-projection";

const sessionId = "session-legacy";

function compactionState() {
	return {
		version: 1,
		updated_at: "2026-08-18T00:00:00.000Z",
		conversation_id: "SECRET_CONVERSATION_ID",
		source_message_count: 9,
		messages: [{ secret: "SECRET_COMPACTED_MESSAGE" }],
		system_prompt: "SECRET_SYSTEM_PROMPT",
	};
}

function turnResult(overrides: Record<string, unknown> = {}) {
	return {
		text: "done",
		usage: { inputTokens: 1, outputTokens: 2, totalCost: 0.01 },
		messages: [{ secret: "SECRET_CANONICAL_MESSAGE" }],
		toolCalls: [{ input: "SECRET_TOOL_INPUT", output: "SECRET_TOOL_OUTPUT" }],
		iterations: 2,
		finishReason: "completed",
		model: { id: "model-1", provider: "provider-1" },
		startedAt: new Date("2026-08-18T00:00:00.000Z"),
		endedAt: new Date("2026-08-18T00:00:01.000Z"),
		durationMs: 1_000,
		...overrides,
	};
}

describe("Legacy runtime projections", () => {
	it("projects one authoritative bounded pending-prompt snapshot", () => {
		const prompts = Array.from({ length: 3 }, (_, index) => ({
			id: `prompt-${index}`,
			prompt: `prompt ${index}`,
			delivery: index % 2 === 0 ? "queue" : "steer",
			mode: index === 0 ? "plan" : undefined,
			userImages: ["SECRET_IMAGE_DATA"],
			userFiles: ["/SECRET_FILE_PATH"],
		}));
		const page = projectLegacyPendingPromptPage({
			sessionId,
			prompts,
		});

		expect(page).toMatchObject({
			sessionId,
			hasMore: false,
		});
		expect(page.nextCursor).toBeUndefined();
		expect(page.prompts).toHaveLength(3);
		expect(page.prompts[0]).toEqual({
			promptId: "prompt-0",
			prompt: "prompt 0",
			delivery: "queue",
			mode: "plan",
			attachments: [{ kind: "image" }, { kind: "file" }],
		});
		expect(JSON.stringify(page)).not.toContain("SECRET");
		expect(Object.isFrozen(page)).toBe(true);
		expect(Object.isFrozen(page.prompts)).toBe(true);
		expect(() =>
			HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
				"chat_runtime.pending_prompts.list"
			].parse(page),
		).not.toThrow();
	});

	it("rejects pending-prompt snapshots that require mutable offset paging", () => {
		const tooMany = Array.from({ length: 21 }, (_, index) => ({
			id: `prompt-${index}`,
			prompt: "safe",
			delivery: "queue",
		}));
		const tooLarge = Array.from({ length: 17 }, (_, index) => ({
			id: `prompt-${index}`,
			prompt: "x".repeat(32 * 1024),
			delivery: "queue",
		}));

		for (const prompts of [tooMany, tooLarge]) {
			expect(() =>
				projectLegacyPendingPromptPage({ sessionId, prompts }),
			).toThrow(InvalidLegacyRuntimeProjectionError);
		}
	});

	it("projects prompt mutation state without retaining raw attachments", () => {
		const result = projectLegacyPendingPromptMutation({
			kind: "remove",
			sessionId,
			result: {
				sessionId,
				prompts: [],
				prompt: {
					id: "prompt-1",
					prompt: "safe",
					delivery: "queue",
					userFiles: ["/SECRET_PATH"],
				},
				removed: true,
			},
		});

		expect(result).toMatchObject({
			sessionId,
			prompts: [],
			prompt: {
				promptId: "prompt-1",
				attachments: [{ kind: "file" }],
			},
			removed: true,
		});
		expect(JSON.stringify(result)).not.toContain("SECRET");
	});

	it("drops checkpoint refs and returns only the requested bounded tail", () => {
		const result = projectLegacyCheckpointPage({
			sessionId,
			limit: 2,
			checkpoints: [
				{ ref: "SECRET_REF_1", createdAt: 1, runCount: 1, kind: "stash" },
				{ ref: "SECRET_REF_2", createdAt: 2, runCount: 2 },
				{ ref: "SECRET_REF_3", createdAt: 3, runCount: 3, kind: "commit" },
			],
		});

		expect(result.checkpoints).toEqual([
			{ createdAt: 2, runCount: 2 },
			{ createdAt: 3, runCount: 3, kind: "commit" },
		]);
		expect(JSON.stringify(result)).not.toContain("SECRET_REF");
	});

	it("preserves direct and aggregate usage as distinct frozen snapshots", () => {
		const result = projectLegacyUsageSnapshot({
			sessionId,
			summary: {
				usage: { inputTokens: 1, outputTokens: 2 },
				aggregateUsage: {
					inputTokens: 10,
					outputTokens: 20,
					cacheReadTokens: 3,
					cacheWriteTokens: 4,
					totalCost: 0.5,
				},
			},
		});

		expect(result.usage).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		});
		expect(result.aggregateUsage?.totalCost).toBe(0.5);
		expect(Object.isFrozen(result.usage)).toBe(true);
		expect(Object.isFrozen(result.aggregateUsage)).toBe(true);
	});

	it("projects compaction state and receipts without canonical messages", () => {
		const snapshot = projectLegacyCompactionSnapshot({
			sessionId,
			state: compactionState(),
		});
		const completed = projectLegacyCompactionResult({
			sessionId,
			operationId: "compaction-1",
			compacted: true,
			state: compactionState(),
		});
		const skipped = projectLegacyCompactionResult({
			sessionId,
			operationId: "compaction-2",
			compacted: false,
			state: undefined,
		});

		expect(snapshot.state).toEqual({
			version: 1,
			updatedAt: "2026-08-18T00:00:00.000Z",
			sourceMessageCount: 9,
			compactedMessageCount: 1,
		});
		expect(completed).toMatchObject({
			outcome: "completed",
			state: snapshot.state,
		});
		expect(skipped).toEqual({
			sessionId,
			operationId: "compaction-2",
			outcome: "skipped",
		});
		for (const value of [snapshot, completed, skipped]) {
			expect(JSON.stringify(value)).not.toContain("SECRET");
		}
	});

	it("projects turn summaries and context without messages or tool calls", () => {
		const result = projectLegacyTurnResult({
			result: turnResult(),
			contextTokens: 42,
		});

		expect(result).toMatchObject({
			turn: {
				text: "done",
				usage: {
					inputTokens: 1,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.01,
				},
				iterations: 2,
				finishReason: "completed",
				model: { id: "model-1", provider: "provider-1" },
				startedAt: "2026-08-18T00:00:00.000Z",
				endedAt: "2026-08-18T00:00:01.000Z",
				durationMs: 1_000,
			},
			context: { kind: "available", tokens: 42 },
		});
		expect(JSON.stringify(result)).not.toContain("SECRET");
		expect(() =>
			HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS["chat_lifecycle.run_turn"].parse({
				turn: result.turn,
			}),
		).not.toThrow();
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.turn)).toBe(true);
	});

	it("uses finish-reason-specific safe text and represents queued turns", () => {
		const failed = projectLegacyTurnResult({
			result: turnResult({
				finishReason: "error",
				text: "SECRET_PROVIDER_ERROR",
			}),
			contextTokens: undefined,
		});
		const queued = projectLegacyTurnResult({
			result: undefined,
			contextTokens: undefined,
		});
		const aborted = projectLegacyTurnResult({
			result: turnResult({
				finishReason: "aborted",
				text: "SECRET_ABORT_DETAIL",
			}),
			contextTokens: undefined,
		});
		const maxIterations = projectLegacyTurnResult({
			result: turnResult({
				finishReason: "max_iterations",
				text: "SECRET_LIMIT_DETAIL",
			}),
			contextTokens: undefined,
		});
		const mistakeLimit = projectLegacyTurnResult({
			result: turnResult({
				finishReason: "mistake_limit",
				text: "SECRET_MISTAKE_DETAIL",
			}),
			contextTokens: undefined,
		});

		expect(failed.turn?.text).toBe("Legacy run failed.");
		expect(JSON.stringify(failed)).not.toContain("SECRET_PROVIDER_ERROR");
		expect(aborted.turn?.text).toBe("Legacy run aborted.");
		expect(maxIterations.turn?.text).toBe(
			"Legacy run reached its iteration limit.",
		);
		expect(mistakeLimit.turn?.text).toBe(
			"Legacy run stopped after repeated mistakes.",
		);
		expect(
			JSON.stringify([aborted, maxIterations, mistakeLimit]),
		).not.toContain("SECRET_");
		expect(queued).toEqual({
			turn: null,
			context: { kind: "unavailable" },
		});
	});

	it("rejects unknown or near-match finish reasons", () => {
		for (const finishReason of ["provider_error", "error ", "COMPLETED"]) {
			expect(() =>
				projectLegacyTurnResult({
					result: turnResult({ finishReason, text: "SECRET_ERROR_DETAIL" }),
					contextTokens: undefined,
				}),
			).toThrow(InvalidLegacyRuntimeProjectionError);
		}
	});

	it("bounds identifiers and timestamp strings before normalization or parsing", () => {
		const parse = vi.spyOn(Date, "parse");
		try {
			expect(() =>
				projectLegacyPendingPromptPage({
					sessionId,
					prompts: [
						{
							id: " ".repeat(2 * 1024 * 1024),
							prompt: "safe",
							delivery: "queue",
						},
					],
				}),
			).toThrow(InvalidLegacyRuntimeProjectionError);
			expect(() =>
				projectLegacyTurnResult({
					result: turnResult({
						startedAt: "2".repeat(2 * 1024 * 1024),
					}),
					contextTokens: undefined,
				}),
			).toThrow(InvalidLegacyRuntimeProjectionError);
			expect(parse).not.toHaveBeenCalled();
		} finally {
			parse.mockRestore();
		}
	});

	it("rejects accessors and malformed state with one fixed non-secret error", () => {
		let getterCalls = 0;
		const summary = {} as Record<string, unknown>;
		Object.defineProperty(summary, "usage", {
			get() {
				getterCalls += 1;
				return { inputTokens: 1, secret: "SECRET_GETTER" };
			},
		});

		for (const action of [
			() => projectLegacyUsageSnapshot({ sessionId, summary }),
			() =>
				projectLegacyCheckpointPage({
					sessionId,
					checkpoints: [{ ref: "SECRET_REF", createdAt: -1, runCount: 1 }],
				}),
			() =>
				projectLegacyCompactionResult({
					sessionId,
					operationId: "compaction-1",
					compacted: true,
					state: undefined,
				}),
		]) {
			let caught: unknown;
			try {
				action();
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(InvalidLegacyRuntimeProjectionError);
			expect(caught).toMatchObject({
				code: "invalid_legacy_runtime_projection",
				message:
					"Legacy runtime state cannot be projected for the interactive app.",
			});
			expect(String(caught)).not.toContain("SECRET");
		}
		expect(getterCalls).toBe(0);
	});
});
