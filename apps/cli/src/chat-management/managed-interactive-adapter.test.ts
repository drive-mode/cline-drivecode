import type { ManagedHubChatRuntimeEvent } from "@cline/core";
import { HubChatLifecycleCommandError } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { createChatIdentityFactory } from "./chat-identities";
import {
	createManagedInteractiveChatAdapter,
	ManagedInteractiveAdapterError,
	type ManagedInteractiveClientPort,
	type ManagedInteractiveSessionPort,
} from "./managed-interactive-adapter";
import type { ManagedInteractiveRuntimeEvent } from "./managed-runtime-events";

const PROFILE = Object.freeze({
	profileId: "interactive-default",
	interactive: true,
	mode: "act" as const,
	relativeCwd: "packages/cli",
});

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function fakeSession(sessionId: string, chatId: string) {
	let state: "ready" | "disposed" = "ready";
	let listener:
		| ((event: ManagedHubChatRuntimeEvent) => void | Promise<void>)
		| undefined;
	let sequence = 0;
	const unsubscribe = vi.fn(() => {
		listener = undefined;
	});
	const getSnapshot = vi.fn(
		() =>
			({
				state,
				sessionId,
				chatId,
				leaseRevision: 1,
				profileAuthority: {
					profileId: "interactive-default",
					profileRevision: 1,
					authorityClassId: "interactive",
					policyEpoch: 1,
					allowedModes: ["act"],
				},
				controller: { state },
			}) as unknown as ReturnType<ManagedInteractiveSessionPort["getSnapshot"]>,
	);
	const runTurn = vi.fn(async () => ({ turn: null }));
	const abortRun = vi.fn(
		async (input: { operationId: string; runId: string }) => ({
			sessionId,
			operationId: input.operationId,
			runId: input.runId,
			accepted: true,
		}),
	);
	const respondToApproval = vi.fn(
		async (input: {
			operationId: string;
			runId: string;
			approvalId: string;
			decision: "approve" | "deny";
		}) => ({ sessionId, ...input }),
	);
	const respondToCapability = vi.fn(
		async (input: {
			operationId: string;
			runId: string;
			requestId: string;
		}) => ({
			sessionId,
			operationId: input.operationId,
			runId: input.runId,
			requestId: input.requestId,
			accepted: true,
		}),
	);
	const listPendingPrompts = vi.fn(async () => ({
		sessionId,
		prompts: [],
		hasMore: false,
	}));
	const updatePendingPrompt = vi.fn(async () => ({
		sessionId,
		prompts: [],
		hasMore: false,
		updated: true,
	}));
	const removePendingPrompt = vi.fn(async () => ({
		sessionId,
		prompts: [],
		hasMore: false,
		removed: true,
	}));
	const listMessages = vi.fn(async () => ({
		sessionId,
		messages: [
			{
				messageId: "message-1",
				sequence: 1,
				role: "assistant" as const,
				text: "bounded display text",
				attachments: [],
			},
		],
		hasMore: false,
	}));
	const listCheckpoints = vi.fn(async () => ({
		sessionId,
		checkpoints: [{ createdAt: 1, runCount: 2, kind: "stash" as const }],
	}));
	const getUsage = vi.fn(async () => ({
		sessionId,
		usage: {
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 2,
			cacheWriteTokens: 1,
			totalCost: 0.01,
		},
	}));
	const getCompaction = vi.fn(async () => ({ sessionId, state: null }));
	const runCompaction = vi.fn(async (input: { operationId: string }) => ({
		sessionId,
		operationId: input.operationId,
		outcome: "skipped" as const,
	}));
	const reset = vi.fn(async (_input: { operationId: string }) => {
		state = "disposed";
		return null;
	});
	const stop = vi.fn(async (_input: { operationId: string }) => {
		state = "disposed";
		return { stopped: true as const };
	});
	const disposeAsync = vi.fn(async () => {
		state = "disposed";
	});
	const subscribeRuntimeEvents = vi.fn(
		(next: (event: ManagedHubChatRuntimeEvent) => void | Promise<void>) => {
			listener = next;
			return unsubscribe;
		},
	);

	const port = {
		sessionId,
		chatId,
		getSnapshot,
		runTurn,
		abortRun,
		respondToApproval,
		respondToCapability,
		listPendingPrompts,
		updatePendingPrompt,
		removePendingPrompt,
		listMessages,
		listCheckpoints,
		getUsage,
		getCompaction,
		runCompaction,
		reset,
		stop,
		disposeAsync,
		subscribeRuntimeEvents,
	} as unknown as ManagedInteractiveSessionPort;

	return {
		port,
		getSnapshot,
		runTurn,
		abortRun,
		respondToApproval,
		respondToCapability,
		listPendingPrompts,
		updatePendingPrompt,
		removePendingPrompt,
		listMessages,
		listCheckpoints,
		getUsage,
		getCompaction,
		runCompaction,
		reset,
		stop,
		disposeAsync,
		subscribeRuntimeEvents,
		unsubscribe,
		setState(next: "ready" | "disposed") {
			state = next;
		},
		async emit(
			payload: Record<string, unknown>,
			overrides: Record<string, unknown> = {},
		) {
			if (!listener) throw new Error("runtime observer is not registered");
			sequence += 1;
			await listener({
				version: "v1",
				event: "chat.runtime",
				eventId: `event-${sequence}`,
				streamId: `stream-${sessionId}`,
				sessionId,
				timestamp: sequence,
				processSequence: sequence,
				sessionSequence: sequence,
				...overrides,
				payload,
			} as unknown as ManagedHubChatRuntimeEvent);
		},
	};
}

