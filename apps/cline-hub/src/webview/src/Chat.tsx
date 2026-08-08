"use client";

import {
	buildCleanDrainInvite,
	buildRecruitNeed,
	buildVoiceAckNarration,
	classifyStall,
	diagnoseAndPropose,
	formatCleanDrainNarration,
	type RankedRecruit,
	type RecruitNeed,
	rankRecruitCandidates,
	type StallOpenFailure,
	shouldOfferCleanDrain,
	stallRollupSliceFromCounters,
} from "@cline/drive";
import type { AddressSet, GateSessionState, RosterPack } from "@cline/shared";
import {
	allowGateToolForSession,
	classifyToolNameForGate,
	clearGateSession,
	createGateSessionState,
	EVERYONE_ADDRESS,
	recordGateDenial,
	shouldShowGatesActiveStrip,
} from "@cline/shared";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { DriveMarkMotion } from "@/components/icons/drive-mark-motion";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { parseDriveAppShell } from "@/lib/drive-shell";
import type {
	WebviewChatAttachments,
	WebviewDefaults,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewReasonLevel,
	WebviewSessionSummary,
} from "../../webview-protocol";
import { writeLeaveKeepRunningNote } from "./drive/driveAppCallChrome";
import {
	CHAT_HOST_MESSAGE_TYPES,
	type ChatHostMessage,
	isChatHostMessage,
} from "./chatHostMessages";
import {
	appendAssistantDelta,
	appendReasoningDelta,
	appendToolEvent,
	buildUserMessageLabel,
	type ChatMessage,
	createMessage,
	finalizeAssistantTurn,
	mergeHydratedMessagesWithLive,
} from "./chatMessageState";
import { Composer } from "./components/Composer";
import { ConversationPanel } from "./components/ConversationPanel";
import {
	type PendingApproval,
	PendingApprovalsPanel,
} from "./components/PendingApprovalsPanel";
import { PlanEditor } from "./components/PlanEditor";
import { hasNowLastFailure, steerAppliedBanner } from "./drive/agencyChrome";
import {
	buildSpeakerInkMap,
	DRIVE_SCREEN_INK_THEME,
	resolveSpotlightSharer,
	resolveSpotlightSharerInk,
	useDriveInkTheme,
} from "./drive/agentInk";
import { resolvePresentedArtifact } from "./drive/artifactBody";
import {
	listPlanTasks,
	mutateBankAcceptSdlcFreeze,
	mutateBankBindNow,
	mutateBankCompleteTask,
	mutateBankCreateTask,
	mutateBankEditPlanTasks,
	mutateBankRecordFailure,
} from "./drive/bankSession";
import {
	ChatForkAuditPanel,
	isChatForkSession,
} from "./drive/ChatForkAuditPanel";
import { DriveHeaderControls } from "./drive/DriveCallChrome";
import {
	DriveCallStripDock,
	DriveRoomChrome,
	DriveRoster,
	DriveVoiceBar,
} from "./drive/DriveRoomChrome";
import { buildRaiseHandFrame } from "./drive/driveCallOps";
import type { DriveLaunchRequest } from "./drive/driveLaunch";
import { GateFeedCard, type GateFeedResponse } from "./drive/GateFeedCard";
import { resolveIncomingApprovalBypass } from "./drive/gateApproval";
import { RecruitStallPicker } from "./drive/RecruitStallPicker";
import { RouteSuggestChip } from "./drive/RouteSuggestChip";
import { DriveAddressChip } from "./drive/DriveAddressChip";
import {
	type CallSpendSnapshot,
	foldUsageIntoSpend,
} from "./drive/callSpend";
import {
	collectRecruitCandidates,
	RECRUIT_FIXTURE_CANDIDATES,
} from "./drive/recruitAddNeed";
import {
	type DriveagentHomeListing,
	requestDriveagentHomeList,
} from "./drive/requestDriveagentHome";
import { resolveRosterParticipants } from "./drive/rosterHelpers";
import {
	type RouterUiMode,
	type RouteSuggestion,
	suggestRouteForUtterance,
} from "./drive/routeSuggest";
import { SdlcFreezeAcceptChip } from "./drive/SdlcFreezeAcceptChip";
import { Spotlight, type SpotlightArtifact } from "./drive/Spotlight";
import { StuckRecoveryFork } from "./drive/StuckRecoveryFork";
import { homeRecruitCandidates, resolveSeatRef } from "./drive/seatRef";
import {
	planRecoveryAccept,
	type RecoveryOptionKind,
	resolveRecoveryOfferTarget,
	shouldOfferRecoveryFork,
} from "./drive/stuckRecovery";
import {
	applyBankSnapshot,
	applySubModeIntent,
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	drivePersonaSystemHint,
	toNativeMode,
	toSharedDriveSubMode,
} from "./drive/types";
import { useDriveSession } from "./drive/useDriveSession";
import { driveOutputSilenced } from "./drive/voice/driveEarcons";
import { shouldSpeakDriveTts } from "./drive/voice/driveVoiceUi";
import { useDriveEarcons } from "./drive/voice/useDriveEarcons";
import { clearVoiceCaptionAfterSend } from "./drive/voice/voiceCaptionState";
import {
	NARROW_CALL_MAX_WIDTH_PX,
	resolveFeedCollapsed,
	writeDriveFeedCollapsed,
} from "./lib/drive-feed-collapsed";
import { subscribeToHostMessages } from "./lib/host-message-gateway";
import { cn } from "./lib/utils";
import { getVsCodeApi, postToHost } from "./vscode";

type ProviderOption = Extract<
	WebviewOutboundMessage,
	{ type: "providers" }
>["providers"][number];
type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
};

const EMPTY_SELECTION: ModelSelectionStorage = {
	lastProvider: "",
	lastModelByProvider: {},
};

function readModelSelection(): ModelSelectionStorage {
	try {
		const state = getVsCodeApi()?.getState() as
			| { modelSelection?: ModelSelectionStorage }
			| undefined;
		if (state?.modelSelection) {
			return state.modelSelection;
		}
	} catch {
		// ignore persisted state issues in the webview
	}
	return EMPTY_SELECTION;
}

function writeModelSelection(selection: ModelSelectionStorage): void {
	try {
		const api = getVsCodeApi();
		if (!api) {
			return;
		}
		const state = (api.getState() as Record<string, unknown>) ?? {};
		api.setState({ ...state, modelSelection: selection });
	} catch {
		// ignore persisted state issues in the webview
	}
}

