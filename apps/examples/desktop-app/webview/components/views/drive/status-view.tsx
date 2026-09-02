"use client";

/**
 * Status Hub — the changelog for every agent, in three lenses.
 *
 * **Board** answers "where is everything, and what needs me?": one row per
 * subject, attention-ordered by the hub (blocked, then failed, then running),
 * grouped under state headings with whole-table counts from the summary.
 *
 * **Changelog** answers "what happened?": a flat chronological feed of every
 * update, superseded ones included, reading each row as `prev → next`.
 *
 * **Dependency map** answers "what blocks what?": active team tasks projected
 * into a layered graph (`dependency-map.tsx`).
 *
 * Board and changelog page server-side with a keyset cursor through the Drive
 * port (`status.board` / `status.query`), so opening this view never pulls
 * the whole log. A live `status.updated` broadcast is folded into the rows on
 * screen and held to the same filters the page was fetched with.
 */

import type { StatusTagCount, StatusUpdate } from "@cline/shared";
import { Activity, ListChecks, RefreshCw } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	CommandBadge,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import {
	DRIVE_STATUS_LENSES,
	type DriveStatusLens,
	useDrivePrefs,
} from "@/lib/drive/drive-prefs";
import type { DriveDataSource } from "@/lib/drive/drive-source";
import {
	EMPTY_STATUS_FILTERS,
	groupBoardSections,
	hasActiveFilters,
	matchesStatusFilters,
	mergeLiveStatusUpdate,
	parseStatusPage,
	reconcileStatusPage,
	relativeTime,
	STATUS_LENSES,
	type StatusFilters,
	sectionHeadingCount,
	statusLensDefinition,
	statusPageRequest,
	statusTagFacets,
	statusUpdateFromEvent,
	toggleTagFilter,
} from "@/lib/drive/status-filters";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { DependencyMap, useTasksSnapshot } from "./dependency-map";
import { StatusFilterBar, StatusStateTiles } from "./status-filters";
import { STATE_STYLES, StatusRow } from "./status-row";

type PageLens = Exclude<DriveStatusLens, "dependency-map">;

const LIVE_REFRESH_DEBOUNCE_MS = 500;

type StatusPageState = {
	rows: StatusUpdate[];
	tagCounts: StatusTagCount[];
	/** Whole-set count from the server; null until a page-one reply lands. */
	resultTotal: number | null;
	nextCursor: number | null;
	hasMore: boolean;
	/** Any request in flight. */
	loading: boolean;
	/** No page has landed since the last replace — show the skeleton. */
	initial: boolean;
	/** How many pages are stacked on screen. */
	pages: number;
	error: string | null;
};

const EMPTY_PAGE_STATE: StatusPageState = {
	rows: [],
	tagCounts: [],
	resultTotal: null,
	nextCursor: null,
	hasMore: false,
	loading: false,
	initial: true,
	pages: 0,
	error: null,
};

/**
 * One server-paged list. Only the newest request may write results, so a slow
 * first page cannot land after a filter change and repopulate the list with
 * rows that no longer match.
 */
