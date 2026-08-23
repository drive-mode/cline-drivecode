import {
	type ConcernRecord,
	type Diagnostic,
	LIFECYCLE_GATE_ORDER,
	type ReadinessInput,
	ReadinessInputSchema,
	type ReadinessResult,
} from "../schema";
import {
	compareCodeUnits,
	diagnostic,
	hasErrors,
	sortDiagnostics,
} from "./diagnostics";
import { validateConcernGraph } from "./validate-graph";
import { validateConcernRouting } from "./validate-routing";

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

function zodDiagnostics(error: {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}): Diagnostic[] {
	return error.issues.map((issue) =>
		diagnostic("readiness.schema", "error", issue.message, {
			path: issue.path.map(String).join("."),
		}),
	);
}

function isAtOrBeforeRequestedGate(
	concern: ConcernRecord,
	requestedGate: ReadinessInput["requestedGate"],
): boolean {
	if (concern.lifecycleGate === "not_applicable") return false;
	return (
		LIFECYCLE_GATE_ORDER[concern.lifecycleGate] <=
		LIFECYCLE_GATE_ORDER[requestedGate]
	);
}

export function calculateReadiness(input: unknown): ReadinessResult {
	const parsed = ReadinessInputSchema.safeParse(input);
	if (!parsed.success) {
		return {
			policyVersion: "unknown",
			requestedGate: "preplan",
			status: "blocked",
			evaluatedConcernIds: [],
			blockerIds: [],
			warningIds: [],
			diagnostics: sortDiagnostics(zodDiagnostics(parsed.error)),
		};
	}

	const request = parsed.data;
	const diagnostics: Diagnostic[] = [
		...validateConcernGraph(request.concerns),
		...validateConcernRouting(request.concerns),
	];
	const blockers = new Set<string>();
	const warnings = new Set<string>();
	const evidenceById = new Map(
		request.evidence.map((entry) => [entry.id, entry]),
	);
	const inferenceById = new Map(
		request.unsupportedInferences.map((entry) => [entry.id, entry]),
	);

	if (evidenceById.size !== request.evidence.length) {
		diagnostics.push(
			diagnostic(
				"readiness.duplicate_evidence",
				"error",
				"Evidence ids must be unique",
			),
		);
	}
	if (inferenceById.size !== request.unsupportedInferences.length) {
		diagnostics.push(
			diagnostic(
				"readiness.duplicate_inference",
				"error",
				"Unsupported inference ids must be unique",
			),
		);
	}

	for (const evidenceRef of request.gateApplicability.evidenceRefs) {
		if (!evidenceById.has(evidenceRef)) {
			diagnostics.push(
				diagnostic(
					"readiness.missing_gate_evidence",
					"error",
					`Gate applicability references missing evidence ${evidenceRef}`,
				),
			);
		}
	}

	const relevant = request.concerns
		.filter((concern) =>
			isAtOrBeforeRequestedGate(concern, request.requestedGate),
		)
		.sort((left, right) => compareCodeUnits(left.id, right.id));

	if (request.gateApplicability.applicability === "not_applicable") {
		const conflicting = relevant.filter(
			(concern) => concern.applicability !== "not_applicable",
		);
		if (request.gateApplicability.evidenceRefs.length === 0) {
			diagnostics.push(
				diagnostic(
					"readiness.unproven_not_applicable",
					"error",
					"A not-applicable gate requires evidence",
				),
			);
		}
		if (conflicting.length > 0) {
			for (const concern of conflicting) blockers.add(concern.id);
			diagnostics.push(
				diagnostic(
					"readiness.not_applicable_conflict",
					"error",
					"Gate is marked not applicable but active concerns target it or an earlier gate",
					{ concernIds: conflicting.map((concern) => concern.id) },
				),
			);
		}

		return {
			policyVersion: request.policyVersion,
			requestedGate: request.requestedGate,
			status: hasErrors(diagnostics) ? "blocked" : "not_applicable",
			evaluatedConcernIds: relevant.map((concern) => concern.id),
			blockerIds: uniqueSorted(blockers),
			warningIds: [],
			diagnostics: sortDiagnostics(diagnostics),
		};
	}

	for (const concern of relevant) {
		for (const evidenceRef of [
			...concern.evidenceRefs,
			...concern.resolutionEvidenceRefs,
			...(concern.acceptance?.evidenceRefs ?? []),
		]) {
			if (!evidenceById.has(evidenceRef)) {
				blockers.add(concern.id);
				diagnostics.push(
					diagnostic(
						"readiness.missing_evidence",
						"error",
						`Concern ${concern.id} references missing evidence ${evidenceRef}`,
						{ concernIds: [concern.id] },
					),
				);
			}
		}

		for (const inferenceRef of concern.unsupportedInferenceRefs) {
			const inference = inferenceById.get(inferenceRef);
			if (!inference) {
				blockers.add(concern.id);
				diagnostics.push(
					diagnostic(
						"readiness.missing_inference",
						"error",
						`Concern ${concern.id} references missing inference ${inferenceRef}`,
						{ concernIds: [concern.id] },
					),
				);
				continue;
			}
			if (inference.status === "supported") continue;
			if (inference.severity === "critical") {
				blockers.add(concern.id);
				diagnostics.push(
					diagnostic(
						"readiness.critical_unsupported_inference",
						"error",
						`Critical unsupported inference ${inference.id} cannot satisfy ${concern.id}`,
						{ concernIds: [concern.id] },
					),
				);
			} else {
				warnings.add(concern.id);
				diagnostics.push(
					diagnostic(
						"readiness.unsupported_inference",
						"warning",
						`Unsupported inference ${inference.id} affects ${concern.id}`,
						{ concernIds: [concern.id] },
					),
				);
			}
		}

		if (concern.applicability === "unknown") {
			if (
				concern.criticality === "critical" ||
				concern.readinessEffect === "blocks"
			) {
				blockers.add(concern.id);
				diagnostics.push(
					diagnostic(
						"readiness.unknown_blocker",
						"error",
						`Unknown applicability blocks concern ${concern.id}`,
						{ concernIds: [concern.id] },
					),
				);
			} else {
				warnings.add(concern.id);
			}
			continue;
		}

		if (concern.applicability === "not_applicable") continue;

		if (concern.state === "unresolved") {
			if (concern.readinessEffect === "blocks") blockers.add(concern.id);
			if (concern.readinessEffect === "warns") warnings.add(concern.id);
			continue;
		}

		if (concern.state === "accepted_risk") {
			if (!concern.acceptance || concern.acceptance.evidenceRefs.length === 0) {
				blockers.add(concern.id);
			}
			continue;
		}

		if (
			concern.state === "resolved" &&
			concern.readinessEffect === "blocks" &&
			concern.resolutionEvidenceRefs.length === 0
		) {
			blockers.add(concern.id);
		}
		if (concern.readinessEffect === "warns") warnings.add(concern.id);
	}

	return {
		policyVersion: request.policyVersion,
		requestedGate: request.requestedGate,
		status: blockers.size > 0 || hasErrors(diagnostics) ? "blocked" : "pass",
		evaluatedConcernIds: relevant.map((concern) => concern.id),
		blockerIds: uniqueSorted(blockers),
		warningIds: uniqueSorted(warnings),
		diagnostics: sortDiagnostics(diagnostics),
	};
}
