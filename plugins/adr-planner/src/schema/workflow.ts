import { z } from "zod";
import { ArtifactRouteSchema, RequestedLifecycleGateSchema } from "./enums";
import {
	DiagnosticSchema,
	EvidenceRefSchema,
	IdentifierSchema,
	ProjectProfileSchema,
} from "./models";
import {
	ConcernPlanningResultSchema,
	PlanningFactKeySchema,
	PlanningFactSchema,
} from "./planning";

export const WorkflowModeSchema = z.enum(["preplan", "plan"]);

export const PlanningAttestationSchema = z
	.object({
		fact: PlanningFactSchema,
		evidence: EvidenceRefSchema,
	})
	.strict();

export const PlanningSessionSnapshotSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		mode: WorkflowModeSchema,
		requestedGate: RequestedLifecycleGateSchema,
		attestations: z.array(PlanningAttestationSchema).max(32),
	})
	.strict();

export const MaterialQuestionSchema = z
	.object({
		id: IdentifierSchema,
		factKey: PlanningFactKeySchema,
		question: z.string().min(1).max(512),
		changesConcernIds: z.array(IdentifierSchema).min(1),
		changes: z
			.array(
				z.enum([
					"applicability",
					"route",
					"urgency",
					"prerequisite",
					"readiness",
				]),
			)
			.min(1),
		answerCommand: z.string().min(1).max(256),
	})
	.strict();

export const MaterialQuestionQueueSchema = z
	.object({
		maxQuestions: z.number().int().positive().max(32),
		truncated: z.boolean(),
		omittedCount: z.number().int().nonnegative(),
		questions: z.array(MaterialQuestionSchema).max(32),
	})
	.strict();

export const WorkflowExperimentSchema = z
	.object({
		id: IdentifierSchema,
		concernId: IdentifierSchema,
		questionId: IdentifierSchema.optional(),
		hypothesis: z.string().min(1).max(512),
		method: z.string().min(1).max(512),
		metric: z.string().min(1).max(256),
		timebox: z.string().min(1).max(128),
		ownerState: z.literal("unassigned"),
		decisionRule: z.string().min(1).max(512),
		requiredEvidence: z.array(z.string().min(1).max(256)).min(1).max(8),
	})
	.strict();

export const WorkflowRoutedOutputSchema = z
	.object({
		id: IdentifierSchema,
		concernId: IdentifierSchema,
		route: ArtifactRouteSchema.exclude(["adr", "none"]),
		state: z.literal("unresolved"),
		statement: z.string().min(1).max(1024),
		evidenceRefs: z.array(IdentifierSchema),
	})
	.strict();

export const ReadinessObligationStatusSchema = z.enum([
	"unknown",
	"pass",
	"fail",
	"waived",
	"not_applicable",
]);

export const WorkflowReadinessObligationSchema = z
	.object({
		id: IdentifierSchema,
		concernId: IdentifierSchema,
		gate: RequestedLifecycleGateSchema,
		ownerState: z.literal("unassigned"),
		requiredEvidence: z.array(z.string().min(1).max(256)).min(1).max(8),
		freshness: z.literal("same-plan"),
		blocking: z.boolean(),
		status: ReadinessObligationStatusSchema,
		evidenceRefs: z.array(IdentifierSchema),
		rationale: z.string().min(1).max(1024),
	})
	.strict();

export const WorkflowReadinessSummarySchema = z
	.object({
		requestedGate: RequestedLifecycleGateSchema,
		status: z.enum(["pass", "blocked", "not_applicable"]),
		blockerIds: z.array(IdentifierSchema),
		warningIds: z.array(IdentifierSchema),
	})
	.strict();

export const CanonicalWorkflowPlanSchema = z
	.object({
		schemaVersion: z.literal("m4.1"),
		policyVersion: z.literal("m4-workflow.1"),
		mode: WorkflowModeSchema,
		requestedGate: RequestedLifecycleGateSchema,
		authority: z.literal("host-composed"),
		catalogVersion: z.string().min(1),
		catalogDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		profile: ProjectProfileSchema,
		planningFacts: z.array(PlanningFactSchema),
		concernPlan: ConcernPlanningResultSchema,
		questionQueue: MaterialQuestionQueueSchema,
		experiments: z.array(WorkflowExperimentSchema),
		routedOutputs: z.array(WorkflowRoutedOutputSchema),
		readinessObligations: z.array(WorkflowReadinessObligationSchema),
		readiness: WorkflowReadinessSummarySchema,
		nextWaveConcernIds: z.array(IdentifierSchema).max(3),
		diagnostics: z.array(DiagnosticSchema),
	})
	.strict()
	.superRefine((plan, context) => {
		if (plan.concernPlan.status !== "evaluated") {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Canonical workflow plans require an evaluated concern plan",
				path: ["concernPlan"],
			});
		}
		if (plan.concernPlan.authority !== "host-composed") {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Canonical workflow plans require host-composed concern authority",
				path: ["concernPlan", "authority"],
			});
		}
		if (
			plan.catalogVersion !== plan.concernPlan.catalogVersion ||
			plan.catalogDigest !== plan.concernPlan.catalogDigest
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Workflow and concern catalog identities must match",
				path: ["catalogVersion"],
			});
		}
	});

export const WorkflowCompilationResultSchema = z.discriminatedUnion("status", [
	z
		.object({
			status: z.literal("compiled"),
			plan: CanonicalWorkflowPlanSchema,
			canonicalJson: z.string().min(1),
			markdown: z.string().min(1),
			diagnostics: z.array(DiagnosticSchema),
		})
		.strict(),
	z
		.object({
			status: z.literal("blocked"),
			plan: z.null(),
			canonicalJson: z.null(),
			markdown: z.null(),
			diagnostics: z.array(DiagnosticSchema).min(1),
		})
		.strict(),
]);

export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;
export type PlanningAttestation = z.infer<typeof PlanningAttestationSchema>;
export type PlanningSessionSnapshot = z.infer<
	typeof PlanningSessionSnapshotSchema
>;
export type MaterialQuestion = z.infer<typeof MaterialQuestionSchema>;
export type WorkflowExperiment = z.infer<typeof WorkflowExperimentSchema>;
export type WorkflowRoutedOutput = z.infer<typeof WorkflowRoutedOutputSchema>;
export type WorkflowReadinessObligation = z.infer<
	typeof WorkflowReadinessObligationSchema
>;
export type CanonicalWorkflowPlan = z.infer<typeof CanonicalWorkflowPlanSchema>;
export type WorkflowCompilationResult = z.infer<
	typeof WorkflowCompilationResultSchema
>;
