import {
	assertChatOperationIntent,
	assertChatSessionId,
	type ChatOperationId,
	type ChatOperationIntent,
} from "./chat-identities";
import type { ManagedInteractiveRuntimeEvent } from "./managed-runtime-events";

const MAX_PENDING_CALLBACKS = 64;

export type ManagedAbortEffect = Readonly<{
	kind: "abort";
	intent: ChatOperationIntent<"abort">;
	runId: string;
}>;

export type ManagedAbortRequestResult =
	| Readonly<{ kind: "deferred" }>
	| Readonly<{ kind: "dispatch"; effect: ManagedAbortEffect }>
	| Readonly<{ kind: "already_dispatched" }>;

export type ManagedRuntimeCorrelationSnapshot = Readonly<{
	sessionId: string;
	disposed: boolean;
	turn?: Readonly<{
		operationId: ChatOperationId;
		runId?: string;
		abortPending: boolean;
		abortDispatched: boolean;
	}>;
	pendingApprovalIds: readonly string[];
	pendingQuestionIds: readonly string[];
}>;

export class ManagedRuntimeCorrelationError extends Error {
	readonly code = "managed_runtime_correlation_error";

	constructor() {
		super("Managed runtime event does not match the active app intent.");
		this.name = "ManagedRuntimeCorrelationError";
	}
}

interface ActiveTurn {
	readonly intent: ChatOperationIntent<"turn">;
	runId?: string;
	abortIntent?: ChatOperationIntent<"abort">;
	abortDispatched: boolean;
}

function sameIntent<Kind extends "turn" | "abort">(
	left: ChatOperationIntent<Kind>,
	right: ChatOperationIntent<Kind>,
): boolean {
	return left.kind === right.kind && left.operationId === right.operationId;
}

function fail(): never {
	throw new ManagedRuntimeCorrelationError();
}

function retainedIntent<Kind extends "turn" | "abort">(
	intent: unknown,
	kind: Kind,
): ChatOperationIntent<Kind> {
	try {
		return assertChatOperationIntent(intent, kind);
	} catch {
		return fail();
	}
}

/** One-session, bounded correlation kernel with no transport authority. */
export class ManagedRuntimeCorrelation {
	readonly #sessionId: string;
	readonly #approvals = new Map<string, string>();
	readonly #questions = new Map<string, string>();
	#turn: ActiveTurn | undefined;
	#disposed = false;

	constructor(sessionId: string) {
		try {
			this.#sessionId = assertChatSessionId(sessionId);
		} catch {
			fail();
		}
	}

	beginTurn(intent: ChatOperationIntent<"turn">): void {
		this.#assertUsable();
		const retained = retainedIntent(intent, "turn");
		if (this.#turn) {
			if (!this.#turn.runId && sameIntent(this.#turn.intent, retained)) return;
			fail();
		}
		this.#turn = {
			intent: retained,
			abortDispatched: false,
		};
	}

	markAbortUnknown(intent: ChatOperationIntent<"abort">): void {
		this.#assertUsable();
		const active = this.#turn;
		const retained = retainedIntent(intent, "abort");
		if (
			!active?.runId ||
			!active.abortIntent ||
			!sameIntent(active.abortIntent, retained) ||
			!active.abortDispatched
		) {
			fail();
		}
		active.abortDispatched = false;
	}

	cancelTurn(intent: ChatOperationIntent<"turn">): void {
		this.#assertUsable();
		const active = this.#turn;
		const retained = retainedIntent(intent, "turn");
		if (!active || !sameIntent(active.intent, retained) || active.runId) fail();
		this.#turn = undefined;
	}

	requestAbort(
		intent: ChatOperationIntent<"abort">,
	): ManagedAbortRequestResult {
		this.#assertUsable();
		const active = this.#turn;
		const retained = retainedIntent(intent, "abort");
		if (!active) fail();
		if (active.abortIntent && !sameIntent(active.abortIntent, retained)) fail();
		active.abortIntent = retained;
		if (active.abortDispatched) {
			return Object.freeze({ kind: "already_dispatched" });
		}
		if (!active.runId) return Object.freeze({ kind: "deferred" });
		active.abortDispatched = true;
		return Object.freeze({
			kind: "dispatch",
			effect: Object.freeze({
				kind: "abort",
				intent: retained,
				runId: active.runId,
			}),
		});
	}

