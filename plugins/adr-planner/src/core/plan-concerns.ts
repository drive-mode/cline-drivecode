import {
	computeCatalogDigest,
	planningFactDefinition,
	UNKNOWN_CATALOG_DIGEST,
} from "../catalog";
import { NUCLEUS_CATALOG } from "../catalog/nucleus";
import type {
	ConcernCatalog,
	ConcernPlanningResult,
	ConcernRecord,
	Diagnostic,
	PlanningConcernDefinition,
	PlanningContext,
	PlanningFact,
	PlanningRule,
} from "../schema";
import {
	ConcernCatalogSchema,
	ConcernPlanningResultSchema,
	PlanningContextSchema,
} from "../schema";
import { canonicalJson } from "./canonical-json";
import {
	compareCodeUnits,
	diagnostic,
	hasErrors,
	sortDiagnostics,
} from "./diagnostics";
import {
	evaluatePlanningRule,
	type IndexedPlanningFact,
} from "./evaluate-rule";
import { validateConcernGraph } from "./validate-graph";
import { validateConcernRouting } from "./validate-routing";

const URGENCY_RANK = { now: 0, next: 1, later: 2 } as const;

interface PreparedFacts {
	index: Map<string, IndexedPlanningFact>;
	diagnostics: Diagnostic[];
}

function blocked(
	authority: ConcernPlanningResult["authority"],
	catalogVersion: string,
	catalogDigest: string,
	diagnostics: Diagnostic[],
): ConcernPlanningResult {
	return ConcernPlanningResultSchema.parse({
		status: "blocked",
		authority,
		catalogVersion,
		catalogDigest,
		concerns: [],
		traces: [],
		adrCandidates: [],
		orderedConcernIds: [],
		unknownConcernIds: [],
		notApplicableConcernIds: [],
		diagnostics: sortDiagnostics(diagnostics),
	});
}

function zodDiagnostics(
	code: string,
	error: { issues: Array<{ path: PropertyKey[]; message: string }> },
): Diagnostic[] {
	return error.issues.map((issue) =>
		diagnostic(code, "error", issue.message, {
			path: issue.path.map(String).join("."),
		}),
	);
}

function duplicateConflicts<T extends { id: string }>(
	entries: readonly T[],
	kind: string,
): { entries: T[]; diagnostics: Diagnostic[] } {
	const groups = new Map<string, T[]>();
	for (const entry of entries) {
		const group = groups.get(entry.id) ?? [];
		group.push(entry);
		groups.set(entry.id, group);
	}
	const normalized: T[] = [];
	const diagnostics: Diagnostic[] = [];
	for (const id of [...groups.keys()].sort(compareCodeUnits)) {
		const fingerprints = new Map(
			(groups.get(id) ?? []).map((entry) => [canonicalJson(entry), entry]),
		);
		if (fingerprints.size !== 1) {
			diagnostics.push(
				diagnostic(
					`planning.conflicting_${kind}_id`,
					"error",
					`Conflicting ${kind} records share id ${id}`,
				),
			);
			continue;
		}
		const entry = fingerprints.values().next().value;
		if (entry) normalized.push(entry);
	}
	return { entries: normalized, diagnostics };
}

