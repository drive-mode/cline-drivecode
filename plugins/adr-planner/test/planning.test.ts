import { describe, expect, it } from "bun:test";
import { computeCatalogDigest, PLANNING_FACT_REGISTRY } from "../src/catalog";
import { NUCLEUS_CATALOG } from "../src/catalog/nucleus";
import {
	canonicalJson,
	planConcerns,
	validateConcernCatalog,
} from "../src/core";
import type {
	ConcernCatalog,
	EvidenceRef,
	PlanningContext,
	PlanningFact,
	ProjectProfile,
} from "../src/schema";
import { ConcernPlanningResultSchema } from "../src/schema";

function profile(): ProjectProfile {
	return {
		productSurface: ["unknown"],
		lifecycleChange: ["unknown"],
		dataTrust: ["unknown"],
		runtimeTopology: ["unknown"],
		scaleReliability: ["unknown"],
		deliveryGovernance: ["unknown"],
		evidenceRefs: [],
		unknowns: [
			"dimension:product_surface",
			"dimension:lifecycle_change",
			"dimension:data_trust",
			"dimension:runtime_topology",
			"dimension:scale_reliability",
			"dimension:delivery_governance",
		],
	};
}

function factEvidence(key: string): EvidenceRef {
	return {
		id: `brief-${key.replaceAll(".", "-")}`,
		sourceType: "brief",
		source: "trusted test fixture",
		claim: `Fixture supplies ${key}.`,
	};
}

function context(values: Record<string, boolean> = {}): PlanningContext {
	const entries = Object.entries(values).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	const evidence = entries.map(([key]) => factEvidence(key));
	const facts: PlanningFact[] = entries.map(([key, value]) => ({
		id: `fact-${key.replaceAll(".", "-")}`,
		key,
		value,
		evidenceRefs: [factEvidence(key).id],
	}));
	return { profile: profile(), evidence, facts, unsupportedInferences: [] };
}

const localCli = {
	"surface.cli": true,
	"data.persisted": true,
	"data.personal": false,
	"data.sensitive": false,
	"actors.external": false,
	"integration.external": false,
	"agent.mutation_capability": false,
	"tenancy.multiple": false,
	"interface.external": false,
	"surface.api": false,
	"surface.library": false,
	"delivery.production": true,
	"scale.variable": false,
	"scale.material": false,
	"reliability.high_availability": false,
};

const multiTenantSaas = {
	"surface.web": true,
	"data.persisted": true,
	"data.personal": true,
	"data.sensitive": true,
	"actors.external": true,
	"integration.external": true,
	"agent.mutation_capability": false,
	"tenancy.multiple": true,
	"interface.external": true,
	"surface.api": true,
	"surface.library": false,
	"delivery.production": true,
	"scale.variable": true,
	"scale.material": true,
	"reliability.high_availability": true,
};

function cloneCatalog(): ConcernCatalog {
	return structuredClone(NUCLEUS_CATALOG);
}

function resealCatalog(catalog: ConcernCatalog): ConcernCatalog {
	catalog.catalogDigest = computeCatalogDigest(catalog);
	return catalog;
}

