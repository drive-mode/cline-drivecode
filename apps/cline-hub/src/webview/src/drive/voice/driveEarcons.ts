/**
 * Drive earcons (drive-audio slice 3) — the decision half.
 *
 * Everything here is pure and DOM-free so the webview's node-env test suite can
 * cover it: which earcon a state transition earns, whether it is allowed to
 * sound, how loud it is, and the PCM the tone is made of. Playback lives in
 * `playDriveEarcon.ts` and is deliberately thin.
 *
 * Tones are synthesized rather than bundled: no binary in git, no asset build
 * step for a clone-and-run beta, and no licence provenance to establish. The
 * motifs mirror the demo canvas's WebAudio `Chime` module
 * (`docs/drivecode/design/canvases/drive-product-demo.html`), which is the
 * initiative's reference implementation.
 */

import type { DriveFacetValues } from "@cline/shared";

export const DRIVE_EARCON_KINDS = [
	"taskComplete",
	"approvalRequired",
	"join",
	"leave",
] as const;

export type DriveEarconKind = (typeof DRIVE_EARCON_KINDS)[number];

/** Facet id owning each earcon's individual toggle. */
export const DRIVE_EARCON_FACET_ID: Record<
	DriveEarconKind,
	| "earcons.taskComplete"
	| "earcons.approvalRequired"
	| "earcons.join"
	| "earcons.leave"
> = {
	taskComplete: "earcons.taskComplete",
	approvalRequired: "earcons.approvalRequired",
	join: "earcons.join",
	leave: "earcons.leave",
};

export const DRIVE_EARCON_LABEL: Record<DriveEarconKind, string> = {
	taskComplete: "Task complete",
	approvalRequired: "Approval required",
	join: "Someone joins",
	leave: "Someone leaves",
};

/**
 * Earcon peak relative to partner TTS volume. Quiet by design — an earcon that
 * startles is a bug (drive-audio overview, slice 3).
 */
export const DRIVE_EARCON_GAIN_RATIO = 0.25;

/** Earcon playback volume derived from the single `outputVolume` pref. */
export function driveEarconVolume(outputVolume: number): number {
	if (!Number.isFinite(outputVolume)) {
		return DRIVE_EARCON_GAIN_RATIO;
	}
	const clamped = Math.min(1, Math.max(0, outputVolume));
	return clamped * DRIVE_EARCON_GAIN_RATIO;
}

/**
 * Is Drive audio output silenced?
 *
 * `selfSilenced` is the caller's output-mute predicate. Today the call chrome
 * only has one mute (mic + output share `drive.muted`, matching
 * `shouldSpeakDriveTts`); when the self-`deafened` flag from drive-audio slices
 * 1–2 lands, the caller passes that instead and nothing here changes.
 */
export function driveOutputSilenced(input: {
	selfSilenced: boolean;
	partnerMuted: boolean;
}): boolean {
	return input.selfSilenced || input.partnerMuted;
}

/**
 * Gate for one earcon.
 *
 * `reducedMotion` is the nearest thing the web platform offers to an audio
 * sibling of `prefers-reduced-motion` — there is no `prefers-reduced-audio`
 * media query — so a user asking for reduced sensory feedback gets silence.
 */
export function shouldPlayDriveEarcon(input: {
	kind: DriveEarconKind;
	facets: DriveFacetValues;
	outputSilenced: boolean;
	reducedMotion: boolean;
}): boolean {
	if (input.outputSilenced || input.reducedMotion) {
		return false;
	}
	return input.facets[DRIVE_EARCON_FACET_ID[input.kind]] === true;
}

/**
 * The call state an earcon can be earned from. Ids rather than counts so a
 * simultaneous add + remove still reads as a completion / a join.
 */
export type DriveEarconSignals = {
	/** Active plan id — a different plan replaces the open set wholesale. */
	planId: string | null;
	/** DriveTask ids still open in the bank. */
	openTaskIds: readonly string[];
	/** Approval ids awaiting a human decision. */
	pendingApprovalIds: readonly string[];
	/** Participant ids seated in the room. */
	participantIds: readonly string[];
};

/**
 * Which earcons a transition earns.
 *
 * `previous === null` means "first observation of this call" and always yields
 * nothing — mount and hydration must never chime. Roster diffs additionally
 * require both sides non-empty, because the roster arrives empty and fills in
 * from the first `room_snapshot`; that fill is hydration, not a join. Task
 * diffs are skipped across a plan switch for the same reason.
 */
