import { describe, expect, it } from "vitest";
import {
	describeSpeechInputError,
	describeSpeechInputUnavailable,
	readSpeechInputCapabilities,
	resolveSpeechInputMode,
	type SpeechInputCapabilities,
} from "./speechInputSupport";

const BOTH: SpeechInputCapabilities = {
	speechRecognition: true,
	mediaRecorder: true,
};
const RECORDER_ONLY: SpeechInputCapabilities = {
	speechRecognition: false,
	mediaRecorder: true,
};
const NEITHER: SpeechInputCapabilities = {
	speechRecognition: false,
	mediaRecorder: false,
};

describe("resolveSpeechInputMode", () => {
	it("honours a supported forced mode", () => {
		expect(
			resolveSpeechInputMode({
				requested: "speech-recognition",
				capabilities: BOTH,
			}),
		).toBe("speech-recognition");
		expect(
			resolveSpeechInputMode({
				requested: "media-recorder",
				capabilities: BOTH,
			}),
		).toBe("media-recorder");
	});

	it("degrades a webSpeech topology to none rather than recording blindly", () => {
		// Firefox: MediaRecorder exists, but a webSpeech backend has no
		// transcription endpoint, so swapping would capture audio for nobody.
		expect(
			resolveSpeechInputMode({
				requested: "speech-recognition",
				capabilities: RECORDER_ONLY,
			}),
		).toBe("none");
	});

	it("degrades media-recorder to none without MediaRecorder", () => {
		expect(
			resolveSpeechInputMode({
				requested: "media-recorder",
				capabilities: NEITHER,
			}),
		).toBe("none");
	});

	it("auto-detects when no mode is forced", () => {
		expect(resolveSpeechInputMode({ capabilities: BOTH })).toBe(
			"speech-recognition",
		);
		expect(resolveSpeechInputMode({ capabilities: RECORDER_ONLY })).toBe(
			"media-recorder",
		);
		expect(resolveSpeechInputMode({ capabilities: NEITHER })).toBe("none");
	});

	it("keeps an explicit none", () => {
		expect(
			resolveSpeechInputMode({ requested: "none", capabilities: BOTH }),
		).toBe("none");
	});
});

describe("readSpeechInputCapabilities", () => {
	it("reports nothing available without a window (node/webview tests)", () => {
		expect(readSpeechInputCapabilities()).toEqual(NEITHER);
	});
});

describe("describeSpeechInputUnavailable", () => {
	it("is null when the mode can run", () => {
		expect(
			describeSpeechInputUnavailable({
				requested: "speech-recognition",
				capabilities: BOTH,
			}),
		).toBeNull();
	});

	it("points at the local-worker escape hatch for a missing Web Speech API", () => {
		const message = describeSpeechInputUnavailable({
			requested: "speech-recognition",
			capabilities: RECORDER_ONLY,
		});
		expect(message).toContain("local worker");
		expect(message).toContain("type your message");
	});

	it("still offers the keyboard when nothing is available", () => {
		expect(describeSpeechInputUnavailable({ capabilities: NEITHER })).toContain(
			"Type your message",
		);
	});
});

describe("describeSpeechInputError", () => {
	it("stays quiet for routine end-of-utterance codes", () => {
		expect(
			describeSpeechInputError({
				mode: "speech-recognition",
				code: "no-speech",
			}),
		).toBeNull();
		expect(
			describeSpeechInputError({ mode: "speech-recognition", code: "aborted" }),
		).toBeNull();
	});

	it("explains a denied mic from either capture path", () => {
		const recognition = describeSpeechInputError({
			mode: "speech-recognition",
			code: "not-allowed",
		});
		const recorder = describeSpeechInputError({
			mode: "media-recorder",
			error: { name: "NotAllowedError" },
		});
		expect(recognition).toContain("permission denied");
		expect(recorder).toBe(recognition);
	});

	it("names a missing device and a busy device distinctly", () => {
		expect(
			describeSpeechInputError({
				mode: "media-recorder",
				error: { name: "NotFoundError" },
			}),
		).toContain("No microphone found");
		expect(
			describeSpeechInputError({
				mode: "media-recorder",
				error: { name: "NotReadableError" },
			}),
		).toContain("in use by another app");
	});

	it("falls back to a per-mode message for unknown failures", () => {
		expect(
			describeSpeechInputError({ mode: "speech-recognition", code: "weird" }),
		).toContain("Speech recognition stopped");
		expect(describeSpeechInputError({ mode: "media-recorder" })).toContain(
			"Microphone capture failed",
		);
	});

	it("always leaves the keyboard escape hatch in the copy", () => {
		for (const code of [
			"not-allowed",
			"audio-capture",
			"network",
			"unknown-code",
		]) {
			expect(
				describeSpeechInputError({ mode: "speech-recognition", code }),
			).toContain("type your message instead");
		}
	});
});
