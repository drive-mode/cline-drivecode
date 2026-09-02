import {
	buildStatusSessionRow,
	STATUS_SESSION_FIXTURES,
	type StatusSessionRow,
} from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	barLayout,
	buildSessionDigestExport,
	DEFAULT_SESSION_SORT,
	EMPTY_SESSION_FILTERS,
	filterSessionRows,
	formatDurationMs,
	formatRatePerMinute,
	formatTasksPerHour,
	matchesSessionOutcome,
	SESSION_CHIP_LEGEND,
	SESSION_OUTCOME_FILTERS,
	SESSION_RANGES,
	sessionRange,
	sessionRate,
	shippedDigestFilename,
	sortSessionRows,
	sparklinePath,
	sparklinePoints,
	summarizeSessionRows,
	toggleSessionSort,
} from "./session-rollups";

const rows: StatusSessionRow[] = Object.values(STATUS_SESSION_FIXTURES).map(
	(fixture) => buildStatusSessionRow(fixture),
);
const byId = (id: string) => {
	const row = rows.find((entry) => entry.callSessionId === id);
	if (!row) {
		throw new Error(`missing fixture ${id}`);
	}
	return row;
};

describe("session ranges", () => {
	it("maps every chip to a hub limit, with All unbounded", () => {
		expect(SESSION_RANGES.map((range) => range.id)).toEqual([
			"5",
			"10",
			"20",
			"all",
		]);
		expect(sessionRange("10").limit).toBe(10);
		expect(sessionRange("all").limit).toBeUndefined();
	});
});

describe("session filters", () => {
	it("keeps every outcome filter honest against the fixtures", () => {
		expect(SESSION_OUTCOME_FILTERS.map((filter) => filter.id)).toEqual([
			"all",
			"shipped",
			"clean",
			"continued",
			"sticky",
			"churn",
		]);
		expect(
			rows.filter((row) => matchesSessionOutcome(row, "all")),
		).toHaveLength(rows.length);
		expect(
			rows
				.filter((row) => matchesSessionOutcome(row, "shipped"))
				.map((row) => row.callSessionId),
		).toEqual(["sess-clean", "sess-churn", "sess-continue"]);
		expect(
			rows
				.filter((row) => matchesSessionOutcome(row, "clean"))
				.map((row) => row.callSessionId),
		).toEqual(["sess-clean"]);
		expect(
			rows
				.filter((row) => matchesSessionOutcome(row, "continued"))
				.map((row) => row.callSessionId),
		).toEqual(["sess-continue"]);
		expect(
			rows
				.filter((row) => matchesSessionOutcome(row, "sticky"))
				.map((row) => row.callSessionId),
		).toEqual(["sess-sticky"]);
		expect(
			rows
				.filter((row) => matchesSessionOutcome(row, "churn"))
				.map((row) => row.callSessionId),
		).toEqual(["sess-churn"]);
	});

	it("searches ids, rooms, task ids and chips — never anything else", () => {
		expect(
			filterSessionRows(rows, {
				...EMPTY_SESSION_FILTERS,
				query: "room-2",
			}).map((row) => row.callSessionId),
		).toEqual(["sess-continue", "sess-sticky"]);
		expect(
			filterSessionRows(rows, { ...EMPTY_SESSION_FILTERS, query: " T2 " }).map(
				(row) => row.callSessionId,
			),
		).toEqual(["sess-clean"]);
		expect(
			filterSessionRows(rows, {
				...EMPTY_SESSION_FILTERS,
				query: "sticky",
			}).map((row) => row.callSessionId),
		).toEqual(["sess-sticky"]);
		expect(
			filterSessionRows(rows, { outcome: "shipped", query: "room-1" }).map(
				(row) => row.callSessionId,
			),
		).toEqual(["sess-clean", "sess-churn"]);
	});
});

