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
import type { RosterPack } from "@cline/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NowNext } from "../components/NowNext";
import { downloadTextFile } from "../status/downloadTextFile";
import { DriveCallStrip } from "./DriveCallChrome";
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
		captionsOpen,
		drive,
		setDrive,
		driveVoice,
		setDriveVoice,
		driveJoinNote,
		transcriptLines,
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
			{drive.active && captionsOpen ? (
				<DriveTranscriptPanel lines={transcriptLines} />
			) : null}
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
	turnInFlight = false,
	spend = null,
	modelShortlist = [],
	currentModel,
	onSelectModel,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	turnInFlight?: boolean;
	spend?: CallSpendSnapshot | null;
	modelShortlist?: readonly string[];
	currentModel?: string;
	onSelectModel?: (providerModel: string) => void;
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
	} = session;
	const [powerOpen, setPowerOpen] = useState(false);
	const { powerChrome, setPowerChrome } = useDrivePowerChromePref();
	const spendLabel = hasCallSpend(spend) && spend ? formatCallSpend(spend) : undefined;
	return (
		<>
			<DriveCallStrip
				captionsOpen={captionsOpen}
				disabled={disabled}
				drive={drive}
				onLeaveDrive={leaveDrive}
				onTogglePower={() => setPowerOpen((open) => !open)}
				outputVolume={driveVoice.hardware.outputVolume}
				powerOpen={powerOpen}
				spendLabel={spendLabel}
				turnInFlight={turnInFlight}
				workerCount={chatForks.length}
				workersOpen={workersPanelOpen}
				{...stripHandlers}
			/>
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
	onSendSpoken,
	onSttError,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	sending: boolean;
	onSendSpoken: (text: string) => void;
	onSttError: (message: string) => void;
}) {
	const {
		drive,
		driveVoice,
		voiceCaption,
		setVoiceCaption,
		driveVoiceResolved,
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
