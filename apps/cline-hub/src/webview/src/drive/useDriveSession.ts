import {
	type ChatForkRecord,
	type DriveEvent,
	type RoomSnapshot,
	type ShowBacklogItem,
	topologyCacheKey,
} from "@cline/shared";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type HostMessage,
	isOptionalString,
	isRecord,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { getVsCodeApi, postToHost } from "../vscode";
import {
	createDriveBankSession,
	type DriveBankSession,
	listPlanTasks,
	seedBankForJoin,
} from "./bankSession";
import { isDriveRoomNotFoundError } from "./driveRoomPreview";
import { foldIncomingDriveEvent } from "./foldRoomSnapshot";
import {
	isDriveHumanId,
	isDrivePartnerId,
	toggleDriveSpotlightId,
} from "./participantIds";
import { resolveNarratorParticipantId } from "./rosterHelpers";
import {
	applyBankSnapshot,
	applyRoomSnapshot,
	applySubModeIntent,
	clearPostureOverride,
	DEFAULT_DRIVE_UI,
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	type DriveUiState,
	fromSharedDriveSubMode,
	toNativeMode,
	toSharedDriveSubMode,
} from "./types";
import { createVoiceStack } from "./voice/createVoiceStack";
import { normalizeDriveHardwarePrefs } from "./voice/driveHardwarePrefs";
import { createDriveNarrator, type DriveNarrator } from "./voice/driveNarrator";
import {
	applyHardwarePrefsPatch,
	applyVoiceFacetPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	type DriveVoiceUi,
	isSpokenDriveJoinNote,
	resolveDriveVoiceTopology,
	shouldSpeakDriveTts,
} from "./voice/driveVoiceUi";
import {
	buildDrivePersistPayload,
	clearVoiceCaptionDraft,
	shouldClearVoiceCaption,
} from "./voice/voiceCaptionState";

function readPersistedDriveUi(): DriveUiState {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveUi?: DriveUiState }
			| undefined;
		if (state?.driveUi) {
			return {
				...DEFAULT_DRIVE_UI,
				...state.driveUi,
				bankSnapshot:
					state.driveUi.bankSnapshot ?? DEFAULT_DRIVE_UI.bankSnapshot,
				postureOverride: state.driveUi.postureOverride ?? null,
				deafened: state.driveUi.deafened ?? DEFAULT_DRIVE_UI.deafened,
				spotlightParticipantId:
					state.driveUi.spotlightParticipantId ??
					DEFAULT_DRIVE_UI.spotlightParticipantId,
				partnerMuted:
					state.driveUi.partnerMuted ?? DEFAULT_DRIVE_UI.partnerMuted,
				partnerDeafened:
					state.driveUi.partnerDeafened ?? DEFAULT_DRIVE_UI.partnerDeafened,
				stageCards: state.driveUi.stageCards ?? DEFAULT_DRIVE_UI.stageCards,
				stagePin:
					state.driveUi.stagePin === undefined
						? DEFAULT_DRIVE_UI.stagePin
						: state.driveUi.stagePin,
				participants:
					state.driveUi.participants ?? DEFAULT_DRIVE_UI.participants,
				focusedParticipantId:
					state.driveUi.focusedParticipantId ??
					DEFAULT_DRIVE_UI.focusedParticipantId,
				addressFollowsFocusParticipantId:
					state.driveUi.addressFollowsFocusParticipantId ??
					DEFAULT_DRIVE_UI.addressFollowsFocusParticipantId,
				partnerNameInk:
					state.driveUi.partnerNameInk ?? DEFAULT_DRIVE_UI.partnerNameInk,
				callSessionId:
					state.driveUi.callSessionId ?? DEFAULT_DRIVE_UI.callSessionId,
				// Transient playback state — a reload is never mid-utterance.
				speakingParticipantId: null,
				// One-shot banners should not survive reload.
				agencyBanner: null,
				cleanDrainInvite: null,
				attributionAgentId: null,
				pendingSdlcFreeze: null,
				pendingPlanningImprove: null,
			};
		}
	} catch {
		// ignore
	}
	return DEFAULT_DRIVE_UI;
}

function readPersistedDriveVoice(): DriveVoiceUi {
	try {
		const state = getVsCodeApi()?.getState() as
			| { driveVoice?: DriveVoiceUi }
			| undefined;
		if (state?.driveVoice?.facets && state.driveVoice.profile) {
			const defaults = createDefaultDriveVoiceUi(state.driveVoice.profile);
			return {
				...defaults,
				...state.driveVoice,
				facets: {
					...defaults.facets,
					...state.driveVoice.facets,
				},
				hardware: normalizeDriveHardwarePrefs({
					...defaults.hardware,
					...state.driveVoice.hardware,
				}),
			};
		}
	} catch {
		// ignore
	}
	return createDefaultDriveVoiceUi("cloud");
}

export type UseDriveSessionArgs = {
	providerId: string;
	sending: boolean;
	disabled: boolean;
	onModeChange: (mode: "act" | "plan") => void;
	onAbort: () => void;
	onStatus: (text: string) => void;
	/** Link call_join to the active chat session when available. */
	sessionId?: string | null;
	/** Workspace root for hub durable bank seed (drive_bank_seed). */
	workspaceRoot?: string;
};

export type DriveConnectionPhase = "off" | "joining" | "on" | "error";

export type DriveCallErrorResolution =
	| {
			kind: "reset";
			note: string;
			phase: Extract<DriveConnectionPhase, "off" | "error">;
	  }
	| {
			kind: "refresh";
			note: string;
	  }
	| {
			kind: "notice";
			note: string;
	  };

export function resolveDriveCallError({
	code,
	command,
	text,
	wasJoining,
}: {
	code?: string;
	command?: string;
	text?: string;
	wasJoining: boolean;
}): DriveCallErrorResolution {
	const detail = text?.trim();
	if (isDriveRoomNotFoundError({ code, text })) {
		const joinFailed =
			wasJoining && (command === undefined || command === "call_join");
		if (command === "call_join" && !joinFailed) {
			return {
				kind: "notice",
				note: detail
					? `Could not attach this Chat session to Drive: ${detail}`
					: "Could not attach this Chat session to Drive.",
			};
		}
		return {
			kind: "reset",
			note: joinFailed
				? detail
					? `Could not join Drive: ${detail}`
					: "Could not join Drive."
				: "The Drive call is no longer available.",
			phase: joinFailed ? "error" : "off",
		};
	}
	if (wasJoining && (command === undefined || command === "call_join")) {
		return {
			kind: "reset",
			note: detail
				? `Could not join Drive: ${detail}`
				: "Could not join Drive.",
			phase: "error",
		};
	}
	if (command === "call_get_room") {
		return {
			kind: "notice",
			note: detail
				? `Could not refresh the Drive call: ${detail}`
				: "Could not refresh the Drive call.",
		};
	}
	if (command === "call_join") {
		return {
			kind: "notice",
			note: detail
				? `Could not attach this Chat session to Drive: ${detail}`
				: "Could not attach this Chat session to Drive.",
		};
	}
	return {
		kind: "refresh",
		note:
			command === "call_rename_participant"
				? detail
					? `Could not rename participant: ${detail}`
					: "Could not rename participant."
				: detail || "Drive call command failed.",
	};
}

