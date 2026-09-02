/**
 * Analytics logic — everything the Analytics surface computes from
 * `StatusSessionRow`s, kept out of the component so it runs under the node
 * test environment.
 *
 * Rows are counts and booleans only (DRV-ANALYTICS / DRV-PRIVACY): there is
 * no timestamp on a rollup, so the "range" chips are a *count* window — the
 * hub's `limit` — not a calendar range. The KPI header, the sortable table,
 * the SVG sparkline/bars and the shipped digest all derive from the same
 * rows; nothing here reads transcripts, prompts or model ids.
 */

import {
	buildShippedDigest,
	formatShippedDigestMarkdown,
	type ShippedDigest,
	type StatusSessionChipId,
	type StatusSessionRow,
} from "@cline/drive";

// ── Range (count window) ─────────────────────────────────────────────

export type SessionRangeId = "5" | "10" | "20" | "all";

export type SessionRange = {
	readonly id: SessionRangeId;
	readonly label: string;
	/** `undefined` asks the hub for everything it has. */
	readonly limit: number | undefined;
};

export const SESSION_RANGES: readonly SessionRange[] = [
	{ id: "5", label: "Last 5", limit: 5 },
	{ id: "10", label: "Last 10", limit: 10 },
	{ id: "20", label: "Last 20", limit: 20 },
	{ id: "all", label: "All", limit: undefined },
];

export const DEFAULT_SESSION_RANGE: SessionRangeId = "20";

export function sessionRange(id: SessionRangeId): SessionRange {
	return SESSION_RANGES.find((range) => range.id === id) ?? SESSION_RANGES[0];
}

// ── Outcome filter ───────────────────────────────────────────────────

export type SessionOutcomeFilter =
	| "all"
	| "shipped"
	| "clean"
	| "continued"
	| "sticky"
	| "churn";

export const SESSION_OUTCOME_FILTERS: ReadonlyArray<{
	readonly id: SessionOutcomeFilter;
	readonly label: string;
	readonly description: string;
}> = [
	{ id: "all", label: "All", description: "Every session in the window." },
	{
		id: "shipped",
		label: "Shipped",
		description: "At least one task completed in the call.",
	},
	{
		id: "clean",
		label: "Clean drain",
		description: "The plan was archived with no mid-plan additions.",
	},
	{
		id: "continued",
		label: "Continued",
		description: "The plan kept going after the first success.",
	},
	{
		id: "sticky",
		label: "Sticky failures",
		description: "A task failed and was not recovered before the end.",
	},
	{
		id: "churn",
		label: "Churn",
		description: "Tasks were added mid-plan after activation.",
	},
];

function hasChip(row: StatusSessionRow, id: StatusSessionChipId): boolean {
	return row.chips.some((chip) => chip.id === id);
}

export function matchesSessionOutcome(
	row: StatusSessionRow,
	outcome: SessionOutcomeFilter,
): boolean {
	switch (outcome) {
		case "all":
			return true;
		case "shipped":
			return row.tasksCompleted > 0;
		case "clean":
			return row.planCleanDrain;
		case "continued":
			return row.postSuccessPlanContinue;
		case "sticky":
			return row.failureStickyCount > 0;
		case "churn":
			return hasChip(row, "P1");
		default: {
			const _exhaustive: never = outcome;
			return _exhaustive;
		}
	}
}

