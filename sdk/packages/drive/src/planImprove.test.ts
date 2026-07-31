import { describe, expect, it } from "vitest";
import { createMemoryBankFs } from "./bankFs.js";
import {
	applyPlanImproveAccept,
	createMemoryPlanImproveStore,
	diagnoseAndPropose,
	planImproveIsPrivate,
	planPlanImproveResolve,
	PLAN_IMPROVE_DEFAULT_SKILL_ID,
} from "./planImprove.js";

describe("diagnoseAndPropose", () => {
	it("returns null for a healthy rollup", () => {
		expect(
			diagnoseAndPropose({
				rollup: {
					tasksCompleted: 3,
					midPlanAddCount: 0,
					failureStickyCount: 0,
				},
				openFailures: [{ taskId: "t1" }],
				callSessionId: "cs-ok",
			}),
		).toBeNull();
	});

	it("yields one kind:planning proposal for a stalled fixture", () => {
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 0,
				failureStickyCount: 1,
			},
			openFailures: [{ taskId: "t-stuck", lastFailure: "tests red" }],
			nowTaskId: "t-stuck",
			callSessionId: "cs-stall",
			evidence: {
				eventIds: ["e-fail-1"],
				planIds: ["p1"],
				artifactPaths: [".drive/bank/tasks/t-stuck.md"],
			},
			proposalId: "pp-fixture",
		});
		expect(proposal).not.toBeNull();
		expect(proposal?.kind).toBe("planning");
		expect(proposal?.reasons).toContain("low_s2");
		expect(proposal?.reasons).toContain("sticky_p2");
		expect(proposal?.evidence.eventIds).toEqual(["e-fail-1"]);
		expect(proposal?.evidence.taskIds).toContain("t-stuck");
		expect(proposal?.evidence.skillIds).toContain(
			PLAN_IMPROVE_DEFAULT_SKILL_ID,
		);
		expect(proposal?.target.type).toBe("plan_template");
		expect(planImproveIsPrivate(proposal)).toBe(true);
		expect(JSON.stringify(proposal).toLowerCase()).not.toContain(
			"utterance",
		);
	});
});

describe("planPlanImproveResolve + apply", () => {
	it("reject leaves disk unchanged", async () => {
		const fs = createMemoryBankFs();
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 2,
				failureStickyCount: 0,
			},
			openFailures: [],
			nowTaskId: "t1",
			callSessionId: "cs-r",
			proposalId: "pp-reject",
		});
		expect(proposal).not.toBeNull();
		if (!proposal) {
			return;
		}
		const store = createMemoryPlanImproveStore();
		store.enqueue(proposal);
		const plan = planPlanImproveResolve({
			proposal,
			decision: "reject",
		});
		expect(plan.action).toBe("reject");
		const result = await applyPlanImproveAccept(fs, plan);
		expect(result.wrote).toBe(false);
		expect(await fs.list(".drive/plan-improve")).toEqual([]);
		expect(store.resolve(proposal.id, "reject")).toBe(true);
		expect(store.listPending()).toEqual([]);
	});

	it("mute leaves disk unchanged", async () => {
		const fs = createMemoryBankFs();
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 2,
				failureStickyCount: 0,
			},
			openFailures: [],
			nowTaskId: "t1",
			callSessionId: "cs-m",
			proposalId: "pp-mute",
		});
		expect(proposal).not.toBeNull();
		if (!proposal) {
			return;
		}
		const plan = planPlanImproveResolve({
			proposal,
			decision: "mute",
		});
		const result = await applyPlanImproveAccept(fs, plan);
		expect(result.wrote).toBe(false);
		expect(await fs.exists(".drive/plan-improve")).toBe(false);
	});

	it("accept writes only the allowed plan-improve artifact", async () => {
		const fs = createMemoryBankFs();
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 0,
				failureStickyCount: 1,
			},
			openFailures: [{ taskId: "t1", lastFailure: "timeout" }],
			nowTaskId: "t1",
			callSessionId: "cs-a",
			proposalId: "pp-accept",
			targetType: "plan_template",
		});
		expect(proposal).not.toBeNull();
		if (!proposal) {
			return;
		}
		const store = createMemoryPlanImproveStore();
		store.enqueue(proposal);
		const plan = planPlanImproveResolve({
			proposal,
			decision: "accept",
			acceptedAt: "2026-07-31T00:00:00.000Z",
		});
		expect(plan.action).toBe("write_artifact");
		if (plan.action !== "write_artifact") {
			return;
		}
		expect(plan.relativePath).toBe(
			".drive/plan-improve/accepted/pp-accept.json",
		);
		const result = await applyPlanImproveAccept(fs, plan);
		expect(result.wrote).toBe(true);
		const raw = await fs.read(plan.relativePath);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw!) as { kind: string; proposalId: string };
		expect(parsed.kind).toBe("planning_accepted");
		expect(parsed.proposalId).toBe("pp-accept");
		expect(planImproveIsPrivate(JSON.parse(raw!))).toBe(true);
		// No bank task files written.
		expect(await fs.exists(".drive/bank")).toBe(false);
		expect(store.markAccepted(proposal.id)).toBe(true);
	});

	it("accept planning_skill enqueues host boundary file only", async () => {
		const fs = createMemoryBankFs();
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 2,
				failureStickyCount: 0,
			},
			openFailures: [],
			nowTaskId: "t1",
			callSessionId: "cs-skill",
			proposalId: "pp-skill",
			targetType: "planning_skill",
		});
		expect(proposal?.target.type).toBe("planning_skill");
		if (!proposal) {
			return;
		}
		const plan = planPlanImproveResolve({
			proposal,
			decision: "accept",
		});
		expect(plan.action).toBe("enqueue_skill");
		if (plan.action !== "enqueue_skill") {
			return;
		}
		expect(plan.hostBoundary).toBe("enqueue_only");
		const result = await applyPlanImproveAccept(fs, plan);
		expect(result.wrote).toBe(true);
		expect(result.relativePath).toBe(
			".drive/plan-improve/queue/pp-skill.json",
		);
		const raw = await fs.read(result.relativePath!);
		expect(JSON.parse(raw!).skillId).toBe(PLAN_IMPROVE_DEFAULT_SKILL_ID);
	});
});
