import type { PlanReentryRowModel } from "@cline/drive";
import {
	applyPlanImproveAccept,
	buildShippedDigest,
	createMemoryBankFs,
	formatShippedDigestMarkdown,
	planPlanImproveResolve,
	statusSessionRowFromUnknown,
} from "@cline/drive";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NowNext } from "../components/NowNext";
import { downloadTextFile } from "../status/downloadTextFile";
import { DriveCallStrip } from "./DriveCallChrome";
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
export function DriveRoster({ session }: { session: UseDriveSessionResult }) {
	const { drive, setDrive } = session;
	if (!drive.active) {
		return null;
	}
	return (
		<Roster
			drive={drive}
			onDriveChange={setDrive}
			onTranscriptFocus={(participantId) => {
				setDrive((current) => applyTranscriptFocus(current, participantId));
			}}
			workspaceRoot={session.workspaceRoot}
		/>
	);
}

/** Call strip, settings, now/next, join note — mounts above the conversation. */
export function DriveRoomChrome({
	session,
	disabled,
	providerId,
	showRoster = true,
	turnInFlight = false,
	onCleanDrainContinue,
	onCleanDrainDismiss,
	onPlanningImproveResolved,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	providerId: string;
	/** False when the caller mounts {@link DriveRoster} itself (feed drawer). */
	showRoster?: boolean;
	turnInFlight?: boolean;
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
		stripHandlers,
		chatForks,
		transcriptLines,
		workersPanelOpen,
		joinDrive,
		leaveDrive,
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
		if (root) {
			try {
				await requestPlanImproveResolve(root, proposal, decision);
			} catch {
				if (decision === "accept") {
					// Keep card so the user can retry durable accept.
					return;
				}
				// reject/mute must not write — clear locally even if hub errors.
			}
		} else {
			// Demo / no workspace: memory BankFs only (still gated).
			const plan = planPlanImproveResolve({ proposal, decision });
			await applyPlanImproveAccept(createMemoryBankFs(), plan);
		}
		setDrive((current) => ({
			...current,
			pendingPlanningImprove: null,
			agencyBanner:
				decision === "accept"
					? "Planning improve accepted"
					: decision === "mute"
						? "Planning improve muted"
						: "Planning improve rejected",
		}));
		onPlanningImproveResolved?.(decision, proposal.offerKey);
	};

	return (
		<>
			<DriveCallStrip
				captionsOpen={captionsOpen}
				disabled={disabled}
				drive={drive}
				onLeaveDrive={leaveDrive}
				outputVolume={driveVoice.hardware.outputVolume}
				turnInFlight={turnInFlight}
				workerCount={chatForks.length}
				workersOpen={workersPanelOpen}
				{...stripHandlers}
			/>
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
			{showRoster ? <DriveRoster session={session} /> : null}
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
			{drive.active ? (
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
