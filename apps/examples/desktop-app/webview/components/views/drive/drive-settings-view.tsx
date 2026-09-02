"use client";

/**
 * Drive Settings — Voice, Appearance, Privacy, Demo world, Wire.
 *
 * Every preference persists through `drive-prefs.ts` (client-local, never a
 * durable facet). The microphone check measures a level and drops each
 * buffer inside the same callback — nothing is recorded, transcribed or
 * sent. WIRE diagnostics are read from the provider plus a view-local event
 * counter; this view never keeps room state of its own.
 */

import {
	Check,
	Copy,
	Mic,
	RefreshCw,
	RotateCcw,
	SlidersHorizontal,
	Square,
	TriangleAlert,
	Volume2,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
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
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	CommandBadge,
	PageFrame,
	PageHeader,
} from "@/components/views/page-layout";
import { desktopClient } from "@/lib/desktop-client";
import type { DesktopTransportState } from "@/lib/desktop-transport";
import {
	DEFAULT_DRIVE_PREFS,
	type DrivePipCorner,
	type DriveStageLayout,
	useDrivePrefs,
} from "@/lib/drive/drive-prefs";
import { driveSectionDefinition } from "@/lib/drive/drive-section";
import {
	countWireEvent,
	DRIVE_PRIVACY_STATEMENTS,
	DRIVE_SETTINGS_SECTIONS,
	type DriveSettingsSectionId,
	displayHubUrl,
	formatWireDiagnostics,
	MIC_METER_BARS,
	MIC_METER_MAX_MS,
	micLevelFromSamples,
	micMeterLitBars,
	outputVolumeFromPercent,
	outputVolumePercent,
	PIP_CORNER_OPTIONS,
	phaseLabel,
	type SpeakerDeviceOption,
	STAGE_LAYOUT_OPTIONS,
	SYSTEM_DEFAULT_SPEAKER,
	sortedWireEventCounts,
	speakerDeviceOptions,
	speakerSelectionValue,
	totalWireEvents,
	type WireEventCounts,
	wireTimeLabel,
} from "@/lib/drive/drive-settings-model";
import { useDriveHub } from "@/lib/drive/use-drive-hub";
import { cn } from "@/lib/utils";

const CLOCK_TICK_MS = 5_000;

/* ------------------------------------------------------------ layout */

function SettingsSection({
	id,
	title,
	description,
	children,
}: {
	id: DriveSettingsSectionId;
	title: string;
	description: string;
	children: ReactNode;
}) {
	const headingId = `drive-settings-${id}-heading`;
	return (
		<section
			aria-labelledby={headingId}
			className="scroll-mt-6 rounded-lg border border-border bg-card"
			id={`drive-settings-${id}`}
		>
			<div className="border-b border-border px-5 py-4">
				<h2 className="text-base font-semibold text-foreground" id={headingId}>
					{title}
				</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
			</div>
			<div className="divide-y divide-border">{children}</div>
		</section>
	);
}

function SettingRow({
	label,
	description,
	htmlFor,
	control,
	children,
}: {
	label: string;
	description?: ReactNode;
	htmlFor?: string;
	/** Compact control rendered on the right of the label. */
	control?: ReactNode;
	/** Wide content rendered under the label. */
	children?: ReactNode;
}) {
	return (
		<div className="px-5 py-4">
			<div className="flex items-start justify-between gap-6">
				<div className="min-w-0 flex-1">
					{htmlFor ? (
						<Label
							className="text-sm font-medium text-foreground"
							htmlFor={htmlFor}
						>
							{label}
						</Label>
					) : (
						<div className="text-sm font-medium text-foreground">{label}</div>
					)}
					{description ? (
						<div className="mt-1 text-xs leading-5 text-muted-foreground">
							{description}
						</div>
					) : null}
				</div>
				{control ? <div className="shrink-0">{control}</div> : null}
			</div>
			{children ? <div className="mt-3">{children}</div> : null}
		</div>
	);
}