export function detectDriveEarcons(
	previous: DriveEarconSignals | null,
	next: DriveEarconSignals,
): DriveEarconKind[] {
	if (!previous) {
		return [];
	}
	const kinds: DriveEarconKind[] = [];

	// Switching plans swaps the whole open set; nothing was completed.
	if (previous.planId === next.planId) {
		const nextOpen = new Set(next.openTaskIds);
		if (previous.openTaskIds.some((id) => !nextOpen.has(id))) {
			kinds.push("taskComplete");
		}
	}

	const previousApprovals = new Set(previous.pendingApprovalIds);
	if (next.pendingApprovalIds.some((id) => !previousApprovals.has(id))) {
		kinds.push("approvalRequired");
	}

	if (previous.participantIds.length > 0 && next.participantIds.length > 0) {
		const previousSeated = new Set(previous.participantIds);
		const nextSeated = new Set(next.participantIds);
		if (next.participantIds.some((id) => !previousSeated.has(id))) {
			kinds.push("join");
		}
		if (previous.participantIds.some((id) => !nextSeated.has(id))) {
			kinds.push("leave");
		}
	}

	return kinds;
}

// ── synthesis ────────────────────────────────────────────────────────────

export type EarconNote = {
	/** Hz. */
	freq: number;
	/** Onset in seconds, relative to the start of the earcon. */
	at: number;
	/** Seconds from onset to silence. */
	dur: number;
};

/**
 * Motifs, chosen to be distinguishable by register, direction, and length:
 * complete rises high and bright, approval knocks twice low and flat, join and
 * leave are short mid-register mirrors of each other.
 */
export const DRIVE_EARCON_NOTES: Record<
	DriveEarconKind,
	readonly EarconNote[]
> = {
	// E5 → A5, rising two-tone (canvas `Chime.complete`).
	taskComplete: [
		{ freq: 659.25, at: 0, dur: 0.12 },
		{ freq: 880, at: 0.12, dur: 0.12 },
	],
	// G4 · G4, soft low double knock (canvas `Chime.attention`).
	approvalRequired: [
		{ freq: 392, at: 0, dur: 0.14 },
		{ freq: 392, at: 0.2, dur: 0.14 },
	],
	// A4 → D5, short rising fourth.
	join: [
		{ freq: 440, at: 0, dur: 0.09 },
		{ freq: 587.33, at: 0.09, dur: 0.09 },
	],
	// D5 → A4, the same figure inverted.
	leave: [
		{ freq: 587.33, at: 0, dur: 0.09 },
		{ freq: 440, at: 0.09, dur: 0.09 },
	],
};

const SAMPLE_RATE = 24_000;
const ATTACK_SECONDS = 0.02;
const TAIL_SECONDS = 0.04;
/** Decay target — the canvas's `exponentialRampToValueAtTime` floor. */
const DECAY_FLOOR = 0.0001;
/** Full-scale headroom in the rendered file; runtime gain is applied on playback. */
const RENDER_PEAK = 0.9;

function noteEnvelope(elapsed: number, dur: number): number {
	if (elapsed < 0 || elapsed > dur) {
		return 0;
	}
	if (elapsed < ATTACK_SECONDS) {
		return elapsed / ATTACK_SECONDS;
	}
	const decaySpan = dur - ATTACK_SECONDS;
	if (decaySpan <= 0) {
		return 1;
	}
	return Math.exp(
		(Math.log(DECAY_FLOOR) * (elapsed - ATTACK_SECONDS)) / decaySpan,
	);
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
	for (let index = 0; index < text.length; index += 1) {
		bytes[offset + index] = text.charCodeAt(index);
	}
}

/**
 * Render a motif to a mono 16-bit PCM WAV.
 *
 * Rendered at fixed headroom; the 25% earcon gain is applied at playback time
 * from `driveEarconVolume()`, so `outputVolume` stays the one source of truth.
 */
export function renderEarconWav(notes: readonly EarconNote[]): Uint8Array {
	const durationSeconds =
		notes.reduce((longest, note) => Math.max(longest, note.at + note.dur), 0) +
		TAIL_SECONDS;
	const frameCount = Math.max(1, Math.ceil(durationSeconds * SAMPLE_RATE));
	const dataBytes = frameCount * 2;
	const bytes = new Uint8Array(44 + dataBytes);
	const view = new DataView(bytes.buffer);

	writeAscii(bytes, 0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	writeAscii(bytes, 8, "WAVE");
	writeAscii(bytes, 12, "fmt ");
	view.setUint32(16, 16, true); // PCM fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeAscii(bytes, 36, "data");
	view.setUint32(40, dataBytes, true);

	for (let frame = 0; frame < frameCount; frame += 1) {
		const time = frame / SAMPLE_RATE;
		let sample = 0;
		for (const note of notes) {
			const elapsed = time - note.at;
			const envelope = noteEnvelope(elapsed, note.dur);
			if (envelope > 0) {
				sample += Math.sin(2 * Math.PI * note.freq * elapsed) * envelope;
			}
		}
		const clamped = Math.min(1, Math.max(-1, sample * RENDER_PEAK));
		view.setInt16(44 + frame * 2, Math.round(clamped * 32767), true);
	}

	return bytes;
}
