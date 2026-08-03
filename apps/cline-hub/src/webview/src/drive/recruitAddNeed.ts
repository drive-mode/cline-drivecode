/**
 * Free-text Add → Recruit need builder (DRV-RECRUIT).
 * Reuses kernel buildRecruitNeed / rankRecruitCandidates — no utterance storage.
 */

import {
	buildRecruitNeed,
	rankRecruitCandidates,
	type RankedRecruit,
	type RecruitCandidate,
	type RecruitNeed,
} from "@cline/drive";

/** Builtin fixtures so lexical rank has labels beyond the seated pair. */
export const RECRUIT_FIXTURE_CANDIDATES: readonly RecruitCandidate[] = [
	{
		slug: "security-reviewer",
		displayName: "Security Reviewer",
		labels: ["security", "auth", "review"],
		domains: ["auth"],
		suggestedPackIds: ["security-crew"],
	},
	{
		slug: "test-fixer",
		displayName: "Test Fixer",
		labels: ["tests", "parser", "fixup"],
		domains: ["qa"],
	},
];

export type SeatedRecruitSource = {
	id: string;
	displayName: string;
	role: string;
	kind: string;
};

/**
 * Structured need from free-text Add → Recruit. Title tokens become
 * capabilities; the raw string is not stored as an utterance field.
 */
export function buildRecruitNeedFromFreeText(needText: string): RecruitNeed {
	const trimmed = needText.trim();
	return buildRecruitNeed({
		taskId: "recruit-add",
		planId: null,
		title: trimmed || "recruit",
	});
}

/** Merge seated agents with fixtures; seated wins on slug collision. */
export function collectRecruitCandidates(
	seated: readonly SeatedRecruitSource[],
	fixtures: readonly RecruitCandidate[] = RECRUIT_FIXTURE_CANDIDATES,
): RecruitCandidate[] {
	const candidates: RecruitCandidate[] = [];
	const seen = new Set<string>();
	for (const participant of seated) {
		if (participant.kind !== "agent") {
			continue;
		}
		if (seen.has(participant.id)) {
			continue;
		}
		seen.add(participant.id);
		candidates.push({
			slug: participant.id,
			displayName: participant.displayName,
			labels: [participant.role, participant.displayName, participant.id],
			domains: [],
		});
	}
	for (const fixture of fixtures) {
		if (seen.has(fixture.slug)) {
			continue;
		}
		seen.add(fixture.slug);
		candidates.push(fixture);
	}
	return candidates;
}

/** Rank free-text need against candidates (stable slug order on empty need). */
export function rankRecruitFromFreeText(
	needText: string,
	candidates: readonly RecruitCandidate[],
	options?: { limit?: number },
): { need: RecruitNeed; ranked: RankedRecruit[] } {
	const need = buildRecruitNeedFromFreeText(needText);
	const ranked = rankRecruitCandidates(need, candidates, options);
	return { need, ranked };
}
