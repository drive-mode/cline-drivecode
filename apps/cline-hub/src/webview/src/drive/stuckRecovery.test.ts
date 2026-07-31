import { describe, expect, it } from "vitest";
import type { BankSnapshot } from "@cline/shared";
import {
	buildRecoveryProposal,
	planRecoveryAccept,
	recoveryOfferKey,
	recoveryProposalIsPrivate,
	resolveRecoveryOfferTarget,
	shouldOfferRecoveryFork,
} from "./stuckRecovery";

const stuck: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "Fix parser",
	nextTitle: "Rerun tests",
	nowLastFailure: "tests red",
};

describe("shouldOfferRecoveryFork", () => {
	it("offers when Drive active and now has lastFailure", () => {
		expect(
			shouldOfferRecoveryFork({
				driveActive: true,
				nowTaskId: stuck.nowTaskId,
				nowLastFailure: stuck.nowLastFailure,
				dismissedOfferKey: null,
			}),
		).toBe(true);
	});

	it("hides when Drive inactive or no failure", () => {
		expect(
			shouldOfferRecoveryFork({
				driveActive: false,
				nowTaskId: stuck.nowTaskId,
				nowLastFailure: stuck.nowLastFailure,
				dismissedOfferKey: null,
			}),
		).toBe(false);
		expect(
			shouldOfferRecoveryFork({
				driveActive: true,
				nowTaskId: stuck.nowTaskId,
				nowLastFailure: null,
				dismissedOfferKey: null,
			}),
		).toBe(false);
	});

	it("does not re-offer identical fork after dismiss", () => {
		const key = recoveryOfferKey("t1", "tests red");
		expect(
			shouldOfferRecoveryFork({
				driveActive: true,
				nowTaskId: "t1",
				nowLastFailure: "tests red",
				dismissedOfferKey: key,
			}),
		).toBe(false);
	});

	it("re-offers when failure fingerprint changes", () => {
		const key = recoveryOfferKey("t1", "tests red");
		expect(
			shouldOfferRecoveryFork({
				driveActive: true,
				nowTaskId: "t1",
				nowLastFailure: "timeout",
				dismissedOfferKey: key,
			}),
		).toBe(true);
	});

	it("offers from auto stall without Now lastFailure (W4.1)", () => {
		expect(
			shouldOfferRecoveryFork({
				driveActive: true,
				nowTaskId: "t1",
				nowLastFailure: null,
				dismissedOfferKey: null,
				autoStallOffer: {
					taskId: "t1",
					failureFingerprint: "stall:low_s2+high_p1",
				},
			}),
		).toBe(true);
	});

	it("dedupes manual lastFailure and auto stall into one offerKey", () => {
		const key = recoveryOfferKey("t1", "tests red");
		const target = resolveRecoveryOfferTarget({
			nowTaskId: "t1",
			nowLastFailure: "tests red",
			autoStallOffer: {
				taskId: "t1",
				failureFingerprint: "stall:sticky_p2",
			},
		});
		expect(target?.source).toBe("manual");
		expect(target?.offerKey).toBe(key);
		expect(
			shouldOfferRecoveryFork({
				driveActive: true,
				nowTaskId: "t1",
				nowLastFailure: "tests red",
				dismissedOfferKey: key,
				autoStallOffer: {
					taskId: "t1",
					failureFingerprint: "stall:sticky_p2",
				},
			}),
		).toBe(false);
	});
});

describe("buildRecoveryProposal privacy", () => {
	it("carries only structured ids — no utterance keys", () => {
		const proposal = buildRecoveryProposal({
			option: "fixup",
			taskId: "t1",
			planId: "p1",
			lastFailure: "tests red",
			newTaskId: "t-fixup-1",
		});
		expect(proposal.kind).toBe("recovery");
		expect(proposal.taskId).toBe("t1");
		expect(proposal.planId).toBe("p1");
		expect(proposal.newTaskId).toBe("t-fixup-1");
		expect(recoveryProposalIsPrivate(proposal)).toBe(true);
		expect(JSON.stringify(proposal).toLowerCase()).not.toContain(
			"utterance",
		);
	});

	it("rejects smuggled utterance fields", () => {
		expect(
			recoveryProposalIsPrivate({
				kind: "recovery",
				taskId: "t1",
				utterance: "please fix this",
			}),
		).toBe(false);
	});
});

