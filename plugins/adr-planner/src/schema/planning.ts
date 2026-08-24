import { z } from "zod";
import {
	ArtifactRouteSchema,
	CriticalitySchema,
	LifecycleGateSchema,
	ReadinessEffectSchema,
	ResolutionSchema,
	SignificanceReasonSchema,
	UrgencySchema,
} from "./enums";
import {
	AdrCandidateSchema,
	ConcernRecordSchema,
	DiagnosticSchema,
	EvidenceRefSchema,
	IdentifierSchema,
	ProjectProfileSchema,
	Sha256Schema,
	UnsupportedInferenceSchema,
} from "./models";

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStringSet(values: string[]): string[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

export const TriStateSchema = z.enum(["true", "false", "unknown"]);

export const PlanningFactKeySchema = z
	.string()
	.min(3)
	.max(128)
	.regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);

export const PlanningFactValueSchema = z.union([
	z.boolean(),
	z.string().min(1).max(128),
	z
		.array(z.string().min(1).max(128))
		.min(1)
		.max(32)
		.transform(canonicalStringSet),
]);

export const PlanningFactSchema = z
	.object({
		id: IdentifierSchema,
		key: PlanningFactKeySchema,
		value: PlanningFactValueSchema,
		evidenceRefs: z
			.array(IdentifierSchema)
			.min(1)
			.transform(canonicalStringSet),
	})
	.strict();

export type PlanningRule =
	| { op: "constant"; value: boolean }
	| { op: "equals"; fact: string; value: boolean | string }
	| { op: "contains_any"; fact: string; values: string[] }
	| { op: "all" | "any"; rules: PlanningRule[] }
	| { op: "not"; rule: PlanningRule };

export const PlanningRuleSchema: z.ZodType<PlanningRule> = z.lazy(() =>
	z.discriminatedUnion("op", [
		z.object({ op: z.literal("constant"), value: z.boolean() }).strict(),
		z
			.object({
				op: z.literal("equals"),
				fact: PlanningFactKeySchema,
				value: z.union([z.boolean(), z.string().min(1).max(128)]),
			})
			.strict(),
		z
			.object({
				op: z.literal("contains_any"),
				fact: PlanningFactKeySchema,
				values: z
					.array(z.string().min(1).max(128))
					.min(1)
					.max(32)
					.transform(canonicalStringSet),
			})
			.strict(),
		z
			.object({
				op: z.literal("all"),
				rules: z.array(PlanningRuleSchema).min(1),
			})
			.strict(),
		z
			.object({
				op: z.literal("any"),
				rules: z.array(PlanningRuleSchema).min(1),
			})
			.strict(),
		z.object({ op: z.literal("not"), rule: PlanningRuleSchema }).strict(),
	]),
);

export const ConcernAreaSchema = z.enum([
	"product",
	"quality",
	"system",
	"data",
	"trust",
	"interfaces",
	"delivery",
	"operations",
	"evolution",
]);

export const ConcernClassificationSchema = z
	.object({
		resolution: ResolutionSchema.exclude(["not_applicable"]),
		urgency: UrgencySchema.exclude(["not_applicable"]),
		artifactRoute: ArtifactRouteSchema.exclude(["none"]),
		lifecycleGate: LifecycleGateSchema.exclude(["not_applicable"]),
		criticality: CriticalitySchema,
		significanceReasons: z.array(SignificanceReasonSchema).default([]),
		readinessEffect: ReadinessEffectSchema,
	})
	.strict();

export const CatalogSourceSchema = z
	.object({
		id: IdentifierSchema,
		title: z.string().min(1),
		url: z.string().url(),
	})
	.strict();

export const PlanningConcernDefinitionSchema = z
	.object({
		id: IdentifierSchema,
		title: z.string().min(1),
		question: z.string().min(1),
		area: ConcernAreaSchema,
		sequenceBand: z.number().int().min(0).max(100),
		applicabilityRule: PlanningRuleSchema,
		classification: ConcernClassificationSchema,
		prerequisites: z.array(IdentifierSchema).default([]),
		rationale: z.string().min(1),
		reactivationCondition: z.string().min(1),
		sourceRefs: z.array(IdentifierSchema).min(1),
	})
	.strict();

export const ConcernCatalogSchema = z
	.object({
		version: z.string().min(1),
		catalogDigest: Sha256Schema,
		sources: z.array(CatalogSourceSchema).min(1),
		concerns: z.array(PlanningConcernDefinitionSchema).min(1),
	})
	.strict();

export const PlanningContextSchema = z
	.object({
		profile: ProjectProfileSchema,
		evidence: z.array(EvidenceRefSchema),
		facts: z.array(PlanningFactSchema),
		unsupportedInferences: z.array(UnsupportedInferenceSchema).default([]),
	})
	.strict();

