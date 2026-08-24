import { createHash } from "node:crypto";
import type { EvidenceRef, PlanningFact, ProjectProfile } from "../schema";
import {
	isAuthenticRepositoryEvidence,
	repositorySignalFromEvidence,
} from "./analyze-repository-metadata";
import { compareCodeUnits } from "./diagnostics";

const SIGNAL_FACT_KEYS = {
	"surface.web": "surface.web",
	"surface.api": "surface.api",
	"surface.cli": "surface.cli",
	"surface.desktop": "surface.desktop",
	"surface.mobile": "surface.mobile",
	"surface.library": "surface.library",
	"surface.data_pipeline": "surface.data_pipeline",
	"surface.agentic_system": "surface.agentic_system",
	"surface.static_content": "surface.static_content",
	"runtime.static_edge": "runtime.static_edge",
	"runtime.server": "runtime.server",
	"runtime.worker_jobs": "runtime.worker_jobs",
	"runtime.event_driven": "runtime.event_driven",
	"runtime.third_party_hosted": "runtime.third_party_hosted",
} as const;

function factId(key: string): string {
	return `fact-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function derivePlanningFacts(
	profile: ProjectProfile,
	evidence: readonly EvidenceRef[],
): PlanningFact[] {
	const acceptedEvidenceIds = new Set(profile.evidenceRefs);
	const byKey = new Map<string, Set<string>>();
	for (const entry of evidence) {
		if (!acceptedEvidenceIds.has(entry.id)) continue;
		if (!isAuthenticRepositoryEvidence(entry)) continue;
		const signal = repositorySignalFromEvidence(entry);
		if (!signal) continue;
		const key = SIGNAL_FACT_KEYS[signal as keyof typeof SIGNAL_FACT_KEYS];
		if (!key) continue;
		const references = byKey.get(key) ?? new Set<string>();
		references.add(entry.id);
		byKey.set(key, references);
	}

	return [...byKey.entries()]
		.sort(([left], [right]) => compareCodeUnits(left, right))
		.map(([key, evidenceRefs]) => ({
			id: factId(key),
			key,
			value: true,
			evidenceRefs: [...evidenceRefs].sort(compareCodeUnits),
		}));
}
