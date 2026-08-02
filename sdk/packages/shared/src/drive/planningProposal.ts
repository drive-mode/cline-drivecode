/**
 * Gated planning-improvement proposals (DRV-PLAN-IMPROVE / ADR-0004).
 *
 * Evidence = event ids / artifact paths / skill ids / task+plan ids only.
 * Never utterances, transcripts, or audio.
 */

import { z } from "zod";

export const PLANNING_PROPOSAL_FORBIDDEN_KEYS = [
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

export const StallReasonCodeSchema = z.enum([
	"low_s2",
	"high_p1",
	"sticky_p2",
]);
export type SharedStallReasonCode = z.infer<typeof StallReasonCodeSchema>;

/** Evidence pointers only — no embedded prose blobs. */
export const PlanningProposalEvidenceSchema = z
	.object({
		eventIds: z.array(z.string().min(1)).default([]),
		artifactPaths: z.array(z.string().min(1)).default([]),
		skillIds: z.array(z.string().min(1)).default([]),
		taskIds: z.array(z.string().min(1)).default([]),
		planIds: z.array(z.string().min(1)).default([]),
	})
	.strict();
export type PlanningProposalEvidence = z.infer<
	typeof PlanningProposalEvidenceSchema
>;

/**
 * Allowed durable targets after accept.
 * Host skill compile / `.driveagent` write is outside this schema — accept
 * may only enqueue these refs or write a local plan-improve artifact.
 */
export const PlanningProposalTargetSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("planning_skill"),
			skillId: z.string().min(1),
		})
		.strict(),
	z
		.object({
			type: z.literal("plan_template"),
			templateId: z.string().min(1),
			/** Relative path under workspace `.drive/plan-improve/` only. */
			relativePath: z.string().min(1),
		})
		.strict(),
]);
export type PlanningProposalTarget = z.infer<
	typeof PlanningProposalTargetSchema
>;

export const PlanningProposalSchema = z
	.object({
		kind: z.literal("planning"),
		id: z.string().min(1),
		/** Mute / identical re-offer key. */
		offerKey: z.string().min(1),
		callSessionId: z.string().min(1).optional(),
		reasons: z.array(StallReasonCodeSchema).min(1),
		evidence: PlanningProposalEvidenceSchema,
		target: PlanningProposalTargetSchema,
		/**
		 * Structured label for UI (reason codes / skill id) — not user speech.
		 * Kept short; forbidden-key walker still bans utterance-like *keys*.
		 */
		label: z.string().min(1).max(200),
	})
	.strict();
export type PlanningProposal = z.infer<typeof PlanningProposalSchema>;

export function parsePlanningProposal(input: unknown): PlanningProposal {
	assertNoForbiddenPlanningProposalKeys(input);
	return PlanningProposalSchema.parse(input);
}

export function planningProposalIsPrivate(value: unknown): boolean {
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

export function assertNoForbiddenPlanningProposalKeys(
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
		for (const forbidden of PLANNING_PROPOSAL_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				throw new Error(
					`Planning proposal must not include forbidden key "${key}" at ${[...path, key].join(".") || "(root)"}`,
				);
			}
		}
		assertNoForbiddenPlanningProposalKeys(child, [...path, key]);
	}
}