export function matchesSessionQuery(
	row: StatusSessionRow,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return true;
	}
	const haystack = [
		row.callSessionId,
		row.roomId ?? "",
		...row.completedTaskIds,
		...row.chips.map((chip) => `${chip.id} ${chip.label}`),
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

export type SessionFilters = {
	readonly outcome: SessionOutcomeFilter;
	readonly query: string;
};

export const EMPTY_SESSION_FILTERS: SessionFilters = {
	outcome: "all",
	query: "",
};

export function filterSessionRows(
	rows: readonly StatusSessionRow[],
	filters: SessionFilters,
): StatusSessionRow[] {
	return rows.filter(
		(row) =>
			matchesSessionOutcome(row, filters.outcome) &&
			matchesSessionQuery(row, filters.query),
	);
}

// ── Sorting ──────────────────────────────────────────────────────────

export type SessionSortKey =
	| "order"
	| "session"
	| "room"
	| "duration"
	| "tasks"
	| "sticky"
	| "rate";

export type SessionSortDirection = "asc" | "desc";

export type SessionSort = {
	readonly key: SessionSortKey;
	readonly direction: SessionSortDirection;
};

/** Hub order is newest-first; that is the table's resting state. */
export const DEFAULT_SESSION_SORT: SessionSort = {
	key: "order",
	direction: "desc",
};

const TEXT_SORT_KEYS: ReadonlySet<SessionSortKey> = new Set([
	"session",
	"room",
]);

/**
 * Header click semantics: a new column starts descending for numbers and
 * ascending for text; the same column flips; flipping back to the resting
 * direction of `order` returns to the hub's order.
 */
export function toggleSessionSort(
	current: SessionSort,
	key: SessionSortKey,
): SessionSort {
	if (current.key === key) {
		return {
			key,
			direction: current.direction === "asc" ? "desc" : "asc",
		};
	}
	return { key, direction: TEXT_SORT_KEYS.has(key) ? "asc" : "desc" };
}

/** Tasks completed per minute of call, or null when the duration is unknown. */
export function sessionRate(row: StatusSessionRow): number | null {
	if (row.durationMs === null || row.durationMs <= 0) {
		return null;
	}
	return row.tasksCompleted / (row.durationMs / 60_000);
}

function compareNullableNumber(a: number | null, b: number | null): number {
	if (a === null && b === null) {
		return 0;
	}
	// Unknown values sink to the bottom in either direction.
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	return a - b;
}

function compareForKey(
	a: StatusSessionRow,
	b: StatusSessionRow,
	key: SessionSortKey,
): number {
	switch (key) {
		case "order":
			return 0;
		case "session":
			return a.callSessionId.localeCompare(b.callSessionId);
		case "room":
			return (a.roomId ?? "").localeCompare(b.roomId ?? "");
		case "duration":
			return compareNullableNumber(a.durationMs, b.durationMs);
		case "tasks":
			return a.tasksCompleted - b.tasksCompleted;
		case "sticky":
			return a.failureStickyCount - b.failureStickyCount;
		case "rate":
			return compareNullableNumber(sessionRate(a), sessionRate(b));
		default: {
			const _exhaustive: never = key;
			return _exhaustive;
		}
	}
}

/** Stable sort; unknown numbers stay at the bottom whichever way it points. */
export function sortSessionRows(
	rows: readonly StatusSessionRow[],
	sort: SessionSort,
): StatusSessionRow[] {
	if (sort.key === "order") {
		return sort.direction === "desc" ? [...rows] : [...rows].reverse();
	}
	const sign = sort.direction === "asc" ? 1 : -1;
	return rows
		.map((row, index) => ({ row, index }))
		.sort((left, right) => {
			const a = left.row;
			const b = right.row;
			const nullA =
				(sort.key === "duration" && a.durationMs === null) ||
				(sort.key === "rate" && sessionRate(a) === null);
			const nullB =
				(sort.key === "duration" && b.durationMs === null) ||
				(sort.key === "rate" && sessionRate(b) === null);
			if (nullA !== nullB) {
				return nullA ? 1 : -1;
			}
			const compared = compareForKey(a, b, sort.key) * sign;
			return compared !== 0 ? compared : left.index - right.index;
		})
		.map((entry) => entry.row);
}

// ── Aggregation (the KPI header) ─────────────────────────────────────

export type SessionRollupSummary = {
	sessionCount: number;
	tasksCompletedTotal: number;
	cleanDrainCount: number;
	continueCount: number;
	churnCount: number;
	/** Sessions that ended with at least one unrecovered failure. */
	sessionsWithSticky: number;
	stickyFailureTotal: number;
	/** Sum over sessions whose duration the hub knew. */
	knownDurationMs: number;
	knownDurationCount: number;
	averageDurationMs: number | null;
	/** Tasks completed per hour of known call time. */
	tasksPerHour: number | null;
	/** Per-session series in the order given (oldest → newest for charts). */
	tasksSeries: number[];
	durationSeries: number[];
	stickySeries: number[];
};

export function summarizeSessionRows(
	rows: readonly StatusSessionRow[],
): SessionRollupSummary {
	let tasksCompletedTotal = 0;
	let cleanDrainCount = 0;
	let continueCount = 0;
	let churnCount = 0;
	let sessionsWithSticky = 0;
	let stickyFailureTotal = 0;
	let knownDurationMs = 0;
	let knownDurationCount = 0;
	for (const row of rows) {
		tasksCompletedTotal += row.tasksCompleted;
		if (row.planCleanDrain) {
			cleanDrainCount += 1;
		}
		if (row.postSuccessPlanContinue) {
			continueCount += 1;
		}
		if (hasChip(row, "P1")) {
			churnCount += 1;
		}
		if (row.failureStickyCount > 0) {
			sessionsWithSticky += 1;
			stickyFailureTotal += row.failureStickyCount;
		}
		if (row.durationMs !== null && Number.isFinite(row.durationMs)) {
			knownDurationMs += row.durationMs;
			knownDurationCount += 1;
		}
	}
	// Hub order is newest first; charts read left → right as time.
	const chronological = [...rows].reverse();
	return {
		sessionCount: rows.length,
		tasksCompletedTotal,
		cleanDrainCount,
		continueCount,
		churnCount,
		sessionsWithSticky,
		stickyFailureTotal,
		knownDurationMs,
		knownDurationCount,
		averageDurationMs:
			knownDurationCount > 0 ? knownDurationMs / knownDurationCount : null,
		tasksPerHour:
			knownDurationMs > 0
				? tasksCompletedTotal / (knownDurationMs / 3_600_000)
				: null,
		tasksSeries: chronological.map((row) => row.tasksCompleted),
		durationSeries: chronological.map((row) => row.durationMs ?? 0),
		stickySeries: chronological.map((row) => row.failureStickyCount),
	};
}

// ── Formatting ───────────────────────────────────────────────────────

/** `45s`, `2m`, `1m 30s`, `1h 5m` — the kernel's digest style, extended to hours. */
export function formatDurationMs(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
		return "—";
	}
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rem = seconds % 60;
		return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
	}
	const hours = Math.floor(minutes / 60);
	const remMinutes = minutes % 60;
	return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`;
}

export function formatRatePerMinute(rate: number | null): string {
	if (rate === null || !Number.isFinite(rate)) {
		return "—";
	}
	if (rate === 0) {
		return "0/min";
	}
	return `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(rate >= 1 ? 1 : 2)}/min`;
}

export function formatTasksPerHour(rate: number | null): string {
	if (rate === null || !Number.isFinite(rate)) {
		return "—";
	}
	return `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)}/h`;
}

// ── Chip legend ──────────────────────────────────────────────────────

export type SessionChipTone = "good" | "neutral" | "warn";

export const SESSION_CHIP_LEGEND: Record<
	StatusSessionChipId,
	{
		readonly label: string;
		readonly tone: SessionChipTone;
		readonly hint: string;
	}
> = {
	S2: { label: "done", tone: "good", hint: "Tasks completed in the call." },
	S3: {
		label: "clean drain",
		tone: "good",
		hint: "Plan archived with nothing added mid-plan.",
	},
	E1: {
		label: "continued",
		tone: "neutral",
		hint: "Plan edited or activated after the first success.",
	},
	E2: {
		label: "intent refresh",
		tone: "neutral",
		hint: "A new plan was activated after progress.",
	},
	P1: {
		label: "churn",
		tone: "warn",
		hint: "Tasks were added after the plan was activated.",
	},
	P2: {
		label: "sticky fail",
		tone: "warn",
		hint: "A failure was not recovered before the session ended.",
	},
};

// ── SVG geometry (hand-drawn charts, no chart library) ───────────────

export type SparklinePoint = { x: number; y: number; value: number };

/**
 * Polyline points for a sparkline. A single value draws a flat line across
 * the width; an empty series draws nothing. Y grows downward as in SVG.
 */
export function sparklinePoints(
	values: readonly number[],
	width: number,
	height: number,
	padding = 2,
): SparklinePoint[] {
	if (values.length === 0 || width <= 0 || height <= 0) {
		return [];
	}
	const innerWidth = Math.max(0, width - padding * 2);
	const innerHeight = Math.max(0, height - padding * 2);
	const max = Math.max(...values, 0);
	const min = Math.min(...values, 0);
	const span = max - min || 1;
	const step = values.length > 1 ? innerWidth / (values.length - 1) : 0;
	return values.map((value, index) => {
		const x =
			values.length > 1 ? padding + step * index : padding + innerWidth / 2;
		const y = padding + innerHeight - ((value - min) / span) * innerHeight;
		return { x: round(x), y: round(y), value };
	});
}

export function sparklinePath(points: readonly SparklinePoint[]): string {
	if (points.length === 0) {
		return "";
	}
	if (points.length === 1) {
		const [point] = points;
		return `M0 ${point.y} L${point.x * 2} ${point.y}`;
	}
	return points
		.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
		.join(" ");
}

export type BarRect = {
	x: number;
	y: number;
	width: number;
	height: number;
	value: number;
};

/**
 * Column layout for a small bar chart. Zero values keep a 1px baseline so
 * an empty session is still visible as a slot rather than a gap.
 */
export function barLayout(
	values: readonly number[],
	width: number,
	height: number,
	gap = 2,
): BarRect[] {
	if (values.length === 0 || width <= 0 || height <= 0) {
		return [];
	}
	const max = Math.max(...values, 0) || 1;
	const slot = width / values.length;
	const barWidth = Math.max(1, slot - gap);
	return values.map((value, index) => {
		const barHeight = Math.max(1, round((value / max) * height));
		return {
			x: round(index * slot + gap / 2),
			y: round(height - barHeight),
			width: round(barWidth),
			height: barHeight,
			value,
		};
	});
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

// ── Shipped digest export ────────────────────────────────────────────

export type SessionDigestExport = {
	digest: ShippedDigest;
	markdown: string;
	filename: string;
};

/**
 * Build the opt-in shipped digest for the rows on screen. The kernel owns
 * the format and the privacy assertion; this only names the file.
 */
export function buildSessionDigestExport(
	rows: readonly StatusSessionRow[],
	now?: () => Date,
): SessionDigestExport {
	const digest = buildShippedDigest({
		rollups: rows,
		...(now ? { now } : {}),
	});
	const markdown = formatShippedDigestMarkdown(digest);
	return { digest, markdown, filename: shippedDigestFilename(digest) };
}

export function shippedDigestFilename(digest: ShippedDigest): string {
	const stamp = digest.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
	return `drive-shipped-digest-${stamp}.md`;
}
