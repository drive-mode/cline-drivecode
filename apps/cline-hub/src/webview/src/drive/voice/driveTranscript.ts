/**
 * CC transcript ring buffer (drive-audio slice 5).
 *
 * The panel's whole contract is that it forgets. This module holds the rules
 * that make that true — a hard line cap, an append that cannot grow without
 * bound, and a clear — as plain functions the node-env webview suite can
 * cover, because "nothing persists" is a claim that has to be testable.
 *
 * Nothing here reads or writes storage. The buffer lives in React state for
 * exactly as long as the call does (DRV-PRIVACY: "no transcript persistence";
 * DRV-CAPTIONS: "caption content is transient UI state").
 */

/**
 * Lines kept in the scrollback. A bound, not a budget: the panel is recent
 * context for someone who is deafened or looked away, not a record of the
 * call, so old lines are supposed to fall off the end.
 */
export const DRIVE_TRANSCRIPT_LIMIT = 40;

export type DriveTranscriptLine = {
	/** Position in the call, for React keys only. Never an identifier. */
	seq: number;
	/** Milliseconds since the call's first captioned line. */
	atMs: number;
	who: string;
	text: string;
};

export type DriveTranscriptEntry = Omit<DriveTranscriptLine, "seq">;

/**
 * Append one spoken line, dropping the oldest past {@link DRIVE_TRANSCRIPT_LIMIT}.
 *
 * Blank text and an immediate repeat of the last line are ignored: the same
 * narration reaches the caption path as both a script beat and a
 * `conversation.narration` event, and one utterance should read as one line.
 */
export function appendDriveTranscriptLine(
	lines: readonly DriveTranscriptLine[],
	entry: DriveTranscriptEntry,
): readonly DriveTranscriptLine[] {
	const text = entry.text.trim();
	if (!text) {
		return lines;
	}
	const last = lines[lines.length - 1];
	if (last && last.who === entry.who && last.text === text) {
		return lines;
	}
	const next = [...lines, { ...entry, seq: (last?.seq ?? 0) + 1, text }];
	return next.length > DRIVE_TRANSCRIPT_LIMIT
		? next.slice(next.length - DRIVE_TRANSCRIPT_LIMIT)
		: next;
}

/** Leaving the call drops the buffer whole — see the caller in useDriveSession. */
export function clearDriveTranscript(): readonly DriveTranscriptLine[] {
	return [];
}

/** `m:ss` since the first captioned line, the clock the demo canvas shows. */
export function formatDriveTranscriptClock(atMs: number): string {
	const total = Math.max(0, Math.floor(atMs / 1000));
	const seconds = total % 60;
	return `${Math.floor(total / 60)}:${seconds < 10 ? "0" : ""}${seconds}`;
}
