/**
 * Status Hub — the pure half of the board and changelog lenses.
 *
 * Filters, the page request the lens sends through the Drive port, the guard
 * that admits a hub page or a live `status.updated` broadcast, the merge of a
 * live row into the rows already on screen, and the small presentation model
 * a row needs. Kept out of the components so it runs under the node
 * environment the webview suite uses.
 *
 * Mirrors `apps/cline-hub/src/webview/src/components/views/status-filters.ts`;
 * the filter semantics must stay identical to the server-side
 * `StatusQuerySchema` or a live row would contradict the page it lands on.
 */

import type { StatusState, StatusTagCount, StatusUpdate } from "@cline/shared";
import type { DriveCommandPayload, DriveHubEvent } from "./drive-client";
import type { DriveStatusLens } from "./drive-prefs";

export type StatusLens = DriveStatusLens;

export type StatusLensDefinition = {
	id: StatusLens;
	label: string;
	/** What the lens answers — the page description while it is active. */
	description: string;
};

export const STATUS_LENSES: readonly StatusLensDefinition[] = [
	{
		id: "board",
		label: "Board",
		description:
			"Where every agent is right now — one row per piece of work, most urgent first.",
	},
	{
		id: "changelog",
		label: "Changelog",
		description:
			"Everything that has happened, newest first, including superseded updates.",
	},
	{
		id: "dependency-map",
		label: "Dependency map",
		description: "Task prerequisites and dependent work from active teams.",
	},
];

export function statusLensDefinition(lens: StatusLens): StatusLensDefinition {
	return STATUS_LENSES.find((entry) => entry.id === lens) ?? STATUS_LENSES[0];
}

export interface StatusFilters {
	stateFilter: StatusState[];
	agentFilter: string | null;
	/** Tags a row must carry — all of them, not any. See `StatusQuerySchema`. */
	tagFilter: string[];
	search: string;
}

export const EMPTY_STATUS_FILTERS: StatusFilters = {
	stateFilter: [],
	agentFilter: null,
	tagFilter: [],
	search: "",
};

/** True when any filter narrows the view away from "everything". */
export function hasActiveFilters(filters: StatusFilters): boolean {
	return (
		filters.stateFilter.length > 0 ||
		filters.agentFilter !== null ||
		filters.tagFilter.length > 0 ||
		filters.search !== ""
	);
}

/** Mirrors the server-side query so a live row is held to the same test. */
export function matchesStatusFilters(
	update: StatusUpdate,
	filters: StatusFilters,
): boolean {
	if (
		filters.stateFilter.length > 0 &&
		!filters.stateFilter.includes(update.state)
	) {
		return false;
	}
	if (filters.agentFilter && update.agentId !== filters.agentFilter) {
		return false;
	}
	if (
		filters.tagFilter.length > 0 &&
		!filters.tagFilter.every((tag) => update.tags.includes(tag))
	) {
		return false;
	}
	if (filters.search) {
		const haystack = `${update.headline} ${update.detail ?? ""}`.toLowerCase();
		if (!haystack.includes(filters.search.toLowerCase())) {
			return false;
		}
	}
	return true;
}

export interface StatusTagFacet {
	tag: string;
	count: number;
	/** Whether this tag is one of the ones currently narrowing the view. */
	selected: boolean;
}

/**
 * Tag chips to offer, from the counts the server computed over the whole set
 * the current query matches. Counting the page instead under-reports the
 * moment the result set outruns the page size, and a chip's number is a
 * promise about what clicking it returns.
 *
 * A tag with no hits is dropped rather than rendered at zero; selected tags
 * survive a zero count so the chip you just clicked does not vanish.
 */
export function statusTagFacets(
	counts: readonly StatusTagCount[],
	selected: readonly string[],
): StatusTagFacet[] {
	const byTag = new Map<string, number>();
	for (const tag of selected) {
		byTag.set(tag, 0);
	}
	for (const { tag, count } of counts) {
		byTag.set(tag, count);
	}
	const selectedSet = new Set(selected);
	return [...byTag.entries()]
		.filter(([tag, count]) => count > 0 || selectedSet.has(tag))
		.map(([tag, count]) => ({ tag, count, selected: selectedSet.has(tag) }))
		.sort(
			(a, b) =>
				Number(b.selected) - Number(a.selected) ||
				b.count - a.count ||
				a.tag.localeCompare(b.tag),
		);
}

/** Add or remove one tag, keeping the list stable for the request payload. */
export function toggleTagFilter(
	current: readonly string[],
	tag: string,
): string[] {
	return current.includes(tag)
		? current.filter((entry) => entry !== tag)
		: [...current, tag];
}

/** Add or remove one state, keeping the list stable for the request payload. */
export function toggleStateFilter(
	current: readonly StatusState[],
	state: StatusState,
): StatusState[] {
	return current.includes(state)
		? current.filter((entry) => entry !== state)
		: [...current, state];
}

