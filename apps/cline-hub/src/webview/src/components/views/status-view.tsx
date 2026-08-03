/**
 * Status Hub — the changelog for every agent.
 *
 * Three lenses over one operational surface:
 *
 * **Board** answers "where is everything, and what needs me?" It shows one row
 * per subject (the current status), ordered by attention (blocked, then failed,
 * then running) rather than by recency, grouped under state headings, with
 * whole-table counts from the server.
 *
 * **Changelog** answers "what happened?" It is a flat chronological feed of
 * every update including superseded ones, showing state transitions.
 *
 * **Dependency map** answers "what blocks what?" It projects active team tasks
 * (`status.tasks_snapshot`) into a layered graph. Demo teams are injected via
 * the `teamsSource` prop from the composition root (App.tsx) — this
 * view does not read demo query params or import fixtures.
 *
 * Analytics owns retrospective rollups (session accomplishment digests).
 *
 * Board and Changelog page server-side with a keyset cursor, so opening this
 * view never pulls the whole log.
 */

import type {
	StatusState,
	StatusSummary,
	StatusTagCount,
	StatusUpdate,
	TeamRuntimeState,
} from "@cline/shared";
import { ActivityIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { subscribeToHostMessages } from "../../lib/host-message-gateway";
import type { StatusTeamsSource } from "../../status/status-teams-source";
import { postToHost } from "../../vscode";
import { DependencyMap } from "./dependency-map";
import { PageEmptyState, PageFrame, PageHeader } from "./page-layout";
import {
	hasActiveFilters,
	matchesStatusFilters,
	sectionHeadingCount,
	statusTagFacets,
	toggleTagFilter,
} from "./status-filters";
import { relativeTime, STATE_STYLES, StatusRow } from "./status-row";
import {
	isStatusViewHostMessage,
	STATUS_VIEW_MESSAGE_TYPES,
	statusTagCountsOf,
} from "./status-view-messages";

const PAGE_LIMIT = 50;

export type StatusViewMode = "board" | "changelog" | "dependency-map";

/** Board section order — what needs a human first. */
const BOARD_SECTIONS: ReadonlyArray<{ state: StatusState; blurb: string }> = [
	{ state: "blocked", blurb: "Waiting on someone. Start here." },
	{ state: "failed", blurb: "Stopped and will not continue on its own." },
	{ state: "running", blurb: "In progress right now." },
	{ state: "queued", blurb: "Accepted, not started." },
	{ state: "done", blurb: "Finished." },
	{ state: "cancelled", blurb: "Abandoned." },
];

/** Tiles that lead with what is wrong. */
const TILE_STATES: readonly StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
	"done",
];

const MODE_LABELS: Record<StatusViewMode, string> = {
	board: "board",
	changelog: "changelog",
	"dependency-map": "dependency-map",
};

/**
 * Keep `?statusMode=` in step with the active lens.
 *
 * The deep link was boot-only: `?statusMode=dependency-map` opened the map,
 * but switching lens left the URL claiming the lens you started on, so
 * copying the address bar handed someone else the wrong view. Replace rather
 * than push — a lens tab is a filter over one page, not a new destination,
 * and Back should leave the Status Hub instead of walking the tabs.
 */
function syncStatusModeQuery(mode: StatusViewMode): void {
	if (typeof window === "undefined") return;
	const params = new URLSearchParams(window.location.search);
	if (params.get("statusMode") === mode) return;
	params.set("statusMode", mode);
	window.history.replaceState(
		null,
		"",
		`${window.location.pathname}?${params.toString()}`,
	);
}

function StatTile({
	label,
	count,
	active,
	onClick,
}: {
	label: StatusState;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				"min-w-24 flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
				active ? "border-primary bg-accent" : "hover:bg-muted/50",
				count === 0 && "opacity-50",
			)}
			onClick={onClick}
			type="button"
		>
			<div className="text-2xl font-semibold tabular-nums text-foreground">
				{count}
			</div>
			<div
				className={cn(
					"text-[11px] uppercase tracking-wide",
					STATE_STYLES[label].split(" ").slice(1).join(" "),
				)}
			>
				{label}
			</div>
		</button>
	);
}

