import { describe, expect, it } from "vitest";
import type { BankSnapshot } from "@cline/shared";
import {
	buildCleanDrainInvite,
	cleanDrainInviteIsPrivate,
	cleanDrainInviteKey,
	countMidPlanAdds,
	formatCleanDrainNarration,
	shouldOfferCleanDrain,
} from "./cleanDrain.js";

const active: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1"],
	nowTaskId: "t1",
	nextTaskId: null,
	nowTitle: "Last task",
	nextTitle: null,
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

describe("shouldOfferCleanDrain", () => {
	it("offers when plan drains cleanly with ≥1 completion", () => {
		expect(
			shouldOfferCleanDrain({
				driveActive: true,
				prev: active,
				next: empty,
				counters: {
					activateTaskIds: ["t1", "t2"],
					completedCount: 2,
					midPlanAddCount: 0,
				},
				dismissedInviteKey: null,
			}),
		).toBe(true);
	});

	it("skips when mid-plan adds (non-S3)", () => {
		expect(
			shouldOfferCleanDrain({
				driveActive: true,
				prev: active,
				next: empty,
				counters: {
					activateTaskIds: ["t1"],
					completedCount: 2,
					midPlanAddCount: 1,
				},
				dismissedInviteKey: null,
			}),
		).toBe(false);
	});

	it("skips zero-completion sessions", () => {
		expect(
			shouldOfferCleanDrain({
				driveActive: true,
				prev: active,
				next: empty,
				counters: {
					activateTaskIds: ["t1"],
					completedCount: 0,
					midPlanAddCount: 0,
				},
				dismissedInviteKey: null,
			}),
		).toBe(false);
	});

	it("skips when plan remains active", () => {
		expect(
			shouldOfferCleanDrain({
				driveActive: true,
				prev: active,
				next: {
					...active,
					openTaskIds: [],
					nowTaskId: null,
				},
				counters: {
					activateTaskIds: ["t1"],
					completedCount: 1,
					midPlanAddCount: 0,
				},
				dismissedInviteKey: null,
			}),
		).toBe(false);
	});

	it("skips identical dismissed invite", () => {
		const key = cleanDrainInviteKey("p1", 2);
		expect(
			shouldOfferCleanDrain({
				driveActive: true,
				prev: active,
				next: empty,
				counters: {
					activateTaskIds: ["t1"],
					completedCount: 2,
					midPlanAddCount: 0,
				},
				dismissedInviteKey: key,
			}),
		).toBe(false);
	});

	it("skips when Drive inactive", () => {
		expect(
			shouldOfferCleanDrain({
				driveActive: false,
				prev: active,
				next: empty,
				counters: {
					activateTaskIds: ["t1"],
					completedCount: 1,
					midPlanAddCount: 0,
				},
				dismissedInviteKey: null,
			}),
		).toBe(false);
	});
});

describe("buildCleanDrainInvite / narration", () => {
	it("builds invite with stable key and soft copy", () => {
		const invite = buildCleanDrainInvite({
			planId: "p1",
			planTitle: "Current work",
			tasksCompleted: 2,
		});
		expect(invite.kind).toBe("clean_drain");
		expect(invite.inviteKey).toBe("p1::s3::2");
		expect(formatCleanDrainNarration(invite)).toBe(
			"Finished Current work. What's next?",
		);
	});

	it("falls back to planId in narration", () => {
		const invite = buildCleanDrainInvite({
			planId: "p-x",
			tasksCompleted: 1,
		});
		expect(formatCleanDrainNarration(invite)).toBe(
			"Finished p-x. What's next?",
		);
	});
});

describe("cleanDrainInviteIsPrivate", () => {
	it("accepts id-only invites", () => {
		expect(
			cleanDrainInviteIsPrivate(
				buildCleanDrainInvite({ planId: "p1", tasksCompleted: 1 }),
			),
		).toBe(true);
	});

	it("rejects utterance-like keys", () => {
		expect(
			cleanDrainInviteIsPrivate({
				kind: "clean_drain",
				utterance: "hello",
			}),
		).toBe(false);
	});
});

describe("countMidPlanAdds", () => {
	it("counts ids beyond activate baseline", () => {
		expect(countMidPlanAdds(["t1", "t2"], ["t1", "t2", "t3"])).toBe(1);
		expect(countMidPlanAdds(new Set(["t1"]), ["t1"])).toBe(0);
	});
});
