/**
 * Hub-local plan-improve resolve (DRV-PLAN-IMPROVE / Slice 3).
 *
 * Writes accepted artifacts under `<workspace>/.drive/plan-improve/` only.
 * Reject/mute are no-ops on disk. Skill accept also enqueues a host
 * `.driveagent` compile job under `.drive/plan-improve/host-compile/` —
 * hub never writes `.driveagent/` itself.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { type PlanImproveDecision, planPlanImproveResolve } from "@cline/drive";
import { type PlanningProposal, parsePlanningProposal } from "@cline/shared";
import { enqueueHostDriveagentSkillCompile } from "./host-driveagent-compile";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DrivePlanImproveWebviewFrame = {
	type: "drive_plan_improve_resolve";
	workspaceRoot: string;
	decision: PlanImproveDecision;
	proposal: unknown;
	requestId?: string;
	[key: string]: unknown;
};

function assertUnderPlanImprove(
	workspaceRoot: string,
	relativePath: string,
): string {
	const root = resolve(workspaceRoot);
	const abs = resolve(root, relativePath);
	const allowed = resolve(root, ".drive/plan-improve");
	const fromAllowed = relative(allowed, abs);
	if (fromAllowed.startsWith("..") || isAbsolute(fromAllowed)) {
		throw new Error(
			`Plan-improve write refused outside .drive/plan-improve: ${relativePath}`,
		);
	}
	return abs;
}

/**
 * Accept | reject | mute a planning proposal.
 * Accept is the only durable write (plan-improve artifact or skill enqueue file).
 */
export async function handleDrivePlanImproveWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DrivePlanImproveWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	if (!workspaceRoot) {
		ctx.send(peer, {
			type: "drive_plan_improve_error",
			text: "workspaceRoot is required.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	const decision = frame.decision;
	if (decision !== "accept" && decision !== "reject" && decision !== "mute") {
		ctx.send(peer, {
			type: "drive_plan_improve_error",
			text: "decision must be accept | reject | mute.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	let proposal: PlanningProposal;
	try {
		proposal = parsePlanningProposal(frame.proposal);
	} catch (error) {
		ctx.send(peer, {
			type: "drive_plan_improve_error",
			text: error instanceof Error ? error.message : String(error),
			code: "invalid_proposal",
			requestId,
		});
		return;
	}

	try {
		const plan = planPlanImproveResolve({ proposal, decision });
		let wrote = false;
		let relativePath: string | undefined;

		if (plan.action === "write_artifact" || plan.action === "enqueue_skill") {
			const rel =
				plan.action === "write_artifact"
					? plan.relativePath
					: `.drive/plan-improve/queue/${plan.proposal.id}.json`;
			const abs = assertUnderPlanImprove(workspaceRoot, rel);
			await mkdir(dirname(abs), { recursive: true });
			const body =
				plan.action === "write_artifact"
					? `${JSON.stringify(plan.payload, null, 2)}\n`
					: `${JSON.stringify(
							{
								kind: "planning_skill_enqueue",
								skillId: plan.skillId,
								proposalId: plan.proposal.id,
								offerKey: plan.proposal.offerKey,
								evidence: plan.proposal.evidence,
								reasons: plan.proposal.reasons,
							},
							null,
							2,
						)}\n`;
			await writeFile(abs, body, "utf8");
			wrote = true;
			relativePath = rel;
			if (plan.action === "enqueue_skill") {
				await enqueueHostDriveagentSkillCompile({
					workspaceRoot,
					proposal: plan.proposal,
					skillId: plan.skillId,
				});
			}
		}

		ctx.send(peer, {
			type: "drive_plan_improve_resolved",
			decision,
			wrote,
			relativePath,
			offerKey: proposal.offerKey,
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_plan_improve_error",
			text: error instanceof Error ? error.message : String(error),
			code: "drive_plan_improve_failed",
			requestId,
		});
	}
}

/** Test helper: resolve path join for fixtures. */
export function planImproveAcceptedPath(
	workspaceRoot: string,
	proposalId: string,
): string {
	return join(
		workspaceRoot,
		".drive/plan-improve/accepted",
		`${proposalId}.json`,
	);
}