export function StatusView(props: {
	teamsSource: StatusTeamsSource;
	initialMode?: StatusViewMode;
}) {
	const { teamsSource, initialMode = "board" } = props;
	const [mode, setMode] = useState<StatusViewMode>(initialMode);
	const [updates, setUpdates] = useState<StatusUpdate[]>([]);
	const [summary, setSummary] = useState<StatusSummary | null>(null);
	/**
	 * Server-side counts over the whole set the current query matches, not over
	 * the page it returned. `resultTotal` stays null until a reply carries one:
	 * mid-request, and on any reply whose counts did not survive validation, the
	 * view renders no number at all rather than a confident zero.
	 */
	const [tagCounts, setTagCounts] = useState<StatusTagCount[]>([]);
	const [resultTotal, setResultTotal] = useState<number | null>(null);
	const [nextCursor, setNextCursor] = useState<number | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stateFilter, setStateFilter] = useState<StatusState[]>([]);
	const [agentFilter, setAgentFilter] = useState<string | null>(null);
	const [tagFilter, setTagFilter] = useState<string[]>([]);
	const [searchDraft, setSearchDraft] = useState("");
	const [search, setSearch] = useState("");
	const [teams, setTeams] = useState<TeamRuntimeState[]>([]);
	const [tasksLoading, setTasksLoading] = useState(false);
	const tasksRequestRef = useRef<string | null>(null);

	/**
	 * Only the newest request may write results. Without this, a slow first
	 * page can land after a filter change and repopulate the list with rows
	 * that no longer match.
	 */
	const activeRequestRef = useRef<string | null>(null);
	/**
	 * Whether the in-flight request replaces the list or appends to it.
	 * Inferring this from `updates.length === 0` was wrong: a live
	 * `status_updated` landing between the clear and the response repopulated
	 * the list, so the fresh page appended onto stale rows.
	 */
	const replaceRequestRef = useRef(false);

	const filtersActive = hasActiveFilters({
		stateFilter,
		agentFilter,
		tagFilter,
		search,
	});

	const request = useCallback(
		(
			cursor: number | null,
			replace: boolean,
			/**
			 * Refresh in place: keep the rows and counts on screen until the
			 * reply lands. For a live broadcast, where blanking a list the user
			 * is reading would be worse than the staleness being corrected.
			 */
			quiet = false,
		) => {
			const requestId = `status-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			activeRequestRef.current = requestId;
			replaceRequestRef.current = replace;
			setLoading(true);
			setError(null);
			if (replace && !quiet) {
				setUpdates([]);
				// Counts describe the previous filter set; keeping them while the
				// new one loads would put the old numbers under the new chips.
				setTagCounts([]);
				setResultTotal(null);
			}
			postToHost({
				type: mode === "board" ? "status_board" : "status_query",
				requestId,
				limit: PAGE_LIMIT,
				// Only on a page-one request. Facets ignore the cursor, so every
				// page of one query carries identical counts — asking again while
				// paging buys nothing and costs two aggregates over the whole set.
				...(cursor == null ? { includeFacets: true } : {}),
				...(cursor != null ? { cursor } : {}),
				...(stateFilter.length ? { state: stateFilter } : {}),
				...(agentFilter ? { agentId: agentFilter } : {}),
				...(tagFilter.length ? { tags: tagFilter } : {}),
				...(search ? { text: search } : {}),
			});
		},
		[mode, stateFilter, agentFilter, tagFilter, search],
	);

	const requestSummary = useCallback(() => {
		postToHost({ type: "status_summary", requestId: "status-summary" });
	}, []);

	const requestTasks = useCallback(() => {
		const requestId = `status-tasks-adapter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		tasksRequestRef.current = requestId;
		setTasksLoading(true);
		void teamsSource.loadTeams().then((next) => {
			if (tasksRequestRef.current !== requestId) return;
			setTeams(next);
			setTasksLoading(false);
		});
	}, [teamsSource]);

	useEffect(() => {
		if (mode === "dependency-map") {
			return;
		}
		request(null, true);
	}, [mode, request]);

	useEffect(() => {
		requestSummary();
	}, [requestSummary]);

	useEffect(() => {
		if (mode === "dependency-map") requestTasks();
	}, [mode, requestTasks]);

	useEffect(() => {
		return subscribeToHostMessages({
			types: STATUS_VIEW_MESSAGE_TYPES,
			guard: isStatusViewHostMessage,
			onMessage: (message) => {
				if (message.type === "status_page") {
					if (message.requestId !== activeRequestRef.current) return;
					const page = message.updates;
					const replace = replaceRequestRef.current;
					setUpdates((current) => (replace ? page : [...current, ...page]));
					// Only page-one replies carry facets; a cursor page leaves the
					// counts alone rather than blanking them, since they describe
					// the whole set and have not changed.
					const facets = statusTagCountsOf(message.tagFacets);
					if (facets) setTagCounts(facets);
					if (Number.isFinite(message.total)) {
						setResultTotal(message.total as number);
					}
					setNextCursor(message.nextCursor ?? null);
					setHasMore(message.hasMore === true);
					setLoading(false);
					return;
				}

				if (message.type === "status_summary_result") {
					setSummary(message.summary);
					return;
				}

				if (message.type === "status_tasks_snapshot_result") {
					// Teams load through StatusTeamsSource adapters only.
					return;
				}

				if (message.type === "team_progress") {
					if (mode === "dependency-map") requestTasks();
					return;
				}

				if (message.type === "status_error") {
					if (message.requestId !== activeRequestRef.current) return;
					setError(message.text);
					setLoading(false);
					return;
				}

				if (message.type === "status_updated") {
					const live = message.update;
					const matches = matchesStatusFilters(live, {
						stateFilter,
						agentFilter,
						tagFilter,
						search,
					});
					setUpdates((current) => {
						if (current.some((u) => u.updateId === live.updateId))
							return current;
						if (mode === "board") {
							const withoutSubject = current.filter(
								(u) => u.subject !== live.subject,
							);
							return matches ? [live, ...withoutSubject] : withoutSubject;
						}
						if (!matches) return current;
						return [live, ...current];
					});
					requestSummary();
					// The prepend above changed the rows on screen, which leaves
					// the chip counts and the result count describing a set that no
					// longer matches the list under them. They cannot be patched
					// locally — in board mode the live row supersedes a subject that
					// may sit outside the loaded page, so the client cannot tell
					// whether the set grew or only changed shape — so re-ask.
					// Quietly, and only when the view actually changed: blanking a
					// list someone is reading would be worse than the staleness.
					if (matches || mode === "board") request(null, true, true);
				}
			},
		});
	}, [
		mode,
		request,
		requestSummary,
		requestTasks,
		stateFilter,
		agentFilter,
		tagFilter,
		search,
	]);

	const toggleState = useCallback((value: StatusState) => {
		setStateFilter((current) =>
			current.includes(value)
				? current.filter((entry) => entry !== value)
				: [...current, value],
		);
	}, []);

	const toggleTag = useCallback((value: string) => {
		setTagFilter((current) => toggleTagFilter(current, value));
	}, []);

	/**
	 * Chips carry the server's counts over the whole matching set, so a chip's
	 * number is exactly what clicking it returns. The counts already reflect
	 * `tagFilter` — the query they were computed for includes it — which is what
	 * makes a second chip narrow rather than reset.
	 */
	const tagFacets = useMemo(
		() => statusTagFacets(tagCounts, tagFilter),
		[tagCounts, tagFilter],
	);

	const sections = useMemo(() => {
		if (mode !== "board") return null;
		return BOARD_SECTIONS.map((section) => ({
			...section,
			rows: updates.filter((update) => update.state === section.state),
		})).filter((section) => section.rows.length > 0);
	}, [mode, updates]);

	const refreshAll = useCallback(() => {
		if (mode !== "dependency-map") {
			request(null, true);
		}
		requestSummary();
		if (mode === "dependency-map") requestTasks();
	}, [mode, request, requestSummary, requestTasks]);

	const activeAgent = summary?.byAgent.find((a) => a.agentId === agentFilter);

	const description =
		mode === "board"
			? "Where every agent is right now ? one row per piece of work, most urgent first."
			: mode === "dependency-map"
				? "Task prerequisites and dependent work from active teams."
				: "Everything that has happened, newest first, including superseded updates.";

	return (
		<PageFrame>
			<PageHeader
				description={description}
				icon={ActivityIcon}
				meta={
					summary?.lastUpdatedAt ? (
						<Badge className="text-[10px]" variant="outline">
							last update {relativeTime(summary.lastUpdatedAt)}
						</Badge>
					) : null
				}
				title="Status Hub"
				actions={
					<Button
						disabled={loading}
						onClick={refreshAll}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCwIcon
							className={cn("size-3.5", loading && "animate-spin")}
						/>
						Refresh
					</Button>
				}
			/>

			{summary ? (
				<div className="mb-4 flex flex-wrap gap-2">
					{TILE_STATES.map((state) => (
						<StatTile
							active={stateFilter.includes(state)}
							count={summary.byState[state] ?? 0}
							key={state}
							label={state}
							onClick={() => toggleState(state)}
						/>
					))}
				</div>
			) : null}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="flex overflow-hidden rounded-md border">
					{(["board", "changelog", "dependency-map"] as const).map((value) => (
						<button
							className={cn(
								"px-3 py-1.5 text-xs capitalize transition-colors",
								mode === value
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							aria-pressed={mode === value}
							key={value}
							onClick={() => {
								setMode(value);
								syncStatusModeQuery(value);
							}}
							type="button"
						>
							{MODE_LABELS[value]}
						</button>
					))}
				</div>

				{mode !== "dependency-map" ? (
					<form
						className="flex items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							setSearch(searchDraft.trim());
						}}
					>
						<div className="relative">
							<SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								className="h-8 w-56 pl-7 text-xs"
								onChange={(event) => setSearchDraft(event.target.value)}
								placeholder="Search status text"
								value={searchDraft}
							/>
						</div>
						{search ? (
							<Button
								onClick={() => {
									setSearchDraft("");
									setSearch("");
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								Clear
							</Button>
						) : null}
					</form>
				) : null}

				{summary && summary.byAgent.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1">
						{summary.byAgent.slice(0, 6).map((agent) => (
							<Button
								className="h-7 px-2 text-xs"
								key={agent.agentId}
								onClick={() =>
									setAgentFilter((current) =>
										current === agent.agentId ? null : agent.agentId,
									)
								}
								size="sm"
								type="button"
								variant={agentFilter === agent.agentId ? "default" : "outline"}
							>
								{agent.agentName ?? agent.agentId}
								<span className="ml-1 opacity-60">{agent.total}</span>
								{agent.blocked > 0 ? (
									<span className="ml-1 text-amber-600 dark:text-amber-400">
										{agent.blocked} blocked
									</span>
								) : null}
							</Button>
						))}
					</div>
				) : null}

				{filtersActive ? (
					<Button
						className="h-7 px-2 text-xs"
						onClick={() => {
							setStateFilter([]);
							setAgentFilter(null);
							setTagFilter([]);
							setSearch("");
							setSearchDraft("");
						}}
						size="sm"
						type="button"
						variant="ghost"
					>
						Reset filters
					</Button>
				) : null}
			</div>

			{mode !== "dependency-map" && tagFacets.length > 0 ? (
				<div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div className="flex gap-1.5 overflow-x-auto pb-1">
						{tagFacets.map((facet) => (
							<Button
								aria-pressed={facet.selected}
								className="h-7 shrink-0 px-2 text-xs"
								key={facet.tag}
								onClick={() => toggleTag(facet.tag)}
								size="sm"
								type="button"
								variant={facet.selected ? "default" : "outline"}
							>
								<span className="truncate">{facet.tag}</span>
								{/* No number until the server has sent one. Mid-reload
								    the only chips left are the selected ones, seeded at
								    zero to keep them clickable — and a chip reading 0
								    above rows that are about to arrive is a lie. */}
								{resultTotal != null ? (
									<span className="ml-1 rounded bg-background/30 px-1 tabular-nums opacity-70">
										{facet.count}
									</span>
								) : null}
							</Button>
						))}
					</div>
					<div className="flex min-h-7 shrink-0 items-center gap-2 text-xs text-muted-foreground">
						{resultTotal != null ? (
							<>
								{/* The same server count the chips are drawn from, so
								    clicking a chip lands on the number it promised. */}
								<span className="font-medium text-foreground tabular-nums">
									{resultTotal}
								</span>
								<span>{resultTotal === 1 ? "result" : "results"}</span>
							</>
						) : null}
						{tagFilter.length > 0 ? (
							<Button
								className="h-7 px-2 text-xs"
								onClick={() => setTagFilter([])}
								size="sm"
								type="button"
								variant="ghost"
							>
								Clear filters
							</Button>
						) : null}
					</div>
				</div>
			) : null}

			{activeAgent ? (
				<p className="mb-3 text-xs text-muted-foreground">
					Showing {activeAgent.agentName ?? activeAgent.agentId} —{" "}
					{activeAgent.total} active, {activeAgent.running} running,{" "}
					{activeAgent.blocked} blocked.
				</p>
			) : null}

			{error ? (
				<div
					className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
					role="alert"
				>
					{error}
				</div>
			) : null}

			{mode === "dependency-map" ? (
				<DependencyMap loading={tasksLoading} teams={teams} />
			) : updates.length === 0 && !loading ? (
				<div className="rounded-lg border bg-card">
					<PageEmptyState>
						No status updates yet. Agents publish here with the{" "}
						<code className="font-mono text-xs">report_status</code> tool.
					</PageEmptyState>
				</div>
			) : sections ? (
				<div className="space-y-5">
					{sections.map((section) => (
						<section key={section.state}>
							<div className="mb-2 flex items-baseline gap-2">
								<Badge
									className={cn("text-[10px]", STATE_STYLES[section.state])}
									variant="outline"
								>
									{section.state}
								</Badge>
								<span className="text-sm font-medium text-foreground">
									{sectionHeadingCount(
										section.rows.length,
										summary?.byState[section.state],
										filtersActive,
									)}
								</span>
								<span className="text-xs text-muted-foreground">
									{section.blurb}
								</span>
							</div>
							<div className="rounded-lg border bg-card">
								<ul>
									{section.rows.map((update) => (
										<StatusRow
											activeTags={tagFilter}
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
				<div className="rounded-lg border bg-card">
					<ul>
						{updates.map((update) => (
							<StatusRow
								activeTags={tagFilter}
								key={update.updateId}
								onTagClick={toggleTag}
								showTransition
								update={update}
							/>
						))}
					</ul>
				</div>
			)}

			{mode !== "dependency-map" ? (
				<div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
					<span>
						{updates.length} shown
						{summary && mode === "board" && !filtersActive
							? ` of ${summary.total} active`
							: ""}
						{filtersActive ? " · filtered" : ""}
						{hasMore ? " · more available" : ""}
					</span>
					{hasMore ? (
						<Button
							disabled={loading || nextCursor == null}
							onClick={() => request(nextCursor, false)}
							size="sm"
							type="button"
							variant="outline"
						>
							{loading ? "Loading…" : "Load more"}
						</Button>
					) : null}
				</div>
			) : null}
		</PageFrame>
	);
}
