import { describe, expect, it } from "vitest";
import {
	appendDriveTranscriptLine,
	clearDriveTranscript,
	DRIVE_TRANSCRIPT_LIMIT,
	type DriveTranscriptLine,
	formatDriveTranscriptClock,
} from "./driveTranscript";

function build(count: number): readonly DriveTranscriptLine[] {
	let lines = clearDriveTranscript();
	for (let index = 0; index < count; index += 1) {
		lines = appendDriveTranscriptLine(lines, {
			atMs: index * 1000,
			text: `line ${index}`,
			who: "Cline",
		});
	}
	return lines;
}

describe("driveTranscript", () => {
	it("appends spoken lines in order with monotonic keys", () => {
		const lines = build(3);
		expect(lines.map((line) => line.text)).toEqual([
			"line 0",
			"line 1",
			"line 2",
		]);
		expect(lines.map((line) => line.seq)).toEqual([1, 2, 3]);
	});

	it("holds the ring-buffer bound, dropping oldest", () => {
		const lines = build(DRIVE_TRANSCRIPT_LIMIT + 12);
		expect(lines).toHaveLength(DRIVE_TRANSCRIPT_LIMIT);
		expect(lines[0]?.text).toBe("line 12");
		expect(lines[lines.length - 1]?.text).toBe(
			`line ${DRIVE_TRANSCRIPT_LIMIT + 11}`,
		);
	});

	it("ignores blank text and an immediate repeat of the same line", () => {
		const one = appendDriveTranscriptLine(clearDriveTranscript(), {
			atMs: 0,
			text: "  Reading the failing test.  ",
			who: "Cline",
		});
		expect(one).toHaveLength(1);
		expect(one[0]?.text).toBe("Reading the failing test.");

		// The same narration arrives as a script beat and a conversation event.
		const repeated = appendDriveTranscriptLine(one, {
			atMs: 40,
			text: "Reading the failing test.",
			who: "Cline",
		});
		expect(repeated).toBe(one);

		expect(
			appendDriveTranscriptLine(one, { atMs: 60, text: "   ", who: "Cline" }),
		).toBe(one);

		// A different speaker saying the same words is a real second line.
		expect(
			appendDriveTranscriptLine(one, {
				atMs: 80,
				text: "Reading the failing test.",
				who: "You",
			}),
		).toHaveLength(2);
	});

	it("clears to empty — leaving the call keeps nothing", () => {
		expect(clearDriveTranscript()).toEqual([]);
		expect(build(5)).toHaveLength(5);
		expect(clearDriveTranscript()).toHaveLength(0);
	});

	it("formats the m:ss call clock", () => {
		expect(formatDriveTranscriptClock(0)).toBe("0:00");
		expect(formatDriveTranscriptClock(9_400)).toBe("0:09");
		expect(formatDriveTranscriptClock(61_000)).toBe("1:01");
		expect(formatDriveTranscriptClock(613_000)).toBe("10:13");
		expect(formatDriveTranscriptClock(-5)).toBe("0:00");
	});
});