describe("session sorting", () => {
	it("starts numeric columns descending and text ascending, then flips", () => {
		expect(toggleSessionSort(DEFAULT_SESSION_SORT, "tasks")).toEqual({
			key: "tasks",
			direction: "desc",
		});
		expect(toggleSessionSort(DEFAULT_SESSION_SORT, "session")).toEqual({
			key: "session",
			direction: "asc",
		});
		expect(
			toggleSessionSort({ key: "tasks", direction: "desc" }, "tasks"),
		).toEqual({ key: "tasks", direction: "asc" });
	});

	it("keeps hub order at rest and reverses it when asked", () => {
		expect(sortSessionRows(rows, DEFAULT_SESSION_SORT)).toEqual(rows);
		expect(
			sortSessionRows(rows, { key: "order", direction: "asc" }).map(
				(row) => row.callSessionId,
			),
		).toEqual([...rows].reverse().map((row) => row.callSessionId));
	});

	it("sorts by duration, tasks, sticky and rate, with unknowns last", () => {
		const unknown: StatusSessionRow = {
			...byId("sess-intent"),
			callSessionId: "sess-unknown",
			durationMs: null,
		};
		const withUnknown = [unknown, ...rows];
		const byDuration = sortSessionRows(withUnknown, {
			key: "duration",
			direction: "desc",
		}).map((row) => row.callSessionId);
		expect(byDuration[0]).toBe("sess-continue");
		expect(byDuration[byDuration.length - 1]).toBe("sess-unknown");
		const byDurationAsc = sortSessionRows(withUnknown, {
			key: "duration",
			direction: "asc",
		}).map((row) => row.callSessionId);
		expect(byDurationAsc[0]).toBe("sess-intent");
		expect(byDurationAsc[byDurationAsc.length - 1]).toBe("sess-unknown");

		expect(
			sortSessionRows(rows, { key: "tasks", direction: "desc" })[0]
				.callSessionId,
		).toBe("sess-clean");
		expect(
			sortSessionRows(rows, { key: "sticky", direction: "desc" })[0]
				.callSessionId,
		).toBe("sess-sticky");
		expect(
			sortSessionRows(rows, { key: "rate", direction: "desc" })[0]
				.callSessionId,
		).toBe("sess-clean");
		expect(
			sortSessionRows(rows, { key: "session", direction: "asc" }).map(
				(row) => row.callSessionId,
			),
		).toEqual([
			"sess-churn",
			"sess-clean",
			"sess-continue",
			"sess-intent",
			"sess-sticky",
		]);
	});

	it("is stable for ties", () => {
		const sorted = sortSessionRows(rows, { key: "sticky", direction: "asc" });
		// Four rows tie at zero sticky failures and keep their incoming order.
		expect(sorted.slice(0, 4).map((row) => row.callSessionId)).toEqual([
			"sess-clean",
			"sess-churn",
			"sess-continue",
			"sess-intent",
		]);
	});
});

describe("session summary", () => {
	it("aggregates the KPI header from the fixtures", () => {
		const summary = summarizeSessionRows(rows);
		expect(summary.sessionCount).toBe(5);
		expect(summary.tasksCompletedTotal).toBe(4);
		expect(summary.cleanDrainCount).toBe(1);
		expect(summary.continueCount).toBe(1);
		expect(summary.churnCount).toBe(1);
		expect(summary.sessionsWithSticky).toBe(1);
		expect(summary.stickyFailureTotal).toBe(2);
		expect(summary.knownDurationMs).toBe(495_000);
		expect(summary.knownDurationCount).toBe(5);
		expect(summary.averageDurationMs).toBe(99_000);
		expect(summary.tasksPerHour).toBeCloseTo(29.09, 1);
		// Charts read oldest → newest, so the series is the hub order reversed.
		expect(summary.tasksSeries).toEqual([0, 0, 1, 1, 2]);
		expect(summary.stickySeries).toEqual([0, 2, 0, 0, 0]);
	});

	it("is honest about an empty window", () => {
		const summary = summarizeSessionRows([]);
		expect(summary.sessionCount).toBe(0);
		expect(summary.averageDurationMs).toBeNull();
		expect(summary.tasksPerHour).toBeNull();
		expect(summary.tasksSeries).toEqual([]);
	});

	it("computes per-session rate only when a duration is known", () => {
		expect(sessionRate(byId("sess-clean"))).toBe(1);
		expect(sessionRate({ ...byId("sess-clean"), durationMs: null })).toBeNull();
		expect(sessionRate({ ...byId("sess-clean"), durationMs: 0 })).toBeNull();
	});
});

