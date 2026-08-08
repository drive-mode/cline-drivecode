import type {
	PlanReentryRowModel,
	RankedRecruit,
	RecruitCandidate,
} from "@cline/drive";
import {
	applyPlanImproveAccept,
	buildShippedDigest,
	createMemoryBankFs,
	formatShippedDigestMarkdown,
	planPlanImproveResolve,
	statusSessionRowFromUnknown,
} from "@cline/drive";
import type { RosterPack, SttBackend } from "@cline/shared";
import { useEffect, useRef, useState } from "react";
import { SpeechInput } from "@/components/ai-elements/speech-input";
import {
	describeSpeechInputUnavailable,
	readSpeechInputCapabilities,
	resolveSpeechInputMode,
} from "@/components/ai-elements/speechInputSupport";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { NowNext } from "../components/NowNext";
import { downloadTextFile } from "../status/downloadTextFile";
import { DriveCallStrip } from "./DriveCallChrome";
import {
	INTERRUPT_HARD_CANCEL_HINT,
	muteRestoreAfterHold,
} from "./driveAppCallChrome";
import {
	interruptBannerCopy,
	resolveInterruptPhase,
} from "./agencyChrome";
import {
	DrivePowerSheet,
	useDrivePowerChromePref,
} from "./DrivePowerSheet";
import {
	type CallSpendSnapshot,
	formatCallSpend,
	hasCallSpend,
} from "./callSpend";
import { PlanImproveGate } from "./PlanImproveGate";
import { PlanReentryRow } from "./PlanReentryRow";
import { requestPlanImproveResolve } from "./planImproveResolve";
import { loadPlanReentryRow } from "./planReentryLoad";
import { Roster } from "./Roster";
import { applyTranscriptFocus } from "./rosterHelpers";
import {
	advanceSampleScript,
	attachSampleHoldScript,
	enqueueSampleArchitectureShow,
	presentSampleArchitectureShow,
	presentSampleCaptureShow,
	presentSampleChangeAnimationShow,
	setShowPlannerMode,
	tickShowDirector,
} from "./sampleShowPresent";
import { requestSessionRollupsDump } from "./sessionRollupsDump";
import {
	applyHardwarePrefsPatch,
	applyVoiceFacetPatch,
	applyVoiceProfile,
	type UseDriveSessionResult,
} from "./useDriveSession";
import { DriveMicBar } from "./voice/DriveMicBar";
import type { SpeechInputMode } from "./voice/speechInputModeForBackend";
import { LocalSttError, transcribeAudioBlob } from "./voice/transcribeAudioBlob";
import { DriveSettingsPanel } from "./voice/DriveSettingsPanel";
import { DriveTranscriptPanel } from "./voice/DriveTranscriptPanel";
import { DRIVE_EARCON_FACET_ID } from "./voice/driveEarcons";
import { clearVoiceCaptionDraft } from "./voice/voiceCaptionState";

/**
 * Narration banner for surfaces without the Spotlight frame. In the Spotlight
 * layout the same text renders as the screen's subtitle slot instead.
 */
function DriveNarrationBanner({
	partnerName,
	text,
}: {
	partnerName: string;
	text: string;
}) {
	return (
		<div
			aria-atomic="true"
			aria-live="polite"
			className="mx-4 mb-2 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm italic text-amber-900 dark:text-amber-100"
			role="status"
		>
			<span
				aria-hidden
				className="mt-0.5 inline-block size-5 shrink-0 rounded-full border-2 border-amber-500 bg-amber-400/40"
			/>
			<span>
				<span className="not-italic font-medium">{partnerName}: </span>
				{text}
			</span>
		</div>
	);
}