function useStatusPage(
	source: DriveDataSource,
	enabled: boolean,
	lens: PageLens,
	filters: StatusFilters,
) {
	const [state, setState] = useState<StatusPageState>(EMPTY_PAGE_STATE);
	const requestRef = useRef(0);
	const lensRef = useRef(lens);
	lensRef.current = lens;
	const filtersRef = useRef(filters);
	filtersRef.current = filters;
	const filtersKey = JSON.stringify(filters);

	const request = useCallback(
		async (cursor: number | null, replace: boolean, quiet = false) => {
			const id = ++requestRef.current;
			setState((current) => ({
				...current,
				loading: true,
				error: null,
				...(replace && !quiet
					? {
							rows: [],
							// Counts describe the previous filter set; keeping them while
							// the new one loads would put old numbers under new chips.
							tagCounts: [],
							resultTotal: null,
							initial: true,
						}
					: {}),
			}));
			const { op, payload } = statusPageRequest(
				lensRef.current,
				filtersRef.current,
				cursor,
			);
			try {
				const reply = await source.status<unknown>(op, payload);
				if (id !== requestRef.current) {
					return;
				}
				const page = reconcileStatusPage(
					parseStatusPage(reply),
					filtersRef.current,
					cursor,
				);
				setState((current) => ({
					rows: replace ? page.updates : [...current.rows, ...page.updates],
					// Only page-one replies carry facets; a cursor page leaves the
					// counts alone, since they describe the whole set.
					tagCounts: page.tagFacets ?? current.tagCounts,
					resultTotal: page.total ?? current.resultTotal,
					nextCursor: page.nextCursor,
					hasMore: page.hasMore,
					loading: false,
					initial: false,
					pages: replace ? 1 : current.pages + 1,
					error: null,
				}));
			} catch (cause) {
				if (id !== requestRef.current) {
					return;
				}
				setState((current) => ({
					...current,
					loading: false,
					initial: false,
					error: parseDriveCommandError(cause).text,
				}));
			}
		},
		[source],
	);

	// Page one, replaced, whenever the lens or the filters change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `filtersKey` stands in for the filters object.
	useEffect(() => {
		if (!enabled) {
			requestRef.current += 1;
			setState(EMPTY_PAGE_STATE);
			return;
		}
		void request(null, true);
	}, [enabled, lens, filtersKey, request]);

	const loadMore = useCallback(() => {
		setState((current) => {
			if (current.loading || current.nextCursor == null) {
				return current;
			}
			void request(current.nextCursor, false);
			return current;
		});
	}, [request]);

	const refresh = useCallback(() => request(null, true), [request]);
	const quietRefresh = useCallback(() => request(null, true, true), [request]);

	const applyLive = useCallback((live: StatusUpdate, matches: boolean) => {
		setState((current) => ({
			...current,
			rows: mergeLiveStatusUpdate(current.rows, live, lensRef.current, matches),
		}));
	}, []);

	return { state, loadMore, refresh, quietRefresh, applyLive };
}

function LiveBadge({ reduceMotion }: { reduceMotion: boolean }) {
	return (
		<Badge
			className="h-6 gap-1.5 border-success-border px-2 text-[11px] text-success-text"
			variant="outline"
		>
			<span aria-hidden="true" className="relative flex size-1.5">
				<span
					className={cn(
						"absolute inline-flex size-full rounded-full bg-success-solid opacity-60",
						!reduceMotion && "animate-ping motion-reduce:animate-none",
					)}
				/>
				<span className="relative inline-flex size-1.5 rounded-full bg-success-solid" />
			</span>
			Live
		</Badge>
	);
}

function RowsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading status updates"
			className="rounded-lg border border-border bg-card"
			role="status"
		>
			{[0, 1, 2, 3].map((index) => (
				<div
					className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
					key={index}
				>
					<Skeleton className="mt-0.5 h-5 w-14" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				</div>
			))}
		</div>
	);
}

