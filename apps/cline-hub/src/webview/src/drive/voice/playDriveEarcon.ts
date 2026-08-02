/**
 * Drive earcons — the playback half. Deliberately thin: every decision lives in
 * `driveEarcons.ts` where the node-env test suite can reach it.
 *
 * Synthesized PCM is wrapped in a blob URL and handed to the existing
 * `playAudioUrlOnSink()` seam, so earcons inherit the speaker-device routing and
 * volume clamping that partner playback already uses instead of growing a
 * second audio path.
 */

import { playAudioUrlOnSink } from "./createVoiceStack";
import {
	DRIVE_EARCON_NOTES,
	type DriveEarconKind,
	renderEarconWav,
} from "./driveEarcons";

/** One blob URL per motif, built on first use and kept for the page lifetime. */
const earconUrlCache = new Map<DriveEarconKind, string>();

function earconObjectUrl(kind: DriveEarconKind): string | null {
	const cached = earconUrlCache.get(kind);
	if (cached) {
		return cached;
	}
	if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
		return null;
	}
	const wav = renderEarconWav(DRIVE_EARCON_NOTES[kind]);
	const url = URL.createObjectURL(
		new Blob([wav as BlobPart], { type: "audio/wav" }),
	);
	earconUrlCache.set(kind, url);
	return url;
}

/** True when the user has asked the platform for reduced sensory feedback. */
export function prefersReducedMotion(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

/**
 * Play one earcon. Never throws: autoplay policy, a vanished output device, or
 * a browser without blob URLs all just mean no sound. Earcons are ambient
 * feedback and must not be able to break a call.
 */
export async function playDriveEarcon(input: {
	kind: DriveEarconKind;
	volume: number;
	sinkId: string | undefined;
}): Promise<void> {
	const url = earconObjectUrl(input.kind);
	if (!url) {
		return;
	}
	try {
		await playAudioUrlOnSink({
			url,
			volume: input.volume,
			sinkId: input.sinkId,
		});
	} catch {
		// Ambient by contract — a silent earcon is never worth surfacing.
	}
}
