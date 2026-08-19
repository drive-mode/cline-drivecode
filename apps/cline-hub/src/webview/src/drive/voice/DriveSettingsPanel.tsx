import type { DeploymentProfile, DriveFacetValues } from "@cline/shared";
import { useState } from "react";
import {
	MicSelector,
	MicSelectorContent,
	MicSelectorEmpty,
	MicSelectorInput,
	MicSelectorItem,
	MicSelectorList,
	MicSelectorTrigger,
	MicSelectorValue,
} from "@/components/ai-elements/mic-selector";
import { Button } from "@/components/ui/button";
import {
	DRIVE_EARCON_FACET_ID,
	DRIVE_EARCON_GAIN_RATIO,
	DRIVE_EARCON_KINDS,
	DRIVE_EARCON_LABEL,
	type DriveEarconKind,
} from "./driveEarcons";
import type { DriveHardwarePrefs } from "./driveHardwarePrefs";
import {
	outputVolumeFromPercent,
	outputVolumePercent,
} from "./driveHardwarePrefs";
import { listDriveSettingsProviders } from "./driveSettingsModel";
import type { DriveVoiceUi } from "./driveVoiceUi";
import { resolveLlmEgressForUi } from "./driveVoiceUi";
import { SpeakerDeviceSelect } from "./SpeakerDeviceSelect";

const PROFILES: DeploymentProfile[] = ["local", "cloud", "hybrid"];

