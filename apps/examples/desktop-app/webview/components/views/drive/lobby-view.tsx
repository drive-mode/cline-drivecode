"use client";

/**
 * Lobby — the home for everything Drive adds on top of Cline.
 *
 * One page names the pieces together: the bound room and the one action
 * that follows from its state, the Status Hub at a glance, and the three
 * things Drive is (the call, the Spotlight, the Status Hub) with a way into
 * each. Everything shown comes from `useDriveHub()`; the Lobby's only extra
 * traffic is one bounded `call_get_room` probe, so "no room" and "the hub
 * did not answer" are told apart instead of both reading "Checking…".
 */

import type { StatusState, StatusSummary } from "@cline/shared";
import {
	Activity,
	ArrowRight,
	DoorOpen,
	Folder,
	Loader2,
	MonitorPlay,
	PhoneCall,
	SlidersHorizontal,
} from "lucide-react";
import {
	type ComponentType,
	type ReactNode,
	useCallback,
	useEffect,
	useState,
} from "react";
import { DriveMarkIcon } from "@/components/icons/drive-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandBadge, PageFrame } from "@/components/views/page-layout";
import { parseDriveCommandError } from "@/lib/drive/drive-client";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import { DRIVE_SECTIONS, type DriveSection } from "@/lib/drive/drive-section";
import { roomCardModel, roomRelativeTime } from "@/lib/drive/room-card-model";
import {
	projectRoomPreview,
	ROOM_LOOKUP_FOUND,
	ROOM_LOOKUP_PENDING,
	ROOM_LOOKUP_TIMED_OUT,
	ROOM_LOOKUP_TIMEOUT_MS,
	type RoomLookup,
	type RoomPreviewActionKind,
	roomLookupFromError,
} from "@/lib/drive/room-preview";
import { type DrivePhase, useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { RoomPreviewCard } from "./room-preview-card";

export type LobbyViewProps = {
	onNavigateSection: (section: DriveSection) => void;
};

const SNAPSHOT_STATES: readonly StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
];

const SNAPSHOT_STYLES: Record<StatusState, string> = {
	blocked: "text-amber-600 dark:text-amber-400",
	failed: "text-destructive",
	running: "text-primary",
	queued: "text-muted-foreground",
	done: "text-muted-foreground",
	cancelled: "text-muted-foreground",
};

/** Sections offered as deep links under the feature cards. */
const EXPLORE_SECTIONS: readonly DriveSection[] = [
	"rooms",
	"artifacts",
	"tasks",
	"analytics",
	"agents",
	"settings",
];

const LIVE_STACK_CAP = 3;
const CLOCK_TICK_MS = 30_000;

function hubHost(url: string | null): string | null {
	if (!url) {
		return null;
	}
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "demo:") {
			return "demo world";
		}
		return parsed.host || parsed.href;
	} catch {
		return url;
	}
}

function basename(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, "");
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || trimmed;
}

function PhaseBadge({
	phase,
	reconnecting,
	reduceMotion,
}: {
	phase: DrivePhase;
	reconnecting: boolean;
	reduceMotion: boolean;
}) {
	if (phase === "demo") {
		return (
			<Badge
				className="px-1.5 py-0 text-[10px] uppercase tracking-wide"
				variant="secondary"
			>
				Demo
			</Badge>
		);
	}
	if (phase === "live" && !reconnecting) {
		return (
			<Badge className="border-primary/40 text-primary" variant="outline">
				<span
					aria-hidden="true"
					className={cn(
						"size-1.5 rounded-full bg-primary",
						!reduceMotion && "motion-safe:animate-pulse",
					)}
				/>
				Live
			</Badge>
		);
	}
	if (phase === "unreachable") {
		return (
			<Badge
				className="border-destructive/40 text-destructive"
				variant="outline"
			>
				Unreachable
			</Badge>
		);
	}
	return (
		<Badge className="text-muted-foreground" variant="outline">
			<Loader2
				aria-hidden="true"
				className={cn("size-3", !reduceMotion && "motion-safe:animate-spin")}
			/>
			{reconnecting ? "Reconnecting" : "Connecting"}
		</Badge>
	);
}

function FeatureCard({
	icon: Icon,
	title,
	tagline,
	children,
	action,
}: {
	icon: ComponentType<{ className?: string }>;
	title: string;
	tagline: string;
	children: ReactNode;
	action: ReactNode;
}) {
	return (
		<section className="flex flex-col rounded-xl border bg-card p-5">
			<div className="mb-2 flex items-center gap-2">
				<Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
			</div>
			<p className="mb-3 text-sm font-medium text-foreground/80">{tagline}</p>
			<div className="flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
				{children}
			</div>
			<div className="mt-4">{action}</div>
		</section>
	);
}

