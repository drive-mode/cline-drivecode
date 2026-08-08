/**
 * Drive — the home for everything this fork adds on top of Cline.
 *
 * Drive Mode, Spotlight, and the Status Hub were previously reachable only from
 * scattered entry points (a button inside Chat, a nav item next to upstream
 * ones), which made the additions easy to miss. This page is the one surface
 * that names them together.
 */

import type { StatusState, StatusSummary } from "@cline/shared";
import {
	ActivityIcon,
	ArrowRightIcon,
	MonitorPlayIcon,
	PhoneIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CredentialOnboardingBanner } from "../../drive/CredentialOnboardingBanner";
import {
	type CredentialCatalogProvider,
	isLlmProviderConfigured,
	readCredentialOnboardingDismissed,
	shouldShowCredentialOnboardingBanner,
	writeCredentialOnboardingDismissed,
} from "../../drive/credentialOnboarding";
import {
	consumeLeaveKeepRunningNote,
	PREVIEW_CHIP_LABEL,
	shouldShowPreviewChip,
} from "../../drive/driveAppCallChrome";
import type { DriveOpenCallRequest } from "../../drive/driveLaunch";
import {
	applyDriveRoomPreviewMessage,
	DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE,
	type DriveRoomPreview,
	type DriveRoomPreviewState,
	driveRoomOpenIntent,
	EMPTY_DRIVE_ROOM_PREVIEW,
	isDriveRoomNotFoundMessage,
	isDriveTransportErrorMessage,
} from "../../drive/driveRoomPreview";
import { DRIVE_DEFAULT_ROOM_ID } from "../../drive/types";
import { readDrivecodeDemoHubBootstrap } from "@cline/drivecode-demo";
import {
	type HostMessage,
	subscribeToHostMessages,
} from "../../lib/host-message-gateway";
import { postToHost } from "../../vscode";
import { DriveMarkIcon } from "../icons/drive-mark";
import {
	DriveBrowseLiteIndex,
	DriveBrowseLitePage,
} from "../../drive/DriveBrowseLite";
import { DriveLiveStack } from "../../drive/DriveLiveStack";
import type { DriveBrowseSurface } from "../../lib/drive-shell";
import type { DriveRoomsSource } from "../../rooms/drive-rooms-source";
import {
	DRIVE_VIEW_MESSAGE_TYPES,
	isDriveViewHostMessage,
} from "./drive-view-messages";
import { PageFrame, PageHeader } from "./page-layout";

const SNAPSHOT_STATES: readonly StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
];

/** Room-lookup wait budget before treating the hub as unreachable — matches
 * other hub round-trip timeouts in this app (bankSession.ts,
 * requestDriveagentHome.ts both use 3s). */
const ROOM_LOOKUP_TIMEOUT_MS = 3_000;

/** Type-predicate wrapper so the transport `error` message can be routed
 * through `subscribeToHostMessages`. */
function isTransportErrorHostMessage(
	message: HostMessage,
): message is HostMessage & { type: "error" } {
	return isDriveTransportErrorMessage(message);
}

const SNAPSHOT_STYLES: Record<string, string> = {
	blocked: "text-amber-600 dark:text-amber-400",
	failed: "text-destructive",
	running: "text-primary",
	queued: "text-muted-foreground",
};

const ROOM_ACTION_LABELS: Record<DriveRoomPreviewState, string> = {
	empty: "Turn on Drive",
	available: "Join call",
	seated: "Return to call",
};

/** MC1 consumer home — Join / Continue only (mobile-consumer). */
const APP_ROOM_ACTION_LABELS: Record<DriveRoomPreviewState, string> = {
	empty: "Join",
	available: "Join",
	seated: "Continue",
};

const ROOM_STATE_COPY: Record<
	DriveRoomPreviewState,
	{ badge: string; title: string; description: string }
> = {
	empty: {
		badge: "Off",
		title: "Pairing room",
		description:
			"Turn on Drive to pair with an agent while you watch and steer the work.",
	},
	available: {
		badge: "Ready",
		title: "Pairing room",
		description:
			"Join the call to pick up the room roster, working mode, and Spotlight.",
	},
	seated: {
		badge: "On the call",
		title: "Pairing room",
		description:
			"You are on the call. Return to Drive to watch the agent and steer.",
	},
};

