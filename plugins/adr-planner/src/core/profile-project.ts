import { createHash } from "node:crypto";
import {
	DataTrustSchema,
	DeliveryGovernanceSchema,
	LifecycleChangeSchema,
	ProductSurfaceSchema,
	type ProfileAssertion,
	type ProjectProfileRequest,
	ProjectProfileRequestSchema,
	type ProjectProfileResult,
	RuntimeTopologySchema,
	ScaleReliabilitySchema,
} from "../schema";
import {
	isAuthenticRepositoryEvidence,
	REPOSITORY_SIGNAL_CLAIM_PREFIX,
	repositorySignalFromEvidence,
} from "./analyze-repository-metadata";
import { canonicalJson } from "./canonical-json";
import { compareCodeUnits, diagnostic, sortDiagnostics } from "./diagnostics";

type Dimension = ProfileAssertion["dimension"];

const DIMENSIONS: readonly Dimension[] = [
	"product_surface",
	"lifecycle_change",
	"data_trust",
	"runtime_topology",
	"scale_reliability",
	"delivery_governance",
];

const OPTIONS = {
	product_surface: ProductSurfaceSchema.options,
	lifecycle_change: LifecycleChangeSchema.options,
	data_trust: DataTrustSchema.options,
	runtime_topology: RuntimeTopologySchema.options,
	scale_reliability: ScaleReliabilitySchema.options,
	delivery_governance: DeliveryGovernanceSchema.options,
} as const;

const SIGNAL_PROFILE_VALUES = {
	"surface.web": ["product_surface", "web"],
	"surface.api": ["product_surface", "api"],
	"surface.cli": ["product_surface", "cli"],
	"surface.desktop": ["product_surface", "desktop"],
	"surface.mobile": ["product_surface", "mobile"],
	"surface.library": ["product_surface", "library"],
	"surface.data_pipeline": ["product_surface", "data_pipeline"],
	"surface.agentic_system": ["product_surface", "agentic_system"],
	"surface.static_content": ["product_surface", "static_content"],
	"runtime.static_edge": ["runtime_topology", "static_edge"],
	"runtime.server": ["runtime_topology", "server"],
	"runtime.worker_jobs": ["runtime_topology", "worker_jobs"],
	"runtime.event_driven": ["runtime_topology", "event_driven"],
	"runtime.third_party_hosted": ["runtime_topology", "third_party_hosted"],
} as const;

const ASSERTION_SOURCE_TYPES = new Set(["brief", "user", "decision"]);

function fallbackProfile(): ProjectProfileResult["profile"] {
	return {
		productSurface: ["unknown"],
		lifecycleChange: ["unknown"],
		dataTrust: ["unknown"],
		runtimeTopology: ["unknown"],
		scaleReliability: ["unknown"],
		deliveryGovernance: ["unknown"],
		evidenceRefs: [],
		unknowns: DIMENSIONS.map((dimension) => `dimension:${dimension}`),
	};
}

function inferenceId(evidenceId: string, signal: string): string {
	return `inference-${createHash("sha256")
		.update(evidenceId)
		.update("\0")
		.update(signal)
		.digest("hex")
		.slice(0, 20)}`;
}

function assertionValue(assertion: ProfileAssertion): string {
	return assertion.value;
}

function deduplicateById<T extends { id: string }>(
	entries: readonly T[],
	kind: "evidence" | "assertion",
	diagnostics: ProjectProfileResult["diagnostics"],
): Map<string, T> {
	const groups = new Map<string, T[]>();
	for (const entry of entries) {
		const group = groups.get(entry.id) ?? [];
		group.push(entry);
		groups.set(entry.id, group);
	}
	const result = new Map<string, T>();
	for (const id of [...groups.keys()].sort(compareCodeUnits)) {
		const fingerprints = new Map(
			(groups.get(id) ?? []).map((entry) => [canonicalJson(entry), entry]),
		);
		if (fingerprints.size !== 1) {
			diagnostics.push(
				diagnostic(
					`profile.conflicting_${kind}`,
					"error",
					`Conflicting ${kind} records share id ${id}`,
				),
			);
			continue;
		}
		const entry = fingerprints.values().next().value;
		if (entry) result.set(id, entry);
	}
	return result;
}

function unsupportedClaim(signal: string): string | undefined {
	if (signal === "context.license_candidate") {
		return "A license file suggests but does not prove open-source delivery governance.";
	}
	if (signal.startsWith("candidate.surface.")) {
		return "A package dependency suggests but does not prove this product surface.";
	}
	if (signal.startsWith("candidate.runtime.")) {
		return "A package dependency suggests but does not prove this runtime topology.";
	}
	return;
}