describe("planning concern catalog", () => {
	it("validates the source-backed 12-concern nucleus", () => {
		expect(NUCLEUS_CATALOG.concerns).toHaveLength(12);
		expect(validateConcernCatalog(NUCLEUS_CATALOG)).toEqual([]);
		expect(
			new Set(NUCLEUS_CATALOG.concerns.map((entry) => entry.id)).size,
		).toBe(12);
	});

	it("freezes the runtime nucleus and detects version-preserving mutation", () => {
		expect(Object.isFrozen(NUCLEUS_CATALOG)).toBe(true);
		expect(Object.isFrozen(NUCLEUS_CATALOG.concerns)).toBe(true);
		expect(Object.isFrozen(NUCLEUS_CATALOG.concerns[0])).toBe(true);
		expect(Object.isFrozen(PLANNING_FACT_REGISTRY)).toBe(true);
		expect(Object.isFrozen(PLANNING_FACT_REGISTRY["surface.cli"])).toBe(true);
		expect(() => {
			(NUCLEUS_CATALOG as { version: string }).version = "mutated";
		}).toThrow();

		const tampered = cloneCatalog();
		if (!tampered.concerns[0]) throw new Error("missing catalog concern");
		tampered.concerns[0].classification.urgency = "later";
		const result = planConcerns(context(), tampered);
		expect(result.status).toBe("blocked");
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"catalog.digest_mismatch",
		);
	});

	it("rejects missing sources, duplicates, invalid ADR routing, and cycles", () => {
		const catalog = cloneCatalog();
		catalog.concerns[0]?.sourceRefs.push("missing-source");
		if (catalog.concerns[1]) catalog.concerns[1].id = "product-boundary";
		if (catalog.concerns[0]) {
			catalog.concerns[0].prerequisites = ["system-boundary"];
			catalog.concerns[0].sourceRefs.push(
				catalog.concerns[0].sourceRefs[0] ?? "govuk-discovery",
			);
			catalog.concerns[0].classification.artifactRoute = "adr";
			catalog.concerns[0].classification.significanceReasons = [];
		}
		const codes = validateConcernCatalog(catalog).map((entry) => entry.code);
		expect(codes).toContain("catalog.missing_source");
		expect(codes).toContain("catalog.duplicate_concern");
		expect(codes).toContain("catalog.adr_without_significance");
		expect(codes).toContain("catalog.duplicate_reference");
		expect(codes).toContain("catalog.cycle");
	});

	it("rejects unknown fact keys and fact/operator type mismatches", () => {
		const typo = cloneCatalog();
		if (!typo.concerns[0]) throw new Error("missing catalog concern");
		typo.concerns[0].applicabilityRule = {
			op: "equals",
			fact: "data.persited",
			value: true,
		};
		expect(
			validateConcernCatalog(resealCatalog(typo)).map((entry) => entry.code),
		).toContain("catalog.unknown_fact_key");

		const wrongOperator = cloneCatalog();
		if (!wrongOperator.concerns[0]) throw new Error("missing catalog concern");
		wrongOperator.concerns[0].applicabilityRule = {
			op: "contains_any",
			fact: "surface.cli",
			values: ["cli"],
		};
		expect(
			validateConcernCatalog(resealCatalog(wrongOperator)).map(
				(entry) => entry.code,
			),
		).toContain("catalog.fact_operator_mismatch");
	});

	it("canonicalizes set-valued facts and evidence-reference order", () => {
		const firstEvidence = factEvidence("surface.kinds");
		const secondEvidence = {
			...factEvidence("surface.kinds"),
			id: "brief-surface-kinds-secondary",
		};
		const base = context();
		base.evidence.push(firstEvidence, secondEvidence);
		base.facts.push(
			{
				id: "fact-surface-kinds",
				key: "surface.kinds",
				value: ["zeta", "alpha"],
				evidenceRefs: [firstEvidence.id, secondEvidence.id],
			},
			{
				id: "fact-surface-kinds",
				key: "surface.kinds",
				value: ["alpha", "zeta"],
				evidenceRefs: [secondEvidence.id, firstEvidence.id],
			},
		);
		expect(planConcerns(base).status).toBe("evaluated");
	});
});

