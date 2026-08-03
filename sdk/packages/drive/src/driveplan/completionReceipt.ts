/**
 * Completion / receipt guard (ADR-0018 §5).
 *
 * When a DriveRun is bound to a DriveTask, archive requires an accepted
 * receipt with verifier evidence. Pure — bankStore.completeTask calls this.
 */

import type { DriveRun, Receipt } from "@cline/shared";

export class CompletionReceiptError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "CompletionReceiptError";
		this.code = code;
	}
}

export type AssertCompletionReceiptInput = {
	taskId: string;
	/** Present when a DriveRun is bound to this task. */
	boundRun?: DriveRun | null;
	receipt?: Receipt | null;
};

/**
 * Fail closed before archive when a DriveRun is bound.
 * No-op when no run is bound (legacy bank tasks without a run).
 */
export function assertCompletionReceipt(
	input: AssertCompletionReceiptInput,
): void {
	const run = input.boundRun;
	if (!run) {
		return;
	}

	if (run.driveTaskId !== input.taskId) {
		throw new CompletionReceiptError(
			"run_task_mismatch",
			`Bound DriveRun ${run.id} belongs to task ${run.driveTaskId}, not ${input.taskId}.`,
		);
	}

	const receipt = input.receipt;
	if (!receipt) {
		throw new CompletionReceiptError(
			"receipt_required",
			`Cannot archive DriveTask ${input.taskId}: DriveRun ${run.id} is bound and no receipt was provided.`,
		);
	}

	if (receipt.driveTaskId !== input.taskId) {
		throw new CompletionReceiptError(
			"receipt_task_mismatch",
			`Receipt ${receipt.id} is for task ${receipt.driveTaskId}, not ${input.taskId}.`,
		);
	}

	if (receipt.driveRunId !== run.id) {
		throw new CompletionReceiptError(
			"receipt_run_mismatch",
			`Receipt ${receipt.id} is for run ${receipt.driveRunId}, not bound run ${run.id}.`,
		);
	}

	if (receipt.decision !== "accepted") {
		throw new CompletionReceiptError(
			"receipt_not_accepted",
			`Cannot archive DriveTask ${input.taskId}: receipt ${receipt.id} decision is ${receipt.decision}, not accepted.`,
		);
	}

	if (receipt.evidenceRefs.length === 0) {
		throw new CompletionReceiptError(
			"verifier_evidence_required",
			`Cannot archive DriveTask ${input.taskId}: receipt ${receipt.id} has no verifier evidence refs.`,
		);
	}
}
