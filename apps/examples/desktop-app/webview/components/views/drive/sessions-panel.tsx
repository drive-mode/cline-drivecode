"use client";

/**
 * Analytics building blocks: the KPI header (hand-drawn SVG, no chart
 * library), the sortable session table, the drill-down card and the chip
 * legend. All numbers arrive pre-computed from `lib/drive/session-rollups.ts`;
 * this file only paints them.
 */

import type {
	DriveRoomDirectoryEntry,
	StatusSessionChip,
	StatusSessionRow,
} from "@cline/drive";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	CircleCheck,
	Copy,
	DoorOpen,
	ListChecks,
	Timer,
	TriangleAlert,
	Users,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	barLayout,
	formatDurationMs,
	formatRatePerMinute,
	formatTasksPerHour,
	SESSION_CHIP_LEGEND,
	type SessionChipTone,
	type SessionRollupSummary,
	type SessionSort,
	type SessionSortKey,
	sessionRate,
	sparklinePath,
	sparklinePoints,
} from "@/lib/drive/session-rollups";
import { copyTextToClipboard } from "@/lib/drive/text-export";
import { cn } from "@/lib/utils";

// ── Chips ────────────────────────────────────────────────────────────

const CHIP_TONE_CLASS: Record<SessionChipTone, string> = {
	good: "border-success-border bg-success-surface text-success-text",
	neutral: "border-border bg-muted text-muted-foreground",
	warn: "border-warning-border bg-warning-surface text-warning-text",
};

export function SessionChipBadge({
	chip,
	className,
}: {
	chip: StatusSessionChip;
	className?: string;
}) {
	const legend = SESSION_CHIP_LEGEND[chip.id];
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 font-mono text-[10px] leading-none whitespace-nowrap",
				CHIP_TONE_CLASS[legend.tone],
				className,
			)}
			data-session-chip={chip.id}
			title={legend.hint}
		>
			<span className="font-semibold">{chip.id}</span>
			<span>{chip.label}</span>
		</span>
	);
}

export function SessionChipLegend() {
	return (
		<dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
			{(
				Object.entries(SESSION_CHIP_LEGEND) as Array<
					[
						StatusSessionChip["id"],
						(typeof SESSION_CHIP_LEGEND)[keyof typeof SESSION_CHIP_LEGEND],
					]
				>
			).map(([id, legend]) => (
				<div className="flex items-center gap-1.5" key={id}>
					<dt>
						<SessionChipBadge chip={{ id, label: legend.label }} />
					</dt>
					<dd>{legend.hint}</dd>
				</div>
			))}
		</dl>
	);
}

// ── KPI header ───────────────────────────────────────────────────────

const CHART_WIDTH = 96;
const CHART_HEIGHT = 28;

function BarChart({
	values,
	label,
	tone = "primary",
}: {
	values: readonly number[];
	label: string;
	tone?: "primary" | "warn";
}) {
	const bars = barLayout(values, CHART_WIDTH, CHART_HEIGHT, 3);
	if (bars.length === 0) {
		return <ChartPlaceholder />;
	}
	return (
		<svg
			aria-label={label}
			className="h-6 w-20 shrink-0 overflow-visible"
			role="img"
			viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
		>
			<title>{label}</title>
			{bars.map((bar) => (
				<rect
					className={cn(
						tone === "warn" ? "fill-warning-solid/80" : "fill-primary/75",
						bar.value === 0 && "fill-border",
					)}
					height={bar.height}
					key={bar.x}
					rx={1}
					width={bar.width}
					x={bar.x}
					y={bar.y}
				/>
			))}
		</svg>
	);
}

function Sparkline({
	values,
	label,
}: {
	values: readonly number[];
	label: string;
}) {
	const points = sparklinePoints(values, CHART_WIDTH, CHART_HEIGHT, 2);
	if (points.length === 0) {
		return <ChartPlaceholder />;
	}
	const line = sparklinePath(points);
	const first = points[0];
	const last = points[points.length - 1];
	const area =
		points.length > 1
			? `${line} L${last.x} ${CHART_HEIGHT} L${first.x} ${CHART_HEIGHT} Z`
			: "";
	return (
		<svg
			aria-label={label}
			className="h-6 w-20 shrink-0 overflow-visible"
			role="img"
			viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
		>
			<title>{label}</title>
			{area ? <path className="fill-primary/12" d={area} /> : null}
			<path
				className="fill-none stroke-primary"
				d={line}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={1.5}
			/>
			<circle className="fill-primary" cx={last.x} cy={last.y} r={2} />
		</svg>
	);
}

function ChartPlaceholder() {
	return (
		<div
			aria-hidden="true"
			className="h-6 w-20 shrink-0 rounded-sm border border-dashed border-border"
		/>
	);
}