export function isDriveRoomSnapshotForTarget({
	expectedRoomId,
	outerRoomId,
	snapshotRoomId,
}: {
	expectedRoomId: string;
	outerRoomId?: string;
	snapshotRoomId: string;
}): boolean {
	return (
		snapshotRoomId === expectedRoomId &&
		(outerRoomId === undefined || outerRoomId === expectedRoomId)
	);
}

type DriveSessionHostMessage = HostMessage & {
	type:
		| "drive_show_presented"
		| "drive_script_beat"
		| "call_error"
		| "drive_fork_audit"
		| "room_snapshot"
		| "drive_event"
		| "drive_room_changed";
	text?: string;
	code?: string;
	command?: string;
	seq?: number;
	showItemId?: string | null;
	title?: string;
	caption?: string;
	uri?: string;
	say?: string;
	ownerParticipantId?: string;
	roomId?: string;
	callSessionId?: string;
	whileAwayNote?: string;
	handoffNarration?: string;
	snapshot?: RoomSnapshot;
	event?: DriveEvent;
	auditHandle?: string;
	messages?: unknown[];
	summaryOnly?: boolean;
	room?: {
		spotlightParticipantId?: string | null;
		participantAudio?: Array<{
			participantId: string;
			muted: boolean;
			deafened: boolean;
		}>;
		director?: {
			activeShowId?: string | null;
			stickyShowIds?: string[];
			showBacklog?: Array<{
				id: string;
				title: string;
				caption: string;
				artifactKind?: string;
				uri?: string;
				ownerParticipantId: string;
				/**
				 * The source the hub materialized `uri` from. The Spotlight
				 * re-renders artifacts from it client-side, so it is a read field
				 * here even though nothing in this hook consumes it.
				 */
				produce?: {
					tool?: string;
					templateId?: string;
					args?: Record<string, unknown>;
				};
			}>;
		};
		chatForks?: ChatForkRecord[];
	};
};

const DRIVE_SESSION_MESSAGE_TYPES = [
	"drive_show_presented",
	"drive_script_beat",
	"call_error",
	"drive_fork_audit",
	"room_snapshot",
	"drive_event",
	"drive_room_changed",
] as const;

/**
 * Structural check for hub RoomSnapshot payloads covering the fields this
 * hook and applyRoomSnapshot consume — the same shallow-trust idiom as the
 * hub server's asRoomSnapshot. Deeper drive state flows through the shared
 * reducer, which re-validates events via parseDriveEvent.
 */
function isRoomSnapshotPayload(value: unknown): value is RoomSnapshot {
	if (
		!isRecord(value) ||
		typeof value.roomId !== "string" ||
		typeof value.driveActive !== "boolean" ||
		typeof value.subMode !== "string" ||
		!isRecord(value.muteByParticipantId) ||
		!isRecord(value.raisedHandByParticipantId)
	) {
		return false;
	}
	if (
		!Array.isArray(value.participants) ||
		!value.participants.every(
			(participant) =>
				isRecord(participant) &&
				typeof participant.id === "string" &&
				typeof participant.kind === "string" &&
				isOptionalString(participant.displayName),
		)
	) {
		return false;
	}
	const stage = value.stage;
	if (!isRecord(stage) || !Array.isArray(stage.cards)) {
		return false;
	}
	if (
		stage.sharer !== null &&
		stage.sharer !== undefined &&
		(!isRecord(stage.sharer) ||
			typeof stage.sharer.kind !== "string" ||
			typeof stage.sharer.participantId !== "string")
	) {
		return false;
	}
	if (stage.pin !== null && stage.pin !== undefined && !isRecord(stage.pin)) {
		return false;
	}
	return true;
}

function isDriveEventPayload(value: unknown): value is DriveEvent {
	// Shallow: foldIncomingDriveEvent re-validates via parseDriveEvent and
	// falls back to the hub snapshot when the event is malformed.
	return (
		isRecord(value) &&
		typeof value.type === "string" &&
		(value.type !== "conversation.narration" || typeof value.text === "string")
	);
}

function isDriveRoomChangedRoom(
	value: unknown,
): value is NonNullable<DriveSessionHostMessage["room"]> {
	if (!isRecord(value)) {
		return false;
	}
	if (
		value.spotlightParticipantId !== undefined &&
		value.spotlightParticipantId !== null &&
		typeof value.spotlightParticipantId !== "string"
	) {
		return false;
	}
	if (value.participantAudio !== undefined) {
		if (
			!Array.isArray(value.participantAudio) ||
			!value.participantAudio.every(
				(flags) =>
					isRecord(flags) &&
					typeof flags.participantId === "string" &&
					typeof flags.muted === "boolean" &&
					typeof flags.deafened === "boolean",
			)
		) {
			return false;
		}
	}
	if (value.director !== undefined) {
		if (!isRecord(value.director)) {
			return false;
		}
		const activeShowId = value.director.activeShowId;
		if (
			activeShowId !== undefined &&
			activeShowId !== null &&
			typeof activeShowId !== "string"
		) {
			return false;
		}
		const stickyShowIds = value.director.stickyShowIds;
		if (
			stickyShowIds !== undefined &&
			(!Array.isArray(stickyShowIds) ||
				!stickyShowIds.every((id) => typeof id === "string"))
		) {
			return false;
		}
		const backlog = value.director.showBacklog;
		if (
			backlog !== undefined &&
			(!Array.isArray(backlog) ||
				!backlog.every(
					(item) =>
						isRecord(item) &&
						typeof item.id === "string" &&
						typeof item.title === "string" &&
						typeof item.caption === "string" &&
						isOptionalString(item.artifactKind) &&
						isOptionalString(item.uri) &&
						typeof item.ownerParticipantId === "string",
				))
		) {
			return false;
		}
	}
	if (value.chatForks !== undefined) {
		// Fork records are display-only here; deep fields render as React text.
		if (
			!Array.isArray(value.chatForks) ||
			!value.chatForks.every(
				(fork) => isRecord(fork) && typeof fork.id === "string",
			)
		) {
			return false;
		}
	}
	return true;
}

