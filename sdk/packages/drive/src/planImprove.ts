/**
 * Post-session / after-End gated plan improve (DRV-PLAN-IMPROVE / Slice 3).
 *
 * Distinct from in-call StuckRecoveryFork (W1.3 / W4.1). Diagnose uses the
 * shared stall classifier; proposals are `kind: planning` with evidence ids
 * only. Accept writes a safe local artifact under `.drive/plan-improve/`;
 * reject / mute leave disk unchanged.
 *
 * Boundary: this module does **not** invoke host planning skills or compile
 * `.driveagent` homes. Accept either writes the local artifact (plan_template)
 * or records an enqueue intent (planning_skill) for the host to consume later.
 */

import type {
	PlanningProposal,
	PlanningProposalEvidence,
	PlanningProposalTarget,
} from "@cline/shared";
import type { BankFs } from "./bankFs.js";
import {
	type ClassifyStallInput,
	classifyStall,
	type StallReasonCode,
} from "./stallClassifier.js";

export const PLAN_IMPROVE_ROOT = ".drive/plan-improve";
export const PLAN_IMPROVE_ACCEPTED_DIR = `${PLAN_IMPROVE_ROOT}/accepted`;
export const PLAN_IMPROVE_DEFAULT_SKILL_ID = "drive.plan-improve";
export const PLAN_IMPROVE_DEFAULT_TEMPLATE_ID = "stall-recovery-v1";

export const PLAN_IMPROVE_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"text",
	"fullTranscript",
	"audio",
] as const;

/** Local runtime copies — `@cline/drive` must not value-import `@cline/shared`. */
function assertNoForbiddenPlanningProposalKeys(
	value: unknown,
	path: string[] = [],
): void {
	if (value === null || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenPlanningProposalKeys(item, [...path, String(index)]);
		}
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		const lower = key.toLowerCase();
		for (const forbidden of PLAN_IMPROVE_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				throw new Error(
					`Planning proposal must not include forbidden key "${key}" at ${[...path, key].join(".") || "(root)"}`,
				);
			}
		}
		assertNoForbiddenPlanningProposalKeys(child, [...path, key]);
	}
}

function parsePlanningProposal(input: unknown): PlanningProposal {
	assertNoForbiddenPlanningProposalKeys(input);
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Planning proposal must be an object");
	}
	const record = input as Record<string, unknown>;
	if (record.kind !== "planning") {
		throw new Error('Planning proposal kind must be "planning"');
	}
	if (typeof record.id !== "string" || !record.id.trim()) {
		throw new Error("Planning proposal requires id");
	}
	if (typeof record.offerKey !== "string" || !record.offerKey.trim()) {
		throw new Error("Planning proposal requires offerKey");
	}
	if (typeof record.label !== "string" || !record.label.trim()) {
		throw new Error("Planning proposal requires label");
	}
	if (!Array.isArray(record.reasons) || record.reasons.length < 1) {
		throw new Error("Planning proposal requires reasons");
	}
	if (record.evidence === null || typeof record.evidence !== "object") {
		throw new Error("Planning proposal requires evidence");
	}
	if (record.target === null || typeof record.target !== "object") {
		throw new Error("Planning proposal requires target");
	}
	return input as PlanningProposal;
}

export type PlanImproveDecision = "accept" | "reject" | "mute";

export type DiagnoseAndProposeInput = ClassifyStallInput & {
	callSessionId?: string | null;
	/** Evidence pointers (ids / paths only). */
	evidence?: Partial<PlanningProposalEvidence>;
	/** Prefer plan_template (local artifact) vs planning_skill (host enqueue). */
	targetType?: PlanningProposalTarget["type"];
	proposalId?: string;
};

export type PlanImproveAcceptPlan =
	| {
			action: "write_artifact";
			proposal: PlanningProposal;
			/** Absolute-relative workspace path under `.drive/plan-improve/`. */
			relativePath: string;
			payload: PlanImproveAcceptedArtifact;
	  }
	| {
			action: "enqueue_skill";
			proposal: PlanningProposal;
			skillId: string;
			/** Host must consume — no harness skill runtime here. */
			hostBoundary: "enqueue_only";
	  }
	| {
			action: "reject";
			proposal: PlanningProposal;
			offerKey: string;
	  }
	| {
			action: "mute";
			proposal: PlanningProposal;
			offerKey: string;
	  };

