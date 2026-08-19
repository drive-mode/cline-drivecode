import { buildCleanDrainInvite } from "@cline/drive";
import type { BankSnapshot } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { hasNowLastFailure } from "../drive/agencyChrome";
import { isCleanDrainSuccessor, shouldShowNowNext } from "./nowNextLogic";

const empty: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
	nowLastFailure: null,
};

const planned: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

describe("shouldShowNowNext", () => {
	it("collapses when no active plan", () => {
		expect(shouldShowNowNext(empty)).toBe(false);
	});

	it("shows when now task exists", () => {
		expect(shouldShowNowNext(planned)).toBe(true);
	});

	it("shows successor when clean-drain invite is set", () => {
		const invite = buildCleanDrainInvite({
			planId: "p1",
			planTitle: "Current work",
			tasksCompleted: 2,
		});
		expect(shouldShowNowNext(empty, invite)).toBe(true);
		expect(isCleanDrainSuccessor(invite)).toBe(true);
	});
});

describe("NowNext recovery treatment", () => {
	it("detects recovery when nowLastFailure is set", () => {
		expect(hasNowLastFailure(planned)).toBe(false);
		expect(hasNowLastFailure({ ...planned, nowLastFailure: "tests red" })).toBe(
			true,
		);
	});
});