export function isDriveSessionHostMessage(
	message: HostMessage,
): message is DriveSessionHostMessage {
	switch (message.type) {
		case "drive_show_presented":
			return (
				typeof message.showItemId === "string" &&
				isOptionalString(message.title) &&
				isOptionalString(message.caption) &&
				isOptionalString(message.uri) &&
				isOptionalString(message.ownerParticipantId)
			);
		case "drive_script_beat":
			return (
				isOptionalString(message.say) &&
				(message.showItemId === undefined ||
					message.showItemId === null ||
					typeof message.showItemId === "string")
			);
		case "call_error":
			return (
				isOptionalString(message.text) &&
				isOptionalString(message.code) &&
				isOptionalString(message.command)
			);
		case "drive_fork_audit":
			return (
				isOptionalString(message.auditHandle) &&
				(message.messages === undefined || Array.isArray(message.messages)) &&
				(message.summaryOnly === undefined ||
					typeof message.summaryOnly === "boolean")
			);
		case "room_snapshot":
		case "drive_event":
			return (
				isOptionalString(message.roomId) &&
				(message.seq === undefined || typeof message.seq === "number") &&
				isOptionalString(message.callSessionId) &&
				isOptionalString(message.whileAwayNote) &&
				isOptionalString(message.handoffNarration) &&
				(message.snapshot === undefined ||
					isRoomSnapshotPayload(message.snapshot)) &&
				(message.event === undefined || isDriveEventPayload(message.event))
			);
		case "drive_room_changed":
			return message.room === undefined || isDriveRoomChangedRoom(message.room);
		default:
			return false;
	}
}

export function resolveDriveTargetRoomId({
	requestedRoomId,
	currentRoomId,
	expectedRoomId,
}: {
	requestedRoomId?: string | null;
	currentRoomId?: string | null;
	expectedRoomId?: string | null;
}): string {
	for (const candidate of [
		requestedRoomId,
		currentRoomId,
		expectedRoomId,
		DRIVE_DEFAULT_ROOM_ID,
	]) {
		// typeof, not just optional-chaining: these ids reach us from React
		// handlers and persisted storage, where a non-string can slip in.
		const normalized =
			typeof candidate === "string" ? candidate.trim() : undefined;
		if (normalized) {
			return normalized;
		}
	}
	return DRIVE_DEFAULT_ROOM_ID;
}

export function hasPendingDriveJoinRequest({
	pendingRoomJoin,
	pendingAttachedSessionId,
}: {
	pendingRoomJoin: boolean;
	pendingAttachedSessionId: string | null;
}): boolean {
	return pendingRoomJoin || pendingAttachedSessionId !== null;
}

export function shouldReattachDriveSession({
	active,
	confirmedAttachedSessionId,
	connectionPhase,
	driveIntended,
	failedAttachedSessionId,
	pendingAttachedSessionId,
	sessionId,
}: {
	active: boolean;
	confirmedAttachedSessionId: string | null;
	connectionPhase: DriveConnectionPhase;
	driveIntended: boolean;
	failedAttachedSessionId: string | null;
	pendingAttachedSessionId: string | null;
	sessionId?: string | null;
}): boolean {
	const normalizedSessionId = sessionId?.trim();
	return Boolean(
		normalizedSessionId &&
			connectionPhase === "on" &&
			active &&
			driveIntended &&
			confirmedAttachedSessionId !== normalizedSessionId &&
			pendingAttachedSessionId === null &&
			failedAttachedSessionId !== normalizedSessionId,
	);
}

/** Director show currently bound to the Spotlight frame (hub-authored). */
export type PresentedShow = {
	showItemId: string;
	/** ShowArtifactKind of the active backlog item — presenter-bar eyebrow. */
	artifactKind?: string;
	/** Sticky policy in force for this show ("hold" | "replace"). */
	sticky?: "hold" | "replace";
	title?: string;
	caption?: string;
	uri?: string;
	ownerParticipantId?: string;
};

export type UseDriveSessionResult = {
	drive: DriveUiState;
	setDrive: Dispatch<SetStateAction<DriveUiState>>;
	connectionPhase: DriveConnectionPhase;
	driveVoice: DriveVoiceUi;
	setDriveVoice: Dispatch<SetStateAction<DriveVoiceUi>>;
	driveJoinNote: string | null;
	setDriveJoinNote: Dispatch<SetStateAction<string | null>>;
	voiceCaption: string;
	setVoiceCaption: Dispatch<SetStateAction<string>>;
	planEditorTasks: Array<{ id: string; title: string; lastFailure?: string }>;
	setPlanEditorTasks: Dispatch<
		SetStateAction<Array<{ id: string; title: string }>>
	>;
	bankSessionRef: React.RefObject<DriveBankSession>;
	driveVoiceResolved: ReturnType<typeof resolveDriveVoiceTopology>;
	/**
	 * Narration playback for the resolved topology. Null until a topology
	 * resolves. Every spoken line goes through this so the queue and speaking
	 * presence stay authoritative.
	 */
	narrator: DriveNarrator | null;
	/** Workspace root for durable bank / agent-home hub ops. */
	workspaceRoot?: string;
	joinDrive: (roomId?: string) => boolean;
	leaveDrive: () => void;
	/** End closes the room after Tier-0 handoff (distinct from leave). */
	endDrive: () => void;
	refreshDriveRoom: (roomId?: string) => boolean;
	toggleDrive: () => void;
	toggleStage: () => void;
	presentedShow: PresentedShow | null;
	chatForks: ChatForkRecord[];
	showBacklog: ShowBacklogItem[];
	workersPanelOpen: boolean;
	focusedAuditHandle: string | null;
	auditMessages: unknown[];
	auditSummaryOnly: boolean;
	toggleWorkersPanel: () => void;
	openForkAudit: (auditHandle: string) => void;
	setForkRetain: (workerSessionId: string, retain: boolean) => void;
	stripHandlers: {
		onClearOverride: () => void;
		onDeafenToggle: () => void;
		onHandToggle: () => void;
		onMuteToggle: () => void;
		onOpenSettings: () => void;
		onTogglePartnerDeafen: () => void;
		onTogglePartnerMute: () => void;
		onToggleSpotlight: () => void;
		onToggleWorkers?: () => void;
		onSubModeChange: (mode: DriveUiState["subMode"]) => void;
	};
};

