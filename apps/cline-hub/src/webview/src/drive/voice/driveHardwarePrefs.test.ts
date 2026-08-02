import { describe, expect, it, vi } from "vitest";
import { driveEarconVolume } from "./driveEarcons";
import {
	applyAudioOutputSinkId,
	audioConstraintsForMicDevice,
	clampOutputVolume,
	DEFAULT_DRIVE_HARDWARE_PREFS,
	normalizeDriveHardwarePrefs,
	outputVolumeFromPercent,
	outputVolumePercent,
} from "./driveHardwarePrefs";

describe("driveHardwarePrefs", () => {
	it("clamps volume into [0, 1]", () => {
		expect(clampOutputVolume(-0.5)).toBe(0);
		expect(clampOutputVolume(0.4)).toBe(0.4);
		expect(clampOutputVolume(2)).toBe(1);
		expect(clampOutputVolume(Number.NaN)).toBe(
			DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume,
		);
	});

	it("round-trips the 0-100 slider domain both sliders use", () => {
		expect(outputVolumePercent(DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume)).toBe(
			50,
		);
		for (const percent of [0, 1, 33, 50, 67, 99, 100]) {
			expect(outputVolumePercent(outputVolumeFromPercent(percent))).toBe(
				percent,
			);
		}
	});

	it("clamps and defaults out-of-domain slider input", () => {
		expect(outputVolumeFromPercent(-20)).toBe(0);
		expect(outputVolumeFromPercent(400)).toBe(1);
		expect(outputVolumeFromPercent(Number.NaN)).toBe(
			DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume,
		);
		expect(outputVolumePercent(Number.NaN)).toBe(50);
	});

	it("drives narration and earcon gain off the one pref", () => {
		// Slice 4's contract: the strip slider writes `outputVolume`, and both
		// consumers read it — TTS at full, earcons at the 25% ratio.
		const volume = outputVolumeFromPercent(80);
		expect(volume).toBeCloseTo(0.8);
		expect(driveEarconVolume(volume)).toBeCloseTo(0.2);
	});

	it("normalizes blank mic and speaker ids to the browser default", () => {
		expect(
			normalizeDriveHardwarePrefs({
				micDeviceId: "",
				speakerDeviceId: "",
				outputVolume: 1.5,
			}),
		).toEqual({
			micDeviceId: undefined,
			speakerDeviceId: undefined,
			outputVolume: 1,
		});
	});

	it("preserves custom speaker device ids", () => {
		expect(
			normalizeDriveHardwarePrefs({
				speakerDeviceId: "spk-1",
				outputVolume: 0.5,
			}),
		).toEqual({
			micDeviceId: undefined,
			speakerDeviceId: "spk-1",
			outputVolume: 0.5,
		});
	});

	it("builds ideal device constraints when a mic is selected", () => {
		expect(audioConstraintsForMicDevice(undefined)).toBe(true);
		expect(audioConstraintsForMicDevice("mic-1")).toEqual({
			deviceId: { ideal: "mic-1" },
		});
	});

	it("applies setSinkId when supported", async () => {
		const setSinkId = vi.fn(async () => undefined);
		await expect(
			applyAudioOutputSinkId({ setSinkId }, "spk-1"),
		).resolves.toEqual({ ok: true });
		expect(setSinkId).toHaveBeenCalledWith("spk-1");
	});

	it("reports unsupported sinks without throwing", async () => {
		await expect(applyAudioOutputSinkId({}, "spk-1")).resolves.toEqual({
			ok: false,
			reason: "setSinkId_unsupported",
		});
		await expect(
			applyAudioOutputSinkId({ setSinkId: async () => undefined }, undefined),
		).resolves.toEqual({ ok: true });
	});
});
