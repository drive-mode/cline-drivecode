"use client";

/**
 * Call + Spotlight — the heart of Drive Mode on the desktop.
 *
 * Two panes: the Spotlight (stage, rail, deck) and a foldable drawer with the
 * roster and the room feed, under one call strip. Every control is a hub op
 * from `useDriveHub()` — the webview never keeps an authoritative copy of
 * room state; it renders the fold and asks the hub to change things.
 *
 * Works identically against the labeled demo world and the live hub: both
 * arrive through the same `DriveHubProvider`, and this view only reads
 * `phase` to label the room honestly.
 */

import type {
	AddressSet,
	DriveSubMode,
	Participant,
	StagePin,
	StageSharer,
} from "@cline/shared";
import { PanelRightOpen, PhoneOff, Radio, Unplug } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	buildParticipantInkMap,
	DRIVE_SCREEN_INK_THEME,
	useAgentInks,
	useDriveInkTheme,
} from "@/lib/drive/agent-ink";
import { useDrivePrefs } from "@/lib/drive/drive-prefs";
import type { DriveSection } from "@/lib/drive/drive-section";
import type { RoomFeedFilter } from "@/lib/drive/room-feed";
import {
	selectAgentParticipants,
	selectHumanParticipant,
	selectRoster,
	selectSpotlight,
} from "@/lib/drive/room-state";
import {
	buildHumanPinDefaults,
	grantsForAgent,
	nextSpotlightSharer,
	type PresenterAction,
	presenterActionFor,
} from "@/lib/drive/stage-cards";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";
import { CallStrip } from "./call-strip";
import { ParticipantSheet } from "./participant-sheet";
import { PresenterControls } from "./presenter-controls";
import { RoomFeed, useRoomFeed } from "./room-feed";
import { Roster, type RosterEntry, RosterRail } from "./roster";
import { Spotlight } from "./spotlight";
import "./drive.css";

export type CallViewProps = {
	onNavigateSection: (section: DriveSection) => void;
};

type ConfirmKind = "leave" | "end" | null;

const CLOCK_TICK_MS = 1_000;

function readSelectionText(): string | undefined {
	if (typeof window === "undefined" || !window.getSelection) {
		return undefined;
	}
	const text = window.getSelection()?.toString().trim();
	return text ? text : undefined;
}

function readNoSelection(): string | undefined {
	return undefined;
}

function subscribeSelection(listener: () => void): () => void {
	if (typeof document === "undefined") {
		return () => {};
	}
	document.addEventListener("selectionchange", listener);
	return () => document.removeEventListener("selectionchange", listener);
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
		return true;
	}
	return Boolean(target.closest("[role=dialog], [role=menu], [role=listbox]"));
}

/** Wall clock for elapsed time, relative ages and grant expiry. */
function useNowMs(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => clearInterval(timer);
	}, []);
	return now;
}

function OffCallNotice({
	ended,
	handoffNarration,
	phase,
	onJoin,
	busy,
}: {
	ended: boolean;
	handoffNarration: string | null;
	phase: "connecting" | "live" | "unreachable" | "demo";
	onJoin: () => void;
	busy: boolean;
}) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-3 border-b px-3 py-2 text-xs",
				ended
					? "border-error-border bg-error-surface text-foreground"
					: "border-border bg-secondary text-secondary-foreground",
			)}
			role="status"
		>
			{ended ? (
				<PhoneOff
					aria-hidden="true"
					className="size-4 shrink-0 text-error-text"
				/>
			) : (
				<Radio
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
			)}
			<div className="min-w-0 flex-1">
				<p className="font-medium">
					{ended ? "This call ended." : "You are watching, not on the call."}
				</p>
				<p className="truncate text-muted-foreground">
					{ended && handoffNarration
						? handoffNarration
						: ended
							? "The room closed with a handoff. Rejoin to open it again."
							: "Controls unlock once you take a seat. The room keeps working meanwhile."}
				</p>
			</div>
			<Button
				className="h-7 shrink-0"
				disabled={busy || phase === "connecting"}
				onClick={onJoin}
				size="xs"
				type="button"
			>
				{ended ? "Rejoin" : "Join call"}
			</Button>
		</div>
	);
}

function ConnectingSkeleton() {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 p-3" aria-busy="true">
			<Skeleton className="h-7 w-64" />
			<Skeleton className="min-h-[320px] flex-1 rounded-lg" />
			<div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
				<Skeleton className="h-24" />
			</div>
		</div>
	);
}

