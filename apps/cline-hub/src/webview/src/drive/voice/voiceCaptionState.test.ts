import { describe, expect, it } from "vitest";
import { DEFAULT_DRIVE_UI } from "../types";
import { createDefaultDriveVoiceUi } from "./driveVoiceUi";
import {
	buildDrivePersistPayload,
	clearVoiceCaptionAfterSend,
	clearVoiceCaptionDraft,
	DRIVE_PERSIST_KEYS,
	persistPayloadHasCaptionKeys,
	shouldClearVoiceCaption,
} from "./voiceCaptionState";

describe("voiceCaptionState", () => {
	it("clears caption residue after discard", () => {
		expect(clearVoiceCaptionDraft()).toBe("");
	});

	it("clears caption residue after send", () => {
		expect(clearVoiceCaptionAfterSend()).toBe("");
	});

	it("holds a draft only while the call is live and the mic is open", () => {
		expect(shouldClearVoiceCaption({ muted: false, active: true })).toBe(false);
	});

	it("drops the draft on mute or hang-up", () => {
		// Mic mute is the microphone and only the microphone: a partial
		// utterance must not survive it, nor reappear on unmute.
		expect(shouldClearVoiceCaption({ muted: true, active: true })).toBe(true);
		expect(shouldClearVoiceCaption({ muted: false, active: false })).toBe(true);
		expect(shouldClearVoiceCaption({ muted: true, active: false })).toBe(true);
	});

	it("clears by default, since the mic now joins muted", () => {
		expect(
			shouldClearVoiceCaption({
				muted: DEFAULT_DRIVE_UI.muted,
				active: DEFAULT_DRIVE_UI.active,
			}),
		).toBe(true);
	});

	it("persist payload includes only driveUi/driveVoice and strips caption keys", () => {
		const payload = buildDrivePersistPayload({
			existing: {
				modelSelection: { lastProvider: "anthropic" },
				voiceCaption: "should not persist",
				caption: "nope",
				transcript: "nope",
			},
			driveUi: { active: true },
			driveVoice: { profile: "cloud", facets: {}, settingsOpen: false },
		});
		expect(payload.driveUi).toEqual({ active: true });
		expect(payload.driveVoice).toMatchObject({ profile: "cloud" });
		expect(payload.modelSelection).toEqual({ lastProvider: "anthropic" });
		expect(persistPayloadHasCaptionKeys(payload)).toBe(false);
		expect(payload).not.toHaveProperty("voiceCaption");
		expect(payload).not.toHaveProperty("caption");
		expect(payload).not.toHaveProperty("transcript");
	});

	it("narration never reaches the persisted blob", () => {
		// Spoken lines live in `narrationLine` React state, outside `driveUi`.
		// Persisting the whole UI slice must not carry them (DRV-PRIVACY:
		// spoken narration is ambient, not archival).
		const payload = buildDrivePersistPayload({
			driveUi: { ...DEFAULT_DRIVE_UI, active: true },
			driveVoice: createDefaultDriveVoiceUi("cloud"),
		});
		expect(JSON.stringify(payload)).not.toContain("narration");
		expect(Object.keys(payload)).toEqual(DRIVE_PERSIST_KEYS.slice());
	});
});
