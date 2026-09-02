/**
 * Client-local Drive preferences under one `localStorage` key.
 *
 * Preference data only, never correctness data: a blocked store (private
 * mode, enterprise policy) degrades to session-only memory. Nothing here is
 * audio, a transcript, a prompt, a key or a model id.
 */

import { useCallback, useSyncExternalStore } from "react";

export const DRIVE_PREFS_STORAGE_KEY = "cline.code.drive.prefs.v1";

export type DriveStageLayout = "split" | "spotlight";

export type DrivePipCorner =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

/** Status Hub lenses; the id is what the tab bar and the pref store share. */
export const DRIVE_STATUS_LENSES = [
	"board",
	"changelog",
	"dependency-map",
] as const;

export type DriveStatusLens = (typeof DRIVE_STATUS_LENSES)[number];

export type DriveVoicePrefs = {
	/** 0..1 partner output volume for this listener only. */
	outputVolume: number;
	captions: boolean;
	/**
	 * `MediaDeviceInfo.deviceId` for audiooutput; null = system default.
	 * Machine-specific, so it lives here and never in a durable Drive facet.
	 */
	speakerDeviceId: string | null;
};

export type DrivePrefs = {
	feedCollapsed: boolean;
	stageLayout: DriveStageLayout;
	reduceMotion: boolean;
	pipHidden: boolean;
	pipCorner: DrivePipCorner;
	voice: DriveVoicePrefs;
	/** The person chose the labeled demo world while the hub was unreachable. */
	demoOptIn: boolean;
	/** The Status Hub lens last opened, so the section reopens where it left off. */
	statusLens: DriveStatusLens;
};

export const DEFAULT_DRIVE_PREFS: DrivePrefs = {
	feedCollapsed: false,
	stageLayout: "split",
	reduceMotion: false,
	pipHidden: false,
	pipCorner: "bottom-right",
	voice: { outputVolume: 0.8, captions: true, speakerDeviceId: null },
	demoOptIn: false,
	statusLens: "board",
};

export type DrivePrefsPatch =
	| (Partial<Omit<DrivePrefs, "voice">> & { voice?: Partial<DriveVoicePrefs> })
	| ((previous: DrivePrefs) => Partial<Omit<DrivePrefs, "voice">> & {
			voice?: Partial<DriveVoicePrefs>;
	  });

const STAGE_LAYOUTS: readonly DriveStageLayout[] = ["split", "spotlight"];
const PIP_CORNERS: readonly DrivePipCorner[] = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
];