/* ------------------------------------------------------------- voice */

function useSpeakerDevices(): {
	options: SpeakerDeviceOption[];
	unnamed: boolean;
	supported: boolean;
	refresh: () => void;
} {
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const supported =
		typeof navigator !== "undefined" &&
		typeof navigator.mediaDevices?.enumerateDevices === "function";

	const refresh = useCallback(() => {
		if (!supported) {
			return;
		}
		navigator.mediaDevices
			.enumerateDevices()
			.then((list) => setDevices(list))
			.catch(() => setDevices([]));
	}, [supported]);

	useEffect(() => {
		if (!supported) {
			return;
		}
		refresh();
		const media = navigator.mediaDevices;
		media.addEventListener("devicechange", refresh);
		return () => media.removeEventListener("devicechange", refresh);
	}, [refresh, supported]);

	const options = useMemo(() => speakerDeviceOptions(devices), [devices]);
	const unnamed = devices.some(
		(device) => device.kind === "audiooutput" && !device.label,
	);
	return { options, unnamed, supported, refresh };
}

type MicCheckState =
	| { status: "idle" }
	| { status: "starting" }
	| { status: "listening"; level: number; peak: number }
	| { status: "error"; message: string };

/**
 * Level only. `getFloatTimeDomainData` fills a buffer this hook owns, the
 * RMS is read, and the buffer is overwritten on the next frame — it is never
 * copied, stored, encoded or sent. No MediaRecorder is ever created.
 */
function useMicCheck(reduceMotion: boolean): {
	state: MicCheckState;
	start: () => void;
	stop: () => void;
} {
	const [state, setState] = useState<MicCheckState>({ status: "idle" });
	const stopRef = useRef<(() => void) | null>(null);

	const stop = useCallback(() => {
		stopRef.current?.();
		stopRef.current = null;
		setState({ status: "idle" });
	}, []);

	const start = useCallback(() => {
		if (stopRef.current) {
			return;
		}
		if (
			typeof navigator === "undefined" ||
			typeof navigator.mediaDevices?.getUserMedia !== "function" ||
			typeof AudioContext === "undefined"
		) {
			setState({
				status: "error",
				message: "Microphone access is not available in this window.",
			});
			return;
		}
		setState({ status: "starting" });
		let cancelled = false;
		void navigator.mediaDevices
			.getUserMedia({ audio: true, video: false })
			.then((stream) => {
				if (cancelled) {
					for (const track of stream.getTracks()) {
						track.stop();
					}
					return;
				}
				const context = new AudioContext();
				const sourceNode = context.createMediaStreamSource(stream);
				const analyser = context.createAnalyser();
				analyser.fftSize = 1024;
				sourceNode.connect(analyser);
				// Deliberately not connected to `context.destination`: nothing
				// is played back, and nothing downstream can capture it.
				const buffer = new Float32Array(analyser.fftSize);
				let peak = 0;
				let frame = 0;
				let last = 0;
				const minFrameGap = reduceMotion ? 250 : 0;
				const tick = (at: number) => {
					if (at - last >= minFrameGap) {
						last = at;
						analyser.getFloatTimeDomainData(buffer);
						const level = micLevelFromSamples(buffer);
						buffer.fill(0);
						peak = Math.max(peak * 0.97, level);
						setState({ status: "listening", level, peak });
					}
					frame = requestAnimationFrame(tick);
				};
				frame = requestAnimationFrame(tick);
				const timeout = setTimeout(() => stopRef.current?.(), MIC_METER_MAX_MS);
				stopRef.current = () => {
					clearTimeout(timeout);
					cancelAnimationFrame(frame);
					sourceNode.disconnect();
					analyser.disconnect();
					for (const track of stream.getTracks()) {
						track.stop();
					}
					void context.close();
					buffer.fill(0);
					stopRef.current = null;
					setState({ status: "idle" });
				};
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				const name = error instanceof Error ? error.name : "";
				setState({
					status: "error",
					message:
						name === "NotAllowedError"
							? "Microphone permission was declined. Nothing was captured."
							: name === "NotFoundError"
								? "No microphone was found."
								: error instanceof Error
									? error.message
									: "Could not open the microphone.",
				});
			});
		stopRef.current = () => {
			cancelled = true;
			stopRef.current = null;
			setState({ status: "idle" });
		};
	}, [reduceMotion]);

	useEffect(() => () => stopRef.current?.(), []);

	return { state, start, stop };
}

