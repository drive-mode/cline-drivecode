"use client";

import {
	buildCleanDrainInvite,
	buildRecruitNeed,
	buildVoiceAckNarration,
	formatCleanDrainNarration,
	rankRecruitCandidates,
	shouldOfferCleanDrain,
	type RankedRecruit,
	type RecruitCandidate,
	type RecruitNeed,
} from "@cline/drive";
import type { AddressSet } from "@cline/shared";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import type {
	WebviewChatAttachments,
	WebviewDefaults,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewReasonLevel,
	WebviewSessionSummary,
} from "../../webview-protocol";
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
import {
	listPlanTasks,
	mutateBankAcceptSdlcFreeze,
	mutateBankBindNow,
	mutateBankCompleteTask,
	mutateBankCreateTask,
	mutateBankEditPlanTasks,
	mutateBankRecordFailure,
} from "./drive/bankSession";
import { hasNowLastFailure, steerAppliedBanner } from "./drive/agencyChrome";
import { DriveHeaderControls } from "./drive/DriveCallChrome";
import { DriveRoomChrome, DriveVoiceBar } from "./drive/DriveRoomChrome";
import {
	ChatForkAuditPanel,
	isChatForkSession,
} from "./drive/ChatForkAuditPanel";
import { RouteSuggestChip } from "./drive/RouteSuggestChip";
import { SdlcFreezeAcceptChip } from "./drive/SdlcFreezeAcceptChip";
import type { DriveLaunchRequest } from "./drive/driveLaunch";
import {
	type RouteSuggestion,
	type RouterUiMode,
	suggestRouteForUtterance,
} from "./drive/routeSuggest";
import { Spotlight } from "./drive/Spotlight";
import { StuckRecoveryFork } from "./drive/StuckRecoveryFork";
import { RecruitStallPicker } from "./drive/RecruitStallPicker";
import {
	planRecoveryAccept,
	resolveRecoveryOfferTarget,
	shouldOfferRecoveryFork,
	type RecoveryOptionKind,
} from "./drive/stuckRecovery";
import {
	classifyStall,
	stallRollupSliceFromCounters,
	type StallOpenFailure,
} from "@cline/drive";
import { StickyStagePane } from "./drive/StickyStagePane";
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
import { resolveRosterParticipants } from "./drive/rosterHelpers";
import { useDriveSession } from "./drive/useDriveSession";
import { createVoiceStack } from "./drive/voice/createVoiceStack";
import { shouldSpeakDriveTts } from "./drive/voice/driveVoiceUi";
import { clearVoiceCaptionAfterSend } from "./drive/voice/voiceCaptionState";
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
};

