/**
 * Filter and facet logic for the Artifacts page, kept out of the component so
 * it can be tested under the node environment the webview suite runs in (the
 * same reason `status-filters.ts` exists — the suite only collects `.test.ts`).
 *
 * Two axes, because the taxonomy alone cannot answer the question people ask.
 * `artifactKind` is a closed union the producers commit to, so it can express
 * "diagrams" and "plans" exactly; it has no member for "scripts", and inventing
 * one would put a UI label into an event schema. Free-form `tags[]` covers that
 * half. Both narrow the same list, so a tag can cut across kinds.
 *
 * Kind facets are groups, not raw kinds: a person looking for a diagram wants
 * all four `diagram.*` members, and "animations" spans two families
 * (`walkthrough.animation` and `capture.demo_clip`). The map below is a total
 * `Record` over the union, so a new `ShowArtifactKind` fails to compile until
 * it is given a home rather than silently vanishing from every facet.
 */

import {
	artifactDirectoryTags,
	type DriveArtifactDirectoryEntry,
	sortArtifactDirectory,
} from "@cline/drive";
import type { ShowArtifactKind } from "@cline/shared";

export type ArtifactKindFacetId =
	| "plans"
	| "diagrams"
	| "walkthroughs"
	| "animations"
	| "captures"
	| "reviews"
	| "shares"
	| "work";

/** Total over `ShowArtifactKind` — every kind belongs to exactly one facet. */
export const ARTIFACT_KIND_FACET_BY_KIND: Record<
	ShowArtifactKind,
	ArtifactKindFacetId
> = {
	"doc.plan": "plans",
	"doc.review": "reviews",
	"diagram.architecture": "diagrams",
	"diagram.data_flow": "diagrams",
	"diagram.network_security": "diagrams",
	"diagram.sequence": "diagrams",
	"walkthrough.code": "walkthroughs",
	"walkthrough.animation": "animations",
	"capture.demo_clip": "animations",
	"capture.screenshot": "captures",
	"share.structured": "shares",
	"work.card": "work",
};

/** Chip order — the kinds people ask for first lead the row. */
export const ARTIFACT_KIND_FACETS: ReadonlyArray<{
	readonly id: ArtifactKindFacetId;
	readonly label: string;
}> = [
	{ id: "plans", label: "Plans" },
	{ id: "diagrams", label: "Diagrams" },
	{ id: "walkthroughs", label: "Walkthroughs" },
	{ id: "animations", label: "Animations" },
	{ id: "captures", label: "Captures" },
	{ id: "reviews", label: "Reviews" },
	{ id: "shares", label: "Shares" },
	{ id: "work", label: "Work" },
];

/**
 * True for a kind this page knows how to file. The corpus is written by our own
 * hub against a zod union, so this is a guard against a *newer* hub than this
 * webview: an unfiled kind would render as a card no facet could ever reach.
 */
export function isShowArtifactKind(value: unknown): value is ShowArtifactKind {
	return (
		typeof value === "string" &&
		Object.hasOwn(ARTIFACT_KIND_FACET_BY_KIND, value)
	);
}

export type ArtifactFilters = {
	readonly query: string;
	readonly kindFacet: ArtifactKindFacetId | null;
	readonly tag: string | null;
};

export const EMPTY_ARTIFACT_FILTERS: ArtifactFilters = {
	query: "",
	kindFacet: null,
	tag: null,
};

/** True when any filter narrows the view away from "everything". */
export function hasActiveArtifactFilters(filters: ArtifactFilters): boolean {
	return (
		filters.query.trim() !== "" ||
		filters.kindFacet !== null ||
		filters.tag !== null
	);
}

/**
 * Free-text over what the card shows plus the facets, so typing "scripts" finds
 * a tag and "animation" finds a media class even before the chips are used.
 * Never the produce recipe: its args are the artifact's contents by another
 * name, and matching on them would surface an entry whose card explains nothing.
 */