function MicMeter({
	state,
	reduceMotion,
}: {
	state: MicCheckState;
	reduceMotion: boolean;
}) {
	const listening = state.status === "listening";
	const level = listening ? state.level : 0;
	const lit = micMeterLitBars(level);
	const peakBar = listening ? micMeterLitBars(state.peak) : 0;
	const percent = Math.round(level * 100);
	return (
		<div className="space-y-2">
			<meter
				aria-label="Microphone level"
				aria-valuetext={listening ? `${percent} percent` : "Not listening"}
				className="sr-only"
				max={100}
				min={0}
				value={percent}
			/>
			<div aria-hidden="true" className="flex h-6 items-end gap-0.5">
				{Array.from({ length: MIC_METER_BARS }, (_, index) => {
					const on = index < lit;
					const isPeak = index === peakBar - 1 && peakBar > lit;
					return (
						<span
							aria-hidden="true"
							className={cn(
								"flex-1 rounded-sm",
								!reduceMotion &&
									"transition-[height,background-color] duration-75",
								on ? "bg-primary" : isPeak ? "bg-primary/40" : "bg-muted",
							)}
							key={`bar-${index.toString()}`}
							style={{ height: `${40 + (index / MIC_METER_BARS) * 60}%` }}
						/>
					);
				})}
			</div>
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span aria-live="polite" role="status">
					{state.status === "listening"
						? `Listening — level ${percent}%`
						: state.status === "starting"
							? "Asking for the microphone…"
							: state.status === "error"
								? state.message
								: "Not listening."}
				</span>
				<span className="font-mono tabular-nums">{percent}%</span>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------- wire */

function useTransportState(): DesktopTransportState {
	const [state, setState] = useState<DesktopTransportState>(() =>
		desktopClient.getTransportState(),
	);
	useEffect(() => desktopClient.subscribeTransportState(setState), []);
	return state;
}

function useClipboard(): {
	copy: (text: string) => Promise<boolean>;
	copied: boolean;
} {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
		},
		[],
	);
	const copy = useCallback(async (text: string) => {
		let ok = false;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				ok = true;
			}
		} catch {
			ok = false;
		}
		if (!ok && typeof document !== "undefined") {
			const area = document.createElement("textarea");
			area.value = text;
			area.setAttribute("readonly", "");
			area.style.position = "fixed";
			area.style.opacity = "0";
			document.body.appendChild(area);
			area.select();
			try {
				ok = document.execCommand("copy");
			} catch {
				ok = false;
			}
			area.remove();
		}
		setCopied(ok);
		if (timer.current) {
			clearTimeout(timer.current);
		}
		timer.current = setTimeout(() => setCopied(false), 2_000);
		return ok;
	}, []);
	return { copy, copied };
}

function PhaseBadge({
	phase,
	reconnecting,
	reduceMotion,
}: {
	phase: ReturnType<typeof useDriveHub>["phase"];
	reconnecting: boolean;
	reduceMotion: boolean;
}) {
	const live = phase === "live" && !reconnecting;
	return (
		<Badge className="gap-1.5" variant={live ? "default" : "outline"}>
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 rounded-full",
					live && "bg-primary-foreground",
					live && !reduceMotion && "animate-pulse",
					phase === "demo" && "bg-primary",
					phase === "connecting" && "bg-muted-foreground",
					phase === "unreachable" && "bg-destructive",
					reconnecting && "bg-warning-solid",
				)}
			/>
			{reconnecting ? "Reconnecting" : phaseLabel(phase)}
		</Badge>
	);
}

