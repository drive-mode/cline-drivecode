import type { DriveRun, WorkLease } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	claimWorkLease,
	listEligibleWork,
	reportProgress,
} from "./agentControl.js";

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
				status: "PENDING",
			},
		],
	},
} as DriveRun;

describe("listEligibleWork", () => {
	it("returns pending items that are not leased", () => {
		const items = listEligibleWork({ run: fixtureRun });
		expect(items.map((i) => i.id)).toEqual(["patch_retry"]);
	});

	it("excludes actively leased items", () => {
		const lease = {
			id: "lease_1",
			driveTaskId: "auth-retry-race",
			driveRunId: "run_auth_retry_v1",
			workItemId: "patch_retry",
			runSpecRevision: 1,
			idempotencyKey: "ik-1",
			objective: "Patch retry.ts",
			acceptanceCriteria: [],
			evidenceRequirements: ["diff:retry.ts"],
			isolation: "worktree_isolated",
			writeClaims: ["src/services/auth/retry.ts"],
			allowedActions: [],
			expiresAt: "2099-01-01T00:00:00.000Z",
		} as WorkLease;
		expect(
			listEligibleWork({ run: fixtureRun, activeLeases: [lease] }),
		).toEqual([]);
	});

	it("returns empty when run is not claimable", () => {
		const draft = { ...fixtureRun, status: "draft" as const };
		expect(listEligibleWork({ run: draft })).toEqual([]);
	});
});

describe("claimWorkLease", () => {
	it("proposes a lease for an eligible work item", () => {
		const result = claimWorkLease({
			run: fixtureRun,
			workItemId: "patch_retry",
			idempotencyKey: "ik-1",
			expiresAt: "2099-01-01T00:00:00.000Z",
			runSpecRevision: 1,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.lease.workItemId).toBe("patch_retry");
		expect(result.lease.driveTaskId).toBe("auth-retry-race");
		expect(result.lease.runSpecRevision).toBe(1);
	});

	it("rejects revision mismatch", () => {
		const result = claimWorkLease({
			run: fixtureRun,
			workItemId: "patch_retry",
			idempotencyKey: "ik-1",
			expiresAt: "2099-01-01T00:00:00.000Z",
			runSpecRevision: 99,
		});
		expect(result).toEqual({
			ok: false,
			code: "revision_mismatch",
			message: expect.stringContaining("99"),
		});
	});

	it("rejects non-eligible work", () => {
		const result = claimWorkLease({
			run: fixtureRun,
			workItemId: "read_router",
			idempotencyKey: "ik-1",
			expiresAt: "2099-01-01T00:00:00.000Z",
			runSpecRevision: 1,
		});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.code).toBe("work_not_eligible");
	});
});

describe("reportProgress", () => {
	it("proposes an updated run with the new work-item status", () => {
		const result = reportProgress({
			run: fixtureRun,
			workItemId: "patch_retry",
			status: "RUNNING",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.workItem.status).toBe("RUNNING");
		expect(result.run.spec.workItems[1]?.status).toBe("RUNNING");
		expect(fixtureRun.spec.workItems[1]?.status).toBe("PENDING");
	});

	it("rejects unknown work items", () => {
		const result = reportProgress({
			run: fixtureRun,
			workItemId: "missing",
			status: "RUNNING",
		});
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.code).toBe("work_item_not_found");
	});
});
