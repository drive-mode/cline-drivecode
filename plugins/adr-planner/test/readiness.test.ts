import { describe, expect, it } from "bun:test";
import { calculateReadiness, canonicalJson } from "../src/core";
import {
	concern,
	decisionEvidence,
	outcomeEvidence,
	readinessRequest,
	unsupportedInference,
} from "./fixtures";

describe("readiness calculation", () => {
	it("blocks an unresolved applicable blocker", () => {
		const result = calculateReadiness(readinessRequest());
		expect(result.status).toBe("blocked");
		expect(result.blockerIds).toEqual(["architecture-boundary"]);
	});

	it("passes a resolved blocker with grounded resolution evidence", () => {
		const result = calculateReadiness(
			readinessRequest({
				concerns: [
					concern({
						state: "resolved",
						resolutionEvidenceRefs: [decisionEvidence.id],
					}),
				],
			}),
		);
		expect(result.status).toBe("pass");
		expect(result.blockerIds).toEqual([]);
	});

	it("does not let a critical unsupported inference satisfy a blocker", () => {
		const inference = unsupportedInference();
		const result = calculateReadiness(
			readinessRequest({
				unsupportedInferences: [inference],
				concerns: [
					concern({
						state: "resolved",
						resolutionEvidenceRefs: [decisionEvidence.id],
						unsupportedInferenceRefs: [inference.id],
					}),
				],
			}),
		);
		expect(result.status).toBe("blocked");
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"readiness.critical_unsupported_inference",
		);
	});

	it("requires evidence and no active conflict for a not-applicable gate", () => {
		const notApplicable = concern({
			applicability: "not_applicable",
			resolution: "not_applicable",
			state: "not_applicable",
			urgency: "not_applicable",
			artifactRoute: "none",
			lifecycleGate: "not_applicable",
			readinessEffect: "none",
			significanceReasons: [],
		});
		const result = calculateReadiness(
			readinessRequest({
				requestedGate: "pilot",
				gateApplicability: {
					applicability: "not_applicable",
					rationale: "The brief has no external pilot.",
					evidenceRefs: [outcomeEvidence.id],
				},
				concerns: [notApplicable],
			}),
		);
		expect(result.status).toBe("not_applicable");
	});

	it("fails closed on invalid input", () => {
		const result = calculateReadiness({ requestedGate: "implementation" });
		expect(result.status).toBe("blocked");
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});

	it("is byte stable across identical requests", () => {
		const request = readinessRequest();
		const outputs = Array.from({ length: 10 }, () =>
			canonicalJson(calculateReadiness(request)),
		);
		expect(new Set(outputs).size).toBe(1);
	});
});
