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

import type { AgentRef, InkRef } from "@cline/shared";
import { agentProfileId } from "@cline/shared";
import { useEffect, useState } from "react";
import { ClineMarkIcon } from "@/components/icons/cline-mark";
import { Badge } from "@/components/ui/badge";
import { resolveChannelInk, useDriveInkTheme } from "./agentInk";
import { CLINE_BUILTIN_REF_ID } from "./agentMark";
import { agentProfilePath } from "./agentProfileRoute";
import { requestDriveAgentProfiles } from "./requestDriveAgentProfiles";
import {
	type DriveagentHomeListing,
	requestDriveagentHomeList,
} from "./requestDriveagentHome";

type DirectoryEntry = {
	profileId: string;
	ref: AgentRef;
	displayName: string;
	description?: string;
	tier?: "workspace" | "user";
	skills?: string[];
	nameInk: InkRef | null;
};

function titleCase(slug: string): string {
	return slug
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}

/**
 * Fold the two durable sources into one list.
 *
 * Homes come first because a home is the richer record; a durably-styled agent
 * with no home is still listed, since someone deliberately gave it a colour and
 * it would be strange for the page that stores that to pretend it does not
 * exist.
 */
export function buildDirectoryEntries(
	homes: readonly DriveagentHomeListing[],
	profiles: readonly {
		id: string;
		ref: AgentRef;
		displayName?: string;
		nameInk: InkRef;
	}[],
): DirectoryEntry[] {
	const byId = new Map<string, DirectoryEntry>();
	for (const home of homes) {
		const ref: AgentRef = { kind: "driveagent", slug: home.slug };
		const id = agentProfileId(ref);
		byId.set(id, {
			profileId: id,
			ref,
			displayName: home.displayName?.trim() || titleCase(home.slug),
			...(home.description ? { description: home.description } : {}),
			tier: home.tier,
			...(home.skills?.length ? { skills: home.skills } : {}),
			nameInk: null,
		});
	}
	for (const profile of profiles) {
		const existing = byId.get(profile.id);
		if (existing) {
			existing.nameInk = profile.nameInk;
			if (profile.displayName?.trim()) {
				existing.displayName = profile.displayName.trim();
			}
			continue;
		}
		byId.set(profile.id, {
			profileId: profile.id,
			ref: profile.ref,
			displayName:
				profile.displayName?.trim() ||
				titleCase(
					profile.ref.kind === "driveagent" ? profile.ref.slug : profile.ref.id,
				),
			nameInk: profile.nameInk,
		});
	}
	return [...byId.values()].sort((a, b) =>
		a.displayName.localeCompare(b.displayName),
	);
}

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
		void Promise.all([
			requestDriveagentHomeList(root).catch(
				() => [] as DriveagentHomeListing[],
			),
			requestDriveAgentProfiles(root).catch(() => []),
		])
			.then(([homes, profiles]) => {
				if (!cancelled) {
					setEntries(buildDirectoryEntries(homes, profiles));
				}
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setError(cause instanceof Error ? cause.message : String(cause));
					setEntries([]);
				}
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
			) : error ? (
				<p className="text-xs text-destructive">{error}</p>
			) : entries.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No Driveagent homes in this workspace. Add one at{" "}
					<code className="font-mono">.driveagent/&lt;slug&gt;/agent.yaml</code>
					.
				</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{entries.map((entry) => (
						<AgentCard entry={entry} key={entry.profileId} />
					))}
				</div>
			)}
		</section>
	);
}