export function DriveSettingsPanel({
	providerId,
	voice,
	onClose,
	onProfileChange,
	onSttChange,
	onTtsChange,
	onTtsEnabledChange,
	onEarconChange,
	onHardwareChange,
	onPresentSampleDiagram,
	onPresentSampleAnimation,
	onPresentSampleCapture,
	onEnqueueSampleDiagram,
	onTickShowDirector,
	onAttachSampleScript,
	onAdvanceSampleScript,
	onSetShowPlannerMode,
	onDumpSessionRollups,
	onExportShippedDigest,
	presentSampleDisabled,
}: {
	providerId: string;
	voice: DriveVoiceUi;
	onClose: () => void;
	onProfileChange: (profile: DeploymentProfile) => void;
	onSttChange: (sttId: string) => void;
	onTtsChange: (ttsId: string) => void;
	onTtsEnabledChange: (enabled: boolean) => void;
	onEarconChange: (kind: DriveEarconKind, enabled: boolean) => void;
	onHardwareChange: (patch: Partial<DriveHardwarePrefs>) => void;
	/** Sample / dev — posts drive.show.present (no LLM). */
	onPresentSampleDiagram?: () => void;
	/** Sample / dev — present a walkthrough.animation (before/after motion). */
	onPresentSampleAnimation?: () => void;
	/** Sample / dev — present a capture.screenshot (metadata + out-of-band ref). */
	onPresentSampleCapture?: () => void;
	/** Sample / dev — enqueue without presenting. */
	onEnqueueSampleDiagram?: () => void;
	/** Sample / dev — rank + present top backlog item. */
	onTickShowDirector?: () => void;
	onAttachSampleScript?: () => void;
	onAdvanceSampleScript?: () => void;
	onSetShowPlannerMode?: (mode: "off" | "heuristic") => void;
	/** Local SessionRollup dump (Slice 2) — no network egress. */
	onDumpSessionRollups?: () => Promise<string>;
	/** Opt-in shipped digest export (DRV-SHIPPED-DIGEST) — local file only. */
	onExportShippedDigest?: () => Promise<string>;
	presentSampleDisabled?: boolean;
}) {
	const llm = resolveLlmEgressForUi({
		profile: voice.profile,
		providerId,
	});
	const sttOptions = listDriveSettingsProviders({
		facets: voice.facets,
		llm,
		slot: "stt",
	});
	const ttsOptions = listDriveSettingsProviders({
		facets: voice.facets,
		llm,
		slot: "tts",
	});
	const volumePercent = outputVolumePercent(voice.hardware.outputVolume);
	const earconPercentOfPartner = Math.round(DRIVE_EARCON_GAIN_RATIO * 100);
	const [rollupDump, setRollupDump] = useState<string | null>(null);
	const [rollupBusy, setRollupBusy] = useState(false);
	const [digestBusy, setDigestBusy] = useState(false);
	const [digestNote, setDigestNote] = useState<string | null>(null);

	return (
		<div className="space-y-3 border-t bg-muted/20 px-3 py-3 text-sm">
			<div className="flex items-center justify-between gap-2">
				<h3 className="font-medium">Drive Settings</h3>
				<Button onClick={onClose} size="sm" type="button" variant="ghost">
					Close
				</Button>
			</div>

			<label className="block space-y-1">
				<span className="text-xs text-muted-foreground">Runtime profile</span>
				<select
					className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
					onChange={(event) =>
						onProfileChange(event.target.value as DeploymentProfile)
					}
					value={voice.profile}
				>
					{PROFILES.map((profile) => (
						<option key={profile} value={profile}>
							{profile}
						</option>
					))}
				</select>
			</label>

			<label className="block space-y-1">
				<span className="text-xs text-muted-foreground">Speech in (STT)</span>
				<select
					className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
					onChange={(event) => onSttChange(event.target.value)}
					value={voice.facets["providers.sttId"]}
				>
					{sttOptions.map((option) => (
						<option
							disabled={!option.selectable}
							key={option.id}
							title={option.disabledReason}
							value={option.id}
						>
							{option.title}
							{option.selectable ? "" : " (incompatible)"}
						</option>
					))}
				</select>
			</label>

			<label className="block space-y-1">
				<span className="text-xs text-muted-foreground">Speech out (TTS)</span>
				<select
					className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
					onChange={(event) => onTtsChange(event.target.value)}
					value={voice.facets["providers.ttsId"]}
				>
					{ttsOptions.map((option) => (
						<option
							disabled={!option.selectable}
							key={option.id}
							title={option.disabledReason}
							value={option.id}
						>
							{option.title}
							{option.selectable ? "" : " (incompatible)"}
						</option>
					))}
				</select>
			</label>

			<label className="flex items-center gap-2 text-sm">
				<input
					checked={voice.facets["tts.enabled"] === true}
					onChange={(event) => onTtsEnabledChange(event.target.checked)}
					type="checkbox"
				/>
				<span>Speak partner narration (off by default)</span>
			</label>

			<div className="space-y-1">
				<span className="text-xs text-muted-foreground">Earcons</span>
				{DRIVE_EARCON_KINDS.map((kind) => (
					<label className="flex items-center gap-2 text-sm" key={kind}>
						<input
							checked={voice.facets[DRIVE_EARCON_FACET_ID[kind]] === true}
							data-testid={`drive-earcon-${kind}`}
							onChange={(event) => onEarconChange(kind, event.target.checked)}
							type="checkbox"
						/>
						<span>{DRIVE_EARCON_LABEL[kind]}</span>
					</label>
				))}
				<p className="text-[11px] text-muted-foreground">
					Short synthesized tones at {earconPercentOfPartner}% of partner
					volume. Mute silences all of them, as does a system reduced-motion
					preference.
				</p>
			</div>

			<div className="space-y-1">
				<span className="text-xs text-muted-foreground">Microphone</span>
				<MicSelector
					onValueChange={(deviceId) =>
						onHardwareChange({
							micDeviceId:
								!deviceId || deviceId === "__default__" ? undefined : deviceId,
						})
					}
					value={voice.hardware.micDeviceId ?? "__default__"}
				>
					<MicSelectorTrigger className="w-full justify-between">
						<MicSelectorValue />
					</MicSelectorTrigger>
					<MicSelectorContent>
						<MicSelectorInput />
						<MicSelectorList>
							{(devices) => (
								<>
									<MicSelectorEmpty />
									<MicSelectorItem value="__default__">
										System default
									</MicSelectorItem>
									{devices.map((device) => (
										<MicSelectorItem
											key={device.deviceId}
											value={device.deviceId}
										>
											{device.label || `Microphone ${device.deviceId}`}
										</MicSelectorItem>
									))}
								</>
							)}
						</MicSelectorList>
					</MicSelectorContent>
				</MicSelector>
				<p className="text-[11px] text-muted-foreground">
					Applies to MediaRecorder capture (local STT). Web Speech uses the
					browser default mic.
				</p>
			</div>

			<div className="space-y-1">
				<span className="text-xs text-muted-foreground">Speaker</span>
				<SpeakerDeviceSelect
					onChange={(speakerDeviceId) => onHardwareChange({ speakerDeviceId })}
					value={voice.hardware.speakerDeviceId}
				/>
				<p className="text-[11px] text-muted-foreground">
					Routes HTML audio / Web Audio playback via setSinkId. Browser
					speechSynthesis still uses the OS default speaker.
				</p>
			</div>

			<label className="block space-y-1">
				<span className="flex items-center justify-between text-xs text-muted-foreground">
					<span>Partner volume</span>
					<span className="font-mono tabular-nums">{volumePercent}%</span>
				</span>
				<input
					aria-label="Partner playback volume"
					className="w-full accent-foreground"
					max={100}
					min={0}
					onChange={(event) =>
						onHardwareChange({
							outputVolume: outputVolumeFromPercent(Number(event.target.value)),
						})
					}
					type="range"
					value={volumePercent}
				/>
				<p className="text-[11px] text-muted-foreground">
					The same value the call strip slider edits — one volume, two places to
					reach it.
				</p>
			</label>

			<p className="text-xs text-muted-foreground">
				LLM providers and API keys stay in Cline Auth / provider settings. Drive
				only stores profile and voice provider ids (no secrets). Mic, speaker,
				and volume stay on this machine.
			</p>
			<p className="font-mono text-[11px] text-muted-foreground">
				{summarizeFacets(voice.facets)} · {summarizeHardware(voice.hardware)}
			</p>

			{onDumpSessionRollups ? (
				<div className="space-y-2 rounded-md border border-dashed border-sky-500/40 bg-sky-500/5 p-3">
					<div className="text-xs font-medium text-sky-800 dark:text-sky-200">
						Session rollups (local)
					</div>
					<p className="text-[11px] text-muted-foreground">
						Last N call-session metrics from room + bank JSONL on this machine.
						No cloud telemetry.
					</p>
					<Button
						data-testid="drive-dump-session-rollups"
						disabled={rollupBusy || presentSampleDisabled}
						onClick={() => {
							setRollupBusy(true);
							void onDumpSessionRollups()
								.then((text) => setRollupDump(text))
								.catch((error) =>
									setRollupDump(
										error instanceof Error ? error.message : String(error),
									),
								)
								.finally(() => setRollupBusy(false));
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						{rollupBusy ? "Loading…" : "Dump last rollups"}
					</Button>
					{rollupDump ? (
						<pre
							className="max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono text-[10px] leading-snug text-muted-foreground"
							data-testid="drive-session-rollups-dump"
						>
							{rollupDump}
						</pre>
					) : null}
					{onExportShippedDigest ? (
						<>
							<Button
								data-testid="drive-export-shipped-digest"
								disabled={digestBusy || presentSampleDisabled}
								onClick={() => {
									setDigestBusy(true);
									setDigestNote(null);
									void onExportShippedDigest()
										.then((note) => setDigestNote(note))
										.catch((error) =>
											setDigestNote(
												error instanceof Error ? error.message : String(error),
											),
										)
										.finally(() => setDigestBusy(false));
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								{digestBusy ? "Exporting…" : "Export shipped digest"}
							</Button>
							{digestNote ? (
								<p
									className="text-[11px] text-muted-foreground"
									data-testid="drive-shipped-digest-note"
								>
									{digestNote}
								</p>
							) : null}
						</>
					) : null}
				</div>
			) : null}

			{onPresentSampleDiagram ? (
				<div className="space-y-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
					<div className="text-xs font-medium text-amber-800 dark:text-amber-200">
						Sample / dev
					</div>
					<p className="text-[11px] text-muted-foreground">
						Present a fixture artifact — diagram, before/after animation, or
						capture card — onto the sticky stage. No LLM credential required.
						Used to smoke drive.show.present until the planner lands.
					</p>
					<Button
						data-testid="drive-present-sample-diagram"
						disabled={presentSampleDisabled}
						onClick={onPresentSampleDiagram}
						size="sm"
						type="button"
						variant="outline"
					>
						Present sample diagram
					</Button>
					{onPresentSampleAnimation ? (
						<Button
							data-testid="drive-present-sample-animation"
							disabled={presentSampleDisabled}
							onClick={onPresentSampleAnimation}
							size="sm"
							type="button"
							variant="outline"
						>
							Present sample animation
						</Button>
					) : null}
					{onPresentSampleCapture ? (
						<Button
							data-testid="drive-present-sample-capture"
							disabled={presentSampleDisabled}
							onClick={onPresentSampleCapture}
							size="sm"
							type="button"
							variant="outline"
						>
							Present sample capture
						</Button>
					) : null}
					{onEnqueueSampleDiagram ? (
						<Button
							data-testid="drive-enqueue-sample-diagram"
							disabled={presentSampleDisabled}
							onClick={onEnqueueSampleDiagram}
							size="sm"
							type="button"
							variant="outline"
						>
							Enqueue sample diagram
						</Button>
					) : null}
					{onTickShowDirector ? (
						<Button
							data-testid="drive-tick-show-director"
							disabled={presentSampleDisabled}
							onClick={onTickShowDirector}
							size="sm"
							type="button"
							variant="outline"
						>
							Tick show director
						</Button>
					) : null}
					{onAttachSampleScript ? (
						<Button
							data-testid="drive-attach-sample-script"
							disabled={presentSampleDisabled}
							onClick={onAttachSampleScript}
							size="sm"
							type="button"
							variant="outline"
						>
							Attach sample script
						</Button>
					) : null}
					{onAdvanceSampleScript ? (
						<Button
							data-testid="drive-advance-sample-script"
							disabled={presentSampleDisabled}
							onClick={onAdvanceSampleScript}
							size="sm"
							type="button"
							variant="outline"
						>
							Next script beat
						</Button>
					) : null}
					{onSetShowPlannerMode ? (
						<div className="flex flex-wrap gap-2 pt-1">
							<Button
								data-testid="drive-planner-heuristic"
								disabled={presentSampleDisabled}
								onClick={() => onSetShowPlannerMode("heuristic")}
								size="sm"
								type="button"
								variant="outline"
							>
								Planner on
							</Button>
							<Button
								data-testid="drive-planner-off"
								disabled={presentSampleDisabled}
								onClick={() => onSetShowPlannerMode("off")}
								size="sm"
								type="button"
								variant="outline"
							>
								Planner off
							</Button>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function summarizeFacets(facets: DriveFacetValues): string {
	return `stt=${facets["providers.sttId"]} tts=${facets["providers.ttsId"]} ceiling=${facets["runtime.egressCeiling"]}`;
}

function summarizeHardware(hardware: DriveHardwarePrefs): string {
	const mic = hardware.micDeviceId ? "custom" : "default";
	const speaker = hardware.speakerDeviceId ? "custom" : "default";
	return `mic=${mic} speaker=${speaker} vol=${Math.round(hardware.outputVolume * 100)}`;
}
