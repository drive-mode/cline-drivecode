/**
 * Clean-drain ritual (DRV-CLEAN-DRAIN): S3 → soft invite to set next goal.
 *
 * Invite alone does **not** set E1 — only a user continue (new plan / tasks)
 * does. Privacy: plan/task ids only; no utterances.
 */

import type { BankSnapshot } from "@cline/shared";

/** Keys that must never appear on a clean-drain invite (privacy gate). */
export const CLEAN_DRAIN_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"text",
	"fullTranscript",
] as const;

/** Structured invite — ids + titles only, never utterance payloads. */
export type CleanDrainInvite = {
	kind: "clean_drain";
	/** Stable mute key: planId + session completion count. */
	inviteKey: string;
	planId: string;
	planTitle: string | null;
	tasksCompleted: number;
};

export type CleanDrainSessionCounters = {
	/** Task ids present on the plan at activate (or first seen active snapshot). */
	activateTaskIds: ReadonlySet<string> | readonly string[];
	/** Completions since activate in this call session. */
	completedCount: number;
	/** Additive mid-plan task ids after activate (P1 / S3 gate). */
	midPlanAddCount: number;
};

export function cleanDrainInviteKey(
	planId: string,
	tasksCompleted: number,
): string {
	return `${planId}::s3::${tasksCompleted}`;
}

/**
 * Detect S3-shaped drain from a BankSnapshot transition + session counters.
 * Fires when an active plan collapses to empty with ≥1 completion and zero
 * mid-plan adds — invite ≠ auto E1.
 */
export function shouldOfferCleanDrain(input: {
	driveActive: boolean;
	prev: BankSnapshot;
	next: BankSnapshot;
	counters: CleanDrainSessionCounters;
	dismissedInviteKey: string | null | undefined;
}): boolean {
	if (!input.driveActive) {
		return false;
	}
	const planId = input.prev.activePlanId?.trim();
	if (!planId) {
		return false;
	}
	// Drain: active plan with open work → empty cursor (archived / all done).
	if (input.next.activePlanId != null || input.next.nowTaskId != null) {
		return false;
	}
	if (input.prev.openTaskIds.length === 0 && !input.prev.nowTaskId) {
		return false;
	}
	if (input.counters.completedCount < 1) {
		return false;
	}
	if (input.counters.midPlanAddCount > 0) {
		return false;
	}
	const key = cleanDrainInviteKey(planId, input.counters.completedCount);
	return input.dismissedInviteKey !== key;
}

export function buildCleanDrainInvite(input: {
	planId: string;
	planTitle?: string | null;
	tasksCompleted: number;
}): CleanDrainInvite {
	return {
		kind: "clean_drain",
		inviteKey: cleanDrainInviteKey(input.planId, input.tasksCompleted),
		planId: input.planId,
		planTitle: input.planTitle?.trim() || null,
		tasksCompleted: input.tasksCompleted,
	};
}

/** One-line acknowledgment + soft ask — distinct from stall/diagnose copy. */
export function formatCleanDrainNarration(invite: CleanDrainInvite): string {
	const title = invite.planTitle?.trim() || invite.planId;
	return `Finished ${title}. What's next?`;
}

/** Reject invites that smuggle utterance-like fields (privacy). */
export function cleanDrainInviteIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of CLEAN_DRAIN_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Count mid-plan additive task ids vs the activate snapshot set.
 * New ids on an open plan after activate are P1 churn (blocks S3).
 */
export function countMidPlanAdds(
	activateTaskIds: ReadonlySet<string> | readonly string[],
	currentOpenOrPlanTaskIds: readonly string[],
): number {
	const baseline =
		activateTaskIds instanceof Set ? activateTaskIds : new Set(activateTaskIds);
	let adds = 0;
	for (const taskId of currentOpenOrPlanTaskIds) {
		if (!baseline.has(taskId)) {
			adds += 1;
		}
	}
	return adds;
}
