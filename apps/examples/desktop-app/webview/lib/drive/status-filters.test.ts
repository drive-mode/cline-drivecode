import type { StatusUpdate } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	asStatusUpdate,
	countTagFacets,
	EMPTY_STATUS_FILTERS,
	groupBoardSections,
	hasActiveFilters,
	isStaleRunning,
	matchesStatusFilters,
	mergeLiveStatusUpdate,
	parseStatusPage,
	progressPercent,
	reconcileStatusPage,
	relativeTime,
	type StatusFilters,
	sectionHeadingCount,
	statusLensDefinition,
	statusPageRequest,
	statusTagFacets,
	statusUpdateFromEvent,
	toggleStateFilter,
	toggleTagFilter,
	workspaceLabel,
} from "./status-filters";

function update(overrides: Partial<StatusUpdate> = {}): StatusUpdate {
	return {
		schemaVersion: 1,
		updateId: "u1",
		seq: 1,
		subject: "migration/auth",
		state: "running",
		headline: "Rewriting the token exchange",
		priority: "normal",
		source: "agent",
		tags: [],
		supersededAt: null,
		createdAt: new Date(0).toISOString(),
		...overrides,
	} as StatusUpdate;
}

function filters(overrides: Partial<StatusFilters> = {}): StatusFilters {
	return { ...EMPTY_STATUS_FILTERS, ...overrides };
}

describe("hasActiveFilters", () => {
	it("is false for the empty filter set", () => {
		expect(hasActiveFilters(EMPTY_STATUS_FILTERS)).toBe(false);
	});

	it("is true for any single filter", () => {
		expect(hasActiveFilters(filters({ stateFilter: ["blocked"] }))).toBe(true);
		expect(hasActiveFilters(filters({ agentFilter: "adam" }))).toBe(true);
		expect(hasActiveFilters(filters({ tagFilter: ["auth"] }))).toBe(true);
		expect(hasActiveFilters(filters({ search: "token" }))).toBe(true);
	});
});

describe("matchesStatusFilters", () => {
	it("admits everything when nothing is filtered", () => {
		expect(matchesStatusFilters(update(), EMPTY_STATUS_FILTERS)).toBe(true);
	});

	it("rejects a row outside the selected states", () => {
		const blockedOnly = filters({ stateFilter: ["blocked"] });
		expect(
			matchesStatusFilters(update({ state: "running" }), blockedOnly),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "blocked" }), blockedOnly),
		).toBe(true);
	});

	it("rejects another agent's row, including an unattributed one", () => {
		const f = filters({ agentFilter: "adam" });
		expect(matchesStatusFilters(update({ agentId: "adam" }), f)).toBe(true);
		expect(matchesStatusFilters(update({ agentId: "beth" }), f)).toBe(false);
		expect(matchesStatusFilters(update(), f)).toBe(false);
	});

	it("searches the headline and the detail, case-insensitively", () => {
		expect(
			matchesStatusFilters(update(), filters({ search: "TOKEN exchange" })),
		).toBe(true);
		expect(
			matchesStatusFilters(
				update({ detail: "Blocked on the KMS rotation" }),
				filters({ search: "kms" }),
			),
		).toBe(true);
		expect(matchesStatusFilters(update(), filters({ search: "kms" }))).toBe(
			false,
		);
	});

	it("requires all filtered tags, matched exactly", () => {
		const f = filters({ tagFilter: ["auth", "p0"] });
		expect(matchesStatusFilters(update({ tags: ["auth", "p0"] }), f)).toBe(
			true,
		);
		expect(matchesStatusFilters(update({ tags: ["auth"] }), f)).toBe(false);
		expect(
			matchesStatusFilters(
				update({ tags: ["authz"] }),
				filters({ tagFilter: ["auth"] }),
			),
		).toBe(false);
	});

	it("requires every active filter to pass, not just one", () => {
		const f = filters({ stateFilter: ["blocked"], agentFilter: "adam" });
		expect(
			matchesStatusFilters(update({ state: "blocked", agentId: "beth" }), f),
		).toBe(false);
		expect(
			matchesStatusFilters(update({ state: "blocked", agentId: "adam" }), f),
		).toBe(true);
	});
});

describe("statusTagFacets", () => {
	it("renders the server's count for each tag and drops empty ones", () => {
		expect(
			statusTagFacets(
				[
					{ tag: "auth", count: 51 },
					{ tag: "docs", count: 0 },
					{ tag: "p0", count: 1 },
				],
				[],
			),
		).toEqual([
			{ tag: "auth", count: 51, selected: false },
			{ tag: "p0", count: 1, selected: false },
		]);
	});

	it("keeps a selected tag first, even at zero", () => {
		expect(statusTagFacets([{ tag: "docs", count: 2 }], ["auth"])).toEqual([
			{ tag: "auth", count: 0, selected: true },
			{ tag: "docs", count: 2, selected: false },
		]);
	});
});

