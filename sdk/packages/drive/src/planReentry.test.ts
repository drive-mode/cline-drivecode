import { describe, expect, it } from "vitest";
import type { BankSnapshot } from "@cline/shared";
import {
	buildPlanReentryChips,
	buildPlanReentryRow,
	planReentryRowIsPrivate,
	planReentryRollupFromUnknown,
} from "./planReentry.js";

const open: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
	nowLastFailure: null,
};

const empty: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
	nowLastFailure: null,
};

describe("buildPlanReentryRow", () => {
	it("builds title + open count for unfinished active plan", () => {
		const row = buildPlanReentryRow({
			snapshot: open,
			planTitle: "Current work",
			rollup: {
				tasksCompleted: 1,
				planCleanDrain: false,
				postSuccessPlanContinue: false,
			},
		});
		expect(row).toEqual({
			planId: "p1",
			planTitle: "Current work",
			openTaskCount: 2,
			nowTaskId: "t1",
			chips: [{ id: "S2", label: "1 done" }],
		});
	});

	it("omits draft / empty / no-open-task snapshots", () => {
		expect(buildPlanReentryRow({ snapshot: empty })).toBeNull();
		expect(
			buildPlanReentryRow({
				snapshot: { ...open, openTaskIds: [], nowTaskId: null },
			}),
		).toBeNull();
	});

	it("includes S3/E1 chips when rollup says so", () => {
		expect(
			buildPlanReentryChips({
				tasksCompleted: 3,
				planCleanDrain: true,
				postSuccessPlanContinue: true,
			}),
		).toEqual([
			{ id: "S2", label: "3 done" },
			{ id: "S3", label: "drained" },
			{ id: "E1", label: "continued" },
		]);
	});
});

describe("planReentry privacy", () => {
	it("accepts counts-only rows", () => {
		const row = buildPlanReentryRow({ snapshot: open });
		expect(planReentryRowIsPrivate(row)).toBe(true);
	});

	it("rejects utterance keys", () => {
		expect(
			planReentryRowIsPrivate({ planId: "p1", transcript: "hi" }),
		).toBe(false);
	});

	it("coerces unknown rollup JSON", () => {
		expect(
			planReentryRollupFromUnknown({
				tasksCompleted: 2,
				planCleanDrain: true,
				utterance: "nope",
			}),
		).toEqual({
			tasksCompleted: 2,
			planCleanDrain: true,
			postSuccessPlanContinue: false,
		});
		expect(planReentryRollupFromUnknown(null)).toBeNull();
	});
});