export function matchesArtifactQuery(
	entry: DriveArtifactDirectoryEntry,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return true;
	}
	const haystack = [
		entry.title,
		entry.artifactKind,
		entry.mediaClass,
		entry.ownerParticipantId,
		entry.roomId,
		entry.status,
		...entry.tags,
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

export function matchesArtifactKindFacet(
	entry: DriveArtifactDirectoryEntry,
	facet: ArtifactKindFacetId | null,
): boolean {
	return (
		facet === null || ARTIFACT_KIND_FACET_BY_KIND[entry.artifactKind] === facet
	);
}

export function matchesArtifactTag(
	entry: DriveArtifactDirectoryEntry,
	tag: string | null,
): boolean {
	return tag === null || entry.tags.includes(tag);
}

/**
 * The list the page paints: every filter applied, then newest first.
 *
 * The live hub already returns the corpus newest-first, so this sort is not
 * correcting it — it is the page owning its own order, through the projection's
 * comparator rather than a second one written here. A filtered subset and a
 * future non-hub adapter both land on the same order that way.
 */
export function filterArtifacts(
	entries: readonly DriveArtifactDirectoryEntry[],
	filters: ArtifactFilters,
): DriveArtifactDirectoryEntry[] {
	return sortArtifactDirectory(
		entries.filter(
			(entry) =>
				matchesArtifactQuery(entry, filters.query) &&
				matchesArtifactKindFacet(entry, filters.kindFacet) &&
				matchesArtifactTag(entry, filters.tag),
		),
	);
}

/**
 * Kind facets with at least one hit, in chip order. Counting over the set the
 * caller passes — not the whole corpus — is what makes a count honest: a chip
 * reading "3" must lead to three cards, and a facet no longer reachable is
 * dropped rather than left offering an empty list.
 */
export function artifactKindFacetCounts(
	entries: readonly DriveArtifactDirectoryEntry[],
): Array<{ id: ArtifactKindFacetId; label: string; count: number }> {
	const counts = new Map<ArtifactKindFacetId, number>();
	for (const entry of entries) {
		const facet = ARTIFACT_KIND_FACET_BY_KIND[entry.artifactKind];
		counts.set(facet, (counts.get(facet) ?? 0) + 1);
	}
	return ARTIFACT_KIND_FACETS.filter(
		(facet) => (counts.get(facet.id) ?? 0) > 0,
	).map((facet) => ({
		id: facet.id,
		label: facet.label,
		count: counts.get(facet.id) ?? 0,
	}));
}

/**
 * Tag facets with at least one hit — same honesty rule as the kinds. Order and
 * membership come from the projection's own tag helper, so the chip row cannot
 * disagree with what the corpus says its tags are.
 */
export function artifactTagFacetCounts(
	entries: readonly DriveArtifactDirectoryEntry[],
): Array<{ tag: string; count: number }> {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		for (const tag of entry.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return artifactDirectoryTags(entries).map((tag) => ({
		tag,
		count: counts.get(tag) ?? 0,
	}));
}

/**
 * Both chip rows, each counted over the set the *other* axis has already
 * narrowed — so a chip reading "3" leads to three cards rather than to however
 * many exist somewhere in the corpus.
 *
 * This wiring lives here rather than in the component because which set feeds
 * which counter is exactly the part that can be silently wrong: swap the two
 * predicates and every count is plausible and none is right. The suite is
 * node-only and cannot load the `.tsx`, so logic left there is untestable.
 */
export function artifactFacetSets(
	entries: readonly DriveArtifactDirectoryEntry[],
	filters: ArtifactFilters,
): {
	kinds: Array<{ id: ArtifactKindFacetId; label: string; count: number }>;
	tags: Array<{ tag: string; count: number }>;
} {
	const queryFiltered = entries.filter((entry) =>
		matchesArtifactQuery(entry, filters.query),
	);
	return {
		kinds: artifactKindFacetCounts(
			queryFiltered.filter((entry) => matchesArtifactTag(entry, filters.tag)),
		),
		tags: artifactTagFacetCounts(
			queryFiltered.filter((entry) =>
				matchesArtifactKindFacet(entry, filters.kindFacet),
			),
		),
	};
}