export default function Chat({
	driveLaunchRequest,
	initialSessionId,
	onDriveLaunchHandled,
	onSessionSelected,
}: ChatProps) {
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
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const [titleEditing, setTitleEditing] = useState(false);
	const [forking, setForking] = useState(false);
	const [forkError, setForkError] = useState<string | null>(null);
	const [routeSuggestion, setRouteSuggestion] = useState<RouteSuggestion | null>(
		null,
	);
	const [pendingRouteSend, setPendingRouteSend] = useState<{
		prompt: string;
		attachments?: WebviewChatAttachments;
		attachmentCount: number;
		source: "voice" | "text";
	} | null>(null);
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
		driveVoiceResolved,
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

	const driveRef = useRef(drive);
	driveRef.current = drive;
	/** Guard bind_now spam — one bind per now-task while Agent posture. */
	const lastBoundNowTaskIdRef = useRef<string | null>(null);
	/** Mute identical stuck-recovery offers until a new failure fingerprint. */
	const [dismissedRecoveryOfferKey, setDismissedRecoveryOfferKey] = useState<
		string | null
	>(null);
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

	/** Mid-call stall slice (W4.1) — counters + open lastFailure; no utterance. */
	const openStallFailures: StallOpenFailure[] = (() => {
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
	})();
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
		driveActive: drive.active && drive.stageLayout,
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
	}, [dismissCleanDrain, setDrive, setMode]);

	const seatRecruitCandidate = useCallback(
		(entry: RankedRecruit) => {
			const roomId =
				driveRef.current.roomId?.trim() || DRIVE_DEFAULT_ROOM_ID;
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
					stallTaskId:
						offer?.source === "auto_stall" ? offer.taskId : null,
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
						const candidates: RecruitCandidate[] = [];
						const seen = new Set<string>();
						for (const participant of resolveRosterParticipants(
							driveRef.current,
						)) {
							if (participant.kind !== "agent") {
								continue;
							}
							if (seen.has(participant.id)) {
								continue;
							}
							seen.add(participant.id);
							candidates.push({
								slug: participant.id,
								displayName: participant.displayName,
								labels: [
									participant.role,
									participant.displayName,
									participant.id,
								],
								domains: [],
							});
						}
						// Builtin fixtures so lexical rank has something beyond the pair.
						for (const fixture of [
							{
								slug: "security-reviewer",
								displayName: "Security Reviewer",
								labels: ["security", "auth", "review"],
								domains: ["auth"],
								suggestedPackIds: ["security-crew"],
							},
							{
								slug: "test-fixer",
								displayName: "Test Fixer",
								labels: ["tests", "parser", "fixup"],
								domains: ["qa"],
							},
						] as RecruitCandidate[]) {
							if (seen.has(fixture.slug)) {
								continue;
							}
							seen.add(fixture.slug);
							candidates.push(fixture);
						}
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
									postToHost({
										type: "call_raise_hand",
										roomId: current.roomId,
										participantId: DRIVE_PARTICIPANT_HUMAN,
										raised: true,
									});
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
						if (
							defaultsRef.current.workspaceRoot?.trim() &&
							!created.fromHub
						) {
							setStatus(
								"Recovery not saved — workspace bank was not updated.",
							);
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
		[
			bankSessionRef,
			planEditorTasks,
			sending,
			setDrive,
			setMode,
			setPlanEditorTasks,
			setStatus,
		],
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
		drive.bankSnapshot.nowTaskId,
		drive.callSessionId,
		drive.roomId,
		drive.subMode,
		setDrive,
	]);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewOutboundMessage>) => {
			const message = event.data;
			if (!message || typeof message !== "object" || !("type" in message)) {
				return;
			}

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
						appendAssistantDelta(current, message.text, activeAssistantIdRef),
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
							if (
								defaultsRef.current.workspaceRoot?.trim() &&
								!fromHub
							) {
								return;
							}
							setDrive((current) => applyBankSnapshot(current, snapshot));
						})();
					}
					return;
				case "approval_request":
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

		window.addEventListener("message", handleMessage);
		postToHost({ type: "ready" });
		return () => {
			window.removeEventListener("message", handleMessage);
		};
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
			roomId: DRIVE_DEFAULT_ROOM_ID,
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
				driveVoiceResolved.ok &&
				shouldSpeakDriveTts({
					facets: driveVoice.facets,
					muted: drive.muted,
					partnerMuted: drive.partnerMuted,
				})
			) {
				const ack = buildVoiceAckNarration({
					profile: driveVoice.profile === "local" ? "local" : "cloud",
					partnerName: drive.partnerName,
					utterance: trimmed,
				});
				setDriveJoinNote(ack.text);
				void createVoiceStack(driveVoiceResolved.topology).tts.speak(
					ack.text,
					{
						volume: driveVoice.hardware.outputVolume,
						sinkId: driveVoice.hardware.speakerDeviceId,
					},
				);
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
				setMessages((current) => [
					...current,
					createMessage("user", trimmed),
				]);
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
			driveVoiceResolved,
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

	return (
		<PromptInputProvider>
			<div className="relative flex h-screen flex-col overflow-hidden">
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
								<Loader2Icon className="size-3 animate-spin" />
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
							onEndDrive={endDrive}
							onJoinDrive={joinDrive}
							onLeaveDrive={leaveDrive}
							onToggleSpotlight={toggleStage}
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
					onCleanDrainContinue={continueCleanDrain}
					onCleanDrainDismiss={dismissCleanDrain}
					providerId={provider}
					session={driveSession}
					turnInFlight={sending}
				/>
				<div
					className={
						drive.active && drive.stageLayout
							? "flex min-h-0 flex-1"
							: "flex min-h-0 flex-1 flex-col"
					}
				>
					<div
						className={
							drive.active && drive.stageLayout
								? "flex min-h-0 w-[42%] min-w-[280px] flex-col border-r"
								: "flex min-h-0 flex-1 flex-col"
						}
					>
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
							sending={sending}
						/>
						<PendingApprovalsPanel
							approvals={pendingApprovals}
							onRespond={respondToApproval}
						/>
						<DriveVoiceBar
							disabled={isHydrating}
							onSendSpoken={sendDrivePrompt}
							onSttError={setStatus}
							sending={sending}
							session={driveSession}
						/>
						{routeSuggestion ? (
							<RouteSuggestChip
								onAccept={acceptRouteSuggestion}
								onDismiss={skipRouteSuggestion}
								suggestion={routeSuggestion}
							/>
						) : null}
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
					</div>
					{drive.active && drive.stageLayout ? (
						<Spotlight
							cards={drive.stageCards}
							className="min-h-0 flex-1"
							demo={drive.demo}
							emptyHint={
								drive.demo
									? "Demo mode — join Drive to project live hub stage cards."
									: "Waiting for partner tool activity on this session."
							}
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
							sharerLabel={
								drive.stageSharer === "you" ? "You" : drive.partnerName
							}
						>
							{showStuckRecovery &&
							recoveryOfferTarget &&
							!recruitStall ? (
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
							<StickyStagePane
								caption={presentedShow?.caption}
								drive={drive}
								title={presentedShow?.title}
								uri={presentedShow?.uri}
							/>
							<ChatForkAuditPanel
								auditMessages={auditMessages}
								className="mt-3"
								focusedAuditHandle={focusedAuditHandle}
								forks={chatForks}
								onClose={toggleWorkersPanel}
								onOpenAudit={openForkAudit}
								onRetain={setForkRetain}
								open={workersPanelOpen}
								showBacklog={showBacklog}
								summaryOnly={auditSummaryOnly}
							/>
							<div className="space-y-3 text-xs text-muted-foreground">
								<p>
									Task bank cursor drives now/next. Edit plan refs below;
									completed tasks archive under .drive/bank/archive/.
								</p>
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
												if (
													defaults.workspaceRoot?.trim() &&
													!fromHub
												) {
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
											const recovery = hasNowLastFailure(
												drive.bankSnapshot,
											);
											const { snapshot, fromHub } =
												await mutateBankCreateTask(
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
											const { snapshot, fromHub } =
												await mutateBankCompleteTask(
													bankSessionRef.current,
													defaults.workspaceRoot,
													{
														taskId,
														...(driveRef.current.attributionAgentId
															? {
																	agentId:
																		driveRef.current.attributionAgentId,
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
													await listPlanTasks(
														bankSessionRef.current,
														planId,
													),
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
											const { snapshot, fromHub } =
												await mutateBankEditPlanTasks(
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
						</Spotlight>
					) : null}
				</div>
			</div>
		</PromptInputProvider>
	);
}