function StatusSnapshotStrip({
	summary,
	phase,
	now,
	onOpen,
}: {
	summary: StatusSummary | null;
	phase: DrivePhase;
	now: number;
	onOpen: () => void;
}) {
	const blocked = summary?.byState.blocked ?? 0;
	let note: string;
	if (summary) {
		note =
			blocked > 0
				? `${blocked} blocked ${blocked === 1 ? "item needs" : "items need"} you`
				: summary.total > 0
					? "Nothing is blocked"
					: "No status updates yet";
	} else if (phase === "connecting") {
		note = "Waiting for the Status Hub…";
	} else {
		note = "Status Hub has not reported yet";
	}
	return (
		<button
			aria-label={`Open Status Hub — ${note}`}
			className={cn(
				"mb-6 flex w-full flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border bg-card px-5 py-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				blocked > 0 && "border-amber-500/40",
			)}
			onClick={onOpen}
			type="button"
		>
			{SNAPSHOT_STATES.map((state) => (
				<div className="min-w-16" key={state}>
					<div
						className={cn(
							"text-2xl font-semibold tabular-nums",
							summary ? SNAPSHOT_STYLES[state] : "text-muted-foreground/60",
						)}
					>
						{summary ? (summary.byState[state] ?? 0) : "–"}
					</div>
					<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
						{state}
					</div>
				</div>
			))}
			<div className="ml-auto flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
				<span className="truncate">{note}</span>
				{summary?.lastUpdatedAt ? (
					<span
						className="hidden shrink-0 text-xs text-muted-foreground/80 lg:inline"
						title={summary.lastUpdatedAt}
					>
						· {roomRelativeTime(summary.lastUpdatedAt, now)}
					</span>
				) : null}
				<ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
			</div>
		</button>
	);
}