describe("toggle helpers", () => {
	it("adds and removes tags and states", () => {
		expect(toggleTagFilter([], "auth")).toEqual(["auth"]);
		expect(toggleTagFilter(["auth", "p0"], "auth")).toEqual(["p0"]);
		expect(toggleStateFilter([], "blocked")).toEqual(["blocked"]);
		expect(toggleStateFilter(["blocked", "failed"], "blocked")).toEqual([
			"failed",
		]);
	});
});

describe("sectionHeadingCount", () => {
	it("prefers the whole-table count when unfiltered and the rows when filtered", () => {
		expect(sectionHeadingCount(3, 40, false)).toBe(40);
		expect(sectionHeadingCount(3, undefined, false)).toBe(3);
		expect(sectionHeadingCount(3, 40, true)).toBe(3);
	});
});

describe("groupBoardSections", () => {
	it("orders by attention and drops empty sections", () => {
		const sections = groupBoardSections([
			update({ updateId: "a", state: "done" }),
			update({ updateId: "b", state: "blocked" }),
			update({ updateId: "c", state: "running" }),
			update({ updateId: "d", state: "blocked" }),
		]);
		expect(sections.map((section) => section.state)).toEqual([
			"blocked",
			"running",
			"done",
		]);
		expect(sections[0]?.rows.map((row) => row.updateId)).toEqual(["b", "d"]);
	});
});

describe("statusPageRequest", () => {
	it("asks the board for facets on page one and only the cursor after", () => {
		const first = statusPageRequest("board", EMPTY_STATUS_FILTERS, null);
		expect(first.op).toBe("board");
		expect(first.payload).toEqual({ limit: 50, includeFacets: true });
		const next = statusPageRequest("changelog", EMPTY_STATUS_FILTERS, 41, 20);
		expect(next.op).toBe("query");
		expect(next.payload).toEqual({ limit: 20, cursor: 41 });
	});

	it("only sends the filters that are set, with the search trimmed", () => {
		const request = statusPageRequest(
			"board",
			filters({
				stateFilter: ["blocked"],
				agentFilter: "adam",
				tagFilter: ["auth"],
				search: "  token ",
			}),
			null,
		);
		expect(request.payload).toEqual({
			limit: 50,
			includeFacets: true,
			state: ["blocked"],
			agentId: "adam",
			tags: ["auth"],
			text: "token",
		});
	});
});

describe("parseStatusPage", () => {
	it("keeps good rows and facets, drops junk, and never fabricates a total", () => {
		const page = parseStatusPage({
			updates: [update(), { updateId: 7 }, update({ updateId: "u2" })],
			nextCursor: 12,
			hasMore: true,
			tagFacets: [{ tag: "auth", count: 2 }, { tag: "", count: 1 }, null],
		});
		expect(page.updates.map((row) => row.updateId)).toEqual(["u1", "u2"]);
		expect(page.nextCursor).toBe(12);
		expect(page.hasMore).toBe(true);
		expect(page.total).toBeUndefined();
		expect(page.tagFacets).toEqual([{ tag: "auth", count: 2 }]);
	});

	it("returns an empty exhausted page for a malformed reply", () => {
		expect(parseStatusPage(null)).toEqual({
			updates: [],
			nextCursor: null,
			hasMore: false,
		});
		expect(parseStatusPage({ updates: "nope", total: 3 })).toMatchObject({
			updates: [],
			total: 3,
		});
	});

	it("coerces missing tags to an empty list", () => {
		const row = asStatusUpdate({ ...update(), tags: undefined });
		expect(row?.tags).toEqual([]);
		expect(asStatusUpdate({ ...update(), createdAt: 12 })).toBeNull();
	});
});

describe("reconcileStatusPage", () => {
	const rows = [
		update({ updateId: "a", state: "running", tags: ["auth", "p0"] }),
		update({ updateId: "b", state: "blocked", tags: ["auth"] }),
		update({ updateId: "c", state: "running", tags: [] }),
	];

	it("holds rows to the filters and counts a complete page honestly", () => {
		const page = reconcileStatusPage(
			{ updates: rows, nextCursor: null, hasMore: false, total: 3 },
			filters({ stateFilter: ["running"] }),
			null,
		);
		expect(page.updates.map((row) => row.updateId)).toEqual(["a", "c"]);
		expect(page.total).toBe(2);
		expect(page.tagFacets).toEqual([
			{ tag: "auth", count: 1 },
			{ tag: "p0", count: 1 },
		]);
	});

	it("keeps the server's counts when the page is partial or facets exist", () => {
		const partial = reconcileStatusPage(
			{ updates: rows, nextCursor: 7, hasMore: true, total: 90 },
			EMPTY_STATUS_FILTERS,
			null,
		);
		expect(partial.total).toBe(90);
		expect(partial.tagFacets).toBeUndefined();
		const served = reconcileStatusPage(
			{
				updates: rows,
				nextCursor: null,
				hasMore: false,
				tagFacets: [{ tag: "auth", count: 51 }],
			},
			EMPTY_STATUS_FILTERS,
			null,
		);
		expect(served.tagFacets).toEqual([{ tag: "auth", count: 51 }]);
		expect(
			reconcileStatusPage(
				{ updates: rows, nextCursor: null, hasMore: false },
				EMPTY_STATUS_FILTERS,
				12,
			).total,
		).toBeUndefined();
	});

	it("counts each tag once per row", () => {
		expect(
			countTagFacets([
				update({ tags: ["x", "x", "y"] }),
				update({ tags: ["y"] }),
			]),
		).toEqual([
			{ tag: "y", count: 2 },
			{ tag: "x", count: 1 },
		]);
	});
});