/** Call roster wired to the session — mounts wherever the roster belongs. */
export function DriveRoster({
	session,
	disabled = false,
	seatCap = 1,
	onSeatRecruit,
	onAddRosterPack,
	recruitFixtures,
}: {
	session: UseDriveSessionResult;
	disabled?: boolean;
	seatCap?: number;
	onSeatRecruit?: (entry: RankedRecruit) => void;
	onAddRosterPack?: (pack: RosterPack) => void;
	recruitFixtures?: readonly RecruitCandidate[];
}) {
	const { drive, setDrive } = session;
	const { powerChrome } = useDrivePowerChromePref();
	if (!drive.active) {
		return null;
	}
	return (
		<Roster
			disabled={disabled}
			drive={drive}
			onAddRosterPack={onAddRosterPack}
			onDriveChange={setDrive}
			onSeatRecruit={onSeatRecruit}
			powerChrome={powerChrome}
			recruitFixtures={recruitFixtures}
			onTranscriptFocus={(participantId) => {
				setDrive((current) => applyTranscriptFocus(current, participantId));
			}}
			seatCap={seatCap}
			workspaceRoot={session.workspaceRoot}
		/>
	);
}

/**
 * Settings, now/next, join note — mounts above the conversation. The call
 * strip itself is {@link DriveCallStripDock}, mounted separately below the
 * call surface.
 */
