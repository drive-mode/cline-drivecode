"use client";

/**
 * The Agents directory (DRV-AGENT-PROFILE) and, behind a local selection,
 * one agent's profile page.
 *
 * Three sources fold into one row per durable identity: Driveagent homes
 * (`.driveagent/<slug>/`, prompt-stripped by the sidecar), the durable
 * appearance map, and the room snapshot for who is seated right now. The
 * fold is pure (`lib/drive/agent-directory.ts`); this file owns loading,
 * event-driven refresh, search, sort and the directory → profile switch.
 * Nothing here reads a prompt, tool list, provider, key or model id.
 */

import type { AgentProfile } from "@cline/shared";
import {
	ArrowUpDown,
	Bot,
	Hand,
	MicOff,
	RefreshCw,
	Search,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DriveMarkIcon } from "@/components/icons/drive-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	CommandBadge,
	PageEmptyState,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import {
	agentInitial,
	agentInkColor,
	useDriveInkTheme,
} from "@/lib/drive/agent-appearance";
import {
	AGENT_DIRECTORY_SORTS,
	type AgentDirectoryEntry,
	type AgentDirectorySort,
	type AgentHomeListing,
	buildAgentDirectory,
	filterAndSortAgentDirectory,
	parseAgentHomeListing,
	parseAgentProfiles,
	participantStatusLabel,
	relativeTimeLabel,
	runtimeBadgeLabel,
	seatSourceLabel,
} from "@/lib/drive/agent-directory";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { driveSectionDefinition } from "@/lib/drive/drive-section";
import { selectFeed } from "@/lib/drive/room-state";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { AgentProfile as AgentProfilePage } from "./agent-profile";

const CLINE_BUILTIN_REF_ID = "pair_partner";
const CLOCK_TICK_MS = 15_000;
const SKILLS_SHOWN = 4;

type LoadState = {
	loading: boolean;
	/** Set when both sources failed; the page has nothing to show. */
	error: string | null;
	/** Set when one source failed; the page shows what arrived. */
	notice: string | null;
};

function upsertProfiles(
	existing: readonly AgentProfile[],
	incoming: readonly AgentProfile[],
): AgentProfile[] {
	const byId = new Map(existing.map((profile) => [profile.id, profile]));
	for (const profile of incoming) {
		byId.set(profile.id, profile);
	}
	return [...byId.values()];
}

function isSortId(value: string): value is AgentDirectorySort {
	return AGENT_DIRECTORY_SORTS.some((sort) => sort.id === value);
}

function AgentCard({
	entry,
	now,
	onOpen,
}: {
	entry: AgentDirectoryEntry;
	now: string;
	onOpen: () => void;
}) {
	const theme = useDriveInkTheme();
	const color = agentInkColor({
		ink: entry.nameInk,
		channel: "name",
		profileId: entry.profileId,
		theme,
	});
	const isCline =
		entry.ref?.kind === "builtin" && entry.ref.id === CLINE_BUILTIN_REF_ID;
	const seat = entry.seat;
	const active = seat
		? seat.status === "speaking" || seat.status === "working"
		: false;
	const lastActive = relativeTimeLabel(entry.lastActiveAt, now);
	const hiddenSkills = Math.max(0, entry.skills.length - SKILLS_SHOWN);

	return (
		<button
			aria-label={`Open ${entry.displayName}`}
			className={cn(
				"flex h-full min-h-56 flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors outline-none",
				"hover:bg-surface-hover focus-visible:ring-[3px] focus-visible:ring-ring/50",
			)}
			data-agent-card={entry.profileId}
			onClick={onOpen}
			type="button"
		>
			<div className="flex items-start gap-3">
				<span
					aria-hidden="true"
					className="grid size-10 shrink-0 place-items-center rounded-full border border-current/40 bg-current/15 font-mono text-sm font-bold"
					style={{ color }}
				>
					{isCline ? (
						<DriveMarkIcon className="size-5" />
					) : (
						agentInitial(entry.displayName)
					)}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span
							className="truncate text-base font-semibold"
							style={{ color }}
						>
							{entry.displayName}
						</span>
						{entry.tier === "user" ? (
							<Badge className="shrink-0" variant="outline">
								user home
							</Badge>
						) : null}
					</div>
					<div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
						<span
							aria-hidden="true"
							className={cn(
								"size-1.5 shrink-0 rounded-full",
								!seat && "bg-border",
								seat && active && "bg-success-solid",
								seat && !active && "bg-muted-foreground",
							)}
						/>
						<span className="truncate">
							{seat
								? `${participantStatusLabel(seat.status)} · ${seat.role}`
								: "Not on the call"}
						</span>
						{seat?.muted ? (
							<MicOff
								aria-label="Muted"
								className="size-3 shrink-0"
								role="img"
							/>
						) : null}
						{seat?.handRaised ? (
							<Hand
								aria-label="Hand raised"
								className="size-3 shrink-0"
								role="img"
							/>
						) : null}
					</div>
				</div>
			</div>

			<p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
				{entry.description ??
					(entry.hasHome
						? "This home has no description yet."
						: seat
							? "Seated without a Driveagent home."
							: "No Driveagent home in this workspace.")}
			</p>

			<dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
				<dt className="text-muted-foreground">Runtime</dt>
				<dd className="truncate text-foreground">
					{runtimeBadgeLabel(entry.runtimeBadge)}
				</dd>
				<dt className="text-muted-foreground">Seat</dt>
				<dd className="truncate text-foreground">
					{seat ? seatSourceLabel(seat.seatSources) : "—"}
				</dd>
				<dt className="text-muted-foreground">Seen</dt>
				<dd className="truncate text-foreground">
					{lastActive ?? (seat ? "On the call, quiet" : "—")}
				</dd>
			</dl>

			<div className="mt-auto flex flex-wrap gap-1.5">
				{entry.titles.map((title) => (
					<Badge className="capitalize" key={title.grantId} variant="default">
						{title.title}
					</Badge>
				))}
				{entry.skills.slice(0, SKILLS_SHOWN).map((skill) => (
					<Badge
						className="font-mono text-[10px]"
						key={skill}
						variant="secondary"
					>
						{skill}
					</Badge>
				))}
				{hiddenSkills > 0 ? (
					<Badge className="text-[10px]" variant="outline">
						+{hiddenSkills}
					</Badge>
				) : null}
			</div>
		</button>
	);
}

