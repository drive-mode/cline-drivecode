import { describe, expect, it } from "vitest";
import { DEFAULT_DRIVE_UI } from "../types";
import {
	applyHardwarePrefsPatch,
	applyVoiceProfile,
	createDefaultDriveVoiceUi,
	isSpokenDriveJoinNote,
	resolveDriveVoiceTopology,
	shouldSpeakDriveTts,
} from "./driveVoiceUi";

describe("driveVoiceUi", () => {
	it("defaults to cloud pack with webSpeech forceMode", () => {
		const voice = createDefaultDriveVoiceUi("cloud");
		expect(voice.hardware).toEqual({
			micDeviceId: undefined,
			speakerDeviceId: undefined,
			// Narration is ambient: enabling TTS starts it at half volume.
			outputVolume: 0.5,
		});
		const resolved = resolveDriveVoiceTopology({
			voice,
			providerId: "anthropic",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		expect(resolved.forceMode).toBe("speech-recognition");
	});

	it("local pack forces media-recorder", () => {
		const voice = applyVoiceProfile(
			createDefaultDriveVoiceUi("cloud"),
			"local",
		);
		const resolved = resolveDriveVoiceTopology({
			voice,
			providerId: "ollama",
		});
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) {
			return;
		}
		expect(resolved.forceMode).toBe("media-recorder");
		expect(resolved.topology.stt.kind).toBe("local-worker");
	});

	it("shouldSpeakDriveTts is off until the facet is enabled", () => {
		const voice = createDefaultDriveVoiceUi("cloud");
		expect(
			shouldSpeakDriveTts({
				facets: voice.facets,
				deafened: false,
				partnerMuted: false,
			}),
		).toBe(false);
		expect(
			shouldSpeakDriveTts({
				facets: { ...voice.facets, "tts.enabled": true },
				deafened: false,
				partnerMuted: false,
			}),
		).toBe(true);
	});

	it("deafen and partner mute silence narration; mic mute does not", () => {
		const enabled = {
			...createDefaultDriveVoiceUi("cloud").facets,
			"tts.enabled": true,
		};
		// Output mute — the human's own ears.
		expect(
			shouldSpeakDriveTts({
				facets: enabled,
				deafened: true,
				partnerMuted: false,
			}),
		).toBe(false);
		// A muted partner has nothing to say.
		expect(
			shouldSpeakDriveTts({
				facets: enabled,
				deafened: false,
				partnerMuted: true,
			}),
		).toBe(false);
		// The regression this separation exists to prevent: with the mic muted
		// (now the default) narration must still play.
		expect(
			shouldSpeakDriveTts({
				facets: enabled,
				deafened: false,
				partnerMuted: false,
			}),
		).toBe(true);
	});

	it("default drive UI joins muted but hearing", () => {
		// Default-muted mic is only safe because it no longer gates output.
		expect(DEFAULT_DRIVE_UI.muted).toBe(true);
		expect(DEFAULT_DRIVE_UI.deafened).toBe(false);
		expect(
			shouldSpeakDriveTts({
				facets: {
					...createDefaultDriveVoiceUi("cloud").facets,
					"tts.enabled": true,
				},
				deafened: DEFAULT_DRIVE_UI.deafened,
				partnerMuted: DEFAULT_DRIVE_UI.partnerMuted,
			}),
		).toBe(true);
	});

	it("keeps the join note out of the narration queue", () => {
		// Both effects see this text; only the join effect may speak it.
		expect(isSpokenDriveJoinNote("On the call. Adam is on the parser.")).toBe(
			true,
		);
		expect(isSpokenDriveJoinNote("Since you left: two tests went green.")).toBe(
			true,
		);
		expect(isSpokenDriveJoinNote("Tests pass, moving to the parser.")).toBe(
			false,
		);
	});

	it("preserves hardware prefs across profile switches", () => {
		const withMic = applyHardwarePrefsPatch(
			createDefaultDriveVoiceUi("cloud"),
			{
				micDeviceId: "mic-a",
				speakerDeviceId: "spk-b",
				outputVolume: 0.4,
			},
		);
		const local = applyVoiceProfile(withMic, "local");
		expect(local.hardware).toEqual({
			micDeviceId: "mic-a",
			speakerDeviceId: "spk-b",
			outputVolume: 0.4,
		});
	});
});
