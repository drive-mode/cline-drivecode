import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseAndPropose } from "@cline/drive";
import { afterEach, describe, expect, it } from "vitest";
import {
	handleDrivePlanImproveWebviewCommand,
	planImproveAcceptedPath,
} from "./drive-plan-improve";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

describe("handleDrivePlanImproveWebviewCommand", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	function mockCtx(): { ctx: HubContext; sent: unknown[] } {
		const sent: unknown[] = [];
		const ctx = {
			send: (_peer: BrowserPeer, message: unknown) => {
				sent.push(message);
			},
		} as HubContext;
		return { ctx, sent };
	}

	it("reject leaves disk unchanged", async () => {
		const root = await mkdtemp(join(tmpdir(), "plan-improve-"));
		dirs.push(root);
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 2,
				failureStickyCount: 0,
			},
			openFailures: [],
			nowTaskId: "t1",
			callSessionId: "cs-r",
			proposalId: "pp-hub-reject",
		});
		expect(proposal).not.toBeNull();
		const { ctx, sent } = mockCtx();
		await handleDrivePlanImproveWebviewCommand(ctx, {} as BrowserPeer, {
			type: "drive_plan_improve_resolve",
			workspaceRoot: root,
			decision: "reject",
			proposal,
		});
		expect(sent[0]).toMatchObject({
			type: "drive_plan_improve_resolved",
			decision: "reject",
			wrote: false,
		});
		await expect(
			readFile(planImproveAcceptedPath(root, "pp-hub-reject"), "utf8"),
		).rejects.toThrow();
	});

	it("accept writes only under .drive/plan-improve", async () => {
		const root = await mkdtemp(join(tmpdir(), "plan-improve-"));
		dirs.push(root);
		const proposal = diagnoseAndPropose({
			rollup: {
				tasksCompleted: 0,
				midPlanAddCount: 0,
				failureStickyCount: 1,
			},
			openFailures: [{ taskId: "t1", lastFailure: "tests red" }],
			nowTaskId: "t1",
			callSessionId: "cs-a",
			proposalId: "pp-hub-accept",
		});
		expect(proposal).not.toBeNull();
		const { ctx, sent } = mockCtx();
		await handleDrivePlanImproveWebviewCommand(ctx, {} as BrowserPeer, {
			type: "drive_plan_improve_resolve",
			workspaceRoot: root,
			decision: "accept",
			proposal,
		});
		expect(sent[0]).toMatchObject({
			type: "drive_plan_improve_resolved",
			decision: "accept",
			wrote: true,
			relativePath: ".drive/plan-improve/accepted/pp-hub-accept.json",
		});
		const raw = await readFile(
			planImproveAcceptedPath(root, "pp-hub-accept"),
			"utf8",
		);
		const parsed = JSON.parse(raw) as { kind: string };
		expect(parsed.kind).toBe("planning_accepted");
		expect(raw.toLowerCase()).not.toContain("utterance");
	});

	it("rejects smuggled utterance keys on proposal", async () => {
		const root = await mkdtemp(join(tmpdir(), "plan-improve-"));
		dirs.push(root);
		const { ctx, sent } = mockCtx();
		await handleDrivePlanImproveWebviewCommand(ctx, {} as BrowserPeer, {
			type: "drive_plan_improve_resolve",
			workspaceRoot: root,
			decision: "accept",
			proposal: {
				kind: "planning",
				id: "pp-bad",
				offerKey: "x",
				reasons: ["low_s2"],
				evidence: {
					eventIds: [],
					artifactPaths: [],
					skillIds: [],
					taskIds: [],
					planIds: [],
				},
				target: {
					type: "plan_template",
					templateId: "t",
					relativePath: "accepted/pp-bad.json",
				},
				label: "bad",
				utterance: "nope",
			},
		});
		expect(sent[0]).toMatchObject({
			type: "drive_plan_improve_error",
			code: "invalid_proposal",
		});
	});
});