describe("formatting", () => {
	it("formats durations in the digest style, extended to hours", () => {
		expect(formatDurationMs(null)).toBe("—");
		expect(formatDurationMs(-5)).toBe("—");
		expect(formatDurationMs(45_000)).toBe("45s");
		expect(formatDurationMs(120_000)).toBe("2m");
		expect(formatDurationMs(90_000)).toBe("1m 30s");
		expect(formatDurationMs(3_600_000)).toBe("1h");
		expect(formatDurationMs(3_900_000)).toBe("1h 5m");
	});

	it("formats rates", () => {
		expect(formatRatePerMinute(null)).toBe("—");
		expect(formatRatePerMinute(0)).toBe("0/min");
		expect(formatRatePerMinute(0.6667)).toBe("0.67/min");
		expect(formatRatePerMinute(1.25)).toBe("1.3/min");
		expect(formatRatePerMinute(12)).toBe("12/min");
		expect(formatTasksPerHour(null)).toBe("—");
		expect(formatTasksPerHour(29.09)).toBe("29/h");
		expect(formatTasksPerHour(2.345)).toBe("2.3/h");
	});

	it("has a legend entry for every chip id the kernel emits", () => {
		const ids = new Set(
			rows.flatMap((row) => row.chips.map((chip) => chip.id)),
		);
		for (const id of ids) {
			expect(SESSION_CHIP_LEGEND[id].label.length).toBeGreaterThan(0);
		}
		expect(Object.keys(SESSION_CHIP_LEGEND).sort()).toEqual([
			"E1",
			"E2",
			"P1",
			"P2",
			"S2",
			"S3",
		]);
	});
});

describe("svg geometry", () => {
	it("lays out sparkline points across the width, y growing downward", () => {
		const points = sparklinePoints([0, 2, 1], 100, 20, 0);
		expect(points.map((point) => point.x)).toEqual([0, 50, 100]);
		expect(points[1].y).toBe(0);
		expect(points[0].y).toBe(20);
		expect(points[2].y).toBe(10);
		expect(sparklinePath(points)).toBe("M0 20 L50 0 L100 10");
	});

	it("draws a flat line for one value and nothing for none", () => {
		expect(sparklinePoints([], 100, 20)).toEqual([]);
		expect(sparklinePath([])).toBe("");
		const single = sparklinePoints([3], 100, 20, 0);
		expect(single).toHaveLength(1);
		expect(sparklinePath(single)).toBe("M0 0 L100 0");
	});

	it("keeps a 1px baseline for zero bars", () => {
		const bars = barLayout([0, 4, 2], 30, 10, 0);
		expect(bars).toHaveLength(3);
		expect(bars[0].height).toBe(1);
		expect(bars[1].height).toBe(10);
		expect(bars[2].height).toBe(5);
		expect(bars[1].y).toBe(0);
		expect(bars.map((bar) => bar.x)).toEqual([0, 10, 20]);
		expect(barLayout([], 30, 10)).toEqual([]);
	});
});

describe("shipped digest export", () => {
	it("builds the kernel digest and names the file from its timestamp", () => {
		const now = () => new Date("2026-09-02T10:15:30.000Z");
		const exported = buildSessionDigestExport(rows, now);
		expect(exported.digest.kind).toBe("shipped_digest");
		expect(exported.digest.sessionCount).toBe(5);
		expect(exported.digest.tasksCompletedTotal).toBe(4);
		expect(exported.markdown).toContain("# What Drive shipped");
		expect(exported.markdown).toContain("## Session `sess-clean`");
		expect(exported.markdown).toContain("Local export only");
		expect(exported.filename).toBe(
			"drive-shipped-digest-2026-09-02-10-15-30.md",
		);
		expect(shippedDigestFilename(exported.digest)).toBe(exported.filename);
	});

	it("never carries transcript-shaped keys", () => {
		const exported = buildSessionDigestExport(rows);
		expect(JSON.stringify(exported.digest)).not.toMatch(
			/transcript|utterance|audio/i,
		);
	});
});