function readStatusLens(
	value: unknown,
	fallback: DriveStatusLens,
): DriveStatusLens {
	return DRIVE_STATUS_LENSES.includes(value as DriveStatusLens)
		? (value as DriveStatusLens)
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function readVolume(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(1, Math.max(0, value));
}

/** Tolerant parse: any unreadable field falls back to its default. */
export function parseDrivePrefs(raw: string | null): DrivePrefs {
	if (!raw) {
		return DEFAULT_DRIVE_PREFS;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return DEFAULT_DRIVE_PREFS;
	}
	if (!isRecord(parsed)) {
		return DEFAULT_DRIVE_PREFS;
	}
	const voice = isRecord(parsed.voice) ? parsed.voice : {};
	return {
		feedCollapsed: readBoolean(
			parsed.feedCollapsed,
			DEFAULT_DRIVE_PREFS.feedCollapsed,
		),
		stageLayout: STAGE_LAYOUTS.includes(parsed.stageLayout as DriveStageLayout)
			? (parsed.stageLayout as DriveStageLayout)
			: DEFAULT_DRIVE_PREFS.stageLayout,
		reduceMotion: readBoolean(
			parsed.reduceMotion,
			DEFAULT_DRIVE_PREFS.reduceMotion,
		),
		pipHidden: readBoolean(parsed.pipHidden, DEFAULT_DRIVE_PREFS.pipHidden),
		pipCorner: PIP_CORNERS.includes(parsed.pipCorner as DrivePipCorner)
			? (parsed.pipCorner as DrivePipCorner)
			: DEFAULT_DRIVE_PREFS.pipCorner,
		voice: {
			outputVolume: readVolume(
				voice.outputVolume,
				DEFAULT_DRIVE_PREFS.voice.outputVolume,
			),
			captions: readBoolean(voice.captions, DEFAULT_DRIVE_PREFS.voice.captions),
			speakerDeviceId:
				typeof voice.speakerDeviceId === "string" &&
				voice.speakerDeviceId.trim()
					? voice.speakerDeviceId
					: DEFAULT_DRIVE_PREFS.voice.speakerDeviceId,
		},
		demoOptIn: readBoolean(parsed.demoOptIn, DEFAULT_DRIVE_PREFS.demoOptIn),
		statusLens: readStatusLens(
			parsed.statusLens,
			DEFAULT_DRIVE_PREFS.statusLens,
		),
	};
}

export function mergeDrivePrefs(
	previous: DrivePrefs,
	patch: DrivePrefsPatch,
): DrivePrefs {
	const resolved = typeof patch === "function" ? patch(previous) : patch;
	const { voice, ...rest } = resolved;
	return parseDrivePrefs(
		JSON.stringify({
			...previous,
			...rest,
			voice: { ...previous.voice, ...(voice ?? {}) },
		}),
	);
}

function readStorage(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(DRIVE_PREFS_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeStorage(value: string): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(DRIVE_PREFS_STORAGE_KEY, value);
	} catch {
		// Session-only from here on; the in-memory cache still updates.
	}
}

// One cached snapshot so `useSyncExternalStore` sees a stable reference.
// `storedRaw` is what storage actually held after the last write; when a
// write is blocked (private mode, quota, disabled storage) it differs from
// `raw`, and the in-memory prefs stay authoritative for this session.
let cache: {
	raw: string | null;
	storedRaw: string | null;
	prefs: DrivePrefs;
} | null = null;
const listeners = new Set<() => void>();

function snapshot(): DrivePrefs {
	const raw = readStorage();
	if (cache && (cache.raw === raw || cache.storedRaw === raw)) {
		return cache.prefs;
	}
	cache = { raw, storedRaw: raw, prefs: parseDrivePrefs(raw) };
	return cache.prefs;
}

function notify(): void {
	for (const listener of listeners) {
		listener();
	}
}

export function readDrivePrefs(): DrivePrefs {
	return snapshot();
}

export function writeDrivePrefs(patch: DrivePrefsPatch): DrivePrefs {
	const next = mergeDrivePrefs(snapshot(), patch);
	const raw = JSON.stringify(next);
	writeStorage(raw);
	cache = { raw, storedRaw: readStorage(), prefs: next };
	notify();
	return next;
}

export function subscribeDrivePrefs(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === null || event.key === DRIVE_PREFS_STORAGE_KEY) {
			listener();
		}
	};
	if (typeof window !== "undefined") {
		window.addEventListener("storage", onStorage);
	}
	return () => {
		listeners.delete(listener);
		if (typeof window !== "undefined") {
			window.removeEventListener("storage", onStorage);
		}
	};
}

function serverSnapshot(): DrivePrefs {
	return DEFAULT_DRIVE_PREFS;
}

/** Test seam: drop the in-memory cache so the next read hits storage. */
export function resetDrivePrefsCache(): void {
	cache = null;
}

export function useDrivePrefs(): [
	DrivePrefs,
	(patch: DrivePrefsPatch) => DrivePrefs,
] {
	const prefs = useSyncExternalStore(
		subscribeDrivePrefs,
		snapshot,
		serverSnapshot,
	);
	const update = useCallback(
		(patch: DrivePrefsPatch) => writeDrivePrefs(patch),
		[],
	);
	return [prefs, update];
}
