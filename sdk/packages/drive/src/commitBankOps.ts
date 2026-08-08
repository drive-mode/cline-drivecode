/**
 * Commit `BankOp`s through an injected `BankStore` (09-next-task-proposer).
 *
 * This is the **Commit** half of the propose/commit split: `buildBankOpsForDrafts`
 * produces intent, this applies it, and the returned `BankSnapshot` is the new
 * cursor. Kept out of `bankOps.ts` so the builders stay dependency-free.
 *
 * Commit is **sequential and non-atomic** — `BankStore` is file-backed with no
 * transaction. Plan preconditions are therefore checked up front, before any
 * task is written, so the common failure (bad plan id) cannot leave orphan tasks
 * behind. A store error mid-run still leaves earlier ops applied; callers that
 * need all-or-nothing must reconcile from the returned snapshot. Deliberately no
 * rollback layer here — inventing one over a filesystem would be a lie.
 */

import type { BankSnapshot } from "@cline/shared";
import { applyAppendTasksToPlan, type BankOp } from "./bankOps.js";
import type { BankStore } from "./bankStore.js";

/**
 * Plan ids an op batch appends to, in first-seen order.
 */
function appendTargetPlanIds(ops: readonly BankOp[]): string[] {
	const seen = new Set<string>();
	const planIds: string[] = [];
	for (const op of ops) {
		if (op.type === "appendTasksToPlan" && !seen.has(op.planId)) {
			seen.add(op.planId);
			planIds.push(op.planId);
		}
	}
	return planIds;
}

/**
 * Fail before writing anything when a target plan is missing or read-only.
 *
 * `draft` and `active` both accept appends — only `closed` is refused, because
 * `editPlanTaskIds` rejects an archived plan and discovering that after
 * `createTask` would orphan the tasks.
 */
async function assertAppendTargetsWritable(
	store: BankStore,
	ops: readonly BankOp[],
): Promise<void> {
	for (const planId of appendTargetPlanIds(ops)) {
		const plan = await store.getPlan(planId);
		if (!plan) {
			throw new Error(`commitBankOps: plan not found: ${planId}`);
		}
		if (plan.status === "closed") {
			throw new Error(`commitBankOps: plan is closed: ${planId}`);
		}
	}
}

/**
 * Apply ops in order and return the resulting cursor.
 *
 * An empty batch is a no-op that still reports the current snapshot, so callers
 * can treat "nothing proposed" and "proposal committed" the same way.
 */
export async function commitBankOps(
	store: BankStore,
	ops: readonly BankOp[],
): Promise<BankSnapshot> {
	if (ops.length === 0) {
		return store.getSnapshot();
	}

	await assertAppendTargetsWritable(store, ops);

	for (const op of ops) {
		switch (op.type) {
			case "createTask": {
				await store.createTask({
					id: op.id,
					title: op.title,
					body: op.body,
				});
				break;
			}
			case "appendTasksToPlan": {
				const plan = await store.getPlan(op.planId);
				if (!plan) {
					throw new Error(`commitBankOps: plan not found: ${op.planId}`);
				}
				const nextTaskIds = applyAppendTasksToPlan(plan.taskIds, op);
				await store.editPlanTaskIds(op.planId, nextTaskIds);
				break;
			}
			default: {
				const never: never = op;
				throw new Error(`commitBankOps: unhandled op ${JSON.stringify(never)}`);
			}
		}
	}

	return store.getSnapshot();
}
