import { describe, expect, it } from "vitest";
import {
	assertNoForbiddenPlanningProposalKeys,
	parsePlanningProposal,
	PLANNING_PROPOSAL_FORBIDDEN_KEYS,
	planningProposalIsPrivate,
	type PlanningProposal,
} from "./planningProposal.js";

const valid: PlanningProposal = {
	kind: "planning",
	id: "pp-1",
	offerKey: "cs-1::low_s2+sticky_p2",
	callSessionId: "cs-1",
	reasons: ["low_s2", "sticky_p2"],
	evidence: {
		eventIds: ["e-fail-1"],
		artifactPaths: [".drive/bank/tasks/t1.md"],
		skillIds: ["drive.plan-improve"],
		taskIds: ["t1"],
		planIds: ["p1"],
	},
	target: {
		type: "plan_template",
		templateId: "stall-recovery-v1",
		relativePath: "accepted/pp-1.json",
	},
	label: "Plan improve: low_s2+sticky_p2",
};

describe("PlanningProposal schema", () => {
	it("parses a valid planning proposal", () => {
		expect(parsePlanningProposal(valid)).toEqual(valid);
		expect(planningProposalIsPrivate(valid)).toBe(true);
	});

	it("rejects utterance payloads via forbidden-key walker", () => {
		for (const key of PLANNING_PROPOSAL_FORBIDDEN_KEYS) {
			expect(() =>
				assertNoForbiddenPlanningProposalKeys({
					...valid,
					[key]: "smuggled",
				}),
			).toThrow(/forbidden key/);
			expect(
				planningProposalIsPrivate({
					...valid,
					[key]: "smuggled",
				}),
			).toBe(false);
		}
	});

	it("rejects nested forbidden keys", () => {
		expect(() =>
			assertNoForbiddenPlanningProposalKeys({
				...valid,
				evidence: {
					...valid.evidence,
					transcript: ["hello"],
				},
			}),
		).toThrow(/transcript/);
	});

	it("rejects unknown keys via zod strict", () => {
		expect(() =>
			parsePlanningProposal({
				...valid,
				extra: true,
			}),
		).toThrow();
	});

	it("requires kind planning and at least one reason", () => {
		expect(() =>
			parsePlanningProposal({
				...valid,
				kind: "recovery",
			}),
		).toThrow();
		expect(() =>
			parsePlanningProposal({
				...valid,
				reasons: [],
			}),
		).toThrow();
	});
});