/**
 * What a board section heading should claim: the whole-table count when
 * unfiltered, the rows on screen once a filter is on (the summary knows
 * nothing about the subset below the heading).
 */
export function sectionHeadingCount(
	rowCount: number,
	summaryCount: number | undefined,
	filtersActive: boolean,
): number {
	if (filtersActive) {
		return rowCount;
	}
	return summaryCount ?? rowCount;
}

export type BoardSection = {
	state: StatusState;
	blurb: string;
};

/** Board section order — what needs a human first. */
export const BOARD_SECTIONS: readonly BoardSection[] = [
	{ state: "blocked", blurb: "Waiting on someone. Start here." },
	{ state: "failed", blurb: "Stopped and will not continue on its own." },
	{ state: "running", blurb: "In progress right now." },
	{ state: "queued", blurb: "Accepted, not started." },
	{ state: "done", blurb: "Finished." },
	{ state: "cancelled", blurb: "Abandoned." },
];

/** Summary tiles that lead with what is wrong. */
export const TILE_STATES: readonly StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
	"done",
];

export type BoardSectionRows = BoardSection & { rows: StatusUpdate[] };

/** Rows under state headings, in attention order; empty sections are dropped. */
export function groupBoardSections(
	updates: readonly StatusUpdate[],
): BoardSectionRows[] {
	return BOARD_SECTIONS.map((section) => ({
		...section,
		rows: updates.filter((update) => update.state === section.state),
	})).filter((section) => section.rows.length > 0);
}

export const STATUS_PAGE_LIMIT = 50;

export type StatusPageRequest = {
	op: "board" | "query";
	payload: DriveCommandPayload;
};

/**
 * The `drive_status` call one page needs.
 *
 * Facets are asked for on page one only: they ignore the cursor, so every
 * page of one query carries identical counts, and asking again while paging
 * costs two aggregates over the whole set for nothing.
 */