function harness(
	input: {
		onEvent?: (event: ManagedInteractiveRuntimeEvent) => void | Promise<void>;
		onError?: (error: ManagedInteractiveAdapterError) => void | Promise<void>;
	} = {},
) {
	let nextId = 0;
	const identities = createChatIdentityFactory({
		createId: (prefix) => {
			nextId += 1;
			return `${prefix}${nextId}`;
		},
	});
	const sessions: ReturnType<typeof fakeSession>[] = [];
	const makeSession = (sessionId: string, chatId: string) => {
		const session = fakeSession(sessionId, chatId);
		sessions.push(session);
		return session;
	};
	const startRoot = vi.fn(
		async (action: { sessionId: string; chatId?: string }) =>
			makeSession(action.sessionId, action.chatId ?? "chat-server").port,
	);
	const startRelated = vi.fn(
		async (action: { sessionId: string; chatId: string }) =>
			makeSession(action.sessionId, action.chatId).port,
	);
	const restoreCheckpoint = vi.fn(
		async (action: { sessionId: string; chatId: string }) =>
			makeSession(action.sessionId, action.chatId).port,
	);
	const dispose = vi.fn(async () => {});
	const client = {
		startRoot,
		startRelated,
		restoreCheckpoint,
		dispose,
	} as unknown as ManagedInteractiveClientPort;
	const onEvent = vi.fn(input.onEvent ?? (() => {}));
	const onError = vi.fn(input.onError ?? (() => {}));
	const adapter = createManagedInteractiveChatAdapter({
		client,
		identities,
		onEvent,
		onError,
	});

	async function start() {
		const intent = adapter.operation("start");
		const sessionId = adapter.sessionId();
		const chatId = adapter.chatId();
		const view = await adapter.startRoot({
			intent,
			sessionId,
			chatId,
			start: PROFILE,
			title: "  Managed root  ",
		});
		const session = sessions.at(-1);
		if (!session) throw new Error("managed session was not created");
		return { intent, sessionId, chatId, view, session };
	}

	return {
		adapter,
		client,
		sessions,
		startRoot,
		startRelated,
		restoreCheckpoint,
		dispose,
		onEvent,
		onError,
		start,
	};
}