	accept(event: ManagedInteractiveRuntimeEvent): readonly ManagedAbortEffect[] {
		this.#assertUsable();
		if (event.sessionId !== this.#sessionId) fail();
		let effects: readonly ManagedAbortEffect[] = [];
		switch (event.kind) {
			case "run.started": {
				const active = this.#turn;
				if (
					!active ||
					active.runId !== undefined ||
					active.intent.operationId !== event.operationId
				) {
					fail();
				}
				active.runId = event.runId;
				if (active.abortIntent && !active.abortDispatched) {
					active.abortDispatched = true;
					effects = Object.freeze([
						Object.freeze({
							kind: "abort" as const,
							intent: active.abortIntent,
							runId: event.runId,
						}),
					]);
				}
				break;
			}
			case "run.heartbeat":
			case "assistant.delta":
			case "assistant.finished":
			case "reasoning.delta":
			case "reasoning.finished":
			case "tool.status":
				this.#assertRun(event.runId);
				break;
			case "approval.requested":
				this.#assertRun(event.runId);
				this.#remember(this.#approvals, event.approvalId, event.runId);
				break;
			case "approval.resolved":
				if (!this.#approvals.delete(event.approvalId)) fail();
				break;
			case "question.requested":
				this.#assertRun(event.runId);
				this.#remember(this.#questions, event.requestId, event.runId);
				break;
			case "question.cancelled":
				if (this.#questions.get(event.requestId) !== event.runId) fail();
				this.#questions.delete(event.requestId);
				break;
			case "run.aborted":
			case "run.completed":
			case "run.failed":
				this.#assertRun(event.runId);
				this.#clearRun(event.runId);
				this.#turn = undefined;
				break;
			case "pending_prompts.changed":
			case "pending_prompt.submitted":
			case "usage.updated":
			case "compaction.started":
			case "compaction.completed":
			case "compaction.skipped":
			case "compaction.failed":
				break;
			default:
				return this.#assertNever(event);
		}
		return effects;
	}

	assertApproval(runId: string, approvalId: string): void {
		this.#assertUsable();
		if (this.#approvals.get(approvalId) !== runId) fail();
	}

	assertQuestion(runId: string, requestId: string): void {
		this.#assertUsable();
		if (this.#questions.get(requestId) !== runId) fail();
	}

	getSnapshot(): ManagedRuntimeCorrelationSnapshot {
		const active = this.#turn;
		return Object.freeze({
			sessionId: this.#sessionId,
			disposed: this.#disposed,
			...(active
				? {
						turn: Object.freeze({
							operationId: active.intent.operationId,
							...(active.runId ? { runId: active.runId } : {}),
							abortPending:
								active.abortIntent !== undefined && !active.abortDispatched,
							abortDispatched: active.abortDispatched,
						}),
					}
				: {}),
			pendingApprovalIds: Object.freeze([...this.#approvals.keys()].sort()),
			pendingQuestionIds: Object.freeze([...this.#questions.keys()].sort()),
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#turn = undefined;
		this.#approvals.clear();
		this.#questions.clear();
	}

	#assertRun(runId: string): void {
		if (!this.#turn?.runId || this.#turn.runId !== runId) fail();
	}

	#remember(map: Map<string, string>, id: string, runId: string): void {
		if (map.has(id) || map.size >= MAX_PENDING_CALLBACKS) fail();
		map.set(id, runId);
	}

	#clearRun(runId: string): void {
		for (const [id, ownerRunId] of this.#approvals) {
			if (ownerRunId === runId) this.#approvals.delete(id);
		}
		for (const [id, ownerRunId] of this.#questions) {
			if (ownerRunId === runId) this.#questions.delete(id);
		}
	}

	#assertUsable(): void {
		if (this.#disposed) fail();
	}

	#assertNever(value: never): never {
		void value;
		return fail();
	}
}
