/**
 * Pure stall classifier (DRV-PLAN-IMPROVE / W4.1).
 *
 * Consumes SessionRollup metrics + open tasks with lastFailure.
 * Emits stable reason codes only — never utterances or transcripts.
 */

import type { SessionRollup } from "./sessionRollup.js";

/** Stable stall reason codes (PRD 10 / slice 3). */
export type StallReasonCode = "low_s2" | "high_p1" | "sticky_p2";

/** Open-task failure signal — note stays on disk; classifier uses presence + ids. */
export type StallOpenFailure = {
	taskId: string;
	lastFailure?: string | null;
};

/** Policy constants (facet later) — not calendar SLAs. */
export type StallPolicy = {
	/** S2 at/below this counts as low_s2. Default 0. */
	lowS2MaxCompleted: number;
	/** P1 mid-plan adds at/above this count as high_p1. Default 2. */
	highP1MinAdds: number;
	/** P2 sticky count at/above this counts as sticky_p2. Default 1. */
	stickyP2MinCount: number;
};

export const DEFAULT_STALL_POLICY: Readonly<StallPolicy> = {
	lowS2MaxCompleted: 0,
	highP1MinAdds: 2,
	stickyP2MinCount: 1,
};

/** Rollup fields the classifier needs (full SessionRollup or mid-call slice). */
export type StallRollupSlice = Pick<
	SessionRollup,
	"tasksCompleted" | "midPlanAddCount" | "failureStickyCount"
>;

export type ClassifyStallInput = {
	rollup: StallRollupSlice;
	openFailures: readonly StallOpenFailure[];
	/** Prefer Now when choosing a recovery target. */
	nowTaskId?: string | null;
	policy?: Partial<StallPolicy>;
};

export type StallClassification = {
	stalled: boolean;
	reasons: StallReasonCode[];
	/** Preferred recovery task id when stalled. */
	primaryTaskId: string | null;
	/**
	 * Structured fingerprint for mute / offerKey — bank lastFailure note when
	 * present, else `stall:<reasons>` (never an utterance).
	 */
	failureFingerprint: string | null;
};

export const STALL_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"text",
	"fullTranscript",
	"audio",
] as const;

/** Reject classifications / offer payloads that smuggle utterance-like fields. */
export function stallClassificationIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	return findForbiddenStallKey(value) == null;
}

function findForbiddenStallKey(
	value: unknown,
	path: string[] = [],
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const hit = findForbiddenStallKey(value[i], [...path, String(i)]);
			if (hit) {
				return hit;
			}
		}
		return null;
	}
	if (typeof value !== "object") {
		return null;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of STALL_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return [...path, key].join(".") || key;
			}
		}
		const hit = findForbiddenStallKey(child, [...path, key]);
		if (hit) {
			return hit;
		}
	}
	return null;
}

function openWithFailure(
	openFailures: readonly StallOpenFailure[],
): StallOpenFailure[] {
	return openFailures.filter((entry) => Boolean(entry.lastFailure?.trim()));
}

function pickPrimaryTaskId(
	nowTaskId: string | null | undefined,
	failed: StallOpenFailure[],
): string | null {
	const now = nowTaskId?.trim();
	if (now && failed.some((entry) => entry.taskId === now)) {
		return now;
	}
	return failed[0]?.taskId ?? now ?? null;
}

function fingerprintFor(
	primaryTaskId: string | null,
	failed: StallOpenFailure[],
	reasons: StallReasonCode[],
): string | null {
	if (!primaryTaskId) {
		return null;
	}
	const note = failed
		.find((entry) => entry.taskId === primaryTaskId)
		?.lastFailure?.trim();
	if (note) {
		return note;
	}
	if (reasons.length === 0) {
		return null;
	}
	return `stall:${reasons.join("+")}`;
}

/**
 * Classify stall from SessionRollup metrics + open lastFailure signals.
 *
 * Reason codes are collected independently for fixtures; `stalled` requires
 * actionable pressure (open lastFailure and/or low S2 combined with churn /
 * sticky failure).
 */
export function classifyStall(input: ClassifyStallInput): StallClassification {
	const policy: StallPolicy = {
		...DEFAULT_STALL_POLICY,
		...input.policy,
	};
	const failed = openWithFailure(input.openFailures);
	const reasons: StallReasonCode[] = [];

	if (input.rollup.tasksCompleted <= policy.lowS2MaxCompleted) {
		reasons.push("low_s2");
	}
	if (input.rollup.midPlanAddCount >= policy.highP1MinAdds) {
		reasons.push("high_p1");
	}
	if (
		input.rollup.failureStickyCount >= policy.stickyP2MinCount ||
		failed.length > 0
	) {
		reasons.push("sticky_p2");
	}

	const hasLow = reasons.includes("low_s2");
	const hasHighP1 = reasons.includes("high_p1");
	const hasSticky = reasons.includes("sticky_p2");

	const stalled =
		(hasSticky && failed.length > 0) ||
		(hasLow && hasHighP1) ||
		(hasLow && hasSticky) ||
		(hasHighP1 && hasSticky);

	if (!stalled) {
		return {
			stalled: false,
			reasons,
			primaryTaskId: null,
			failureFingerprint: null,
		};
	}

	const primaryTaskId = pickPrimaryTaskId(input.nowTaskId, failed);
	const failureFingerprint = fingerprintFor(primaryTaskId, failed, reasons);

	return {
		stalled: true,
		reasons,
		primaryTaskId,
		failureFingerprint,
	};
}

/**
 * Mid-call rollup slice from session counters (no JSONL read required).
 * failureStickyCount prefers explicit count; else distinct open failures.
 */
export function stallRollupSliceFromCounters(input: {
	tasksCompleted: number;
	midPlanAddCount: number;
	failureStickyCount?: number;
	openFailures?: readonly StallOpenFailure[];
}): StallRollupSlice {
	const fromOpen = openWithFailure(input.openFailures ?? []).length;
	return {
		tasksCompleted: Math.max(0, input.tasksCompleted),
		midPlanAddCount: Math.max(0, input.midPlanAddCount),
		failureStickyCount:
			input.failureStickyCount != null
				? Math.max(0, input.failureStickyCount)
				: fromOpen,
	};
}
