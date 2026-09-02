/**
 * Pure model behind Drive Settings: section list, option labels, the
 * volume slider domain, speaker-device options (labels only), the
 * microphone level meter maths, and the WIRE diagnostics text.
 *
 * Everything a component would otherwise decide inline lives here so a
 * node-env test can reach it. Nothing here is audio, a transcript, a prompt,
 * a key or a model id: the meter takes one sample buffer and returns one
 * number; the buffer is dropped by the caller in the same callback.
 */

import type { DrivePipCorner, DriveStageLayout } from "./drive-prefs";
import type { DrivePhase } from "./use-drive-hub";

export type DriveSettingsSectionId =
	| "voice"
	| "appearance"
	| "privacy"
	| "demo"
	| "wire";

export type DriveSettingsSection = {
	id: DriveSettingsSectionId;
	label: string;
	description: string;
};

export const DRIVE_SETTINGS_SECTIONS: readonly DriveSettingsSection[] = [
	{
		id: "voice",
		label: "Voice",
		description: "Partner volume, captions, speaker and a microphone check.",
	},
	{
		id: "appearance",
		label: "Appearance",
		description: "How the call lays out and how much it moves.",
	},
	{
		id: "privacy",
		label: "Privacy",
		description: "What stays on this machine, and a reset.",
	},
	{
		id: "demo",
		label: "Demo world",
		description: "The labeled fixture you can explore without a hub.",
	},
	{
		id: "wire",
		label: "Wire",
		description: "Hub connection diagnostics.",
	},
];

export const STAGE_LAYOUT_OPTIONS: readonly {
	id: DriveStageLayout;
	label: string;
	description: string;
}[] = [
	{
		id: "split",
		label: "Split",
		description: "Spotlight beside the room feed.",
	},
	{
		id: "spotlight",
		label: "Spotlight",
		description: "Spotlight fills the call; the feed is a drawer.",
	},
];

export const PIP_CORNER_OPTIONS: readonly {
	id: DrivePipCorner;
	label: string;
}[] = [
	{ id: "top-left", label: "Top left" },
	{ id: "top-right", label: "Top right" },
	{ id: "bottom-left", label: "Bottom left" },
	{ id: "bottom-right", label: "Bottom right" },
];

/** Plain statements of what never leaves the device. */
export const DRIVE_PRIVACY_STATEMENTS: readonly {
	title: string;
	detail: string;
}[] = [
	{
		title: "Audio is never recorded",
		detail:
			"The microphone check measures a level and drops every buffer in the same callback. No audio or transcript is written anywhere.",
	},
	{
		title: "No prompts, tools, keys or model ids",
		detail:
			"Drive shows a typed capability and approval posture for each agent. Prompts, tool lists, providers, endpoints and model ids never reach this screen.",
	},
	{
		title: "Device ids stay local",
		detail:
			"Your speaker choice and volume live in this app's local storage, not in the workspace's Drive facets.",
	},
	{
		title: "The hub is the only writer",
		detail:
			"Room state you see here is folded from hub broadcasts. This app never keeps an authoritative copy.",
	},
];

/* ------------------------------------------------------------- volume */