describe("deterministic concern planning", () => {
	it("preserves unknowns instead of treating missing facts as false", () => {
		const result = planConcerns(context());
		expect(result.status).toBe("evaluated");
		expect(result.concerns).toHaveLength(12);
		expect(result.unknownConcernIds).toHaveLength(9);
		expect(result.notApplicableConcernIds).toEqual([]);
		expect(result.adrCandidates.map((entry) => entry.concernId)).toEqual([
			"system-boundary",
		]);
		expect(
			result.concerns.find((entry) => entry.id === "tenancy-isolation")
				?.unknowns,
		).toEqual(["fact:tenancy.multiple"]);
	});

	it("produces materially different CLI and multi-tenant SaaS plans", () => {
		const cli = planConcerns(context(localCli));
		const saas = planConcerns(context(multiTenantSaas));
		expect(cli.status).toBe("evaluated");
		expect(saas.status).toBe("evaluated");
		expect(cli.notApplicableConcernIds).toEqual([
			"external-interface",
			"scale-triggers",
			"tenancy-isolation",
			"trust-boundaries",
		]);
		expect(cli.unknownConcernIds).toEqual([]);
		expect(cli.adrCandidates.map((entry) => entry.concernId)).toEqual([
			"system-boundary",
			"data-authority",
		]);
		expect(saas.notApplicableConcernIds).toEqual([]);
		expect(saas.unknownConcernIds).toEqual([]);
		expect(saas.adrCandidates.map((entry) => entry.concernId)).toEqual([
			"system-boundary",
			"data-authority",
			"trust-boundaries",
			"tenancy-isolation",
			"external-interface",
			"scale-triggers",
		]);
	});

	it("keeps every prerequisite before its dependent", () => {
		const result = planConcerns(context(multiTenantSaas));
		const position = new Map(
			result.orderedConcernIds.map((id, index) => [id, index]),
		);
		for (const concern of result.concerns) {
			if (concern.applicability === "not_applicable") continue;
			for (const prerequisite of concern.prerequisites) {
				expect(position.get(prerequisite)).toBeLessThan(
					position.get(concern.id) ?? -1,
				);
			}
		}
	});

	it("propagates the earliest urgency backward", () => {
		const catalog = cloneCatalog();
		const quality = catalog.concerns.find(
			(entry) => entry.id === "quality-priorities",
		);
		if (!quality) throw new Error("missing quality concern");
		quality.classification.urgency = "later";
		const result = planConcerns(
			context(multiTenantSaas),
			resealCatalog(catalog),
		);
		expect(
			result.concerns.find((entry) => entry.id === "quality-priorities")
				?.urgency,
		).toBe("now");
	});

	it("does not turn an unknown dependent with an inactive prerequisite into a graph failure", () => {
		const catalog = cloneCatalog();
		const product = catalog.concerns.find(
			(entry) => entry.id === "product-boundary",
		);
		const quality = catalog.concerns.find(
			(entry) => entry.id === "quality-priorities",
		);
		if (!product || !quality) throw new Error("missing fixture concerns");
		product.applicabilityRule = { op: "constant", value: false };
		quality.applicabilityRule = {
			op: "equals",
			fact: "data.persisted",
			value: true,
		};
		for (const concern of catalog.concerns) {
			if (concern.id !== product.id && concern.id !== quality.id) {
				concern.applicabilityRule = { op: "constant", value: false };
			}
		}
		const result = planConcerns(context(), resealCatalog(catalog));
		expect(result.status).toBe("evaluated");
		expect(
			result.concerns.find((entry) => entry.id === "quality-priorities")
				?.applicability,
		).toBe("unknown");
	});

	it("uses urgency before sequence band for simultaneously ready concerns", () => {
		const catalog = cloneCatalog();
		const trust = catalog.concerns.find(
			(entry) => entry.id === "trust-boundaries",
		);
		const scale = catalog.concerns.find(
			(entry) => entry.id === "scale-triggers",
		);
		if (!trust || !scale) throw new Error("missing fixture concerns");
		trust.applicabilityRule = { op: "constant", value: true };
		trust.prerequisites = [];
		trust.sequenceBand = 90;
		trust.classification.urgency = "now";
		scale.applicabilityRule = { op: "constant", value: true };
		scale.prerequisites = [];
		scale.sequenceBand = 1;
		scale.classification.urgency = "later";
		const result = planConcerns(context(), resealCatalog(catalog));
		expect(result.orderedConcernIds.indexOf("trust-boundaries")).toBeLessThan(
			result.orderedConcernIds.indexOf("scale-triggers"),
		);
	});

	it("blocks inactive prerequisites, cycles, dangling references, and fact conflicts without partial output", () => {
		const inactive = cloneCatalog();
		const system = inactive.concerns.find(
			(entry) => entry.id === "system-boundary",
		);
		if (!system) throw new Error("missing system concern");
		system.applicabilityRule = { op: "constant", value: false };
		const inactiveResult = planConcerns(
			context(multiTenantSaas),
			resealCatalog(inactive),
		);
		expect(inactiveResult.status).toBe("blocked");
		expect(inactiveResult.concerns).toEqual([]);
		expect(inactiveResult.diagnostics.map((entry) => entry.code)).toContain(
			"planning.inactive_prerequisite",
		);

		const cycle = cloneCatalog();
		const product = cycle.concerns.find(
			(entry) => entry.id === "product-boundary",
		);
		if (!product) throw new Error("missing product concern");
		product.prerequisites = ["system-boundary"];
		const cycleResult = planConcerns(context(), resealCatalog(cycle));
		expect(cycleResult.status).toBe("blocked");
		expect(cycleResult.concerns).toEqual([]);
		expect(cycleResult.diagnostics.map((entry) => entry.code)).toContain(
			"catalog.cycle",
		);

		const dangling = cloneCatalog();
		dangling.concerns[0]?.prerequisites.push("missing-concern");
		expect(
			planConcerns(context(), resealCatalog(dangling)).diagnostics.map(
				(entry) => entry.code,
			),
		).toContain("catalog.dangling_prerequisite");

		const conflicting = context(localCli);
		const original = conflicting.facts.find(
			(entry) => entry.key === "tenancy.multiple",
		);
		if (!original) throw new Error("missing tenancy fact");
		conflicting.facts.push({
			...original,
			id: "fact-conflicting-tenancy",
			value: true,
		});
		const conflictResult = planConcerns(conflicting);
		expect(conflictResult.status).toBe("blocked");
		expect(conflictResult.concerns).toEqual([]);
		expect(conflictResult.diagnostics.map((entry) => entry.code)).toContain(
			"planning.conflicting_fact_key",
		);
	});

	it("is byte-stable across fact permutations and unrelated positive facts", () => {
		const base = context(multiTenantSaas);
		const baseline = canonicalJson(planConcerns(base));
		for (let index = 0; index < 10; index += 1) {
			const factOffset = index % base.facts.length;
			const evidenceOffset = (index * 3) % base.evidence.length;
			const permuted: PlanningContext = {
				...base,
				evidence: [
					...base.evidence.slice(evidenceOffset),
					...base.evidence.slice(0, evidenceOffset),
				],
				facts: [
					...base.facts.slice(factOffset),
					...base.facts.slice(0, factOffset),
				],
			};
			expect(canonicalJson(planConcerns(permuted))).toBe(baseline);
		}

		const unrelatedEvidence = factEvidence("runtime.static_edge");
		const extended: PlanningContext = {
			...base,
			evidence: [...base.evidence, unrelatedEvidence],
			facts: [
				...base.facts,
				{
					id: "fact-runtime-static-edge",
					key: "runtime.static_edge",
					value: true,
					evidenceRefs: [unrelatedEvidence.id],
				},
			],
		};
		expect(planConcerns(extended).orderedConcernIds).toEqual(
			planConcerns(base).orderedConcernIds,
		);
	});

	it("rejects unregistered or incorrectly typed context facts without partial output", () => {
		for (const [key, value, code] of [
			["data.persited", true, "planning.unknown_fact_key"],
			["surface.cli", "yes", "planning.fact_type_mismatch"],
		] as const) {
			const invalid = context();
			const evidence = factEvidence(key);
			invalid.evidence.push(evidence);
			invalid.facts.push({
				id: `fact-${key.replaceAll(".", "-")}`,
				key,
				value,
				evidenceRefs: [evidence.id],
			});
			const result = planConcerns(invalid);
			expect(result.status).toBe("blocked");
			expect(result.concerns).toEqual([]);
			expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
		}
	});

	it("marks the public kernel untrusted and enforces fail-closed result shape", () => {
		const result = planConcerns(context(multiTenantSaas));
		expect(result.authority).toBe("untrusted-library");
		expect(ConcernPlanningResultSchema.safeParse(result).success).toBe(true);
		expect(
			ConcernPlanningResultSchema.safeParse({
				...result,
				status: "blocked",
			}).success,
		).toBe(false);
	});
});