function KpiTile({
	label,
	value,
	hint,
	icon,
	chart,
	tone = "default",
}: {
	label: string;
	value: ReactNode;
	hint: ReactNode;
	icon: ReactNode;
	chart?: ReactNode;
	tone?: "default" | "warn";
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3",
				tone === "warn" && "border-warning-border/60",
			)}
		>
			<div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
				<span className="truncate">{label}</span>
				<span aria-hidden="true" className="shrink-0 [&>svg]:size-3.5">
					{icon}
				</span>
			</div>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0 whitespace-nowrap text-2xl font-semibold leading-none tabular-nums text-foreground">
					{value}
				</div>
				{chart}
			</div>
			<div className="line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">
				{hint}
			</div>
		</div>
	);
}

function KpiSkeleton() {
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
			<Skeleton className="h-3 w-20" />
			<div className="flex items-end justify-between gap-3">
				<div className="space-y-2">
					<Skeleton className="h-7 w-14" />
					<Skeleton className="h-3 w-24" />
				</div>
				<Skeleton className="h-7 w-24" />
			</div>
		</div>
	);
}

export function SessionKpiHeader({
	summary,
	loading,
}: {
	summary: SessionRollupSummary;
	loading: boolean;
}) {
	if (loading && summary.sessionCount === 0) {
		return (
			<div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
				<KpiSkeleton />
				<KpiSkeleton />
				<KpiSkeleton />
				<KpiSkeleton />
				<KpiSkeleton />
			</div>
		);
	}
	const sessionsPlural = summary.sessionCount === 1 ? "session" : "sessions";
	return (
		<section
			aria-label="Session totals"
			className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]"
		>
			<KpiTile
				chart={
					<BarChart
						label="Tasks completed per session, oldest to newest"
						values={summary.tasksSeries}
					/>
				}
				hint={`${summary.sessionCount} ${sessionsPlural} in the window`}
				icon={<ListChecks />}
				label="Tasks completed"
				value={summary.tasksCompletedTotal}
			/>
			<KpiTile
				chart={
					<Sparkline
						label="Call duration per session, oldest to newest"
						values={summary.durationSeries}
					/>
				}
				hint={
					summary.averageDurationMs === null
						? "No durations reported"
						: `avg ${formatDurationMs(summary.averageDurationMs)} · ${formatTasksPerHour(summary.tasksPerHour)} tasks`
				}
				icon={<Timer />}
				label="Time in calls"
				value={formatDurationMs(
					summary.knownDurationCount > 0 ? summary.knownDurationMs : null,
				)}
			/>
			<KpiTile
				chart={
					<RatioBar
						count={summary.cleanDrainCount}
						total={summary.sessionCount}
						label="Clean drains as a share of sessions"
					/>
				}
				hint={`of ${summary.sessionCount} ${sessionsPlural} drained the plan`}
				icon={<CircleCheck />}
				label="Clean drains"
				value={summary.cleanDrainCount}
			/>
			<KpiTile
				chart={
					<RatioBar
						count={summary.continueCount}
						total={summary.sessionCount}
						label="Continued plans as a share of sessions"
					/>
				}
				hint={`${summary.churnCount} with mid-plan churn`}
				icon={<ArrowUpDown />}
				label="Continued"
				value={summary.continueCount}
			/>
			<KpiTile
				chart={
					<BarChart
						label="Unrecovered failures per session, oldest to newest"
						tone="warn"
						values={summary.stickySeries}
					/>
				}
				hint={
					summary.sessionsWithSticky === 0
						? "Every failure was recovered"
						: `across ${summary.sessionsWithSticky} ${summary.sessionsWithSticky === 1 ? "session" : "sessions"}`
				}
				icon={<TriangleAlert />}
				label="Sticky failures"
				tone={summary.stickyFailureTotal > 0 ? "warn" : "default"}
				value={summary.stickyFailureTotal}
			/>
		</section>
	);
}

function RatioBar({
	count,
	total,
	label,
}: {
	count: number;
	total: number;
	label: string;
}) {
	const ratio = total > 0 ? Math.min(1, count / total) : 0;
	const width = Math.round(ratio * CHART_WIDTH);
	return (
		<svg
			aria-label={`${label}: ${Math.round(ratio * 100)}%`}
			className="h-6 w-20 shrink-0"
			role="img"
			viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
		>
			<title>{label}</title>
			<rect
				className="fill-border"
				height={6}
				rx={3}
				width={CHART_WIDTH}
				x={0}
				y={CHART_HEIGHT - 8}
			/>
			{width > 0 ? (
				<rect
					className="fill-primary"
					height={6}
					rx={3}
					width={width}
					x={0}
					y={CHART_HEIGHT - 8}
				/>
			) : null}
			<text
				className="fill-muted-foreground font-mono text-[10px]"
				x={0}
				y={CHART_HEIGHT - 14}
			>
				{total > 0 ? `${Math.round(ratio * 100)}%` : "—"}
			</text>
		</svg>
	);
}