function prepareFacts(context: PlanningContext): PreparedFacts {
	const diagnostics: Diagnostic[] = [];
	const evidence = duplicateConflicts(context.evidence, "evidence");
	diagnostics.push(...evidence.diagnostics);
	const evidenceIds = new Set(evidence.entries.map((entry) => entry.id));
	const normalizedFacts = context.facts.map((fact) => ({
		...fact,
		value: Array.isArray(fact.value)
			? [...new Set(fact.value)].sort(compareCodeUnits)
			: fact.value,
		evidenceRefs: [...new Set(fact.evidenceRefs)].sort(compareCodeUnits),
	}));
	const facts = duplicateConflicts(normalizedFacts, "fact");
	diagnostics.push(...facts.diagnostics);

	for (const reference of context.profile.evidenceRefs) {
		if (!evidenceIds.has(reference)) {
			diagnostics.push(
				diagnostic(
					"planning.missing_profile_evidence",
					"error",
					`Project profile references missing evidence ${reference}`,
				),
			);
		}
	}

	const byKey = new Map<string, PlanningFact[]>();
	for (const fact of facts.entries) {
		const definition = planningFactDefinition(fact.key);
		if (!definition) {
			diagnostics.push(
				diagnostic(
					"planning.unknown_fact_key",
					"error",
					`Planning fact ${fact.id} uses unregistered key ${fact.key}`,
					{ path: `facts.${fact.id}.key` },
				),
			);
			continue;
		}
		const actualKind = Array.isArray(fact.value)
			? "string_set"
			: typeof fact.value;
		if (actualKind !== definition.valueKind) {
			diagnostics.push(
				diagnostic(
					"planning.fact_type_mismatch",
					"error",
					`Planning fact ${fact.id} must use ${definition.valueKind}`,
					{ path: `facts.${fact.id}.value` },
				),
			);
			continue;
		}
		const missing = fact.evidenceRefs.filter(
			(reference) => !evidenceIds.has(reference),
		);
		if (missing.length > 0) {
			diagnostics.push(
				diagnostic(
					"planning.missing_fact_evidence",
					"error",
					`Planning fact ${fact.id} references missing evidence`,
					{ path: `facts.${fact.id}` },
				),
			);
			continue;
		}
		const group = byKey.get(fact.key) ?? [];
		group.push(fact);
		byKey.set(fact.key, group);
	}

	const index = new Map<string, IndexedPlanningFact>();
	for (const key of [...byKey.keys()].sort(compareCodeUnits)) {
		const group = byKey.get(key) ?? [];
		const values = new Map(
			group.map((fact) => [canonicalJson(fact.value), fact.value]),
		);
		if (values.size !== 1) {
			diagnostics.push(
				diagnostic(
					"planning.conflicting_fact_key",
					"error",
					`Planning facts disagree about ${key}`,
					{ path: key },
				),
			);
			continue;
		}
		const value = values.values().next().value;
		if (value === undefined) continue;
		index.set(key, {
			value,
			evidenceRefs: [
				...new Set(group.flatMap((fact) => fact.evidenceRefs)),
			].sort(compareCodeUnits),
		});
	}

	return { index, diagnostics: sortDiagnostics(diagnostics) };
}

function validateRuleFacts(
	rule: PlanningRule,
	concernId: string,
	diagnostics: Diagnostic[],
): void {
	if (rule.op === "constant") return;
	if (rule.op === "not") {
		validateRuleFacts(rule.rule, concernId, diagnostics);
		return;
	}
	if ("rules" in rule) {
		for (const child of rule.rules) {
			validateRuleFacts(child, concernId, diagnostics);
		}
		return;
	}
	const definition = planningFactDefinition(rule.fact);
	if (!definition) {
		diagnostics.push(
			diagnostic(
				"catalog.unknown_fact_key",
				"error",
				`Concern ${concernId} references unregistered fact ${rule.fact}`,
				{ concernIds: [concernId] },
			),
		);
		return;
	}
	const compatible =
		rule.op === "contains_any"
			? definition.valueKind === "string_set"
			: definition.valueKind === typeof rule.value;
	if (!compatible) {
		diagnostics.push(
			diagnostic(
				"catalog.fact_operator_mismatch",
				"error",
				`Concern ${concernId} uses ${rule.op} with incompatible ${definition.valueKind} fact ${rule.fact}`,
				{ concernIds: [concernId] },
			),
		);
	}
}

