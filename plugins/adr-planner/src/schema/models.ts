import { z } from "zod";
import {
	ApplicabilitySchema,
	ArtifactKindSchema,
	ArtifactRouteSchema,
	CriticalitySchema,
	DataTrustSchema,
	DeliveryGovernanceSchema,
	DiagnosticSeveritySchema,
	EvidenceSourceTypeSchema,
	InferenceSeveritySchema,
	InferenceStatusSchema,
	LifecycleChangeSchema,
	LifecycleGateSchema,
	ProductSurfaceSchema,
	ReadinessEffectSchema,
	ReadinessStatusSchema,
	RequestedLifecycleGateSchema,
	ResolutionSchema,
	ResolutionStateSchema,
	RuntimeTopologySchema,
	ScaleReliabilitySchema,
	SignificanceReasonSchema,
	UrgencySchema,
} from "./enums";

export const IdentifierSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/);

export const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const CommitSchema = z.string().min(7).max(64);
export const IsoDateTimeSchema = z
	.string()
	.refine(
		(value) => !Number.isNaN(Date.parse(value)),
		"Expected an ISO-compatible date-time",
	);

export const DiagnosticSchema = z
	.object({
		code: z.string().min(1),
		severity: DiagnosticSeveritySchema,
		message: z.string().min(1),
		path: z.string().optional(),
		concernIds: z.array(IdentifierSchema).default([]),
	})
	.strict();

export const ProducerSchema = z
	.object({
		name: z.string().min(1),
		version: z.string().min(1),
		commit: CommitSchema,
	})
	.strict();

export const EvidenceRefSchema = z
	.object({
		id: IdentifierSchema,
		sourceType: EvidenceSourceTypeSchema,
		source: z.string().min(1),
		locator: z.string().min(1).optional(),
		digest: Sha256Schema.optional(),
		claim: z.string().min(1),
	})
	.strict();

export const UnsupportedInferenceSchema = z
	.object({
		id: IdentifierSchema,
		claim: z.string().min(1),
		severity: InferenceSeveritySchema,
		status: InferenceStatusSchema,
		evidenceRefs: z.array(IdentifierSchema).default([]),
		affectsConcernIds: z.array(IdentifierSchema).default([]),
	})
	.strict();

export const EvidenceInventorySchema = z
	.object({
		evidence: z.array(EvidenceRefSchema),
		unsupportedInferences: z.array(UnsupportedInferenceSchema).default([]),
	})
	.strict();

