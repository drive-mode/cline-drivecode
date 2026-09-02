"use client";

/**
 * The Status Hub's filter chrome: the state tiles that double as filters, the
 * search box, agent chips, tag facets and the reset. Pure presentation over
 * `lib/drive/status-filters.ts` — every decision about what a chip means or
 * what a count promises lives there.
 */

import type { StatusState, StatusSummary } from "@cline/shared";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	EMPTY_STATUS_FILTERS,
	hasActiveFilters,
	type StatusFilters,
	type StatusTagFacet,
	TILE_STATES,
	toggleStateFilter,
	toggleTagFilter,
} from "@/lib/drive/status-filters";
import { cn } from "@/lib/utils";
import { STATE_DOT, STATE_STYLES } from "./status-row";

const SEARCH_DEBOUNCE_MS = 300;

function StatTile({
	state,
	count,
	active,
	onClick,
}: {
	state: StatusState;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			aria-pressed={active}
			className={cn(
				"group flex min-w-28 flex-1 flex-col gap-1 rounded-lg border px-3.5 py-2.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
				active
					? "border-primary bg-primary/10"
					: "border-border bg-card hover:bg-surface-hover",
				count === 0 && !active && "opacity-60",
			)}
			onClick={onClick}
			title={
				active
					? `Stop filtering by ${state}`
					: `Show only ${state} work (${count})`
			}
			type="button"
		>
			<span className="text-2xl font-semibold tabular-nums leading-none text-foreground">
				{count}
			</span>
			<span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
				<span
					aria-hidden="true"
					className={cn("size-1.5 rounded-full", STATE_DOT[state])}
				/>
				{state}
			</span>
		</button>
	);
}

export function StatusStateTiles({
	summary,
	stateFilter,
	onChange,
}: {
	summary: StatusSummary | null;
	stateFilter: readonly StatusState[];
	onChange: (next: StatusState[]) => void;
}) {
	return (
		<section aria-label="Work by state" className="flex flex-wrap gap-2">
			{TILE_STATES.map((state) => (
				<StatTile
					active={stateFilter.includes(state)}
					count={summary?.byState[state] ?? 0}
					key={state}
					onClick={() => onChange(toggleStateFilter(stateFilter, state))}
					state={state}
				/>
			))}
		</section>
	);
}

export type StatusFilterBarProps = {
	filters: StatusFilters;
	onChange: (next: StatusFilters) => void;
	summary: StatusSummary | null;
	/** Chips carry the server's counts; hidden entirely when there are none. */
	tagFacets: readonly StatusTagFacet[];
	/** Whole-set count from the server; null until a page-one reply lands. */
	resultTotal: number | null;
};

