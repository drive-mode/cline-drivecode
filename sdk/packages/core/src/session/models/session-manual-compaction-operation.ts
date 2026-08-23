import { createHash } from "node:crypto";
import type { SessionCompactionState } from "./session-compaction";

export const SESSION_MANUAL_COMPACTION_OPERATION_KIND =
	"manual_compaction" as const;

export type SessionManualCompactionOperationStatus =
	| "running"
	| "completed"
	| "skipped"
	| "failed"
	| "indeterminate";

export interface SessionManualCompactionStateSummary {
	version: 1;
	updatedAt: string;
	sourceMessageCount: number;
	compactedMessageCount: number;
	conversationId?: string;
	/** Present on all current receipts; omitted only by the gate-off v0 checkpoint. */
	stateDigest?: string;
}

export type SessionManualCompactionReceiptResult =
	| {
			operationId: string;
			sessionId: string;
			outcome: "compacted";
			state: SessionManualCompactionStateSummary;
	  }
	| {
			operationId: string;
			sessionId: string;
			outcome: "skipped";
	  };

export interface SessionManualCompactionOperationReceipt {
	sessionId: string;
	writerGeneration: number;
	operationKind: typeof SESSION_MANUAL_COMPACTION_OPERATION_KIND;
	operationId: string;
	intentDigest: string;
	status: SessionManualCompactionOperationStatus;
	result?: SessionManualCompactionReceiptResult;
	compactionPath?: string;
	startedAt: string;
	updatedAt: string;
}

export type SessionManualCompactionDurableBeginResult =
	| {
			disposition: "started";
			receipt: SessionManualCompactionOperationReceipt;
	  }
	| {
			disposition: "replay";
			receipt: SessionManualCompactionOperationReceipt;
	  }
	| {
			disposition: "in_progress" | "failed" | "indeterminate";
			receipt: SessionManualCompactionOperationReceipt;
	  };

export type SessionManualCompactionBeginResult =
	| {
			disposition: "started";
			receipt: SessionManualCompactionOperationReceipt;
	  }
	| {
			disposition: "replay";
			result:
				| {
						operationId: string;
						sessionId: string;
						outcome: "compacted";
						state: SessionCompactionState;
				  }
				| {
						operationId: string;
						sessionId: string;
						outcome: "skipped";
				  };
	  }
	| {
			disposition: "in_progress" | "failed" | "indeterminate";
			receipt: SessionManualCompactionOperationReceipt;
	  };

export function summarizeSessionManualCompactionState(
	state: SessionCompactionState,
): SessionManualCompactionStateSummary {
	return {
		version: state.version,
		updatedAt: state.updated_at,
		sourceMessageCount: state.source_message_count,
		compactedMessageCount: state.messages.length,
		stateDigest: createHash("sha256")
			.update(JSON.stringify(state))
			.digest("hex"),
		...(state.conversation_id ? { conversationId: state.conversation_id } : {}),
	};
}

export function isMatchingSessionManualCompactionSummary(
	state: SessionCompactionState,
	summary: SessionManualCompactionStateSummary,
): boolean {
	const actual = summarizeSessionManualCompactionState(state);
	return (
		actual.version === summary.version &&
		actual.updatedAt === summary.updatedAt &&
		actual.sourceMessageCount === summary.sourceMessageCount &&
		actual.compactedMessageCount === summary.compactedMessageCount &&
		actual.conversationId === summary.conversationId &&
		(summary.stateDigest === undefined ||
			actual.stateDigest === summary.stateDigest)
	);
}

export class SessionManualCompactionOperationConflictError extends Error {
	constructor(
		message = "manual compaction operation conflicts with durable intent",
	) {
		super(message);
		this.name = "SessionManualCompactionOperationConflictError";
	}
}

export class SessionManualCompactionOperationIntegrityError extends Error {
	constructor(message = "manual compaction receipt is malformed") {
		super(message);
		this.name = "SessionManualCompactionOperationIntegrityError";
	}
}
