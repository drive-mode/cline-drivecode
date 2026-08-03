/**
 * Tasks — the dependency map as its own page.
 *
 * What this adds over the Status Hub lens, stated plainly so the claim can be
 * checked: the **Plans rail**, a route of its own (`/tasks` — deep-linkable and
 * reloadable, with a nav entry), and the graph without a status log's chrome
 * above it. The graph itself is the same component; promoting it was the point
 * (`delivery/ship-remaining-planned.md`: "Promotion, not construction").
 *
 * It does **not** add a second projection, a second layout engine, or any task
 * mutation. The lens stays in Status Hub as the in-context peek next to the
 * board and the changelog; this page is where you go when the graph *is* the
 * question.
 *
 * Teams arrive through the same `StatusTeamsSource` the lens uses. Annotations
 * — plan groups and minted `T###`/`P###` ids — come through a separate,
 * optional port whose live implementation returns `null`, because nothing in
 * the team runtime carries them yet. That is why the rail's empty state is the
 * production state.
 */

import type { DependencyMapAnnotations, TeamRuntimeState } from "@cline/shared";
import { GitBranchIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { subscribeToHostMessages } from "../../lib/host-message-gateway";
import type { DependencyAnnotationsSource } from "../../status/dependency-annotations-source";
import type { StatusTeamsSource } from "../../status/status-teams-source";
import { DependencyMap } from "./dependency-map";
import { PageFrame, PageHeader } from "./page-layout";
import { isStatusViewHostMessage } from "./status-view-messages";

export function TasksView({
	annotationsSource,
	teamsSource,
}: {
	annotationsSource: DependencyAnnotationsSource;
	teamsSource: StatusTeamsSource;
}) {
	const [teams, setTeams] = useState<TeamRuntimeState[]>([]);
	const [annotations, setAnnotations] =
		useState<DependencyMapAnnotations | null>(null);
	const [loading, setLoading] = useState(false);
	/** Only the newest request may write, as in the Status Hub lens. */
	const teamsRequestRef = useRef<string | null>(null);

	const requestTasks = useCallback(() => {
		const requestId = `tasks-page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		teamsRequestRef.current = requestId;
		setLoading(true);
		void teamsSource.loadTeams().then((next) => {
			if (teamsRequestRef.current !== requestId) return;
			setTeams(next);
			setLoading(false);
		});
	}, [teamsSource]);

	useEffect(() => {
		requestTasks();
	}, [requestTasks]);

	/**
	 * Annotations are structure, not state: they do not change because a task
	 * moved, so they load with the source rather than on every `team_progress`.
	 */
	useEffect(() => {
		let cancelled = false;
		void annotationsSource.loadAnnotations().then((next) => {
			if (!cancelled) setAnnotations(next);
		});
		return () => {
			cancelled = true;
		};
	}, [annotationsSource]);

	/** The one frame this page reacts to: a team moved, so re-ask the source. */
	useEffect(() => {
		return subscribeToHostMessages({
			types: ["team_progress"],
			guard: isStatusViewHostMessage,
			onMessage: requestTasks,
		});
	}, [requestTasks]);

	return (
		<PageFrame>
			<PageHeader
				description="What blocks what, across every active team. Read-only — a projection of the tasks those teams are already running, not a second place to edit them."
				icon={GitBranchIcon}
				title="Tasks"
				actions={
					<Button
						disabled={loading}
						onClick={requestTasks}
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
			<DependencyMap
				annotations={annotations}
				loading={loading}
				plansRail
				teams={teams}
			/>
		</PageFrame>
	);
}
