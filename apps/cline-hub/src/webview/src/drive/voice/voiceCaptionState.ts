/**
 * Ephemeral voice caption helpers (DRV-CAPTIONS / DRV-PRIVACY).
 * Captions are React state only — never written to vscode setState / disk.
 */

/** After Discard: empty draft, no residue. */
export function clearVoiceCaptionDraft(): string {
	return "";
}

/** After Send spoken: clear draft once the prompt is handed off. */
export function clearVoiceCaptionAfterSend(): string {
	return "";
}

/**
 * Mic mute means the microphone and only the microphone: while muted — or once
 * the call ends — there is no spoken draft to hold. Used both to clear on the
 * mute transition and to refuse a transcript that lands after it, so a partial
 * utterance can never reappear on unmute.
 */
export function shouldClearVoiceCaption(input: {
	muted: boolean;
	active: boolean;
}): boolean {
	return input.muted || !input.active;
}

/**
 * Keys allowed in hub webview persistence for Drive.
 * Explicitly excludes caption / transcript fields.
 */
export const DRIVE_PERSIST_KEYS = ["driveUi", "driveVoice"] as const;

/**
 * Caption-bearing keys that must never survive a reload, hard-deleted on the
 * way out.
 *
 * This is the enforced list, not `DRIVE_PERSIST_KEYS` — the payload builder
 * passes the rest of the existing blob through untouched, because other
 * features own keys in it. So a new caption surface has to register its key
 * here; the CC transcript panel's `driveTranscript` is the latest.
 */
export const DRIVE_FORBIDDEN_PERSIST_KEYS = [
	"voiceCaption",
	"caption",
	"captions",
	"transcript",
	"driveTranscript",
] as const;

export type DrivePersistPayload = {
	driveUi: unknown;
	driveVoice: unknown;
};

/**
 * Build the Drive slice of vscode setState. Never includes voiceCaption,
 * caption, or transcript keys (privacy-strict).
 */
export function buildDrivePersistPayload(input: {
	existing?: Record<string, unknown>;
	driveUi: unknown;
	driveVoice: unknown;
}): Record<string, unknown> {
	const next: Record<string, unknown> = {
		...(input.existing ?? {}),
		driveUi: input.driveUi,
		driveVoice: input.driveVoice,
	};
	for (const key of DRIVE_FORBIDDEN_PERSIST_KEYS) {
		delete next[key];
	}
	return next;
}

/** True when a persist blob accidentally carries caption-like keys. */
export function persistPayloadHasCaptionKeys(
	payload: Record<string, unknown>,
): boolean {
	return DRIVE_FORBIDDEN_PERSIST_KEYS.some((key) =>
		Object.hasOwn(payload, key),
	);
}