function CardSkeleton() {
	return (
		<div className="flex min-h-56 flex-col gap-3 rounded-lg border border-border bg-card p-4">
			<div className="flex items-center gap-3">
				<Skeleton className="size-10 rounded-full" />
				<div className="flex-1 space-y-2">
					<Skeleton className="h-4 w-1/2" />
					<Skeleton className="h-3 w-1/3" />
				</div>
			</div>
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-12 w-3/4" />
		</div>
	);
}

export function AgentsView() {
	const { phase, hub, source, room } = useDriveHub();
	const definition = driveSectionDefinition("agents");
	const ready = phase === "live" || phase === "demo";

	const [homes, setHomes] = useState<AgentHomeListing[]>([]);
	const [profiles, setProfiles] = useState<AgentProfile[]>([]);
	const [load, setLoad] = useState<LoadState>({
		loading: true,
		error: null,
		notice: null,
	});
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<AgentDirectorySort>("seated");
	const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
		null,
	);
	const [now, setNow] = useState(() => new Date().toISOString());

	useEffect(() => {
		const timer = setInterval(
			() => setNow(new Date().toISOString()),
			CLOCK_TICK_MS,
		);
		return () => clearInterval(timer);
	}, []);

	// Only the newest reload may apply: a slower earlier pair must not replace
	// homes, profiles or the error flags with stale data.
	const reloadGeneration = useRef(0);
	const reload = useCallback(async () => {
		const generation = ++reloadGeneration.current;
		setLoad((previous) => ({ ...previous, loading: true }));
		const [homesResult, profilesResult] = await Promise.allSettled([
			source.agentHome("list"),
			source.agentProfiles("get"),
		]);
		if (generation !== reloadGeneration.current) {
			return;
		}
		const failures: string[] = [];
		if (homesResult.status === "fulfilled") {
			setHomes(parseAgentHomeListing(homesResult.value));
		} else {
			failures.push(
				`Homes: ${parseDriveCommandError(homesResult.reason).text}`,
			);
		}
		if (profilesResult.status === "fulfilled") {
			setProfiles(parseAgentProfiles(profilesResult.value));
		} else {
			failures.push(
				`Appearance: ${parseDriveCommandError(profilesResult.reason).text}`,
			);
		}
		setLoad({
			loading: false,
			error: failures.length === 2 ? failures.join(" · ") : null,
			notice: failures.length === 1 ? (failures[0] ?? null) : null,
		});
		setNow(new Date().toISOString());
	}, [source]);

	// Load once the hub answers, and again if it rebinds a workspace root.
	const loadKey = ready ? (hub.workspaceRoot ?? "") : null;
	useEffect(() => {
		if (loadKey === null) {
			return;
		}
		void reload();
	}, [loadKey, reload]);

	// Durable changes broadcast by the hub land without a manual refresh.
	useEffect(
		() =>
			source.subscribe((event) => {
				if (event.event === "drive.profile.changed") {
					const incoming = parseAgentProfiles(event.payload);
					if (incoming.length > 0) {
						setProfiles((previous) => upsertProfiles(previous, incoming));
					}
					return;
				}
				if (event.event === "drive.config.changed") {
					void source
						.agentProfiles("get")
						.then((reply) => setProfiles(parseAgentProfiles(reply)))
						.catch(() => {
							// A failed refresh keeps the last good map; the next
							// reload or broadcast corrects it.
						});
				}
			}),
		[source],
	);

	const feed = selectFeed(room);
	const directory = useMemo(
		() =>
			buildAgentDirectory({
				homes,
				profiles,
				snapshot: room.snapshot,
				feed,
				now,
			}),
		[feed, homes, now, profiles, room.snapshot],
	);
	const visible = useMemo(
		() => filterAndSortAgentDirectory(directory, query, sort),
		[directory, query, sort],
	);
	const seatedCount = directory.filter((entry) => entry.seat).length;
	const selected = selectedProfileId
		? (directory.find((entry) => entry.profileId === selectedProfileId) ?? null)
		: null;

	const onProfilesChanged = useCallback((incoming: readonly AgentProfile[]) => {
		setProfiles((previous) => upsertProfiles(previous, incoming));
	}, []);

	if (selected) {
		return (
			<PageFrame>
				<AgentProfilePage
					entry={selected}
					key={selected.profileId}
					now={now}
					onBack={() => setSelectedProfileId(null)}
					onProfilesChanged={onProfilesChanged}
					profiles={profiles}
				/>
			</PageFrame>
		);
	}

	const showSkeletons = !ready || (load.loading && directory.length === 0);

	return (
		<PageFrame>
			<PageHeader
				actions={
					<>
						<div className="relative w-56 max-[1200px]:w-40">
							<Search
								aria-hidden="true"
								className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 size-4 text-muted-foreground"
							/>
							<Input
								aria-label="Search agents"
								className="h-8 pl-8"
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search agents"
								value={query}
							/>
						</div>
						<Select
							onValueChange={(value) => {
								if (isSortId(value)) {
									setSort(value);
								}
							}}
							value={sort}
						>
							<SelectTrigger
								aria-label="Sort agents"
								className="h-8 min-w-36"
								size="sm"
							>
								<ArrowUpDown
									aria-hidden="true"
									className="size-3.5 text-muted-foreground"
								/>
								<SelectValue />
							</SelectTrigger>
							<SelectContent align="end">
								{AGENT_DIRECTORY_SORTS.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							aria-label="Refresh agents"
							className="h-8"
							disabled={!ready || load.loading}
							onClick={() => void reload()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								aria-hidden="true"
								className={cn("size-4", load.loading && "animate-spin")}
							/>
						</Button>
					</>
				}
				description={definition.description}
				icon={Bot}
				meta={
					directory.length > 0 ? (
						<CommandBadge className="whitespace-nowrap">
							{seatedCount} on the call · {directory.length} known
						</CommandBadge>
					) : null
				}
				title={definition.label}
			/>

			{load.notice ? (
				<div
					className="mb-4 flex items-center gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-text"
					role="status"
				>
					<TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">
						Part of the directory did not load. {load.notice}
					</span>
					<Button
						className="h-7"
						onClick={() => void reload()}
						size="xs"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}

			{showSkeletons ? (
				<div
					aria-busy="true"
					className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]"
					role="status"
				>
					<span className="sr-only">Loading agents</span>
					<CardSkeleton />
					<CardSkeleton />
					<CardSkeleton />
				</div>
			) : load.error ? (
				<PageEmptyState>
					<div className="flex items-start gap-3">
						<TriangleAlert
							aria-hidden="true"
							className="mt-0.5 size-4 shrink-0 text-destructive"
						/>
						<div className="min-w-0 flex-1">
							<p className="font-medium text-foreground">
								Could not load the agent directory from the hub.
							</p>
							<p className="mt-1 break-words">{load.error}</p>
							<Button
								className="mt-3"
								onClick={() => void reload()}
								size="sm"
								type="button"
								variant="outline"
							>
								<RefreshCw aria-hidden="true" className="size-3.5" />
								Try again
							</Button>
						</div>
					</div>
				</PageEmptyState>
			) : directory.length === 0 ? (
				<PageEmptyState>
					<p className="font-medium text-foreground">No agents yet.</p>
					<p className="mt-1">
						Add a Driveagent home at{" "}
						<code className="font-mono">
							.driveagent/&lt;slug&gt;/agent.yaml
						</code>{" "}
						in{" "}
						<code className="font-mono">
							{hub.workspaceRoot ?? "this workspace"}
						</code>
						, or start a call — seated agents appear here too.
					</p>
				</PageEmptyState>
			) : visible.length === 0 ? (
				<PageEmptyState>No agents match “{query.trim()}”.</PageEmptyState>
			) : (
				<div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
					{visible.map((entry) => (
						<AgentCard
							entry={entry}
							key={entry.profileId}
							now={now}
							onOpen={() => setSelectedProfileId(entry.profileId)}
						/>
					))}
				</div>
			)}

			<p className="mt-8 max-w-3xl text-xs leading-5 text-muted-foreground">
				Driveagents are homes under{" "}
				<code className="font-mono">.driveagent/</code> — configuration as code
				with a durable appearance and a profile page. Seating one commits room
				metadata; there is one Cline runtime behind the feed, so a profile
				configures identity, not execution.
			</p>
		</PageFrame>
	);
}
