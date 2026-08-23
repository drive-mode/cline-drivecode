import { z } from "zod";

export const ArtifactKindSchema = z.enum([
	"evidence_inventory",
	"project_profile",
	"concern_inventory",
	"prerequisite_graph",
	"question_queue",
	"adr_candidates",
	"planning_outputs",
	"readiness_report",
	"run_manifest",
]);

export const ApplicabilitySchema = z.enum([
	"applicable",
	"not_applicable",
	"unknown",
]);

export const ResolutionSchema = z.enum([
	"decision",
	"experiment",
	"task",
	"external_constraint",
	"not_applicable",
]);

export const ResolutionStateSchema = z.enum([
	"unresolved",
	"resolved",
	"accepted_risk",
	"not_applicable",
]);

export const UrgencySchema = z.enum(["now", "next", "later", "not_applicable"]);

export const ArtifactRouteSchema = z.enum([
	"adr",
	"plan",
	"requirement",
	"runbook",
	"risk_register",
	"none",
]);

export const LifecycleGateSchema = z.enum([
	"preplan",
	"implementation",
	"pilot",
	"release",
	"operate",
	"not_applicable",
]);

export const RequestedLifecycleGateSchema = z.enum([
	"preplan",
	"implementation",
	"pilot",
	"release",
	"operate",
]);

export const CriticalitySchema = z.enum(["critical", "major", "standard"]);
export const ReadinessEffectSchema = z.enum(["blocks", "warns", "none"]);
export const ReadinessStatusSchema = z.enum([
	"pass",
	"blocked",
	"not_applicable",
]);
export const DiagnosticSeveritySchema = z.enum(["error", "warning", "info"]);
export const InferenceSeveritySchema = z.enum(["critical", "major", "minor"]);
export const InferenceStatusSchema = z.enum([
	"unresolved",
	"rejected",
	"supported",
]);

export const SignificanceReasonSchema = z.enum([
	"cross_cutting",
	"public_contract",
	"security_boundary",
	"data_lifecycle",
	"operational_model",
	"costly_to_reverse",
	"vendor_lock_in",
	"regulatory_obligation",
	"multi_team_ownership",
]);

export const EvidenceSourceTypeSchema = z.enum([
	"brief",
	"repository",
	"user",
	"external",
	"decision",
]);

export const ProductSurfaceSchema = z.enum([
	"web",
	"api",
	"cli",
	"desktop",
	"mobile",
	"library",
	"data_pipeline",
	"agentic_system",
	"static_content",
	"unknown",
]);

export const LifecycleChangeSchema = z.enum([
	"greenfield",
	"brownfield_feature",
	"migration",
	"replacement",
	"experiment",
	"incident_remediation",
	"unknown",
]);

export const DataTrustSchema = z.enum([
	"public",
	"internal",
	"personal",
	"financial",
	"health",
	"secrets",
	"regulated",
	"destructive_capability",
	"unknown",
]);

export const RuntimeTopologySchema = z.enum([
	"static_edge",
	"client_only",
	"server",
	"worker_jobs",
	"event_driven",
	"offline_edge",
	"multi_region",
	"third_party_hosted",
	"unknown",
]);

export const ScaleReliabilitySchema = z.enum([
	"single_maintainer",
	"small_team",
	"enterprise",
	"bursty",
	"latency_sensitive",
	"high_availability",
	"unknown",
]);

export const DeliveryGovernanceSchema = z.enum([
	"internal",
	"design_partner",
	"public_launch",
	"regulated_review",
	"customer_managed",
	"open_source",
	"unknown_owner",
	"unknown",
]);

export const LIFECYCLE_GATE_ORDER = {
	preplan: 0,
	implementation: 1,
	pilot: 2,
	release: 3,
	operate: 4,
} as const;

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type RequestedLifecycleGate = z.infer<
	typeof RequestedLifecycleGateSchema
>;