// ── Table ────────────────────────────────────────────────────────────

type ColumnDef = {
	key: SessionSortKey;
	label: string;
	align?: "right";
	className?: string;
};

const COLUMNS: readonly ColumnDef[] = [
	{ key: "session", label: "Session", className: "w-[26%]" },
	{ key: "room", label: "Room", className: "w-[14%]" },
	{ key: "duration", label: "Duration", align: "right", className: "w-[9%]" },
	{ key: "tasks", label: "Done", align: "right", className: "w-[7%]" },
	{ key: "rate", label: "Rate", align: "right", className: "w-[9%]" },
	{ key: "sticky", label: "Failed", align: "right", className: "w-[7%]" },
];

function SortHeader({
	column,
	sort,
	onSortChange,
}: {
	column: ColumnDef;
	sort: SessionSort;
	onSortChange: (key: SessionSortKey) => void;
}) {
	const active = sort.key === column.key;
	const ariaSort = active
		? sort.direction === "asc"
			? "ascending"
			: "descending"
		: "none";
	const Icon = active
		? sort.direction === "asc"
			? ArrowUp
			: ArrowDown
		: ArrowUpDown;
	return (
		<TableHead
			aria-sort={ariaSort}
			className={cn(
				"px-3 text-xs",
				column.className,
				column.align === "right" && "text-right",
			)}
		>
			<button
				aria-label={`Sort by ${column.label}`}
				className={cn(
					"inline-flex h-7 items-center gap-1 rounded-sm px-1 -mx-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
					column.align === "right" && "flex-row-reverse",
					active && "text-foreground",
				)}
				onClick={() => onSortChange(column.key)}
				type="button"
			>
				<span>{column.label}</span>
				<Icon
					aria-hidden="true"
					className={cn("size-3", !active && "opacity-40")}
				/>
			</button>
		</TableHead>
	);
}

export function SessionsTable({
	rows,
	sort,
	onSortChange,
	selectedCallSessionId,
	onSelect,
	agentsForRoom,
	loading,
}: {
	rows: readonly StatusSessionRow[];
	sort: SessionSort;
	onSortChange: (key: SessionSortKey) => void;
	selectedCallSessionId: string | null;
	onSelect: (row: StatusSessionRow) => void;
	agentsForRoom: (roomId: string | null) => readonly string[];
	loading: boolean;
}) {
	return (
		<div className="overflow-hidden rounded-lg border border-border bg-card">
			<Table className="table-fixed">
				<TableHeader className="bg-sidebar">
					<TableRow className="hover:bg-transparent">
						{COLUMNS.map((column) => (
							<SortHeader
								column={column}
								key={column.key}
								onSortChange={onSortChange}
								sort={sort}
							/>
						))}
						<TableHead className="w-[18%] px-3 pl-5 text-xs font-medium text-muted-foreground">
							Outcome
						</TableHead>
						<TableHead className="w-[10%] px-3 text-xs font-medium text-muted-foreground">
							Agents
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{loading && rows.length === 0
						? Array.from({ length: 4 }, (_, index) => `skeleton-${index}`).map(
								(key) => (
									<TableRow className="hover:bg-transparent" key={key}>
										<TableCell className="px-3 py-3" colSpan={8}>
											<Skeleton className="h-4 w-full" />
										</TableCell>
									</TableRow>
								),
							)
						: rows.map((row) => {
								const selected = row.callSessionId === selectedCallSessionId;
								const agents = agentsForRoom(row.roomId);
								return (
									<TableRow
										className={cn(
											"relative cursor-pointer",
											selected && "bg-surface-hover",
										)}
										data-state={selected ? "selected" : undefined}
										key={row.callSessionId}
									>
										<TableCell className="px-3 py-2.5">
											<button
												aria-expanded={selected}
												aria-label={`Show details for session ${row.callSessionId}`}
												className="block w-full min-w-0 truncate text-left font-mono text-xs text-foreground outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-[3px] focus-visible:ring-ring/50"
												onClick={() => onSelect(row)}
												type="button"
											>
												{row.callSessionId}
											</button>
										</TableCell>
										<TableCell className="truncate px-3 py-2.5 font-mono text-xs text-muted-foreground">
											{row.roomId ?? "—"}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular-nums">
											{formatDurationMs(row.durationMs)}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular-nums">
											{row.tasksCompleted}
										</TableCell>
										<TableCell className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
											{formatRatePerMinute(sessionRate(row))}
										</TableCell>
										<TableCell
											className={cn(
												"px-3 py-2.5 text-right text-xs tabular-nums",
												row.failureStickyCount > 0
													? "text-warning-text"
													: "text-muted-foreground",
											)}
										>
											{row.failureStickyCount}
										</TableCell>
										<TableCell className="px-3 py-2.5">
											<div className="flex flex-wrap gap-1">
												{row.chips.length === 0 ? (
													<span className="text-[11px] text-muted-foreground">
														no chips
													</span>
												) : (
													row.chips.map((chip) => (
														<SessionChipBadge chip={chip} key={chip.id} />
													))
												)}
											</div>
										</TableCell>
										<TableCell className="truncate px-3 py-2.5 text-xs text-muted-foreground">
											{agents.length > 0 ? (
												<span
													className="inline-flex items-center gap-1"
													title={agents.join(", ")}
												>
													<Users aria-hidden="true" className="size-3" />
													{agents.length}
												</span>
											) : (
												"—"
											)}
										</TableCell>
									</TableRow>
								);
							})}
				</TableBody>
			</Table>
		</div>
	);
}