const SUBMODE_LABELS: Record<DriveRoomPreview["subMode"], string> = {
	plan: "Plan",
	act: "Agent",
	ask: "Ask",
	debug: "Debug",
};

const PARTICIPANT_STATUS_LABELS: Record<
	DriveRoomPreview["roster"][number]["status"],
	string
> = {
	idle: "Idle",
	working: "Working",
	speaking: "Speaking",
	away: "Away",
};

function FeatureCard({
	icon: Icon,
	title,
	tagline,
	children,
	action,
}: {
	icon: typeof PhoneIcon;
	title: string;
	tagline: string;
	children: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<section className="flex flex-col rounded-lg border bg-card p-5">
			<div className="mb-2 flex items-center gap-2">
				<Icon className="size-4 shrink-0 text-primary" />
				<h2 className="text-base font-semibold text-foreground">{title}</h2>
			</div>
			<p className="mb-3 text-sm font-medium text-foreground/80">{tagline}</p>
			<div className="flex-1 space-y-2 text-sm leading-6 text-muted-foreground">
				{children}
			</div>
			{action ? <div className="mt-4">{action}</div> : null}
		</section>
	);
}

function RoomPreviewCard({
	composition = "hub",
	lookupError,
	preview,
	onOpenCall,
	onRetry,
}: {
	composition?: "hub" | "app";
	lookupError: string | null;
	preview: DriveRoomPreview | null;
	onOpenCall: (request: DriveOpenCallRequest) => void;
	onRetry: () => void;
}) {
	const copy = preview ? ROOM_STATE_COPY[preview.state] : null;
	const actionIntent = preview ? driveRoomOpenIntent(preview.state) : null;
	const showRoomDetails =
		composition === "hub" && preview !== null && preview.state !== "empty";
	const actionLabels =
		composition === "app" ? APP_ROOM_ACTION_LABELS : ROOM_ACTION_LABELS;

	return (
		<section
			className={cn(
				"mb-6 rounded-lg border bg-card p-5",
				preview?.state === "seated" && "border-primary/40",
			)}
			data-slot={composition === "app" ? "drive-app-home" : "drive-room-preview"}
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<PhoneIcon className="size-4" />
					</div>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-base font-semibold text-foreground">
								{copy?.title ?? "Pairing room"}
							</h2>
							<Badge
								className={cn(
									preview?.state === "seated" &&
										"border-primary/40 text-primary",
								)}
								variant={preview?.state === "seated" ? "outline" : "secondary"}
							>
								{lookupError ? "Unavailable" : (copy?.badge ?? "Checking")}
							</Badge>
						</div>
						<p
							aria-atomic="true"
							aria-live="polite"
							className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground"
							role="status"
						>
							{lookupError ??
								copy?.description ??
								"Checking the Pairing room with the hub."}
						</p>
					</div>
				</div>
				<Button
					disabled={!actionIntent && !lookupError}
					onClick={() => {
						if (lookupError) {
							onRetry();
						} else if (actionIntent && preview) {
							onOpenCall({
								action: actionIntent,
								roomId: preview.roomId,
							});
						}
					}}
					type="button"
				>
					<PhoneIcon className="size-3.5" />
					{lookupError
						? "Retry"
						: preview
							? actionLabels[preview.state]
							: "Checking…"}
				</Button>
			</div>

			{showRoomDetails ? (
				<div className="mt-5 grid gap-3 sm:grid-cols-3">
					<div className="rounded-md border bg-background/50 px-3 py-2.5">
						<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							Roster
						</div>
						<div className="mt-2 flex min-h-5 flex-wrap gap-1.5">
							{preview.roster.length > 0 ? (
								preview.roster.map((participant) => (
									<Badge key={participant.id} variant="outline">
										{participant.displayName}
										<span className="ml-1.5 text-muted-foreground">
											{PARTICIPANT_STATUS_LABELS[participant.status]}
										</span>
									</Badge>
								))
							) : (
								<span className="text-sm text-muted-foreground">
									No one seated
								</span>
							)}
						</div>
					</div>
					<div className="rounded-md border bg-background/50 px-3 py-2.5">
						<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							Spotlight
						</div>
						<div className="mt-2 text-sm font-medium text-foreground">
							{preview.spotlightOwner?.displayName ?? "No one sharing"}
						</div>
						<div className="mt-0.5 text-xs text-muted-foreground">
							{preview.cardCount} {preview.cardCount === 1 ? "card" : "cards"}
						</div>
					</div>
					<div className="rounded-md border bg-background/50 px-3 py-2.5">
						<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
							Working state
						</div>
						<div className="mt-2 text-sm font-medium text-foreground">
							{SUBMODE_LABELS[preview.subMode]}
						</div>
					</div>
				</div>
			) : null}
		</section>
	);
}