export function CallView({ onNavigateSection }: CallViewProps) {
	const hub = useDriveHub();
	const {
		phase,
		source,
		room,
		roomId,
		callLive,
		humanParticipantId,
		join,
		leave,
		end,
		setMode,
		setAddress,
		setStage,
		raiseHand,
		mute,
		presenter,
	} = hub;
	const [prefs, updatePrefs] = useDrivePrefs();
	const nowMs = useNowMs();
	const nowIso = useMemo(() => new Date(nowMs).toISOString(), [nowMs]);
	const inkTheme = useDriveInkTheme();
	const storedInks = useAgentInks(source);

	const snapshot = room.snapshot;
	const participants = useMemo(() => selectRoster(room), [room]);
	const agents = useMemo(() => selectAgentParticipants(room), [room]);
	const human = useMemo(() => selectHumanParticipant(room), [room]);
	const humanId = human?.id ?? humanParticipantId;
	const spotlight = useMemo(
		() => selectSpotlight(room, nowIso),
		[room, nowIso],
	);
	const feedItems = useRoomFeed(source, room, participants);

	const inkById = useMemo(
		() => buildParticipantInkMap(participants, storedInks, inkTheme),
		[inkTheme, participants, storedInks],
	);
	const screenInkById = useMemo(
		() =>
			buildParticipantInkMap(participants, storedInks, DRIVE_SCREEN_INK_THEME),
		[participants, storedInks],
	);

	// ── local UI state ──────────────────────────────────────────────────
	const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
	const [sheetParticipantId, setSheetParticipantId] = useState<string | null>(
		null,
	);
	const [feedFilter, setFeedFilter] = useState<RoomFeedFilter>("all");
	const [feedFocusId, setFeedFocusId] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<ConfirmKind>(null);
	const [legendOpen, setLegendOpen] = useState(false);
	const [dismissedAwayNote, setDismissedAwayNote] = useState<string | null>(
		null,
	);

	const run = useCallback(
		async (key: string, op: () => Promise<boolean>): Promise<boolean> => {
			setBusy((previous) => new Set(previous).add(key));
			try {
				return await op();
			} finally {
				setBusy((previous) => {
					const next = new Set(previous);
					next.delete(key);
					return next;
				});
			}
		},
		[],
	);

	// ── derived ──────────────────────────────────────────────────────────
	const muted = snapshot?.muteByParticipantId[humanId] === true;
	const handRaised = snapshot?.raisedHandByParticipantId[humanId] === true;
	const presenterGrant = spotlight.presenterGrant;
	const presenterHolder = presenterGrant
		? (participants.find((p) => p.id === presenterGrant.agentId) ?? null)
		: null;
	const nextSharer = useMemo(
		() =>
			nextSpotlightSharer({
				sharer: spotlight.sharer,
				humanId: human ? humanId : null,
				agents,
				presenterAgentId: presenterGrant?.agentId ?? null,
			}),
		[agents, human, humanId, presenterGrant?.agentId, spotlight.sharer],
	);
	const nextSharerLabel = nextSharer
		? nextSharer.kind === "human"
			? "you"
			: (participants.find((p) => p.id === nextSharer.participantId)
					?.displayName ?? nextSharer.participantId)
		: null;
	// The selection is read live, not once per card change: a pin sent after a
	// later highlight must carry that highlight, and the menu label must show it.
	const selectionText = useSyncExternalStore(
		subscribeSelection,
		readSelectionText,
		readNoSelection,
	);
	const pinDefaults = useMemo(
		() => buildHumanPinDefaults(spotlight.cards, selectionText),
		[selectionText, spotlight.cards],
	);
	const elapsedMs = snapshot
		? Math.max(0, nowMs - Date.parse(snapshot.createdAt))
		: null;
	const latestBeat = room.beats[room.beats.length - 1] ?? null;
	const narration =
		latestBeat?.say?.trim() || room.presentedShow?.caption?.trim() || null;
	const narrationKey = latestBeat
		? `${latestBeat.beatId}:${latestBeat.at}`
		: (room.presentedShow?.showItemId ?? "none");
	const activeShowId =
		room.live?.director.activeShowId ?? room.presentedShow?.showItemId ?? null;
	const whileAwayNote =
		room.whileAwayNote && room.whileAwayNote !== dismissedAwayNote
			? room.whileAwayNote
			: null;

	const rosterEntries = useMemo<RosterEntry[]>(
		() =>
			participants.map((participant) => ({
				participant,
				ink: inkById[participant.id] ?? null,
				muted: snapshot?.muteByParticipantId[participant.id] === true,
				handRaised:
					snapshot?.raisedHandByParticipantId[participant.id] === true,
				sharing: spotlight.sharer?.participantId === participant.id,
				presenter: presenterGrant?.agentId === participant.id,
				isYou: participant.id === humanId,
			})),
		[
			humanId,
			inkById,
			participants,
			presenterGrant?.agentId,
			snapshot,
			spotlight.sharer,
		],
	);

	const sheetParticipant = sheetParticipantId
		? (participants.find((p) => p.id === sheetParticipantId) ?? null)
		: null;

	// ── actions (all hub ops) ─────────────────────────────────────────
	const onToggleMute = useCallback(
		() => void run("mute", () => mute(!muted)),
		[mute, muted, run],
	);
	const onToggleHand = useCallback(
		() => void run("hand", () => raiseHand(!handRaised)),
		[handRaised, raiseHand, run],
	);
	const onMoveSpotlight = useCallback(() => {
		if (!nextSharer) {
			return;
		}
		const pin = nextSharer.kind === "agent" ? null : undefined;
		void run("stage", () => setStage(nextSharer, pin));
	}, [nextSharer, run, setStage]);
	const onMoveSpotlightTo = useCallback(
		(participant: Participant) => {
			const sharer: StageSharer = {
				kind: participant.kind,
				participantId: participant.id,
			};
			void run("stage", () =>
				setStage(sharer, participant.kind === "agent" ? null : undefined),
			);
		},
		[run, setStage],
	);
	const onSharePin = useCallback(
		(pin: StagePin) =>
			void run("stage", () =>
				setStage({ kind: "human", participantId: humanId }, pin),
			),
		[humanId, run, setStage],
	);
	const onSetMode = useCallback(
		(mode: DriveSubMode) => void run("mode", () => setMode(mode)),
		[run, setMode],
	);
	const onSetAddress = useCallback(
		(addressSet: AddressSet) =>
			void run("address", () => setAddress(addressSet)),
		[run, setAddress],
	);
	const onJoin = useCallback(
		() => void run("join", () => join(roomId)),
		[join, roomId, run],
	);
	const onPresenterAction = useCallback(
		(action: PresenterAction, agentId: string) => {
			void run("presenter", () => {
				switch (action) {
					case "grant":
						return presenter.grant(agentId);
					case "transfer":
						return presenter.transfer(agentId);
					case "revoke":
						return presenter.revoke();
					default: {
						const _exhaustive: never = action;
						return _exhaustive;
					}
				}
			});
		},
		[presenter, run],
	);
	const toggleFeed = useCallback(
		() =>
			updatePrefs((previous) => ({ feedCollapsed: !previous.feedCollapsed })),
		[updatePrefs],
	);
	const toggleStageLayout = useCallback(
		() =>
			updatePrefs((previous) => ({
				stageLayout: previous.stageLayout === "split" ? "spotlight" : "split",
			})),
		[updatePrefs],
	);

	// ── keyboard shortcuts ───────────────────────────────────────────
	const shortcutsRef = useRef({
		onToggleMute,
		onToggleHand,
		onMoveSpotlight,
		callLive,
		feedCollapsed: prefs.feedCollapsed,
	});
	shortcutsRef.current = {
		onToggleMute,
		onToggleHand,
		onMoveSpotlight,
		callLive,
		feedCollapsed: prefs.feedCollapsed,
	};
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
				return;
			}
			if (isTypingTarget(event.target)) {
				return;
			}
			const current = shortcutsRef.current;
			switch (event.key) {
				case "m":
				case "M":
					if (current.callLive) {
						event.preventDefault();
						current.onToggleMute();
					}
					return;
				case "h":
				case "H":
					if (current.callLive) {
						event.preventDefault();
						current.onToggleHand();
					}
					return;
				case "s":
				case "S":
					if (current.callLive) {
						event.preventDefault();
						current.onMoveSpotlight();
					}
					return;
				case "[":
					if (!current.feedCollapsed) {
						event.preventDefault();
						updatePrefs({ feedCollapsed: true });
					}
					return;
				case "]":
					if (current.feedCollapsed) {
						event.preventDefault();
						updatePrefs({ feedCollapsed: false });
					}
					return;
				case "?":
					event.preventDefault();
					setLegendOpen((open) => !open);
					return;
				default:
					return;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [updatePrefs]);

	// ── render ──────────────────────────────────────────────────────
	const presenterControls: ReactNode = (
		<PresenterControls
			agents={agents}
			busy={busy.has("presenter")}
			compact
			disabled={!callLive}
			grant={presenterGrant}
			inkById={inkById}
			nowMs={nowMs}
			onGrant={(agentId) => onPresenterAction("grant", agentId)}
			onRevoke={() =>
				onPresenterAction("revoke", presenterGrant?.agentId ?? "")
			}
			onTransfer={(agentId) => onPresenterAction("transfer", agentId)}
		/>
	);

	const drawer = prefs.feedCollapsed ? null : (
		<div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
			<Roster
				className="shrink-0 border-b border-border"
				entries={rosterEntries}
				onSelect={setSheetParticipantId}
				selectedId={sheetParticipantId}
			/>
			<RoomFeed
				callLive={callLive}
				filter={feedFilter}
				focusParticipantId={feedFocusId}
				inkById={inkById}
				items={feedItems}
				onClearFocus={() => setFeedFocusId(null)}
				onDismissWhileAway={() => setDismissedAwayNote(room.whileAwayNote)}
				onFilterChange={setFeedFilter}
				onOpenParticipant={setSheetParticipantId}
				participants={participants}
				whileAwayNote={whileAwayNote}
			/>
		</div>
	);

	let body: ReactNode;
	if (!snapshot && phase === "connecting") {
		body = <ConnectingSkeleton />;
	} else if (!snapshot) {
		body = (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6">
				<Empty className="max-w-lg border border-dashed border-border bg-card">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							{phase === "unreachable" ? (
								<Unplug aria-hidden="true" />
							) : (
								<Radio aria-hidden="true" />
							)}
						</EmptyMedia>
						<EmptyTitle>No room open yet</EmptyTitle>
						<EmptyDescription>
							{phase === "unreachable"
								? "The hub is not answering, so there is nothing to show. Retry from the banner above."
								: `Starting a call opens room “${roomId}” on the hub, seats you and your partner, and turns the Spotlight on.`}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<div className="flex flex-wrap items-center justify-center gap-2">
							<Button
								disabled={busy.has("join") || phase === "unreachable"}
								onClick={onJoin}
								type="button"
							>
								<Radio aria-hidden="true" className="size-4" />
								Start a call
							</Button>
							<Button
								onClick={() => onNavigateSection("lobby")}
								type="button"
								variant="outline"
							>
								Back to Lobby
							</Button>
						</div>
					</EmptyContent>
				</Empty>
			</div>
		);
	} else {
		body = (
			<div className="flex min-h-0 flex-1">
				<ResizablePanelGroup
					autoSaveId="cline.code.drive.call.panes"
					className="min-h-0 flex-1"
					direction="horizontal"
				>
					<ResizablePanel
						className="flex min-h-0 min-w-0 flex-col"
						defaultSize={66}
						id="spotlight"
						minSize={48}
						order={1}
					>
						{!callLive ? (
							<OffCallNotice
								busy={busy.has("join")}
								ended={room.ended}
								handoffNarration={room.handoffNarration}
								onJoin={onJoin}
								phase={phase}
							/>
						) : null}
						<Spotlight
							activeShowId={activeShowId}
							callLive={callLive}
							captionsOn={prefs.voice.captions}
							feedCollapsed={prefs.feedCollapsed}
							humanId={humanId}
							inkById={inkById}
							narration={narration}
							narrationKey={narrationKey}
							nowMs={nowMs}
							onOpenParticipant={setSheetParticipantId}
							onToggleFeed={toggleFeed}
							onToggleStageLayout={toggleStageLayout}
							participants={participants}
							phase={phase}
							presentedShow={room.presentedShow}
							presenterControls={presenterControls}
							screenInkById={screenInkById}
							selection={spotlight}
							showBacklog={room.showBacklog}
							stageLayout={prefs.stageLayout}
						/>
					</ResizablePanel>
					{drawer ? (
						<>
							<ResizableHandle
								aria-label="Resize the roster and feed drawer"
								withHandle
							/>
							<ResizablePanel
								className="min-h-0 min-w-0"
								defaultSize={34}
								id="drawer"
								maxSize={48}
								minSize={22}
								order={2}
							>
								{drawer}
							</ResizablePanel>
						</>
					) : null}
				</ResizablePanelGroup>
				{prefs.feedCollapsed ? (
					<aside
						aria-label="Folded roster"
						className="flex w-12 shrink-0 flex-col items-center gap-2 border-l border-border bg-sidebar py-2"
					>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									aria-label="Unfold roster and feed"
									className="size-8"
									onClick={toggleFeed}
									size="icon"
									type="button"
									variant="ghost"
								>
									<PanelRightOpen aria-hidden="true" className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="left">
								Unfold roster and feed
							</TooltipContent>
						</Tooltip>
						<RosterRail
							entries={rosterEntries}
							onSelect={setSheetParticipantId}
							selectedId={sheetParticipantId}
						/>
					</aside>
				) : null}
			</div>
		);
	}

	return (
		<div
			className="@container flex h-full min-h-0 flex-1 flex-col"
			data-drive-reduce-motion={prefs.reduceMotion ? "true" : "false"}
			data-slot="drive-call"
		>
			<CallStrip
				addressSet={snapshot?.addressSet ?? { mode: "everyone" }}
				busy={busy}
				callLive={callLive}
				elapsedMs={elapsedMs}
				ended={room.ended}
				feedCollapsed={prefs.feedCollapsed}
				handRaised={handRaised}
				legendOpen={legendOpen}
				muted={muted}
				nextSharerLabel={nextSharerLabel}
				onEnd={() => setConfirm("end")}
				onJoin={onJoin}
				onLeave={() => setConfirm("leave")}
				onLegendOpenChange={setLegendOpen}
				onMoveSpotlight={onMoveSpotlight}
				onSetAddress={onSetAddress}
				onSetMode={onSetMode}
				onSharePin={onSharePin}
				onToggleFeed={toggleFeed}
				onToggleHand={onToggleHand}
				onToggleMute={onToggleMute}
				participants={participants}
				phase={phase}
				pinDefaults={pinDefaults}
				roomId={room.roomId ?? roomId}
				seq={room.seq}
				subMode={snapshot?.subMode ?? "act"}
			/>
			{body}

			<ParticipantSheet
				busy={busy}
				callLive={callLive}
				grants={
					sheetParticipant
						? grantsForAgent(snapshot?.titleGrantsById, sheetParticipant.id)
						: []
				}
				handRaised={
					sheetParticipant
						? snapshot?.raisedHandByParticipantId[sheetParticipant.id] === true
						: false
				}
				ink={sheetParticipant ? (inkById[sheetParticipant.id] ?? null) : null}
				isYou={sheetParticipant?.id === humanId}
				muted={
					sheetParticipant
						? snapshot?.muteByParticipantId[sheetParticipant.id] === true
						: false
				}
				nowMs={nowMs}
				onFocusFeed={(participantId) => {
					setFeedFocusId(participantId);
					setFeedFilter("all");
					if (prefs.feedCollapsed) {
						updatePrefs({ feedCollapsed: false });
					}
				}}
				onMoveSpotlightHere={onMoveSpotlightTo}
				onOpenChange={(open) => {
					if (!open) {
						setSheetParticipantId(null);
					}
				}}
				onPresenterAction={(action, agentId) => {
					onPresenterAction(action, agentId);
					setSheetParticipantId(null);
				}}
				onSharePin={onSharePin}
				onToggleMute={(participantId, nextMuted) =>
					void run("mute", () => mute(nextMuted, participantId))
				}
				open={sheetParticipant !== null}
				participant={sheetParticipant}
				pinDefaults={pinDefaults}
				presenterAction={
					sheetParticipant?.kind === "agent"
						? presenterActionFor(sheetParticipant.id, presenterGrant)
						: null
				}
				presenterHolderName={presenterHolder?.displayName ?? null}
				runtimeBadge={
					sheetParticipant
						? (snapshot?.profilesByParticipantId[sheetParticipant.id]
								?.runtimeBadge ?? null)
						: null
				}
				sharing={
					sheetParticipant
						? spotlight.sharer?.participantId === sheetParticipant.id
						: false
				}
			/>

			<AlertDialog
				onOpenChange={(open) => {
					if (!open) {
						setConfirm(null);
					}
				}}
				open={confirm !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirm === "end"
								? "End the call for everyone?"
								: "Leave the call?"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm === "end"
								? "The room closes with a handoff summary from your partner. Agents stop presenting; the log and artifacts are kept."
								: "The room keeps running without you and your agents keep working. Rejoin anytime to catch up on what you missed."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Stay</AlertDialogCancel>
						<AlertDialogAction
							className={cn(
								confirm === "end" &&
									"bg-destructive text-white hover:bg-destructive/90",
							)}
							onClick={() => {
								const kind = confirm;
								setConfirm(null);
								if (kind === "end") {
									void run("end", () => end());
								} else if (kind === "leave") {
									void run("leave", () => leave());
								}
							}}
						>
							{confirm === "end" ? "End call" : "Leave"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
