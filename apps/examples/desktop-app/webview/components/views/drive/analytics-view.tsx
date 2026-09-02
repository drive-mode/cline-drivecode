"use client";

/**
 * Analytics — retrospective Drive session observability (DRV-ANALYTICS).
 *
 * Local session rollups with accomplishment chips, a KPI header drawn in
 * SVG, and the opt-in shipped digest. Distinct from Status Hub (live agent
 * ops): this page asks "did the calls get work done?", after the fact.
 *
 * Rows are counts and booleans only. The export is local Markdown — copied
 * to the clipboard and offered as a file — never telemetry.
 */

import type { DriveRoomDirectoryEntry, StatusSessionRow } from "@cline/drive";
import {
	ChartColumn,
	Check,
	Copy,
	Download,
	FileText,
	Inbox,
	RefreshCw,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { MemoizedMarkdown } from "@/components/ui/markdown";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import { toast } from "@/hooks/use-toast";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { driveSectionDefinition } from "@/lib/drive/drive-section";
import {
	buildSessionDigestExport,
	DEFAULT_SESSION_RANGE,
	DEFAULT_SESSION_SORT,
	EMPTY_SESSION_FILTERS,
	filterSessionRows,
	SESSION_OUTCOME_FILTERS,
	SESSION_RANGES,
	type SessionDigestExport,
	type SessionFilters,
	type SessionRangeId,
	type SessionSort,
	sessionRange,
	sortSessionRows,
	summarizeSessionRows,
	toggleSessionSort,
} from "@/lib/drive/session-rollups";
import { copyTextToClipboard, downloadTextFile } from "@/lib/drive/text-export";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import {
	SessionChipLegend,
	SessionDrilldown,
	SessionKpiHeader,
	SessionsTable,
} from "./sessions-panel";

export type AnalyticsViewProps = {
	/**
	 * Open the room a session ran in (join + navigate to the call). Optional:
	 * without it the drill-down points at the Rooms section instead.
	 */
	onOpenRoom?: (row: StatusSessionRow) => void;
};

/** Room events that close a call session and therefore mint a new rollup. */
const SESSION_CLOSING_EVENTS = new Set(["control.end", "control.leave"]);
const LIVE_REFRESH_DEBOUNCE_MS = 1_200;

type LoadState = "idle" | "loading" | "ready" | "error";

export function AnalyticsView({ onOpenRoom }: AnalyticsViewProps = {}) {
	const { phase, hub, source, rooms } = useDriveHub();
	const definition = driveSectionDefinition("analytics");
	const [rows, setRows] = useState<StatusSessionRow[]>([]);
	const [loadState, setLoadState] = useState<LoadState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [rangeId, setRangeId] = useState<SessionRangeId>(DEFAULT_SESSION_RANGE);
	const [filters, setFilters] = useState<SessionFilters>(EMPTY_SESSION_FILTERS);
	const [sort, setSort] = useState<SessionSort>(DEFAULT_SESSION_SORT);
	const [selectedCallSessionId, setSelectedCallSessionId] = useState<
		string | null
	>(null);
	const [digest, setDigest] = useState<SessionDigestExport | null>(null);
	const [digestCopied, setDigestCopied] = useState<boolean | null>(null);
	const [digestSaved, setDigestSaved] = useState<boolean | null>(null);
	const requestSeqRef = useRef(0);
	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const sourceReady = phase === "live" || phase === "demo";
	const workspaceRoot = hub.workspaceRoot;

	const load = useCallback(
		async (options: { quiet?: boolean } = {}) => {
			if (!sourceReady) {
				return;
			}
			const seq = ++requestSeqRef.current;
			if (!options.quiet) {
				setLoadState("loading");
			}
			try {
				const reply = await source.sessionRollups({
					...(workspaceRoot ? { workspaceRoot } : {}),
					...(sessionRange(rangeId).limit !== undefined
						? { limit: sessionRange(rangeId).limit }
						: {}),
				});
				if (seq !== requestSeqRef.current) {
					return;
				}
				setRows(Array.isArray(reply?.sessions) ? reply.sessions : []);
				setError(null);
				setLoadState("ready");
			} catch (cause) {
				if (seq !== requestSeqRef.current) {
					return;
				}
				setError(parseDriveCommandError(cause).text);
				setLoadState("error");
			}
		},
		[rangeId, source, sourceReady, workspaceRoot],
	);

	useEffect(() => {
		void load();
	}, [load]);

	// A closed call mints a rollup: refresh after the log settles.
	useEffect(() => {
		if (!sourceReady) {
			return;
		}
		const unsubscribe = source.subscribe((event) => {
			if (event.event !== "room.event") {
				return;
			}
			const inner = event.payload.event;
			const type =
				inner && typeof inner === "object"
					? (inner as { type?: unknown }).type
					: undefined;
			if (typeof type !== "string" || !SESSION_CLOSING_EVENTS.has(type)) {
				return;
			}
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
			}
			refreshTimerRef.current = setTimeout(() => {
				refreshTimerRef.current = null;
				void load({ quiet: true });
			}, LIVE_REFRESH_DEBOUNCE_MS);
		});
		return () => {
			unsubscribe();
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
				refreshTimerRef.current = null;
			}
		};
	}, [load, source, sourceReady]);

	const visibleRows = useMemo(
		() => sortSessionRows(filterSessionRows(rows, filters), sort),
		[filters, rows, sort],
	);
	const summary = useMemo(
		() => summarizeSessionRows(visibleRows),
		[visibleRows],
	);
	const roomsById = useMemo(() => {
		const map = new Map<string, DriveRoomDirectoryEntry>();
		for (const entry of rooms) {
			map.set(entry.roomId, entry);
		}
		return map;
	}, [rooms]);
	const agentsForRoom = useCallback(
		(roomId: string | null) =>
			roomId ? (roomsById.get(roomId)?.participantNames ?? []) : [],
		[roomsById],
	);
	const selectedRow = useMemo(
		() =>
			visibleRows.find((row) => row.callSessionId === selectedCallSessionId) ??
			null,
		[selectedCallSessionId, visibleRows],
	);

	const filtersActive =
		filters.outcome !== "all" || filters.query.trim().length > 0;
	const loading =
		loadState === "loading" || (loadState === "idle" && sourceReady);

	const exportDigest = useCallback(async () => {
		const exported = buildSessionDigestExport(visibleRows);
		setDigest(exported);
		setDigestSaved(null);
		const copied = await copyTextToClipboard(exported.markdown);
		setDigestCopied(copied);
		toast({
			title: copied ? "Shipped digest copied" : "Shipped digest ready",
			description: copied
				? `${exported.digest.sessionCount} sessions as Markdown are on your clipboard. Save the file from the preview.`
				: "The clipboard was unavailable — save the Markdown file from the preview instead.",
		});
	}, [visibleRows]);

	const copyDigestAgain = useCallback(async () => {
		if (!digest) {
			return;
		}
		setDigestCopied(await copyTextToClipboard(digest.markdown));
	}, [digest]);

	const saveDigest = useCallback(() => {
		if (!digest) {
			return;
		}
		const saved = downloadTextFile({
			filename: digest.filename,
			contents: digest.markdown,
		});
		setDigestSaved(saved);
		if (!saved) {
			toast({
				variant: "destructive",
				title: "Could not offer the file",
				description:
					"This webview blocked the download. The Markdown is still on your clipboard.",
			});
		}
	}, [digest]);

	return (
		<PageFrame>
			<PageHeader
				actions={
					<>
						<Button
							disabled={!sourceReady || loading}
							onClick={() => void load()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								aria-hidden="true"
								className={cn("size-3.5", loading && "animate-spin")}
							/>
							Refresh
						</Button>
						<Button
							disabled={visibleRows.length === 0}
							onClick={() => void exportDigest()}
							size="sm"
							type="button"
						>
							<FileText aria-hidden="true" className="size-3.5" />
							Export shipped digest
						</Button>
					</>
				}
				description="Did Drive sessions get work done? Local rollups and the shipped digest — retrospective, not the live agent board."
				icon={definition.icon}
				meta={
					rows.length > 0 ? (
						<Badge className="text-[10px]" variant="outline">
							{rows.length} {rows.length === 1 ? "session" : "sessions"}
						</Badge>
					) : null
				}
				title={definition.label}
			/>

			{loadState === "error" && error ? (
				<PageEmptyState className="mb-5 flex items-center justify-between gap-3 border-destructive/40 text-destructive">
					<span className="truncate">
						Could not load session rollups: {error}
					</span>
					<Button
						onClick={() => void load()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</PageEmptyState>
			) : null}

			<div className="mb-6">
				<SessionKpiHeader loading={loading} summary={summary} />
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-3">
				<ToggleGroup
					aria-label="Session window"
					onValueChange={(value) => {
						if (value) {
							setRangeId(value as SessionRangeId);
						}
					}}
					size="sm"
					type="single"
					value={rangeId}
					variant="outline"
				>
					{SESSION_RANGES.map((range) => (
						<ToggleGroupItem
							aria-label={`${range.label} sessions`}
							className="px-3 text-xs"
							key={range.id}
							value={range.id}
						>
							{range.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>

				<fieldset className="flex min-w-0 flex-wrap gap-1.5">
					<legend className="sr-only">Filter by outcome</legend>
					{SESSION_OUTCOME_FILTERS.map((outcome) => {
						const active = filters.outcome === outcome.id;
						return (
							<Button
								aria-pressed={active}
								className="h-8 text-xs"
								key={outcome.id}
								onClick={() =>
									setFilters((current) => ({ ...current, outcome: outcome.id }))
								}
								size="sm"
								title={outcome.description}
								type="button"
								variant={active ? "secondary" : "ghost"}
							>
								{outcome.label}
							</Button>
						);
					})}
				</fieldset>

				<div className="relative ml-auto min-w-48 max-w-72 flex-1">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Search sessions"
						className="h-8 pl-8"
						onChange={(event) =>
							setFilters((current) => ({
								...current,
								query: event.target.value,
							}))
						}
						placeholder="Session, room or task id"
						value={filters.query}
					/>
				</div>
			</div>

			{!loading && rows.length === 0 && loadState !== "error" ? (
				<Empty className="border border-dashed border-border bg-card">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Inbox aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No Drive sessions yet</EmptyTitle>
						<EmptyDescription>
							Rollups are derived from the local room and bank logs when a call
							ends. Finish a call with a completed task and it shows up here
							with its accomplishment chips.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}

			{rows.length > 0 && visibleRows.length === 0 ? (
				<PageEmptyState className="flex items-center justify-between gap-3">
					<span>No sessions match these filters.</span>
					<Button
						onClick={() => setFilters(EMPTY_SESSION_FILTERS)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Clear filters
					</Button>
				</PageEmptyState>
			) : null}

			{loading || visibleRows.length > 0 ? (
				<div
					className={cn(
						"grid gap-4",
						selectedRow
							? "grid-cols-[minmax(0,1fr)_20rem] max-[1100px]:grid-cols-1"
							: "grid-cols-1",
					)}
				>
					<div className="min-w-0">
						<div className="mb-2 flex min-h-7 items-center gap-2 text-xs text-muted-foreground">
							<span className="font-medium text-foreground">
								{visibleRows.length}
							</span>
							<span>{visibleRows.length === 1 ? "session" : "sessions"}</span>
							{filtersActive ? (
								<Button
									className="h-6 px-2 text-xs"
									onClick={() => setFilters(EMPTY_SESSION_FILTERS)}
									size="xs"
									type="button"
									variant="ghost"
								>
									Clear filters
								</Button>
							) : null}
						</div>
						<SessionsTable
							agentsForRoom={agentsForRoom}
							loading={loading}
							onSelect={(row) =>
								setSelectedCallSessionId((current) =>
									current === row.callSessionId ? null : row.callSessionId,
								)
							}
							onSortChange={(key) =>
								setSort((current) => toggleSessionSort(current, key))
							}
							rows={visibleRows}
							selectedCallSessionId={selectedCallSessionId}
							sort={sort}
						/>
					</div>
					{selectedRow ? (
						<SessionDrilldown
							onClose={() => setSelectedCallSessionId(null)}
							onOpenRoom={onOpenRoom}
							roomEntry={
								selectedRow.roomId
									? (roomsById.get(selectedRow.roomId) ?? null)
									: null
							}
							row={selectedRow}
						/>
					) : null}
				</div>
			) : null}

			<div className="mt-8 space-y-3 border-t border-border pt-5">
				<SessionChipLegend />
				<p className="text-xs text-muted-foreground">
					Counts and booleans only — no transcript, prompt, key or model id
					reaches this page. The shipped digest is a local Markdown export, not
					telemetry.
				</p>
			</div>

			<Sheet
				onOpenChange={(open) => {
					if (!open) {
						setDigest(null);
					}
				}}
				open={digest !== null}
			>
				<SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
					<SheetHeader className="border-b border-border pr-12">
						<SheetTitle className="flex items-center gap-2">
							<ChartColumn aria-hidden="true" className="size-4 text-primary" />
							Shipped digest
						</SheetTitle>
						<SheetDescription>
							{digest
								? `${digest.digest.sessionCount} sessions · ${digest.digest.tasksCompletedTotal} tasks completed · built ${new Date(digest.digest.generatedAt).toLocaleTimeString()}`
								: ""}
						</SheetDescription>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<Button
								onClick={() => void copyDigestAgain()}
								size="sm"
								type="button"
								variant="outline"
							>
								{digestCopied ? (
									<Check aria-hidden="true" className="size-3.5" />
								) : (
									<Copy aria-hidden="true" className="size-3.5" />
								)}
								{digestCopied ? "Copied" : "Copy Markdown"}
							</Button>
							<Button onClick={saveDigest} size="sm" type="button">
								<Download aria-hidden="true" className="size-3.5" />
								{digestSaved ? "Saved" : "Save .md"}
							</Button>
							{digest ? (
								<span className="truncate font-mono text-[11px] text-muted-foreground">
									{digest.filename}
								</span>
							) : null}
						</div>
					</SheetHeader>
					<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
						{digest ? (
							<MemoizedMarkdown
								classNames="text-sm"
								content={digest.markdown}
							/>
						) : null}
					</div>
					<div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
						Local export only — not telemetry, billing, or NPS.
					</div>
				</SheetContent>
			</Sheet>
		</PageFrame>
	);
}
