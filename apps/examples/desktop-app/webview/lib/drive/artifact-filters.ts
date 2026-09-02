/**
 * Filter, facet, sort and wire-guard logic for the Artifacts surface —
 * ported from the hub's `artifact-filters.ts` / `artifactEntry.ts` and kept
 * out of the component so it runs under the node test environment.
 *
 * Two axes plus status, because the taxonomy alone cannot answer the
 * question people ask. `artifactKind` is a closed union the producers commit
 * to, so it can express "diagrams" exactly; free-form `tags[]` covers the
 * rest; `status` says whether the artifact has had its moment on the
 * Spotlight yet. All three narrow the same list.
 *
 * Kind facets are groups, not raw kinds: a person looking for a diagram wants
 * all four `diagram.*` members. The map below is a total `Record` over the
 * union, so a new `ShowArtifactKind` fails to compile until it is given a
 * home rather than silently vanishing from every facet.
 */

import {
	artifactDirectoryTags,
	type DriveArtifactDirectoryEntry,
	sortArtifactDirectory,
} from "@cline/drive";
import {
	DRIVE_EVENT_FORBIDDEN_KEYS,
	type MediaArtifactStatus,
	type MediaClass,
	type ShowArtifactKind,
} from "@cline/shared";
import { parseDriveCommandError } from "./drive-client";

// ── Taxonomy ─────────────────────────────────────────────────────────

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

/** Human label for one kind — the eyebrow on a card. Total over the union. */
export const ARTIFACT_KIND_LABELS: Record<ShowArtifactKind, string> = {
	"doc.plan": "Plan",
	"doc.review": "Review",
	"diagram.architecture": "Architecture diagram",
	"diagram.data_flow": "Data-flow diagram",
	"diagram.network_security": "Network diagram",
	"diagram.sequence": "Sequence diagram",
	"walkthrough.code": "Code walkthrough",
	"walkthrough.animation": "Change animation",
	"capture.demo_clip": "Demo clip",
	"capture.screenshot": "Screenshot",
	"share.structured": "Structured share",
	"work.card": "Work card",
};

export const MEDIA_CLASS_LABELS: Record<MediaClass, string> = {
	still: "Still",
	animation: "Animation",
	video: "Video",
	document: "Document",
	structured: "Structured",
	work: "Work",
};

/**
 * Status order for chips and the sort: the ones that still need the stage
 * lead, then what has been shown, then what was cancelled.
 */
export const ARTIFACT_STATUSES: ReadonlyArray<{
	readonly id: MediaArtifactStatus;
	readonly label: string;
	readonly hint: string;
}> = [
	{ id: "showing", label: "On stage", hint: "Presented on the Spotlight now." },
	{ id: "ready", label: "Ready", hint: "Rendered and waiting for the stage." },
	{ id: "planned", label: "Planned", hint: "Queued; not rendered yet." },
	{ id: "shown", label: "Shown", hint: "Had its moment on the Spotlight." },
	{ id: "cancelled", label: "Cancelled", hint: "Dropped before it was shown." },
];

const STATUS_RANK: Record<MediaArtifactStatus, number> = {
	showing: 0,
	ready: 1,
	planned: 2,
	shown: 3,
	cancelled: 4,
};

export function artifactStatusLabel(status: MediaArtifactStatus): string {
	return (
		ARTIFACT_STATUSES.find((entry) => entry.id === status)?.label ?? status
	);
}

/**
 * True for a kind this page knows how to file. The corpus is written by our
 * own hub against a zod union, so this guards against a *newer* hub than
 * this webview: an unfiled kind would render as a card no facet could reach.
 */
export function isShowArtifactKind(value: unknown): value is ShowArtifactKind {
	return (
		typeof value === "string" &&
		Object.hasOwn(ARTIFACT_KIND_FACET_BY_KIND, value)
	);
}

const MEDIA_CLASSES: Record<MediaClass, true> = {
	still: true,
	animation: true,
	video: true,
	document: true,
	structured: true,
	work: true,
};

export function isMediaClass(value: unknown): value is MediaClass {
	return typeof value === "string" && Object.hasOwn(MEDIA_CLASSES, value);
}

export function isArtifactStatus(value: unknown): value is MediaArtifactStatus {
	return typeof value === "string" && Object.hasOwn(STATUS_RANK, value);
}

// ── Filters ──────────────────────────────────────────────────────────

export type ArtifactFilters = {
	readonly query: string;
	readonly kindFacet: ArtifactKindFacetId | null;
	readonly tag: string | null;
	readonly status: MediaArtifactStatus | null;
};

export const EMPTY_ARTIFACT_FILTERS: ArtifactFilters = {
	query: "",
	kindFacet: null,
	tag: null,
	status: null,
};

