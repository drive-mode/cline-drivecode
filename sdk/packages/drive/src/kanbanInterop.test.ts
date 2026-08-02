import type { DriveRun } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { applyProjection, getCapabilities, observe } from "./kanbanInterop.js";

const fixtureRun = {
	id: "run_auth_retry_v1",
	driveTaskId: "auth-retry-race",
	title: "Fix auth retry race",
	status: "running",
	spec: {
		revision: 1,
		maxParallel: 3,
		gates: [
			{
				id: "g0",
				kind: "gate.admission",
				label: "run_spec_accepted",
			},
		],
		waves: [
			{
				id: "wave_0",
				title: "wave_0 · inspect",
				workItemIds: ["read_router", "patch_retry"],
			},
		],
		workItems: [
			{
				id: "read_router",
				objective: "Read auth router",
				writeClaims: [],
				isolation: "readonly",
				evidenceRequirements: ["paths:router"],
				status: "SUCCESS",
			},
			{
				id: "patch_retry",
				objective: "Patch retry.ts",
				writeClaims: ["src/services/auth/retry.ts"],
				isolation: "worktree_isolated",
				evidenceRequirements: ["diff:retry.ts"],
				status: "RUNNING",
			},
		],
	},
} as DriveRun;

describe("kanbanInterop stub", () => {
	it("advertises narrow capabilities", () => {
		const caps = getCapabilities();
		expect(caps.supports).toContain("applyProjection");
		expect(caps.deferred).toContain("execute");
	});

	it("projects one run into managed cards with externalRef", () => {
		const result = applyProjection(fixtureRun);
		expect(result.driveRunId).toBe("run_auth_retry_v1");
		expect(result.cards).toHaveLength(2);
		expect(result.cards[0]?.externalRef).toEqual({
			system: "driveplan",
			driveTaskId: "auth-retry-race",
			driveRunId: "run_auth_retry_v1",
			workItemId: "read_router",
		});
		expect(result.cards.every((c) => c.autoReviewEnabled === false)).toBe(true);
		expect(result.cards[0]?.columnHint).toBe("review");
		expect(result.cards[1]?.columnHint).toBe("in_progress");
	});

	it("observes work item statuses", () => {
		const obs = observe(fixtureRun);
		expect(obs.status).toBe("running");
		expect(obs.workItemStatuses.map((w) => w.id)).toEqual(["read_router", "patch_retry"]);
		expect(obs.projectionDiverged).toBe(false);
	});
});
