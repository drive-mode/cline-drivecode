import type {
	ConcernRecord,
	EvidenceRef,
	ReadinessInput,
	UnsupportedInference,
} from "../src/schema";

export const outcomeEvidence: EvidenceRef = {
	id: "brief-outcome",
	sourceType: "brief",
	source: "case brief",
	claim: "The implementation gate is applicable to this project.",
};

export const decisionEvidence: EvidenceRef = {
	id: "decision-proof",
	sourceType: "decision",
	source: "accepted decision record",
	claim: "The architecture choice and acceptance evidence are recorded.",
};

export function concern(overrides: Partial<ConcernRecord> = {}): ConcernRecord {
	return {
		id: "architecture-boundary",
		concern: "Define the durable architecture boundary.",
		applicability: "applicable",
		resolution: "decision",
		state: "unresolved",
		urgency: "now",
		artifactRoute: "adr",
		lifecycleGate: "implementation",
		criticality: "critical",
		significanceReasons: ["cross_cutting"],
		prerequisites: [],
		readinessEffect: "blocks",
		evidenceRefs: [outcomeEvidence.id],
		resolutionEvidenceRefs: [],
		unsupportedInferenceRefs: [],
		unknowns: [],
		rationale: "The boundary affects the whole implementation.",
		...overrides,
	};
}

export function unsupportedInference(
	overrides: Partial<UnsupportedInference> = {},
): UnsupportedInference {
	return {
		id: "assumed-proof",
		claim: "The unresolved choice is assumed to be safe.",
		severity: "critical",
		status: "unresolved",
		evidenceRefs: [],
		affectsConcernIds: ["architecture-boundary"],
		...overrides,
	};
}

export function readinessRequest(
	overrides: Partial<ReadinessInput> = {},
): ReadinessInput {
	return {
		policyVersion: "m1.0",
		requestedGate: "implementation",
		gateApplicability: {
			applicability: "applicable",
			rationale: "Production-intent code is planned.",
			evidenceRefs: [outcomeEvidence.id],
		},
		evidence: [outcomeEvidence, decisionEvidence],
		unsupportedInferences: [],
		concerns: [concern()],
		...overrides,
	};
}
