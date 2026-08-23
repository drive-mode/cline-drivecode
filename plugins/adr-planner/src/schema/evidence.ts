import { z } from "zod";
import {
	DataTrustSchema,
	DeliveryGovernanceSchema,
	LifecycleChangeSchema,
	ProductSurfaceSchema,
	RuntimeTopologySchema,
	ScaleReliabilitySchema,
} from "./enums";
import {
	DiagnosticSchema,
	EvidenceRefSchema,
	IdentifierSchema,
	ProjectProfileSchema,
	UnsupportedInferenceSchema,
} from "./models";

export const RepositorySignalSchema = z.enum([
	"surface.web",
	"surface.api",
	"surface.cli",
	"surface.desktop",
	"surface.mobile",
	"surface.library",
	"surface.data_pipeline",
	"surface.agentic_system",
	"surface.static_content",
	"candidate.surface.web",
	"candidate.surface.api",
	"candidate.surface.cli",
	"candidate.surface.desktop",
	"candidate.surface.mobile",
	"candidate.surface.data_pipeline",
	"candidate.surface.agentic_system",
	"candidate.surface.static_content",
	"candidate.runtime.server",
	"candidate.runtime.worker_jobs",
	"candidate.runtime.event_driven",
	"runtime.static_edge",
	"runtime.server",
	"runtime.worker_jobs",
	"runtime.event_driven",
	"runtime.third_party_hosted",
	"context.monorepo",
	"context.ci_present",
	"context.container",
	"context.deployment_descriptor",
	"context.ownership_present",
	"context.security_policy_present",
	"context.license_candidate",
	"context.ecosystem.node",
	"context.ecosystem.python",
	"context.ecosystem.rust",
	"context.ecosystem.go",
	"context.ecosystem.jvm",
	"context.ecosystem.ruby",
]);

const AssertionBaseSchema = z.object({
	id: z
		.string()
		.min(1)
		.max(128)
		.regex(/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/),
	evidenceRefs: z.array(IdentifierSchema).min(1),
	rationale: z.string().min(1),
});

export const ProfileAssertionSchema = z.discriminatedUnion("dimension", [
	AssertionBaseSchema.extend({
		dimension: z.literal("product_surface"),
		value: ProductSurfaceSchema,
	}).strict(),
	AssertionBaseSchema.extend({
		dimension: z.literal("lifecycle_change"),
		value: LifecycleChangeSchema,
	}).strict(),
	AssertionBaseSchema.extend({
		dimension: z.literal("data_trust"),
		value: DataTrustSchema,
	}).strict(),
	AssertionBaseSchema.extend({
		dimension: z.literal("runtime_topology"),
		value: RuntimeTopologySchema,
	}).strict(),
	AssertionBaseSchema.extend({
		dimension: z.literal("scale_reliability"),
		value: ScaleReliabilitySchema,
	}).strict(),
	AssertionBaseSchema.extend({
		dimension: z.literal("delivery_governance"),
		value: DeliveryGovernanceSchema,
	}).strict(),
]);

export const ProjectProfileRequestSchema = z
	.object({
		evidence: z.array(EvidenceRefSchema),
		assertions: z.array(ProfileAssertionSchema).default([]),
	})
	.strict();

export const ProjectProfileResultSchema = z
	.object({
		profile: ProjectProfileSchema,
		unsupportedInferences: z.array(UnsupportedInferenceSchema),
		diagnostics: z.array(DiagnosticSchema),
	})
	.strict();

export const EvidenceCollectionStatsSchema = z
	.object({
		listed: z.number().int().nonnegative(),
		candidates: z.number().int().nonnegative(),
		read: z.number().int().nonnegative(),
		emitted: z.number().int().nonnegative(),
		skipped: z.number().int().nonnegative(),
	})
	.strict();

export const EvidenceCollectionResultSchema = z
	.object({
		status: z.enum(["collected", "blocked"]),
		evidence: z.array(EvidenceRefSchema),
		unsupportedInferences: z.array(UnsupportedInferenceSchema),
		diagnostics: z.array(DiagnosticSchema),
		stats: EvidenceCollectionStatsSchema,
	})
	.strict();

export type RepositorySignal = z.infer<typeof RepositorySignalSchema>;
export type ProfileAssertion = z.infer<typeof ProfileAssertionSchema>;
export type ProjectProfileRequest = z.infer<typeof ProjectProfileRequestSchema>;
export type ProjectProfileResult = z.infer<typeof ProjectProfileResultSchema>;
export type EvidenceCollectionResult = z.infer<
	typeof EvidenceCollectionResultSchema
>;