describe("ManagedInteractiveChatAdapter", () => {
	it("starts one root with exact stable identities and exposes no authority handle", async () => {
		const fixture = harness();
		const started = await fixture.start();

		expect(fixture.startRoot).toHaveBeenCalledWith({
			operationId: started.intent.operationId,
			sessionId: started.sessionId,
			chatId: started.chatId,
			start: PROFILE,
			title: "Managed root",
			titleSource: "owner",
		});
		expect(started.view).toEqual({
			sessionId: started.sessionId,
			chatId: started.chatId,
		});
		expect(Object.isFrozen(started.view)).toBe(true);
		expect(started.session.subscribeRuntimeEvents).toHaveBeenCalledTimes(1);
		expect(fixture.adapter.getSnapshot()).toMatchObject({
			state: "ready",
			session: started.view,
		});
		expect("session" in started.view).toBe(false);
		expect("resume" in fixture.adapter).toBe(false);
		expect("reattach" in fixture.adapter).toBe(false);
		expect("recoverLostLease" in fixture.adapter).toBe(false);
		expect("delete" in fixture.adapter).toBe(false);
		expect(() => fixture.adapter.operation("resume" as never)).toThrow(
			expect.objectContaining({ code: "invalid_action" }),
		);
	});

	it("rejects profile smuggling before managed admission", async () => {
		const fixture = harness();
		await expect(
			fixture.adapter.startRoot({
				intent: fixture.adapter.operation("start"),
				sessionId: fixture.adapter.sessionId(),
				start: {
					...PROFILE,
					credential: "must-not-cross",
				} as never,
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		expect(fixture.startRoot).not.toHaveBeenCalled();
		expect(fixture.adapter.getSnapshot().state).toBe("idle");
	});

	it("retains an unknown root admission as one digest-matched retry", async () => {
		const fixture = harness();
		const intent = fixture.adapter.operation("start");
		const sessionId = fixture.adapter.sessionId();
		const chatId = fixture.adapter.chatId();
		const action = { intent, sessionId, chatId, start: PROFILE };
		fixture.startRoot.mockRejectedValueOnce(
			new Error("raw transport configuration must not escape"),
		);

		await expect(fixture.adapter.startRoot(action)).rejects.toMatchObject({
			code: "operation_unknown",
		});
		await expect(
			fixture.adapter.startRoot({
				...action,
				start: { ...PROFILE, mode: "plan" },
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		const view = await fixture.adapter.startRoot(action);

		expect(view).toEqual({ sessionId, chatId });
		expect(fixture.startRoot).toHaveBeenCalledTimes(2);
	});

	it("rejects oversized prompts, invalid limits, and attachment smuggling before dispatch", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		await expect(
			fixture.adapter.runTurn({
				intent: fixture.adapter.operation("turn"),
				prompt: "x".repeat(256 * 1024 + 1),
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		await expect(
			fixture.adapter.listMessages({ limit: 201 }),
		).rejects.toMatchObject({ code: "invalid_action" });
		await expect(
			fixture.adapter.runTurn({
				intent: fixture.adapter.operation("turn"),
				prompt: "safe",
				attachments: {
					files: [
						{
							name: "safe.txt",
							content: "safe",
							credential: "must-not-cross",
						} as never,
					],
				},
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		expect(session.runTurn).not.toHaveBeenCalled();
		expect(session.listMessages).not.toHaveBeenCalled();
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("correlates one turn and reduces ordered display-safe events", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");

		const result = await fixture.adapter.runTurn({
			intent: turn,
			prompt: "Build it",
			delivery: "queue",
			mode: "act",
		});
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-1",
		});
		await session.emit({
			kind: "assistant.delta",
			runId: "run-1",
			text: "hello",
		});
		await session.emit({ kind: "run.completed", runId: "run-1" });

		expect(session.runTurn).toHaveBeenCalledWith({
			operationId: turn.operationId,
			prompt: "Build it",
			delivery: "queue",
			mode: "act",
		});
		expect(result).toEqual({ turn: null });
		expect(Object.isFrozen(result)).toBe(true);
		expect(fixture.onEvent.mock.calls.map(([event]) => event.kind)).toEqual([
			"run.started",
			"assistant.delta",
			"run.completed",
		]);
		expect(fixture.onEvent.mock.calls[1]?.[0]).not.toHaveProperty("payload");
	});

	it("retains an unknown turn without allowing a changed turn to cross it", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const intent = fixture.adapter.operation("turn");
		const action = { intent, prompt: "one exact turn" };
		session.runTurn.mockRejectedValueOnce(new Error("socket outcome unknown"));

		await expect(fixture.adapter.runTurn(action)).rejects.toMatchObject({
			code: "operation_unknown",
		});
		await expect(
			fixture.adapter.runTurn({
				intent: fixture.adapter.operation("turn"),
				prompt: action.prompt,
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		await fixture.adapter.runTurn(action);
		await session.emit({
			kind: "run.started",
			operationId: intent.operationId,
			runId: "run-retried",
		});
		await session.emit({ kind: "run.completed", runId: "run-retried" });

		expect(session.runTurn).toHaveBeenCalledTimes(2);
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("does not journal an unknown turn after matching run evidence arrived first", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending = deferred<Awaited<ReturnType<typeof session.runTurn>>>();
		session.runTurn.mockReturnValueOnce(pending.promise);
		const intent = fixture.adapter.operation("turn");
		const turn = fixture.adapter.runTurn({
			intent,
			prompt: "evidence before transport settlement",
		});

		await session.emit({
			kind: "run.started",
			operationId: intent.operationId,
			runId: "run-evidence-first",
		});
		pending.reject(new Error("turn reply lost after run evidence"));

		await expect(turn).rejects.toMatchObject({ code: "operation_unknown" });
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
		await session.emit({
			kind: "run.completed",
			runId: "run-evidence-first",
		});
	});

	it("retains one early-abort reason and dispatches only after exact run correlation", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "long work" });
		const abort = fixture.adapter.operation("abort");

		await expect(
			fixture.adapter.abort({ intent: abort, reason: "owner cancelled" }),
		).resolves.toEqual({ kind: "deferred" });
		await expect(
			fixture.adapter.abort({ intent: abort, reason: "changed" }),
		).rejects.toMatchObject({ code: "invalid_action" });
		expect(session.abortRun).not.toHaveBeenCalled();

		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-early",
		});
		expect(session.abortRun).toHaveBeenCalledWith({
			operationId: abort.operationId,
			runId: "run-early",
			reason: "owner cancelled",
		});
	});

	it("delivers run correlation and permits exact retry after an early abort reply is unknown", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "long work" });
		const abort = fixture.adapter.operation("abort");
		await fixture.adapter.abort({ intent: abort, reason: "owner cancelled" });
		session.abortRun.mockRejectedValueOnce(new Error("abort transport lost"));

		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-early-unknown",
		});
		expect(fixture.onEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "run.started",
				runId: "run-early-unknown",
			}),
		);
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
		await expect(
			fixture.adapter.abort({ intent: abort, reason: "owner cancelled" }),
		).resolves.toEqual({ kind: "dispatched", accepted: true });
		expect(session.abortRun).toHaveBeenCalledTimes(2);
	});

	it("returns an authoritative false abort acknowledgement without failing", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "work" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-1",
		});
		session.abortRun.mockImplementationOnce(async (input) => ({
			sessionId: session.port.sessionId,
			operationId: input.operationId,
			runId: input.runId,
			accepted: false,
		}));

		await expect(
			fixture.adapter.abort({ intent: fixture.adapter.operation("abort") }),
		).resolves.toEqual({ kind: "dispatched", accepted: false });
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("retries an unknown abort only with the exact intent and reason", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "work" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-abort-retry",
		});
		const abort = fixture.adapter.operation("abort");
		session.abortRun.mockRejectedValueOnce(new Error("abort reply unknown"));

		await expect(
			fixture.adapter.abort({ intent: abort, reason: "owner stop" }),
		).rejects.toMatchObject({ code: "operation_unknown" });
		await expect(
			fixture.adapter.abort({
				intent: fixture.adapter.operation("abort"),
				reason: "owner stop",
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		await expect(
			fixture.adapter.abort({ intent: abort, reason: "owner stop" }),
		).resolves.toEqual({ kind: "dispatched", accepted: true });

		expect(session.abortRun).toHaveBeenCalledTimes(2);
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("does not journal an unknown abort after run terminal evidence arrived first", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "abort race" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-abort-evidence-first",
		});
		const pending = deferred<Awaited<ReturnType<typeof session.abortRun>>>();
		session.abortRun.mockReturnValueOnce(pending.promise);
		const abort = fixture.adapter.abort({
			intent: fixture.adapter.operation("abort"),
			reason: "terminal race",
		});

		await session.emit({
			kind: "run.aborted",
			runId: "run-abort-evidence-first",
		});
		pending.reject(new Error("abort reply lost after terminal event"));

		await expect(abort).rejects.toMatchObject({ code: "operation_unknown" });
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("responds only to correlated approval and askQuestion requests", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "callbacks" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-1",
		});
		await session.emit({
			kind: "approval.requested",
			runId: "run-1",
			approvalId: "approval-1",
			toolCallId: "tool-1",
			toolName: "bash",
			policy: "owner",
			expiresAt: "2026-08-17T22:05:00.000Z",
		});
		await session.emit({
			kind: "capability.requested",
			runId: "run-1",
			requestId: "question-1",
			capability: "tool_executor.askQuestion",
			request: { question: "Choose", options: ["A", "B"] },
			expiresAt: "2026-08-17T22:05:00.000Z",
		});

		const approval = fixture.adapter.operation("approval");
		await fixture.adapter.respondToApproval({
			intent: approval,
			runId: "run-1",
			approvalId: "approval-1",
			decision: "approve",
		});
		const capability = fixture.adapter.operation("capability");
		await expect(
			fixture.adapter.respondToQuestion({
				intent: capability,
				runId: "run-1",
				requestId: "question-1",
				answer: "A",
			}),
		).resolves.toBe(true);

		expect(session.respondToApproval).toHaveBeenCalledWith({
			operationId: approval.operationId,
			runId: "run-1",
			approvalId: "approval-1",
			decision: "approve",
		});
		expect(session.respondToCapability).toHaveBeenCalledWith({
			operationId: capability.operationId,
			runId: "run-1",
			requestId: "question-1",
			capability: "tool_executor.askQuestion",
			result: { answer: "A" },
		});
		await expect(
			fixture.adapter.respondToApproval({
				intent: fixture.adapter.operation("approval"),
				runId: "run-1",
				approvalId: "unknown",
				decision: "deny",
			}),
		).rejects.toMatchObject({ code: "managed_runtime_correlation_error" });
	});

	it("retains an unknown approval response without permitting a changed decision", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "approval" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-approval",
		});
		await session.emit({
			kind: "approval.requested",
			runId: "run-approval",
			approvalId: "approval-retry",
			toolCallId: "tool-retry",
			toolName: "bash",
			policy: "owner",
			expiresAt: "2026-08-17T22:05:00.000Z",
		});
		const intent = fixture.adapter.operation("approval");
		const action = {
			intent,
			runId: "run-approval",
			approvalId: "approval-retry",
			decision: "approve" as const,
		};
		session.respondToApproval.mockRejectedValueOnce(
			new Error("approval reply unknown"),
		);

		await expect(
			fixture.adapter.respondToApproval(action),
		).rejects.toMatchObject({ code: "operation_unknown" });
		await expect(
			fixture.adapter.respondToApproval({
				...action,
				intent: fixture.adapter.operation("approval"),
				decision: "deny",
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		await fixture.adapter.respondToApproval(action);

		expect(session.respondToApproval).toHaveBeenCalledTimes(2);
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("rejects a late successful approval reply without journaling after resolution evidence", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "approval race" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-approval-race",
		});
		await session.emit({
			kind: "approval.requested",
			runId: "run-approval-race",
			approvalId: "approval-race",
			toolCallId: "tool-race",
			toolName: "bash",
			policy: "owner",
			expiresAt: "2026-08-17T22:05:00.000Z",
		});
		const pending =
			deferred<Awaited<ReturnType<typeof session.respondToApproval>>>();
		session.respondToApproval.mockReturnValueOnce(pending.promise);
		const intent = fixture.adapter.operation("approval");
		const action = {
			intent,
			runId: "run-approval-race",
			approvalId: "approval-race",
			decision: "approve" as const,
		};
		const response = fixture.adapter.respondToApproval(action);
		const rejected = expect(response).rejects.toMatchObject({
			code: "operation_unknown",
		});
		await session.emit({
			kind: "approval.resolved",
			approvalId: "approval-race",
			decision: "approve",
		});
		pending.resolve({
			sessionId: session.port.sessionId,
			operationId: intent.operationId,
			runId: action.runId,
			approvalId: action.approvalId,
			decision: action.decision,
		});
		await rejected;

		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
		await expect(
			fixture.adapter.respondToApproval(action),
		).rejects.toMatchObject({ code: "managed_runtime_correlation_error" });
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
	});

	it("rejects a late successful question reply without journaling after cancellation", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "question race" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-question-race",
		});
		await session.emit({
			kind: "capability.requested",
			runId: "run-question-race",
			requestId: "question-race",
			capability: "tool_executor.askQuestion",
			request: { question: "Choose", options: ["A", "B"] },
			expiresAt: "2026-08-17T22:05:00.000Z",
		});
		const pending =
			deferred<Awaited<ReturnType<typeof session.respondToCapability>>>();
		session.respondToCapability.mockReturnValueOnce(pending.promise);
		const intent = fixture.adapter.operation("capability");
		const action = {
			intent,
			runId: "run-question-race",
			requestId: "question-race",
			answer: "A",
		};
		const response = fixture.adapter.respondToQuestion(action);
		const rejected = expect(response).rejects.toMatchObject({
			code: "operation_unknown",
		});
		await session.emit({
			kind: "capability.cancelled",
			runId: "run-question-race",
			requestId: "question-race",
			capability: "tool_executor.askQuestion",
			reason: "owner cancelled",
		});
		pending.resolve({
			sessionId: session.port.sessionId,
			operationId: intent.operationId,
			runId: action.runId,
			requestId: action.requestId,
			accepted: true,
		});
		await rejected;

		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
		await expect(
			fixture.adapter.respondToQuestion(action),
		).rejects.toMatchObject({ code: "managed_runtime_correlation_error" });
	});

	it("rechecks approval correlation after a same-reaction resolution event", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({
			intent: turn,
			prompt: "approval finalizer",
		});
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-approval-finalizer",
		});
		await session.emit({
			kind: "approval.requested",
			runId: "run-approval-finalizer",
			approvalId: "approval-finalizer",
			toolCallId: "tool-finalizer",
			toolName: "bash",
			policy: "owner",
			expiresAt: "2026-08-17T22:05:00.000Z",
		});
		const pending =
			deferred<Awaited<ReturnType<typeof session.respondToApproval>>>();
		session.respondToApproval.mockReturnValueOnce(pending.promise);
		const intent = fixture.adapter.operation("approval");
		const response = fixture.adapter.respondToApproval({
			intent,
			runId: "run-approval-finalizer",
			approvalId: "approval-finalizer",
			decision: "approve",
		});
		const terminal = pending.promise.then(() =>
			session.emit({
				kind: "approval.resolved",
				approvalId: "approval-finalizer",
				decision: "approve",
			}),
		);
		const rejected = expect(response).rejects.toMatchObject({
			code: "operation_unknown",
		});

		pending.resolve({
			sessionId: session.port.sessionId,
			operationId: intent.operationId,
			runId: "run-approval-finalizer",
			approvalId: "approval-finalizer",
			decision: "approve",
		});

		await rejected;
		await terminal;
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
	});

	it("rechecks question correlation after a same-reaction cancellation event", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({
			intent: turn,
			prompt: "question finalizer",
		});
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-question-finalizer",
		});
		await session.emit({
			kind: "capability.requested",
			runId: "run-question-finalizer",
			requestId: "question-finalizer",
			capability: "tool_executor.askQuestion",
			request: { question: "Choose", options: ["A", "B"] },
			expiresAt: "2026-08-17T22:05:00.000Z",
		});
		const pending =
			deferred<Awaited<ReturnType<typeof session.respondToCapability>>>();
		session.respondToCapability.mockReturnValueOnce(pending.promise);
		const intent = fixture.adapter.operation("capability");
		const response = fixture.adapter.respondToQuestion({
			intent,
			runId: "run-question-finalizer",
			requestId: "question-finalizer",
			answer: "A",
		});
		const terminal = pending.promise.then(() =>
			session.emit({
				kind: "capability.cancelled",
				runId: "run-question-finalizer",
				requestId: "question-finalizer",
				capability: "tool_executor.askQuestion",
				reason: "owner cancelled",
			}),
		);
		const rejected = expect(response).rejects.toMatchObject({
			code: "operation_unknown",
		});

		pending.resolve({
			sessionId: session.port.sessionId,
			operationId: intent.operationId,
			runId: "run-question-finalizer",
			requestId: "question-finalizer",
			accepted: true,
		});

		await rejected;
		await terminal;
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
	});

	it("uses only bounded managed prompt, message, checkpoint, usage, and compaction ports", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const prompts = await fixture.adapter.listPendingPrompts({ limit: 10 });
		const updateIntent = fixture.adapter.operation("pending_prompt_update");
		await fixture.adapter.updatePendingPrompt({
			intent: updateIntent,
			update: { promptId: "prompt-1", prompt: "next", delivery: "queue" },
		});
		const removeIntent = fixture.adapter.operation("pending_prompt_remove");
		await fixture.adapter.removePendingPrompt({
			intent: removeIntent,
			promptId: "prompt-1",
		});
		const messages = await fixture.adapter.listMessages({ limit: 25 });
		const checkpoints = await fixture.adapter.listCheckpoints({ limit: 20 });
		const usage = await fixture.adapter.getUsage();
		const compaction = await fixture.adapter.getCompaction();
		const compactionIntent = fixture.adapter.operation("compaction");
		const compacted = await fixture.adapter.runCompaction({
			intent: compactionIntent,
			reason: "owner requested",
		});

		expect(session.updatePendingPrompt).toHaveBeenCalledWith({
			operationId: updateIntent.operationId,
			promptId: "prompt-1",
			prompt: "next",
			delivery: "queue",
		});
		expect(session.removePendingPrompt).toHaveBeenCalledWith({
			operationId: removeIntent.operationId,
			promptId: "prompt-1",
		});
		expect(session.runCompaction).toHaveBeenCalledWith({
			operationId: compactionIntent.operationId,
			reason: "owner requested",
		});
		for (const value of [
			prompts,
			messages,
			checkpoints,
			usage,
			compaction,
			compacted,
		]) {
			expect(Object.isFrozen(value)).toBe(true);
		}
		expect(Object.isFrozen(messages.messages)).toBe(true);
		expect(messages.messages[0]).not.toHaveProperty("raw");
	});

	it("does not journal unknown compaction after matching terminal evidence arrived first", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending =
			deferred<Awaited<ReturnType<typeof session.runCompaction>>>();
		session.runCompaction.mockReturnValueOnce(pending.promise);
		const intent = fixture.adapter.operation("compaction");
		const compaction = fixture.adapter.runCompaction({
			intent,
			reason: "evidence race",
		});

		await session.emit({
			kind: "compaction.failed",
			operationId: intent.operationId,
			error: "safe terminal failure",
		});
		pending.reject(new Error("compaction reply lost after terminal evidence"));

		await expect(compaction).rejects.toMatchObject({
			code: "operation_unknown",
		});
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			hasMore: false,
		});
	});

	it("creates a revision-bound config_restart successor and retires the predecessor", async () => {
		const fixture = harness();
		const started = await fixture.start();
		const nextSessionId = fixture.adapter.sessionId();
		const intent = fixture.adapter.operation("config_restart");

		const view = await fixture.adapter.configRestart({
			intent,
			sessionId: nextSessionId,
			target: {
				kind: "managed",
				chatId: started.chatId,
				headSessionId: started.sessionId,
				expectedRevision: 4,
				catalogState: "active",
			},
			start: { ...PROFILE, mode: "plan" },
		});

		expect(fixture.startRelated).toHaveBeenCalledWith({
			operationId: intent.operationId,
			sessionId: nextSessionId,
			chatId: started.chatId,
			parentSessionId: started.sessionId,
			relationKind: "config_restart",
			expectedRevision: 4,
			start: { ...PROFILE, mode: "plan" },
		});
		expect(view).toEqual({ sessionId: nextSessionId, chatId: started.chatId });
		expect(started.session.unsubscribe).toHaveBeenCalledTimes(1);
		expect(started.session.stop).toHaveBeenCalledTimes(1);
		expect(started.session.stop.mock.calls[0]?.[0].operationId).toMatch(
			/^cli_chat_stop_/,
		);
	});

	it("rejects a successor when mandatory predecessor cleanup cannot complete", async () => {
		const fixture = harness();
		const started = await fixture.start();
		started.session.stop.mockRejectedValue(new Error("unknown stop outcome"));
		started.session.disposeAsync.mockRejectedValue(new Error("release failed"));

		await expect(
			fixture.adapter.configRestart({
				intent: fixture.adapter.operation("config_restart"),
				sessionId: fixture.adapter.sessionId(),
				target: {
					kind: "managed",
					chatId: started.chatId,
					headSessionId: started.sessionId,
					expectedRevision: 4,
					catalogState: "active",
				},
				start: PROFILE,
			}),
		).rejects.toMatchObject({ code: "cleanup_failed" });

		const successor = fixture.sessions.at(-1);
		if (!successor || successor === started.session) {
			throw new Error("managed successor was not created");
		}
		expect(started.session.stop).toHaveBeenCalledTimes(2);
		expect(started.session.disposeAsync).toHaveBeenCalledTimes(1);
		expect(successor.stop).toHaveBeenCalledTimes(1);
		expect(successor.disposeAsync).toHaveBeenCalledTimes(1);
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await expect(fixture.adapter.dispose()).rejects.toMatchObject({
			code: "cleanup_failed",
		});
	});

	it("creates structural fork and checkpoint-restore branches without transcript input", async () => {
		const forkFixture = harness();
		const root = await forkFixture.start();
		const forkSessionId = forkFixture.adapter.sessionId();
		const forkChatId = forkFixture.adapter.chatId();
		const forkIntent = forkFixture.adapter.operation("fork");
		await forkFixture.adapter.fork({
			intent: forkIntent,
			sessionId: forkSessionId,
			chatId: forkChatId,
			start: PROFILE,
			title: "Branch",
		});
		expect(forkFixture.startRelated).toHaveBeenCalledWith({
			operationId: forkIntent.operationId,
			sessionId: forkSessionId,
			chatId: forkChatId,
			parentSessionId: root.sessionId,
			relationKind: "fork",
			start: PROFILE,
			title: "Branch",
			titleSource: "owner",
		});
		expect(forkFixture.startRelated.mock.calls[0]?.[0]).not.toHaveProperty(
			"messages",
		);

		const restoreFixture = harness();
		const source = await restoreFixture.start();
		const restoreSessionId = restoreFixture.adapter.sessionId();
		const restoreChatId = restoreFixture.adapter.chatId();
		const restoreIntent = restoreFixture.adapter.operation("restore");
		await restoreFixture.adapter.restoreCheckpoint({
			intent: restoreIntent,
			sessionId: restoreSessionId,
			chatId: restoreChatId,
			start: PROFILE,
			checkpointRunCount: 7,
			restore: { workspace: true, messages: true },
		});
		expect(restoreFixture.restoreCheckpoint).toHaveBeenCalledWith({
			operationId: restoreIntent.operationId,
			sessionId: restoreSessionId,
			chatId: restoreChatId,
			parentSessionId: source.sessionId,
			checkpointRunCount: 7,
			start: PROFILE,
			restore: { messages: true, workspace: true },
		});
		expect(
			restoreFixture.restoreCheckpoint.mock.calls[0]?.[0],
		).not.toHaveProperty("initialMessages");
	});

	it("rejects structural transition while a run or callback is active", async () => {
		const fixture = harness();
		await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "busy" });

		await expect(
			fixture.adapter.fork({
				intent: fixture.adapter.operation("fork"),
				sessionId: fixture.adapter.sessionId(),
				chatId: fixture.adapter.chatId(),
				start: PROFILE,
			}),
		).rejects.toMatchObject({ code: "invalid_state" });
		expect(fixture.startRelated).not.toHaveBeenCalled();
	});

	it("stops and releases a stale admission resolved after disposal", async () => {
		const fixture = harness();
		const admission = deferred<ManagedInteractiveSessionPort>();
		fixture.startRoot.mockReturnValueOnce(admission.promise);
		const stale = fakeSession("session-stale", "chat-stale");
		const startPromise = fixture.adapter.startRoot({
			intent: fixture.adapter.operation("start"),
			sessionId: "session-stale" as never,
			chatId: "chat-stale" as never,
			start: PROFILE,
		});
		const rejected = expect(startPromise).rejects.toMatchObject({
			code: "disposed",
		});
		const disposing = fixture.adapter.dispose();
		admission.resolve(stale.port);

		await rejected;
		await disposing;
		expect(stale.stop).toHaveBeenCalledTimes(1);
		expect(stale.disposeAsync).toHaveBeenCalledTimes(1);
		expect(stale.subscribeRuntimeEvents).not.toHaveBeenCalled();
		expect(fixture.dispose).toHaveBeenCalledTimes(1);
		expect(fixture.adapter.getSnapshot().state).toBe("disposed");
	});

	it("blocks structural changes during an in-flight read and fences its late result", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending =
			deferred<Awaited<ReturnType<typeof session.listMessages>>>();
		session.listMessages.mockReturnValueOnce(pending.promise);
		const read = fixture.adapter.listMessages();

		await expect(
			fixture.adapter.fork({
				intent: fixture.adapter.operation("fork"),
				sessionId: fixture.adapter.sessionId(),
				chatId: fixture.adapter.chatId(),
				start: PROFILE,
			}),
		).rejects.toMatchObject({ code: "invalid_state" });
		expect(fixture.startRelated).not.toHaveBeenCalled();

		const lateRead = expect(read).rejects.toMatchObject({ code: "disposed" });
		const disposing = fixture.adapter.dispose();
		expect(session.unsubscribe).toHaveBeenCalledTimes(1);
		pending.resolve({
			sessionId: session.port.sessionId,
			messages: [],
			hasMore: false,
		});
		await lateRead;
		await disposing;
	});

	it("keeps the read lease through parsing when disposal shares the dependency reaction", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending =
			deferred<Awaited<ReturnType<typeof session.listMessages>>>();
		session.listMessages.mockReturnValueOnce(pending.promise);
		const read = fixture.adapter.listMessages();
		const disposing = pending.promise.then(() => fixture.adapter.dispose());

		pending.resolve({
			sessionId: session.port.sessionId,
			messages: [],
			hasMore: false,
		});

		await expect(read).rejects.toMatchObject({ code: "disposed" });
		await disposing;
	});

	it("keeps the read lease through parsing against a same-reaction transition", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending =
			deferred<Awaited<ReturnType<typeof session.listMessages>>>();
		session.listMessages.mockReturnValueOnce(pending.promise);
		const read = fixture.adapter.listMessages();
		const transition = pending.promise.then(() =>
			fixture.adapter.fork({
				intent: fixture.adapter.operation("fork"),
				sessionId: fixture.adapter.sessionId(),
				chatId: fixture.adapter.chatId(),
				start: PROFILE,
			}),
		);
		const blocked = expect(transition).rejects.toMatchObject({
			code: "invalid_state",
		});

		pending.resolve({
			sessionId: session.port.sessionId,
			messages: [],
			hasMore: false,
		});

		await blocked;
		await expect(read).resolves.toMatchObject({ hasMore: false });
		expect(fixture.startRelated).not.toHaveBeenCalled();
	});

	it("installs the transition barrier before replay can dispose reentrantly", async () => {
		let fixture!: ReturnType<typeof harness>;
		let disposing: Promise<void> | undefined;
		fixture = harness({
			onEvent: () => {
				disposing = fixture.adapter.dispose();
			},
		});
		const intent = fixture.adapter.operation("start");
		const sessionId = fixture.adapter.sessionId();
		const chatId = fixture.adapter.chatId();
		const reentrant = fakeSession(sessionId, chatId);
		reentrant.subscribeRuntimeEvents.mockImplementationOnce((listener) => {
			void listener({
				version: "v1",
				event: "chat.runtime",
				eventId: "event-replay",
				streamId: "stream-replay",
				sessionId,
				timestamp: 1,
				processSequence: 1,
				sessionSequence: 1,
				payload: { kind: "usage.updated" },
			} as ManagedHubChatRuntimeEvent);
			return reentrant.unsubscribe;
		});
		fixture.startRoot.mockResolvedValueOnce(reentrant.port);

		await expect(
			fixture.adapter.startRoot({
				intent,
				sessionId,
				chatId,
				start: PROFILE,
			}),
		).rejects.toMatchObject({ code: "disposed" });
		expect(disposing).toBeDefined();
		await disposing;
		expect(reentrant.unsubscribe).toHaveBeenCalledTimes(1);
		expect(reentrant.stop).toHaveBeenCalledTimes(1);
		expect(reentrant.disposeAsync).toHaveBeenCalledTimes(1);
		expect(fixture.dispose).toHaveBeenCalledTimes(1);
	});

	it("fails closed and cleans a malformed successor handle", async () => {
		const fixture = harness();
		const existing = await fixture.start();
		const malformed = fakeSession("wrong-session", "wrong-chat");
		fixture.startRelated.mockResolvedValueOnce(malformed.port);

		await expect(
			fixture.adapter.fork({
				intent: fixture.adapter.operation("fork"),
				sessionId: fixture.adapter.sessionId(),
				chatId: fixture.adapter.chatId(),
				start: PROFILE,
			}),
		).rejects.toMatchObject({ code: "invalid_result" });
		expect(malformed.stop).toHaveBeenCalledTimes(1);
		expect(malformed.disposeAsync).toHaveBeenCalledTimes(1);
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await fixture.adapter.dispose();
		expect(existing.session.unsubscribe).toHaveBeenCalledTimes(1);
		expect(existing.session.stop).toHaveBeenCalledTimes(1);
		expect(existing.session.disposeAsync).toHaveBeenCalledTimes(1);
		expect(fixture.dispose).toHaveBeenCalledTimes(1);
	});

	it("fails closed on cross-run output and contains app callback rejection", async () => {
		const callbackFixture = harness({
			onEvent: async () => {
				throw new Error("UI failed");
			},
		});
		const callbackStarted = await callbackFixture.start();
		await callbackStarted.session.emit({ kind: "usage.updated" });
		expect(callbackFixture.adapter.getSnapshot().state).toBe("ready");
		expect(callbackFixture.onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "failed" }),
		);

		const fixture = harness();
		const { session } = await fixture.start();
		const turn = fixture.adapter.operation("turn");
		await fixture.adapter.runTurn({ intent: turn, prompt: "work" });
		await session.emit({
			kind: "run.started",
			operationId: turn.operationId,
			runId: "run-1",
		});
		await session.emit({
			kind: "assistant.delta",
			runId: "run-other",
			text: "reject",
		});
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		expect(fixture.onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "failed" }),
		);
		await fixture.adapter.dispose();
	});

	it("fails closed before delivering a duplicate or gapped event sequence", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		await session.emit({ kind: "usage.updated" });
		await session.emit({ kind: "usage.updated" }, { sessionSequence: 1 });

		expect(fixture.onEvent).toHaveBeenCalledTimes(1);
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await fixture.adapter.dispose();
	});

	it("retains an unknown reset as one exact retry and never exposes its raw error", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const reset = fixture.adapter.operation("reset");
		session.reset.mockRejectedValueOnce(new Error("strict rejection"));

		await expect(
			fixture.adapter.reset({ intent: reset }),
		).rejects.toMatchObject({
			code: "operation_unknown",
		});
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
		await expect(
			fixture.adapter.reset({ intent: fixture.adapter.operation("reset") }),
		).rejects.toMatchObject({ code: "invalid_action" });
		await fixture.adapter.reset({ intent: reset });
		expect(session.reset).toHaveBeenNthCalledWith(1, {
			operationId: reset.operationId,
		});
		expect(session.reset).toHaveBeenNthCalledWith(2, {
			operationId: reset.operationId,
		});
		expect(fixture.adapter.getSnapshot().state).toBe("idle");
	});

	it("does not accept stop as an exact retry of an unknown reset", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const reset = fixture.adapter.operation("reset");
		session.reset.mockRejectedValueOnce(new Error("reset outcome unknown"));

		await expect(
			fixture.adapter.reset({ intent: reset }),
		).rejects.toMatchObject({ code: "operation_unknown" });
		await expect(
			fixture.adapter.stop({
				intent: Object.freeze({
					kind: "stop" as const,
					operationId: reset.operationId,
				}),
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		expect(session.stop).not.toHaveBeenCalled();

		await fixture.adapter.reset({ intent: reset });
		expect(fixture.adapter.getSnapshot().state).toBe("idle");
	});

	it("does not accept reset as an exact retry of an unknown stop", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const stop = fixture.adapter.operation("stop");
		session.stop.mockRejectedValueOnce(new Error("stop outcome unknown"));

		await expect(fixture.adapter.stop({ intent: stop })).rejects.toMatchObject({
			code: "operation_unknown",
		});
		await expect(
			fixture.adapter.reset({
				intent: Object.freeze({
					kind: "reset" as const,
					operationId: stop.operationId,
				}),
			}),
		).rejects.toMatchObject({ code: "invalid_action" });
		expect(session.reset).not.toHaveBeenCalled();

		await fixture.adapter.stop({ intent: stop });
		expect(fixture.adapter.getSnapshot().state).toBe("idle");
	});

	it("sanitizes an authoritative rejection without retaining a retry lock", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		session.reset.mockRejectedValueOnce(
			new HubChatLifecycleCommandError(
				"chat_lifecycle.reset",
				"private_server_code",
			),
		);

		await expect(
			fixture.adapter.reset({ intent: fixture.adapter.operation("reset") }),
		).rejects.toMatchObject({ code: "operation_rejected" });
		await fixture.adapter.reset({ intent: fixture.adapter.operation("reset") });

		expect(session.reset).toHaveBeenCalledTimes(2);
		expect(fixture.adapter.getSnapshot().state).toBe("idle");
	});

	it("fails the context on a malformed resolved reset result", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		session.reset.mockResolvedValueOnce({ unexpected: true } as never);

		await expect(
			fixture.adapter.reset({ intent: fixture.adapter.operation("reset") }),
		).rejects.toMatchObject({ code: "invalid_result" });
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await expect(
			fixture.adapter.reset({ intent: fixture.adapter.operation("reset") }),
		).rejects.toMatchObject({ code: "invalid_state" });
		await fixture.adapter.dispose();
	});

	it("fails the context on a malformed resolved stop result", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		session.stop.mockResolvedValueOnce({ stopped: false } as never);

		await expect(
			fixture.adapter.stop({ intent: fixture.adapter.operation("stop") }),
		).rejects.toMatchObject({ code: "invalid_result" });
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await expect(
			fixture.adapter.stop({ intent: fixture.adapter.operation("stop") }),
		).rejects.toMatchObject({ code: "invalid_state" });
		await fixture.adapter.dispose();
	});

	it("does not report reset success after same-reaction disposal", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending = deferred<Awaited<ReturnType<typeof session.reset>>>();
		session.reset.mockReturnValueOnce(pending.promise);
		const reset = fixture.adapter.reset({
			intent: fixture.adapter.operation("reset"),
		});
		const disposing = pending.promise.then(() => fixture.adapter.dispose());
		const rejected = expect(reset).rejects.toMatchObject({ code: "disposed" });

		pending.resolve(null);

		await rejected;
		await disposing;
	});

	it("does not report stop success after same-reaction disposal", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const pending = deferred<Awaited<ReturnType<typeof session.stop>>>();
		session.stop.mockReturnValueOnce(pending.promise);
		const stop = fixture.adapter.stop({
			intent: fixture.adapter.operation("stop"),
		});
		const disposing = pending.promise.then(() => fixture.adapter.dispose());
		const rejected = expect(stop).rejects.toMatchObject({ code: "disposed" });

		pending.resolve({ stopped: true });

		await rejected;
		await disposing;
	});

	it("returns frozen bounded reads and fails on a mismatched session result", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		session.listMessages.mockResolvedValueOnce({
			sessionId: "session-other",
			messages: [],
			hasMore: false,
		});

		await expect(fixture.adapter.listMessages()).rejects.toMatchObject({
			code: "invalid_result",
		});
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await fixture.adapter.dispose();
	});

	it("sanitizes a read dependency failure and permits a fresh read", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		session.listMessages.mockRejectedValueOnce(
			new Error("/private/path credential=secret"),
		);

		await expect(fixture.adapter.listMessages()).rejects.toMatchObject({
			code: "dependency_failed",
		});
		await expect(fixture.adapter.listMessages()).resolves.toMatchObject({
			sessionId: session.port.sessionId,
			hasMore: false,
		});
		expect(fixture.adapter.getSnapshot().state).toBe("ready");
	});

	it("rejects unknown nested or top-level result fields instead of freezing them", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		session.listMessages.mockResolvedValueOnce({
			sessionId: session.port.sessionId,
			messages: [],
			hasMore: false,
			rawProviderMessages: [{ credential: "private" }],
		} as never);

		await expect(fixture.adapter.listMessages()).rejects.toMatchObject({
			code: "invalid_result",
		});
		expect(fixture.adapter.getSnapshot().state).toBe("failed");
		await fixture.adapter.dispose();
	});

	it("stops, disposes, and shuts down idempotently without local fallback", async () => {
		const fixture = harness();
		const { session } = await fixture.start();
		const stop = fixture.adapter.operation("stop");
		await fixture.adapter.shutdown({ intent: stop });
		await fixture.adapter.dispose();

		expect(session.stop).toHaveBeenCalledWith({
			operationId: stop.operationId,
		});
		expect(fixture.dispose).toHaveBeenCalledTimes(1);
		expect(fixture.adapter.getSnapshot().state).toBe("disposed");
		expect(() => fixture.adapter.operation("turn")).toThrow(
			ManagedInteractiveAdapterError,
		);
	});

	it("sanitizes a client disposal failure", async () => {
		const fixture = harness();
		await fixture.start();
		fixture.dispose.mockRejectedValueOnce(
			new Error("raw transport configuration must not escape"),
		);

		await expect(fixture.adapter.dispose()).rejects.toMatchObject({
			code: "dependency_failed",
		});
		expect(fixture.adapter.getSnapshot().state).toBe("disposed");
	});
});