export function profileProject(input: unknown): ProjectProfileResult {
	const parsed = ProjectProfileRequestSchema.safeParse(input);
	if (!parsed.success) {
		return {
			profile: fallbackProfile(),
			unsupportedInferences: [],
			diagnostics: sortDiagnostics(
				parsed.error.issues.map((issue) =>
					diagnostic("profile.schema", "error", issue.message, {
						path: issue.path.map(String).join("."),
					}),
				),
			),
		};
	}

	const request: ProjectProfileRequest = parsed.data;
	const diagnostics: ProjectProfileResult["diagnostics"] = [];
	const values = new Map<Dimension, Set<string>>(
		DIMENSIONS.map((dimension) => [dimension, new Set<string>()]),
	);
	const dimensionEvidence = new Map<Dimension, Set<string>>(
		DIMENSIONS.map((dimension) => [dimension, new Set<string>()]),
	);
	const unsupportedInferences: ProjectProfileResult["unsupportedInferences"] =
		[];
	const evidenceById = deduplicateById(
		request.evidence,
		"evidence",
		diagnostics,
	);

	for (const [id, evidence] of evidenceById) {
		if (evidence.sourceType !== "repository") continue;
		if (!isAuthenticRepositoryEvidence(evidence)) {
			diagnostics.push(
				diagnostic(
					"profile.invalid_repository_evidence",
					"error",
					"Repository evidence does not match the controlled collector contract",
					{ path: evidence.source },
				),
			);
			evidenceById.delete(id);
			continue;
		}
		const signal = repositorySignalFromEvidence(evidence);
		if (!signal) {
			if (evidence.claim.startsWith(REPOSITORY_SIGNAL_CLAIM_PREFIX)) {
				diagnostics.push(
					diagnostic(
						"profile.unknown_repository_signal",
						"warning",
						"Repository evidence contains an unrecognized controlled signal",
						{ path: evidence.source },
					),
				);
			}
			continue;
		}

		const mapping =
			SIGNAL_PROFILE_VALUES[signal as keyof typeof SIGNAL_PROFILE_VALUES];
		if (mapping) {
			values.get(mapping[0])?.add(mapping[1]);
			dimensionEvidence.get(mapping[0])?.add(evidence.id);
		}
		const claim = unsupportedClaim(signal);
		if (claim) {
			unsupportedInferences.push({
				id: inferenceId(evidence.id, signal),
				claim,
				severity: "minor",
				status: "unresolved",
				evidenceRefs: [evidence.id],
				affectsConcernIds: [],
			});
		}
	}

	const assertions = deduplicateById(
		request.assertions,
		"assertion",
		diagnostics,
	);
	for (const assertion of assertions.values()) {
		const supportingEvidence = assertion.evidenceRefs.map((reference) =>
			evidenceById.get(reference),
		);
		if (supportingEvidence.some((evidence) => evidence === undefined)) {
			diagnostics.push(
				diagnostic(
					"profile.missing_assertion_evidence",
					"error",
					`Profile assertion ${assertion.id} references missing evidence`,
					{ path: `assertions.${assertion.id}` },
				),
			);
			continue;
		}
		if (
			supportingEvidence.some(
				(evidence) =>
					evidence !== undefined &&
					!ASSERTION_SOURCE_TYPES.has(evidence.sourceType),
			)
		) {
			diagnostics.push(
				diagnostic(
					"profile.invalid_assertion_authority",
					"error",
					`Profile assertion ${assertion.id} lacks brief, user, or decision authority`,
					{ path: `assertions.${assertion.id}` },
				),
			);
			continue;
		}
		values.get(assertion.dimension)?.add(assertionValue(assertion));
		for (const reference of assertion.evidenceRefs) {
			dimensionEvidence.get(assertion.dimension)?.add(reference);
		}
	}

	const unknowns: string[] = [];
	for (const dimension of DIMENSIONS) {
		const dimensionValues = values.get(dimension) ?? new Set<string>();
		if (dimensionValues.has("unknown") && dimensionValues.size > 1) {
			diagnostics.push(
				diagnostic(
					"profile.conflicting_unknown",
					"error",
					`Dimension ${dimension} cannot contain unknown and known values`,
					{ path: dimension },
				),
			);
			dimensionValues.clear();
			dimensionValues.add("unknown");
			dimensionEvidence.get(dimension)?.clear();
		}
		if (dimensionValues.size === 0) dimensionValues.add("unknown");
		if (dimensionValues.has("unknown")) unknowns.push(`dimension:${dimension}`);
	}

	const ordered = <T extends string>(
		dimension: Dimension,
		options: readonly T[],
	): T[] => {
		const selected = values.get(dimension) ?? new Set<string>();
		return options.filter((option) => selected.has(option));
	};
	const usedEvidence = new Set(
		DIMENSIONS.flatMap((dimension) => [
			...(dimensionEvidence.get(dimension) ?? []),
		]),
	);

	return {
		profile: {
			productSurface: ordered("product_surface", OPTIONS.product_surface),
			lifecycleChange: ordered("lifecycle_change", OPTIONS.lifecycle_change),
			dataTrust: ordered("data_trust", OPTIONS.data_trust),
			runtimeTopology: ordered("runtime_topology", OPTIONS.runtime_topology),
			scaleReliability: ordered("scale_reliability", OPTIONS.scale_reliability),
			deliveryGovernance: ordered(
				"delivery_governance",
				OPTIONS.delivery_governance,
			),
			evidenceRefs: [...usedEvidence].sort(compareCodeUnits),
			unknowns,
		},
		unsupportedInferences: unsupportedInferences.sort((left, right) =>
			compareCodeUnits(left.id, right.id),
		),
		diagnostics: sortDiagnostics(diagnostics),
	};
}