/** Durable local artifact written only on accept (plan_template target). */
export type PlanImproveAcceptedArtifact = {
	kind: "planning_accepted";
	proposalId: string;
	offerKey: string;
	callSessionId?: string;
	reasons: StallReasonCode[];
	evidence: PlanningProposalEvidence;
	target: PlanningProposalTarget;
	acceptedAt: string;
};

export type PlanImproveQueueEntry = {
	proposal: PlanningProposal;
	status: "pending" | "accepted" | "rejected" | "muted";
};

/** In-memory proposal store (session-tier until accept). */
export type PlanImproveProposalStore = {
	get(id: string): PlanImproveQueueEntry | undefined;
	listPending(): PlanningProposal[];
	enqueue(proposal: PlanningProposal): void;
	/** Reject / mute — no disk write. */
	resolve(id: string, decision: "reject" | "mute"): boolean;
	/** Mark accepted after durable write succeeded. */
	markAccepted(id: string): boolean;
};

export function createMemoryPlanImproveStore(): PlanImproveProposalStore {
	const entries = new Map<string, PlanImproveQueueEntry>();
	return {
		get(id) {
			return entries.get(id);
		},
		listPending() {
			return [...entries.values()]
				.filter((entry) => entry.status === "pending")
				.map((entry) => entry.proposal);
		},
		enqueue(proposal) {
			assertNoForbiddenPlanningProposalKeys(proposal);
			parsePlanningProposal(proposal);
			entries.set(proposal.id, { proposal, status: "pending" });
		},
		resolve(id, decision) {
			const entry = entries.get(id);
			if (!entry || entry.status !== "pending") {
				return false;
			}
			entries.set(id, {
				...entry,
				status: decision === "reject" ? "rejected" : "muted",
			});
			return true;
		},
		markAccepted(id) {
			const entry = entries.get(id);
			if (!entry || entry.status !== "pending") {
				return false;
			}
			entries.set(id, { ...entry, status: "accepted" });
			return true;
		},
	};
}

export function planningImproveOfferKey(
	callSessionId: string | null | undefined,
	reasons: readonly StallReasonCode[],
	primaryTaskId: string | null,
): string {
	const session = callSessionId?.trim() || "no-session";
	const reasonPart = reasons.slice().sort().join("+") || "none";
	const taskPart = primaryTaskId?.trim() || "no-task";
	return `${session}::${reasonPart}::${taskPart}`;
}

/**
 * Diagnose stall → one reviewable planning proposal (or null if not stalled).
 * Pure — does not write disk or mutate the bank.
 */
export function diagnoseAndPropose(
	input: DiagnoseAndProposeInput,
): PlanningProposal | null {
	const classification = classifyStall(input);
	if (!classification.stalled || classification.reasons.length === 0) {
		return null;
	}

	const callSessionId = input.callSessionId?.trim() || undefined;
	const offerKey = planningImproveOfferKey(
		callSessionId,
		classification.reasons,
		classification.primaryTaskId,
	);
	const stamp = Date.now().toString(36);
	const id = input.proposalId?.trim() || `pp-${stamp}`;

	const taskIds = [
		...new Set([
			...(input.evidence?.taskIds ?? []),
			...input.openFailures.map((entry) => entry.taskId),
			...(classification.primaryTaskId ? [classification.primaryTaskId] : []),
		]),
	].filter(Boolean);

	const evidence: PlanningProposalEvidence = {
		eventIds: [...(input.evidence?.eventIds ?? [])],
		artifactPaths: [...(input.evidence?.artifactPaths ?? [])],
		skillIds: [
			...new Set([
				...(input.evidence?.skillIds ?? []),
				PLAN_IMPROVE_DEFAULT_SKILL_ID,
			]),
		],
		taskIds,
		planIds: [...(input.evidence?.planIds ?? [])],
	};

	const targetType = input.targetType ?? "plan_template";
	const target: PlanningProposalTarget =
		targetType === "planning_skill"
			? {
					type: "planning_skill",
					skillId: PLAN_IMPROVE_DEFAULT_SKILL_ID,
				}
			: {
					type: "plan_template",
					templateId: PLAN_IMPROVE_DEFAULT_TEMPLATE_ID,
					relativePath: `accepted/${id}.json`,
				};

	const proposal: PlanningProposal = {
		kind: "planning",
		id,
		offerKey,
		...(callSessionId ? { callSessionId } : {}),
		reasons: [...classification.reasons],
		evidence,
		target,
		label: `Plan improve: ${classification.reasons.join("+")}`,
	};

	return parsePlanningProposal(proposal);
}