// ── Drill-down ───────────────────────────────────────────────────────

const ROOM_STATUS_LABEL: Record<DriveRoomDirectoryEntry["status"], string> = {
	live: "Live",
	paused: "Paused",
	ended: "Ended",
};

export function SessionDrilldown({
	row,
	roomEntry,
	onOpenRoom,
	onClose,
}: {
	row: StatusSessionRow;
	roomEntry: DriveRoomDirectoryEntry | null;
	onOpenRoom?: (row: StatusSessionRow) => void;
	onClose: () => void;
}) {
	const agents = roomEntry?.participantNames ?? [];
	return (
		<aside
			aria-label="Session details"
			className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card px-4 py-3"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						Session
					</div>
					<div
						className="truncate font-mono text-sm text-foreground"
						title={row.callSessionId}
					>
						{row.callSessionId}
					</div>
				</div>
				<Button
					aria-label="Close session details"
					className="size-7"
					onClick={onClose}
					size="icon"
					type="button"
					variant="ghost"
				>
					<X aria-hidden="true" className="size-3.5" />
				</Button>
			</div>

			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
				<dt className="text-muted-foreground">Room</dt>
				<dd className="flex min-w-0 items-center gap-2">
					<span className="truncate font-mono">{row.roomId ?? "—"}</span>
					{roomEntry ? (
						<Badge className="text-[10px]" variant="outline">
							{ROOM_STATUS_LABEL[roomEntry.status]}
						</Badge>
					) : null}
				</dd>
				<dt className="text-muted-foreground">Duration</dt>
				<dd className="tabular-nums">{formatDurationMs(row.durationMs)}</dd>
				<dt className="text-muted-foreground">Rate</dt>
				<dd className="tabular-nums">
					{formatRatePerMinute(sessionRate(row))}
				</dd>
				<dt className="text-muted-foreground">Agents</dt>
				<dd className="truncate">
					{agents.length > 0 ? agents.join(", ") : "—"}
				</dd>
			</dl>

			<div>
				<div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
					Outcome
				</div>
				<div className="flex flex-wrap gap-1">
					{row.chips.length === 0 ? (
						<span className="text-xs text-muted-foreground">
							No measurable progress was recorded.
						</span>
					) : (
						row.chips.map((chip) => (
							<SessionChipBadge chip={chip} key={chip.id} />
						))
					)}
				</div>
			</div>

			<div>
				<div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
					<span>Completed tasks</span>
					{row.completedTaskIds.length > 0 ? (
						<Button
							aria-label="Copy completed task ids"
							className="size-6"
							onClick={() =>
								void copyTextToClipboard(row.completedTaskIds.join("\n"))
							}
							size="icon"
							type="button"
							variant="ghost"
						>
							<Copy aria-hidden="true" className="size-3" />
						</Button>
					) : null}
				</div>
				{row.completedTaskIds.length === 0 ? (
					<p className="text-xs text-muted-foreground">None in this session.</p>
				) : (
					<ul className="flex flex-wrap gap-1">
						{row.completedTaskIds.map((taskId) => (
							<li
								className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]"
								key={taskId}
							>
								{taskId}
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-3">
				{onOpenRoom && row.roomId ? (
					<Button
						onClick={() => onOpenRoom(row)}
						size="sm"
						type="button"
						variant="outline"
					>
						<DoorOpen aria-hidden="true" className="size-3.5" />
						Open room
					</Button>
				) : (
					<p className="text-xs text-muted-foreground">
						{row.roomId
							? roomEntry
								? `Room “${row.roomId}” is listed under Rooms — open it from there to correlate with the bank and plan.`
								: `Room “${row.roomId}” is not in this workspace's room directory.`
							: "This session was not tied to a room."}
					</p>
				)}
			</div>
		</aside>
	);
}