describe("planRecoveryAccept", () => {
	it("plans narrow as create + reorder with narrowed task first", () => {
		const plan = planRecoveryAccept({
			option: "narrow",
			snapshot: stuck,
			planTaskIds: ["t1", "t2"],
			titleOverride: "Narrow: parser only",
		});
		expect(plan?.action).toBe("narrow");
		if (plan?.action !== "narrow") {
			return;
		}
		expect(plan.createTask.planId).toBe("p1");
		expect(plan.createTask.title).toBe("Narrow: parser only");
		expect(plan.reorderTaskIds[0]).toBe(plan.createTask.id);
		expect(plan.reorderTaskIds).toContain("t1");
		expect(plan.offerKey).toBe(recoveryOfferKey("t1", "tests red"));
	});

	it("plans fix-up as create append; original keeps failure on snapshot", () => {
		const plan = planRecoveryAccept({
			option: "fixup",
			snapshot: stuck,
			planTaskIds: ["t1", "t2"],
		});
		expect(plan?.action).toBe("fixup");
		if (plan?.action !== "fixup") {
			return;
		}
		expect(plan.createTask.planId).toBe("p1");
		expect(plan.createTask.title).toContain("Fix-up");
		// Accept does not clear lastFailure on the stuck task.
		expect(stuck.nowLastFailure).toBe("tests red");
	});

	it("plans recruit without bank mutation", () => {
		const plan = planRecoveryAccept({
			option: "recruit",
			snapshot: stuck,
			planTaskIds: ["t1", "t2"],
		});
		expect(plan).toEqual({
			action: "recruit",
			offerKey: recoveryOfferKey("t1", "tests red"),
			taskId: "t1",
			agencyBanner: "Who should take t1?",
		});
		expect(JSON.stringify(plan)).not.toMatch(/utterance/i);
	});

	it("plans pause as Ask override + raise-hand stop", () => {
		const plan = planRecoveryAccept({
			option: "pause",
			snapshot: stuck,
			planTaskIds: ["t1", "t2"],
		});
		expect(plan).toEqual({
			action: "pause",
			offerKey: recoveryOfferKey("t1", "tests red"),
			posture: "ask",
			raiseHand: true,
			abortTurn: true,
			agencyBanner: "Plan paused — Ask override",
		});
	});

	it("plans dismiss with offerKey only — no durable fields", () => {
		const plan = planRecoveryAccept({
			option: "dismiss",
			snapshot: stuck,
			planTaskIds: ["t1", "t2"],
		});
		expect(plan).toEqual({
			action: "dismiss",
			offerKey: recoveryOfferKey("t1", "tests red"),
		});
	});

	it("returns null when narrow/fixup lack an active plan", () => {
		const noPlan: BankSnapshot = {
			...stuck,
			activePlanId: null,
		};
		expect(
			planRecoveryAccept({
				option: "narrow",
				snapshot: noPlan,
				planTaskIds: [],
			}),
		).toBeNull();
		expect(
			planRecoveryAccept({
				option: "fixup",
				snapshot: noPlan,
				planTaskIds: [],
			}),
		).toBeNull();
	});

	it("accepts auto-stall fingerprint when Now lacks lastFailure", () => {
		const noFailure: BankSnapshot = {
			...stuck,
			nowLastFailure: null,
		};
		const plan = planRecoveryAccept({
			option: "dismiss",
			snapshot: noFailure,
			planTaskIds: ["t1", "t2"],
			stallFailureFingerprint: "stall:low_s2+high_p1",
		});
		expect(plan).toEqual({
			action: "dismiss",
			offerKey: recoveryOfferKey("t1", "stall:low_s2+high_p1"),
		});
	});
});
