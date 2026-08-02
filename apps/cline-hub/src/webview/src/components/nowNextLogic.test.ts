import type { BankSnapshot } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { shouldShowNowNext } from "./nowNextLogic";

const EMPTY = {
	activePlanId: null,
	nowTaskId: null,
	nextTaskId: null,
	openTaskIds: [],
} as unknown as BankSnapshot;

const WORKING = {
	...EMPTY,
	activePlanId: "p-1",
	nowTaskId: "t-1",
} as unknown as BankSnapshot;

describe("shouldShowNowNext", () => {
	it("collapses on an empty bank and shows while working", () => {
		expect(shouldShowNowNext(EMPTY)).toBe(false);
		expect(shouldShowNowNext(WORKING)).toBe(true);
	});

	it("shows for a clean-drain invite with no plan left", () => {
		expect(shouldShowNowNext(EMPTY, { planId: "p-2" } as never)).toBe(true);
	});

	// The card is the only thing that renders the agency banner, and a plan
	// archiving to empty is exactly when the banner fires — so gating on plan
	// state alone dropped the one-shot consequence line at the moment it
	// mattered (DRV-FELT-AGENCY).
	it("shows for an agency banner with no plan left", () => {
		expect(shouldShowNowNext(EMPTY, null, "Archived 3 tasks.")).toBe(true);
	});

	it("ignores a blank agency banner", () => {
		expect(shouldShowNowNext(EMPTY, null, "   ")).toBe(false);
		expect(shouldShowNowNext(EMPTY, null, null)).toBe(false);
	});
});
