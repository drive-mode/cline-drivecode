import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { HubTransportContext } from "./context";
import { handleDrivePlanCommand } from "./drive-driveplan-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-dp-1",
		payload,
	};
}

const fixtureRun = {
	id: "run_auth_retry_v1",
	driveTaskId: "auth-retry-race",
	title: "Fix auth retry race",
	status: "running" as const,
	spec: {
		revision: 1,
		maxParallel: 3,
		gates: [
			{
				id: "g0",
				kind: "gate.admission" as const,
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
				writeClaims: [] as string[],
				isolation: "readonly" as const,
				evidenceRequirements: ["paths:router"],
				status: "PENDING" as const,
			},
			{
				id: "patch_retry",
				objective: "Patch retry",
				writeClaims: ["src/auth.ts"],
				isolation: "worktree_isolated" as const,
				evidenceRequirements: ["diff:auth"],
				status: "PENDING" as const,
			},
		],
	},
};

describe("handleDrivePlanCommand", () => {
	let root = "";

	afterEach(async () => {
		if (root) {
			await rm(root, { recursive: true, force: true });
			root = "";
		}
	});

	it("puts run, lists eligible, claims, reports, and projects", async () => {
		root = await mkdtemp(join(tmpdir(), "driveplan-hub-"));
		const ctx = {} as HubTransportContext;

		const put = await handleDrivePlanCommand(
			ctx,
			envelope("driveplan.put_run", {
				workspaceRoot: root,
				run: fixtureRun,
			}),
		);
		expect(put.ok).toBe(true);

		const eligible = await handleDrivePlanCommand(
			ctx,
			envelope("driveplan.list_eligible_work", {
				workspaceRoot: root,
				runId: fixtureRun.id,
			}),
		);
		expect(eligible.ok).toBe(true);
		expect(
			(eligible.payload?.workItems as unknown[]).length,
		).toBe(2);

		const claim = await handleDrivePlanCommand(
			ctx,
			envelope("driveplan.claim_work", {
				workspaceRoot: root,
				runId: fixtureRun.id,
				workItemId: "read_router",
				idempotencyKey: "idem-1",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
		);
		expect(claim.ok).toBe(true);
		expect((claim.payload?.lease as { workItemId: string }).workItemId).toBe(
			"read_router",
		);

		const progress = await handleDrivePlanCommand(
			ctx,
			envelope("driveplan.report_progress", {
				workspaceRoot: root,
				runId: fixtureRun.id,
				workItemId: "read_router",
				status: "SUCCESS",
			}),
		);
		expect(progress.ok).toBe(true);

		const project = await handleDrivePlanCommand(
			ctx,
			envelope("driveplan.project_to_kanban", {
				workspaceRoot: root,
				runId: fixtureRun.id,
			}),
		);
		expect(project.ok).toBe(true);
		const projection = project.payload?.projection as {
			cards: unknown[];
		};
		expect(projection.cards.length).toBe(2);
		expect(typeof project.payload?.artifactPath).toBe("string");
	});
});