export function DriveRoomChrome({
	session,
	disabled,
	providerId,
	showRoster = true,
	seatCap = 1,
	onSeatRecruit,
	onAddRosterPack,
	recruitFixtures,
	onCleanDrainContinue,
	onCleanDrainDismiss,
	onPlanningImproveResolved,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	providerId: string;
	/** False when the caller mounts {@link DriveRoster} itself (feed drawer). */
	showRoster?: boolean;
	seatCap?: number;
	onSeatRecruit?: (entry: RankedRecruit) => void;
	onAddRosterPack?: (pack: RosterPack) => void;
	recruitFixtures?: readonly RecruitCandidate[];
	onCleanDrainContinue?: () => void;
	onCleanDrainDismiss?: () => void;
	/** After accept/reject/mute — parent may mute identical offerKeys. */
	onPlanningImproveResolved?: (
		decision: "accept" | "reject" | "mute",
		offerKey: string,
	) => void;
}) {
	const {
		drive,
		setDrive,
		driveVoice,
		setDriveVoice,
		driveJoinNote,
		joinDrive,
		workspaceRoot,
	} = session;

	const [planReentry, setPlanReentry] = useState<PlanReentryRowModel | null>(
		null,
	);

	useEffect(() => {
		if (drive.active) {
			setPlanReentry(null);
			return;
		}
		const root = workspaceRoot?.trim();
		if (!root) {
			setPlanReentry(null);
			return;
		}
		let cancelled = false;
		void loadPlanReentryRow(root)
			.then((row) => {
				if (!cancelled) {
					setPlanReentry(row);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setPlanReentry(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [drive.active, workspaceRoot]);

	const resolvePlanningImprove = async (
		decision: "accept" | "reject" | "mute",
	) => {
		const proposal = drive.pendingPlanningImprove;
		if (!proposal) {
			return;
		}
		const root = workspaceRoot?.trim();
		// Set only for reject/mute, which clear locally even when the hub
		// rejects/times out — the banner below must not then claim a durable
		// sync the hub never confirmed (previously a bare `catch {}` that
		// dropped the distinction entirely).
		let hubUnreachable = false;
		if (root) {
			try {
				await requestPlanImproveResolve(root, proposal, decision);
			} catch {
				if (decision === "accept") {
					// Keep card so the user can retry durable accept.
					return;
				}
				// reject/mute must not write — clear locally even if hub errors.
				hubUnreachable = true;
			}
		} else {
			// Demo / no workspace: memory BankFs only (still gated).
			const plan = planPlanImproveResolve({ proposal, decision });
			await applyPlanImproveAccept(createMemoryBankFs(), plan);
		}
		const decisionLabel =
			decision === "accept"
				? "accepted"
				: decision === "mute"
					? "muted"
					: "rejected";
		setDrive((current) => ({
			...current,
			pendingPlanningImprove: null,
			agencyBanner: hubUnreachable
				? `Planning improve ${decisionLabel} locally — hub did not confirm.`
				: `Planning improve ${decisionLabel}`,
		}));
		onPlanningImproveResolved?.(decision, proposal.offerKey);
	};

	return (
		<>
			{!drive.active && drive.pendingPlanningImprove ? (
				<PlanImproveGate
					className="mx-4 mt-2"
					disabled={disabled}
					onAccept={() => {
						void resolvePlanningImprove("accept");
					}}
					onMute={() => {
						void resolvePlanningImprove("mute");
					}}
					onReject={() => {
						void resolvePlanningImprove("reject");
					}}
					proposal={drive.pendingPlanningImprove}
				/>
			) : null}
			{!drive.active && planReentry ? (
				<PlanReentryRow
					disabled={disabled}
					onResume={() => {
						joinDrive();
					}}
					row={planReentry}
				/>
			) : null}
			{showRoster ? (
				<DriveRoster
					disabled={disabled}
					onAddRosterPack={onAddRosterPack}
					onSeatRecruit={onSeatRecruit}
					recruitFixtures={recruitFixtures}
					seatCap={seatCap}
					session={session}
				/>
			) : null}
			{drive.active && driveVoice.settingsOpen ? (
				<DriveSettingsPanel
					onClose={() =>
						setDriveVoice((current) => ({
							...current,
							settingsOpen: false,
						}))
					}
					onHardwareChange={(patch) => {
						setDriveVoice((current) => applyHardwarePrefsPatch(current, patch));
					}}
					onProfileChange={(profile) => {
						setDriveVoice((current) => applyVoiceProfile(current, profile));
					}}
					onSttChange={(sttId) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								"providers.sttId": sttId,
							}),
						);
					}}
					onTtsChange={(ttsId) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								"providers.ttsId": ttsId,
							}),
						);
					}}
					onTtsEnabledChange={(enabled) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								"tts.enabled": enabled,
							}),
						);
					}}
					onEarconChange={(kind, enabled) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								[DRIVE_EARCON_FACET_ID[kind]]: enabled,
							}),
						);
					}}
					onPresentSampleAnimation={() => {
						presentSampleChangeAnimationShow(drive.roomId);
					}}
					onPresentSampleCapture={() => {
						presentSampleCaptureShow(drive.roomId);
					}}
					onPresentSampleDiagram={() => {
						presentSampleArchitectureShow(drive.roomId);
					}}
					onEnqueueSampleDiagram={() => {
						enqueueSampleArchitectureShow(drive.roomId);
					}}
					onTickShowDirector={() => {
						tickShowDirector(drive.roomId);
					}}
					onAttachSampleScript={() => {
						attachSampleHoldScript(drive.roomId);
					}}
					onAdvanceSampleScript={() => {
						advanceSampleScript(drive.roomId);
					}}
					onSetShowPlannerMode={(mode) => {
						setShowPlannerMode(mode, drive.roomId);
					}}
					onDumpSessionRollups={async () => {
						const root = session.workspaceRoot?.trim();
						if (!root) {
							return "workspaceRoot is required (connect Drive with a workspace).";
						}
						const result = await requestSessionRollupsDump(root, {
							limit: 10,
						});
						return result.dump;
					}}
					onExportShippedDigest={async () => {
						const root = session.workspaceRoot?.trim();
						if (!root) {
							return "workspaceRoot is required (connect Drive with a workspace).";
						}
						const result = await requestSessionRollupsDump(root, {
							limit: 20,
						});
						const rollups = result.rollups
							.map(statusSessionRowFromUnknown)
							.filter((row): row is NonNullable<typeof row> => row != null);
						const digest = buildShippedDigest({ rollups });
						const markdown = formatShippedDigestMarkdown(digest);
						const stamp = digest.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
						downloadTextFile(`drive-shipped-digest-${stamp}.md`, markdown);
						return `Downloaded drive-shipped-digest-${stamp}.md (${digest.sessionCount} sessions, ${digest.tasksCompletedTotal} tasks).`;
					}}
					presentSampleDisabled={disabled || !drive.active}
					providerId={providerId}
					voice={driveVoice}
				/>
			) : null}
			{/*
			 * Spotlight (stageLayout) carries its own compact now/next line under
			 * the frame, so the larger card is a duplicate there — but only of the
			 * now/next titles. The card is also the sole host of the clean-drain
			 * invite and the agency banner, whose controls are reachable nowhere
			 * else, so it still mounts when it carries either of those.
			 */}
			{drive.active &&
			(!drive.stageLayout ||
				Boolean(drive.cleanDrainInvite) ||
				Boolean(drive.agencyBanner)) ? (
				<NowNext
					agencyBanner={drive.agencyBanner}
					cleanDrainInvite={drive.cleanDrainInvite}
					onCleanDrainContinue={onCleanDrainContinue}
					onCleanDrainDismiss={onCleanDrainDismiss}
					onSelectNext={() => {}}
					onSelectNow={() => {}}
					snapshot={drive.bankSnapshot}
				/>
			) : null}
			{/*
			 * Same gate Chat.tsx mounts the Spotlight on. `stageLayout` is
			 * persisted UI state that outlives `active`, so testing it alone
			 * would swallow the Tier-0 handoff note once the call ends.
			 */}
			{driveJoinNote && !(drive.active && drive.stageLayout) ? (
				<DriveNarrationBanner
					partnerName={drive.partnerName}
					text={driveJoinNote}
				/>
			) : null}
		</>
	);
}