export const ProjectProfileSchema = z
	.object({
		productSurface: z.array(ProductSurfaceSchema).min(1),
		lifecycleChange: z.array(LifecycleChangeSchema).min(1),
		dataTrust: z.array(DataTrustSchema).min(1),
		runtimeTopology: z.array(RuntimeTopologySchema).min(1),
		scaleReliability: z.array(ScaleReliabilitySchema).min(1),
		deliveryGovernance: z.array(DeliveryGovernanceSchema).min(1),
		evidenceRefs: z.array(IdentifierSchema).default([]),
		unknowns: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const RiskAcceptanceSchema = z
	.object({
		acceptedBy: z.string().min(1),
		acceptedAt: IsoDateTimeSchema,
		evidenceRefs: z.array(IdentifierSchema).min(1),
	})
	.strict();

export const ConcernRecordSchema = z
	.object({
		id: IdentifierSchema,
		concern: z.string().min(1),
		applicability: ApplicabilitySchema,
		resolution: ResolutionSchema,
		state: ResolutionStateSchema,
		urgency: UrgencySchema,
		artifactRoute: ArtifactRouteSchema,
		lifecycleGate: LifecycleGateSchema,
		criticality: CriticalitySchema,
		significanceReasons: z.array(SignificanceReasonSchema).default([]),
		prerequisites: z.array(IdentifierSchema).default([]),
		readinessEffect: ReadinessEffectSchema,
		evidenceRefs: z.array(IdentifierSchema).default([]),
		resolutionEvidenceRefs: z.array(IdentifierSchema).default([]),
		unsupportedInferenceRefs: z.array(IdentifierSchema).default([]),
		unknowns: z.array(z.string().min(1)).default([]),
		rationale: z.string().min(1),
		acceptance: RiskAcceptanceSchema.optional(),
	})
	.strict();

export const ConcernInventorySchema = z
	.object({ concerns: z.array(ConcernRecordSchema) })
	.strict();

export const PrerequisiteEdgeSchema = z
	.object({
		from: IdentifierSchema,
		to: IdentifierSchema,
	})
	.strict();

export const PrerequisiteGraphSchema = z
	.object({
		nodes: z.array(IdentifierSchema),
		edges: z.array(PrerequisiteEdgeSchema),
	})
	.strict();

export const QuestionSchema = z
	.object({
		id: IdentifierSchema,
		question: z.string().min(1),
		changesConcernIds: z.array(IdentifierSchema).min(1),
		answeredByEvidence: z.boolean().default(false),
	})
	.strict();

export const ExperimentSchema = z
	.object({
		id: IdentifierSchema,
		questionId: IdentifierSchema.optional(),
		concernIds: z.array(IdentifierSchema).min(1),
		method: z.string().min(1),
		acceptanceEvidence: z.string().min(1),
	})
	.strict();

export const QuestionQueueSchema = z
	.object({
		questions: z.array(QuestionSchema),
		experiments: z.array(ExperimentSchema).default([]),
	})
	.strict();

export const AdrCandidateSchema = z
	.object({
		id: IdentifierSchema,
		concernId: IdentifierSchema,
		title: z.string().min(1),
		status: z.literal("proposed"),
		significanceReasons: z.array(SignificanceReasonSchema).min(1),
		alternativesKnown: z.boolean(),
	})
	.strict();

export const AdrCandidatesSchema = z
	.object({ candidates: z.array(AdrCandidateSchema) })
	.strict();

export const RoutedPlanningOutputSchema = z
	.object({
		id: IdentifierSchema,
		concernIds: z.array(IdentifierSchema).min(1),
		statement: z.string().min(1),
		evidenceRefs: z.array(IdentifierSchema).default([]),
	})
	.strict();

export const PlanningOutputsSchema = z
	.object({
		requirements: z.array(RoutedPlanningOutputSchema).default([]),
		risks: z.array(RoutedPlanningOutputSchema).default([]),
		operationalObligations: z.array(RoutedPlanningOutputSchema).default([]),
	})
	.strict();

export const GateApplicabilitySchema = z
	.object({
		applicability: z.enum(["applicable", "not_applicable"]),
		rationale: z.string().min(1),
		evidenceRefs: z.array(IdentifierSchema).default([]),
	})
	.strict();

export const ReadinessInputSchema = z
	.object({
		policyVersion: z.string().min(1),
		requestedGate: RequestedLifecycleGateSchema,
		gateApplicability: GateApplicabilitySchema,
		evidence: z.array(EvidenceRefSchema),
		unsupportedInferences: z.array(UnsupportedInferenceSchema).default([]),
		concerns: z.array(ConcernRecordSchema),
	})
	.strict();

export const ReadinessResultSchema = z
	.object({
		policyVersion: z.string().min(1),
		requestedGate: RequestedLifecycleGateSchema,
		status: ReadinessStatusSchema,
		evaluatedConcernIds: z.array(IdentifierSchema),
		blockerIds: z.array(IdentifierSchema),
		warningIds: z.array(IdentifierSchema),
		diagnostics: z.array(DiagnosticSchema),
	})
	.strict();

export const RunManifestSchema = z
	.object({
		runId: IdentifierSchema,
		plugin: ProducerSchema,
		evaluator: z
			.object({ version: z.string().min(1), commit: CommitSchema })
			.strict(),
		model: z
			.object({
				provider: z.string().min(1),
				model: z.string().min(1),
				settings: z.record(z.string(), z.unknown()).default({}),
			})
			.strict(),
		promptSha256: Sha256Schema,
		caseSetVersion: z.string().min(1),
		caseId: IdentifierSchema.optional(),
	})
	.strict();

export const ArtifactEnvelopeSchema = z
	.object({
		schemaVersion: z.literal("1"),
		artifactKind: ArtifactKindSchema,
		runId: IdentifierSchema,
		generatedAt: IsoDateTimeSchema,
		producer: ProducerSchema,
		policyVersion: z.string().min(1),
		inputDigest: Sha256Schema,
		payload: z.unknown(),
		diagnostics: z.array(DiagnosticSchema).default([]),
	})
	.strict();

export const PAYLOAD_SCHEMAS = {
	evidence_inventory: EvidenceInventorySchema,
	project_profile: ProjectProfileSchema,
	concern_inventory: ConcernInventorySchema,
	prerequisite_graph: PrerequisiteGraphSchema,
	question_queue: QuestionQueueSchema,
	adr_candidates: AdrCandidatesSchema,
	planning_outputs: PlanningOutputsSchema,
	readiness_report: ReadinessResultSchema,
	run_manifest: RunManifestSchema,
} as const;

export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type UnsupportedInference = z.infer<typeof UnsupportedInferenceSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type ConcernRecord = z.infer<typeof ConcernRecordSchema>;
export type ReadinessInput = z.infer<typeof ReadinessInputSchema>;
export type ReadinessResult = z.infer<typeof ReadinessResultSchema>;
export type ArtifactEnvelope = z.infer<typeof ArtifactEnvelopeSchema>;
