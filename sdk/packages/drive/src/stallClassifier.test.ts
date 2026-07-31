import { describe, expect, it } from "vitest";
import {
	classifyStall,
	DEFAULT_STALL_POLICY,
	stallClassificationIsPrivate,
	stallRollupSliceFromCounters,
	type StallRollupSlice,
} from "./stallClassifier.js";

const empty: StallRollupSlice = {
	tasksCompleted: 0,
	midPlanAddCount: 0,
	failureStickyCount: 0,
};

describe("classifyStall", () => {
	it("does not stall on a healthy session (completions, no churn, no sticky)", () => {
		const result = classifyStall({
			rollup: {
				tasksCompleted: 3,
				midPlanAddCount: 0,
				failureStickyCount: 0,
			},
			openFailures: [{ taskId: "t1" }],
			nowTaskId: "t1",
		});
		expect(result.stalled).toBe(false);
		expect(result.reasons).not.toContain("low_s2");
		expect(result.reasons).not.toContain("high_p1");
		expect(result.reasons).not.toContain("sticky_p2");
		expect(result.primaryTaskId).toBeNull();
	});

	it("emits low_s2 + stalls with sticky open lastFailure", () => {
		const result = classifyStall({
			rollup: { ...empty, tasksCompleted: 0, failureStickyCount: 1 },
			openFailures: [{ taskId: "t-stuck", lastFailure: "tests red" }],
			nowTaskId: "t-stuck",
		});
		expect(result.reasons).toContain("low_s2");
		expect(result.reasons).toContain("sticky_p2");
		expect(result.stalled).toBe(true);
		expect(result.primaryTaskId).toBe("t-stuck");
		expect(result.failureFingerprint).toBe("tests red");
	});

	it("emits high_p1 for mid-plan churn at threshold", () => {
		const result = classifyStall({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: DEFAULT_STALL_POLICY.highP1MinAdds,
				failureStickyCount: 0,
			},
			openFailures: [],
			nowTaskId: "t1",
		});
		expect(result.reasons).toContain("high_p1");
		expect(result.reasons).toContain("low_s2");
		expect(result.stalled).toBe(true);
		expect(result.primaryTaskId).toBe("t1");
		expect(result.failureFingerprint).toBe("stall:low_s2+high_p1");
	});

	it("emits sticky_p2 from failureStickyCount without open note", () => {
		const result = classifyStall({
			rollup: {
				tasksCompleted: 1,
				midPlanAddCount: 0,
				failureStickyCount: 2,
			},
			openFailures: [{ taskId: "t1" }],
			nowTaskId: "t1",
		});
		expect(result.reasons).toContain("sticky_p2");
		// No open lastFailure and not low_s2+high_p1 → not stalled yet
		expect(result.stalled).toBe(false);
	});

	it("stalls on sticky_p2 + high_p1 even with some completions", () => {
		const result = classifyStall({
			rollup: {
				tasksCompleted: 2,
				midPlanAddCount: 3,
				failureStickyCount: 1,
			},
			openFailures: [{ taskId: "t2", lastFailure: "timeout" }],
			nowTaskId: "t1",
		});
		expect(result.reasons).toContain("high_p1");
		expect(result.reasons).toContain("sticky_p2");
		expect(result.stalled).toBe(true);
		// Prefers now when it has failure; else first open failure
		expect(result.primaryTaskId).toBe("t2");
		expect(result.failureFingerprint).toBe("timeout");
	});

	it("prefers Now when Now carries lastFailure", () => {
		const result = classifyStall({
			rollup: { ...empty, failureStickyCount: 1 },
			openFailures: [
				{ taskId: "t-other", lastFailure: "older" },
				{ taskId: "t-now", lastFailure: "now fail" },
			],
			nowTaskId: "t-now",
		});
		expect(result.stalled).toBe(true);
		expect(result.primaryTaskId).toBe("t-now");
		expect(result.failureFingerprint).toBe("now fail");
	});

	it("respects policy overrides", () => {
		const result = classifyStall({
			rollup: {
				tasksCompleted: 1,
				midPlanAddCount: 1,
				failureStickyCount: 0,
			},
			openFailures: [],
			nowTaskId: "t1",
			policy: { lowS2MaxCompleted: 1, highP1MinAdds: 1 },
		});
		expect(result.reasons).toEqual(["low_s2", "high_p1"]);
		expect(result.stalled).toBe(true);
	});

	it("classification payload stays private (no utterance keys)", () => {
		const result = classifyStall({
			rollup: { ...empty, failureStickyCount: 1 },
			openFailures: [{ taskId: "t1", lastFailure: "tests red" }],
			nowTaskId: "t1",
		});
		expect(stallClassificationIsPrivate(result)).toBe(true);
		expect(JSON.stringify(result).toLowerCase()).not.toContain("utterance");
		expect(
			stallClassificationIsPrivate({
				...result,
				utterance: "please fix",
			}),
		).toBe(false);
	});
});

describe("stallRollupSliceFromCounters", () => {
	it("builds a rollup slice and derives sticky from open failures", () => {
		const slice = stallRollupSliceFromCounters({
			tasksCompleted: 0,
			midPlanAddCount: 2,
			openFailures: [
				{ taskId: "t1", lastFailure: "a" },
				{ taskId: "t2" },
				{ taskId: "t3", lastFailure: "b" },
			],
		});
		expect(slice).toEqual({
			tasksCompleted: 0,
			midPlanAddCount: 2,
			failureStickyCount: 2,
		});
	});
});