/**
 * The call strip, mounted on its own below the call surface (Spotlight +
 * feed, or the plain chat column) rather than above it — the canvas source
 * of truth (`drive-product-demo.html`) puts `.call-strip` after `.main-body`,
 * not before, and this is the one surface whose height every layout below it
 * already budgets for regardless of order. Split out of {@link DriveRoomChrome}
 * so the caller can place it at the bottom of the page.
 *
 * Constraint for whoever moves this next: it has to stay a *sibling* of the
 * Spotlight/feed split, never a child of the feed column. That column goes
 * `w-0` + `inert` when the feed folds (Chat.tsx), so a strip parented to it
 * would take every call control — Leave included — down with the fold.
 */
export function DriveCallStripDock({
	session,
	disabled,
	composition = "hub",
	turnInFlight = false,
	spend = null,
	modelShortlist = [],
	currentModel,
	onSelectModel,
	planOpen = false,
	onTogglePlan,
	onLeaveDrive,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	/** Consumer `?app=1` uses the thin reach strip. */
	composition?: "hub" | "app";
	turnInFlight?: boolean;
	spend?: CallSpendSnapshot | null;
	modelShortlist?: readonly string[];
	currentModel?: string;
	onSelectModel?: (providerModel: string) => void;
	/** Plan sheet open — owned by Chat so PlanEditor stays off Spotlight. */
	planOpen?: boolean;
	onTogglePlan?: () => void;
	/** Wrap leave (e.g. return to lobby + keep-running note). */
	onLeaveDrive?: () => void;
}) {
	const {
		captionsOpen,
		drive,
		driveVoice,
		stripHandlers,
		chatForks,
		workersPanelOpen,
		leaveDrive,
		cancelFork,
		transcriptLines,
	} = session;
	const [powerOpen, setPowerOpen] = useState(false);
	const { powerChrome, setPowerChrome } = useDrivePowerChromePref();
	const spendLabel = hasCallSpend(spend) && spend ? formatCallSpend(spend) : undefined;
	const appShell = composition === "app";
	const interrupt = interruptBannerCopy(
		resolveInterruptPhase({
			handRaised: drive.handRaised,
			turnInFlight,
		}),
	);
	const handleLeave = () => {
		(onLeaveDrive ?? leaveDrive)();
	};
	return (
		<>
			{appShell && interrupt ? (
				<div
					aria-live="polite"
					className="border-t border-amber-500/40 bg-amber-500/10 px-3 py-2"
					data-slot="agency-interrupt-banner"
					role="status"
				>
					<p className="text-sm font-semibold text-amber-950 dark:text-amber-100">
						{interrupt.title}
					</p>
					<p className="text-[11px] text-amber-900/90 dark:text-amber-100/80">
						{interrupt.hint}
					</p>
					<p className="sr-only">{INTERRUPT_HARD_CANCEL_HINT}</p>
				</div>
			) : null}
			<DriveCallStrip
				captionsOpen={captionsOpen}
				composition={composition}
				disabled={disabled}
				drive={drive}
				onLeaveDrive={handleLeave}
				onTogglePlan={appShell ? undefined : onTogglePlan}
				onTogglePower={
					appShell ? undefined : () => setPowerOpen((open) => !open)
				}
				outputVolume={driveVoice.hardware.outputVolume}
				planOpen={planOpen}
				powerOpen={powerOpen}
				spendLabel={appShell ? undefined : spendLabel}
				turnInFlight={turnInFlight}
				workerCount={chatForks.length}
				workersOpen={workersPanelOpen}
				{...stripHandlers}
			/>
			{/* ADR-0029 D4: captions are a sheet — never steal Spotlight flex height. */}
			<Dialog
				onOpenChange={(open) => {
					if (open !== captionsOpen) {
						stripHandlers.onToggleCaptions();
					}
				}}
				open={drive.active && captionsOpen}
			>
				<DialogContent className="max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
					<DialogHeader className="sr-only">
						<DialogTitle>Live captions</DialogTitle>
						<DialogDescription>
							Ephemeral call transcript. Not retained after leave.
						</DialogDescription>
					</DialogHeader>
					<DriveTranscriptPanel lines={transcriptLines} />
				</DialogContent>
			</Dialog>
			<DrivePowerSheet
				chatForks={chatForks}
				currentModel={currentModel}
				drive={drive}
				modelShortlist={modelShortlist}
				onCancelFork={cancelFork}
				onOpenChange={setPowerOpen}
				onPowerChromeChange={setPowerChrome}
				onSelectModel={onSelectModel}
				open={powerOpen}
				powerChrome={powerChrome}
				spend={spend}
			/>
		</>
	);
}

