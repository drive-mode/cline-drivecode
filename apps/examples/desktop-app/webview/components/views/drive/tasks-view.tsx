"use client";

/**
 * Tasks — the dependency map as its own page.
 *
 * What this adds over the Status Hub lens, stated plainly: the **Plans rail**,
 * the summary strip, and the graph without a status log's chrome above it.
 * The graph itself is the same component — promotion, not construction.
 *
 * It does not add a second projection, a second layout engine, or any task
 * mutation. Teams and annotations arrive through `status.tasks_snapshot` on
 * the Drive port; the live hub returns no annotations today, which is why the
 * rail's empty state is the production state.
 */

import { ListChecks, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	CommandBadge,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import {
	buildDependencyMap,
	type DependencyMapSummary,
	summarizeDependencyMap,
} from "@/lib/drive/dependency-map-model";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { DependencyMap, useTasksSnapshot } from "./dependency-map";

type SummaryTile = {
	key: keyof DependencyMapSummary;
	label: string;
	tone?: string;
};

const TILES: readonly SummaryTile[] = [
	{ key: "tasks", label: "Tasks" },
	{ key: "blocked", label: "Blocked", tone: "text-warning-text" },
	{ key: "ready", label: "Ready", tone: "text-success-text" },
	{ key: "inProgress", label: "In progress", tone: "text-primary" },
	{ key: "completed", label: "Completed" },
	{ key: "plans", label: "Plans" },
];

function SummaryStrip({
	summary,
	loading,
}: {
	summary: DependencyMapSummary | null;
	loading: boolean;
}) {
	return (
		<section
			aria-label="Task summary"
			className="mb-5 grid grid-cols-6 gap-2 max-[1100px]:grid-cols-3"
		>
			{TILES.map((tile) => (
				<div
					className="flex flex-col gap-1 rounded-lg border border-border bg-card px-3.5 py-2.5"
					key={tile.key}
				>
					{summary ? (
						<span
							className={cn(
								"text-2xl font-semibold tabular-nums leading-none text-foreground",
								tile.tone,
							)}
						>
							{summary[tile.key]}
						</span>
					) : (
						<Skeleton className="h-6 w-10" />
					)}
					<span className="text-[11px] uppercase tracking-wide text-muted-foreground">
						{tile.label}
						{loading && summary ? (
							<span className="sr-only"> (refreshing)</span>
						) : null}
					</span>
				</div>
			))}
		</section>
	);
}

export function TasksView() {
	const { phase } = useDriveHub();
	const [prefs] = useDrivePrefs();
	const tasks = useTasksSnapshot();
	const enabled = phase === "live" || phase === "demo";
	const summary = useMemo(() => {
		if (!tasks.loaded) {
			return null;
		}
		return summarizeDependencyMap(
			buildDependencyMap(
				tasks.snapshot.teams.map((team) => ({
					teamId: team.teamId,
					tasks: team.tasks,
				})),
				tasks.snapshot.annotations ?? undefined,
			),
		);
	}, [tasks.loaded, tasks.snapshot]);
	const teamNames = tasks.snapshot.teams.map((team) => team.teamName);

	return (
		<PageFrame>
			<PageHeader
				actions={
					<Button
						disabled={tasks.loading || !enabled}
						onClick={() => void tasks.refresh()}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCw
							aria-hidden="true"
							className={cn(
								"size-3.5",
								tasks.loading &&
									!prefs.reduceMotion &&
									"animate-spin motion-reduce:animate-none",
							)}
						/>
						Refresh
					</Button>
				}
				description="What blocks what, across every active team. Read-only — a projection of the tasks those teams are already running, not a second place to edit them."
				icon={ListChecks}
				meta={
					<span className="flex items-center gap-2">
						{phase === "demo" ? <CommandBadge>demo world</CommandBadge> : null}
						{teamNames.length ? (
							<Badge
								className="h-6 max-w-56 truncate px-2 font-mono text-[11px] font-normal"
								title={teamNames.join(", ")}
								variant="outline"
							>
								{teamNames.length === 1
									? teamNames[0]
									: `${teamNames.length} teams`}
							</Badge>
						) : null}
					</span>
				}
				title="Tasks"
			/>
			<SummaryStrip loading={tasks.loading} summary={summary} />
			<DependencyMap
				error={tasks.error}
				loaded={tasks.loaded}
				loading={tasks.loading}
				onRetry={() => void tasks.refresh()}
				plansRail
				snapshot={tasks.snapshot}
			/>
		</PageFrame>
	);
}