/* --------------------------------------------------------------- view */

export function DriveSettingsView() {
	const definition = driveSectionDefinition("settings");
	const { phase, hub, source, room, roomId, callLive, retry } = useDriveHub();
	const [prefs, updatePrefs] = useDrivePrefs();
	const transportState = useTransportState();
	const speakers = useSpeakerDevices();
	const systemReduceMotion = useSystemReduceMotion();
	const reduceMotion = prefs.reduceMotion || systemReduceMotion;
	const mic = useMicCheck(reduceMotion);
	const clipboard = useClipboard();
	const ids = {
		volume: useId(),
		captions: useId(),
		speaker: useId(),
		feed: useId(),
		motion: useId(),
		pip: useId(),
		demo: useId(),
	};

	const [now, setNow] = useState(() => new Date().toISOString());
	useEffect(() => {
		const timer = setInterval(
			() => setNow(new Date().toISOString()),
			CLOCK_TICK_MS,
		);
		return () => clearInterval(timer);
	}, []);

	// Event counts are view-local: they describe what this window has seen
	// since it opened, not the hub's log.
	const [counts, setCounts] = useState<WireEventCounts>({});
	useEffect(() => {
		setCounts({});
		return source.subscribe((event) => {
			setCounts((previous) => countWireEvent(previous, event.event));
		});
	}, [source]);

	const [resetNote, setResetNote] = useState<string | null>(null);
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

	const volumePercent = outputVolumePercent(prefs.voice.outputVolume);
	const speakerValue = speakerSelectionValue(
		prefs.voice.speakerDeviceId,
		speakers.options,
	);
	const demoForced = phase === "demo" && !prefs.demoOptIn;
	const participants = room.snapshot?.participants.length ?? 0;

	const diagnostics = formatWireDiagnostics({
		phase,
		hubUrl: hub.url,
		hubError: hub.error,
		workspaceRoot: hub.workspaceRoot,
		reconnecting: hub.reconnecting,
		lastCheckedAt: hub.lastCheckedAt,
		transportState:
			source.kind === "demo" ? "n/a (demo world)" : transportState,
		roomId: room.roomId ?? roomId,
		seq: room.seq,
		callSessionId: room.callSessionId,
		lastEventAt: room.lastEventAt,
		callLive,
		participants,
		counts,
		generatedAt: now,
	});

	const jumpTo = (id: DriveSettingsSectionId) => {
		document
			.getElementById(`drive-settings-${id}`)
			?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
	};

	const resetLocalData = () => {
		mic.stop();
		updatePrefs(DEFAULT_DRIVE_PREFS);
		setCounts({});
		setResetNote("Drive local data reset to defaults.");
	};

	return (
		<PageFrame>
			<PageHeader
				description={definition.description}
				icon={SlidersHorizontal}
				meta={
					<PhaseBadge
						phase={phase}
						reconnecting={hub.reconnecting}
						reduceMotion={reduceMotion}
					/>
				}
				title={definition.label}
			/>

			<div className="grid gap-8 min-[1100px]:grid-cols-[11rem_minmax(0,1fr)]">
				<nav
					aria-label="Settings sections"
					className="hidden min-[1100px]:block"
				>
					<ul className="sticky top-0 space-y-0.5">
						{DRIVE_SETTINGS_SECTIONS.map((section) => (
							<li key={section.id}>
								<button
									className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
									onClick={() => jumpTo(section.id)}
									type="button"
								>
									{section.label}
								</button>
							</li>
						))}
					</ul>
				</nav>

				<div className="min-w-0 space-y-6">
					{/* ---------------------------------------------------- Voice */}
					<SettingsSection
						description={DRIVE_SETTINGS_SECTIONS[0]?.description ?? ""}
						id="voice"
						title="Voice"
					>
						<SettingRow
							description="How loud your partner's narration plays for you. This listener only."
							htmlFor={ids.volume}
							label="Partner volume"
						>
							<div className="flex items-center gap-4">
								<Volume2
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground"
								/>
								<Slider
									aria-label="Partner volume"
									aria-valuetext={`${volumePercent} percent`}
									className="max-w-md"
									id={ids.volume}
									max={100}
									min={0}
									onValueChange={(values) =>
										updatePrefs({
											voice: {
												outputVolume: outputVolumeFromPercent(values[0] ?? 0),
											},
										})
									}
									step={1}
									value={[volumePercent]}
								/>
								<span className="w-10 text-right font-mono text-sm tabular-nums text-foreground">
									{volumePercent}%
								</span>
							</div>
						</SettingRow>

						<SettingRow
							control={
								<Switch
									checked={prefs.voice.captions}
									id={ids.captions}
									onCheckedChange={(checked) =>
										updatePrefs({ voice: { captions: checked } })
									}
								/>
							}
							description="Show narration as text under the Spotlight."
							htmlFor={ids.captions}
							label="Captions"
						/>

						<SettingRow
							description={
								speakers.supported
									? speakers.unnamed
										? "Device names appear after a microphone check grants permission once. Routed with setSinkId; the OS default is used where that is unsupported."
										: "Routes narration playback. Stored locally by device id — never in a workspace facet."
									: "Output device selection is not available in this window."
							}
							htmlFor={ids.speaker}
							label="Speaker"
						>
							<div className="flex items-center gap-2">
								<Select
									disabled={!speakers.supported}
									onValueChange={(value) =>
										updatePrefs({
											voice: {
												speakerDeviceId:
													value === SYSTEM_DEFAULT_SPEAKER ? null : value,
											},
										})
									}
									value={speakerValue}
								>
									<SelectTrigger
										aria-label="Speaker output"
										className="min-w-64"
										id={ids.speaker}
										size="sm"
									>
										<SelectValue placeholder="System default" />
									</SelectTrigger>
									<SelectContent>
										{speakers.options.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									aria-label="Refresh speaker list"
									className="h-8"
									disabled={!speakers.supported}
									onClick={speakers.refresh}
									size="sm"
									type="button"
									variant="outline"
								>
									<RefreshCw aria-hidden="true" className="size-4" />
								</Button>
							</div>
						</SettingRow>

						<SettingRow
							control={
								mic.state.status === "listening" ||
								mic.state.status === "starting" ? (
									<Button
										onClick={mic.stop}
										size="sm"
										type="button"
										variant="outline"
									>
										<Square aria-hidden="true" className="size-3.5" />
										Stop
									</Button>
								) : (
									<Button
										onClick={mic.start}
										size="sm"
										type="button"
										variant="outline"
									>
										<Mic aria-hidden="true" className="size-4" />
										Check microphone
									</Button>
								)
							}
							description="Level only. Every audio buffer is measured and dropped in the same callback; nothing is recorded, transcribed or sent. The check stops itself after 15 seconds."
							label="Microphone check"
						>
							<MicMeter reduceMotion={reduceMotion} state={mic.state} />
						</SettingRow>
					</SettingsSection>

					{/* ----------------------------------------------- Appearance */}
					<SettingsSection
						description={DRIVE_SETTINGS_SECTIONS[1]?.description ?? ""}
						id="appearance"
						title="Appearance"
					>
						<SettingRow
							description="How the call view arranges the Spotlight and the room feed."
							label="Stage layout"
						>
							<ToggleGroup
								aria-label="Stage layout"
								className="justify-start gap-2"
								onValueChange={(value) => {
									if (value === "split" || value === "spotlight") {
										updatePrefs({ stageLayout: value as DriveStageLayout });
									}
								}}
								type="single"
								value={prefs.stageLayout}
								variant="outline"
							>
								{STAGE_LAYOUT_OPTIONS.map((option) => (
									<ToggleGroupItem
										aria-label={option.label}
										className="h-auto flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left data-[state=on]:border-primary data-[state=on]:bg-primary/5"
										key={option.id}
										value={option.id}
									>
										<span className="text-sm font-medium">{option.label}</span>
										<span className="text-xs font-normal text-muted-foreground">
											{option.description}
										</span>
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						</SettingRow>

						<SettingRow
							control={
								<Switch
									checked={prefs.feedCollapsed}
									id={ids.feed}
									onCheckedChange={(checked) =>
										updatePrefs({ feedCollapsed: checked })
									}
								/>
							}
							description="Open calls with the room feed drawer closed. Toggle it any time with [ and ]."
							htmlFor={ids.feed}
							label="Collapse the feed by default"
						/>

						<SettingRow
							control={
								<Switch
									checked={prefs.reduceMotion}
									id={ids.motion}
									onCheckedChange={(checked) =>
										updatePrefs({ reduceMotion: checked })
									}
								/>
							}
							description={
								systemReduceMotion
									? "Your system already asks for reduced motion, so pulses and waveforms are still regardless of this switch."
									: "Still the live pulse, beat animations and the microphone waveform."
							}
							htmlFor={ids.motion}
							label="Reduce motion"
						/>

						<SettingRow
							control={
								<Switch
									checked={!prefs.pipHidden}
									id={ids.pip}
									onCheckedChange={(checked) =>
										updatePrefs({ pipHidden: !checked })
									}
								/>
							}
							description="Keep a small Spotlight in view while you are in another section during a call."
							htmlFor={ids.pip}
							label="Picture-in-picture"
						>
							<fieldset className="grid w-40 grid-cols-2 gap-1.5">
								<legend className="sr-only">Picture-in-picture corner</legend>
								{PIP_CORNER_OPTIONS.map((option) => {
									const checked = prefs.pipCorner === option.id;
									const [vertical, horizontal] = option.id.split("-") as [
										"top" | "bottom",
										"left" | "right",
									];
									return (
										<button
											aria-label={option.label}
											aria-pressed={checked}
											className={cn(
												"relative h-12 rounded-md border bg-background transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
												checked
													? "border-primary"
													: "border-border hover:bg-surface-hover",
												prefs.pipHidden && "opacity-50",
											)}
											disabled={prefs.pipHidden}
											key={option.id}
											onClick={() =>
												updatePrefs({ pipCorner: option.id as DrivePipCorner })
											}
											title={option.label}
											type="button"
										>
											<span
												aria-hidden="true"
												className={cn(
													"absolute h-3 w-5 rounded-sm",
													checked ? "bg-primary" : "bg-muted-foreground/50",
													vertical === "top" ? "top-1.5" : "bottom-1.5",
													horizontal === "left" ? "left-1.5" : "right-1.5",
												)}
											/>
										</button>
									);
								})}
							</fieldset>
						</SettingRow>
					</SettingsSection>

					{/* -------------------------------------------------- Privacy */}
					<SettingsSection
						description={DRIVE_SETTINGS_SECTIONS[2]?.description ?? ""}
						id="privacy"
						title="Privacy"
					>
						<div className="px-5 py-4">
							<ul className="grid gap-3 min-[900px]:grid-cols-2">
								{DRIVE_PRIVACY_STATEMENTS.map((statement) => (
									<li
										className="rounded-md border border-border bg-background p-3"
										key={statement.title}
									>
										<div className="flex items-center gap-2 text-sm font-medium text-foreground">
											<Check
												aria-hidden="true"
												className="size-4 shrink-0 text-success-text"
											/>
											{statement.title}
										</div>
										<p className="mt-1 text-xs leading-5 text-muted-foreground">
											{statement.detail}
										</p>
									</li>
								))}
							</ul>
						</div>
						<SettingRow
							control={
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button size="sm" type="button" variant="outline">
											<RotateCcw aria-hidden="true" className="size-4" />
											Reset Drive local data
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>
												Reset Drive local data?
											</AlertDialogTitle>
											<AlertDialogDescription>
												Volume, captions, speaker choice, layout, motion,
												picture-in-picture and the demo opt-in go back to their
												defaults. Nothing on the hub or in the workspace
												changes.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction onClick={resetLocalData}>
												Reset
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							}
							description={
								<span aria-live="polite" role="status">
									{resetNote ??
										"Clears every preference this app keeps for Drive in local storage."}
								</span>
							}
							label="Reset"
						/>
					</SettingsSection>

					{/* ----------------------------------------------- Demo world */}
					<SettingsSection
						description={DRIVE_SETTINGS_SECTIONS[3]?.description ?? ""}
						id="demo"
						title="Demo world"
					>
						<SettingRow
							control={
								<Switch
									checked={phase === "demo"}
									disabled={demoForced}
									id={ids.demo}
									onCheckedChange={(checked) =>
										updatePrefs({ demoOptIn: checked })
									}
								/>
							}
							description={
								demoForced
									? "This window was opened with the demo flag, so the demo stays on until it is reopened without it."
									: phase === "demo"
										? "You are in the labeled fixture. Switching off returns to the hub."
										: "Explore Drive without a hub room. Labeled everywhere it shows."
							}
							htmlFor={ids.demo}
							label="Use the demo world"
						>
							<Collapsible>
								<CollapsibleTrigger asChild>
									<Button
										className="h-7 px-2 text-muted-foreground"
										size="xs"
										type="button"
										variant="ghost"
									>
										What is the demo?
									</Button>
								</CollapsibleTrigger>
								<CollapsibleContent className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
									A deterministic in-memory room — You, Cline, Riley and Sam
									fixing a router — folded through the same kernel a live room
									uses. Beats loop on a timer so the Spotlight stays alive.
									Every surface reads it through the same port as the hub, so
									nothing here touches a real hub, workspace or credential, and
									nothing you change in it survives a reload.
								</CollapsibleContent>
							</Collapsible>
						</SettingRow>
					</SettingsSection>

					{/* ------------------------------------------------------ Wire */}
					<SettingsSection
						description={DRIVE_SETTINGS_SECTIONS[4]?.description ?? ""}
						id="wire"
						title="Wire"
					>
						<div className="px-5 py-4">
							<div className="grid gap-x-8 gap-y-2 min-[900px]:grid-cols-2">
								<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
									<dt className="text-muted-foreground">Phase</dt>
									<dd>
										<PhaseBadge
											phase={phase}
											reconnecting={hub.reconnecting}
											reduceMotion={reduceMotion}
										/>
									</dd>
									<dt className="text-muted-foreground">Transport</dt>
									<dd className="font-mono text-xs text-foreground">
										{source.kind === "demo"
											? "n/a (demo world)"
											: transportState}
									</dd>
									<dt className="text-muted-foreground">Hub</dt>
									<dd className="truncate font-mono text-xs text-foreground">
										{displayHubUrl(hub.url)}
									</dd>
									<dt className="text-muted-foreground">Workspace</dt>
									<dd className="truncate font-mono text-xs text-foreground">
										{hub.workspaceRoot ?? "—"}
									</dd>
									<dt className="text-muted-foreground">Last check</dt>
									<dd className="text-xs text-foreground">
										{wireTimeLabel(hub.lastCheckedAt, now)}
									</dd>
									{hub.error ? (
										<>
											<dt className="text-muted-foreground">Error</dt>
											<dd className="flex items-start gap-1.5 text-xs text-destructive">
												<TriangleAlert
													aria-hidden="true"
													className="mt-0.5 size-3 shrink-0"
												/>
												<span className="break-words">{hub.error}</span>
											</dd>
										</>
									) : null}
								</dl>
								<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
									<dt className="text-muted-foreground">Room</dt>
									<dd className="truncate font-mono text-xs text-foreground">
										{room.roomId ?? roomId}
										{callLive ? " · call live" : ""}
									</dd>
									<dt className="text-muted-foreground">Session</dt>
									<dd className="truncate font-mono text-xs text-foreground">
										{room.callSessionId ?? "—"}
									</dd>
									<dt className="text-muted-foreground">Seq</dt>
									<dd className="font-mono text-xs tabular-nums text-foreground">
										{room.seq}
									</dd>
									<dt className="text-muted-foreground">Participants</dt>
									<dd className="font-mono text-xs tabular-nums text-foreground">
										{participants}
									</dd>
									<dt className="text-muted-foreground">Last event</dt>
									<dd className="text-xs text-foreground">
										{wireTimeLabel(room.lastEventAt, now)}
									</dd>
								</dl>
							</div>
						</div>

						<div className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div className="text-sm font-medium text-foreground">
									Events seen by this window
								</div>
								<CommandBadge>{totalWireEvents(counts)} total</CommandBadge>
							</div>
							{totalWireEvents(counts) === 0 ? (
								<p className="mt-2 text-xs text-muted-foreground">
									No hub events since this section opened. Join a call or wait
									for a beat.
								</p>
							) : (
								<table className="mt-3 w-full max-w-lg text-xs">
									<caption className="sr-only">Hub events by name</caption>
									<thead>
										<tr className="text-left text-muted-foreground">
											<th className="pb-1 font-medium" scope="col">
												Event
											</th>
											<th className="pb-1 text-right font-medium" scope="col">
												Count
											</th>
										</tr>
									</thead>
									<tbody>
										{sortedWireEventCounts(counts).map((row) => (
											<tr className="border-t border-border" key={row.name}>
												<td className="py-1 font-mono text-foreground">
													{row.name}
												</td>
												<td className="py-1 text-right font-mono tabular-nums text-foreground">
													{row.count}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>

						<div className="flex flex-wrap items-center gap-2 px-5 py-4">
							<Button
								disabled={phase === "connecting"}
								onClick={() => void retry()}
								size="sm"
								type="button"
								variant="outline"
							>
								<RefreshCw
									aria-hidden="true"
									className={cn(
										"size-4",
										phase === "connecting" && !reduceMotion && "animate-spin",
									)}
								/>
								{phase === "unreachable" ? "Retry now" : "Reconnect"}
							</Button>
							<Button
								onClick={() => {
									void clipboard.copy(diagnostics).then((ok) => {
										if (!ok) {
											setDiagnosticsOpen(true);
										}
									});
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								{clipboard.copied ? (
									<Check aria-hidden="true" className="size-4" />
								) : (
									<Copy aria-hidden="true" className="size-4" />
								)}
								{clipboard.copied ? "Copied" : "Copy diagnostics"}
							</Button>
							<Button
								onClick={() => setDiagnosticsOpen((open) => !open)}
								size="sm"
								type="button"
								variant="ghost"
							>
								{diagnosticsOpen ? "Hide text" : "Show text"}
							</Button>
							<span aria-live="polite" className="sr-only" role="status">
								{clipboard.copied ? "Diagnostics copied to the clipboard." : ""}
							</span>
						</div>
						{diagnosticsOpen ? (
							<div className="px-5 py-4">
								<textarea
									aria-label="Wire diagnostics"
									className="h-56 w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground"
									readOnly
									value={diagnostics}
								/>
							</div>
						) : null}
					</SettingsSection>
				</div>
			</div>
		</PageFrame>
	);
}

function useSystemReduceMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) {
			return;
		}
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduced(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	return reduced;
}