export function StatusView() {
	const { source, phase, hub, statusSummary, refreshSummary } = useDriveHub();
	const [prefs, updatePrefs] = useDrivePrefs();
	const lens = prefs.statusLens;
	const enabled = phase === "live" || phase === "demo";
	const [filters, setFilters] = useState<StatusFilters>(EMPTY_STATUS_FILTERS);
	const pageLens: PageLens = lens === "changelog" ? "changelog" : "board";
	const listActive = enabled && lens !== "dependency-map";
	const page = useStatusPage(source, listActive, pageLens, filters);
	const tasks = useTasksSnapshot(lens === "dependency-map");
	const { state, loadMore, refresh, quietRefresh, applyLive } = page;

	const filtersActive = hasActiveFilters(filters);
	const filtersRef = useRef(filters);
	filtersRef.current = filters;
	const lensRef = useRef(lens);
	lensRef.current = lens;
	const pagesRef = useRef(state.pages);
	pagesRef.current = state.pages;

	/**
	 * Live append. The row is merged at once; the counts under the chips
	 * cannot be patched locally (a board row supersedes a subject that may sit
	 * outside the loaded page), so page one is re-asked quietly — but only
	 * while a single page is on screen, since a replace would collapse pages
	 * someone scrolled for.
	 */
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const unsubscribe = source.subscribe((event) => {
			const live = statusUpdateFromEvent(event);
			if (!live || lensRef.current === "dependency-map") {
				return;
			}
			const matches = matchesStatusFilters(live, filtersRef.current);
			applyLive(live, matches);
			if ((matches || lensRef.current === "board") && pagesRef.current <= 1) {
				if (timer) {
					clearTimeout(timer);
				}
				timer = setTimeout(() => {
					timer = null;
					void quietRefresh();
				}, LIVE_REFRESH_DEBOUNCE_MS);
			}
		});
		return () => {
			unsubscribe();
			if (timer) {
				clearTimeout(timer);
			}
		};
	}, [applyLive, quietRefresh, source]);

	const tagFacets = useMemo(
		() => statusTagFacets(state.tagCounts, filters.tagFilter),
		[filters.tagFilter, state.tagCounts],
	);
	const sections = useMemo(
		() => (lens === "board" ? groupBoardSections(state.rows) : null),
		[lens, state.rows],
	);
	const toggleTag = useCallback((tag: string) => {
		setFilters((current) => ({
			...current,
			tagFilter: toggleTagFilter(current.tagFilter, tag),
		}));
	}, []);

	const refreshAll = useCallback(() => {
		void refreshSummary();
		if (lens === "dependency-map") {
			void tasks.refresh();
		} else {
			void refresh();
		}
	}, [lens, refresh, refreshSummary, tasks.refresh]);

	const definition = statusLensDefinition(lens);
	const busy = lens === "dependency-map" ? tasks.loading : state.loading;
	const showList = lens !== "dependency-map";
	const noRows = state.rows.length === 0;

	return (
		<PageFrame>
			<PageHeader
				actions={
					<Button
						disabled={busy || !enabled}
						onClick={refreshAll}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw
							aria-hidden="true"
							className={cn(
								"size-3.5",
								busy &&
									!prefs.reduceMotion &&
									"animate-spin motion-reduce:animate-none",
							)}
						/>
						Refresh
					</Button>
				}
				description={definition.description}
				icon={Activity}
				meta={
					<span className="flex items-center gap-2">
						{phase === "live" && !hub.reconnecting ? (
							<LiveBadge reduceMotion={prefs.reduceMotion} />
						) : phase === "demo" ? (
							<CommandBadge>demo world</CommandBadge>
						) : null}
						{statusSummary?.lastUpdatedAt ? (
							<Badge
								className="h-6 px-2 text-[11px] font-normal"
								variant="outline"
							>
								last update {relativeTime(statusSummary.lastUpdatedAt)}
							</Badge>
						) : null}
					</span>
				}
				title="Status Hub"
			/>

			<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<Tabs
					onValueChange={(value) => {
						if (DRIVE_STATUS_LENSES.includes(value as DriveStatusLens)) {
							updatePrefs({ statusLens: value as DriveStatusLens });
						}
					}}
					value={lens}
				>
					<TabsList aria-label="Status Hub lens">
						{STATUS_LENSES.map((entry) => (
							<TabsTrigger className="px-3" key={entry.id} value={entry.id}>
								{entry.id === "dependency-map" ? (
									<ListChecks aria-hidden="true" className="size-3.5" />
								) : null}
								{entry.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				{showList && !state.initial ? (
					<p className="text-xs text-muted-foreground">
						<span className="font-medium tabular-nums text-foreground">
							{state.rows.length}
						</span>{" "}
						shown
						{statusSummary && lens === "board" && !filtersActive
							? ` of ${statusSummary.total} active`
							: ""}
						{filtersActive ? " · filtered" : ""}
						{state.hasMore ? " · more available" : ""}
					</p>
				) : null}
			</div>

			{showList ? (
				<div className="mb-5 space-y-4">
					{enabled && statusSummary ? (
						<StatusStateTiles
							onChange={(stateFilter) =>
								setFilters((current) => ({ ...current, stateFilter }))
							}
							stateFilter={filters.stateFilter}
							summary={statusSummary}
						/>
					) : enabled ? null : (
						<div className="flex flex-wrap gap-2">
							{[0, 1, 2, 3, 4].map((index) => (
								<Skeleton
									className="h-16 min-w-28 flex-1 rounded-lg"
									key={index}
								/>
							))}
						</div>
					)}
					<StatusFilterBar
						filters={filters}
						onChange={setFilters}
						resultTotal={state.resultTotal}
						summary={statusSummary}
						tagFacets={tagFacets}
					/>
				</div>
			) : null}

			{showList && state.error ? (
				<div
					className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
					role="alert"
				>
					<span>
						<span className="font-medium text-destructive">
							Status Hub request failed.
						</span>{" "}
						<span className="text-muted-foreground">{state.error}</span>
					</span>
					<Button
						onClick={() => void refresh()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw aria-hidden="true" className="size-3.5" />
						Try again
					</Button>
				</div>
			) : null}

			{lens === "dependency-map" ? (
				<DependencyMap
					error={tasks.error}
					loaded={tasks.loaded}
					loading={tasks.loading}
					onRetry={() => void tasks.refresh()}
					snapshot={tasks.snapshot}
				/>
			) : !enabled || state.initial ? (
				state.error ? null : (
					<RowsSkeleton />
				)
			) : noRows ? (
				<Empty className="min-h-60 border border-dashed border-border bg-card">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Activity aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							{filtersActive
								? "Nothing matches these filters"
								: "No status updates yet"}
						</EmptyTitle>
						<EmptyDescription>
							{filtersActive ? (
								"Widen the search, or reset the filters to see everything the hub holds."
							) : (
								<>
									Agents publish here with the{" "}
									<code className="font-mono text-xs">report_status</code> tool
									as they work. Start a call and the board fills in.
								</>
							)}
						</EmptyDescription>
					</EmptyHeader>
					{filtersActive ? (
						<Button
							onClick={() => setFilters({ ...EMPTY_STATUS_FILTERS })}
							size="sm"
							type="button"
							variant="outline"
						>
							Reset filters
						</Button>
					) : null}
				</Empty>
			) : sections ? (
				<div className="space-y-6">
					{sections.map((section) => (
						<section aria-label={`${section.state} work`} key={section.state}>
							<div className="mb-2 flex flex-wrap items-baseline gap-2">
								<Badge
									className={cn(
										"h-5 px-1.5 text-[10px]",
										STATE_STYLES[section.state],
									)}
									variant="outline"
								>
									{section.state}
								</Badge>
								<span className="text-sm font-medium tabular-nums text-foreground">
									{sectionHeadingCount(
										section.rows.length,
										statusSummary?.byState[section.state],
										filtersActive,
									)}
								</span>
								<span className="text-xs text-muted-foreground">
									{section.blurb}
								</span>
							</div>
							<div className="rounded-lg border border-border bg-card">
								<ul>
									{section.rows.map((update) => (
										<StatusRow
											activeTags={filters.tagFilter}
											key={update.updateId}
											onTagClick={toggleTag}
											update={update}
										/>
									))}
								</ul>
							</div>
						</section>
					))}
				</div>
			) : (
				<div className="rounded-lg border border-border bg-card">
					<ul>
						{state.rows.map((update) => (
							<StatusRow
								activeTags={filters.tagFilter}
								key={update.updateId}
								onTagClick={toggleTag}
								showTransition
								update={update}
							/>
						))}
					</ul>
				</div>
			)}

			{showList &&
			!state.initial &&
			(state.hasMore || state.rows.length > 0) ? (
				<div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
					<span>
						{state.rows.length} shown
						{state.hasMore ? " · more available" : " · end of the list"}
					</span>
					{state.hasMore ? (
						<Button
							disabled={state.loading || state.nextCursor == null}
							onClick={loadMore}
							size="sm"
							type="button"
							variant="outline"
						>
							{state.loading ? "Loading…" : "Load more"}
						</Button>
					) : null}
				</div>
			) : null}
		</PageFrame>
	);
}