export const RuleTraceStepSchema = z
	.object({
		path: z.string().min(1),
		op: z.enum(["constant", "equals", "contains_any", "all", "any", "not"]),
		result: TriStateSchema,
		fact: PlanningFactKeySchema.optional(),
		expected: z.array(z.union([z.boolean(), z.string()])).default([]),
		observedState: z.enum(["known", "missing", "not_applicable"]),
		observed: PlanningFactValueSchema.optional(),
		evidenceRefs: z.array(IdentifierSchema).default([]),
	})
	.strict();

export const ConcernEvaluationTraceSchema = z
	.object({
		concernId: IdentifierSchema,
		result: TriStateSchema,
		missingFactKeys: z.array(PlanningFactKeySchema).default([]),
		evidenceRefs: z.array(IdentifierSchema).default([]),
		steps: z.array(RuleTraceStepSchema).min(1),
	})
	.strict();

export const ConcernPlanningResultSchema = z
	.object({
		status: z.enum(["evaluated", "blocked"]),
		authority: z.enum([
			"repository-derived",
			"host-composed",
			"untrusted-library",
		]),
		catalogVersion: z.string().min(1),
		catalogDigest: Sha256Schema,
		concerns: z.array(ConcernRecordSchema),
		traces: z.array(ConcernEvaluationTraceSchema),
		adrCandidates: z.array(AdrCandidateSchema),
		orderedConcernIds: z.array(IdentifierSchema),
		unknownConcernIds: z.array(IdentifierSchema),
		notApplicableConcernIds: z.array(IdentifierSchema),
		diagnostics: z.array(DiagnosticSchema),
	})
	.strict()
	.superRefine((result, context) => {
		const authoritativeCollections = [
			result.concerns,
			result.traces,
			result.adrCandidates,
			result.orderedConcernIds,
			result.unknownConcernIds,
			result.notApplicableConcernIds,
		];
		if (result.status === "blocked") {
			if (authoritativeCollections.some((entries) => entries.length > 0)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Blocked concern plans cannot contain authoritative output",
				});
			}
			if (!result.diagnostics.some((entry) => entry.severity === "error")) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Blocked concern plans require an error diagnostic",
					path: ["diagnostics"],
				});
			}
			return;
		}

		if (result.diagnostics.some((entry) => entry.severity === "error")) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Evaluated concern plans cannot contain error diagnostics",
				path: ["diagnostics"],
			});
		}
		const concerns = new Map(result.concerns.map((entry) => [entry.id, entry]));
		if (concerns.size !== result.concerns.length) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Evaluated concern ids must be unique",
				path: ["concerns"],
			});
		}
		const expectedActive = result.concerns
			.filter((entry) => entry.applicability !== "not_applicable")
			.map((entry) => entry.id)
			.sort(compareCodeUnits);
		const expectedUnknown = result.concerns
			.filter((entry) => entry.applicability === "unknown")
			.map((entry) => entry.id)
			.sort(compareCodeUnits);
		const expectedInactive = result.concerns
			.filter((entry) => entry.applicability === "not_applicable")
			.map((entry) => entry.id)
			.sort(compareCodeUnits);
		const traceIds = result.traces.map((entry) => entry.concernId);
		for (const [path, actual, expected] of [
			["traces", traceIds, [...concerns.keys()]],
			["orderedConcernIds", result.orderedConcernIds, expectedActive],
			["unknownConcernIds", result.unknownConcernIds, expectedUnknown],
			[
				"notApplicableConcernIds",
				result.notApplicableConcernIds,
				expectedInactive,
			],
		] as const) {
			const normalized = [...new Set(actual)].sort(compareCodeUnits);
			const target = [...new Set(expected)].sort(compareCodeUnits);
			if (
				normalized.length !== actual.length ||
				JSON.stringify(normalized) !== JSON.stringify(target)
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `${path} must exactly reference its evaluated concern set`,
					path: [path],
				});
			}
		}
		for (const candidate of result.adrCandidates) {
			const concern = concerns.get(candidate.concernId);
			if (
				!concern ||
				concern.applicability !== "applicable" ||
				concern.artifactRoute !== "adr" ||
				concern.significanceReasons.length === 0
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: `ADR candidate ${candidate.id} is not backed by an applicable significant ADR concern`,
					path: ["adrCandidates"],
				});
			}
		}
	});

export type TriState = z.infer<typeof TriStateSchema>;
export type PlanningFact = z.infer<typeof PlanningFactSchema>;
export type ConcernCatalog = z.infer<typeof ConcernCatalogSchema>;
export type PlanningConcernDefinition = z.infer<
	typeof PlanningConcernDefinitionSchema
>;
export type PlanningContext = z.infer<typeof PlanningContextSchema>;
export type RuleTraceStep = z.infer<typeof RuleTraceStepSchema>;
export type ConcernEvaluationTrace = z.infer<
	typeof ConcernEvaluationTraceSchema
>;
export type ConcernPlanningResult = z.infer<typeof ConcernPlanningResultSchema>;
