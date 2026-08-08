/**
 * Pure bank op builders (09-next-task-proposer rule 2).
 *
 * The proposer layering is: an agent drafts tasks, the harness turns drafts into
 * `BankOp`s, and the **host** commits them through `BankStore`. This module is
 * the middle step and nothing more — no IO, no id generation, no LLM call, and
 * no ranking. `nowTaskId` / `nextTaskId` keep coming from `deriveBankSnapshot`
 * (rule 1), so there is deliberately no proposer that competes with the cursor.
 *
 * Ids arrive from the caller. A pure builder that minted its own would not be
 * deterministic, and the host already owns bank identity.
 */

import type { DriveTaskDraft } from "@cline/shared";

/**
 * Intent to change the bank, for a host to commit.
 *
 * `appendTasksToPlan.taskIds` are the **new** ids to add, not the resulting
 * plan order — a host commits it by concatenating onto the plan's current
 * `taskIds` (today: `BankStore.editPlanTaskIds`). Keeping the op an intent
 * rather than a final array means two proposals cannot silently clobber each
 * other's ordering.
 */
export type BankOp =
	| {
			readonly type: "createTask";
			readonly id: string;
			readonly title: string;
			readonly body: string;
	  }
	| {
			readonly type: "appendTasksToPlan";
			readonly planId: string;
			readonly taskIds: readonly string[];
	  };

export type BuildBankOpsForDraftsInput = {
	/** Plan the drafts extend. Must be the caller's active plan id. */
	readonly planId: string;
	/** Drafts in the order they should land in the plan. */
	readonly drafts: readonly DriveTaskDraft[];
	/** Host-assigned ids, positionally paired with `drafts`. */
	readonly taskIds: readonly string[];
};

/** Local structural check — `@cline/drive` may only type-import `@cline/shared`. */
function assertDraftShape(draft: DriveTaskDraft, index: number): void {
	if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
		throw new Error(`drafts[${index}] must be an object`);
	}
	const keys = Object.keys(draft);
	for (const key of keys) {
		if (key !== "title" && key !== "body") {
			throw new Error(
				`drafts[${index}] has unexpected key "${key}" — a draft is title + body only`,
			);
		}
	}
	if (typeof draft.title !== "string" || !draft.title.trim()) {
		throw new Error(`drafts[${index}] requires a non-empty title`);
	}
	if (typeof draft.body !== "string") {
		throw new Error(`drafts[${index}] requires a body string`);
	}
}

function assertTaskId(taskId: string, index: number): void {
	if (typeof taskId !== "string" || !taskId.trim()) {
		throw new Error(`taskIds[${index}] must be a non-empty string`);
	}
}

/**
 * Turn drafts plus host-assigned ids into ops: one `createTask` each, then a
 * single `appendTasksToPlan`.
 *
 * Empty drafts produce no ops — an append of nothing is not an intent.
 */
export function buildBankOpsForDrafts(
	input: BuildBankOpsForDraftsInput,
): BankOp[] {
	if (typeof input.planId !== "string" || !input.planId.trim()) {
		throw new Error("planId must be a non-empty string");
	}
	if (input.drafts.length !== input.taskIds.length) {
		throw new Error(
			`drafts and taskIds must be the same length (got ${input.drafts.length} and ${input.taskIds.length})`,
		);
	}
	if (input.drafts.length === 0) {
		return [];
	}

	const seen = new Set<string>();
	input.taskIds.forEach((taskId, index) => {
		assertTaskId(taskId, index);
		if (seen.has(taskId)) {
			throw new Error(`taskIds[${index}] duplicates id "${taskId}"`);
		}
		seen.add(taskId);
	});
	input.drafts.forEach(assertDraftShape);

	const ops: BankOp[] = input.drafts.map((draft, index) => ({
		type: "createTask" as const,
		// biome-ignore lint/style/noNonNullAssertion: length checked above
		id: input.taskIds[index]!,
		title: draft.title,
		body: draft.body,
	}));
	ops.push({
		type: "appendTasksToPlan",
		planId: input.planId,
		taskIds: [...input.taskIds],
	});
	return ops;
}

/**
 * Resulting plan order after applying `appendTasksToPlan` to a current order.
 *
 * Lives here so hosts do not each re-derive the concat rule. Ids already in
 * `currentTaskIds` are not duplicated.
 */
export function applyAppendTasksToPlan(
	currentTaskIds: readonly string[],
	op: Extract<BankOp, { type: "appendTasksToPlan" }>,
): string[] {
	const next = [...currentTaskIds];
	for (const taskId of op.taskIds) {
		if (!next.includes(taskId)) {
			next.push(taskId);
		}
	}
	return next;
}
