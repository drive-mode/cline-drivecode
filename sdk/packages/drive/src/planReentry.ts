/**
 * Cross-day plan re-entry row model (DRV-PLAN-REENTRY).
 *
 * Counts-only chips from local SessionRollup — no transcript.
 * Draft / non-active plans are omitted (one-active-plan-per-room).
 */

import type { BankSnapshot } from "@cline/shared";
import type { SessionRollup } from "./sessionRollup.js";

export type PlanReentryChipId = "S2" | "S3" | "E1";

export type PlanReentryChip = {
	id: PlanReentryChipId;
	/** Short counts-only label for the row. */
	label: string;
};

export type PlanReentryRowModel = {
	planId: string;
	planTitle: string;
	openTaskCount: number;
	nowTaskId: string | null;
	chips: PlanReentryChip[];
};

export type PlanReentryRollupSlice = Pick<
	SessionRollup,
	"tasksCompleted" | "planCleanDrain" | "postSuccessPlanContinue"
>;

/** Keys that must never appear on a re-entry row model (privacy gate). */
export const PLAN_REENTRY_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"fullTranscript",
] as const;

/**
 * Build a glanceable unfinished-plan row. Returns null when there is no
 * active plan with open tasks (drafts omitted).
 */
export function buildPlanReentryRow(input: {
	snapshot: BankSnapshot;
	planTitle?: string | null;
	rollup?: PlanReentryRollupSlice | null;
}): PlanReentryRowModel | null {
	const planId = input.snapshot.activePlanId?.trim();
	if (!planId) {
		return null;
	}
	const openTaskCount = input.snapshot.openTaskIds.length;
	if (openTaskCount < 1) {
		return null;
	}
	const title =
		input.planTitle?.trim() ||
		input.snapshot.nowTitle?.trim() ||
		planId;
	return {
		planId,
		planTitle: title,
		openTaskCount,
		nowTaskId: input.snapshot.nowTaskId,
		chips: buildPlanReentryChips(input.rollup ?? null),
	};
}

export function buildPlanReentryChips(
	rollup: PlanReentryRollupSlice | null | undefined,
): PlanReentryChip[] {
	if (!rollup) {
		return [];
	}
	const chips: PlanReentryChip[] = [];
	if (rollup.tasksCompleted > 0) {
		chips.push({
			id: "S2",
			label: `${rollup.tasksCompleted} done`,
		});
	}
	if (rollup.planCleanDrain) {
		chips.push({ id: "S3", label: "drained" });
	}
	if (rollup.postSuccessPlanContinue) {
		chips.push({ id: "E1", label: "continued" });
	}
	return chips;
}

/** Coerce a hub rollup JSON object into counts-only slice (best-effort). */
export function planReentryRollupFromUnknown(
	value: unknown,
): PlanReentryRollupSlice | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const tasksCompleted =
		typeof record.tasksCompleted === "number" &&
		Number.isFinite(record.tasksCompleted)
			? Math.max(0, Math.floor(record.tasksCompleted))
			: null;
	if (tasksCompleted == null) {
		return null;
	}
	return {
		tasksCompleted,
		planCleanDrain: record.planCleanDrain === true,
		postSuccessPlanContinue: record.postSuccessPlanContinue === true,
	};
}

export function planReentryRowIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of PLAN_REENTRY_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return false;
			}
		}
	}
	return true;
}