/** Mic + confirm-send — mounts above the composer. */
export function DriveVoiceBar({
	session,
	disabled,
	sending,
	composition = "hub",
	onSendSpoken,
	onSttError,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	sending: boolean;
	/** Consumer shell: hold-to-talk primary (NOW-HOLD-TALK). */
	composition?: "hub" | "app";
	onSendSpoken: (text: string) => void;
	onSttError: (message: string) => void;
}) {
	const {
		drive,
		driveVoice,
		voiceCaption,
		setVoiceCaption,
		driveVoiceResolved,
		stripHandlers,
	} = session;

	if (!drive.active) {
		return null;
	}

	if (!driveVoiceResolved.ok) {
		return (
			<div className="border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">
				Voice topology invalid: {driveVoiceResolved.message}
			</div>
		);
	}

	if (composition === "app") {
		return (
			<DriveHoldToTalkBar
				disabled={disabled || sending}
				forceMode={driveVoiceResolved.forceMode}
				micDeviceId={driveVoice.hardware.micDeviceId}
				muted={drive.muted}
				onMuteToggle={stripHandlers.onMuteToggle}
				onSendSpoken={onSendSpoken}
				onSttError={onSttError}
				sttBackend={driveVoiceResolved.topology.stt}
				sttConfig={driveVoice.facets["providers.sttConfig"]}
			/>
		);
	}

	return (
		<div className="space-y-0">
			<DriveMicBar
				caption={voiceCaption}
				disabled={disabled || sending}
				forceMode={driveVoiceResolved.forceMode}
				micDeviceId={driveVoice.hardware.micDeviceId}
				muted={drive.muted}
				onCaptionChange={setVoiceCaption}
				onSttError={onSttError}
				onTranscription={(text) => {
					setVoiceCaption(text.trim());
				}}
				sttBackend={driveVoiceResolved.topology.stt}
				sttConfig={driveVoice.facets["providers.sttConfig"]}
			/>
			{voiceCaption.trim() && !drive.muted ? (
				<div className="flex items-center justify-end gap-2 border-t bg-background px-3 py-2">
					<Button
						disabled={disabled || sending}
						onClick={() => setVoiceCaption(clearVoiceCaptionDraft())}
						size="sm"
						type="button"
						variant="ghost"
					>
						Discard
					</Button>
					<Button
						disabled={disabled || sending}
						onClick={() => onSendSpoken(voiceCaption)}
						size="sm"
						type="button"
					>
						Send spoken
					</Button>
				</div>
			) : null}
		</div>
	);
}

