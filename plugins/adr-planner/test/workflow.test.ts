import { describe, expect, it } from "bun:test";
import { computeCatalogDigest, NUCLEUS_CATALOG } from "../src/catalog";
import { canonicalJson } from "../src/core";
import { compileWorkflowPlan } from "../src/core/compile-workflow";
import { planHostComposedConcerns } from "../src/core/plan-concerns";
import type {
	ConcernCatalog,
	EvidenceRef,
	PlanningFact,
	ProjectProfile,
} from "../src/schema";

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

function context(values: Record<string, boolean> = {}) {
	const entries = Object.entries(values).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	const evidence: EvidenceRef[] = entries.map(([key]) => ({
		id: `attest-${key.replaceAll(".", "-")}`,
		sourceType: "user",
		source: "explicit test command",
		claim: `Controlled fixture attests ${key}.`,
	}));
	const facts: PlanningFact[] = entries.map(([key, value]) => ({
		id: `fact-${key.replaceAll(".", "-")}`,
		key,
		value,
		evidenceRefs: [`attest-${key.replaceAll(".", "-")}`],
	}));
	return { profile: profile(), evidence, facts, unsupportedInferences: [] };
}

const localCli = {
	"surface.cli": true,
	"data.persisted": false,
	"data.personal": false,
	"data.sensitive": false,
	"actors.external": false,
	"integration.external": false,
	"agent.mutation_capability": false,
	"tenancy.multiple": false,
	"interface.external": false,
	"delivery.production": false,
	"scale.variable": false,
	"scale.material": false,
	"reliability.high_availability": false,
};

function compile(
	values: Record<string, boolean> = {},
	gate = "preplan" as const,
) {
	const planningContext = context(values);
	const concernPlan = planHostComposedConcerns(planningContext);
	return compileWorkflowPlan({
		mode: "preplan",
		requestedGate: gate,
		profile: planningContext.profile,
		planningFacts: planningContext.facts,
		concernPlan,
	});
}

describe("M4 deterministic workflow compilation", () => {
	it("compiles only decisive material questions and an evidence-blocked next wave", () => {
		const result = compile();
		expect(result.status).toBe("compiled");
		if (result.status !== "compiled") throw new Error("expected workflow");
		expect(result.plan.authority).toBe("host-composed");
		expect(result.plan.questionQueue.questions.length).toBeGreaterThan(0);
		expect(result.plan.questionQueue.questions.length).toBeLessThanOrEqual(8);
		for (const question of result.plan.questionQueue.questions) {
			expect(question.changesConcernIds.length).toBeGreaterThan(0);
			expect(
				result.plan.concernPlan.traces.some(
					(trace) =>
						trace.result === "unknown" &&
						trace.missingFactKeys.includes(question.factKey) &&
						question.changesConcernIds.includes(trace.concernId),
				),
			).toBe(true);
		}
		expect(result.plan.nextWaveConcernIds).toEqual(["product-boundary"]);
		expect(result.plan.readiness.status).toBe("blocked");
		expect(result.markdown).toContain("# ADR planning workflow preview");
		expect(result.canonicalJson).not.toContain("generatedAt");
		expect(result.canonicalJson).not.toContain("timestamp");
	});

	it("uses explicit facts for applicability without treating them as resolution evidence", () => {
		const result = compile(localCli);
		expect(result.status).toBe("compiled");
		if (result.status !== "compiled") throw new Error("expected workflow");
		expect(result.plan.questionQueue.questions).toEqual([]);
		expect(result.plan.concernPlan.unknownConcernIds).toEqual([]);
		expect(
			result.plan.concernPlan.adrCandidates.map((entry) => entry.concernId),
		).toEqual(["system-boundary"]);
		expect(result.plan.readiness.status).toBe("blocked");
		expect(result.plan.readiness.blockerIds).toContain(
			"obligation-product-boundary",
		);
		expect(
			result.plan.readinessObligations.every(
				(entry) =>
					entry.status === "unknown" && entry.evidenceRefs.length === 0,
			),
		).toBe(true);
	});

	it("is byte-stable across distinct fact and evidence permutations", () => {
		const base = context(localCli);
		const baselinePlan = planHostComposedConcerns(base);
		const baseline = compileWorkflowPlan({
			mode: "plan",
			requestedGate: "release",
			profile: base.profile,
			planningFacts: base.facts,
			concernPlan: baselinePlan,
		});
		for (let index = 0; index < 10; index += 1) {
			const factOffset = index % base.facts.length;
			const evidenceOffset = (index * 3) % base.evidence.length;
			const permuted = {
				...base,
				facts: [
					...base.facts.slice(factOffset),
					...base.facts.slice(0, factOffset),
				],
				evidence: [
					...base.evidence.slice(evidenceOffset),
					...base.evidence.slice(0, evidenceOffset),
				],
			};
			const concernPlan = planHostComposedConcerns(permuted);
			const result = compileWorkflowPlan({
				mode: "plan",
				requestedGate: "release",
				profile: permuted.profile,
				planningFacts: permuted.facts,
				concernPlan,
			});
			expect(canonicalJson(result)).toBe(canonicalJson(baseline));
		}
	});

	it("blocks compilation after contradictory facts without a partial plan", () => {
		const conflicting = context({ "data.persisted": true });
		conflicting.evidence.push({
			id: "attest-data-persisted-conflict",
			sourceType: "user",
			source: "explicit test command",
			claim: "Controlled conflict fixture.",
		});
		conflicting.facts.push({
			id: "fact-data-persisted-conflict",
			key: "data.persisted",
			value: false,
			evidenceRefs: ["attest-data-persisted-conflict"],
		});
		const concernPlan = planHostComposedConcerns(conflicting);
		expect(concernPlan.status).toBe("blocked");
		const result = compileWorkflowPlan({
			mode: "plan",
			requestedGate: "implementation",
			profile: conflicting.profile,
			planningFacts: conflicting.facts,
			concernPlan,
		});
		expect(result).toMatchObject({
			status: "blocked",
			plan: null,
			canonicalJson: null,
			markdown: null,
		});
	});

	it("emits complete experiment records only for experiment resolution", () => {
		const catalog = structuredClone(NUCLEUS_CATALOG) as ConcernCatalog;
		const product = catalog.concerns.find(
			(entry) => entry.id === "product-boundary",
		);
		if (!product) throw new Error("missing product fixture");
		product.classification.resolution = "experiment";
		catalog.catalogDigest = computeCatalogDigest(catalog);
		const planningContext = context(localCli);
		const concernPlan = planHostComposedConcerns(planningContext, catalog);
		const result = compileWorkflowPlan({
			mode: "preplan",
			requestedGate: "preplan",
			profile: planningContext.profile,
			planningFacts: planningContext.facts,
			concernPlan,
		});
		expect(result.status).toBe("compiled");
		if (result.status !== "compiled") throw new Error("expected workflow");
		expect(result.plan.experiments).toHaveLength(1);
		expect(result.plan.experiments[0]).toMatchObject({
			concernId: "product-boundary",
			ownerState: "unassigned",
			timebox: "One planning cycle",
		});
		expect(result.plan.experiments[0]?.requiredEvidence).toHaveLength(1);
	});
});
