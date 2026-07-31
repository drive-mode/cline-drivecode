/**
 * In-call stuck recovery (DRV-STUCK-RECOVERY).
 * Pure offer / accept-plan helpers — proposals carry ids only (no utterances).
 */

import type { BankSnapshot } from "@cline/shared";

export type RecoveryOptionKind = "narrow" | "fixup" | "recruit" | "pause";

/** Structured recovery proposal — task/plan ids only, never utterance text. */
export type RecoveryProposal = {
	kind: "recovery";
	option: RecoveryOptionKind;
	taskId: string;
	planId: string | null;
	/** Stable dismiss key: taskId + failure fingerprint. */
	offerKey: string;
	/** New task id when option creates one (narrow / fix-up). */
	newTaskId?: string;
};

export type RecoveryCreateTaskSpec = {
	id: string;
	title: string;
	body: string;
	planId: string;
};

/**
 * Bank (or chrome) mutation plan for an accepted option.
 * Callers gate on Accept — nothing here writes by itself.
 */
export type RecoveryAcceptPlan =
	| {
			action: "narrow";
			createTask: RecoveryCreateTaskSpec;
			/** Full plan task id order after accept (narrowed task first). */
			reorderTaskIds: string[];
			offerKey: string;
			agencyBanner: string;
	  }
	| {
			action: "fixup";
			createTask: RecoveryCreateTaskSpec;
			offerKey: string;
			agencyBanner: string;
	  }
	| {
			action: "recruit";
			offerKey: string;
			/** Soft intent only — no bank write / seating (DRV-RECRUIT-STALL is W2.3). */
			agencyBanner: string;
			taskId: string;
	  }
	| {
			action: "pause";
			offerKey: string;
			/** Ask override + raise-hand stop — no new bank status. */
			posture: "ask";
			raiseHand: true;
			abortTurn: true;
			agencyBanner: string;
	  }
	| {
			action: "dismiss";
			offerKey: string;
	  };

const FORBIDDEN_PROPOSAL_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"text",
] as const;

/** Fingerprint for mute / identical re-offer suppression. */
export function recoveryOfferKey(
	taskId: string,
	lastFailure: string,
): string {
	return `${taskId}::${lastFailure.trim()}`;
}

/** Manual-only offer after lastFailure while Drive is active. */
export function shouldOfferRecoveryFork(input: {
	driveActive: boolean;
	nowTaskId: string | null | undefined;
	nowLastFailure: string | null | undefined;
	dismissedOfferKey: string | null | undefined;
}): boolean {
	if (!input.driveActive) {
		return false;
	}
	const taskId = input.nowTaskId?.trim();
	const failure = input.nowLastFailure?.trim();
	if (!taskId || !failure) {
		return false;
	}
	const key = recoveryOfferKey(taskId, failure);
	return input.dismissedOfferKey !== key;
}

export function buildRecoveryProposal(input: {
	option: RecoveryOptionKind;
	taskId: string;
	planId: string | null;
	lastFailure: string;
	newTaskId?: string;
}): RecoveryProposal {
	const proposal: RecoveryProposal = {
		kind: "recovery",
		option: input.option,
		taskId: input.taskId,
		planId: input.planId,
		offerKey: recoveryOfferKey(input.taskId, input.lastFailure),
	};
	if (input.newTaskId) {
		proposal.newTaskId = input.newTaskId;
	}
	return proposal;
}

/** Reject proposals that smuggle utterance-like fields (privacy). */
export function recoveryProposalIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of FORBIDDEN_PROPOSAL_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return false;
			}
		}
	}
	return true;
}

function defaultNarrowTitle(nowTitle: string | null | undefined): string {
	const base = nowTitle?.trim() || "task";
	return `Narrow: ${base}`;
}

function defaultFixupTitle(nowTitle: string | null | undefined): string {
	const base = nowTitle?.trim() || "task";
	return `Fix-up: ${base}`;
}

function nextRecoveryTaskId(option: "narrow" | "fixup"): string {
	const stamp = Date.now().toString(36);
	return option === "narrow" ? `t-narrow-${stamp}` : `t-fixup-${stamp}`;
}

/**
 * Pure accept planner. Narrow / fix-up need an active plan; recruit / pause /
 * dismiss do not mutate the bank.
 */
export function planRecoveryAccept(input: {
	option: RecoveryOptionKind | "dismiss";
	snapshot: BankSnapshot;
	/** Open plan task ids in current order (from PlanEditor list). */
	planTaskIds: string[];
	titleOverride?: string;
}): RecoveryAcceptPlan | null {
	const taskId = input.snapshot.nowTaskId?.trim();
	const failure = input.snapshot.nowLastFailure?.trim();
	if (!taskId || !failure) {
		return null;
	}
	const offerKey = recoveryOfferKey(taskId, failure);
	const planId = input.snapshot.activePlanId;

	switch (input.option) {
		case "dismiss":
			return { action: "dismiss", offerKey };
		case "recruit":
			return {
				action: "recruit",
				offerKey,
				taskId,
				agencyBanner: `Recruit offered for ${taskId}`,
			};
		case "pause":
			return {
				action: "pause",
				offerKey,
				posture: "ask",
				raiseHand: true,
				abortTurn: true,
				agencyBanner: "Plan paused — Ask override",
			};
		case "narrow": {
			if (!planId) {
				return null;
			}
			const newId = nextRecoveryTaskId("narrow");
			const title =
				input.titleOverride?.trim() ||
				defaultNarrowTitle(input.snapshot.nowTitle);
			const withoutNew = input.planTaskIds.filter((id) => id !== newId);
			const reorderTaskIds = [
				newId,
				...withoutNew.filter((id) => id !== taskId),
				taskId,
			];
			return {
				action: "narrow",
				offerKey,
				createTask: {
					id: newId,
					title,
					body: `Narrowed scope for ${taskId}.`,
					planId,
				},
				reorderTaskIds,
				agencyBanner: `You narrowed to ${title}`,
			};
		}
		case "fixup": {
			if (!planId) {
				return null;
			}
			const newId = nextRecoveryTaskId("fixup");
			const title =
				input.titleOverride?.trim() ||
				defaultFixupTitle(input.snapshot.nowTitle);
			return {
				action: "fixup",
				offerKey,
				createTask: {
					id: newId,
					title,
					body: `Fix-up for ${taskId}.`,
					planId,
				},
				agencyBanner: `You added a fix-up: ${title}`,
			};
		}
		default: {
			const _exhaustive: never = input.option;
			return _exhaustive;
		}
	}
}

export const RECOVERY_OPTIONS: ReadonlyArray<{
	option: RecoveryOptionKind;
	label: string;
	hint: string;
}> = [
	{
		option: "narrow",
		label: "Narrow task",
		hint: "Replace Now with a narrower task; original keeps lastFailure",
	},
	{
		option: "fixup",
		label: "Add fix-up",
		hint: "Append a fix-up; Now stays on the failed task",
	},
	{
		option: "recruit",
		label: "Recruit",
		hint: "Offer recruit (seating lands in DRV-RECRUIT-STALL)",
	},
	{
		option: "pause",
		label: "Pause plan",
		hint: "Ask override + raise-hand stop — no new bank status",
	},
];