export function useDriveSession(
	args: UseDriveSessionArgs,
): UseDriveSessionResult {
	const [drive, setDrive] = useState<DriveUiState>(readPersistedDriveUi);
	const [connectionPhase, setConnectionPhase] = useState<DriveConnectionPhase>(
		() => (drive.active ? "on" : "off"),
	);
	const [driveJoinNote, setDriveJoinNote] = useState<string | null>(null);
	const [driveVoice, setDriveVoice] = useState<DriveVoiceUi>(
		readPersistedDriveVoice,
	);
	const [voiceCaption, setVoiceCaptionState] = useState("");
	/**
	 * Last line the partner should say (DRV-NARRATION). React state only —
	 * spoken text never reaches the persisted `driveUi` blob (DRV-PRIVACY),
	 * and `seq` distinguishes a repeated line from a re-render.
	 */
	const [narrationLine, setNarrationLine] = useState<{
		seq: number;
		text: string;
	} | null>(null);
	const narrationSeqRef = useRef(0);
	const spokenNarrationSeqRef = useRef(0);
	const queueNarration = useCallback((text: string) => {
		const trimmed = text.trim();
		// The join effect owns greeting / catch-up copy; speaking it here too
		// would double it up.
		if (!trimmed || isSpokenDriveJoinNote(trimmed)) {
			return;
		}
		narrationSeqRef.current += 1;
		setNarrationLine({ seq: narrationSeqRef.current, text: trimmed });
	}, []);
	const [presentedShow, setPresentedShow] = useState<PresentedShow | null>(
		null,
	);
	const [chatForks, setChatForks] = useState<ChatForkRecord[]>([]);
	const [showBacklog, setShowBacklog] = useState<ShowBacklogItem[]>([]);
	const [workersPanelOpen, setWorkersPanelOpen] = useState(false);
	const [focusedAuditHandle, setFocusedAuditHandle] = useState<string | null>(
		null,
	);
	const [auditMessages, setAuditMessages] = useState<unknown[]>([]);
	const [auditSummaryOnly, setAuditSummaryOnly] = useState(false);
	const bankSessionRef = useRef<DriveBankSession>(createDriveBankSession());
	const [planEditorTasks, setPlanEditorTasks] = useState<
		Array<{ id: string; title: string; lastFailure?: string }>
	>([]);
	/** True between call_join and the first successful room_snapshot. */
	const pendingJoinRef = useRef(false);
	/** Last hub room seq for afterSeq gap fill on reconnect / get_room. */
	const roomSeqRef = useRef(0);
	/** Local RoomSnapshot for reduceRoom fold (same kernel as hub). */
	const roomSnapshotRef = useRef<RoomSnapshot | null>(null);
	/** Room whose snapshots may authoritatively mutate this hook. */
	const expectedRoomIdRef = useRef(drive.roomId ?? DRIVE_DEFAULT_ROOM_ID);
	/**
	 * Local intent to be on the Drive call (joining or seated).
	 * Cleared synchronously on leave/cancel so late hub snapshots cannot rejoin
	 * or sync chat mode after the user opted out.
	 */
	const driveIntentRef = useRef(drive.active);
	const sessionIdRef = useRef(args.sessionId);
	/** Chat session attachment confirmed by a matching seated room snapshot. */
	const confirmedAttachedSessionIdRef = useRef<string | null>(null);
	/** Chat session sent in call_join but not yet confirmed by a snapshot. */
	const pendingAttachedSessionIdRef = useRef<string | null>(null);
	/** Failed attachment suppressed from automatic retry until explicit join. */
	const failedAttachedSessionIdRef = useRef<string | null>(null);
	const [attachmentRevision, setAttachmentRevision] = useState(0);
	const workspaceRootRef = useRef(args.workspaceRoot);
	const onModeChangeRef = useRef(args.onModeChange);
	const driveRef = useRef(drive);
	const connectionPhaseRef = useRef(connectionPhase);
	sessionIdRef.current = args.sessionId;
	workspaceRootRef.current = args.workspaceRoot;
	onModeChangeRef.current = args.onModeChange;
	driveRef.current = drive;
	connectionPhaseRef.current = connectionPhase;

	/**
	 * Single choke point for spoken text (DRV-CAPTIONS). A transcript that
	 * resolves after the mic went quiet — a whisper round-trip still in flight,
	 * say — is dropped instead of surfacing when the user unmutes.
	 */
	const setVoiceCaption = useCallback<Dispatch<SetStateAction<string>>>(
		(value) => {
			setVoiceCaptionState((current) => {
				if (
					shouldClearVoiceCaption({
						muted: driveRef.current.muted,
						active: driveRef.current.active,
					})
				) {
					return clearVoiceCaptionDraft();
				}
				return typeof value === "function" ? value(current) : value;
			});
		},
		[],
	);

	/** Mute or hang up: discard the draft and any partial mid-utterance. */
	useEffect(() => {
		if (shouldClearVoiceCaption({ muted: drive.muted, active: drive.active })) {
			setVoiceCaptionState(clearVoiceCaptionDraft());
		}
	}, [drive.muted, drive.active]);

	useEffect(() => {
		try {
			const api = getVsCodeApi();
			if (!api) {
				return;
			}
			const state = (api.getState() as Record<string, unknown>) ?? {};
			api.setState(
				buildDrivePersistPayload({
					existing: state,
					driveUi: drive,
					driveVoice,
				}),
			);
		} catch {
			// ignore
		}
	}, [drive, driveVoice]);

	const resetDriveConnection = useCallback(
		({
			note,
			phase,
		}: {
			note: string | null;
			phase: Extract<DriveConnectionPhase, "off" | "error">;
		}) => {
			const current = driveRef.current;
			pendingJoinRef.current = false;
			driveIntentRef.current = false;
			roomSnapshotRef.current = null;
			roomSeqRef.current = 0;
			confirmedAttachedSessionIdRef.current = null;
			pendingAttachedSessionIdRef.current = null;
			failedAttachedSessionIdRef.current = null;
			connectionPhaseRef.current = phase;
			setConnectionPhase(phase);
			setDriveJoinNote(note);
			setPlanEditorTasks([]);
			setDrive({
				...DEFAULT_DRIVE_UI,
				partnerName: current.partnerName,
				partnerNameInk: current.partnerNameInk,
			});
			onModeChangeRef.current("act");
		},
		[],
	);

	const sendDriveJoin = useCallback(
		(
			current: DriveUiState,
			sessionId?: string | null,
			targetRoomId?: string,
		) => {
			const roomId = resolveDriveTargetRoomId({
				requestedRoomId: targetRoomId,
				currentRoomId: current.roomId,
				expectedRoomId: expectedRoomIdRef.current,
			});
			if (expectedRoomIdRef.current !== roomId) {
				expectedRoomIdRef.current = roomId;
				roomSnapshotRef.current = null;
				roomSeqRef.current = 0;
			}
			const payload: {
				type: "call_join";
				roomId: string;
				human: { id: string; displayName: string };
				agent: { id: string; displayName: string };
				activateDrive: boolean;
				sessionId?: string;
				workspaceRoot?: string;
			} = {
				type: "call_join",
				roomId,
				human: {
					id: DRIVE_PARTICIPANT_HUMAN,
					displayName: "You",
				},
				agent: {
					id: DRIVE_PARTICIPANT_PARTNER,
					displayName: current.partnerName,
				},
				activateDrive: true,
			};
			const normalizedSessionId = sessionId?.trim();
			if (normalizedSessionId) {
				payload.sessionId = normalizedSessionId;
				pendingAttachedSessionIdRef.current = normalizedSessionId;
			}
			const workspaceRoot = workspaceRootRef.current?.trim();
			if (workspaceRoot) {
				payload.workspaceRoot = workspaceRoot;
			}
			postToHost(payload);
		},
		[],
	);

	const joinDrive = useCallback(
		(targetRoomId?: string) => {
			if (connectionPhaseRef.current === "joining") {
				return false;
			}
			const current = driveRef.current;
			const roomId = resolveDriveTargetRoomId({
				requestedRoomId: targetRoomId,
				currentRoomId: current.roomId,
				expectedRoomId: expectedRoomIdRef.current,
			});
			if (expectedRoomIdRef.current !== roomId) {
				expectedRoomIdRef.current = roomId;
				roomSnapshotRef.current = null;
				roomSeqRef.current = 0;
			}
			driveIntentRef.current = true;
			const joiningDifferentRoom =
				current.roomId !== null && current.roomId !== roomId;
			if (
				connectionPhaseRef.current !== "on" ||
				!current.active ||
				joiningDifferentRoom
			) {
				pendingJoinRef.current = true;
				roomSnapshotRef.current = null;
				roomSeqRef.current = 0;
				connectionPhaseRef.current = "joining";
				setConnectionPhase("joining");
				setDriveJoinNote("Joining Drive call…");
			}
			const sessionId = sessionIdRef.current?.trim();
			if (sessionId) {
				// Explicit Start/Rejoin is always allowed to retry a failed attachment.
				failedAttachedSessionIdRef.current = null;
			}
			sendDriveJoin(current, sessionId, roomId);
			return true;
		},
		[sendDriveJoin],
	);

	const leaveDrive = useCallback(() => {
		const current = driveRef.current;
		postToHost({
			type: "call_leave",
			roomId: current.roomId ?? DRIVE_DEFAULT_ROOM_ID,
			participantId: DRIVE_PARTICIPANT_HUMAN,
		});
		resetDriveConnection({ note: null, phase: "off" });
	}, [resetDriveConnection]);

	/**
	 * End the Drive session (DRV-LEAVE-END / DRV-RETURN-LOOP).
	 * Distinct from leave: hub assembles Tier-0 handoff, publishes narration,
	 * then closes the room. Leave only removes the human and persists work.
	 * Do not clear chrome here — wait for room_snapshot so handoffNarration paints.
	 */
	const endDrive = useCallback(() => {
		const current = driveRef.current;
		const payload: {
			type: "call_end";
			roomId: string;
			actorId: string;
			workspaceRoot?: string;
		} = {
			type: "call_end",
			roomId: current.roomId ?? DRIVE_DEFAULT_ROOM_ID,
			actorId: DRIVE_PARTICIPANT_HUMAN,
		};
		const workspaceRoot = workspaceRootRef.current?.trim();
		if (workspaceRoot) {
			payload.workspaceRoot = workspaceRoot;
		}
		postToHost(payload);
	}, []);

	const refreshDriveRoom = useCallback(
		(targetRoomId?: string) => {
			const explicitlyTargeted = Boolean(targetRoomId?.trim());
			if (connectionPhaseRef.current !== "on" && !explicitlyTargeted) {
				return false;
			}
			const current = driveRef.current;
			const roomId = resolveDriveTargetRoomId({
				requestedRoomId: targetRoomId,
				currentRoomId: current.roomId,
				expectedRoomId: expectedRoomIdRef.current,
			});
			if (!roomId) {
				resetDriveConnection({
					note: "The Drive call is no longer available.",
					phase: "off",
				});
				return true;
			}
			if (expectedRoomIdRef.current !== roomId) {
				expectedRoomIdRef.current = roomId;
				roomSnapshotRef.current = null;
				roomSeqRef.current = 0;
			}
			if (explicitlyTargeted) {
				// A Drive-home "Return" is an assertion that this room is the local
				// call target. The snapshot still decides whether the human is seated.
				driveIntentRef.current = true;
			}
			const payload: {
				type: "call_get_room";
				roomId: string;
				sessionId?: string;
				afterSeq?: number;
				workspaceRoot?: string;
			} = {
				type: "call_get_room",
				roomId,
			};
			const sessionId = sessionIdRef.current?.trim();
			if (sessionId) {
				payload.sessionId = sessionId;
			}
			if (roomSeqRef.current > 0) {
				payload.afterSeq = roomSeqRef.current;
			}
			const workspaceRoot = workspaceRootRef.current?.trim();
			if (workspaceRoot) {
				payload.workspaceRoot = workspaceRoot;
			}
			postToHost(payload);
			return true;
		},
		[resetDriveConnection],
	);

	const toggleDrive = useCallback(() => {
		if (
			connectionPhaseRef.current === "on" ||
			connectionPhaseRef.current === "joining"
		) {
			leaveDrive();
			return;
		}
		joinDrive();
	}, [joinDrive, leaveDrive]);

	const seedBankAfterJoin = useCallback(
		async (
			partnerName: string,
			correlation?: {
				roomId?: string | null;
				callSessionId?: string | null;
				whileAwayNote?: string | null;
			},
		) => {
			const current = driveRef.current;
			const { snapshot } = await seedBankForJoin(
				bankSessionRef.current,
				workspaceRootRef.current,
				{
					roomId: correlation?.roomId ?? current.roomId,
					callSessionId: correlation?.callSessionId ?? current.callSessionId,
				},
			);
			const tasks = snapshot.activePlanId
				? await listPlanTasks(bankSessionRef.current, snapshot.activePlanId)
				: [];
			// Leave/cancel clears intent synchronously; skip chrome if join is stale.
			if (!driveIntentRef.current) {
				return;
			}
			setPlanEditorTasks(tasks);
			setDrive((prev) => {
				// Only seed bank chrome after a real hub join (demo must stay false).
				if (!prev.active || prev.roomId == null) {
					return prev;
				}
				return applyBankSnapshot(prev, snapshot);
			});
			if (!driveIntentRef.current) {
				return;
			}
			const whileAway = correlation?.whileAwayNote?.trim();
			setDriveJoinNote(
				whileAway
					? whileAway
					: `On the call. I am ${partnerName}. Share what you want to work on and I will drive.`,
			);
		},
		[],
	);

	useEffect(() => {
		const onMessage = (message: DriveSessionHostMessage) => {
			if (message.type === "drive_show_presented" && message.showItemId) {
				// This message carries no artifactKind/sticky — keep the ones the
				// room broadcast already established for the same show.
				const showItemId = message.showItemId;
				setPresentedShow((current) => ({
					...(current?.showItemId === showItemId
						? {
								artifactKind: current.artifactKind,
								sticky: current.sticky,
							}
						: {}),
					showItemId,
					title: message.title,
					caption: message.caption,
					uri: message.uri,
					ownerParticipantId: message.ownerParticipantId,
				}));
				return;
			}
			if (message.type === "drive_script_beat") {
				const say = typeof message.say === "string" ? message.say.trim() : "";
				if (say) {
					setPresentedShow((current) =>
						current
							? {
									...current,
									caption: say,
								}
							: {
									showItemId: message.showItemId ?? "script-beat",
									caption: say,
								},
					);
					// Caption and speech are the same line: the Spotlight subtitle
					// is what a deafened viewer reads instead of hearing it.
					queueNarration(say);
				}
				return;
			}
			if (message.type === "call_error") {
				if (
					message.command === "call_join" &&
					!hasPendingDriveJoinRequest({
						pendingRoomJoin: pendingJoinRef.current,
						pendingAttachedSessionId: pendingAttachedSessionIdRef.current,
					})
				) {
					// Ignore a failure from a cancelled or already-confirmed join.
					// In particular, a late call_join error must not tear down an
					// authoritative on-call room.
					return;
				}
				const failedAttachmentSessionId =
					message.command === "call_join"
						? pendingAttachedSessionIdRef.current
						: null;
				if (failedAttachmentSessionId) {
					pendingAttachedSessionIdRef.current = null;
					failedAttachedSessionIdRef.current = failedAttachmentSessionId;
					setAttachmentRevision((revision) => revision + 1);
				}
				const resolution = resolveDriveCallError({
					code: message.code,
					command: message.command,
					text: message.text,
					wasJoining: pendingJoinRef.current,
				});
				if (resolution.kind === "reset") {
					resetDriveConnection({
						note: resolution.note,
						phase: resolution.phase,
					});
					return;
				}
				setDriveJoinNote(resolution.note);
				if (resolution.kind === "notice") {
					return;
				}
				// Refresh authoritative room state (rolls back optimistic rename, etc.).
				refreshDriveRoom();
				return;
			}
			if (message.type === "drive_fork_audit") {
				setFocusedAuditHandle(message.auditHandle ?? null);
				setAuditMessages(
					Array.isArray(message.messages) ? message.messages : [],
				);
				setAuditSummaryOnly(message.summaryOnly === true);
				setWorkersPanelOpen(true);
				return;
			}
			if (
				(message.type === "room_snapshot" || message.type === "drive_event") &&
				message.snapshot
			) {
				const hubSnapshot = message.snapshot;
				if (
					!isDriveRoomSnapshotForTarget({
						expectedRoomId: expectedRoomIdRef.current,
						outerRoomId: message.roomId,
						snapshotRoomId: hubSnapshot.roomId,
					})
				) {
					return;
				}
				// Fold drive_event through reduceRoom; room_snapshot replaces.
				// Compute candidate before intent guards — only commit to the ref
				// once we know this client should apply the update.
				const snapshot =
					message.type === "drive_event" && message.event != null
						? foldIncomingDriveEvent({
								local: roomSnapshotRef.current,
								event: message.event,
								hubSnapshot,
							})
						: hubSnapshot;
				// Local human seat only — matches Drive preview; guests do not count.
				const humanSeated = snapshot.participants.some(
					(participant) =>
						participant.kind === "human" && isDriveHumanId(participant.id),
				);
				const wasPendingJoin = pendingJoinRef.current;
				const seatedOnCall = Boolean(snapshot.driveActive && humanSeated);
				// Ignore broadcasts when this client is not joining/on the call
				// (covers never-joined peers, cancelled joins, and optimistic leave).
				if (!driveIntentRef.current) {
					return;
				}
				// Join not reflected yet — keep waiting; do not apply or clear intent.
				// Clearing pendingJoin here would leave the "Joining…" banner stuck
				// with no in-flight join for toggleDrive to cancel.
				if (wasPendingJoin && !seatedOnCall) {
					return;
				}
				// Advance afterSeq cursor only once we will apply this update —
				// ignored broadcasts must not skip gap-fill on the next get_room.
				if (
					typeof message.seq === "number" &&
					message.seq >= roomSeqRef.current
				) {
					roomSeqRef.current = message.seq;
				}
				roomSnapshotRef.current = seatedOnCall ? snapshot : null;
				if (wasPendingJoin) {
					pendingJoinRef.current = false;
				}
				if (seatedOnCall && pendingAttachedSessionIdRef.current) {
					const confirmedSessionId = pendingAttachedSessionIdRef.current;
					confirmedAttachedSessionIdRef.current = confirmedSessionId;
					pendingAttachedSessionIdRef.current = null;
					if (failedAttachedSessionIdRef.current === confirmedSessionId) {
						failedAttachedSessionIdRef.current = null;
					}
					setAttachmentRevision((revision) => revision + 1);
				}
				if (!seatedOnCall) {
					driveIntentRef.current = false;
					confirmedAttachedSessionIdRef.current = null;
					pendingAttachedSessionIdRef.current = null;
					failedAttachedSessionIdRef.current = null;
					connectionPhaseRef.current = "off";
					setConnectionPhase("off");
					const handoff =
						typeof message.handoffNarration === "string" &&
						message.handoffNarration.trim()
							? message.handoffNarration.trim()
							: null;
					setDriveJoinNote(handoff);
					setPlanEditorTasks([]);
				} else {
					connectionPhaseRef.current = "on";
					setConnectionPhase("on");
				}
				const fromMessage =
					typeof message.callSessionId === "string" &&
					message.callSessionId.trim()
						? message.callSessionId.trim()
						: undefined;
				const fromEvent =
					message.type === "drive_event" &&
					message.event &&
					typeof message.event.callSessionId === "string" &&
					message.event.callSessionId.trim()
						? message.event.callSessionId.trim()
						: undefined;
				const nextCallSessionId = fromMessage ?? fromEvent;
				setDrive((current) => {
					let next = applyRoomSnapshot(current, snapshot);
					if (seatedOnCall && nextCallSessionId) {
						next = { ...next, callSessionId: nextCallSessionId };
					}
					// Slice S2 — Join auto-opens Stage so Spotlight mounts without a second click.
					if (wasPendingJoin && seatedOnCall) {
						return { ...next, stageLayout: true };
					}
					return next;
				});
				// Only sync chat mode while locally seated — not after leave/unseat.
				if (seatedOnCall) {
					onModeChangeRef.current(
						toNativeMode(fromSharedDriveSubMode(snapshot.subMode)),
					);
				}
				if (wasPendingJoin && seatedOnCall) {
					const partner =
						snapshot.participants.find((p) => p.kind === "agent")
							?.displayName ?? "partner";
					const whileAwayNote =
						typeof message.whileAwayNote === "string" &&
						message.whileAwayNote.trim()
							? message.whileAwayNote.trim()
							: null;
					void seedBankAfterJoin(partner, {
						roomId: snapshot.roomId,
						callSessionId: nextCallSessionId,
						whileAwayNote,
					});
				}
				if (
					typeof message.handoffNarration === "string" &&
					message.handoffNarration.trim()
				) {
					setDriveJoinNote(message.handoffNarration.trim());
				}
				if (
					message.type === "drive_event" &&
					message.event?.type === "conversation.narration" &&
					message.event.text.trim()
				) {
					const narration = message.event.text.trim();
					setDriveJoinNote(narration);
					queueNarration(narration);
				}
				return;
			}
			if (message.type !== "drive_room_changed" || !message.room) {
				return;
			}
			const room = message.room;
			if (Array.isArray(room.chatForks)) {
				setChatForks(room.chatForks);
			}
			if (Array.isArray(room.director?.showBacklog)) {
				setShowBacklog(room.director.showBacklog as ShowBacklogItem[]);
			}
			setDrive((current) => {
				const humanFlags = room.participantAudio?.find((flag) =>
					isDriveHumanId(flag.participantId),
				);
				const partnerFlags = room.participantAudio?.find((flag) =>
					isDrivePartnerId(flag.participantId),
				);
				const spotlight =
					room.spotlightParticipantId ?? current.spotlightParticipantId;
				return {
					...current,
					spotlightParticipantId: spotlight,
					muted: humanFlags?.muted ?? current.muted,
					partnerMuted: partnerFlags?.muted ?? current.partnerMuted,
					partnerDeafened: partnerFlags?.deafened ?? current.partnerDeafened,
				};
			});
			const activeId = room.director?.activeShowId;
			const active = room.director?.showBacklog?.find(
				(item) => item.id === activeId,
			);
			if (active) {
				// Hold advances keep the same show id; backlog `caption` stays the
				// static show caption while `drive_script_beat` owns live narration.
				// Preserve the sticky caption so a later room sync (including the
				// command-reply echo) does not clobber beat `say`.
				const sticky = (room.director?.stickyShowIds ?? []).includes(active.id)
					? "hold"
					: "replace";
				setPresentedShow((current) => ({
					showItemId: active.id,
					artifactKind: active.artifactKind,
					sticky,
					title: active.title,
					caption:
						current?.showItemId === active.id
							? (current.caption ?? active.caption)
							: active.caption,
					uri: active.uri,
					ownerParticipantId: active.ownerParticipantId,
				}));
			}
		};
		return subscribeToHostMessages({
			types: DRIVE_SESSION_MESSAGE_TYPES,
			guard: isDriveSessionHostMessage,
			onMessage,
		});
	}, [
		queueNarration,
		refreshDriveRoom,
		resetDriveConnection,
		seedBankAfterJoin,
	]);

	useEffect(() => {
		// Attachment refs do not render; the revision intentionally re-evaluates
		// this effect after a pending attachment is confirmed or rejected.
		void attachmentRevision;
		const sessionId = args.sessionId?.trim();
		if (
			!shouldReattachDriveSession({
				active: drive.active,
				confirmedAttachedSessionId: confirmedAttachedSessionIdRef.current,
				connectionPhase,
				driveIntended: driveIntentRef.current,
				failedAttachedSessionId: failedAttachedSessionIdRef.current,
				pendingAttachedSessionId: pendingAttachedSessionIdRef.current,
				sessionId,
			})
		) {
			return;
		}
		sendDriveJoin(driveRef.current, sessionId, expectedRoomIdRef.current);
	}, [
		args.sessionId,
		attachmentRevision,
		connectionPhase,
		drive.active,
		sendDriveJoin,
	]);

	const driveVoiceResolved = useMemo(
		() =>
			resolveDriveVoiceTopology({
				voice: driveVoice,
				providerId: args.providerId,
			}),
		[driveVoice, args.providerId],
	);

	/**
	 * Narration playback for this topology: queue, drop-oldest, and the
	 * speaking-presence edges the roster ring reads (DRV-TTS).
	 *
	 * Keyed by topology fingerprint, not by `driveVoiceResolved` identity —
	 * that object is rebuilt whenever anything on `driveVoice` changes,
	 * including opening the settings panel. Minting a narrator there would
	 * orphan an in-flight utterance and silently drop its queue.
	 */
	const narratorParticipantIdRef = useRef(DRIVE_PARTICIPANT_PARTNER);
	narratorParticipantIdRef.current = resolveNarratorParticipantId(drive);
	const narratorRef = useRef<{ key: string; narrator: DriveNarrator } | null>(
		null,
	);
	const narrator = useMemo(() => {
		if (!driveVoiceResolved.ok) {
			return null;
		}
		const key = topologyCacheKey(driveVoiceResolved.topology);
		const cached = narratorRef.current;
		if (cached?.key === key) {
			return cached.narrator;
		}
		// The topology really moved, so the old port is being retired — cut
		// whatever it was still saying rather than leaving it running.
		cached?.narrator.cancel();
		const next = createDriveNarrator({
			sink: createVoiceStack(driveVoiceResolved.topology).tts,
			onSpeakingChange: (speaking) => {
				setDrive((current) => ({
					...current,
					speakingParticipantId: speaking
						? narratorParticipantIdRef.current
						: null,
				}));
			},
		});
		narratorRef.current = { key, narrator: next };
		return next;
	}, [driveVoiceResolved]);

	/**
	 * Silencing immediately cancels in-flight TTS and drops the queue (DRV-TTS).
	 *
	 * Same instant-cut behaviour as before, on the toggles that actually govern
	 * output: self-deafen and partner mute. Mic mute is no longer an input here
	 * — cutting the partner off mid-sentence because you muted your own mic was
	 * the conflation this separation removes.
	 */
	useEffect(() => {
		if (!drive.deafened && !drive.partnerMuted) {
			return;
		}
		narrator?.cancel();
	}, [drive.deafened, drive.partnerMuted, narrator]);

	/** Speak partner join note once when TTS is enabled and unmuted. */
	const spokenJoinNoteRef = useRef<string | null>(null);
	useEffect(() => {
		if (!driveJoinNote || !drive.active) {
			return;
		}
		// Speak post-join greeting and while-away catch-up; ack / error stay display-only.
		if (!isSpokenDriveJoinNote(driveJoinNote)) {
			return;
		}
		if (spokenJoinNoteRef.current === driveJoinNote) {
			return;
		}
		if (!narrator) {
			return;
		}
		if (
			!shouldSpeakDriveTts({
				facets: driveVoice.facets,
				deafened: drive.deafened,
				partnerMuted: drive.partnerMuted,
			})
		) {
			return;
		}
		spokenJoinNoteRef.current = driveJoinNote;
		narrator.speak(driveJoinNote, {
			volume: driveVoice.hardware.outputVolume,
			sinkId: driveVoice.hardware.speakerDeviceId,
		});
	}, [
		drive.active,
		drive.deafened,
		drive.partnerMuted,
		driveJoinNote,
		driveVoice.facets,
		driveVoice.hardware.outputVolume,
		driveVoice.hardware.speakerDeviceId,
		narrator,
	]);

	/**
	 * Speak DirectorScript `say` beats and `conversation.narration` behind the
	 * same gate as every other line (DRV-NARRATION). The narrator queue absorbs
	 * beats arriving faster than speech.
	 */
	useEffect(() => {
		if (!narrationLine || !drive.active || !narrator) {
			return;
		}
		if (spokenNarrationSeqRef.current >= narrationLine.seq) {
			return;
		}
		// Consumed either way: a line the user was deafened for is gone, not
		// queued up to blurt out when they un-deafen. The caption carried it.
		spokenNarrationSeqRef.current = narrationLine.seq;
		if (
			!shouldSpeakDriveTts({
				facets: driveVoice.facets,
				deafened: drive.deafened,
				partnerMuted: drive.partnerMuted,
			})
		) {
			return;
		}
		narrator.speak(narrationLine.text, {
			volume: driveVoice.hardware.outputVolume,
			sinkId: driveVoice.hardware.speakerDeviceId,
		});
	}, [
		drive.active,
		drive.deafened,
		drive.partnerMuted,
		driveVoice.facets,
		driveVoice.hardware.outputVolume,
		driveVoice.hardware.speakerDeviceId,
		narrationLine,
		narrator,
	]);

	useEffect(() => {
		if (!drive.active) {
			spokenJoinNoteRef.current = null;
			// Leaving cuts audio and drops the spoken line; nothing about
			// narration outlives the call (DRV-PRIVACY).
			narrator?.cancel();
			setNarrationLine(null);
		}
	}, [drive.active, narrator]);

	const toggleStage = useCallback(() => {
		setDrive((current) => {
			const stageLayout = !current.stageLayout;
			if (stageLayout && current.roomId) {
				const payload: {
					type: "call_get_room";
					roomId: string;
					sessionId?: string;
					afterSeq?: number;
					workspaceRoot?: string;
				} = {
					type: "call_get_room",
					roomId: current.roomId,
				};
				const sessionId = sessionIdRef.current;
				if (sessionId) {
					payload.sessionId = sessionId;
				}
				if (roomSeqRef.current > 0) {
					payload.afterSeq = roomSeqRef.current;
				}
				const workspaceRoot = workspaceRootRef.current?.trim();
				if (workspaceRoot) {
					payload.workspaceRoot = workspaceRoot;
				}
				postToHost(payload);
			}
			return {
				...current,
				stageLayout,
			};
		});
	}, []);

	const toggleWorkersPanel = useCallback(() => {
		setWorkersPanelOpen((open) => {
			const next = !open;
			if (next) {
				postToHost({
					type: "driveCommand",
					command: "drive.fork.list",
					payload: { roomId: "default" },
				});
			}
			return next;
		});
	}, []);

	const openForkAudit = useCallback((auditHandle: string) => {
		setFocusedAuditHandle(auditHandle);
		setWorkersPanelOpen(true);
		postToHost({
			type: "driveCommand",
			command: "drive.fork.audit.get",
			payload: { roomId: "default", auditHandle },
		});
	}, []);

	const setForkRetain = useCallback(
		(workerSessionId: string, retain: boolean) => {
			postToHost({
				type: "driveCommand",
				command: "drive.fork.retain.set",
				payload: {
					roomId: "default",
					workerSessionId,
					retainForAudit: retain,
				},
			});
		},
		[],
	);

	const stripHandlers = useMemo(
		() => ({
			onClearOverride: () => {
				setDrive((current) => {
					const next = clearPostureOverride(current);
					args.onModeChange(toNativeMode(next.subMode));
					return next;
				});
			},
			onHandToggle: () => {
				setDrive((current) => {
					const raised = !current.handRaised;
					// First raise = signal only (pause-after-tool comes later).
					// Second toggle while already raised + sending = hard-cancel escape.
					if (current.handRaised && args.sending) {
						args.onAbort();
						args.onStatus("Drive hand-raise: abort requested...");
					}
					if (current.roomId) {
						postToHost({
							type: "call_raise_hand",
							roomId: current.roomId,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							raised,
						});
					}
					// Optimistic flip so rapid toggles see fresh state; room_snapshot
					// remains authoritative via applyRoomSnapshot.
					return { ...current, handRaised: raised };
				});
			},
			onDeafenToggle: () => {
				// Purely local: nobody else's experience changes, so there is no
				// hub op and no wire field to keep in sync.
				setDrive((current) => ({ ...current, deafened: !current.deafened }));
			},
			onMuteToggle: () => {
				setDrive((current) => {
					const muted = !current.muted;
					if (current.roomId) {
						postToHost({
							type: "call_mute",
							roomId: current.roomId,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							muted,
						});
						// Prefer hub snapshot for muted (applyRoomSnapshot); optimistic
						// flip so rapid toggles see fresh state.
						return { ...current, muted };
					}
					// Demo / pre-join: legacy mute path.
					postToHost({
						type: "driveCommand",
						command: "drive.participant.mute.set",
						payload: {
							roomId: current.roomId ?? DRIVE_DEFAULT_ROOM_ID,
							participantId: DRIVE_PARTICIPANT_HUMAN,
							muted,
						},
					});
					return { ...current, muted };
				});
			},
			onOpenSettings: () => {
				setDriveVoice((current) => ({
					...current,
					settingsOpen: !current.settingsOpen,
				}));
			},
			onTogglePartnerDeafen: () => {
				// Hub is authoritative; wait for drive_room_changed.
				postToHost({
					type: "driveCommand",
					command: "drive.participant.deafen.set",
					payload: {
						roomId: drive.roomId ?? DRIVE_DEFAULT_ROOM_ID,
						participantId: DRIVE_PARTICIPANT_PARTNER,
						deafened: !drive.partnerDeafened,
					},
				});
			},
			onTogglePartnerMute: () => {
				// call_mute accepts any participantId (human or agent).
				if (drive.roomId) {
					postToHost({
						type: "call_mute",
						roomId: drive.roomId,
						participantId: DRIVE_PARTICIPANT_PARTNER,
						muted: !drive.partnerMuted,
					});
					return;
				}
				postToHost({
					type: "driveCommand",
					command: "drive.participant.mute.set",
					payload: {
						roomId: drive.roomId ?? DRIVE_DEFAULT_ROOM_ID,
						participantId: DRIVE_PARTICIPANT_PARTNER,
						muted: !drive.partnerMuted,
					},
				});
			},
			onToggleSpotlight: () => {
				const nextId = toggleDriveSpotlightId(drive.spotlightParticipantId);
				const kind = isDriveHumanId(nextId) ? "human" : "agent";
				// call_set_stage is authoritative; live spotlight syncs from sharer.
				postToHost({
					type: "call_set_stage",
					roomId: drive.roomId ?? DRIVE_DEFAULT_ROOM_ID,
					sharer: { kind, participantId: nextId },
					pin: null,
				});
			},
			onToggleWorkers: toggleWorkersPanel,
			onSubModeChange: (subMode: DriveUiState["subMode"]) => {
				setDrive((current) => {
					const next = applySubModeIntent(current, subMode);
					// Skip hub/chat updates when intent is blocked (inactive or
					// Ask/Debug override ignoring plan/agent).
					if (next === current) {
						return current;
					}
					args.onModeChange(toNativeMode(next.subMode));
					if (current.roomId) {
						postToHost({
							type: "call_set_mode",
							roomId: current.roomId,
							subMode: toSharedDriveSubMode(next.subMode),
							driveActive: true,
						});
					}
					return next;
				});
			},
		}),
		[args, drive, toggleWorkersPanel],
	);

	return {
		drive,
		setDrive,
		connectionPhase,
		driveVoice,
		setDriveVoice,
		driveJoinNote,
		setDriveJoinNote,
		voiceCaption,
		setVoiceCaption,
		planEditorTasks,
		setPlanEditorTasks,
		bankSessionRef,
		driveVoiceResolved,
		narrator,
		workspaceRoot: args.workspaceRoot,
		joinDrive,
		leaveDrive,
		endDrive,
		refreshDriveRoom,
		toggleDrive,
		toggleStage,
		stripHandlers,
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
	};
}

// Re-export for settings panel wiring without Chat knowing voice helpers.
export { applyHardwarePrefsPatch, applyVoiceFacetPatch, applyVoiceProfile };
