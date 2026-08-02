import { describe, expect, it } from "vitest";
import { parseDriveRun, parseReceipt, parseWorkLease } from "./run";

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
				workItemIds: ["read_router"],
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
		],
	},
};

describe("DriveRunSchema", () => {
	it("parses a one-task/one-run fixture", () => {
		const run = parseDriveRun(fixtureRun);
		expect(run.id).toBe("run_auth_retry_v1");
		expect(run.spec.workItems[0]?.id).toBe("read_router");
	});

	it("rejects unknown fields", () => {
		expect(() => parseDriveRun({ ...fixtureRun, extra: true })).toThrow();
	});
});

describe("WorkLeaseSchema", () => {
	it("parses a lease hung off DriveTask.id", () => {
		const lease = parseWorkLease({
			id: "lease_1",
			driveTaskId: "auth-retry-race",
			driveRunId: "run_auth_retry_v1",
			workItemId: "patch_retry",
			runSpecRevision: 1,
			idempotencyKey: "ik-1",
			objective: "Patch retry.ts",
			acceptanceCriteria: ["tests green"],
			evidenceRequirements: ["diff:retry.ts"],
			isolation: "worktree_isolated",
			writeClaims: ["src/services/auth/retry.ts"],
			allowedActions: ["edit", "test"],
			expiresAt: "2026-08-02T12:00:00.000Z",
		});
		expect(lease.driveTaskId).toBe("auth-retry-race");
	});
});

describe("ReceiptSchema", () => {
	it("parses a pending receipt", () => {
		const receipt = parseReceipt({
			id: "rcpt_1",
			driveTaskId: "auth-retry-race",
			driveRunId: "run_auth_retry_v1",
			evidenceRefs: ["pr:123"],
			decision: "pending",
			createdAt: "2026-08-02T12:00:00.000Z",
		});
		expect(receipt.decision).toBe("pending");
	});
});