export function clampOutputVolume(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

/** The 0–100 slider domain for the 0..1 pref. */
export function outputVolumePercent(volume: number): number {
	return Math.round(clampOutputVolume(volume) * 100);
}

/** Inverse of {@link outputVolumePercent}. */
export function outputVolumeFromPercent(percent: number): number {
	return clampOutputVolume(percent / 100);
}

/* ------------------------------------------------------------ speakers */

export const SYSTEM_DEFAULT_SPEAKER = "__default__";

export type SpeakerDeviceOption = {
	value: string;
	label: string;
};

type DeviceLike = {
	deviceId: string;
	kind: string;
	label: string;
};

/**
 * Options for the speaker select — labels only. `enumerateDevices` returns
 * empty labels until the person has granted a media permission once; those
 * rows get a numbered placeholder rather than the raw id.
 */
export function speakerDeviceOptions(
	devices: readonly DeviceLike[],
): SpeakerDeviceOption[] {
	const options: SpeakerDeviceOption[] = [
		{ value: SYSTEM_DEFAULT_SPEAKER, label: "System default" },
	];
	let unnamed = 0;
	for (const device of devices) {
		if (device.kind !== "audiooutput" || !device.deviceId) {
			continue;
		}
		if (device.deviceId === "default") {
			continue;
		}
		const label = device.label.trim();
		if (label) {
			options.push({ value: device.deviceId, label });
		} else {
			unnamed += 1;
			options.push({ value: device.deviceId, label: `Speaker ${unnamed}` });
		}
	}
	return options;
}

/** Whether a stored speaker id is still present; null id is always fine. */
export function speakerSelectionValue(
	speakerDeviceId: string | null,
	options: readonly SpeakerDeviceOption[],
): string {
	if (!speakerDeviceId) {
		return SYSTEM_DEFAULT_SPEAKER;
	}
	return options.some((option) => option.value === speakerDeviceId)
		? speakerDeviceId
		: SYSTEM_DEFAULT_SPEAKER;
}

/* ----------------------------------------------------------- mic meter */

export const MIC_METER_BARS = 24;
/** The check stops itself so a forgotten meter never keeps the mic open. */
export const MIC_METER_MAX_MS = 15_000;

/**
 * RMS level of one time-domain buffer, 0..1, lifted so quiet rooms still
 * register. The caller must not retain the buffer.
 */
export function micLevelFromSamples(samples: ArrayLike<number>): number {
	const length = samples.length;
	if (length === 0) {
		return 0;
	}
	let sum = 0;
	for (let index = 0; index < length; index += 1) {
		const sample = samples[index] ?? 0;
		sum += sample * sample;
	}
	const rms = Math.sqrt(sum / length);
	// Speech peaks around 0.1–0.3 RMS; scale so ordinary talking fills most
	// of the meter without the clamp flattening everything to 1.
	return Math.min(1, Math.max(0, rms * 4));
}

/** Number of lit bars for a level, never lighting a bar for silence. */
export function micMeterLitBars(level: number, bars = MIC_METER_BARS): number {
	const clamped = Math.min(1, Math.max(0, level));
	if (clamped <= 0.005) {
		return 0;
	}
	return Math.max(1, Math.round(clamped * bars));
}

/* ---------------------------------------------------------------- wire */

export type WireEventCounts = Readonly<Record<string, number>>;

/** Count one event by name; returns a new map so React sees the change. */
export function countWireEvent(
	counts: WireEventCounts,
	eventName: string,
): WireEventCounts {
	const name = eventName.trim() || "(unnamed)";
	return { ...counts, [name]: (counts[name] ?? 0) + 1 };
}

export function sortedWireEventCounts(
	counts: WireEventCounts,
): { name: string; count: number }[] {
	return Object.entries(counts)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function totalWireEvents(counts: WireEventCounts): number {
	return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function phaseLabel(phase: DrivePhase): string {
	switch (phase) {
		case "connecting":
			return "Connecting";
		case "live":
			return "Live";
		case "unreachable":
			return "Unreachable";
		case "demo":
			return "Demo world";
		default: {
			const _exhaustive: never = phase;
			return _exhaustive;
		}
	}
}

/** Hub URL with any credentials stripped, for display and copy. */
export function displayHubUrl(url: string | null): string {
	if (!url) {
		return "—";
	}
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		return parsed.toString().replace(/\/$/, "");
	} catch {
		return url;
	}
}

/** Relative + absolute label for a wire timestamp. */
export function wireTimeLabel(iso: string | null, nowIso: string): string {
	if (!iso) {
		return "No events yet";
	}
	const then = Date.parse(iso);
	const now = Date.parse(nowIso);
	if (!Number.isFinite(then) || !Number.isFinite(now)) {
		return iso;
	}
	const seconds = Math.max(0, Math.floor((now - then) / 1000));
	const relative =
		seconds < 5
			? "just now"
			: seconds < 60
				? `${seconds}s ago`
				: seconds < 3_600
					? `${Math.floor(seconds / 60)}m ago`
					: `${Math.floor(seconds / 3_600)}h ago`;
	return `${relative} · ${new Date(then).toLocaleTimeString()}`;
}

export type WireDiagnosticsInput = {
	phase: DrivePhase;
	hubUrl: string | null;
	hubError: string | null;
	workspaceRoot: string | null;
	reconnecting: boolean;
	lastCheckedAt: string | null;
	transportState: string;
	roomId: string | null;
	seq: number;
	callSessionId: string | null;
	lastEventAt: string | null;
	callLive: boolean;
	participants: number;
	counts: WireEventCounts;
	generatedAt: string;
};

/** Plain-text diagnostics for the clipboard. No secrets, no transcripts. */
export function formatWireDiagnostics(input: WireDiagnosticsInput): string {
	const lines = [
		"Drive wire diagnostics",
		`generated: ${input.generatedAt}`,
		`phase: ${input.phase}${input.reconnecting ? " (reconnecting)" : ""}`,
		`transport: ${input.transportState}`,
		`hub: ${displayHubUrl(input.hubUrl)}`,
		`hub error: ${input.hubError ?? "none"}`,
		`workspace: ${input.workspaceRoot ?? "—"}`,
		`last check: ${input.lastCheckedAt ?? "—"}`,
		`room: ${input.roomId ?? "—"}${input.callLive ? " (call live)" : ""}`,
		`call session: ${input.callSessionId ?? "—"}`,
		`seq: ${input.seq}`,
		`participants: ${input.participants}`,
		`last event: ${input.lastEventAt ?? "—"}`,
		`events seen this view: ${totalWireEvents(input.counts)}`,
	];
	for (const entry of sortedWireEventCounts(input.counts)) {
		lines.push(`  ${entry.name}: ${entry.count}`);
	}
	return lines.join("\n");
}
