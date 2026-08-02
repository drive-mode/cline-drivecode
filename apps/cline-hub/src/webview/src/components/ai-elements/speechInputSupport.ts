/**
 * Capability resolution and honest failure copy for {@link SpeechInput}.
 * DOM-free on purpose so the webview's node-env tests can cover it.
 */

export type SpeechInputMode = "speech-recognition" | "media-recorder" | "none";

export type SpeechInputCapabilities = {
	speechRecognition: boolean;
	mediaRecorder: boolean;
};

export function readSpeechInputCapabilities(): SpeechInputCapabilities {
	if (typeof window === "undefined") {
		return { speechRecognition: false, mediaRecorder: false };
	}
	return {
		speechRecognition:
			"SpeechRecognition" in window || "webkitSpeechRecognition" in window,
		mediaRecorder:
			"MediaRecorder" in window &&
			typeof navigator !== "undefined" &&
			"mediaDevices" in navigator,
	};
}

/**
 * A requested mode the browser cannot honour resolves to "none" rather than
 * silently swapping backends: a webSpeech topology has no transcription
 * service behind MediaRecorder, so "falling back" would capture audio with
 * nowhere to send it.
 */
export function resolveSpeechInputMode(input: {
	requested?: SpeechInputMode;
	capabilities: SpeechInputCapabilities;
}): SpeechInputMode {
	const { capabilities } = input;
	switch (input.requested) {
		case "speech-recognition":
			return capabilities.speechRecognition ? "speech-recognition" : "none";
		case "media-recorder":
			return capabilities.mediaRecorder ? "media-recorder" : "none";
		case "none":
			return "none";
		default:
			if (capabilities.speechRecognition) {
				return "speech-recognition";
			}
			return capabilities.mediaRecorder ? "media-recorder" : "none";
	}
}

/** Copy for a mode this browser cannot run. Null when it can. */
export function describeSpeechInputUnavailable(input: {
	requested?: SpeechInputMode;
	capabilities: SpeechInputCapabilities;
}): string | null {
	if (resolveSpeechInputMode(input) !== "none") {
		return null;
	}
	if (input.requested === "speech-recognition") {
		return "This browser has no Web Speech API. Switch STT to the local worker in Drive settings, or type your message.";
	}
	if (input.requested === "media-recorder") {
		return "This browser cannot record audio. Type your message instead.";
	}
	return "Speech input is not available in this browser. Type your message instead.";
}

/** Routine end-of-utterance signals — surfacing them would be noise, not news. */
const BENIGN_CODES = new Set(["no-speech", "aborted", "AbortError"]);

/**
 * Actionable copy for a capture failure. Null when the failure is routine.
 * Every branch keeps the keyboard escape hatch visible: a denied mic must
 * leave the composer usable, not dead.
 */
export function describeSpeechInputError(input: {
	mode: SpeechInputMode;
	/** `SpeechRecognitionErrorEvent.error` */
	code?: string;
	/** `getUserMedia` / `MediaRecorder` rejection */
	error?: unknown;
}): string | null {
	const code = input.code ?? errorName(input.error);
	if (code && BENIGN_CODES.has(code)) {
		return null;
	}
	switch (code) {
		case "not-allowed":
		case "service-not-allowed":
		case "NotAllowedError":
		case "SecurityError":
			return "Microphone permission denied. Allow mic access for this page, or type your message instead.";
		case "audio-capture":
		case "NotFoundError":
		case "DevicesNotFoundError":
			return "No microphone found. Pick an input device in Drive settings, or type your message instead.";
		case "NotReadableError":
		case "TrackStartError":
			return "The microphone is in use by another app. Close it and try again, or type your message instead.";
		case "network":
			return "Speech recognition lost its network connection. Try again, or type your message instead.";
		default:
			return input.mode === "speech-recognition"
				? "Speech recognition stopped unexpectedly. Try again, or type your message instead."
				: "Microphone capture failed. Try again, or type your message instead.";
	}
}

function errorName(error: unknown): string | undefined {
	if (error && typeof error === "object" && "name" in error) {
		const name = (error as { name?: unknown }).name;
		return typeof name === "string" ? name : undefined;
	}
	return undefined;
}