function parseMaxIterations(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function formatSessionLabel(session: WebviewSessionSummary): string {
	const title = session.title?.trim() || session.sessionId.slice(0, 12);
	const workspaceName = session.workspaceRoot?.trim()
		? session.workspaceRoot.trim().split("/").pop()
		: undefined;
	return [title, workspaceName].filter(Boolean).join(" • ");
}

type ChatProps = {
	driveLaunchRequest?: DriveLaunchRequest | null;
	initialSessionId?: string;
	onDriveLaunchHandled?: (requestId: number) => void;
	onSessionSelected?: (sessionId?: string) => void;
	/** Consumer leave → lobby (NOW-LEAVE-COPY). */
	onReturnToLobby?: () => void;
};

export default function Chat({
	driveLaunchRequest,
	initialSessionId,
	onDriveLaunchHandled,
	onSessionSelected,
	onReturnToLobby,
}: ChatProps) {
	/** Consumer `?app=1` — hold-to-talk + thin strip (NOW-HOLD-TALK / NOW-STRIP-44). */
	const appShell = parseDriveAppShell(
		typeof window === "undefined" ? "" : window.location.search,
	);
	const callComposition = appShell ? "app" : "hub";
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState("Waiting for RPC initialization...");
	const [sessionId, setSessionId] = useState<string>();
	const [hydratingSessionId, setHydratingSessionId] = useState<string>();
	const [sending, setSending] = useState(false);
	const [pendingSteers, setPendingSteers] = useState<
		Array<{ id: string; prompt: string }>
	>([]);
	const sendingRef = useRef(false);
	useEffect(() => {
		sendingRef.current = sending;
	}, [sending]);
	const [providers, setProviders] = useState<ProviderOption[]>([]);
	const [modelsByProvider, setModelsByProvider] = useState<
		Record<string, WebviewProviderModel[]>
	>({});
	const [defaults, setDefaults] = useState<WebviewDefaults>({
		workspaceRoot: "",
		cwd: "",
	});
	/**
	 * True once the host's `defaults` reply has landed at least once. Until
	 * then `defaults.workspaceRoot` is indistinguishable from "genuinely no
	 * workspace" — see useDriveSession's workspaceRootReady.
	 */
	const [defaultsReady, setDefaultsReady] = useState(false);
	const [sessions, setSessions] = useState<WebviewSessionSummary[]>([]);
	const [sessionTitleDraft, setSessionTitleDraft] = useState("");
	const [lastSelection, setLastSelection] =
		useState<ModelSelectionStorage>(readModelSelection);
	const [provider, setProvider] = useState(() => lastSelection.lastProvider);
	const [model, setModel] = useState(
		() => lastSelection.lastModelByProvider[lastSelection.lastProvider] ?? "",
	);
	const [systemPrompt, setSystemPrompt] = useState("");
	const [maxIterations, setMaxIterations] = useState("");
	const [mode, setMode] = useState<"act" | "plan">("act");
	const [reasonLevel, setReasonLevel] = useState<WebviewReasonLevel>("none");
	const [enableTools, setEnableTools] = useState(true);
	const [enableSpawn, setEnableSpawn] = useState(true);
	const [enableTeams, setEnableTeams] = useState(true);
	const [autoApproveTools, setAutoApproveTools] = useState(true);
	const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
		[],
	);
	const [gateSession, setGateSession] = useState<GateSessionState>(() =>
		createGateSessionState(),
	);
	/**
	 * `handleMessage` below is wired up once (empty effect deps) so it reads
	 * gate-session state through a ref rather than a stale closure — same
	 * pattern as driveRef.
	 */
	const gateSessionRef = useRef(gateSession);
	gateSessionRef.current = gateSession;
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const [titleEditing, setTitleEditing] = useState(false);
	const [forking, setForking] = useState(false);
	const [forkError, setForkError] = useState<string | null>(null);
	const [routeSuggestion, setRouteSuggestion] =
		useState<RouteSuggestion | null>(null);
	const [pendingRouteSend, setPendingRouteSend] = useState<{
		prompt: string;
		attachments?: WebviewChatAttachments;
		attachmentCount: number;
		source: "voice" | "text";
	} | null>(null);
	/** Measured call spend (PU4) — cleared when the call ends. */
	const [callSpend, setCallSpend] = useState<CallSpendSnapshot | null>(null);
	/** Plan editor lives in a sheet on Spotlight — not under the stage column. */
	const [planSheetOpen, setPlanSheetOpen] = useState(false);
	/** suggest (default) | auto | manual — auto applies address without a chip (7.4). */
	const routerMode = "suggest" as RouterUiMode;
	const activeAssistantIdRef = useRef<string | undefined>(undefined);
	const initialSessionIdRef = useRef<string | undefined>(undefined);
	const hydratingSessionIdRef = useRef<string | undefined>(undefined);
	const sessionIdRef = useRef<string | undefined>(undefined);
	const onSessionSelectedRef = useRef(onSessionSelected);
	const lastSelectionRef = useRef(lastSelection);
	const sessionsRef = useRef(sessions);
	const defaultsRef = useRef(defaults);
	const handledDriveLaunchRequestIdRef = useRef<number | null>(null);

	const isHydrating = Boolean(hydratingSessionId);
	const driveSession = useDriveSession({
		providerId: provider,
		sending,
		disabled: isHydrating,
		onModeChange: setMode,
		onAbort: () => {
			postToHost({ type: "abort" });
		},
		onStatus: setStatus,
		sessionId: sessionId ?? null,
		workspaceRoot: defaults.workspaceRoot,
		workspaceRootReady: defaultsReady,
	});
	const {
		drive,
		setDrive,
		driveVoice,
		driveJoinNote,
		setDriveJoinNote,
		setVoiceCaption,
		planEditorTasks,
		setPlanEditorTasks,
		bankSessionRef,
		connectionPhase,
		narrator,
		joinDrive,
		leaveDrive,
		endDrive,
		refreshDriveRoom,
		toggleStage,
		presentedShow,
		chatForks,
		showBacklog,
		workersPanelOpen,
		focusedAuditHandle,
		auditMessages,
		auditSummaryOnly,
		toggleWorkersPanel,
		openForkAudit,
		setForkRetain,
	} = driveSession;

	useEffect(() => {
		if (!drive.active) {
			setCallSpend(null);
		}
	}, [drive.active]);

	useEffect(() => {
		if (!(drive.active && drive.stageLayout)) {
			setPlanSheetOpen(false);
		}
	}, [drive.active, drive.stageLayout]);

	const modelShortlist = useMemo(() => {
		const ids = new Set<string>();
		if (provider.trim() && model.trim()) {
			ids.add(`${provider}:${model}`);
		}
		for (const [providerId, modelId] of Object.entries(
			lastSelection.lastModelByProvider,
		)) {
			if (providerId.trim() && modelId?.trim()) {
				ids.add(`${providerId}:${modelId}`);
			}
		}
		return [...ids].slice(0, 8);
	}, [provider, model, lastSelection.lastModelByProvider]);

	const currentModelId =
		provider.trim() && model.trim() ? `${provider}:${model}` : undefined;

	const selectPowerModel = useCallback((providerModel: string) => {
		const sep = providerModel.indexOf(":");
		if (sep <= 0) {
			return;
		}
		const nextProvider = providerModel.slice(0, sep);
		const nextModel = providerModel.slice(sep + 1);
		if (!nextProvider || !nextModel) {
			return;
		}
		setProvider(nextProvider);
		setModel(nextModel);
	}, []);

	const driveRef = useRef(drive);
	driveRef.current = drive;

	useDriveEarcons({
		active: drive.active,
		facets: driveVoice.facets,
		// Earcons follow output silence, not whether the mic is hot — deafen is
		// the human's own output mute, matching `shouldSpeakDriveTts`.
		outputSilenced: driveOutputSilenced({
			selfSilenced: drive.deafened,
			partnerMuted: drive.partnerMuted,
		}),
		outputVolume: driveVoice.hardware.outputVolume,
		speakerDeviceId: driveVoice.hardware.speakerDeviceId,
		planId: drive.bankSnapshot.activePlanId,
		openTaskIds: drive.bankSnapshot.openTaskIds,
		pendingApprovalIds: pendingApprovals.map((item) => item.approvalId),
		participantIds: drive.participants.map((item) => item.id),
	});

	/** Spotlight-primary split: Spotlight owns the room, feed folds beside it. */
	const stageLayout = drive.active && drive.stageLayout;
	/**
	 * Ink for the shared screen's sharing chip. The screen is fixed-dark in both
	 * host themes, so it clamps against the screen well rather than the host one.
	 */
	/**
	 * Slugs the hub confirmed have a `.driveagent/<slug>/agent.yaml`.
	 *
	 * A ref is only sent for a slug in here, so the seat's identity is read off
	 * disk rather than inferred from a picker label. A ref held in a ref (not
	 * state) because the seat handler is a stable callback and a stale closure
	 * would silently stop sending refs after the first listing.
	 */
	const driveagentHomeSlugsRef = useRef<ReadonlySet<string>>(new Set());
	const [driveagentHomes, setDriveagentHomes] = useState<
		readonly DriveagentHomeListing[]
	>([]);
	useEffect(() => {
		const root = defaults.workspaceRoot?.trim();
		if (!root) {
			return;
		}
		let cancelled = false;
		void requestDriveagentHomeList(root)
			.then((homes) => {
				if (cancelled) {
					return;
				}
				driveagentHomeSlugsRef.current = new Set(
					homes.map((home) => home.slug),
				);
				setDriveagentHomes(homes);
			})
			.catch(() => {
				// No listing means no evidence, which means no ref is sent — the
				// pre-existing behaviour, not a broken one.
			});
		return () => {
			cancelled = true;
		};
	}, [defaults.workspaceRoot]);

	/**
	 * Real homes first, then the shipped fixtures. A home and a fixture that
	 * share a slug resolve to the home, because only the home is on disk.
	 */
	const recruitFixtures = useMemo(
		() => [
			...homeRecruitCandidates(driveagentHomes),
			...RECRUIT_FIXTURE_CANDIDATES.filter(
				(fixture) =>
					!driveagentHomes.some((home) => home.slug === fixture.slug),
			),
		],
		[driveagentHomes],
	);

	/**
	 * Memoized: the feed's ink map is derived from this, and resolving an ink
	 * walks a contrast search per agent. A fresh array identity every render
	 * would defeat that memo on a surface that re-renders per token.
	 */
	const rosterParticipants = useMemo(
		() => resolveRosterParticipants(drive),
		[drive],
	);
	const spotlightSharerInk = resolveSpotlightSharerInk(
		drive,
		DRIVE_SCREEN_INK_THEME,
		rosterParticipants,
	);
	/**
	 * The agent behind the shared screen. Resolved from the same roster the
	 * chip's ink comes from, so the mark and the colour name one participant.
	 */
	const spotlightSharer = resolveSpotlightSharer(drive, rosterParticipants);
	const feedInkTheme = useDriveInkTheme();
	/**
	 * Both ink channels per seated agent, for the feed. Resolved once here
	 * rather than per message — the contrast clamp walks a search, and a long
	 * transcript would run it on every row.
	 */
	const speakerInks = useMemo(
		() => buildSpeakerInkMap(drive, rosterParticipants, feedInkTheme),
		[drive, rosterParticipants, feedInkTheme],
	);
	const feedRoomKey = drive.roomId ?? DRIVE_DEFAULT_ROOM_ID;
	const narrowCall = useSyncExternalStore(
		(onChange) => {
			const mq = window.matchMedia(`(max-width: ${NARROW_CALL_MAX_WIDTH_PX}px)`);
			mq.addEventListener("change", onChange);
			return () => mq.removeEventListener("change", onChange);
		},
		() => window.matchMedia(`(max-width: ${NARROW_CALL_MAX_WIDTH_PX}px)`).matches,
		() => false,
	);
	const [feedCollapsed, setFeedCollapsed] = useState(false);
	/** Fold state is webview-local and per room — rejoining restores the drawer.
	 * Unset rooms collapse on phone so Spotlight owns first paint (collapsible IA). */
	useEffect(() => {
		const width = narrowCall
			? NARROW_CALL_MAX_WIDTH_PX
			: NARROW_CALL_MAX_WIDTH_PX + 1;
		setFeedCollapsed(resolveFeedCollapsed(feedRoomKey, width));
	}, [feedRoomKey, narrowCall]);
	const toggleFeedCollapsed = useCallback(() => {
		const next = !feedCollapsed;
		setFeedCollapsed(next);
		writeDriveFeedCollapsed(feedRoomKey, next);
	}, [feedCollapsed, feedRoomKey]);
	/** Guard bind_now spam — one bind per now-task while Agent posture. */
	const lastBoundNowTaskIdRef = useRef<string | null>(null);
	/** Mute identical stuck-recovery offers until a new failure fingerprint. */
	const [dismissedRecoveryOfferKey, setDismissedRecoveryOfferKey] = useState<
		string | null
	>(null);
	const [dismissedPlanImproveOfferKey, setDismissedPlanImproveOfferKey] =
		useState<string | null>(null);
	const wasDriveActiveRef = useRef(false);
	/** Last callSessionId while on-call — End clears chrome before diagnose. */
	const lastCallSessionIdRef = useRef<string | null>(null);
	/** Mute identical clean-drain invites (one soft ask per drain). */
	const [dismissedCleanDrainInviteKey, setDismissedCleanDrainInviteKey] =
		useState<string | null>(null);
	/** Recruit-on-stall picker (opened from stuck recovery “Who should take this?”). */
	const [recruitStall, setRecruitStall] = useState<{
		need: RecruitNeed;
		ranked: RankedRecruit[];
	} | null>(null);
	/** Session counters for S3 detection without re-reading bank JSONL mid-call. */
	const cleanDrainCountersRef = useRef<{
		activateTaskIds: string[];
		completedCount: number;
		midPlanAddCount: number;
		planTitle: string | null;
	}>({
		activateTaskIds: [],
		completedCount: 0,
		midPlanAddCount: 0,
		planTitle: "Current work",
	});

	/** Artifact bound to the Spotlight frame — presented show + its backlog item. */
	const presentedArtifact: SpotlightArtifact | null = useMemo(
		() => resolvePresentedArtifact(presentedShow, showBacklog),
		[presentedShow, showBacklog],
	);

	/** Mid-call stall slice (W4.1) — counters + open lastFailure; no utterance. */
	const openStallFailures: StallOpenFailure[] = useMemo(() => {
		const byId = new Map<string, StallOpenFailure>();
		for (const task of planEditorTasks) {
			byId.set(task.id, {
				taskId: task.id,
				...(task.lastFailure ? { lastFailure: task.lastFailure } : {}),
			});
		}
		const nowId = drive.bankSnapshot.nowTaskId?.trim();
		if (nowId && drive.bankSnapshot.nowLastFailure?.trim()) {
			byId.set(nowId, {
				taskId: nowId,
				lastFailure: drive.bankSnapshot.nowLastFailure,
			});
		}
		return [...byId.values()];
	}, [
		drive.bankSnapshot.nowLastFailure,
		drive.bankSnapshot.nowTaskId,
		planEditorTasks,
	]);
	const stallClassification = classifyStall({
		rollup: stallRollupSliceFromCounters({
			tasksCompleted: cleanDrainCountersRef.current.completedCount,
			midPlanAddCount: cleanDrainCountersRef.current.midPlanAddCount,
			openFailures: openStallFailures,
		}),
		openFailures: openStallFailures,
		nowTaskId: drive.bankSnapshot.nowTaskId,
	});
	const autoStallOffer =
		stallClassification.stalled &&
		stallClassification.primaryTaskId &&
		stallClassification.failureFingerprint
			? {
					taskId: stallClassification.primaryTaskId,
					failureFingerprint: stallClassification.failureFingerprint,
				}
			: null;
	const recoveryOfferTarget = resolveRecoveryOfferTarget({
		nowTaskId: drive.bankSnapshot.nowTaskId,
		nowLastFailure: drive.bankSnapshot.nowLastFailure,
		autoStallOffer,
	});
	const recoveryOfferTargetRef = useRef(recoveryOfferTarget);
	recoveryOfferTargetRef.current = recoveryOfferTarget;
	const showStuckRecovery = shouldOfferRecoveryFork({
		driveActive: stageLayout,
		nowTaskId: drive.bankSnapshot.nowTaskId,
		nowLastFailure: drive.bankSnapshot.nowLastFailure,
		dismissedOfferKey: dismissedRecoveryOfferKey,
		autoStallOffer,
	});

	const maybeOfferCleanDrain = useCallback(
		(prev: typeof drive.bankSnapshot, next: typeof drive.bankSnapshot) => {
			const counters = cleanDrainCountersRef.current;
			if (
				!shouldOfferCleanDrain({
					driveActive: driveRef.current.active,
					prev,
					next,
					counters: {
						activateTaskIds: counters.activateTaskIds,
						completedCount: counters.completedCount,
						midPlanAddCount: counters.midPlanAddCount,
					},
					dismissedInviteKey: dismissedCleanDrainInviteKey,
				})
			) {
				return;
			}
			const planId = prev.activePlanId?.trim();
			if (!planId) {
				return;
			}
			const invite = buildCleanDrainInvite({
				planId,
				planTitle: counters.planTitle,
				tasksCompleted: counters.completedCount,
			});
			setDrive((current) => ({
				...current,
				cleanDrainInvite: invite,
			}));
			setDriveJoinNote(formatCleanDrainNarration(invite));
		},
		[dismissedCleanDrainInviteKey, setDrive, setDriveJoinNote],
	);

	const dismissCleanDrain = useCallback(() => {
		const invite = driveRef.current.cleanDrainInvite;
		if (invite) {
			setDismissedCleanDrainInviteKey(invite.inviteKey);
		}
		setDrive((current) => ({
			...current,
			cleanDrainInvite: null,
		}));
	}, [setDrive]);

	/** Soft E1 affordance — switches to Plan mode; does not activate a plan. */
	const continueCleanDrain = useCallback(() => {
		dismissCleanDrain();
		setDrive((current) => {
			const next = applySubModeIntent(current, "plan");
			setMode(toNativeMode(next.subMode));
			if (current.roomId) {
				postToHost({
					type: "call_set_mode",
					roomId: current.roomId,
					subMode: toSharedDriveSubMode(next.subMode),
					driveActive: true,
				});
			}
			return {
				...next,
				agencyBanner: "Ready for the next goal — add tasks when you like",
			};
		});
	}, [dismissCleanDrain, setDrive]);

	const seatRecruitCandidate = useCallback(
		(entry: RankedRecruit) => {
			const roomId = driveRef.current.roomId?.trim() || DRIVE_DEFAULT_ROOM_ID;
			// Sent only when this browser has evidence for it — a slug the hub
			// listed as a real `.driveagent/` home, or the builtin partner. The
			// hub writes `ref` verbatim into an append-only join event, so an
			// omitted ref is preferable to a guessed one.
			const ref = resolveSeatRef(entry.slug, driveagentHomeSlugsRef.current);
			postToHost({
				type: "call_seat",
				roomId,
				agent: {
					id: entry.slug,
					displayName: entry.displayName,
					role:
						entry.slug === DRIVE_PARTICIPANT_PARTNER ||
						entry.slug === "pair-partner"
							? "partner"
							: "specialist",
					...(ref ? { ref } : {}),
				},
			});
			setDrive((current) => ({
				...current,
				attributionAgentId: entry.slug,
				agencyBanner: `Seated ${entry.displayName} for Now — cursor unchanged`,
			}));
			setRecruitStall(null);
			// Bind execution to current now without reordering plan.
			void mutateBankBindNow(bankSessionRef.current, defaults.workspaceRoot, {
				roomId: driveRef.current.roomId,
				callSessionId: driveRef.current.callSessionId,
				agentId: entry.slug,
			});
		},
		[bankSessionRef, defaults.workspaceRoot, setDrive],
	);

	const addRosterPack = useCallback(
		(pack: RosterPack) => {
			const roomId = driveRef.current.roomId?.trim() || DRIVE_DEFAULT_ROOM_ID;
			postToHost({
				type: "call_add_roster_pack",
				roomId,
				packId: pack.id,
				...(defaults.workspaceRoot?.trim()
					? { workspaceRoot: defaults.workspaceRoot.trim() }
					: {}),
			});
			setDrive((current) => ({
				...current,
				agencyBanner: `Added pack ${pack.displayName}`,
			}));
		},
		[defaults.workspaceRoot, setDrive],
	);

	/** Baseline activate task ids when a plan first appears this session. */
	const lastCleanDrainPlanIdRef = useRef<string | null>(null);
	useEffect(() => {
		const planId = drive.bankSnapshot.activePlanId;
		if (!planId) {
			return;
		}
		if (lastCleanDrainPlanIdRef.current !== planId) {
			lastCleanDrainPlanIdRef.current = planId;
			cleanDrainCountersRef.current = {
				activateTaskIds:
					planEditorTasks.length > 0
						? planEditorTasks.map((task) => task.id)
						: [...drive.bankSnapshot.openTaskIds],
				completedCount: 0,
				midPlanAddCount: 0,
				planTitle: "Current work",
			};
			return;
		}
		if (
			cleanDrainCountersRef.current.activateTaskIds.length === 0 &&
			(planEditorTasks.length > 0 || drive.bankSnapshot.openTaskIds.length > 0)
		) {
			cleanDrainCountersRef.current.activateTaskIds =
				planEditorTasks.length > 0
					? planEditorTasks.map((task) => task.id)
					: [...drive.bankSnapshot.openTaskIds];
		}
	}, [
		drive.bankSnapshot.activePlanId,
		drive.bankSnapshot.openTaskIds,
		planEditorTasks,
	]);

	/**
	 * Post-session plan-improve (W4.2 / Slice 3): after End / leave (active→inactive),
	 * diagnose stall and offer a gated planning proposal — not the in-call fork.
	 */
	useEffect(() => {
		const wasActive = wasDriveActiveRef.current;
		wasDriveActiveRef.current = drive.active;
		if (drive.active) {
			if (drive.callSessionId?.trim()) {
				lastCallSessionIdRef.current = drive.callSessionId.trim();
			}
			// Clear post-session card when rejoining a call.
			if (drive.pendingPlanningImprove) {
				setDrive((current) => ({
					...current,
					pendingPlanningImprove: null,
				}));
			}
			return;
		}
		if (!wasActive) {
			return;
		}
		// Leave / End clears session allows (DRV-GATES — never durable by default).
		setGateSession(clearGateSession());
		if (drive.pendingPlanningImprove) {
			return;
		}
		const proposal = diagnoseAndPropose({
			rollup: stallRollupSliceFromCounters({
				tasksCompleted: cleanDrainCountersRef.current.completedCount,
				midPlanAddCount: cleanDrainCountersRef.current.midPlanAddCount,
				openFailures: openStallFailures,
			}),
			openFailures: openStallFailures,
			nowTaskId: drive.bankSnapshot.nowTaskId,
			callSessionId: drive.callSessionId ?? lastCallSessionIdRef.current,
			evidence: {
				taskIds: openStallFailures.map((entry) => entry.taskId),
				...(drive.bankSnapshot.activePlanId
					? { planIds: [drive.bankSnapshot.activePlanId] }
					: {}),
			},
		});
		if (!proposal) {
			return;
		}
		if (dismissedPlanImproveOfferKey === proposal.offerKey) {
			return;
		}
		setDrive((current) => ({
			...current,
			pendingPlanningImprove: proposal,
		}));
	}, [
		dismissedPlanImproveOfferKey,
		drive.active,
		drive.bankSnapshot.activePlanId,
		drive.bankSnapshot.nowTaskId,
		drive.callSessionId,
		drive.pendingPlanningImprove,
		openStallFailures,
		setDrive,
	]);

	const acceptStuckRecovery = useCallback(
		(option: RecoveryOptionKind) => {
			void (async () => {
				const snapshot = driveRef.current.bankSnapshot;
				const offer = recoveryOfferTargetRef.current;
				const plan = planRecoveryAccept({
					option,
					snapshot,
					planTaskIds: planEditorTasks.map((task) => task.id),
					stallFailureFingerprint:
						offer?.source === "auto_stall" ? offer.failureNote : null,
					stallTaskId: offer?.source === "auto_stall" ? offer.taskId : null,
				});
				if (!plan) {
					return;
				}

				switch (plan.action) {
					case "dismiss":
						setDismissedRecoveryOfferKey(plan.offerKey);
						return;
					case "recruit": {
						setDismissedRecoveryOfferKey(plan.offerKey);
						const offer = recoveryOfferTargetRef.current;
						const need = buildRecruitNeed({
							taskId: plan.taskId,
							planId: snapshot.activePlanId,
							title: snapshot.nowTitle,
							failureNote:
								snapshot.nowLastFailure ?? offer?.failureNote ?? null,
						});
						const candidates = collectRecruitCandidates(
							resolveRosterParticipants(driveRef.current),
						);
						const ranked = rankRecruitCandidates(need, candidates, {
							limit: 5,
						});
						setRecruitStall({ need, ranked });
						setDrive((current) => ({
							...current,
							agencyBanner: plan.agencyBanner,
						}));
						return;
					}
					case "pause": {
						setDismissedRecoveryOfferKey(plan.offerKey);
						if (sending) {
							postToHost({ type: "abort" });
							setStatus("Drive recovery: turn stopped");
						}
						setDrive((current) => {
							let next = applySubModeIntent(current, plan.posture);
							next = {
								...next,
								handRaised: true,
								agencyBanner: plan.agencyBanner,
							};
							setMode(toNativeMode(next.subMode));
							if (current.roomId) {
								postToHost({
									type: "call_set_mode",
									roomId: current.roomId,
									subMode: toSharedDriveSubMode(next.subMode),
									driveActive: true,
								});
								if (!current.handRaised) {
									const handFrame = buildRaiseHandFrame({
										roomId: current.roomId,
										participantId: DRIVE_PARTICIPANT_HUMAN,
										raised: true,
									});
									if (handFrame) {
										postToHost(handFrame);
									}
								}
							}
							return next;
						});
						return;
					}
					case "narrow":
					case "fixup": {
						const correlation = {
							roomId: driveRef.current.roomId,
							callSessionId: driveRef.current.callSessionId,
						};
						const created = await mutateBankCreateTask(
							bankSessionRef.current,
							defaultsRef.current.workspaceRoot,
							plan.action === "narrow"
								? {
										id: plan.createTask.id,
										title: plan.createTask.title,
										body: plan.createTask.body,
										// Reorder in the next step so Now becomes the narrowed task.
									}
								: plan.createTask,
							correlation,
						);
						if (defaultsRef.current.workspaceRoot?.trim() && !created.fromHub) {
							setStatus("Recovery not saved — workspace bank was not updated.");
							return;
						}
						let nextSnapshot = created.snapshot;
						if (plan.action === "narrow") {
							const reordered = await mutateBankEditPlanTasks(
								bankSessionRef.current,
								defaultsRef.current.workspaceRoot,
								{
									planId: plan.createTask.planId,
									taskIds: plan.reorderTaskIds,
								},
								correlation,
							);
							if (
								defaultsRef.current.workspaceRoot?.trim() &&
								!reordered.fromHub
							) {
								setStatus(
									"Recovery not saved — workspace bank was not updated.",
								);
								return;
							}
							nextSnapshot = reordered.snapshot;
						}
						setDismissedRecoveryOfferKey(plan.offerKey);
						setPlanEditorTasks(
							await listPlanTasks(
								bankSessionRef.current,
								plan.createTask.planId,
							),
						);
						setDrive((current) =>
							applyBankSnapshot(current, nextSnapshot, {
								mutation: "add",
								addedTitle: plan.createTask.title,
								recovery: true,
								agencyBanner: plan.agencyBanner,
							}),
						);
						return;
					}
					default: {
						const _exhaustive: never = plan;
						return _exhaustive;
					}
				}
			})();
		},
		[bankSessionRef, planEditorTasks, sending, setDrive, setPlanEditorTasks],
	);

	const dismissStuckRecovery = useCallback(() => {
		const snapshot = driveRef.current.bankSnapshot;
		const offer = recoveryOfferTargetRef.current;
		const plan = planRecoveryAccept({
			option: "dismiss",
			snapshot,
			planTaskIds: planEditorTasks.map((task) => task.id),
			stallFailureFingerprint:
				offer?.source === "auto_stall" ? offer.failureNote : null,
			stallTaskId: offer?.source === "auto_stall" ? offer.taskId : null,
		});
		if (plan?.action === "dismiss") {
			setDismissedRecoveryOfferKey(plan.offerKey);
		} else if (offer) {
			setDismissedRecoveryOfferKey(offer.offerKey);
		}
	}, [planEditorTasks]);

	useEffect(() => {
		if (
			!driveLaunchRequest ||
			handledDriveLaunchRequestIdRef.current === driveLaunchRequest.id
		) {
			return;
		}
		// Prefer refresh when already on-call so a Drive-tab "join" intent
		// (e.g. stale available preview) cannot re-post call_join. While
		// joining, joinDrive returns false and we retry once phase settles —
		// at "on" that retry is refresh, not another join.
		const launched =
			connectionPhase === "on"
				? refreshDriveRoom(driveLaunchRequest.roomId)
				: joinDrive(driveLaunchRequest.roomId);
		if (!launched) {
			return;
		}
		handledDriveLaunchRequestIdRef.current = driveLaunchRequest.id;
		onDriveLaunchHandled?.(driveLaunchRequest.id);
	}, [
		connectionPhase,
		driveLaunchRequest,
		joinDrive,
		onDriveLaunchHandled,
		refreshDriveRoom,
	]);

	const visibleSessions = useMemo(
		() => sessions.filter((session) => !isChatForkSession(session)),
		[sessions],
	);

	const attachSession = useCallback(
		(nextSessionId: string) => {
			if (
				hydratingSessionIdRef.current === nextSessionId ||
				(sessionIdRef.current === nextSessionId &&
					!hydratingSessionIdRef.current)
			) {
				return;
			}
			sessionIdRef.current = nextSessionId;
			hydratingSessionIdRef.current = nextSessionId;
			setSessionId(nextSessionId);
			setHydratingSessionId(nextSessionId);
			setMessages([]);
			setSending(false);
			setPendingApprovals([]);
			activeAssistantIdRef.current = undefined;
			setStatus(`Loading chat history for ${nextSessionId}...`);
			onSessionSelected?.(nextSessionId);
			postToHost({
				type: "attachSession",
				sessionId: nextSessionId,
			});
		},
		[onSessionSelected],
	);

	useEffect(() => {
		hydratingSessionIdRef.current = hydratingSessionId;
	}, [hydratingSessionId]);

	useEffect(() => {
		sessionIdRef.current = sessionId;
	}, [sessionId]);

	useEffect(() => {
		onSessionSelectedRef.current = onSessionSelected;
	}, [onSessionSelected]);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		defaultsRef.current = defaults;
	}, [defaults]);

	useEffect(() => {
		if (!drive.active || drive.subMode !== "agent") {
			if (!drive.active) {
				lastBoundNowTaskIdRef.current = null;
			}
			return;
		}
		const nowTaskId = drive.bankSnapshot.nowTaskId;
		if (!nowTaskId || lastBoundNowTaskIdRef.current === nowTaskId) {
			return;
		}
		lastBoundNowTaskIdRef.current = nowTaskId;
		void (async () => {
			const { snapshot, fromHub } = await mutateBankBindNow(
				bankSessionRef.current,
				defaultsRef.current.workspaceRoot,
				{
					roomId: drive.roomId,
					callSessionId: drive.callSessionId,
					...(drive.attributionAgentId
						? { agentId: drive.attributionAgentId }
						: {}),
				},
			);
			if (defaultsRef.current.workspaceRoot?.trim() && !fromHub) {
				return;
			}
			setDrive((current) => applyBankSnapshot(current, snapshot));
		})();
	}, [
		bankSessionRef,
		drive.active,
		drive.attributionAgentId,
		drive.bankSnapshot.nowTaskId,
		drive.callSessionId,
		drive.roomId,
		drive.subMode,
		setDrive,
	]);

	// Intentional mount-once listener: reads latest state via refs / stable setters.
	// biome-ignore lint/correctness/useExhaustiveDependencies: message bus effect must not re-subscribe
	useEffect(() => {
		const handleMessage = (message: ChatHostMessage) => {
			switch (message.type) {
				case "status":
					setStatus(message.text);
					return;
				case "error":
					setStatus(`Error: ${message.text}`);
					setSending(false);
					setHydratingSessionId(undefined);
					hydratingSessionIdRef.current = undefined;
					activeAssistantIdRef.current = undefined;
					if (message.code === "mic_muted") {
						// Voice gate rejected after optimistic user+assistant append.
						setMessages((current) => {
							if (current.length < 2) {
								return current;
							}
							const last = current.at(-1);
							const prev = current.at(-2);
							if (
								last?.role === "assistant" &&
								!(last.text ?? "").trim() &&
								prev?.role === "user"
							) {
								return current.slice(0, -2);
							}
							return current;
						});
						return;
					}
					setMessages((current) => {
						if (current.length === 0) {
							return current;
						}
						const nextText = `Error: ${message.text}`;
						const last = current.at(-1);
						if (last?.role === "error" && last.text === nextText) {
							return current;
						}
						return [...current, createMessage("error", nextText)];
					});
					return;
				case "defaults":
					setDefaults(message.defaults);
					setDefaultsReady(true);
					if (message.defaults.provider) {
						setProvider(message.defaults.provider);
					}
					if (message.defaults.model) {
						setModel(message.defaults.model);
					}
					return;
				case "sessions":
					setSessions(message.sessions);
					return;
				case "providers":
					setProviders(message.providers);
					setProvider((current) => {
						const currentProvider =
							current && message.providers.some((item) => item.id === current)
								? current
								: "";
						const savedProvider = readModelSelection().lastProvider;
						const nextProvider =
							currentProvider ||
							(savedProvider &&
							message.providers.some((item) => item.id === savedProvider)
								? savedProvider
								: "") ||
							message.providers.find((item) => item.enabled)?.id ||
							message.providers[0]?.id ||
							"";
						if (nextProvider) {
							postToHost({ type: "loadModels", providerId: nextProvider });
						}
						return nextProvider;
					});
					return;
				case "models":
					setModelsByProvider((current) => ({
						...current,
						[message.providerId]: message.models,
					}));
					setModel((current) => {
						if (current && message.models.some((item) => item.id === current)) {
							return current;
						}
						const nextDefaults = defaultsRef.current;
						if (
							nextDefaults.provider === message.providerId &&
							nextDefaults.model &&
							message.models.some((item) => item.id === nextDefaults.model)
						) {
							return nextDefaults.model;
						}
						const saved = readModelSelection();
						const rememberedModel =
							saved.lastModelByProvider[message.providerId];
						if (
							rememberedModel &&
							message.models.some((item) => item.id === rememberedModel)
						) {
							return rememberedModel;
						}
						return message.models[0]?.id || "";
					});
					return;
				case "session_started":
					sessionIdRef.current = message.sessionId;
					setSessionId(message.sessionId);
					onSessionSelectedRef.current?.(message.sessionId);
					setTitleEditing(false);
					setSessionTitleDraft("");
					// Session allows are per session, but the approval hook they
					// bypass is ClineCore's global one — without this, a grant made
					// in one session auto-approves the next session's tool calls
					// for as long as Drive stays active.
					setGateSession(clearGateSession());
					return;
				case "session_hydrated":
					if (
						hydratingSessionIdRef.current &&
						hydratingSessionIdRef.current !== message.sessionId
					) {
						return;
					}
					sessionIdRef.current = message.sessionId;
					hydratingSessionIdRef.current = undefined;
					setSessionId(message.sessionId);
					setHydratingSessionId(undefined);
					setSending(message.status === "running");
					if (message.providerId) {
						setProvider(message.providerId);
					}
					if (message.providerId && message.modelId) {
						const nextSelection: ModelSelectionStorage = {
							lastProvider: message.providerId,
							lastModelByProvider: {
								...lastSelectionRef.current.lastModelByProvider,
								[message.providerId]: message.modelId,
							},
						};
						lastSelectionRef.current = nextSelection;
						setLastSelection(nextSelection);
						writeModelSelection(nextSelection);
						setModel(message.modelId);
					}
					setTitleEditing(false);
					setSessionTitleDraft(
						sessionsRef.current
							.find((item) => item.sessionId === message.sessionId)
							?.title?.trim() || "",
					);
					setMessages((current) => {
						const merged =
							message.status === "running"
								? mergeHydratedMessagesWithLive(
										message.messages as ChatMessage[],
										current,
									)
								: (message.messages as ChatMessage[]);
						activeAssistantIdRef.current =
							message.status === "running"
								? [...merged]
										.reverse()
										.find((item) => item.role === "assistant")?.id
								: undefined;
						return merged;
					});
					setStatus(
						message.status === "running"
							? `Attached to ${message.sessionId} (running)`
							: `Attached to ${message.sessionId}`,
					);
					return;
				case "assistant_delta":
					setMessages((current) =>
						appendAssistantDelta(
							current,
							message.text,
							activeAssistantIdRef,
							message.speakerId,
						),
					);
					return;
				case "reasoning_delta":
					setMessages((current) =>
						appendReasoningDelta(
							current,
							message.text,
							message.redacted,
							activeAssistantIdRef,
						),
					);
					return;
				case "tool_event":
					setMessages((current) =>
						appendToolEvent(
							current,
							message.text,
							message.event,
							activeAssistantIdRef,
						),
					);
					if (
						driveRef.current.active &&
						message.event?.status === "failed" &&
						driveRef.current.bankSnapshot.nowTaskId
					) {
						const nowTaskId = driveRef.current.bankSnapshot.nowTaskId;
						const note =
							(typeof message.event.error === "string" &&
							message.event.error.trim()
								? message.event.error.trim()
								: undefined) ??
							(message.text?.trim() || "tool failed");
						void (async () => {
							const { snapshot, fromHub } = await mutateBankRecordFailure(
								bankSessionRef.current,
								defaultsRef.current.workspaceRoot,
								{ taskId: nowTaskId, note },
								{
									roomId: driveRef.current.roomId,
									callSessionId: driveRef.current.callSessionId,
								},
							);
							if (defaultsRef.current.workspaceRoot?.trim() && !fromHub) {
								return;
							}
							setDrive((current) => applyBankSnapshot(current, snapshot));
						})();
					}
					return;
				case "approval_request": {
					// DRV-GATES: a class the user already allowed "for this
					// session" must not re-queue a card — that is what
					// "allow for the session" means.
					const { bypass, actionClass } = resolveIncomingApprovalBypass({
						driveActive: driveRef.current.active,
						gateSession: gateSessionRef.current,
						toolName: message.toolName,
					});
					if (bypass) {
						postToHost({
							type: "approval_response",
							approvalId: message.approvalId,
							approved: true,
							reason: `Allow-for-session (${actionClass}): auto-approved, already allowed.`,
						});
						setStatus(`Auto-approved (session allow): ${message.toolName}`);
						return;
					}
					setPendingApprovals((current) => {
						const existingIndex = current.findIndex(
							(item) => item.approvalId === message.approvalId,
						);
						const next = { ...message, responding: false };
						if (existingIndex === -1) {
							return [...current, next];
						}
						return current.map((item, index) =>
							index === existingIndex ? next : item,
						);
					});
					setStatus(`Waiting for approval: ${message.toolName}`);
					return;
				}
				case "approval_resolved":
					setPendingApprovals((current) =>
						current.filter((item) => item.approvalId !== message.approvalId),
					);
					return;
				case "turn_done":
					setStatus(`Done (${message.finishReason})`);
					setSending(false);
					setPendingApprovals([]);
					activeAssistantIdRef.current = undefined;
					// PU4 session spend is call-scoped — ignore off-call / post-leave turns.
					if (driveRef.current.active) {
						setCallSpend((prev) => foldUsageIntoSpend(prev, message.usage));
					}
					setMessages((current) =>
						finalizeAssistantTurn(
							current,
							message.finishReason,
							message.iterations,
							message.usage,
						),
					);
					return;
				case "pending_prompts":
					setPendingSteers(
						message.prompts
							.filter((item) => item.delivery === "steer")
							.map((item) => ({ id: item.id, prompt: item.prompt })),
					);
					return;
				case "pending_prompt_submitted":
					setPendingSteers((current) =>
						current.filter((item) => item.id !== message.prompt.id),
					);
					if (message.prompt.delivery === "steer") {
						setDrive((current) =>
							applyBankSnapshot(current, current.bankSnapshot, {
								agencyBanner: steerAppliedBanner(),
							}),
						);
					}
					return;
				case "reset_done":
					sessionIdRef.current = undefined;
					hydratingSessionIdRef.current = undefined;
					setSessionId(undefined);
					setHydratingSessionId(undefined);
					setSending(false);
					setPendingSteers([]);
					setPendingApprovals([]);
					setTitleEditing(false);
					setSessionTitleDraft("");
					activeAssistantIdRef.current = undefined;
					onSessionSelectedRef.current?.(undefined);
					setStatus("Started a new chat session.");
					setMessages([]);
					return;
				case "fork_done":
					setForking(false);
					setForkError(null);
					setStatus(`Forked → new session ${message.newSessionId}`);
					return;
				case "fork_error":
					setForking(false);
					setForkError(message.text);
					setStatus(`Fork failed: ${message.text}`);
					return;
			}
		};

		const unsubscribe = subscribeToHostMessages({
			types: CHAT_HOST_MESSAGE_TYPES,
			guard: isChatHostMessage,
			onMessage: handleMessage,
		});
		postToHost({ type: "ready" });
		return unsubscribe;
	}, []);

	useEffect(() => {
		if (!initialSessionId || initialSessionIdRef.current === initialSessionId) {
			return;
		}
		initialSessionIdRef.current = initialSessionId;
		attachSession(initialSessionId);
	}, [attachSession, initialSessionId]);

	useEffect(() => {
		if (provider) {
			postToHost({ type: "loadModels", providerId: provider });
		}
	}, [provider]);

	useEffect(() => {
		if (!provider || !model) {
			return;
		}
		const previous = lastSelectionRef.current;
		if (
			previous.lastProvider === provider &&
			previous.lastModelByProvider[provider] === model
		) {
			return;
		}
		const nextSelection: ModelSelectionStorage = {
			lastProvider: provider,
			lastModelByProvider: {
				...previous.lastModelByProvider,
				[provider]: model,
			},
		};
		lastSelectionRef.current = nextSelection;
		setLastSelection(nextSelection);
		writeModelSelection(nextSelection);
	}, [provider, model]);

	const models = modelsByProvider[provider] ?? [];
	const modelSupportsReasoning =
		models.find((item) => item.id === model)?.supportsThinking === true;
	const effectiveReasonLevel = modelSupportsReasoning ? reasonLevel : "none";
	const visibleMessages = useMemo(
		() => messages.filter((message) => message.role !== "meta" || message.text),
		[messages],
	);
	const sessionTitle =
		sessionId &&
		typeof sessions.find((item) => item.sessionId === sessionId)?.title ===
			"string"
			? sessions.find((item) => item.sessionId === sessionId)?.title?.trim() ||
				""
			: "";
	const displayedSessionTitle = titleEditing ? sessionTitleDraft : sessionTitle;

	const commitSessionTitle = () => {
		if (!sessionId) {
			setTitleEditing(false);
			return;
		}
		const normalized = sessionTitleDraft.replace(/\s+/g, " ").trim();
		setTitleEditing(false);
		if (normalized === sessionTitle) {
			return;
		}
		setSessionTitleDraft(normalized);
		postToHost({
			type: "updateSessionMetadata",
			sessionId,
			metadata: {
				title: normalized,
			},
		});
	};

	const applyAddressSet = useCallback((addressSet: AddressSet) => {
		postToHost({
			type: "call_set_address",
			roomId: driveRef.current.roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			addressSet,
		});
	}, []);

	const flushComposerSend = useCallback(
		(input: {
			prompt: string;
			attachments?: WebviewChatAttachments;
			attachmentCount: number;
		}) => {
			if (isHydrating) {
				return;
			}
			const midTurn = sendingRef.current;
			const buildConfig = () => {
				const driveHint = drivePersonaSystemHint(drive);
				const base = systemPrompt.trim();
				return {
					autoApproveTools,
					enableSpawn,
					enableTeams,
					enableTools,
					maxIterations: parseMaxIterations(maxIterations),
					model: model || undefined,
					mode: drive.active ? toNativeMode(drive.subMode) : mode,
					provider: provider || undefined,
					reasonLevel: effectiveReasonLevel,
					systemPrompt:
						driveHint && base
							? `${driveHint}\n\n${base}`
							: driveHint || base || undefined,
				};
			};

			if (midTurn) {
				setMessages((current) => [
					...current,
					createMessage(
						"user",
						buildUserMessageLabel(
							input.prompt,
							input.attachments,
							input.attachmentCount,
						),
					),
				]);
				setStatus("Steer queued — will apply at the next tool boundary.");
				postToHost({
					type: "send",
					prompt: input.prompt,
					attachments: input.attachments,
					delivery: "steer",
					config: buildConfig(),
				});
				return;
			}

			const assistantMessage = createMessage("assistant", "");
			activeAssistantIdRef.current = assistantMessage.id;
			setMessages((current) => [
				...current,
				createMessage(
					"user",
					buildUserMessageLabel(
						input.prompt,
						input.attachments,
						input.attachmentCount,
					),
				),
				assistantMessage,
			]);
			setSending(true);
			setStatus("Running...");
			postToHost({
				type: "send",
				prompt: input.prompt,
				attachments: input.attachments,
				config: buildConfig(),
			});
			if (driveJoinNote) {
				setDriveJoinNote(null);
			}
		},
		[
			autoApproveTools,
			drive,
			driveJoinNote,
			effectiveReasonLevel,
			enableSpawn,
			enableTeams,
			enableTools,
			isHydrating,
			maxIterations,
			model,
			mode,
			provider,
			setDriveJoinNote,
			systemPrompt,
		],
	);

	const flushVoiceSend = useCallback(
		(prompt: string) => {
			const trimmed = prompt.trim();
			if (!trimmed || isHydrating) {
				return;
			}

			if (drive.muted) {
				setStatus(
					"Mic is muted. Unmute on the call strip before sending spoken input.",
				);
				return;
			}

			if (
				narrator &&
				shouldSpeakDriveTts({
					facets: driveVoice.facets,
					deafened: drive.deafened,
					partnerMuted: drive.partnerMuted,
				})
			) {
				const ack = buildVoiceAckNarration({
					profile: driveVoice.profile === "local" ? "local" : "cloud",
					partnerName: drive.partnerName,
					utterance: trimmed,
				});
				setDriveJoinNote(ack.text);
				narrator.speak(ack.text, {
					volume: driveVoice.hardware.outputVolume,
					sinkId: driveVoice.hardware.speakerDeviceId,
				});
			} else if (driveVoice.profile === "local") {
				const ack = buildVoiceAckNarration({
					profile: "local",
					partnerName: drive.partnerName,
					utterance: trimmed,
				});
				setDriveJoinNote(ack.text);
			}

			const midTurn = sendingRef.current;
			const voiceConfig = {
				autoApproveTools,
				enableSpawn,
				enableTeams,
				enableTools,
				maxIterations: parseMaxIterations(maxIterations),
				model: model || undefined,
				mode: drive.active ? toNativeMode(drive.subMode) : mode,
				provider: provider || undefined,
				reasonLevel: effectiveReasonLevel,
				systemPrompt: (() => {
					const driveHint = drivePersonaSystemHint(drive);
					const base = systemPrompt.trim();
					if (driveHint && base) {
						return `${driveHint}\n\n${base}`;
					}
					return driveHint || base || undefined;
				})(),
			};

			if (midTurn) {
				setMessages((current) => [...current, createMessage("user", trimmed)]);
				setStatus("Steer queued — will apply at the next tool boundary.");
				postToHost({
					type: "send",
					prompt: trimmed,
					source: "voice",
					delivery: "steer",
					config: voiceConfig,
				});
				setVoiceCaption(clearVoiceCaptionAfterSend());
				return;
			}

			const assistantMessage = createMessage("assistant", "");
			activeAssistantIdRef.current = assistantMessage.id;
			setMessages((current) => [
				...current,
				createMessage("user", trimmed),
				assistantMessage,
			]);
			setSending(true);
			setStatus("Running...");
			postToHost({
				type: "send",
				prompt: trimmed,
				source: "voice",
				config: voiceConfig,
			});
			setVoiceCaption(clearVoiceCaptionAfterSend());
		},
		[
			autoApproveTools,
			drive,
			driveVoice.facets,
			driveVoice.hardware.outputVolume,
			driveVoice.hardware.speakerDeviceId,
			driveVoice.profile,
			narrator,
			effectiveReasonLevel,
			enableSpawn,
			enableTeams,
			enableTools,
			isHydrating,
			maxIterations,
			model,
			mode,
			provider,
			setDriveJoinNote,
			setVoiceCaption,
			systemPrompt,
		],
	);

	const gateRouteThenFlush = useCallback(
		(pending: {
			prompt: string;
			attachments?: WebviewChatAttachments;
			attachmentCount: number;
			source: "voice" | "text";
		}) => {
			const flushPending = (held: {
				prompt: string;
				attachments?: WebviewChatAttachments;
				attachmentCount: number;
				source: "voice" | "text";
			}) => {
				if (held.source === "voice") {
					flushVoiceSend(held.prompt);
					return;
				}
				flushComposerSend({
					prompt: held.prompt,
					attachments: held.attachments,
					attachmentCount: held.attachmentCount,
				});
			};

			// Do not drop a held send when a new utterance arrives — skip-route flush first.
			if (pendingRouteSend) {
				const prior = pendingRouteSend;
				setRouteSuggestion(null);
				setPendingRouteSend(null);
				flushPending(prior);
			}

			const flush = () => {
				// Clear chip on immediate send so Accept/Skip cannot resend a stale hold.
				setRouteSuggestion(null);
				setPendingRouteSend(null);
				flushPending(pending);
			};

			if (!drive.active || routerMode === "manual") {
				flush();
				return;
			}

			const routed = suggestRouteForUtterance({
				utterance: pending.prompt,
				participants: drive.participants,
				mode: routerMode,
			});
			if (routed.autoAddressSet) {
				applyAddressSet(routed.autoAddressSet);
				flush();
				return;
			}
			if (routed.suggestion) {
				setRouteSuggestion(routed.suggestion);
				setPendingRouteSend(pending);
				return;
			}
			flush();
		},
		[
			applyAddressSet,
			drive.active,
			drive.participants,
			flushComposerSend,
			flushVoiceSend,
			pendingRouteSend,
			routerMode,
		],
	);

	const sendDrivePrompt = useCallback(
		(prompt: string) => {
			gateRouteThenFlush({
				prompt,
				attachmentCount: 0,
				source: "voice",
			});
		},
		[gateRouteThenFlush],
	);

	const acceptRouteSuggestion = useCallback(() => {
		if (!routeSuggestion || !pendingRouteSend) {
			return;
		}
		const pending = pendingRouteSend;
		applyAddressSet({
			mode: "agents",
			agentIds: [routeSuggestion.participantId],
		});
		setRouteSuggestion(null);
		setPendingRouteSend(null);
		if (pending.source === "voice") {
			flushVoiceSend(pending.prompt);
			return;
		}
		flushComposerSend({
			prompt: pending.prompt,
			attachments: pending.attachments,
			attachmentCount: pending.attachmentCount,
		});
	}, [
		applyAddressSet,
		flushComposerSend,
		flushVoiceSend,
		pendingRouteSend,
		routeSuggestion,
	]);

	const skipRouteSuggestion = useCallback(() => {
		if (!pendingRouteSend) {
			return;
		}
		const pending = pendingRouteSend;
		setRouteSuggestion(null);
		setPendingRouteSend(null);
		if (pending.source === "voice") {
			flushVoiceSend(pending.prompt);
			return;
		}
		flushComposerSend({
			prompt: pending.prompt,
			attachments: pending.attachments,
			attachmentCount: pending.attachmentCount,
		});
	}, [flushComposerSend, flushVoiceSend, pendingRouteSend]);

	const respondToApproval = (approvalId: string, approved: boolean) => {
		setPendingApprovals((current) =>
			current.map((item) =>
				item.approvalId === approvalId ? { ...item, responding: true } : item,
			),
		);
		postToHost({
			type: "approval_response",
			approvalId,
			approved,
			reason: approved ? "Approved in Cline Hub." : "Rejected in Cline Hub.",
		});
		setStatus(approved ? "Approval sent." : "Rejection sent.");
	};

	const respondToGateFeed = (
		approvalId: string,
		response: GateFeedResponse,
	) => {
		const approval = pendingApprovals.find(
			(item) => item.approvalId === approvalId,
		);
		if (!approval) {
			return;
		}
		const actionClass = classifyToolNameForGate(approval.toolName);
		if (response.kind === "deny") {
			setGateSession((current) =>
				recordGateDenial(current, actionClass, approval.toolName),
			);
		}
		if (response.kind === "allow_session") {
			// Scoped to this tool, not to response.actionClass — the class is a
			// catch-all bucket that would carry run_commands along with it.
			setGateSession((current) =>
				allowGateToolForSession(current, response.actionClass, approval.toolName),
			);
		}
		const approved =
			response.kind === "approve" || response.kind === "allow_session";
		const reason =
			response.kind === "allow_session"
				? `Allow-for-session (${response.actionClass}) in Drive feed.`
				: response.kind === "approve"
					? "Approved in Drive gate feed."
					: "Denied in Drive gate feed — partner must replan.";
		setPendingApprovals((current) =>
			current.map((item) =>
				item.approvalId === approvalId ? { ...item, responding: true } : item,
			),
		);
		postToHost({
			type: "approval_response",
			approvalId,
			approved,
			reason,
		});
		setStatus(
			response.kind === "deny"
				? "Gate denied — partner must replan."
				: response.kind === "allow_session"
					? "Gate allowed for this call session."
					: "Gate approved.",
		);
	};

	return (
		<PromptInputProvider>
			<div className="relative flex h-dvh flex-col overflow-hidden">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div className="min-w-0">
						{visibleSessions.length > 0 ? (
							<select
								className="max-w-48 rounded-md border bg-background px-2 py-1 text-xs"
								disabled={isHydrating}
								onChange={(event) => {
									const nextSessionId = event.target.value;
									if (!nextSessionId) {
										postToHost({ type: "reset" });
										setStatus("Resetting session...");
										setPendingApprovals([]);
										return;
									}
									attachSession(nextSessionId);
								}}
								value={sessionId ?? ""}
							>
								<option value="">New session</option>
								{visibleSessions.map((item) => (
									<option key={item.sessionId} value={item.sessionId}>
										{formatSessionLabel(item)}
									</option>
								))}
							</select>
						) : null}
						{isHydrating ? (
							<span className="ml-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
								<DriveMarkMotion
									className="size-3.5"
									motion="loading"
								/>
								Loading history
							</span>
						) : null}
						{sessionId ? (
							<input
								className="min-w-0 max-w-56 rounded-md border bg-muted px-2 py-1 text-xs"
								disabled={isHydrating}
								onBlur={commitSessionTitle}
								onChange={(event) => setSessionTitleDraft(event.target.value)}
								onFocus={() => {
									setTitleEditing(true);
									setSessionTitleDraft(sessionTitle);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitSessionTitle();
									}
								}}
								placeholder="Session title"
								value={displayedSessionTitle}
							/>
						) : null}
						{sessionId ? (
							<Button
								disabled={isHydrating}
								onClick={() => {
									setStatus(`Deleting ${sessionId}...`);
									postToHost({ type: "deleteSession", sessionId });
								}}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<Trash2Icon className="size-4" />
								<span className="sr-only">Delete session</span>
							</Button>
						) : null}
					</div>
					<div className="flex items-center gap-2">
						<DriveHeaderControls
							connectionPhase={connectionPhase}
							disabled={isHydrating}
							drive={drive}
							onEndDrive={appShell ? undefined : endDrive}
							// Wrapped, not by reference: joinDrive takes an optional
							// roomId, so onClick would pass the MouseEvent as one.
							onJoinDrive={() => joinDrive()}
							onLeaveDrive={() => {
								if (appShell) {
									writeLeaveKeepRunningNote();
									leaveDrive();
									onReturnToLobby?.();
									return;
								}
								leaveDrive();
							}}
							onToggleStageLayout={toggleStage}
						/>
						<Button
							disabled={isHydrating}
							onClick={() => {
								postToHost({ type: "reset" });
								setStatus("Resetting session...");
								setPendingApprovals([]);
							}}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<PlusIcon className="size-4" />
							<span className="sr-only">New chat</span>
						</Button>
					</div>
				</div>
				<DriveRoomChrome
					disabled={isHydrating}
					onAddRosterPack={addRosterPack}
					onCleanDrainContinue={continueCleanDrain}
					onCleanDrainDismiss={dismissCleanDrain}
					onPlanningImproveResolved={(decision, offerKey) => {
						if (decision === "mute" || decision === "reject") {
							setDismissedPlanImproveOfferKey(offerKey);
						}
					}}
					onSeatRecruit={seatRecruitCandidate}
					recruitFixtures={recruitFixtures}
					providerId={provider}
					seatCap={1}
					session={driveSession}
					showRoster={!stageLayout}
				/>
				<div
					className={cn(
						"flex min-h-0 min-w-0 flex-1",
						stageLayout ? "" : "flex-col",
						// NOW-LANDSCAPE: Spotlight | hold+strip (surfaces `.call-land`).
						appShell &&
							drive.active &&
							"landscape:grid landscape:grid-cols-[minmax(0,1.4fr)_minmax(12rem,0.9fr)] landscape:grid-rows-1",
					)}
				>
					{stageLayout ? (
						<Spotlight
							// The frame, not the backlog `status`, decides which chip
							// reads `showing` — a room sync can land after the present.
							activeShowId={presentedShow?.showItemId ?? null}
							artifact={presentedArtifact}
							backlog={showBacklog}
							cards={drive.stageCards}
							className="min-h-0 min-w-0 flex-1 landscape:min-h-0"
							demo={drive.demo}
							emptyHint={
								drive.demo
									? "Demo mode — join Drive to project live hub stage cards."
									: "Waiting for partner tool activity on this session."
							}
							feedCollapsed={feedCollapsed}
							humanPin={
								drive.stageSharer === "you" && drive.stagePin
									? {
											kind: drive.stagePin.kind,
											label: drive.stagePin.label,
											ref: drive.stagePin.ref,
										}
									: null
							}
							humanSharing={drive.stageSharer === "you"}
							// The presented show's caption is live narration —
							// `drive_script_beat` overwrites it with the spoken line, and a
							// beat can arrive before anything is staged. It outranks the
							// one-time join note, which is orientation copy.
							narration={presentedShow?.caption ?? driveJoinNote}
							nextLabel={
								drive.bankSnapshot.nextTitle ??
								drive.bankSnapshot.nextTaskId ??
								"—"
							}
							nowLabel={
								drive.bankSnapshot.nowTitle ??
								drive.bankSnapshot.nowTaskId ??
								(sending ? "partner working" : "idle")
							}
							onToggleFeed={toggleFeedCollapsed}
							sharerInk={spotlightSharerInk}
							sharerParticipant={
								drive.stageSharer === "agent" ? (spotlightSharer ?? null) : null
							}
							sharerLabel={
								drive.stageSharer === "you" ? "You" : drive.partnerName
							}
						>
							{showStuckRecovery && recoveryOfferTarget && !recruitStall ? (
								<StuckRecoveryFork
									className="mb-3"
									disabled={isHydrating}
									failureNote={recoveryOfferTarget.failureNote}
									nowTitle={drive.bankSnapshot.nowTitle}
									onAccept={acceptStuckRecovery}
									onDismiss={dismissStuckRecovery}
									source={recoveryOfferTarget.source}
									taskId={recoveryOfferTarget.taskId}
								/>
							) : null}
							{drive.active && pendingApprovals.length > 0 ? (
								<GateFeedCard
									approvals={pendingApprovals}
									className="mb-3"
									disabled={isHydrating}
									onRespond={respondToGateFeed}
									requesterLabel={drive.partnerName}
								/>
							) : null}
							{recruitStall ? (
								<RecruitStallPicker
									className="mb-3"
									disabled={isHydrating}
									need={recruitStall.need}
									onDismiss={() => setRecruitStall(null)}
									onSeat={seatRecruitCandidate}
									ranked={recruitStall.ranked}
								/>
							) : null}
						</Spotlight>
					) : null}
					<div
						className={
							stageLayout
								? cn(
										"flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l transition-[width,opacity] duration-300 ease-out motion-reduce:transition-none",
										feedCollapsed
											? "w-0 border-l-0 opacity-0"
											: // Desktop: fixed drawer. Phone: ~72%/230px rail so Spotlight stays visible (call-narrow-ia).
												"w-[340px] max-w-[45%] max-[720px]:w-[min(230px,72%)] max-[720px]:max-w-none",
									)
								: "flex min-h-0 flex-1 flex-col"
						}
						inert={stageLayout && feedCollapsed}
					>
						{stageLayout ? (
							<DriveRoster
								disabled={isHydrating}
								onAddRosterPack={addRosterPack}
								onSeatRecruit={seatRecruitCandidate}
								recruitFixtures={recruitFixtures}
								seatCap={1}
								session={driveSession}
							/>
						) : null}
						<ConversationPanel
							forkError={forkError}
							forking={forking}
							isHydrating={isHydrating}
							messages={visibleMessages}
							onFork={() => {
								setForking(true);
								setForkError(null);
								postToHost({ type: "forkSession" });
							}}
							participants={drive.participants}
							sending={sending}
							speakerInks={speakerInks}
						/>
						{drive.active ? null : (
							<PendingApprovalsPanel
								approvals={pendingApprovals}
								onRespond={respondToApproval}
							/>
						)}
						{drive.active && shouldShowGatesActiveStrip(gateSession) ? (
							<p
								className="border-t px-4 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
								data-slot="gates-active-strip"
							>
								Gates active — several high-impact denials this call.
							</p>
						) : null}
						{appShell ? null : (
							<DriveVoiceBar
								composition={callComposition}
								disabled={isHydrating}
								onSendSpoken={sendDrivePrompt}
								onSttError={setStatus}
								sending={sending}
								session={driveSession}
							/>
						)}
						{drive.active && !appShell ? (
							<DriveAddressChip
								addressSet={drive.addressSet}
								onAddressEveryone={() => applyAddressSet(EVERYONE_ADDRESS)}
								participants={drive.participants}
							/>
						) : null}
						{routeSuggestion && !appShell ? (
							<RouteSuggestChip
								onAccept={acceptRouteSuggestion}
								onDismiss={skipRouteSuggestion}
								suggestion={routeSuggestion}
							/>
						) : null}
						{/* App call: hold-to-talk owns send; desk composer steals thumb zone. */}
						{drive.active && appShell ? null : (
							<Composer
								autoApproveTools={autoApproveTools}
								disabled={isHydrating}
								enableSpawn={enableSpawn}
								enableTeams={enableTeams}
								enableTools={enableTools}
								maxIterations={maxIterations}
								model={model}
								mode={mode}
								modelSelectorOpen={modelSelectorOpen}
								models={models}
								onAbort={() => {
									postToHost({ type: "abort" });
									setStatus("Abort requested...");
								}}
								onAutoApproveToolsChange={setAutoApproveTools}
								onEnableSpawnChange={setEnableSpawn}
								onEnableTeamsChange={setEnableTeams}
								onEnableToolsChange={setEnableTools}
								onModeChange={setMode}
								onMaxIterationsChange={setMaxIterations}
								onModelChange={setModel}
								pendingSteers={pendingSteers}
								onModelSelectorOpenChange={setModelSelectorOpen}
								onProviderChange={(nextProvider) => {
									setProvider(nextProvider);
									const rememberedModel =
										lastSelection.lastModelByProvider[nextProvider];
									const providerModelIds = (
										modelsByProvider[nextProvider] ?? []
									).map((item) => item.id);
									if (
										rememberedModel &&
										providerModelIds.includes(rememberedModel)
									) {
										setModel(rememberedModel);
										return;
									}
									setModel("");
								}}
								onSend={({ prompt, attachments, attachmentCount }) => {
									gateRouteThenFlush({
										prompt,
										attachments,
										attachmentCount,
										source: "text",
									});
								}}
								onSystemPromptChange={setSystemPrompt}
								onReasonLevelChange={setReasonLevel}
								provider={provider}
								providers={providers}
								sending={sending}
								status={status}
								systemPrompt={systemPrompt}
								reasonLevel={effectiveReasonLevel}
								workspaceRoot={defaults.workspaceRoot}
							/>
						)}
					</div>
					{/*
					 * App chrome: hold + strip sit under the stage in portrait and in
					 * the right column in landscape (NOW-LANDSCAPE / NOW-HOLD-TALK).
					 */}
					{appShell ? (
						<div className="flex shrink-0 flex-col landscape:min-h-0 landscape:overflow-y-auto">
							<DriveVoiceBar
								composition={callComposition}
								disabled={isHydrating}
								onSendSpoken={sendDrivePrompt}
								onSttError={setStatus}
								sending={sending}
								session={driveSession}
							/>
							<DriveCallStripDock
								composition={callComposition}
								currentModel={currentModelId}
								disabled={isHydrating}
								modelShortlist={modelShortlist}
								onLeaveDrive={() => {
									writeLeaveKeepRunningNote();
									leaveDrive();
									onReturnToLobby?.();
								}}
								onSelectModel={selectPowerModel}
								planOpen={planSheetOpen}
								session={driveSession}
								spend={callSpend}
								turnInFlight={sending}
							/>
						</div>
					) : null}
				</div>
				{/*
				 * Hub: strip stays below the call surface. App mounts strip in the
				 * chrome column above (portrait bottom / landscape side).
				 */}
				{appShell ? null : (
					<DriveCallStripDock
						composition={callComposition}
						currentModel={currentModelId}
						disabled={isHydrating}
						modelShortlist={modelShortlist}
						onSelectModel={selectPowerModel}
						onTogglePlan={
							stageLayout
								? () => setPlanSheetOpen((open) => !open)
								: undefined
						}
						planOpen={planSheetOpen}
						session={driveSession}
						spend={callSpend}
						turnInFlight={sending}
					/>
				)}
				{/* ADR-0029 D4: audit is a sheet — not a Spotlight sibling. */}
				<Dialog
					onOpenChange={(open) => {
						if (open !== workersPanelOpen) {
							toggleWorkersPanel();
						}
					}}
					open={stageLayout && workersPanelOpen}
				>
					<DialogContent className="max-h-[min(36rem,85dvh)] max-w-md gap-0 overflow-y-auto p-0 sm:max-w-md">
						<DialogHeader className="sr-only">
							<DialogTitle>Worker audit</DialogTitle>
							<DialogDescription>
								Invisible workers and promote audit for this call.
							</DialogDescription>
						</DialogHeader>
						<div className="p-4">
							<ChatForkAuditPanel
								auditMessages={auditMessages}
								focusedAuditHandle={focusedAuditHandle}
								forks={chatForks}
								onClose={toggleWorkersPanel}
								onOpenAudit={openForkAudit}
								onRetain={setForkRetain}
								open
								showBacklog={showBacklog}
								summaryOnly={auditSummaryOnly}
							/>
						</div>
					</DialogContent>
				</Dialog>
				{/* ADR-0029 D4: plan/bank edits are a sheet, not Spotlight children. */}
				<Dialog
					onOpenChange={setPlanSheetOpen}
					open={stageLayout && planSheetOpen}
				>
					<DialogContent className="max-h-[min(36rem,85dvh)] max-w-md gap-0 overflow-y-auto p-0 sm:max-w-md">
						<DialogHeader className="border-b px-4 py-3 text-left">
							<DialogTitle>Plan</DialogTitle>
							<DialogDescription>
								Task bank cursor drives now/next. Completed tasks archive under
								.drive/bank/archive/.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 p-4 text-xs text-muted-foreground">
							{drive.pendingSdlcFreeze ? (
								<SdlcFreezeAcceptChip
									disabled={isHydrating}
									onAccept={() => {
										const proposal = drive.pendingSdlcFreeze;
										if (!proposal) {
											return;
										}
										void (async () => {
											const { snapshot, fromHub } =
												await mutateBankAcceptSdlcFreeze(
													bankSessionRef.current,
													defaults.workspaceRoot,
													proposal,
													{
														roomId: drive.roomId,
														callSessionId: drive.callSessionId,
													},
												);
											if (defaults.workspaceRoot?.trim() && !fromHub) {
												setStatus(
													"SDLC freeze not saved — workspace bank was not updated.",
												);
												return;
											}
											setDrive((prev) =>
												applyBankSnapshot(
													{
														...prev,
														pendingSdlcFreeze: null,
														agencyBanner:
															"Accepted phase-entry freeze into the bank",
													},
													snapshot,
												),
											);
											const tasks = await listPlanTasks(
												bankSessionRef.current,
												snapshot.activePlanId ?? "",
											);
											setPlanEditorTasks(
												tasks.map((t) => ({
													id: t.id,
													title: t.title,
												})),
											);
										})();
									}}
									onDismiss={() => {
										setDrive((prev) => ({
											...prev,
											pendingSdlcFreeze: null,
										}));
									}}
									proposal={drive.pendingSdlcFreeze}
								/>
							) : null}
							<PlanEditor
								nowLastFailure={drive.bankSnapshot.nowLastFailure}
								planId={drive.bankSnapshot.activePlanId}
								planTitle="Current work"
								tasks={planEditorTasks}
								onAdd={(task) => {
									void (async () => {
										const planId = drive.bankSnapshot.activePlanId;
										if (!planId) {
											return;
										}
										const recovery = hasNowLastFailure(drive.bankSnapshot);
										const { snapshot, fromHub } = await mutateBankCreateTask(
											bankSessionRef.current,
											defaults.workspaceRoot,
											{
												id: task.id,
												title: task.title,
												body: "",
												planId,
											},
											{
												roomId: drive.roomId,
												callSessionId: drive.callSessionId,
											},
										);
										if (defaults.workspaceRoot?.trim() && !fromHub) {
											setStatus(
												"Plan change not saved — workspace bank was not updated.",
											);
											return;
										}
										const baseline =
											cleanDrainCountersRef.current.activateTaskIds;
										if (baseline.length > 0 && !baseline.includes(task.id)) {
											cleanDrainCountersRef.current.midPlanAddCount += 1;
										}
										setPlanEditorTasks(
											await listPlanTasks(bankSessionRef.current, planId),
										);
										setDrive((current) =>
											applyBankSnapshot(current, snapshot, {
												mutation: "add",
												addedTitle: task.title,
												recovery,
											}),
										);
									})();
								}}
								onComplete={(taskId) => {
									void (async () => {
										const planId = drive.bankSnapshot.activePlanId;
										const prevSnapshot = drive.bankSnapshot;
										const { snapshot, fromHub } = await mutateBankCompleteTask(
											bankSessionRef.current,
											defaults.workspaceRoot,
											{
												taskId,
												...(driveRef.current.attributionAgentId
													? {
															agentId: driveRef.current.attributionAgentId,
														}
													: {}),
											},
											{
												roomId: drive.roomId,
												callSessionId: drive.callSessionId,
											},
										);
										if (defaults.workspaceRoot?.trim() && !fromHub) {
											setStatus(
												"Plan change not saved — workspace bank was not updated.",
											);
											return;
										}
										cleanDrainCountersRef.current.completedCount += 1;
										if (planId) {
											setPlanEditorTasks(
												await listPlanTasks(bankSessionRef.current, planId),
											);
										} else {
											setPlanEditorTasks([]);
										}
										setDrive((current) =>
											applyBankSnapshot(current, snapshot, {
												mutation: "complete",
											}),
										);
										maybeOfferCleanDrain(prevSnapshot, snapshot);
									})();
								}}
								onReorder={(taskIds) => {
									void (async () => {
										const planId = drive.bankSnapshot.activePlanId;
										if (!planId) {
											return;
										}
										const { snapshot, fromHub } = await mutateBankEditPlanTasks(
											bankSessionRef.current,
											defaults.workspaceRoot,
											{ planId, taskIds },
											{
												roomId: drive.roomId,
												callSessionId: drive.callSessionId,
											},
										);
										if (defaults.workspaceRoot?.trim() && !fromHub) {
											setStatus(
												"Plan change not saved — workspace bank was not updated.",
											);
											return;
										}
										setPlanEditorTasks(
											await listPlanTasks(bankSessionRef.current, planId),
										);
										setDrive((current) =>
											applyBankSnapshot(current, snapshot, {
												mutation: "reorder",
											}),
										);
									})();
								}}
							/>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</PromptInputProvider>
	);
}
