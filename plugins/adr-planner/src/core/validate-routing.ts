import type { ConcernRecord, Diagnostic } from "../schema";
import { diagnostic, sortDiagnostics } from "./diagnostics";

export function validateConcernRouting(
	concerns: readonly ConcernRecord[],
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	for (const concern of concerns) {
		if (
			concern.artifactRoute === "adr" &&
			concern.significanceReasons.length === 0
		) {
			diagnostics.push(
				diagnostic(
					"routing.adr_without_significance",
					"error",
					`ADR concern ${concern.id} requires at least one significance reason`,
					{ concernIds: [concern.id] },
				),
			);
		}

		const anyNotApplicable =
			concern.applicability === "not_applicable" ||
			concern.resolution === "not_applicable" ||
			concern.state === "not_applicable" ||
			concern.urgency === "not_applicable" ||
			concern.lifecycleGate === "not_applicable";
		const allNotApplicable =
			concern.applicability === "not_applicable" &&
			concern.resolution === "not_applicable" &&
			concern.state === "not_applicable" &&
			concern.urgency === "not_applicable" &&
			concern.lifecycleGate === "not_applicable" &&
			concern.artifactRoute === "none" &&
			concern.readinessEffect === "none";

		if (anyNotApplicable && !allNotApplicable) {
			diagnostics.push(
				diagnostic(
					"routing.incoherent_not_applicable",
					"error",
					`Concern ${concern.id} mixes not-applicable and active classifications`,
					{ concernIds: [concern.id] },
				),
			);
		}

		if (concern.state === "accepted_risk" && !concern.acceptance) {
			diagnostics.push(
				diagnostic(
					"routing.risk_without_acceptance",
					"error",
					`Accepted risk ${concern.id} requires explicit human acceptance evidence`,
					{ concernIds: [concern.id] },
				),
			);
		}

		if (
			concern.state === "resolved" &&
			concern.readinessEffect === "blocks" &&
			concern.resolutionEvidenceRefs.length === 0
		) {
			diagnostics.push(
				diagnostic(
					"routing.resolved_blocker_without_evidence",
					"error",
					`Resolved blocker ${concern.id} requires resolution evidence`,
					{ concernIds: [concern.id] },
				),
			);
		}
	}

	return sortDiagnostics(diagnostics);
}