export function hasActiveArtifactFilters(filters: ArtifactFilters): boolean {
	return (
		filters.query.trim() !== "" ||
		filters.kindFacet !== null ||
		filters.tag !== null ||
		filters.status !== null
	);
}

/**
 * Free-text over what the card shows plus the facets. Never the produce
 * recipe: its args are the artifact's contents by another name, and matching
 * on them would surface an entry whose card explains nothing.
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
		ARTIFACT_KIND_LABELS[entry.artifactKind],
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

export function matchesArtifactStatus(
	entry: DriveArtifactDirectoryEntry,
	status: MediaArtifactStatus | null,
): boolean {
	return status === null || entry.status === status;
}

// ── Sorting ──────────────────────────────────────────────────────────

export type ArtifactSortKey =
	| "updated"
	| "created"
	| "title"
	| "kind"
	| "status";

export const ARTIFACT_SORTS: ReadonlyArray<{
	readonly id: ArtifactSortKey;
	readonly label: string;
}> = [
	{ id: "updated", label: "Recently updated" },
	{ id: "created", label: "Newest first" },
	{ id: "title", label: "Title A–Z" },
	{ id: "kind", label: "Kind" },
	{ id: "status", label: "Status" },
];

export const DEFAULT_ARTIFACT_SORT: ArtifactSortKey = "updated";

function keyOf(entry: DriveArtifactDirectoryEntry): string {
	return `${entry.roomId} ${entry.showItemId}`;
}

/**
 * The page owns its order through the projection's comparator where it can
 * (`updated`), so a filtered subset and the hub list land on the same order.
 * Every other key ties back to recency so equal titles stay deterministic.
 */
