/**
 * Narration playback queue for Drive partner voice (DRV-TTS).
 *
 * Kept free of `speechSynthesis` and React so the queue, the drop-oldest rule,
 * and the speaking-presence edges are all testable in the node-env webview
 * suite. The browser TTS port is injected as {@link NarrationSink}.
 *
 * Nothing here retains spoken text beyond playback: the queue holds at most
 * two pending lines and drops them on cancel (DRV-PRIVACY — narration is
 * ambient, not archival).
 */

import type { TtsSpeakOptions } from "./createVoiceStack";

/** DRV-TTS: "a small playback queue with drop-oldest beyond depth two". */
export const DRIVE_NARRATION_QUEUE_DEPTH = 2;

export type NarrationLine = {
	text: string;
	opts?: TtsSpeakOptions;
};

/**
 * Append a line, dropping the oldest pending line past the depth cap.
 * Narration cadence can outpace speech; the feed keeps the full record, so
 * the stalest queued line is the right thing to lose.
 */
export function enqueueNarrationLine(
	pending: readonly NarrationLine[],
	line: NarrationLine,
): NarrationLine[] {
	const next = [...pending, line];
	return next.length > DRIVE_NARRATION_QUEUE_DEPTH
		? next.slice(next.length - DRIVE_NARRATION_QUEUE_DEPTH)
		: next;
}

/** The slice of `TtsPort` narration needs. */
export type NarrationSink = {
	speak(text: string, opts?: TtsSpeakOptions): Promise<void>;
	cancel(): void;
};

export type DriveNarrator = {
	/** Queue a line; playback starts immediately when idle. */
	speak(text: string, opts?: TtsSpeakOptions): void;
	/** Drop everything pending and cut the in-flight utterance. */
	cancel(): void;
	/** Lines waiting behind the one being spoken. */
	pending(): readonly NarrationLine[];
	speaking(): boolean;
};

export function createDriveNarrator(input: {
	sink: NarrationSink;
	/** Speaking-presence edges: true on the first line, false once drained. */
	onSpeakingChange?: (speaking: boolean) => void;
}): DriveNarrator {
	let pending: NarrationLine[] = [];
	let speaking = false;
	/** Bumped by cancel so a superseded drain loop retires quietly. */
	let generation = 0;

	function setSpeaking(next: boolean): void {
		if (speaking === next) {
			return;
		}
		speaking = next;
		input.onSpeakingChange?.(next);
	}

	async function drain(run: number): Promise<void> {
		while (pending.length > 0) {
			const line = pending[0];
			pending = pending.slice(1);
			if (!line) {
				break;
			}
			await input.sink.speak(line.text, line.opts);
			// Cancel already cleared the queue and dropped presence.
			if (run !== generation) {
				return;
			}
		}
		setSpeaking(false);
	}

	return {
		speak(text, opts) {
			const trimmed = text.trim();
			if (!trimmed) {
				return;
			}
			pending = enqueueNarrationLine(pending, { text: trimmed, opts });
			if (speaking) {
				// The running drain loop will pick this up.
				return;
			}
			setSpeaking(true);
			generation += 1;
			void drain(generation);
		},
		cancel() {
			generation += 1;
			pending = [];
			input.sink.cancel();
			setSpeaking(false);
		},
		pending: () => pending,
		speaking: () => speaking,
	};
}
