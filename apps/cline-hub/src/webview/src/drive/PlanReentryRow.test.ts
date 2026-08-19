import { buildPlanReentryRow } from "@cline/drive";
import type { BankSnapshot } from "@cline/shared";
import { describe, expect, it } from "vitest";

const open: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
	nowLastFailure: null,
};

describe("PlanReentryRow model", () => {
	it("surfaces unfinished active plans with open count", () => {
		const row = buildPlanReentryRow({
			snapshot: open,
			planTitle: "Current work",
			rollup: {
				tasksCompleted: 2,
				planCleanDrain: false,
				postSuccessPlanContinue: true,
			},
		});
		expect(row?.openTaskCount).toBe(2);
		expect(row?.chips.map((chip) => chip.id)).toEqual(["S2", "E1"]);
	});
});