export function validateConcernCatalog(input: unknown): Diagnostic[] {
	const parsed = ConcernCatalogSchema.safeParse(input);
	if (!parsed.success)
		return sortDiagnostics(zodDiagnostics("catalog.schema", parsed.error));
	const catalog = parsed.data;
	const diagnostics: Diagnostic[] = [];
	if (computeCatalogDigest(catalog) !== catalog.catalogDigest) {
		diagnostics.push(
			diagnostic(
				"catalog.digest_mismatch",
				"error",
				"Catalog content does not match its version-bound digest",
			),
		);
	}
	const sourceIds = new Set<string>();
	for (const source of catalog.sources) {
		if (sourceIds.has(source.id)) {
			diagnostics.push(
				diagnostic(
					"catalog.duplicate_source",
					"error",
					`Duplicate catalog source id ${source.id}`,
				),
			);
		}
		sourceIds.add(source.id);
	}

	const byId = new Map<string, PlanningConcernDefinition>();
	for (const concern of catalog.concerns) {
		if (byId.has(concern.id)) {
			diagnostics.push(
				diagnostic(
					"catalog.duplicate_concern",
					"error",
					`Duplicate catalog concern id ${concern.id}`,
					{ concernIds: [concern.id] },
				),
			);
			continue;
		}
		byId.set(concern.id, concern);
		validateRuleFacts(concern.applicabilityRule, concern.id, diagnostics);
		for (const sourceRef of concern.sourceRefs) {
			if (!sourceIds.has(sourceRef)) {
				diagnostics.push(
					diagnostic(
						"catalog.missing_source",
						"error",
						`Concern ${concern.id} references missing source ${sourceRef}`,
						{ concernIds: [concern.id] },
					),
				);
			}
		}
		const significant = concern.classification.significanceReasons.length > 0;
		for (const [field, values] of [
			["sourceRefs", concern.sourceRefs],
			["prerequisites", concern.prerequisites],
			["significanceReasons", concern.classification.significanceReasons],
		] as const) {
			if (new Set(values).size !== values.length) {
				diagnostics.push(
					diagnostic(
						"catalog.duplicate_reference",
						"error",
						`Concern ${concern.id} contains duplicate ${field}`,
						{ concernIds: [concern.id] },
					),
				);
			}
		}
		if (concern.classification.artifactRoute === "adr" && !significant) {
			diagnostics.push(
				diagnostic(
					"catalog.adr_without_significance",
					"error",
					`ADR concern ${concern.id} requires a significance reason`,
					{ concernIds: [concern.id] },
				),
			);
		}
		if (
			concern.classification.artifactRoute === "adr" &&
			`adr-${concern.id}`.length > 128
		) {
			diagnostics.push(
				diagnostic(
					"catalog.adr_id_too_long",
					"error",
					`ADR candidate id for concern ${concern.id} exceeds the identifier limit`,
					{ concernIds: [concern.id] },
				),
			);
		}
		if (concern.classification.artifactRoute !== "adr" && significant) {
			diagnostics.push(
				diagnostic(
					"catalog.significance_without_adr",
					"error",
					`Non-ADR concern ${concern.id} cannot carry ADR significance reasons`,
					{ concernIds: [concern.id] },
				),
			);
		}
	}

	for (const concern of catalog.concerns) {
		for (const prerequisite of concern.prerequisites) {
			if (prerequisite === concern.id) {
				diagnostics.push(
					diagnostic(
						"catalog.self_reference",
						"error",
						`Catalog concern ${concern.id} cannot depend on itself`,
						{ concernIds: [concern.id] },
					),
				);
			} else if (!byId.has(prerequisite)) {
				diagnostics.push(
					diagnostic(
						"catalog.dangling_prerequisite",
						"error",
						`Catalog concern ${concern.id} references missing prerequisite ${prerequisite}`,
						{ concernIds: [concern.id, prerequisite] },
					),
				);
			}
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const stack: string[] = [];
	const cycles = new Set<string>();
	const visit = (id: string): void => {
		if (visited.has(id) || !byId.has(id)) return;
		if (visiting.has(id)) {
			const start = stack.indexOf(id);
			const cycle = [...stack.slice(start), id];
			const key = [...new Set(cycle)].sort(compareCodeUnits).join(":");
			if (!cycles.has(key)) {
				cycles.add(key);
				diagnostics.push(
					diagnostic(
						"catalog.cycle",
						"error",
						`Catalog prerequisite cycle: ${cycle.join(" -> ")}`,
						{ concernIds: [...new Set(cycle)] },
					),
				);
			}
			return;
		}
		visiting.add(id);
		stack.push(id);
		for (const prerequisite of [...(byId.get(id)?.prerequisites ?? [])].sort(
			compareCodeUnits,
		)) {
			visit(prerequisite);
		}
		stack.pop();
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of [...byId.keys()].sort(compareCodeUnits)) visit(id);
	return sortDiagnostics(diagnostics);
}

function definitionOrder(
	left: PlanningConcernDefinition,
	right: PlanningConcernDefinition,
): number {
	return (
		left.sequenceBand - right.sequenceBand ||
		compareCodeUnits(left.id, right.id)
	);
}

function propagateUrgency(
	concerns: Map<string, ConcernRecord>,
	definitions: ReadonlyMap<string, PlanningConcernDefinition>,
): void {
	for (let pass = 0; pass < concerns.size; pass += 1) {
		let changed = false;
		for (const concern of concerns.values()) {
			if (concern.applicability !== "applicable") continue;
			const dependentRank =
				URGENCY_RANK[concern.urgency as keyof typeof URGENCY_RANK];
			for (const prerequisiteId of definitions.get(concern.id)?.prerequisites ??
				[]) {
				const prerequisite = concerns.get(prerequisiteId);
				if (!prerequisite || prerequisite.applicability === "not_applicable")
					continue;
				const prerequisiteRank =
					URGENCY_RANK[prerequisite.urgency as keyof typeof URGENCY_RANK];
				if (prerequisiteRank > dependentRank) {
					prerequisite.urgency = concern.urgency;
					changed = true;
				}
			}
		}
		if (!changed) return;
	}
}

function topologicalOrder(
	concerns: ReadonlyMap<string, ConcernRecord>,
	definitions: ReadonlyMap<string, PlanningConcernDefinition>,
): string[] {
	const active = [...concerns.values()].filter(
		(concern) => concern.applicability !== "not_applicable",
	);
	const activeIds = new Set(active.map((concern) => concern.id));
	const indegree = new Map(active.map((concern) => [concern.id, 0]));
	const dependents = new Map<string, string[]>();
	for (const concern of active) {
		for (const prerequisite of definitions.get(concern.id)?.prerequisites ??
			[]) {
			if (!activeIds.has(prerequisite)) continue;
			indegree.set(concern.id, (indegree.get(concern.id) ?? 0) + 1);
			const list = dependents.get(prerequisite) ?? [];
			list.push(concern.id);
			dependents.set(prerequisite, list);
		}
	}
	const compareIds = (left: string, right: string): number => {
		const leftConcern = concerns.get(left);
		const rightConcern = concerns.get(right);
		const urgency =
			URGENCY_RANK[leftConcern?.urgency as keyof typeof URGENCY_RANK] -
			URGENCY_RANK[rightConcern?.urgency as keyof typeof URGENCY_RANK];
		if (urgency !== 0) return urgency;
		const band =
			(definitions.get(left)?.sequenceBand ?? 100) -
			(definitions.get(right)?.sequenceBand ?? 100);
		return band || compareCodeUnits(left, right);
	};
	const ready = [...indegree.entries()]
		.filter(([, count]) => count === 0)
		.map(([id]) => id)
		.sort(compareIds);
	const ordered: string[] = [];
	while (ready.length > 0) {
		const id = ready.shift();
		if (!id) break;
		ordered.push(id);
		for (const dependent of [...(dependents.get(id) ?? [])].sort(compareIds)) {
			const remaining = (indegree.get(dependent) ?? 0) - 1;
			indegree.set(dependent, remaining);
			if (remaining === 0) {
				ready.push(dependent);
				ready.sort(compareIds);
			}
		}
	}
	return ordered;
}

function evaluateConcernPlan(
	input: unknown,
	catalogInput: unknown,
	authority: ConcernPlanningResult["authority"],
): ConcernPlanningResult {
	const parsedCatalog = ConcernCatalogSchema.safeParse(catalogInput);
	const catalogVersion = parsedCatalog.success
		? parsedCatalog.data.version
		: "unknown";
	const catalogDigest = parsedCatalog.success
		? parsedCatalog.data.catalogDigest
		: UNKNOWN_CATALOG_DIGEST;
	if (!parsedCatalog.success) {
		return blocked(
			authority,
			catalogVersion,
			catalogDigest,
			zodDiagnostics("catalog.schema", parsedCatalog.error),
		);
	}
	const catalog: ConcernCatalog = parsedCatalog.data;
	const catalogDiagnostics = validateConcernCatalog(catalog);
	if (hasErrors(catalogDiagnostics))
		return blocked(
			authority,
			catalog.version,
			catalog.catalogDigest,
			catalogDiagnostics,
		);

	const parsedContext = PlanningContextSchema.safeParse(input);
	if (!parsedContext.success) {
		return blocked(
			authority,
			catalog.version,
			catalog.catalogDigest,
			zodDiagnostics("planning.schema", parsedContext.error),
		);
	}
	const context: PlanningContext = parsedContext.data;
	const prepared = prepareFacts(context);
	if (hasErrors(prepared.diagnostics))
		return blocked(
			authority,
			catalog.version,
			catalog.catalogDigest,
			prepared.diagnostics,
		);

	const definitions = [...catalog.concerns].sort(definitionOrder);
	const definitionsById = new Map(
		definitions.map((entry) => [entry.id, entry]),
	);
	const concerns = new Map<string, ConcernRecord>();
	const traces: ConcernPlanningResult["traces"] = [];

	for (const definition of definitions) {
		const evaluation = evaluatePlanningRule(
			definition.applicabilityRule,
			prepared.index,
		);
		const evidenceRefs = [...evaluation.evidenceRefs].sort(compareCodeUnits);
		traces.push({
			concernId: definition.id,
			result: evaluation.result,
			missingFactKeys: [...evaluation.missingFactKeys].sort(compareCodeUnits),
			evidenceRefs,
			steps: evaluation.steps,
		});

		if (evaluation.result === "false") {
			concerns.set(definition.id, {
				id: definition.id,
				concern: definition.question,
				applicability: "not_applicable",
				resolution: "not_applicable",
				state: "not_applicable",
				urgency: "not_applicable",
				artifactRoute: "none",
				lifecycleGate: "not_applicable",
				criticality: definition.classification.criticality,
				significanceReasons: [],
				prerequisites: [],
				readinessEffect: "none",
				evidenceRefs,
				resolutionEvidenceRefs: [],
				unsupportedInferenceRefs: [],
				unknowns: [],
				rationale: `Not applicable. ${definition.reactivationCondition}`,
			});
			continue;
		}

		concerns.set(definition.id, {
			id: definition.id,
			concern: definition.question,
			applicability: evaluation.result === "true" ? "applicable" : "unknown",
			resolution: definition.classification.resolution,
			state: "unresolved",
			urgency: definition.classification.urgency,
			artifactRoute: definition.classification.artifactRoute,
			lifecycleGate: definition.classification.lifecycleGate,
			criticality: definition.classification.criticality,
			significanceReasons: [
				...definition.classification.significanceReasons,
			].sort(compareCodeUnits),
			prerequisites: [...definition.prerequisites].sort(compareCodeUnits),
			readinessEffect: definition.classification.readinessEffect,
			evidenceRefs,
			resolutionEvidenceRefs: [],
			unsupportedInferenceRefs: [],
			unknowns:
				evaluation.result === "unknown"
					? evaluation.missingFactKeys.map((key) => `fact:${key}`)
					: [],
			rationale:
				evaluation.result === "true"
					? definition.rationale
					: `Applicability is unknown until these material facts are resolved: ${evaluation.missingFactKeys.join(", ")}.`,
		});
	}

	const diagnostics: Diagnostic[] = [];
	for (const concern of concerns.values()) {
		if (concern.applicability !== "applicable") continue;
		for (const prerequisiteId of definitionsById.get(concern.id)
			?.prerequisites ?? []) {
			if (concerns.get(prerequisiteId)?.applicability === "not_applicable") {
				diagnostics.push(
					diagnostic(
						"planning.inactive_prerequisite",
						"error",
						`Active concern ${concern.id} requires not-applicable prerequisite ${prerequisiteId}`,
						{ concernIds: [concern.id, prerequisiteId] },
					),
				);
			}
		}
	}
	const currentConcerns = [...concerns.values()];
	diagnostics.push(...validateConcernGraph(currentConcerns));
	diagnostics.push(...validateConcernRouting(currentConcerns));
	if (hasErrors(diagnostics))
		return blocked(
			authority,
			catalog.version,
			catalog.catalogDigest,
			diagnostics,
		);

	propagateUrgency(concerns, definitionsById);
	const orderedConcernIds = topologicalOrder(concerns, definitionsById);
	const orderedIndex = new Map(
		orderedConcernIds.map((id, index) => [id, index]),
	);
	const finalConcerns = [...concerns.values()].sort((left, right) => {
		const leftIndex = orderedIndex.get(left.id);
		const rightIndex = orderedIndex.get(right.id);
		if (leftIndex !== undefined && rightIndex !== undefined)
			return leftIndex - rightIndex;
		if (leftIndex !== undefined) return -1;
		if (rightIndex !== undefined) return 1;
		return definitionOrder(
			definitionsById.get(left.id) as PlanningConcernDefinition,
			definitionsById.get(right.id) as PlanningConcernDefinition,
		);
	});
	const adrCandidates = orderedConcernIds.flatMap((id) => {
		const concern = concerns.get(id);
		const definition = definitionsById.get(id);
		if (
			!concern ||
			!definition ||
			concern.applicability !== "applicable" ||
			concern.artifactRoute !== "adr" ||
			concern.significanceReasons.length === 0
		)
			return [];
		return [
			{
				id: `adr-${id}`,
				concernId: id,
				title: definition.title,
				status: "proposed" as const,
				significanceReasons: [...concern.significanceReasons],
				alternativesKnown: false,
			},
		];
	});

	return ConcernPlanningResultSchema.parse({
		status: "evaluated",
		authority,
		catalogVersion: catalog.version,
		catalogDigest: catalog.catalogDigest,
		concerns: finalConcerns,
		traces: traces.sort((left, right) =>
			compareCodeUnits(left.concernId, right.concernId),
		),
		adrCandidates,
		orderedConcernIds,
		unknownConcernIds: finalConcerns
			.filter((concern) => concern.applicability === "unknown")
			.map((concern) => concern.id)
			.sort(compareCodeUnits),
		notApplicableConcernIds: finalConcerns
			.filter((concern) => concern.applicability === "not_applicable")
			.map((concern) => concern.id)
			.sort(compareCodeUnits),
		diagnostics: sortDiagnostics(diagnostics),
	});
}

export function planConcerns(
	input: unknown,
	catalogInput: unknown = NUCLEUS_CATALOG,
): ConcernPlanningResult {
	return evaluateConcernPlan(input, catalogInput, "untrusted-library");
}

// Package-internal trusted entry point. It is deliberately omitted from the
// public root and `./core` export maps; the plugin tool is its sole caller.
export function planRepositoryConcerns(input: unknown): ConcernPlanningResult {
	return evaluateConcernPlan(input, NUCLEUS_CATALOG, "repository-derived");
}

// Package-internal host composition entry point. Runtime registration must
// supply facts through host-owned extension state; serialized labels alone are
// never proof of authority.
export function planHostComposedConcerns(
	input: unknown,
	catalogInput: unknown = NUCLEUS_CATALOG,
): ConcernPlanningResult {
	return evaluateConcernPlan(input, catalogInput, "host-composed");
}