export function DriveView({
	browse,
	composition = "hub",
	onBrowse,
	onOpenCall,
	onOpenDemo,
	onOpenHistory,
	onOpenProviders,
	onOpenStatus,
	roomsSource,
	workspaceRoot,
}: {
	/** Active Browse lite page (`?browse=`), app shell only. */
	browse?: DriveBrowseSurface;
	/** `app` = MC1 Join/Continue home; hub keeps Status / feature cards. */
	composition?: "hub" | "app";
	/** App shell: open / clear Browse lite (`null` = Browse index). */
	onBrowse?: (surface: DriveBrowseSurface | null) => void;
	onOpenCall: (request: DriveOpenCallRequest) => void;
	onOpenDemo: () => void;
	onOpenHistory: () => void;
	onOpenProviders: () => void;
	onOpenStatus: () => void;
	/** Optional — when set, Live stack (PU1) lists concurrent live rooms. */
	roomsSource?: DriveRoomsSource;
	workspaceRoot?: string;
}) {
	const [summary, setSummary] = useState<StatusSummary | null>(null);
	const [roomPreview, setRoomPreview] = useState<DriveRoomPreview | null>(null);
	const [roomLookupError, setRoomLookupError] = useState<string | null>(null);
	const [catalogReady, setCatalogReady] = useState(false);
	const [configured, setConfigured] = useState(false);
	const [dismissed, setDismissed] = useState(() =>
		readCredentialOnboardingDismissed(),
	);
	const [leaveNote, setLeaveNote] = useState<string | null>(null);
	/** App shell tab — Home vs Browse index (page is `browse` query). */
	const [appTab, setAppTab] = useState<"home" | "browse">(() =>
		browse ? "browse" : "home",
	);

	useEffect(() => {
		if (browse) {
			setAppTab("browse");
		}
	}, [browse]);

	useEffect(() => {
		if (composition === "app") {
			setLeaveNote(consumeLeaveKeepRunningNote());
		}
	}, [composition]);

	const requestSummary = useCallback(() => {
		postToHost({ type: "status_summary", requestId: "drive-summary" });
	}, []);

	const requestRoom = useCallback(() => {
		setRoomLookupError(null);
		setRoomPreview(null);
		postToHost({ type: "call_get_room", roomId: DRIVE_DEFAULT_ROOM_ID });
	}, []);

	useEffect(() => {
		requestSummary();
		requestRoom();
		postToHost({ type: "loadProviderCatalog" });
	}, [requestRoom, requestSummary]);

	useEffect(() => {
		return subscribeToHostMessages({
			types: DRIVE_VIEW_MESSAGE_TYPES,
			guard: isDriveViewHostMessage,
			onMessage: (message) => {
				if (message.type === "status_summary_result") {
					setSummary(message.summary);
				} else if (message.type === "status_updated") {
					requestSummary();
				} else if (message.type === "provider_catalog") {
					setCatalogReady(true);
					setConfigured(
						isLlmProviderConfigured(
							message.providers as CredentialCatalogProvider[],
						),
					);
				} else if (
					message.type === "providers" &&
					message.providers.length > 0
				) {
					setConfigured(true);
				} else if (
					message.type === "provider_settings_saved" &&
					message.enabled
				) {
					setConfigured(true);
				} else if (
					message.type === "provider_oauth_login_done" &&
					message.accessTokenPresent
				) {
					setConfigured(true);
				}
				const roomNotFound = isDriveRoomNotFoundMessage(message);
				if (
					message.type === "call_error" &&
					message.command === "call_get_room" &&
					!roomNotFound
				) {
					setRoomPreview(null);
					setRoomLookupError(
						typeof message.text === "string" && message.text.trim()
							? message.text
							: "Could not check the Pairing room.",
					);
					return;
				}
				if (
					message.type === "room_snapshot" ||
					message.type === "drive_event" ||
					roomNotFound
				) {
					setRoomLookupError(null);
					setRoomPreview((current) => {
						const base = current ?? EMPTY_DRIVE_ROOM_PREVIEW;
						const next = applyDriveRoomPreviewMessage(base, message);
						return current === null && next === base ? null : next;
					});
				}
			},
		});
	}, [requestSummary]);

	// The hub may never answer `call_get_room` at all — no `call_error`, no
	// `room_snapshot`, nothing the effect above listens for — when it is not
	// reachable (e.g. no hub process running). Left alone the room preview
	// card would read "Checking…" forever. This effect is only armed while
	// the lookup is still outstanding (both pieces of state are null); it
	// clears on cleanup the moment either a real answer lands or the room is
	// requested again, so it never clobbers a result that already arrived.
	useEffect(() => {
		if (roomPreview !== null || roomLookupError !== null) {
			return;
		}
		const timer = window.setTimeout(() => {
			setRoomLookupError(DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE);
		}, ROOM_LOOKUP_TIMEOUT_MS);
		const unsubscribe = subscribeToHostMessages({
			types: ["error"],
			guard: isTransportErrorHostMessage,
			onMessage: () => {
				window.clearTimeout(timer);
				setRoomLookupError(DRIVE_ROOM_HUB_UNREACHABLE_MESSAGE);
			},
		});
		return () => {
			window.clearTimeout(timer);
			unsubscribe();
		};
	}, [roomPreview, roomLookupError]);

	const blocked = summary?.byState.blocked ?? 0;
	const showCredentialBanner = shouldShowCredentialOnboardingBanner({
		catalogReady,
		configured,
		dismissed,
	});

	if (composition === "app") {
		const demoBootstrap = readDrivecodeDemoHubBootstrap(
			typeof window === "undefined" ? "" : window.location.search,
		);
		const previewChip = shouldShowPreviewChip({
			unconfigured: catalogReady && !configured,
			demoQuery:
				demoBootstrap.useShareScreenSpotlightDemo ||
				demoBootstrap.useChatForkDemo,
		});
		// NOW-FIRST-OPEN: credential-free Join opens the fixture demo path.
		const openCallOrPreview = (request: DriveOpenCallRequest) => {
			if (catalogReady && !configured) {
				onOpenDemo();
				return;
			}
			onOpenCall(request);
		};
		const joinDefault = () =>
			openCallOrPreview({ action: "join", roomId: DRIVE_DEFAULT_ROOM_ID });

		const showBrowsePage = Boolean(browse && onBrowse);
		const showBrowseIndex = appTab === "browse" && !browse;

		// Skip PageFrame ScrollArea — app shell owns Home/Browse tabs + scroll.
		return (
			<div
				className="flex h-full min-h-0 flex-col bg-background px-4 py-5 max-[720px]:px-3 max-[720px]:py-4"
				data-slot="drive-app-shell"
			>
				<div className="min-h-0 flex-1 overflow-auto pb-2">
					{showBrowsePage && browse && onBrowse ? (
						<DriveBrowseLitePage
							onBack={() => onBrowse(null)}
							onJoin={joinDefault}
							surface={browse}
						/>
					) : showBrowseIndex ? (
						<DriveBrowseLiteIndex
							onJoin={joinDefault}
							onOpen={(surface) => onBrowse?.(surface)}
						/>
					) : (
						<>
							<PageHeader
								description="Join or continue a call. Watch the agent, then steer when needed."
								icon={DriveMarkIcon}
								title="Cline Drive"
							/>
							{previewChip ? (
								<p
									className="mb-3 inline-flex rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:text-amber-100"
									data-slot="preview-chip"
								>
									{PREVIEW_CHIP_LABEL}
								</p>
							) : null}
							{leaveNote ? (
								<p
									aria-live="polite"
									className="mb-3 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100"
									data-slot="leave-keep-running"
									role="status"
								>
									{leaveNote}
								</p>
							) : null}
							{showCredentialBanner ? (
								<CredentialOnboardingBanner
									onDismiss={() => {
										writeCredentialOnboardingDismissed(true);
										setDismissed(true);
									}}
									onOpenDemo={onOpenDemo}
									onOpenProviders={onOpenProviders}
								/>
							) : null}
							<RoomPreviewCard
								composition="app"
								lookupError={roomLookupError}
								onOpenCall={openCallOrPreview}
								onRetry={requestRoom}
								preview={roomPreview}
							/>
						</>
					)}
				</div>
				<nav
					aria-label="App tabs"
					className="flex shrink-0 border-t px-2 pt-2"
					data-slot="drive-app-tabs"
				>
					<button
						className={cn(
							"flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-semibold",
							appTab === "home" && !browse
								? "text-primary"
								: "text-muted-foreground",
						)}
						onClick={() => {
							setAppTab("home");
							onBrowse?.(null);
						}}
						type="button"
					>
						Home
					</button>
					<button
						className={cn(
							"flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-semibold",
							appTab === "browse" || browse
								? "text-primary"
								: "text-muted-foreground",
						)}
						onClick={() => {
							setAppTab("browse");
							onBrowse?.(null);
						}}
						type="button"
					>
						Browse
					</button>
				</nav>
			</div>
		);
	}

	return (
		<PageFrame>
			<PageHeader
				actions={
					<Button
						onClick={onOpenHistory}
						size="sm"
						type="button"
						variant="outline"
					>
						Session history
					</Button>
				}
				description="Stay on a call with an agent while it works. Watch what it is doing, then steer when needed."
				icon={DriveMarkIcon}
				title="Drive"
			/>

			{showCredentialBanner ? (
				<CredentialOnboardingBanner
					onDismiss={() => {
						writeCredentialOnboardingDismissed(true);
						setDismissed(true);
					}}
					onOpenDemo={onOpenDemo}
					onOpenProviders={onOpenProviders}
				/>
			) : null}

			<RoomPreviewCard
				lookupError={roomLookupError}
				onOpenCall={onOpenCall}
				onRetry={requestRoom}
				preview={roomPreview}
			/>

			{roomsSource ? (
				<DriveLiveStack
					onOpenCall={onOpenCall}
					roomsSource={roomsSource}
					workspaceRoot={workspaceRoot}
				/>
			) : null}

			{/* Status snapshot first: if something is blocked, that is the most
			    useful thing this page can tell you. */}
			{summary ? (
				<button
					className={cn(
						"mb-6 flex w-full flex-wrap items-center gap-6 rounded-lg border bg-card px-5 py-4 text-left transition-colors hover:bg-muted/40",
						blocked > 0 && "border-amber-500/40",
					)}
					onClick={onOpenStatus}
					type="button"
				>
					{SNAPSHOT_STATES.map((state) => (
						<div key={state}>
							<div
								className={cn(
									"text-2xl font-semibold tabular-nums",
									SNAPSHOT_STYLES[state],
								)}
							>
								{summary.byState[state] ?? 0}
							</div>
							<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
								{state}
							</div>
						</div>
					))}
					<div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
						{blocked > 0
							? `${blocked} blocked ${blocked === 1 ? "item needs" : "items need"} you`
							: "Nothing is blocked"}
						<ArrowRightIcon className="size-3.5" />
					</div>
				</button>
			) : null}

			<div className="grid gap-4 md:grid-cols-3">
				<FeatureCard
					icon={PhoneIcon}
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
					icon={MonitorPlayIcon}
					tagline="See who is sharing, and what."
					title="Spotlight"
				>
					<p>
						The shared surface inside a call. The agent puts its work on it —
						edits, commands, test results, plan steps — and you can take the
						spotlight yourself to pin a selection, a file, or terminal output.
					</p>
					<p>
						Events, not pixels: everyone in the room renders the same event
						stream, so there is no screen-capture to set up.
					</p>
				</FeatureCard>

				<FeatureCard
					action={
						<Button
							onClick={onOpenStatus}
							size="sm"
							type="button"
							variant="outline"
						>
							Open Status Hub
						</Button>
					}
					icon={ActivityIcon}
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

			{summary && summary.byAgent.length > 0 ? (
				<section className="mt-6 rounded-lg border bg-card p-5">
					<h2 className="mb-3 text-base font-semibold text-foreground">
						Agents reporting
					</h2>
					<div className="flex flex-wrap gap-2">
						{summary.byAgent.map((agent) => (
							<div
								className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
								key={agent.agentId}
							>
								<span className="font-medium text-foreground">
									{agent.agentName ?? agent.agentId}
								</span>
								<span className="text-xs text-muted-foreground">
									{agent.total} active
								</span>
								{agent.blocked > 0 ? (
									<Badge
										className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400"
										variant="outline"
									>
										{agent.blocked} blocked
									</Badge>
								) : null}
							</div>
						))}
					</div>
				</section>
			) : null}
		</PageFrame>
	);
}
