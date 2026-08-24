import { describe, expect, it } from "bun:test";
import { evaluatePlanningRule } from "../src/core";
import type { PlanningRule } from "../src/schema";

const known = new Map([
	["flag.enabled", { value: true as const, evidenceRefs: ["brief-flag"] }],
	[
		"surface.kinds",
		{ value: ["cli", "library"], evidenceRefs: ["repo-surface"] },
	],
]);

function result(rule: PlanningRule): string {
	return evaluatePlanningRule(rule, known).result;
}

describe("three-valued planning rules", () => {
	it("evaluates equality and set membership without treating missing as false", () => {
		expect(result({ op: "equals", fact: "flag.enabled", value: true })).toBe(
			"true",
		);
		expect(result({ op: "equals", fact: "flag.enabled", value: false })).toBe(
			"false",
		);
		expect(result({ op: "equals", fact: "flag.missing", value: true })).toBe(
			"unknown",
		);
		expect(
			result({
				op: "contains_any",
				fact: "surface.kinds",
				values: ["library", "api"],
			}),
		).toBe("true");
		expect(
			result({
				op: "contains_any",
				fact: "surface.kinds",
				values: ["mobile"],
			}),
		).toBe("false");
		expect(
			result({
				op: "contains_any",
				fact: "surface.missing",
				values: ["mobile"],
			}),
		).toBe("unknown");
	});

	it("implements strong Kleene all, any, and not truth tables", () => {
		const yes: PlanningRule = { op: "constant", value: true };
		const no: PlanningRule = { op: "constant", value: false };
		const unknown: PlanningRule = {
			op: "equals",
			fact: "flag.missing",
			value: true,
		};
		expect(result({ op: "all", rules: [yes, yes] })).toBe("true");
		expect(result({ op: "all", rules: [yes, unknown] })).toBe("unknown");
		expect(result({ op: "all", rules: [unknown, no] })).toBe("false");
		expect(result({ op: "any", rules: [no, no] })).toBe("false");
		expect(result({ op: "any", rules: [no, unknown] })).toBe("unknown");
		expect(result({ op: "any", rules: [unknown, yes] })).toBe("true");
		expect(result({ op: "not", rule: yes })).toBe("false");
		expect(result({ op: "not", rule: no })).toBe("true");
		expect(result({ op: "not", rule: unknown })).toBe("unknown");
	});

	it("emits stable paths, missing keys, and evidence references", () => {
		const evaluation = evaluatePlanningRule(
			{
				op: "all",
				rules: [
					{ op: "equals", fact: "flag.enabled", value: true },
					{ op: "equals", fact: "flag.missing", value: true },
				],
			},
			known,
		);
		expect(evaluation.result).toBe("unknown");
		expect(evaluation.missingFactKeys).toEqual(["flag.missing"]);
		expect(evaluation.evidenceRefs).toEqual([]);
		expect(evaluation.steps[0]?.evidenceRefs).toEqual(["brief-flag"]);
		expect(evaluation.steps.map((step) => step.path)).toEqual([
			"$.rules[0]",
			"$.rules[1]",
			"$",
		]);
	});

	it("keeps full steps but excludes non-decisive unknowns from question lineage", () => {
		for (const rule of [
			{
				op: "any" as const,
				rules: [
					{ op: "constant" as const, value: true },
					{ op: "equals" as const, fact: "flag.missing", value: true },
				],
			},
			{
				op: "all" as const,
				rules: [
					{ op: "constant" as const, value: false },
					{ op: "equals" as const, fact: "flag.missing", value: true },
				],
			},
		]) {
			const evaluation = evaluatePlanningRule(rule, known);
			expect(evaluation.missingFactKeys).toEqual([]);
			expect(
				evaluation.steps.some((step) => step.fact === "flag.missing"),
			).toBe(true);
		}
	});
});
