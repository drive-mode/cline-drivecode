import { describe, expect, it } from "vitest";
import {
	countWireEvent,
	DRIVE_SETTINGS_SECTIONS,
	displayHubUrl,
	formatWireDiagnostics,
	MIC_METER_BARS,
	micLevelFromSamples,
	micMeterLitBars,
	outputVolumeFromPercent,
	outputVolumePercent,
	phaseLabel,
	SYSTEM_DEFAULT_SPEAKER,
	sortedWireEventCounts,
	speakerDeviceOptions,
	speakerSelectionValue,
	totalWireEvents,
	wireTimeLabel,
} from "./drive-settings-model";

describe("drive settings model", () => {
	it("lists the five sections in order", () => {
		expect(DRIVE_SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
			"voice",
			"appearance",
			"privacy",
			"demo",
			"wire",
		]);
	});

	it("round-trips the volume slider domain with clamping", () => {
		expect(outputVolumePercent(0.8)).toBe(80);
		expect(outputVolumePercent(1.7)).toBe(100);
		expect(outputVolumePercent(Number.NaN)).toBe(0);
		expect(outputVolumeFromPercent(35)).toBe(0.35);
		expect(outputVolumeFromPercent(-20)).toBe(0);
		expect(outputVolumeFromPercent(140)).toBe(1);
	});

	it("builds speaker options from labels only", () => {
		const options = speakerDeviceOptions([
			{ deviceId: "default", kind: "audiooutput", label: "Default" },
			{ deviceId: "mic-1", kind: "audioinput", label: "Built-in mic" },
			{ deviceId: "out-1", kind: "audiooutput", label: "Studio Monitors" },
			{ deviceId: "out-2", kind: "audiooutput", label: "" },
			{ deviceId: "", kind: "audiooutput", label: "ghost" },
		]);
		expect(options).toEqual([
			{ value: SYSTEM_DEFAULT_SPEAKER, label: "System default" },
			{ value: "out-1", label: "Studio Monitors" },
			{ value: "out-2", label: "Speaker 1" },
		]);
		expect(speakerSelectionValue(null, options)).toBe(SYSTEM_DEFAULT_SPEAKER);
		expect(speakerSelectionValue("out-1", options)).toBe("out-1");
		expect(speakerSelectionValue("gone", options)).toBe(SYSTEM_DEFAULT_SPEAKER);
	});

	it("measures a level from one buffer without keeping it", () => {
		expect(micLevelFromSamples([])).toBe(0);
		expect(micLevelFromSamples(new Float32Array(256))).toBe(0);
		const quiet = new Float32Array(256).fill(0.02);
		const loud = new Float32Array(256).fill(0.3);
		const quietLevel = micLevelFromSamples(quiet);
		const loudLevel = micLevelFromSamples(loud);
		expect(quietLevel).toBeGreaterThan(0);
		expect(loudLevel).toBeGreaterThan(quietLevel);
		expect(loudLevel).toBeLessThanOrEqual(1);
		expect(micLevelFromSamples(new Float32Array(16).fill(1))).toBe(1);
	});

	it("lights meter bars proportionally, none for silence", () => {
		expect(micMeterLitBars(0)).toBe(0);
		expect(micMeterLitBars(0.001)).toBe(0);
		expect(micMeterLitBars(0.02)).toBe(1);
		expect(micMeterLitBars(0.5)).toBe(MIC_METER_BARS / 2);
		expect(micMeterLitBars(2)).toBe(MIC_METER_BARS);
	});

	it("counts wire events by name and sorts them", () => {
		let counts = countWireEvent({}, "room.event");
		counts = countWireEvent(counts, "room.event");
		counts = countWireEvent(counts, "status.updated");
		counts = countWireEvent(counts, "  ");
		expect(counts).toEqual({
			"room.event": 2,
			"status.updated": 1,
			"(unnamed)": 1,
		});
		expect(sortedWireEventCounts(counts)).toEqual([
			{ name: "room.event", count: 2 },
			{ name: "(unnamed)", count: 1 },
			{ name: "status.updated", count: 1 },
		]);
		expect(totalWireEvents(counts)).toBe(4);
	});

	it("labels phases and strips credentials from the hub url", () => {
		expect(phaseLabel("live")).toBe("Live");
		expect(phaseLabel("demo")).toBe("Demo world");
		expect(displayHubUrl(null)).toBe("—");
		expect(displayHubUrl("ws://user:secret@127.0.0.1:4567/hub")).toBe(
			"ws://127.0.0.1:4567/hub",
		);
		expect(displayHubUrl("demo://drive/router-fix")).toBe(
			"demo://drive/router-fix",
		);
	});

	it("formats wire timestamps relative to now", () => {
		const now = "2026-09-02T12:00:00.000Z";
		expect(wireTimeLabel(null, now)).toBe("No events yet");
		expect(wireTimeLabel("2026-09-02T11:59:58.000Z", now)).toMatch(
			/^just now · /,
		);
		expect(wireTimeLabel("2026-09-02T11:59:00.000Z", now)).toMatch(
			/^60s ago · |^1m ago · /,
		);
		expect(wireTimeLabel("2026-09-02T10:30:00.000Z", now)).toMatch(
			/^1h ago · /,
		);
	});

	it("writes copyable diagnostics with no secrets", () => {
		const text = formatWireDiagnostics({
			phase: "live",
			hubUrl: "ws://me:pw@127.0.0.1:4567",
			hubError: null,
			workspaceRoot: "/workspace/router-fix",
			reconnecting: true,
			lastCheckedAt: "2026-09-02T11:59:00.000Z",
			transportState: "connected",
			roomId: "router-fix",
			seq: 42,
			callSessionId: "call-1",
			lastEventAt: "2026-09-02T11:59:30.000Z",
			callLive: true,
			participants: 4,
			counts: { "room.event": 3, "drive.script.beat": 1 },
			generatedAt: "2026-09-02T12:00:00.000Z",
		});
		expect(text).toContain("phase: live (reconnecting)");
		expect(text).toContain("hub: ws://127.0.0.1:4567");
		expect(text).not.toContain("pw");
		expect(text).toContain("room: router-fix (call live)");
		expect(text).toContain("seq: 42");
		expect(text).toContain("events seen this view: 4");
		expect(text).toContain("  room.event: 3");
	});
});
