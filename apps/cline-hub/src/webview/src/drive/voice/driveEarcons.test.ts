import { defaultFacetValuesFromProfile } from "@cline/drive";
import type { DriveFacetValues } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DRIVE_EARCON_FACET_ID,
	DRIVE_EARCON_GAIN_RATIO,
	DRIVE_EARCON_KINDS,
	DRIVE_EARCON_NOTES,
	type DriveEarconSignals,
	detectDriveEarcons,
	driveEarconVolume,
	driveOutputSilenced,
	renderEarconWav,
	shouldPlayDriveEarcon,
} from "./driveEarcons";

const FACETS: DriveFacetValues = defaultFacetValuesFromProfile("cloud");

function signals(patch: Partial<DriveEarconSignals> = {}): DriveEarconSignals {
	return {
		planId: "plan-1",
		openTaskIds: [],
		pendingApprovalIds: [],
		participantIds: [],
		...patch,
	};
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function samples(wav: Uint8Array): number[] {
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	const out: number[] = [];
	for (let offset = 44; offset + 1 < wav.byteLength; offset += 2) {
		out.push(view.getInt16(offset, true));
	}
	return out;
}

describe("detectDriveEarcons", () => {
	it("fires nothing on the first observation of a call", () => {
		expect(
			detectDriveEarcons(
				null,
				signals({
					openTaskIds: ["t1", "t2"],
					pendingApprovalIds: ["a1"],
					participantIds: ["human", "partner"],
				}),
			),
		).toEqual([]);
	});

	it("fires nothing when nothing changed", () => {
		const state = signals({
			openTaskIds: ["t1"],
			pendingApprovalIds: ["a1"],
			participantIds: ["human", "partner"],
		});
		expect(detectDriveEarcons(state, { ...state })).toEqual([]);
	});

	it("fires taskComplete when an open task leaves the bank", () => {
		expect(
			detectDriveEarcons(
				signals({ openTaskIds: ["t1", "t2"] }),
				signals({ openTaskIds: ["t2"] }),
			),
		).toEqual(["taskComplete"]);
	});

	it("fires taskComplete on a simultaneous complete + add", () => {
		expect(
			detectDriveEarcons(
				signals({ openTaskIds: ["t1"] }),
				signals({ openTaskIds: ["t2"] }),
			),
		).toEqual(["taskComplete"]);
	});

	it("stays silent when a plan switch replaces the open set", () => {
		expect(
			detectDriveEarcons(
				signals({ planId: "plan-1", openTaskIds: ["t1", "t2"] }),
				signals({ planId: "plan-2", openTaskIds: ["t9"] }),
			),
		).toEqual([]);
	});

	it("stays silent while the bank only grows", () => {
		expect(
			detectDriveEarcons(
				signals({ openTaskIds: ["t1"] }),
				signals({ openTaskIds: ["t1", "t2"] }),
			),
		).toEqual([]);
	});

	it("fires approvalRequired once per new approval batch", () => {
		expect(
			detectDriveEarcons(
				signals({ pendingApprovalIds: [] }),
				signals({ pendingApprovalIds: ["a1", "a2"] }),
			),
		).toEqual(["approvalRequired"]);
	});

	it("does not re-fire approvalRequired while the same approval is pending", () => {
		expect(
			detectDriveEarcons(
				signals({ pendingApprovalIds: ["a1", "a2"] }),
				signals({ pendingApprovalIds: ["a1"] }),
			),
		).toEqual([]);
	});

	it("fires join and leave on roster changes", () => {
		expect(
			detectDriveEarcons(
				signals({ participantIds: ["human", "partner"] }),
				signals({ participantIds: ["human", "partner", "reviewer"] }),
			),
		).toEqual(["join"]);
		expect(
			detectDriveEarcons(
				signals({ participantIds: ["human", "partner", "reviewer"] }),
				signals({ participantIds: ["human", "partner"] }),
			),
		).toEqual(["leave"]);
	});

	it("treats the first roster snapshot as hydration, not a join", () => {
		expect(
			detectDriveEarcons(
				signals({ participantIds: [] }),
				signals({ participantIds: ["human", "partner"] }),
			),
		).toEqual([]);
	});

	it("treats an emptied roster as a disconnect, not a leave", () => {
		expect(
			detectDriveEarcons(
				signals({ participantIds: ["human", "partner"] }),
				signals({ participantIds: [] }),
			),
		).toEqual([]);
	});

	it("reports several kinds in stable order for a combined transition", () => {
		expect(
			detectDriveEarcons(
				signals({
					openTaskIds: ["t1"],
					participantIds: ["human", "partner"],
				}),
				signals({
					openTaskIds: [],
					pendingApprovalIds: ["a1"],
					participantIds: ["human", "partner", "reviewer"],
				}),
			),
		).toEqual(["taskComplete", "approvalRequired", "join"]);
	});
});

describe("shouldPlayDriveEarcon", () => {
	it("allows every kind under the shipped defaults", () => {
		for (const kind of DRIVE_EARCON_KINDS) {
			expect(
				shouldPlayDriveEarcon({
					kind,
					facets: FACETS,
					outputSilenced: false,
					reducedMotion: false,
				}),
			).toBe(true);
		}
	});

	it("silences only the kind whose own facet is off", () => {
		const facets: DriveFacetValues = {
			...FACETS,
			"earcons.join": false,
		};
		expect(
			shouldPlayDriveEarcon({
				kind: "join",
				facets,
				outputSilenced: false,
				reducedMotion: false,
			}),
		).toBe(false);
		expect(
			shouldPlayDriveEarcon({
				kind: "leave",
				facets,
				outputSilenced: false,
				reducedMotion: false,
			}),
		).toBe(true);
	});

	it("silences every kind when output is silenced or motion is reduced", () => {
		for (const kind of DRIVE_EARCON_KINDS) {
			expect(
				shouldPlayDriveEarcon({
					kind,
					facets: FACETS,
					outputSilenced: true,
					reducedMotion: false,
				}),
			).toBe(false);
			expect(
				shouldPlayDriveEarcon({
					kind,
					facets: FACETS,
					outputSilenced: false,
					reducedMotion: true,
				}),
			).toBe(false);
		}
	});

	it("does not depend on tts.enabled", () => {
		expect(
			shouldPlayDriveEarcon({
				kind: "taskComplete",
				facets: { ...FACETS, "tts.enabled": true },
				outputSilenced: false,
				reducedMotion: false,
			}),
		).toBe(true);
	});
});

describe("driveOutputSilenced", () => {
	it("is silenced by either self or partner mute", () => {
		expect(
			driveOutputSilenced({ selfSilenced: false, partnerMuted: false }),
		).toBe(false);
		expect(
			driveOutputSilenced({ selfSilenced: true, partnerMuted: false }),
		).toBe(true);
		expect(
			driveOutputSilenced({ selfSilenced: false, partnerMuted: true }),
		).toBe(true);
	});
});

describe("driveEarconVolume", () => {
	it("is a quarter of partner volume", () => {
		expect(driveEarconVolume(1)).toBeCloseTo(DRIVE_EARCON_GAIN_RATIO);
		expect(driveEarconVolume(0.5)).toBeCloseTo(DRIVE_EARCON_GAIN_RATIO / 2);
	});

	it("clamps out-of-range and non-finite volumes", () => {
		expect(driveEarconVolume(0)).toBe(0);
		expect(driveEarconVolume(-1)).toBe(0);
		expect(driveEarconVolume(4)).toBeCloseTo(DRIVE_EARCON_GAIN_RATIO);
		expect(driveEarconVolume(Number.NaN)).toBeCloseTo(DRIVE_EARCON_GAIN_RATIO);
	});
});

describe("renderEarconWav", () => {
	const wav = renderEarconWav(DRIVE_EARCON_NOTES.taskComplete);

	it("emits a well-formed mono 16-bit PCM WAV", () => {
		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		expect(readAscii(wav, 0, 4)).toBe("RIFF");
		expect(readAscii(wav, 8, 4)).toBe("WAVE");
		expect(readAscii(wav, 12, 4)).toBe("fmt ");
		expect(readAscii(wav, 36, 4)).toBe("data");
		expect(view.getUint16(20, true)).toBe(1); // PCM
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getUint16(34, true)).toBe(16); // bits per sample
		expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
		expect(view.getUint32(40, true)).toBe(wav.byteLength - 44);
	});

	it("starts and ends at silence so the tone cannot click", () => {
		const pcm = samples(wav);
		expect(pcm[0]).toBe(0);
		expect(Math.abs(pcm[pcm.length - 1] ?? 0)).toBeLessThan(64);
	});

	it("renders audible signal with headroom left for the runtime gain", () => {
		const peak = Math.max(...samples(wav).map((value) => Math.abs(value)));
		expect(peak).toBeGreaterThan(16_000);
		expect(peak).toBeLessThanOrEqual(32_767);
	});

	it("renders a distinct waveform for every kind", () => {
		const rendered = DRIVE_EARCON_KINDS.map((kind) =>
			samples(renderEarconWav(DRIVE_EARCON_NOTES[kind])).join(","),
		);
		expect(new Set(rendered).size).toBe(DRIVE_EARCON_KINDS.length);
	});
});

describe("earcon motifs", () => {
	it("keeps every earcon short enough to stay ambient", () => {
		for (const kind of DRIVE_EARCON_KINDS) {
			const notes = DRIVE_EARCON_NOTES[kind];
			expect(notes.length).toBeGreaterThan(0);
			const end = Math.max(...notes.map((note) => note.at + note.dur));
			expect(end).toBeLessThanOrEqual(0.4);
		}
	});

	it("gives each kind its own frequency signature", () => {
		const signatures = DRIVE_EARCON_KINDS.map((kind) =>
			DRIVE_EARCON_NOTES[kind].map((note) => note.freq).join("/"),
		);
		expect(new Set(signatures).size).toBe(DRIVE_EARCON_KINDS.length);
	});

	it("maps every kind to its own facet id", () => {
		const ids = DRIVE_EARCON_KINDS.map((kind) => DRIVE_EARCON_FACET_ID[kind]);
		expect(new Set(ids).size).toBe(DRIVE_EARCON_KINDS.length);
		for (const id of ids) {
			expect(FACETS[id]).toBe(true);
		}
	});
});
