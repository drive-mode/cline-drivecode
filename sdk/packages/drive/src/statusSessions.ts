/**
 * Drive Analytics accomplishment row model (DRV-ANALYTICS / former Status sessions).
 *
 * Counts-only chips from SessionRollup — no transcript / utterance text.
 * Distinct from agent Board / Changelog / Dependency map.
 */

import type { SessionRollup } from "./sessionRollup.js";

export type StatusSessionChipId = "S2" | "S3" | "E1" | "E2" | "P1" | "P2";

export type StatusSessionChip = {
	id: StatusSessionChipId;
	/** Short counts-only label for the row. */
	label: string;
};

export type StatusSessionRow = {
	callSessionId: string;
	roomId: string | null;
	tasksCompleted: number;
	completedTaskIds: string[];
	planCleanDrain: boolean;
	postSuccessPlanContinue: boolean;
	failureStickyCount: number;
	durationMs: number | null;
	chips: StatusSessionChip[];
};

/** Keys that must never appear on a Status session row (privacy gate). */
export const STATUS_SESSION_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"audio",
	"fullTranscript",
] as const;

export type StatusSessionRollupSlice = Pick<
	SessionRollup,
	| "callSessionId"
	| "roomId"
	| "tasksCompleted"
	| "completedTaskIds"
	| "planCleanDrain"
	| "postSuccessPlanContinue"
	| "intentRefresh"
	| "midPlanAddCount"
	| "failureStickyCount"
	| "durationMs"
>;

/**
 * Build glanceable accomplishment chips (S2/S3/E1/E2/P1/P2) from a rollup.
 * Empty chips when the session made no measurable progress.
 */
export function buildStatusSessionChips(
	rollup: Pick<
		SessionRollup,
		| "tasksCompleted"
		| "planCleanDrain"
		| "postSuccessPlanContinue"
		| "intentRefresh"
		| "midPlanAddCount"
		| "failureStickyCount"
	>,
): StatusSessionChip[] {
	const chips: StatusSessionChip[] = [];
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
	if (rollup.intentRefresh) {
		chips.push({ id: "E2", label: "intent refresh" });
	}
	if (rollup.midPlanAddCount > 0) {
		chips.push({ id: "P1", label: "churn" });
	}
	if (rollup.failureStickyCount > 0) {
		chips.push({ id: "P2", label: "sticky fail" });
	}
	return chips;
}

/**
 * Project a SessionRollup into an Analytics accomplishment row.
 */
export function buildStatusSessionRow(
	rollup: StatusSessionRollupSlice,
): StatusSessionRow {
	return {
		callSessionId: rollup.callSessionId,
		roomId: rollup.roomId,
		tasksCompleted: rollup.tasksCompleted,
		completedTaskIds: [...rollup.completedTaskIds],
		planCleanDrain: rollup.planCleanDrain,
		postSuccessPlanContinue: rollup.postSuccessPlanContinue,
		failureStickyCount: rollup.failureStickyCount,
		durationMs: rollup.durationMs,
		chips: buildStatusSessionChips(rollup),
	};
}

/** Coerce hub rollup JSON into a Status row (best-effort; drops forbidden shape). */
export function statusSessionRowFromUnknown(
	value: unknown,
): StatusSessionRow | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const callSessionId =
		typeof record.callSessionId === "string" && record.callSessionId.trim()
			? record.callSessionId.trim()
			: null;
	if (!callSessionId) {
		return null;
	}
	const tasksCompleted =
		typeof record.tasksCompleted === "number" &&
		Number.isFinite(record.tasksCompleted)
			? Math.max(0, Math.floor(record.tasksCompleted))
			: 0;
	const completedTaskIds = Array.isArray(record.completedTaskIds)
		? record.completedTaskIds.filter(
				(id): id is string => typeof id === "string" && id.trim().length > 0,
			)
		: [];
	const durationMs =
		typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
			? Math.max(0, record.durationMs)
			: null;
	const failureStickyCount =
		typeof record.failureStickyCount === "number" &&
		Number.isFinite(record.failureStickyCount)
			? Math.max(0, Math.floor(record.failureStickyCount))
			: 0;
	const midPlanAddCount =
		typeof record.midPlanAddCount === "number" &&
		Number.isFinite(record.midPlanAddCount)
			? Math.max(0, Math.floor(record.midPlanAddCount))
			: 0;
	return buildStatusSessionRow({
		callSessionId,
		roomId:
			typeof record.roomId === "string" && record.roomId.trim()
				? record.roomId.trim()
				: null,
		tasksCompleted,
		completedTaskIds,
		planCleanDrain: record.planCleanDrain === true,
		postSuccessPlanContinue: record.postSuccessPlanContinue === true,
		intentRefresh: record.intentRefresh === true,
		midPlanAddCount,
		failureStickyCount,
		durationMs,
	});
}

export function statusSessionRowIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of STATUS_SESSION_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return false;
			}
		}
	}
	return true;
}

/** Fixture shapes for clean / churny / continue / stickiness / intent renders. */
export const STATUS_SESSION_FIXTURES = {
	clean: {
		callSessionId: "sess-clean",
		roomId: "room-1",
		tasksCompleted: 2,
		completedTaskIds: ["t1", "t2"],
		planCleanDrain: true,
		postSuccessPlanContinue: false,
		intentRefresh: false,
		midPlanAddCount: 0,
		failureStickyCount: 0,
		durationMs: 120_000,
	},
	churny: {
		callSessionId: "sess-churn",
		roomId: "room-1",
		tasksCompleted: 1,
		completedTaskIds: ["t1"],
		planCleanDrain: false,
		postSuccessPlanContinue: false,
		intentRefresh: false,
		midPlanAddCount: 2,
		failureStickyCount: 0,
		durationMs: 90_000,
	},
	continue: {
		callSessionId: "sess-continue",
		roomId: "room-2",
		tasksCompleted: 1,
		completedTaskIds: ["t1"],
		planCleanDrain: false,
		postSuccessPlanContinue: true,
		intentRefresh: false,
		midPlanAddCount: 0,
		failureStickyCount: 0,
		durationMs: 180_000,
	},
	stickiness: {
		callSessionId: "sess-sticky",
		roomId: "room-2",
		tasksCompleted: 0,
		completedTaskIds: [],
		planCleanDrain: false,
		postSuccessPlanContinue: false,
		intentRefresh: false,
		midPlanAddCount: 0,
		failureStickyCount: 2,
		durationMs: 60_000,
	},
	intent: {
		callSessionId: "sess-intent",
		roomId: "room-3",
		tasksCompleted: 0,
		completedTaskIds: [],
		planCleanDrain: false,
		postSuccessPlanContinue: false,
		intentRefresh: true,
		midPlanAddCount: 0,
		failureStickyCount: 0,
		durationMs: 45_000,
	},
} as const satisfies Record<string, StatusSessionRollupSlice>;