/**
 * NOW-HOLD-TALK: 52px press-and-hold primary. Temp-unmutes for the utterance
 * so hub mute gate + client flushVoiceSend agree, then restores muted default.
 */
function DriveHoldToTalkBar({
	disabled,
	forceMode,
	micDeviceId,
	muted,
	sttBackend,
	sttConfig,
	onMuteToggle,
	onSendSpoken,
	onSttError,
}: {
	disabled: boolean;
	forceMode: SpeechInputMode;
	micDeviceId?: string;
	muted: boolean;
	sttBackend: SttBackend;
	sttConfig?: Record<string, unknown>;
	onMuteToggle: () => void;
	onSendSpoken: (text: string) => void;
	onSttError: (message: string) => void;
}) {
	const captionRef = useRef("");
	const listeningRef = useRef(false);
	const releasedRef = useRef(false);
	const unmutedByHoldRef = useRef(false);
	const settledRef = useRef(false);
	const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mutedRef = useRef(muted);
	mutedRef.current = muted;

	const capabilities = readSpeechInputCapabilities();
	const resolvedMode = resolveSpeechInputMode({
		requested: forceMode,
		capabilities,
	});
	const unavailable = describeSpeechInputUnavailable({
		requested: forceMode,
		capabilities,
	});

	const restoreMute = () => {
		if (muteRestoreAfterHold({ unmutedByHold: unmutedByHoldRef.current }) === "mute") {
			onMuteToggle();
		}
		unmutedByHoldRef.current = false;
	};

	const settleHold = () => {
		if (settledRef.current || listeningRef.current || !releasedRef.current) {
			return;
		}
		settledRef.current = true;
		if (settleTimerRef.current) {
			clearTimeout(settleTimerRef.current);
			settleTimerRef.current = null;
		}
		const text = captionRef.current.trim();
		captionRef.current = "";
		if (text) {
			onSendSpoken(text);
		}
		restoreMute();
	};

	return (
		<div className="space-y-1 border-t bg-background px-3 py-2">
			<p className="text-center text-[11px] text-muted-foreground">
				{unavailable ??
					(muted
						? "Mic off until you hold — release to send."
						: "Hold to talk — release to send.")}
			</p>
			<SpeechInput
				aria-label="Hold to talk"
				deviceId={micDeviceId}
				disabled={disabled}
				forceMode={resolvedMode}
				holdToTalk
				onAudioRecorded={async (blob) => {
					try {
						const text = await transcribeAudioBlob({
							blob,
							backend: sttBackend,
							config: sttConfig,
						});
						if (text) {
							captionRef.current = text.trim();
							settleHold();
						} else if (releasedRef.current) {
							settleHold();
						}
						return text;
					} catch (error) {
						const message =
							error instanceof LocalSttError
								? error.message
								: `STT failed: ${String(error)}`;
						onSttError(message);
						releasedRef.current = true;
						settleHold();
						return "";
					}
				}}
				onCaptureError={onSttError}
				onListeningChange={(listening) => {
					listeningRef.current = listening;
					if (listening) {
						settledRef.current = false;
						releasedRef.current = false;
						captionRef.current = "";
						if (settleTimerRef.current) {
							clearTimeout(settleTimerRef.current);
							settleTimerRef.current = null;
						}
						if (mutedRef.current) {
							unmutedByHoldRef.current = true;
							onMuteToggle();
						}
						return;
					}
					releasedRef.current = true;
					// Caption may already be final (Web Speech) or arrive later
					// (media-recorder). Prefer immediate settle when text exists.
					if (captionRef.current.trim()) {
						settleHold();
						return;
					}
					settleTimerRef.current = setTimeout(() => settleHold(), 500);
				}}
				onTranscriptionChange={(text) => {
					const trimmed = text.trim();
					if (!trimmed) {
						return;
					}
					captionRef.current = trimmed;
					if (releasedRef.current) {
						settleHold();
					}
				}}
			/>
		</div>
	);
}
