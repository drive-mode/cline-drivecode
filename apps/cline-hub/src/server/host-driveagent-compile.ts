/**
 * Host-side enqueue for compiling a planning skill into `.driveagent/`.
 * Propose-only from Drive: writes under `.drive/plan-improve/host-compile/`
 * for the host compile pipeline — never mutates `.driveagent` from hub.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PlanningProposal } from "@cline/shared";

export type HostDriveagentCompileEnqueue = {
	kind: "host_driveagent_skill_compile";
	proposalId: string;
	offerKey: string;
	skillId: string;
	/** Target home slug hint — host resolves actual `.driveagent/<slug>/`. */
	homeSlugHint: string;
	evidence: PlanningProposal["evidence"];
	reasons: string[];
	relativePath: string;
};

export function hostCompileEnqueueRelativePath(proposalId: string): string {
	return `.drive/plan-improve/host-compile/${proposalId}.json`;
}

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
			`Host compile enqueue refused outside .drive/plan-improve: ${relativePath}`,
		);
	}
	return abs;
}

/**
 * Enqueue a host compile job after plan-improve accept of a planning_skill.
 * Does not write under `.driveagent/` — host owns that compile step.
 */
export async function enqueueHostDriveagentSkillCompile(input: {
	workspaceRoot: string;
	proposal: PlanningProposal;
	skillId: string;
	homeSlugHint?: string;
}): Promise<HostDriveagentCompileEnqueue> {
	const relativePath = hostCompileEnqueueRelativePath(input.proposal.id);
	const abs = assertUnderPlanImprove(input.workspaceRoot, relativePath);
	const payload: HostDriveagentCompileEnqueue = {
		kind: "host_driveagent_skill_compile",
		proposalId: input.proposal.id,
		offerKey: input.proposal.offerKey,
		skillId: input.skillId,
		homeSlugHint: input.homeSlugHint?.trim() || "planning",
		evidence: input.proposal.evidence,
		reasons: input.proposal.reasons,
		relativePath,
	};
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
	return payload;
}

/** Test helper */
export function hostCompileEnqueueAbsPath(
	workspaceRoot: string,
	proposalId: string,
): string {
	return join(workspaceRoot, hostCompileEnqueueRelativePath(proposalId));
}
