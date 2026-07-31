/**
 * Pure session rollup from room + bank events (DRV-TASK-METRICS / PRD 10).
 *
 * Counts and booleans only — no utterance text.
 */

import type { BankDriveEvent, DriveEvent } from "@cline/shared";

export type SessionRollup = {
	callSessionId: string;
	roomId: string | null;
	/** S1 */
	durationMs: number | null;
	/** S2 */
	tasksCompleted: number;
	/** Task ids completed in-session */
	completedTaskIds: string[];
	/** S3 — plan archived with zero mid-plan additive task ids after activate */
	planCleanDrain: boolean;
	/** E1 — plan edit / activate after ≥1 completion */
	postSuccessPlanContinue: boolean;
	/** E2 — new/activated plan after progress */
	intentRefresh: boolean;
	/** E3 */
	tasksPerSessionMinute: number | null;
	/** P1 — mid-plan additive task ids after activate */
	midPlanAddCount: number;
	/** P2 — reserved until failure events exist */
	failureStickyCount: number;
};

export type DeriveSessionRollupInput = {
	callSessionId: string;
	roomEvents: DriveEvent[];
	bankEvents: BankDriveEvent[];
};

function inSession(
	callSessionId: string,
	event: { callSessionId?: string },
): boolean {
	return event.callSessionId === callSessionId;
}

/**
 * Derive PRD 10 session metrics from typed room + bank events for one call session.
 */
export function deriveSessionRollup(
	input: DeriveSessionRollupInput,
): SessionRollup {
	const { callSessionId } = input;
	const roomEvents = input.roomEvents.filter((event) =>
		inSession(callSessionId, event),
	);
	const bankEvents = input.bankEvents.filter((event) =>
		inSession(callSessionId, event),
	);

	const join = roomEvents.find((event) => event.type === "control.join");
	const close = [...roomEvents]
		.reverse()
		.find(
			(event) =>
				(event.type === "control.leave" || event.type === "control.end") &&
				typeof event.durationMs === "number",
		);
	const roomId =
		join?.roomId ?? close?.roomId ?? bankEvents[0]?.roomId ?? null;

	let durationMs: number | null = null;
	if (
		close &&
		(close.type === "control.leave" || close.type === "control.end") &&
		close.durationMs != null
	) {
		durationMs = close.durationMs;
	} else if (join && close) {
		const start = Date.parse(join.at);
		const end = Date.parse(close.at);
		if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
			durationMs = end - start;
		}
	}

	const completedTaskIds = bankEvents
		.filter((event) => event.type === "drive_task_completed")
		.map((event) => event.taskId);
	const tasksCompleted = completedTaskIds.length;

	const activated = bankEvents.filter(
		(event) => event.type === "drive_plan_activated",
	);
	const firstActivate = activated[0];
	const activateAt = firstActivate ? Date.parse(firstActivate.at) : NaN;

	const midPlanAddCount = bankEvents.filter((event) => {
		if (event.type !== "drive_plan_step") {
			return false;
		}
		if (!Number.isFinite(activateAt)) {
			return true;
		}
		return Date.parse(event.at) > activateAt;
	}).length;

	const planArchived = bankEvents.some(
		(event) => event.type === "drive_plan_archived",
	);
	const planCleanDrain =
		planArchived &&
		Number.isFinite(activateAt) &&
		midPlanAddCount === 0 &&
		tasksCompleted > 0;

	const firstCompletionAt = completedTaskIds.length
		? Date.parse(
				bankEvents.find((event) => event.type === "drive_task_completed")
					?.at ?? "",
			)
		: NaN;

	const postSuccessSteps = bankEvents.filter((event) => {
		if (
			event.type !== "drive_plan_step" &&
			event.type !== "drive_plan_activated"
		) {
			return false;
		}
		if (!Number.isFinite(firstCompletionAt)) {
			return false;
		}
		if (
			event.type === "drive_plan_activated" &&
			firstActivate &&
			event.id === firstActivate.id
		) {
			return false;
		}
		return Date.parse(event.at) > firstCompletionAt;
	});
	const postSuccessPlanContinue = postSuccessSteps.length > 0;
	const intentRefresh = postSuccessSteps.some(
		(event) => event.type === "drive_plan_activated",
	);

	let tasksPerSessionMinute: number | null = null;
	if (durationMs != null && durationMs > 0) {
		tasksPerSessionMinute = tasksCompleted / (durationMs / 60_000);
	}

	return {
		callSessionId,
		roomId,
		durationMs,
		tasksCompleted,
		completedTaskIds,
		planCleanDrain,
		postSuccessPlanContinue,
		intentRefresh,
		tasksPerSessionMinute,
		midPlanAddCount,
		failureStickyCount: 0,
	};
}