/**
 * Pure accept / reject / mute planner. Nothing writes until applyPlanImproveAccept.
 */
export function planPlanImproveResolve(input: {
	proposal: PlanningProposal;
	decision: PlanImproveDecision;
	acceptedAt?: string;
}): PlanImproveAcceptPlan {
	assertNoForbiddenPlanningProposalKeys(input.proposal);
	const proposal = parsePlanningProposal(input.proposal);

	switch (input.decision) {
		case "reject":
			return {
				action: "reject",
				proposal,
				offerKey: proposal.offerKey,
			};
		case "mute":
			return {
				action: "mute",
				proposal,
				offerKey: proposal.offerKey,
			};
		case "accept": {
			if (proposal.target.type === "planning_skill") {
				return {
					action: "enqueue_skill",
					proposal,
					skillId: proposal.target.skillId,
					hostBoundary: "enqueue_only",
				};
			}
			const relativePath = `${PLAN_IMPROVE_ROOT}/${proposal.target.relativePath}`;
			const artifact: PlanImproveAcceptedArtifact = {
				kind: "planning_accepted",
				proposalId: proposal.id,
				offerKey: proposal.offerKey,
				...(proposal.callSessionId
					? { callSessionId: proposal.callSessionId }
					: {}),
				reasons: [...proposal.reasons] as StallReasonCode[],
				evidence: proposal.evidence,
				target: proposal.target,
				acceptedAt: input.acceptedAt ?? new Date().toISOString(),
			};
			assertNoForbiddenPlanningProposalKeys(artifact);
			return {
				action: "write_artifact",
				proposal,
				relativePath,
				payload: artifact,
			};
		}
		default: {
			const _exhaustive: never = input.decision;
			return _exhaustive;
		}
	}
}

/**
 * Apply accept plan to BankFs (workspace-relative). Reject/mute are no-ops on disk.
 * Returns whether a durable write occurred.
 *
 * Host skill compile is out of scope — `enqueue_skill` only writes a queue
 * JSON under `.drive/plan-improve/queue/` for the host to consume later.
 */
export async function applyPlanImproveAccept(
	fs: BankFs,
	plan: PlanImproveAcceptPlan,
): Promise<{ wrote: boolean; relativePath?: string }> {
	switch (plan.action) {
		case "reject":
		case "mute":
			return { wrote: false };
		case "enqueue_skill": {
			const relativePath = `${PLAN_IMPROVE_ROOT}/queue/${plan.proposal.id}.json`;
			const body = `${JSON.stringify(
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
			assertNoForbiddenPlanningProposalKeys(JSON.parse(body));
			await fs.write(relativePath, body);
			return { wrote: true, relativePath };
		}
		case "write_artifact": {
			const body = `${JSON.stringify(plan.payload, null, 2)}\n`;
			await fs.write(plan.relativePath, body);
			return { wrote: true, relativePath: plan.relativePath };
		}
		default: {
			const _exhaustive: never = plan;
			return _exhaustive;
		}
	}
}

export function planImproveIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	try {
		assertNoForbiddenPlanningProposalKeys(value);
		return true;
	} catch {
		return false;
	}
}