export function statusPageRequest(
	lens: Exclude<StatusLens, "dependency-map">,
	filters: StatusFilters,
	cursor: number | null,
	limit: number = STATUS_PAGE_LIMIT,
): StatusPageRequest {
	const search = filters.search.trim().slice(0, 300);
	return {
		op: lens === "board" ? "board" : "query",
		payload: {
			limit,
			...(cursor == null ? { includeFacets: true } : {}),
			...(cursor != null ? { cursor } : {}),
			...(filters.stateFilter.length ? { state: filters.stateFilter } : {}),
			...(filters.agentFilter ? { agentId: filters.agentFilter } : {}),
			...(filters.tagFilter.length ? { tags: filters.tagFilter } : {}),
			...(search ? { text: search } : {}),
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

/**
 * Shallow guard over the fields the lens keys on. Fields that are only ever
 * rendered as text stay unchecked — they are inert — and `tags` is coerced to
 * an array so the filter predicate never throws on a row the hub sent bare.
 */
export function asStatusUpdate(value: unknown): StatusUpdate | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.updateId !== "string" ||
		typeof value.subject !== "string" ||
		typeof value.state !== "string" ||
		typeof value.headline !== "string" ||
		typeof value.createdAt !== "string" ||
		!isOptionalString(value.agentId)
	) {
		return null;
	}
	const tags = Array.isArray(value.tags)
		? value.tags.filter((tag): tag is string => typeof tag === "string")
		: [];
	return { ...(value as unknown as StatusUpdate), tags };
}

export type StatusPage = {
	updates: StatusUpdate[];
	nextCursor: number | null;
	hasMore: boolean;
	/** Only when the reply carried a finite count — never a fabricated zero. */
	total?: number;
	/** Only when the reply carried facets; a page-two reply omits them. */
	tagFacets?: StatusTagCount[];
};

function isStatusTagCount(value: unknown): value is StatusTagCount {
	return (
		isRecord(value) &&
		typeof value.tag === "string" &&
		value.tag !== "" &&
		typeof value.count === "number" &&
		Number.isFinite(value.count)
	);
}

/**
 * The usable page inside a `status.board` / `status.query` reply. One junk
 * row costs its own row and one junk facet its own chip; neither sinks the
 * page, because the list clears its loading state only on a page it accepts.
 */
export function parseStatusPage(reply: unknown): StatusPage {
	if (!isRecord(reply)) {
		return { updates: [], nextCursor: null, hasMore: false };
	}
	const updates = Array.isArray(reply.updates)
		? reply.updates
				.map(asStatusUpdate)
				.filter((update): update is StatusUpdate => update !== null)
		: [];
	const page: StatusPage = {
		updates,
		nextCursor:
			typeof reply.nextCursor === "number" && Number.isFinite(reply.nextCursor)
				? reply.nextCursor
				: null,
		hasMore: reply.hasMore === true,
	};
	if (typeof reply.total === "number" && Number.isFinite(reply.total)) {
		page.total = reply.total;
	}
	if (Array.isArray(reply.tagFacets)) {
		page.tagFacets = reply.tagFacets.filter(isStatusTagCount);
	}
	return page;
}

/**
 * Per-tag counts over `rows`, for the one case where counting rows is honest:
 * a page that is the whole result set (`hasMore` false, no cursor). Then the
 * rows *are* the set the chips describe, so the count is exact rather than an
 * under-report — which is what makes a source that ignores `includeFacets`
 * (the demo world) still get truthful chips.
 */
export function countTagFacets(
	rows: readonly StatusUpdate[],
): StatusTagCount[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		for (const tag of new Set(row.tags)) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Reconcile a page with the filters it was asked under.
 *
 * Rows are held to `matchesStatusFilters` on the way in — a no-op for a hub
 * page the server already filtered, and the only thing that keeps a source
 * that ignores filters (the demo world) from showing rows that contradict the
 * chips above them. When the page is the complete set, its total and facets
 * are derived from the rows for the same reason; otherwise the server's
 * numbers stand, because a partial page cannot count what it does not hold.
 */
export function reconcileStatusPage(
	page: StatusPage,
	filters: StatusFilters,
	cursor: number | null,
): StatusPage {
	const updates = page.updates.filter((row) =>
		matchesStatusFilters(row, filters),
	);
	const complete = cursor == null && !page.hasMore;
	return {
		...page,
		updates,
		...(complete ? { total: updates.length } : {}),
		...(complete && !page.tagFacets?.length
			? { tagFacets: countTagFacets(updates) }
			: {}),
	};
}

export const STATUS_UPDATED_EVENT = "status.updated";

/**
 * The row inside a `status.updated` broadcast. The hub publishes the update
 * itself as the payload; an envelope that wraps it under `update` is admitted
 * too so a host that projects the frame differently still lands.
 */
export function statusUpdateFromEvent(
	event: DriveHubEvent,
): StatusUpdate | null {
	if (event.event !== STATUS_UPDATED_EVENT) {
		return null;
	}
	return asStatusUpdate(event.payload) ?? asStatusUpdate(event.payload.update);
}

/**
 * Fold a live row into the rows on screen.
 *
 * The board shows one row per subject, so the live row supersedes any row for
 * the same subject — and when it no longer matches the filters, the stale row
 * still has to go. The changelog is append-only, so a non-matching row is
 * simply not shown. A row already present (the hub echoed a publish the page
 * had) is left alone.
 */
export function mergeLiveStatusUpdate(
	rows: readonly StatusUpdate[],
	live: StatusUpdate,
	lens: Exclude<StatusLens, "dependency-map">,
	matches: boolean,
): StatusUpdate[] {
	if (rows.some((row) => row.updateId === live.updateId)) {
		return [...rows];
	}
	if (lens === "board") {
		const withoutSubject = rows.filter((row) => row.subject !== live.subject);
		return matches ? [live, ...withoutSubject] : withoutSubject;
	}
	return matches ? [live, ...rows] : [...rows];
}

/* ---------------------------------------------------------------------------
 * Row presentation model
 * ------------------------------------------------------------------------ */

export function relativeTime(iso: string, nowMs: number = Date.now()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) {
		return "";
	}
	const deltaSec = Math.round((nowMs - then) / 1000);
	if (deltaSec < 60) {
		return "just now";
	}
	if (deltaSec < 3600) {
		return `${Math.floor(deltaSec / 60)}m ago`;
	}
	if (deltaSec < 86400) {
		return `${Math.floor(deltaSec / 3600)}h ago`;
	}
	return `${Math.floor(deltaSec / 86400)}d ago`;
}

export const STALE_RUNNING_MS = 30 * 60 * 1000;

/** A running item that has not moved in a while is the interesting case. */
export function isStaleRunning(
	update: StatusUpdate,
	nowMs: number = Date.now(),
): boolean {
	if (update.state !== "running") {
		return false;
	}
	const age = nowMs - new Date(update.createdAt).getTime();
	return Number.isFinite(age) && age > STALE_RUNNING_MS;
}

/** The last path segment of a workspace root, for the provenance line. */
export function workspaceLabel(root?: string): string | undefined {
	const parts = root?.split(/[\\/]+/).filter(Boolean);
	return parts?.length ? parts[parts.length - 1] : undefined;
}

/** How a publisher is described in the provenance line. */
const SOURCE_LABELS: Record<string, string> = {
	agent: "report_status",
	hub: "hub",
	sdk: "SDK",
	cli: "CLI",
	vscode: "VS Code",
};

export function sourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? source;
}

/** 0..100, or null when the update carries no meaningful ratio. */
export function progressPercent(update: StatusUpdate): number | null {
	if (
		typeof update.progress !== "number" ||
		!Number.isFinite(update.progress)
	) {
		return null;
	}
	return Math.round(Math.min(1, Math.max(0, update.progress)) * 100);
}
