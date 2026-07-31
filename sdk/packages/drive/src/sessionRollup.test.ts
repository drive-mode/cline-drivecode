import { describe, expect, it } from "vitest";
import type { BankDriveEvent, DriveEvent } from "@cline/shared";
import { deriveSessionRollup } from "./sessionRollup.js";

function bank(
	partial: Omit<BankDriveEvent, "schemaVersion" | "id"> & { id?: string },
): BankDriveEvent {
	return {
		schemaVersion: 1,
		id: partial.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
		...partial,
	} as BankDriveEvent;
}

describe("deriveSessionRollup", () => {
	it("marks clean drain when plan archives without mid-plan adds", () => {
		const callSessionId = "cs-clean";
		const roomId = "room-1";
		const roomEvents: DriveEvent[] = [
			{
				schemaVersion: 1,
				id: "j1",
				roomId,
				at: "2026-07-30T10:00:00.000Z",
				callSessionId,
				type: "control.join",
				track: "control",
				participant: {
					id: "human",
					kind: "human",
					displayName: "You",
					role: "owner",
				},
			},
			{
				schemaVersion: 1,
				id: "l1",
				roomId,
				at: "2026-07-30T10:10:00.000Z",
				callSessionId,
				type: "control.leave",
				track: "control",
				participantId: "human",
				durationMs: 600_000,
			},
		];
		const bankEvents: BankDriveEvent[] = [
			bank({
				id: "a1",
				at: "2026-07-30T10:01:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_activated",
				planId: "p1",
				title: "Ship",
			}),
			bank({
				id: "c1",
				at: "2026-07-30T10:05:00.000Z",
				roomId,
				callSessionId,
				type: "drive_task_completed",
				taskId: "t1",
			}),
			bank({
				id: "pa1",
				at: "2026-07-30T10:06:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_archived",
				planId: "p1",
			}),
		];
		const rollup = deriveSessionRollup({
			callSessionId,
			roomEvents,
			bankEvents,
		});
		expect(rollup.tasksCompleted).toBe(1);
		expect(rollup.planCleanDrain).toBe(true);
		expect(rollup.midPlanAddCount).toBe(0);
		expect(rollup.durationMs).toBe(600_000);
		expect(rollup.tasksPerSessionMinute).toBeCloseTo(0.1);
	});

	it("counts mid-plan adds and post-success continue", () => {
		const callSessionId = "cs-churn";
		const roomId = "room-2";
		const bankEvents: BankDriveEvent[] = [
			bank({
				id: "a1",
				at: "2026-07-30T10:01:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_activated",
				planId: "p1",
				title: "Ship",
			}),
			bank({
				id: "c1",
				at: "2026-07-30T10:05:00.000Z",
				roomId,
				callSessionId,
				type: "drive_task_completed",
				taskId: "t1",
			}),
			bank({
				id: "s1",
				at: "2026-07-30T10:06:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_step",
				planId: "p1",
				taskId: "t2",
				title: "Extra",
				position: 1,
			}),
			bank({
				id: "pa1",
				at: "2026-07-30T10:07:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_archived",
				planId: "p1",
			}),
		];
		const rollup = deriveSessionRollup({
			callSessionId,
			roomEvents: [],
			bankEvents,
		});
		expect(rollup.midPlanAddCount).toBe(1);
		expect(rollup.planCleanDrain).toBe(false);
		expect(rollup.postSuccessPlanContinue).toBe(true);
	});
});
