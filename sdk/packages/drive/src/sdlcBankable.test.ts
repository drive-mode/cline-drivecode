import { describe, expect, it } from "vitest";
import { createMemoryBankFs } from "./bankFs.js";
import { createBankStore } from "./bankStore.js";
import {
	acceptSdlcFreeze,
	buildSdlcFreezeAcceptPlan,
	sdlcFreezeIsPrivate,
} from "./sdlcBankable.js";

describe("buildSdlcFreezeAcceptPlan", () => {
	it("maps phase-entry first slice + Musts to tasks + plan", () => {
		const plan = buildSdlcFreezeAcceptPlan({
			kind: "phase_entry",
			firstSlice: {
				id: "t-first",
				title: "Wire bank accept",
				body: "Create DriveTasks on freeze accept",
			},
			followOnMusts: [{ title: "Add privacy tests" }],
			planTitle: "Phase entry freeze",
			planId: "p-freeze",
		});
		expect(plan).toEqual({
			kind: "sdlc_freeze_accept",
			planId: "p-freeze",
			planTitle: "Phase entry freeze",
			activate: true,
			tasks: [
				{
					id: "t-first",
					title: "Wire bank accept",
					body: "Create DriveTasks on freeze accept",
				},
				{
					id: expect.stringMatching(/^t-must-/),
					title: "Add privacy tests",
					body: "",
				},
			],
		});
	});

	it("escape hatch lands a single build task", () => {
		const plan = buildSdlcFreezeAcceptPlan({
			kind: "escape",
			slice: { title: "Just build the parser fix", id: "t-escape" },
		});
		expect(plan.tasks).toEqual([
			{
				id: "t-escape",
				title: "Just build the parser fix",
				body: "",
			},
		]);
		expect(plan.activate).toBe(true);
	});

	it("rejects empty titles", () => {
		expect(() =>
			buildSdlcFreezeAcceptPlan({
				kind: "phase_entry",
				firstSlice: { title: "  " },
			}),
		).toThrow(/title is required/);
	});
});

describe("acceptSdlcFreeze bank write", () => {
	it("creates DriveTasks + active plan so nowTaskId can bind", async () => {
		const store = createBankStore(createMemoryBankFs(), "/tmp/sdlc-bank");
		const result = await acceptSdlcFreeze(store, {
			kind: "phase_entry",
			firstSlice: { id: "t1", title: "First slice" },
			followOnMusts: [{ id: "t2", title: "Follow-on Must" }],
			planId: "p1",
			planTitle: "Guided freeze",
		});
		expect(result.snapshot.activePlanId).toBe("p1");
		expect(result.snapshot.openTaskIds).toEqual(["t1", "t2"]);
		expect(result.snapshot.nowTaskId).toBe("t1");
		expect(result.plan.status).toBe("active");
		const bound = await store.bindNowTask();
		expect(bound?.task.id).toBe("t1");
		expect(bound?.task.status).toBe("in_progress");
	});
});

describe("sdlcFreeze privacy", () => {
	it("accepts structured proposals", () => {
		expect(
			sdlcFreezeIsPrivate({
				kind: "phase_entry",
				firstSlice: { title: "x" },
			}),
		).toBe(true);
	});

	it("rejects utterance keys", () => {
		expect(
			sdlcFreezeIsPrivate({
				kind: "escape",
				slice: { title: "x" },
				utterance: "nope",
			}),
		).toBe(false);
	});
});