export function StatusFilterBar({
	filters,
	onChange,
	summary,
	tagFacets,
	resultTotal,
}: StatusFilterBarProps) {
	const [draft, setDraft] = useState(filters.search);
	const filtersRef = useRef(filters);
	filtersRef.current = filters;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// A reset from outside (the "Reset filters" button) clears the box too.
	useEffect(() => {
		setDraft((current) =>
			current.trim() === filters.search ? current : filters.search,
		);
	}, [filters.search]);

	// Typing applies after a short pause; Enter applies immediately.
	useEffect(() => {
		const next = draft.trim();
		if (next === filtersRef.current.search) {
			return;
		}
		const timer = setTimeout(() => {
			onChangeRef.current({ ...filtersRef.current, search: next });
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [draft]);

	const filtersActive = hasActiveFilters(filters);
	const agents = summary?.byAgent.slice(0, 6) ?? [];
	const activeAgent = summary?.byAgent.find(
		(agent) => agent.agentId === filters.agentFilter,
	);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<form
					aria-label="Search status updates"
					className="relative w-64 max-w-full"
					onSubmit={(event) => {
						event.preventDefault();
						onChange({ ...filters, search: draft.trim() });
					}}
				>
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Search status headlines and detail"
						className="h-8 pl-8 pr-8 text-sm"
						onChange={(event) => setDraft(event.target.value)}
						placeholder="Search status text"
						value={draft}
					/>
					{draft ? (
						<button
							aria-label="Clear search"
							className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
							onClick={() => {
								setDraft("");
								onChange({ ...filters, search: "" });
							}}
							type="button"
						>
							<X aria-hidden="true" className="size-3.5" />
						</button>
					) : null}
				</form>

				{agents.length > 0 ? (
					<section
						aria-label="Filter by agent"
						className="flex flex-wrap items-center gap-1.5"
					>
						{agents.map((agent) => {
							const active = filters.agentFilter === agent.agentId;
							return (
								<Button
									aria-pressed={active}
									className="h-8 px-2.5 text-xs"
									key={agent.agentId}
									onClick={() =>
										onChange({
											...filters,
											agentFilter: active ? null : agent.agentId,
										})
									}
									size="sm"
									type="button"
									variant={active ? "default" : "outline"}
								>
									<span className="max-w-32 truncate">
										{agent.agentName ?? agent.agentId}
									</span>
									<span className="tabular-nums opacity-60">{agent.total}</span>
									{agent.blocked > 0 ? (
										<span
											className={cn(
												"tabular-nums",
												active ? "opacity-90" : "text-warning-text",
											)}
										>
											{agent.blocked} blocked
										</span>
									) : null}
								</Button>
							);
						})}
					</section>
				) : null}

				{filtersActive ? (
					<Button
						className="h-8 px-2.5 text-xs"
						onClick={() => {
							setDraft("");
							onChange({ ...EMPTY_STATUS_FILTERS });
						}}
						size="sm"
						type="button"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-3.5" />
						Reset filters
					</Button>
				) : null}
			</div>

			{filters.stateFilter.length > 0 || tagFacets.length > 0 ? (
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						{filters.stateFilter.map((state) => (
							<Badge
								className={cn(
									"h-6 gap-1 pr-1 text-[11px]",
									STATE_STYLES[state],
								)}
								key={state}
								variant="outline"
							>
								{state}
								<button
									aria-label={`Stop filtering by ${state}`}
									className="flex size-4 items-center justify-center rounded-sm outline-none hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50"
									onClick={() =>
										onChange({
											...filters,
											stateFilter: toggleStateFilter(
												filters.stateFilter,
												state,
											),
										})
									}
									type="button"
								>
									<X aria-hidden="true" className="size-3" />
								</button>
							</Badge>
						))}
						{tagFacets.map((facet) => (
							<Button
								aria-pressed={facet.selected}
								className="h-6 shrink-0 gap-1 px-2 text-[11px]"
								key={facet.tag}
								onClick={() =>
									onChange({
										...filters,
										tagFilter: toggleTagFilter(filters.tagFilter, facet.tag),
									})
								}
								size="xs"
								type="button"
								variant={facet.selected ? "default" : "outline"}
							>
								<span className="max-w-40 truncate">{facet.tag}</span>
								{/* No number until the server has sent one: a chip reading 0
								    above rows that are about to arrive is a lie. */}
								{resultTotal != null ? (
									<span className="rounded-sm bg-background/30 px-1 tabular-nums opacity-70">
										{facet.count}
									</span>
								) : null}
							</Button>
						))}
					</div>
					<div className="flex min-h-6 shrink-0 items-center gap-2 text-xs text-muted-foreground">
						{resultTotal != null ? (
							<span>
								<span className="font-medium tabular-nums text-foreground">
									{resultTotal}
								</span>{" "}
								{resultTotal === 1 ? "result" : "results"}
							</span>
						) : null}
					</div>
				</div>
			) : null}

			{activeAgent ? (
				<p className="text-xs text-muted-foreground">
					Showing {activeAgent.agentName ?? activeAgent.agentId} —{" "}
					{activeAgent.total} active, {activeAgent.running} running,{" "}
					{activeAgent.blocked} blocked.
				</p>
			) : null}
		</div>
	);
}