describe("statusUpdateFromEvent", () => {
	it("reads the update from the payload or its `update` envelope", () => {
		const live = update({ updateId: "live" });
		expect(
			statusUpdateFromEvent({
				event: "status.updated",
				payload: live as unknown as Record<string, unknown>,
			})?.updateId,
		).toBe("live");
		expect(
			statusUpdateFromEvent({
				event: "status.updated",
				payload: { update: live },
			})?.updateId,
		).toBe("live");
	});

	it("ignores other events and malformed payloads", () => {
		expect(
			statusUpdateFromEvent({ event: "room.event", payload: update() }),
		).toBeNull();
		expect(
			statusUpdateFromEvent({ event: "status.updated", payload: {} }),
		).toBeNull();
	});
});

describe("mergeLiveStatusUpdate", () => {
	const rows = [
		update({ updateId: "a", subject: "s/1", state: "running" }),
		update({ updateId: "b", subject: "s/2", state: "queued" }),
	];

	it("supersedes the subject on the board, even when the row no longer matches", () => {
		const live = update({ updateId: "c", subject: "s/1", state: "done" });
		expect(
			mergeLiveStatusUpdate(rows, live, "board", true).map((r) => r.updateId),
		).toEqual(["c", "b"]);
		expect(
			mergeLiveStatusUpdate(rows, live, "board", false).map((r) => r.updateId),
		).toEqual(["b"]);
	});

	it("prepends to the changelog only when the row matches", () => {
		const live = update({ updateId: "c", subject: "s/1" });
		expect(
			mergeLiveStatusUpdate(rows, live, "changelog", true).map(
				(r) => r.updateId,
			),
		).toEqual(["c", "a", "b"]);
		expect(
			mergeLiveStatusUpdate(rows, live, "changelog", false).map(
				(r) => r.updateId,
			),
		).toEqual(["a", "b"]);
	});

	it("leaves a row it already holds alone", () => {
		const held = update({ updateId: "a", subject: "s/1", state: "done" });
		expect(
			mergeLiveStatusUpdate(rows, held, "board", true).map((r) => r.updateId),
		).toEqual(["a", "b"]);
	});
});

describe("row presentation", () => {
	it("formats relative time in coarse buckets", () => {
		const now = Date.parse("2026-09-02T12:00:00.000Z");
		expect(relativeTime("2026-09-02T11:59:50.000Z", now)).toBe("just now");
		expect(relativeTime("2026-09-02T11:45:00.000Z", now)).toBe("15m ago");
		expect(relativeTime("2026-09-02T09:00:00.000Z", now)).toBe("3h ago");
		expect(relativeTime("2026-08-30T12:00:00.000Z", now)).toBe("3d ago");
		expect(relativeTime("not a date", now)).toBe("");
	});

	it("flags a running row that has not moved in over thirty minutes", () => {
		const now = Date.parse("2026-09-02T12:00:00.000Z");
		expect(
			isStaleRunning(update({ createdAt: "2026-09-02T11:00:00.000Z" }), now),
		).toBe(true);
		expect(
			isStaleRunning(update({ createdAt: "2026-09-02T11:50:00.000Z" }), now),
		).toBe(false);
		expect(
			isStaleRunning(
				update({ state: "blocked", createdAt: "2026-09-02T09:00:00.000Z" }),
				now,
			),
		).toBe(false);
	});

	it("derives a workspace label and a clamped progress percentage", () => {
		expect(workspaceLabel("/home/me/projects/router-fix")).toBe("router-fix");
		expect(workspaceLabel("C:\\work\\drive\\")).toBe("drive");
		expect(workspaceLabel(undefined)).toBeUndefined();
		expect(progressPercent(update({ progress: 0.456 }))).toBe(46);
		expect(progressPercent(update({ progress: 4 }))).toBe(100);
		expect(progressPercent(update())).toBeNull();
	});

	it("names every lens", () => {
		expect(statusLensDefinition("dependency-map").label).toBe("Dependency map");
		expect(statusLensDefinition("board").description).toContain("right now");
	});
});
