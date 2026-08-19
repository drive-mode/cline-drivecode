/**
 * `/agents` — the Driveagent directory (DRV-AGENT-PROFILE).
 *
 * Two registries share this route and are kept visibly apart, because they are
 * not the same thing and merging them would invent a relationship:
 *  - **Driveagents** are `.driveagent/<slug>/` homes: configuration as code,
 *    with a durable appearance and a profile page.
 *  - **Configured agents** are the `.cline/agents/` files the customization
 *    list already showed. They are host settings discovered on disk, they have
 *    no Drive identity, and nothing here changes that.
 */

import { useEffect, useState } from "react";
import { ClineMarkIcon } from "@/components/icons/cline-mark";
import { Badge } from "@/components/ui/badge";
import {
	type DirectoryEntry,
	loadDirectorySources,
} from "./agentDirectoryLoad";
import { resolveChannelInk, useDriveInkTheme } from "./agentInk";
import { CLINE_BUILTIN_REF_ID } from "./agentMark";
import { agentProfilePath } from "./agentProfileRoute";

export {
	buildDirectoryEntries,
	type DirectoryEntry,
	loadDirectorySources,
} from "./agentDirectoryLoad";

function AgentCard({ entry }: { entry: DirectoryEntry }) {
	const theme = useDriveInkTheme();
	const color = resolveChannelInk({
		ink: entry.nameInk,
		channel: "name",
		profileId: entry.profileId,
		theme,
	});
	const isCline =
		entry.ref.kind === "builtin" && entry.ref.id === CLINE_BUILTIN_REF_ID;

	return (
		<a
			className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40"
			data-agent-card={entry.profileId}
			href={agentProfilePath(entry.profileId)}
		>
			<span
				aria-hidden
				className="grid size-9 shrink-0 place-items-center rounded-full border border-current/45 bg-current/15 font-mono text-sm font-bold"
				data-agent-avatar={isCline ? "cline-mark" : "initial"}
				style={{ color }}
			>
				{isCline ? (
					<ClineMarkIcon className="size-5" />
				) : (
					entry.displayName.slice(0, 1).toUpperCase()
				)}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="truncate text-sm font-medium" style={{ color }}>
						{entry.displayName}
					</span>
					{entry.tier === "user" ? (
						<Badge className="text-[10px]" variant="outline">
							user home
						</Badge>
					) : null}
				</div>
				<div className="truncate font-mono text-[10px] text-muted-foreground">
					{entry.profileId}
				</div>
				{entry.description ? (
					<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
						{entry.description}
					</p>
				) : null}
			</div>
		</a>
	);
}

export function AgentDirectory({ workspaceRoot }: { workspaceRoot?: string }) {
	const root = workspaceRoot?.trim() ?? "";
	const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!root) {
			setEntries([]);
			return;
		}
		let cancelled = false;
		setEntries(null);
		setError(null);
		void loadDirectorySources(root).then((result) => {
			if (cancelled) return;
			setError(result.error);
			setEntries(result.entries);
		});
		return () => {
			cancelled = true;
		};
	}, [root]);

	return (
		<section className="space-y-3" data-testid="agent-directory">
			<div className="space-y-1">
				<h2 className="text-sm font-semibold">Driveagents</h2>
				<p className="text-xs text-muted-foreground">
					Homes under <code className="font-mono">.driveagent/</code> — each has
					a profile page with its configuration, capabilities and appearance.
					Seating one commits room metadata; there is one Cline runtime behind
					the feed, so a profile configures identity, not execution.
				</p>
			</div>
			{!root ? (
				<p className="text-xs text-muted-foreground">
					No workspace root resolved yet — Driveagent homes load once the hub
					binds one.
				</p>
			) : entries === null ? (
				<p className="text-xs text-muted-foreground">Loading agents…</p>
			) : (
				<>
					{error ? (
						<p className="text-xs text-destructive" role="status">
							{error}
						</p>
					) : null}
					{entries.length === 0 && !error ? (
						<p className="text-xs text-muted-foreground">
							No Driveagent homes in this workspace. Add one at{" "}
							<code className="font-mono">
								.driveagent/&lt;slug&gt;/agent.yaml
							</code>
							.
						</p>
					) : null}
					{entries.length === 0 && error ? (
						<p className="text-xs text-muted-foreground">
							Could not load the agent directory from the hub.
						</p>
					) : null}
					{entries.length > 0 ? (
						<div className="grid gap-2 sm:grid-cols-2">
							{entries.map((entry) => (
								<AgentCard entry={entry} key={entry.profileId} />
							))}
						</div>
					) : null}
				</>
			)}
		</section>
	);
}
