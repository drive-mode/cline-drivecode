/**
 * Recruit-on-stall structured need + lexical rank (DRV-RECRUIT-STALL).
 *
 * Need carries title / capability labels / artifact+node ids only —
 * never utterance payloads. Ranking reasons cite matched labels.
 */

export type RecruitNeed = {
	taskId: string;
	planId: string | null;
	/** Task title (structured, not an utterance). */
	title: string;
	capabilities: string[];
	domains: string[];
	artifactIds: string[];
	nodeIds: string[];
};

export type RecruitCandidate = {
	slug: string;
	displayName: string;
	labels: string[];
	domains: string[];
	suggestedPackIds?: string[];
};

export type RankedRecruit = {
	slug: string;
	displayName: string;
	score: number;
	/** Reviewable reasons (e.g. label:security) — no model prose. */
	reasons: string[];
	suggestedPackIds?: string[];
};

export const RECRUIT_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"fullTranscript",
] as const;

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((token) => token.length > 1);
}

/**
 * Build a structured need from a stuck task. Failure note contributes
 * capability tokens only — the note itself is not stored on the need.
 */
export function buildRecruitNeed(input: {
	taskId: string;
	planId: string | null;
	title?: string | null;
	/** lastFailure note — tokenized into capabilities; not copied as text. */
	failureNote?: string | null;
	capabilities?: string[];
	domains?: string[];
	artifactIds?: string[];
	nodeIds?: string[];
}): RecruitNeed {
	const title = input.title?.trim() || input.taskId;
	const fromTitle = tokenize(title);
	const fromFailure = tokenize(input.failureNote ?? "");
	const capabilities = [
		...new Set([...(input.capabilities ?? []), ...fromTitle, ...fromFailure]),
	];
	return {
		taskId: input.taskId,
		planId: input.planId,
		title,
		capabilities,
		domains: [...(input.domains ?? [])],
		artifactIds: [...(input.artifactIds ?? [])],
		nodeIds: [...(input.nodeIds ?? [])],
	};
}

function scoreCandidate(
	need: RecruitNeed,
	candidate: RecruitCandidate,
): { score: number; reasons: string[] } {
	const reasons: string[] = [];
	let score = 0;
	const labels = candidate.labels.map((value) => value.toLowerCase());
	const domains = candidate.domains.map((value) => value.toLowerCase());
	const needTokens = [
		...need.capabilities,
		...need.domains,
		...tokenize(need.title),
	].map((token) => token.toLowerCase());

	for (const token of needTokens) {
		for (const label of labels) {
			if (label.includes(token) || token.includes(label)) {
				score += 1;
				reasons.push(`label:${label}`);
			}
		}
		for (const domain of domains) {
			if (domain.includes(token) || token.includes(domain)) {
				score += 1;
				reasons.push(`domain:${domain}`);
			}
		}
	}

	return { score, reasons: [...new Set(reasons)] };
}

/**
 * Rank candidates for a structured need. Stable slug order on ties / empty need.
 */
export function rankRecruitCandidates(
	need: RecruitNeed,
	candidates: readonly RecruitCandidate[],
	options?: { limit?: number },
): RankedRecruit[] {
	const limit =
		typeof options?.limit === "number" && options.limit > 0
			? Math.floor(options.limit)
			: candidates.length;

	const ranked = candidates
		.map((candidate) => {
			const { score, reasons } = scoreCandidate(need, candidate);
			const entry: RankedRecruit = {
				slug: candidate.slug,
				displayName: candidate.displayName,
				score,
				reasons:
					reasons.length > 0 ? reasons : score === 0 ? ["slug_order"] : reasons,
			};
			if (candidate.suggestedPackIds?.length) {
				entry.suggestedPackIds = [...candidate.suggestedPackIds];
			}
			return entry;
		})
		.sort((a, b) => {
			if (b.score !== a.score) {
				return b.score - a.score;
			}
			return a.slug.localeCompare(b.slug);
		});

	return ranked.slice(0, limit);
}

export function recruitNeedIsPrivate(value: unknown): boolean {
	if (value === null || typeof value !== "object") {
		return false;
	}
	for (const key of Object.keys(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of RECRUIT_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return false;
			}
		}
	}
	return true;
}
