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

/**
 * Auto-stall offer from classifyStall (W4.1) — same fork card as manual
 * lastFailure; still gated (show only; no auto bank mutate).
 */
export type AutoStallRecoveryOffer = {
	taskId: string;
	/** Structured fingerprint (bank note or stall:reasons) — not an utterance. */
	failureFingerprint: string;
};

/**
 * Offer recovery fork while Drive is active when:
 * - Manual: Now has lastFailure (W1.3), or
 * - Auto: stall classifier fired (W4.1)
 *
 * Dedupes identical offerKeys so manual + auto never double-card.
 */
export function shouldOfferRecoveryFork(input: {
	driveActive: boolean;
	nowTaskId: string | null | undefined;
	nowLastFailure: string | null | undefined;
	dismissedOfferKey: string | null | undefined;
	/** Optional auto-stall offer from classifyStall (same mute key space). */
	autoStallOffer?: AutoStallRecoveryOffer | null;
}): boolean {
	if (!input.driveActive) {
		return false;
	}
	const resolved = resolveRecoveryOfferTarget(input);
	if (!resolved) {
		return false;
	}
	return input.dismissedOfferKey !== resolved.offerKey;
}

/** Resolve the single card target — prefers Now lastFailure over auto stall. */
export function resolveRecoveryOfferTarget(input: {
	nowTaskId: string | null | undefined;
	nowLastFailure: string | null | undefined;
	autoStallOffer?: AutoStallRecoveryOffer | null;
}): { taskId: string; failureNote: string; offerKey: string; source: "manual" | "auto_stall" } | null {
	const manualTask = input.nowTaskId?.trim();
	const manualFailure = input.nowLastFailure?.trim();
	if (manualTask && manualFailure) {
		return {
			taskId: manualTask,
			failureNote: manualFailure,
			offerKey: recoveryOfferKey(manualTask, manualFailure),
			source: "manual",
		};
	}
	const auto = input.autoStallOffer;
	const autoTask = auto?.taskId?.trim();
	const autoFailure = auto?.failureFingerprint?.trim();
	if (autoTask && autoFailure) {
		return {
			taskId: autoTask,
			failureNote: autoFailure,
			offerKey: recoveryOfferKey(autoTask, autoFailure),
			source: "auto_stall",
		};
	}
	return null;
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
	/**
	 * When Now lacks lastFailure but auto-stall opened the fork (W4.1),
	 * supply the stall fingerprint so mute / narrow / fix-up still gate.
	 */
	stallFailureFingerprint?: string | null;
	/** Override task id when stall targets a non-Now open failure. */
	stallTaskId?: string | null;
}): RecoveryAcceptPlan | null {
	const taskId =
		input.snapshot.nowTaskId?.trim() ||
		input.stallTaskId?.trim() ||
		"";
	const failure =
		input.snapshot.nowLastFailure?.trim() ||
		input.stallFailureFingerprint?.trim() ||
		"";
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
				agencyBanner: `Who should take ${taskId}?`,
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
		label: "Who should take this?",
		hint: "Rank agents for this stuck task and seat via hub (DRV-RECRUIT-STALL)",
	},
	{
		option: "pause",
		label: "Pause plan",
		hint: "Ask override + raise-hand stop — no new bank status",
	},
];
