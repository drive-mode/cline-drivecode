import type { DriveRun, WorkLease } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyProjection,
	collectReceipt,
	execute,
	getCapabilities,
	observe,
	type KanbanInteropHost,
} from "./kanbanInterop.js";

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

const fixtureLease = {
	id: "lease_1",
	driveTaskId: "auth-retry-race",
	driveRunId: "run_auth_retry_v1",
	workItemId: "patch_retry",
	runSpecRevision: 1,
	idempotencyKey: "idem-1",
	objective: "Patch retry",
	acceptanceCriteria: [],
	evidenceRequirements: ["diff:retry.ts"],
	isolation: "worktree_isolated",
	writeClaims: ["src/services/auth/retry.ts"],
	allowedActions: ["apply_patch"],
	expiresAt: "2099-01-01T00:00:00.000Z",
} as WorkLease;

describe("kanbanInterop", () => {
	it("advertises execute and collectReceipt", () => {
		const caps = getCapabilities();
		expect(caps.supports).toContain("applyProjection");
		expect(caps.supports).toContain("execute");
		expect(caps.supports).toContain("collectReceipt");
		expect(caps.deferred).toEqual([]);
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
		expect(obs.workItemStatuses.map((w) => w.id)).toEqual([
			"read_router",
			"patch_retry",
		]);
		expect(obs.projectionDiverged).toBe(false);
	});

	it("executes allowed commands via host", async () => {
		const host: KanbanInteropHost = {
			executeAllowedCommand: async ({ command }) => ({
				ok: true,
				result: { command },
			}),
			collectReceiptEvidence: async () => ({ evidenceRefs: [] }),
		};
		const ok = await execute({
			host,
			lease: fixtureLease,
			command: "apply_patch",
		});
		expect(ok.ok).toBe(true);
		const denied = await execute({
			host,
			lease: fixtureLease,
			command: "force_push",
		});
		expect(denied.ok).toBe(false);
	});

	it("collects a receipt from host evidence", async () => {
		const host: KanbanInteropHost = {
			executeAllowedCommand: async () => ({ ok: true }),
			collectReceiptEvidence: async () => ({
				evidenceRefs: ["diff:retry.ts"],
				decision: "accepted",
			}),
		};
		const result = await collectReceipt({
			host,
			lease: fixtureLease,
			run: fixtureRun,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.receipt.evidenceRefs).toEqual(["diff:retry.ts"]);
			expect(result.receipt.decision).toBe("accepted");
		}
	});
});
