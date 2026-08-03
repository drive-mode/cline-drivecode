import { describe, expect, it } from "vitest";
import type { BankSnapshot } from "@cline/shared";
import {
	debugRetentionStripCopy,
	hasNowLastFailure,
	interruptChromeCopy,
	interruptRedirectNowAnnounce,
	planAddTreatment,
	planEditConsequenceBanner,
	resolveInterruptPhase,
	steerAppliedBanner,
} from "./agencyChrome";

const base: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
};

describe("resolveInterruptPhase / interruptChromeCopy", () => {
	it("is idle when hand is down", () => {
		expect(
			resolveInterruptPhase({ handRaised: false, turnInFlight: true }),
		).toBe("idle");
		expect(interruptChromeCopy("idle")).toBeNull();
	});

	it("shows finishing copy while turn is in flight", () => {
		expect(
			resolveInterruptPhase({ handRaised: true, turnInFlight: true }),
		).toBe("finishing");
		expect(interruptChromeCopy("finishing")).toBe("Finishing current step");
	});

	it("shows paused copy when waiting on the human", () => {
		expect(
			resolveInterruptPhase({ handRaised: true, turnInFlight: false }),
		).toBe("paused");
		expect(interruptChromeCopy("paused")).toBe("Paused — waiting on you");
	});
});

describe("planEditConsequenceBanner", () => {
	it("skips reorder-only noise when cursor is unchanged", () => {
		const reordered: BankSnapshot = {
			...base,
			openTaskIds: ["t1", "t2", "t3"],
		};
		expect(
			planEditConsequenceBanner(base, reordered, { mutation: "reorder" }),
		).toBeNull();
	});

	it("names collaborative add", () => {
		const next: BankSnapshot = {
			...base,
			openTaskIds: ["t1", "t-new", "t2"],
			nextTaskId: "t-new",
			nextTitle: "Clarify acceptance",
		};
		expect(
			planEditConsequenceBanner(base, next, {
				mutation: "add",
				addedTitle: "Clarify acceptance",
			}),
		).toBe("You added Clarify acceptance");
	});

	it("names recovery fix-up add", () => {
		const next: BankSnapshot = {
			...base,
			nextTaskId: "t-fix",
			nextTitle: "Patch tests",
		};
		expect(
			planEditConsequenceBanner(base, next, {
				mutation: "add",
				addedTitle: "Patch tests",
				recovery: true,
			}),
		).toBe("You added a fix-up: Patch tests");
	});

	it("names next cursor change", () => {
		const next: BankSnapshot = {
			...base,
			nextTaskId: "t3",
			nextTitle: "Ship docs",
		};
		expect(planEditConsequenceBanner(base, next)).toBe(
			"Next is now Ship docs",
		);
	});
});

describe("planAddTreatment", () => {
	it("distinguishes recovery from collaborative without churn jargon", () => {
		const recovery = planAddTreatment(true);
		expect(recovery.tone).toBe("recovery");
		expect(recovery.addLabel).toBe("Add fix-up");
		expect(JSON.stringify(recovery).toLowerCase()).not.toContain("churn");

		const collaborative = planAddTreatment(false);
		expect(collaborative.tone).toBe("collaborative");
		expect(collaborative.addLabel).toBe("Add task");
	});
});

describe("interruptRedirectNowAnnounce / debugRetentionStripCopy", () => {
	it("announces Now rewrite after redirect", () => {
		expect(
			interruptRedirectNowAnnounce({
				previousNowTitle: "Fix parser",
				nextNowTitle: "Narrow repro",
			}),
		).toBe('Redirect: Now was “Fix parser”; now “Narrow repro”.');
		expect(
			interruptRedirectNowAnnounce({
				previousNowTitle: "Same",
				nextNowTitle: "Same",
			}),
		).toBeNull();
	});

	it("shows debug retention strip when facet is on", () => {
		expect(debugRetentionStripCopy(true)).toBe("Debug retention on");
		expect(debugRetentionStripCopy(false)).toBeNull();
	});
});

describe("steerAppliedBanner / hasNowLastFailure", () => {
	it("returns steer consequence copy", () => {
		expect(steerAppliedBanner()).toBe("Steer applied");
	});

	it("detects now lastFailure", () => {
		expect(hasNowLastFailure(base)).toBe(false);
		expect(
			hasNowLastFailure({ ...base, nowLastFailure: "tests red" }),
		).toBe(true);
	});
});