export function LobbyView({ onNavigateSection }: LobbyViewProps) {
	const {
		phase,
		hub,
		source,
		room,
		roomId,
		humanParticipantId,
		rooms,
		statusSummary,
		refreshRoom,
		retry,
		join,
	} = useDriveHub();
	const [prefs, updatePrefs] = useDrivePrefs();
	const reduceMotion = prefs.reduceMotion;

	const [lookup, setLookup] = useState<RoomLookup>(ROOM_LOOKUP_PENDING);
	const [probeNonce, setProbeNonce] = useState(0);
	const [connectTimedOut, setConnectTimedOut] = useState(false);
	const [joining, setJoining] = useState(false);
	const [now, setNow] = useState(() => Date.now());

	const hasSnapshot = room.snapshot !== null;
	const hubAnswers = phase === "live" || phase === "demo";

	// Relative times ("updated 2m ago") drift; tick them without re-fetching.
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => window.clearInterval(timer);
	}, []);

	// A connect that never resolves must not read "Checking…" forever.
	useEffect(() => {
		if (phase !== "connecting") {
			setConnectTimedOut(false);
			return;
		}
		const timer = window.setTimeout(
			() => setConnectTimedOut(true),
			ROOM_LOOKUP_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [phase]);

	// One bounded probe: the provider's own refresh swallows `room_not_found`
	// (the next join creates the room), so the Lobby asks once itself to tell
	// "no room" from "no answer". Armed only while the fold is still empty.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Retry bumps probeNonce to re-arm the probe
	useEffect(() => {
		if (!hubAnswers) {
			setLookup(ROOM_LOOKUP_PENDING);
			return;
		}
		if (hasSnapshot) {
			setLookup(ROOM_LOOKUP_FOUND);
			return;
		}
		let cancelled = false;
		setLookup(ROOM_LOOKUP_PENDING);
		const timer = window.setTimeout(() => {
			if (!cancelled) {
				setLookup(ROOM_LOOKUP_TIMED_OUT);
			}
		}, ROOM_LOOKUP_TIMEOUT_MS);
		source
			.call("call_get_room", roomId)
			.then(() => {
				if (cancelled) {
					return;
				}
				window.clearTimeout(timer);
				setLookup(ROOM_LOOKUP_FOUND);
				void refreshRoom();
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				window.clearTimeout(timer);
				setLookup(roomLookupFromError(parseDriveCommandError(error)));
			});
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [hasSnapshot, hubAnswers, probeNonce, refreshRoom, roomId, source]);

	const preview = projectRoomPreview({
		phase,
		room,
		lookup: connectTimedOut ? ROOM_LOOKUP_TIMED_OUT : lookup,
		roomId,
		humanParticipantId,
	});

	const startOrJoin = useCallback(
		async (targetRoomId?: string) => {
			setJoining(true);
			try {
				const ok = await join(targetRoomId);
				if (ok) {
					onNavigateSection("call");
				}
			} finally {
				setJoining(false);
			}
		},
		[join, onNavigateSection],
	);

	const handleAction = useCallback(
		(kind: RoomPreviewActionKind) => {
			switch (kind) {
				case "retry":
					setConnectTimedOut(false);
					setProbeNonce((nonce) => nonce + 1);
					void retry();
					return;
				case "continue":
					onNavigateSection("call");
					return;
				case "start":
				case "join":
					void startOrJoin();
					return;
				default: {
					const _exhaustive: never = kind;
					return _exhaustive;
				}
			}
		},
		[onNavigateSection, retry, startOrJoin],
	);

	const otherLiveRooms = rooms
		.filter((entry) => entry.status === "live" && entry.roomId !== roomId)
		.slice(0, LIVE_STACK_CAP);

	const host = hubHost(hub.url);
	const workspace = hub.workspaceRoot ? basename(hub.workspaceRoot) : null;

	return (
		<PageFrame>
			<header className="mb-8 flex items-start justify-between gap-6 max-[860px]:flex-col max-[860px]:items-stretch">
				<div className="flex min-w-0 items-start gap-4">
					<div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
						<DriveMarkIcon className="size-8" />
					</div>
					<div className="min-w-0">
						<div className="flex min-w-0 flex-wrap items-center gap-3">
							<h1 className="truncate text-3xl font-semibold text-foreground">
								Drive
							</h1>
							<PhaseBadge
								phase={phase}
								reconnecting={hub.reconnecting}
								reduceMotion={reduceMotion}
							/>
							{host ? (
								<CommandBadge className="max-w-56 truncate">
									<span title={hub.url ?? undefined}>{host}</span>
								</CommandBadge>
							) : null}
							{workspace ? (
								<span
									className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
									title={hub.workspaceRoot ?? undefined}
								>
									<Folder aria-hidden="true" className="size-3.5 shrink-0" />
									<span className="truncate">{workspace}</span>
								</span>
							) : null}
						</div>
						<p className="mt-2 max-w-2xl text-base leading-6 text-muted-foreground">
							Stay on a call with an agent while it works. Watch what it is
							doing on the Spotlight, then steer when it matters.
						</p>
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2 max-[860px]:justify-start">
					<Button
						onClick={() => onNavigateSection("rooms")}
						size="sm"
						type="button"
						variant="outline"
					>
						<DoorOpen aria-hidden="true" className="size-3.5" />
						Rooms
					</Button>
					<Button
						onClick={() => onNavigateSection("settings")}
						size="sm"
						type="button"
						variant="ghost"
					>
						<SlidersHorizontal aria-hidden="true" className="size-3.5" />
						Drive Settings
					</Button>
				</div>
			</header>

			<RoomPreviewCard
				busy={joining}
				now={now}
				onAction={handleAction}
				onExploreDemo={
					phase === "demo" ? undefined : () => updatePrefs({ demoOptIn: true })
				}
				onOpenRooms={() => onNavigateSection("rooms")}
				preview={preview}
				reduceMotion={reduceMotion}
			/>

			{otherLiveRooms.length > 0 ? (
				<section
					aria-label="Other live rooms"
					className="mb-6 rounded-xl border border-primary/30 bg-card"
				>
					<div className="flex items-center justify-between border-b border-primary/20 px-4 py-2">
						<h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
							Also live
						</h2>
						<Button
							className="h-7 px-2 text-xs"
							onClick={() => onNavigateSection("rooms")}
							size="sm"
							type="button"
							variant="ghost"
						>
							All rooms
							<ArrowRight aria-hidden="true" className="size-3" />
						</Button>
					</div>
					<ul className="divide-y divide-border">
						{otherLiveRooms.map((entry) => {
							const card = roomCardModel(entry, { now });
							return (
								<li
									className="flex min-w-0 items-center gap-3 px-4 py-2.5"
									key={entry.roomId}
								>
									<span
										aria-hidden="true"
										className="size-2 shrink-0 rounded-full bg-primary"
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-semibold text-foreground">
											{card.roomId}
										</div>
										<p className="truncate text-xs text-muted-foreground">
											{card.meta}
										</p>
									</div>
									<Button
										disabled={joining}
										onClick={() => void startOrJoin(entry.roomId)}
										size="sm"
										type="button"
										variant="outline"
									>
										Join
									</Button>
								</li>
							);
						})}
					</ul>
				</section>
			) : null}

			<StatusSnapshotStrip
				now={now}
				onOpen={() => onNavigateSection("status")}
				phase={phase}
				summary={statusSummary}
			/>

			<div className="grid gap-4 md:grid-cols-3">
				<FeatureCard
					action={
						<Button
							disabled={!preview.action.enabled || joining}
							onClick={() => handleAction(preview.action.kind)}
							size="sm"
							type="button"
							variant="outline"
						>
							<PhoneCall aria-hidden="true" className="size-3.5" />
							{preview.action.kind === "retry"
								? "Check the room again"
								: preview.action.label}
						</Button>
					}
					icon={PhoneCall}
					tagline="Pair with an agent instead of prompting it."
					title="Drive Mode"
				>
					<p>
						A call room where you and one or more agents work together. The
						agent narrates decisions rather than keystrokes; you steer,
						interrupt, and raise a hand.
					</p>
					<p>
						Four sub-modes — <strong>plan</strong>, <strong>agent</strong>,{" "}
						<strong>ask</strong>, <strong>debug</strong> — map onto Cline's
						native plan/act.
					</p>
				</FeatureCard>

				<FeatureCard
					action={
						<Button
							onClick={() => onNavigateSection("call")}
							size="sm"
							type="button"
							variant="outline"
						>
							<MonitorPlay aria-hidden="true" className="size-3.5" />
							Open the Spotlight
						</Button>
					}
					icon={MonitorPlay}
					tagline="See who is sharing, and what."
					title="Spotlight"
				>
					<p>
						The shared surface inside a call. The agent puts its work on it —
						edits, commands, test results, plan steps — and you can take the
						Spotlight yourself to pin a selection, a file, or terminal output.
					</p>
					<p>
						Events, not pixels: everyone in the room renders the same event
						stream, so there is no screen capture to set up.
					</p>
				</FeatureCard>

				<FeatureCard
					action={
						<Button
							onClick={() => onNavigateSection("status")}
							size="sm"
							type="button"
							variant="outline"
						>
							<Activity aria-hidden="true" className="size-3.5" />
							Open Status Hub
						</Button>
					}
					icon={Activity}
					tagline="A changelog for every agent."
					title="Status Hub"
				>
					<p>
						Agents publish where they are as they work. The Board shows where
						everything stands, most urgent first; the Changelog shows everything
						that has happened.
					</p>
					<p>
						Urgent updates interrupt you; the rest wait to be found — so agents
						can report often without becoming noise.
					</p>
				</FeatureCard>
			</div>

			{statusSummary && statusSummary.byAgent.length > 0 ? (
				<section
					aria-labelledby="drive-lobby-agents"
					className="mt-6 rounded-xl border bg-card p-5"
				>
					<div className="mb-3 flex items-center justify-between gap-3">
						<h2
							className="text-base font-semibold text-foreground"
							id="drive-lobby-agents"
						>
							Agents reporting
						</h2>
						<span className="text-xs text-muted-foreground">
							{statusSummary.byAgent.length}{" "}
							{statusSummary.byAgent.length === 1 ? "agent" : "agents"} ·{" "}
							{statusSummary.total}{" "}
							{statusSummary.total === 1 ? "item" : "items"}
						</span>
					</div>
					<ul className="flex flex-wrap gap-2">
						{statusSummary.byAgent.map((agent) => {
							const name = agent.agentName ?? agent.agentId;
							return (
								<li key={agent.agentId}>
									<button
										aria-label={`Open Status Hub for ${name}`}
										className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
										onClick={() => onNavigateSection("status")}
										type="button"
									>
										<span className="font-medium text-foreground">{name}</span>
										<span className="text-xs text-muted-foreground">
											{agent.total} active
										</span>
										{agent.running > 0 ? (
											<Badge
												className="border-primary/40 text-[10px] text-primary"
												variant="outline"
											>
												{agent.running} running
											</Badge>
										) : null}
										{agent.blocked > 0 ? (
											<Badge
												className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400"
												variant="outline"
											>
												{agent.blocked} blocked
											</Badge>
										) : null}
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			) : null}

			<nav
				aria-label="Everything in Drive"
				className="mt-6 flex flex-wrap items-center gap-2"
			>
				<span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Everything in Drive
				</span>
				{DRIVE_SECTIONS.filter((section) =>
					EXPLORE_SECTIONS.includes(section.id),
				).map((section) => {
					const Icon = section.icon;
					return (
						<Button
							key={section.id}
							onClick={() => onNavigateSection(section.id)}
							className="h-7 px-2 text-xs"
							size="sm"
							title={section.description}
							type="button"
							variant="outline"
						>
							<Icon aria-hidden="true" className="size-3" />
							{section.label}
						</Button>
					);
				})}
			</nav>
		</PageFrame>
	);
}
