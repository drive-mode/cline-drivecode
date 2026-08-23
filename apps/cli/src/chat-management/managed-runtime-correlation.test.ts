import { describe, expect, it } from "vitest";
import { createChatIdentityFactory } from "./chat-identities";
import {
	ManagedRuntimeCorrelation,
	ManagedRuntimeCorrelationError,
} from "./managed-runtime-correlation";
import type { ManagedInteractiveRuntimeEvent } from "./managed-runtime-events";

function event(data: Record<string, unknown>): ManagedInteractiveRuntimeEvent {
	return {
		eventId: `event-${String(data.kind)}`,
		sessionId: "session-1",
		sequenceStart: 1,
		sequenceEnd: 1,
		timestamp: 100,
		...data,
	} as unknown as ManagedInteractiveRuntimeEvent;
}

function harness() {
	let nextId = 0;
	const identities = createChatIdentityFactory({
		createId: (prefix) => {
			nextId += 1;
			return `${prefix}${nextId}`;
		},
	});
	return {
		correlation: new ManagedRuntimeCorrelation("session-1"),
		identities,
	};
}

describe("ManagedRuntimeCorrelation", () => {
	it("defers an early abort and emits it immediately after exact run correlation", () => {
		const { correlation, identities } = harness();
		const turn = identities.operation("turn");
		const abort = identities.operation("abort");
		correlation.beginTurn(turn);

		expect(correlation.requestAbort(abort)).toEqual({ kind: "deferred" });
		const effects = correlation.accept(
			event({
				kind: "run.started",
				operationId: turn.operationId,
				runId: "run-1",
			}),
		);

		expect(effects).toEqual([{ kind: "abort", intent: abort, runId: "run-1" }]);
		expect(correlation.getSnapshot().turn).toMatchObject({
			runId: "run-1",
			abortPending: false,
			abortDispatched: true,
		});
	});

	it("dispatches a post-correlation abort once and rejects changed intent", () => {
		const { correlation, identities } = harness();
		const turn = identities.operation("turn");
		const abort = identities.operation("abort");
		correlation.beginTurn(turn);
		correlation.accept(
			event({
				kind: "run.started",
				operationId: turn.operationId,
				runId: "run-1",
			}),
		);

		expect(correlation.requestAbort(abort)).toEqual({
			kind: "dispatch",
			effect: { kind: "abort", intent: abort, runId: "run-1" },
		});
		expect(correlation.requestAbort(abort)).toEqual({
			kind: "already_dispatched",
		});
		expect(() =>
			correlation.requestAbort(identities.operation("abort")),
		).toThrow(ManagedRuntimeCorrelationError);
	});

	it("accepts output only for the exactly correlated run and clears on terminal", () => {
		const { correlation, identities } = harness();
		const turn = identities.operation("turn");
		correlation.beginTurn(turn);
		correlation.accept(
			event({
				kind: "run.started",
				operationId: turn.operationId,
				runId: "run-1",
			}),
		);

		expect(() =>
			correlation.accept(
				event({ kind: "assistant.delta", runId: "run-1", text: "safe" }),
			),
		).not.toThrow();
		expect(() =>
			correlation.accept(
				event({ kind: "assistant.delta", runId: "run-other", text: "no" }),
			),
		).toThrow(ManagedRuntimeCorrelationError);

		correlation.accept(event({ kind: "run.completed", runId: "run-1" }));
		expect(correlation.getSnapshot().turn).toBeUndefined();
	});

	it("rejects a run start owned by another turn operation", () => {
		const { correlation, identities } = harness();
		correlation.beginTurn(identities.operation("turn"));

		expect(() =>
			correlation.accept(
				event({
					kind: "run.started",
					operationId: "turn-other",
					runId: "run-1",
				}),
			),
		).toThrow(ManagedRuntimeCorrelationError);
	});

	it("rejects malformed imported session and operation identities", () => {
		expect(() => new ManagedRuntimeCorrelation("../session")).toThrow(
			ManagedRuntimeCorrelationError,
		);
		const correlation = new ManagedRuntimeCorrelation("session-1");
		expect(() =>
			correlation.beginTurn({
				kind: "turn",
				operationId: " padded",
			} as never),
		).toThrow(ManagedRuntimeCorrelationError);
	});

	it("rejects an event scoped to another managed session", () => {
		const { correlation } = harness();

		expect(() =>
			correlation.accept(
				event({ kind: "usage.updated", sessionId: "session-other" }),
			),
		).toThrow(ManagedRuntimeCorrelationError);
	});

	it("cancels only an unstarted exact turn intent", () => {
		const { correlation, identities } = harness();
		const turn = identities.operation("turn");
		correlation.beginTurn(turn);

		expect(() => correlation.cancelTurn(identities.operation("turn"))).toThrow(
			ManagedRuntimeCorrelationError,
		);
		correlation.cancelTurn(turn);
		expect(correlation.getSnapshot().turn).toBeUndefined();
	});

	it("tracks approval and question correlation without exposing authority", () => {
		const { correlation, identities } = harness();
		const turn = identities.operation("turn");
		correlation.beginTurn(turn);
		correlation.accept(
			event({
				kind: "run.started",
				operationId: turn.operationId,
				runId: "run-1",
			}),
		);
		correlation.accept(
			event({
				kind: "approval.requested",
				runId: "run-1",
				approvalId: "approval-1",
			}),
		);
		correlation.accept(
			event({
				kind: "question.requested",
				runId: "run-1",
				requestId: "question-1",
			}),
		);

		expect(() =>
			correlation.assertApproval("run-1", "approval-1"),
		).not.toThrow();
		expect(() =>
			correlation.assertQuestion("run-1", "question-1"),
		).not.toThrow();
		expect(() => correlation.assertApproval("run-other", "approval-1")).toThrow(
			ManagedRuntimeCorrelationError,
		);

		correlation.accept(
			event({ kind: "approval.resolved", approvalId: "approval-1" }),
		);
		correlation.accept(
			event({
				kind: "question.cancelled",
				runId: "run-1",
				requestId: "question-1",
			}),
		);
		expect(correlation.getSnapshot()).toMatchObject({
			pendingApprovalIds: [],
			pendingQuestionIds: [],
		});
	});

	it("rejects duplicate, unknown, and over-capacity callbacks", () => {
		const { correlation, identities } = harness();
		const turn = identities.operation("turn");
		correlation.beginTurn(turn);
		correlation.accept(
			event({
				kind: "run.started",
				operationId: turn.operationId,
				runId: "run-1",
			}),
		);
		correlation.accept(
			event({
				kind: "approval.requested",
				runId: "run-1",
				approvalId: "approval-0",
			}),
		);
		expect(() =>
			correlation.accept(
				event({
					kind: "approval.requested",
					runId: "run-1",
					approvalId: "approval-0",
				}),
			),
		).toThrow(ManagedRuntimeCorrelationError);
		expect(() =>
			correlation.accept(
				event({ kind: "approval.resolved", approvalId: "unknown" }),
			),
		).toThrow(ManagedRuntimeCorrelationError);

		for (let index = 1; index < 64; index += 1) {
			correlation.accept(
				event({
					kind: "approval.requested",
					runId: "run-1",
					approvalId: `approval-${index}`,
				}),
			);
		}
		expect(() =>
			correlation.accept(
				event({
					kind: "approval.requested",
					runId: "run-1",
					approvalId: "approval-overflow",
				}),
			),
		).toThrow(ManagedRuntimeCorrelationError);
	});

	it("accepts passive bounded state events without fabricating a run", () => {
		const { correlation } = harness();

		expect(() =>
			correlation.accept(event({ kind: "usage.updated", usage: undefined })),
		).not.toThrow();
		expect(() =>
			correlation.accept(
				event({ kind: "pending_prompts.changed", prompts: [], hasMore: false }),
			),
		).not.toThrow();
		expect(correlation.getSnapshot().turn).toBeUndefined();
	});

	it("retires all correlation state idempotently on disposal", () => {
		const { correlation, identities } = harness();
		correlation.beginTurn(identities.operation("turn"));
		correlation.dispose();
		correlation.dispose();

		expect(correlation.getSnapshot()).toEqual({
			sessionId: "session-1",
			disposed: true,
			pendingApprovalIds: [],
			pendingQuestionIds: [],
		});
		expect(() => correlation.beginTurn(identities.operation("turn"))).toThrow(
			ManagedRuntimeCorrelationError,
		);
	});
});
