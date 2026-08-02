import { describe, expect, it } from "vitest";
import { DEFAULT_DRIVE_UI } from "../types";
import {
	appendDriveTranscriptLine,
	clearDriveTranscript,
} from "./driveTranscript";
import { createDefaultDriveVoiceUi } from "./driveVoiceUi";
import {
	buildDrivePersistPayload,
	clearVoiceCaptionAfterSend,
	clearVoiceCaptionDraft,
	DRIVE_FORBIDDEN_PERSIST_KEYS,
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
				captions: "nope",
				transcript: "nope",
				driveTranscript: "nope",
			},
			driveUi: { active: true },
			driveVoice: { profile: "cloud", facets: {}, settingsOpen: false },
		});
		expect(payload.driveUi).toEqual({ active: true });
		expect(payload.driveVoice).toMatchObject({ profile: "cloud" });
		expect(payload.modelSelection).toEqual({ lastProvider: "anthropic" });
		expect(persistPayloadHasCaptionKeys(payload)).toBe(false);
		for (const key of DRIVE_FORBIDDEN_PERSIST_KEYS) {
			expect(payload).not.toHaveProperty(key);
		}
	});

	it("a full CC buffer leaves nothing in the persisted blob", () => {
		// The reload test, in code: build the scrollback the panel would be
		// showing, persist the same slices the hook persists, and require that
		// none of it — not the lines, not a key that could hold them — survives
		// (DRV-TRANSCRIPT: no transcript persistence on disk).
		let lines = clearDriveTranscript();
		for (let index = 0; index < 60; index += 1) {
			lines = appendDriveTranscriptLine(lines, {
				atMs: index * 1200,
				text: `secret narration ${index}`,
				who: "Cline",
			});
		}
		expect(lines.length).toBeGreaterThan(0);

		const payload = buildDrivePersistPayload({
			// `modelSelection` is a bystander another feature owns: it proves the
			// delete is targeted rather than the whole blob being dropped, which
			// would make the assertions below pass for the wrong reason.
			existing: {
				driveTranscript: lines,
				modelSelection: { lastProvider: "anthropic" },
				transcript: lines,
			},
			driveUi: { ...DEFAULT_DRIVE_UI, active: true },
			driveVoice: createDefaultDriveVoiceUi("cloud"),
		});
		expect(payload.modelSelection).toEqual({ lastProvider: "anthropic" });

		const serialized = JSON.stringify(payload);
		expect(serialized).not.toContain("secret narration");
		for (const key of DRIVE_FORBIDDEN_PERSIST_KEYS) {
			expect(payload).not.toHaveProperty(key);
		}
		// Everything Drive itself contributes stays inside the allow-list.
		expect(
			Object.keys(payload).filter((key) => key.startsWith("drive")),
		).toEqual(DRIVE_PERSIST_KEYS.slice());
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
