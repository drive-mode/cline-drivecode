import type {
	PlanningFact,
	PlanningRule,
	RuleTraceStep,
	TriState,
} from "../schema";
import { compareCodeUnits } from "./diagnostics";

export interface IndexedPlanningFact {
	value: PlanningFact["value"];
	evidenceRefs: string[];
}

export interface RuleEvaluation {
	result: TriState;
	missingFactKeys: string[];
	evidenceRefs: string[];
	steps: RuleTraceStep[];
}

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

function invert(value: TriState): TriState {
	if (value === "true") return "false";
	if (value === "false") return "true";
	return "unknown";
}

function aggregate(
	op: "all" | "any",
	children: readonly RuleEvaluation[],
): TriState {
	if (op === "all") {
		if (children.some((child) => child.result === "false")) return "false";
		if (children.some((child) => child.result === "unknown")) return "unknown";
		return "true";
	}
	if (children.some((child) => child.result === "true")) return "true";
	if (children.some((child) => child.result === "unknown")) return "unknown";
	return "false";
}

function decisiveChildren(
	op: "all" | "any",
	result: TriState,
	children: readonly RuleEvaluation[],
): readonly RuleEvaluation[] {
	if (op === "any" && result === "true") {
		return children.filter((child) => child.result === "true");
	}
	if (op === "all" && result === "false") {
		return children.filter((child) => child.result === "false");
	}
	if (result === "unknown") {
		return children.filter((child) => child.result === "unknown");
	}
	return children;
}

export function evaluatePlanningRule(
	rule: PlanningRule,
	facts: ReadonlyMap<string, IndexedPlanningFact>,
	path = "$",
): RuleEvaluation {
	if (rule.op === "constant") {
		const result = rule.value ? "true" : "false";
		return {
			result,
			missingFactKeys: [],
			evidenceRefs: [],
			steps: [
				{
					path,
					op: rule.op,
					result,
					expected: [rule.value],
					observedState: "not_applicable",
					evidenceRefs: [],
				},
			],
		};
	}

	if (rule.op === "equals" || rule.op === "contains_any") {
		const fact = facts.get(rule.fact);
		if (!fact) {
			return {
				result: "unknown",
				missingFactKeys: [rule.fact],
				evidenceRefs: [],
				steps: [
					{
						path,
						op: rule.op,
						result: "unknown",
						fact: rule.fact,
						expected: rule.op === "equals" ? [rule.value] : [...rule.values],
						observedState: "missing",
						evidenceRefs: [],
					},
				],
			};
		}
		const matched =
			rule.op === "equals"
				? fact.value === rule.value
				: (Array.isArray(fact.value) ? fact.value : [fact.value])
						.filter((value): value is string => typeof value === "string")
						.some((value) => rule.values.includes(value));
		const result = matched ? "true" : "false";
		return {
			result,
			missingFactKeys: [],
			evidenceRefs: [...fact.evidenceRefs],
			steps: [
				{
					path,
					op: rule.op,
					result,
					fact: rule.fact,
					expected: rule.op === "equals" ? [rule.value] : [...rule.values],
					observedState: "known",
					observed: fact.value,
					evidenceRefs: [...fact.evidenceRefs],
				},
			],
		};
	}

	if (rule.op === "not") {
		const child = evaluatePlanningRule(rule.rule, facts, `${path}.rule`);
		const result = invert(child.result);
		return {
			result,
			missingFactKeys: [...child.missingFactKeys],
			evidenceRefs: [...child.evidenceRefs],
			steps: [
				...child.steps,
				{
					path,
					op: rule.op,
					result,
					expected: [],
					observedState: "not_applicable",
					evidenceRefs: [...child.evidenceRefs],
				},
			],
		};
	}

	const children = rule.rules.map((child, index) =>
		evaluatePlanningRule(child, facts, `${path}.rules[${index}]`),
	);
	const result = aggregate(rule.op, children);
	const decisive = decisiveChildren(rule.op, result, children);
	const evidenceRefs = uniqueSorted(
		decisive.flatMap((child) => child.evidenceRefs),
	);
	return {
		result,
		missingFactKeys: uniqueSorted(
			decisive.flatMap((child) => child.missingFactKeys),
		),
		evidenceRefs,
		steps: [
			...children.flatMap((child) => child.steps),
			{
				path,
				op: rule.op,
				result,
				expected: [],
				observedState: "not_applicable",
				evidenceRefs,
			},
		],
	};
}