export function sortArtifacts(
	entries: readonly DriveArtifactDirectoryEntry[],
	key: ArtifactSortKey,
): DriveArtifactDirectoryEntry[] {
	const byRecency = sortArtifactDirectory(entries);
	switch (key) {
		case "updated":
			return byRecency;
		case "created":
			return [...byRecency].sort((a, b) => {
				const compared = b.createdAt.localeCompare(a.createdAt);
				return compared !== 0 ? compared : keyOf(a).localeCompare(keyOf(b));
			});
		case "title":
			return [...byRecency].sort((a, b) =>
				a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
			);
		case "kind":
			return [...byRecency].sort((a, b) =>
				ARTIFACT_KIND_LABELS[a.artifactKind].localeCompare(
					ARTIFACT_KIND_LABELS[b.artifactKind],
				),
			);
		case "status":
			return [...byRecency].sort(
				(a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
			);
		default: {
			const _exhaustive: never = key;
			return _exhaustive;
		}
	}
}

/** The list the page paints: every filter applied, then the chosen order. */
export function filterArtifacts(
	entries: readonly DriveArtifactDirectoryEntry[],
	filters: ArtifactFilters,
	sort: ArtifactSortKey = DEFAULT_ARTIFACT_SORT,
): DriveArtifactDirectoryEntry[] {
	return sortArtifacts(
		entries.filter(
			(entry) =>
				matchesArtifactQuery(entry, filters.query) &&
				matchesArtifactKindFacet(entry, filters.kindFacet) &&
				matchesArtifactTag(entry, filters.tag) &&
				matchesArtifactStatus(entry, filters.status),
		),
		sort,
	);
}

// ── Facets ───────────────────────────────────────────────────────────

export type ArtifactKindFacetCount = {
	id: ArtifactKindFacetId;
	label: string;
	count: number;
};

export type ArtifactTagFacetCount = { tag: string; count: number };

export type ArtifactStatusFacetCount = {
	id: MediaArtifactStatus;
	label: string;
	count: number;
};

/** Kind facets with at least one hit, in chip order. */
export function artifactKindFacetCounts(
	entries: readonly DriveArtifactDirectoryEntry[],
): ArtifactKindFacetCount[] {
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

/** Tag facets, ordered by the projection's own tag helper. */
export function artifactTagFacetCounts(
	entries: readonly DriveArtifactDirectoryEntry[],
): ArtifactTagFacetCount[] {
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

/** Status facets with at least one hit, in status order. */
export function artifactStatusFacetCounts(
	entries: readonly DriveArtifactDirectoryEntry[],
): ArtifactStatusFacetCount[] {
	const counts = new Map<MediaArtifactStatus, number>();
	for (const entry of entries) {
		counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
	}
	return ARTIFACT_STATUSES.filter(
		(status) => (counts.get(status.id) ?? 0) > 0,
	).map((status) => ({
		id: status.id,
		label: status.label,
		count: counts.get(status.id) ?? 0,
	}));
}

/**
 * Every chip row, each counted over the set the *other* axes have already
 * narrowed — so a chip reading "3" leads to three cards rather than to
 * however many exist somewhere in the corpus.
 */
export function artifactFacetSets(
	entries: readonly DriveArtifactDirectoryEntry[],
	filters: ArtifactFilters,
): {
	kinds: ArtifactKindFacetCount[];
	tags: ArtifactTagFacetCount[];
	statuses: ArtifactStatusFacetCount[];
} {
	const queryFiltered = entries.filter((entry) =>
		matchesArtifactQuery(entry, filters.query),
	);
	return {
		kinds: artifactKindFacetCounts(
			queryFiltered.filter(
				(entry) =>
					matchesArtifactTag(entry, filters.tag) &&
					matchesArtifactStatus(entry, filters.status),
			),
		),
		tags: artifactTagFacetCounts(
			queryFiltered.filter(
				(entry) =>
					matchesArtifactKindFacet(entry, filters.kindFacet) &&
					matchesArtifactStatus(entry, filters.status),
			),
		),
		statuses: artifactStatusFacetCounts(
			queryFiltered.filter(
				(entry) =>
					matchesArtifactKindFacet(entry, filters.kindFacet) &&
					matchesArtifactTag(entry, filters.tag),
			),
		),
	};
}

// ── View mode ────────────────────────────────────────────────────────

export type ArtifactViewMode = "grid" | "list";

export function isArtifactViewMode(value: unknown): value is ArtifactViewMode {
	return value === "grid" || value === "list";
}

// ── Wire guard ───────────────────────────────────────────────────────

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

/**
 * The produce recipe with any bytes-shaped key dropped. The hub schema
 * already refuses these on the log; this is the boundary that keeps a
 * future `uri` / `svg` key from being held in UI state even if a newer hub
 * relaxed the rule. Source text (`mermaidSource`, `markdown`, `snippet`)
 * survives — the detail drawer renders from it.
 */
export function sanitizeProduceArgs(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const forbidden = DRIVE_EVENT_FORBIDDEN_KEYS as readonly string[];
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (forbidden.includes(key)) {
			continue;
		}
		out[key] = entry;
	}
	return out;
}

function produceFromUnknown(
	value: unknown,
): DriveArtifactDirectoryEntry["produce"] | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const raw = value as Record<string, unknown>;
	const tool = nonEmptyString(raw.tool);
	if (!tool) {
		return null;
	}
	const templateId = nonEmptyString(raw.templateId);
	return {
		tool,
		...(templateId ? { templateId } : {}),
		args: sanitizeProduceArgs(raw.args),
	};
}

/**
 * Wire shape guard for one corpus entry. Not a second parser — the hub
 * validates every record — but the boundary that stops anything not of the
 * entry shape reaching UI state. Unknown fields are dropped, not spread.
 */
export function artifactDirectoryEntryFromUnknown(
	value: unknown,
): DriveArtifactDirectoryEntry | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const raw = value as Record<string, unknown>;
	const showItemId = nonEmptyString(raw.showItemId);
	const roomId = nonEmptyString(raw.roomId);
	const title = nonEmptyString(raw.title);
	const ownerParticipantId = nonEmptyString(raw.ownerParticipantId);
	if (!showItemId || !roomId || !title || !ownerParticipantId) {
		return null;
	}
	if (
		!isShowArtifactKind(raw.artifactKind) ||
		!isMediaClass(raw.mediaClass) ||
		!isArtifactStatus(raw.status)
	) {
		return null;
	}
	const produce = produceFromUnknown(raw.produce);
	if (!produce) {
		return null;
	}
	return {
		showItemId,
		roomId,
		artifactKind: raw.artifactKind,
		mediaClass: raw.mediaClass,
		title,
		ownerParticipantId,
		produce,
		tags: Array.isArray(raw.tags)
			? raw.tags.filter(
					(tag): tag is string => typeof tag === "string" && tag.trim() !== "",
				)
			: [],
		status: raw.status,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
	};
}

/** Every well-formed entry from a `drive.artifacts.list` reply; the rest dropped. */
export function artifactDirectoryFromReply(
	reply: unknown,
): DriveArtifactDirectoryEntry[] {
	if (typeof reply !== "object" || reply === null) {
		return [];
	}
	const raw = (reply as { artifacts?: unknown }).artifacts;
	if (!Array.isArray(raw)) {
		return [];
	}
	const entries: DriveArtifactDirectoryEntry[] = [];
	for (const candidate of raw) {
		const entry = artifactDirectoryEntryFromUnknown(candidate);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/**
 * The hub binds its artifact log when a Drive call joins, so before the
 * first call it has no corpus for the workspace at all. That is an honest
 * empty page, not a failure.
 */
export function isWorkspaceUnboundError(error: unknown): boolean {
	return parseDriveCommandError(error).code === "workspace_not_bound";
}
