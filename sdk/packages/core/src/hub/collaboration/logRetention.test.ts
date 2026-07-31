/**
 * DRV-PRIVACY retention: oversized room/bank JSONL trim safely.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BankDriveEvent, DriveEvent } from "@cline/shared";
import { resolveDriveRoomEventsPath } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendBankLogEvent,
	readBankLogSince,
	resetBankLogRetentionCacheForTests,
} from "./bankEventLog";
import { JsonlRoomEventLog, MemoryRoomEventLog } from "./eventLog";
import {
	countNonEmptyLines,
	keepLastNonEmptyLines,
	trimJsonlFileToMaxRecords,
} from "./logRetention";

function muteEvent(roomId: string, seqHint: number): DriveEvent {
	return {
		schemaVersion: 1,
		id: `mute-${seqHint}`,
		roomId,
		at: new Date(Date.UTC(2026, 0, 1, 0, 0, seqHint)).toISOString(),
		type: "control.mute",
		track: "control",
		participantId: "h1",
		muted: seqHint % 2 === 0,
	};
}

function openedBank(i: number): BankDriveEvent {
	return {
		schemaVersion: 1,
		id: `opened-${i}`,
		at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
		roomId: "r1",
		callSessionId: "cs-1",
		type: "drive_task_opened",
		taskId: `t-${i}`,
		title: `Task ${i}`,
	};
}

describe("logRetention helpers", () => {
	it("keepLastNonEmptyLines drops oldest lines", () => {
		const text = "a\nb\nc\nd\n";
		expect(keepLastNonEmptyLines(text, 2)).toBe("c\nd\n");
		expect(countNonEmptyLines(keepLastNonEmptyLines(text, 2))).toBe(2);
	});
});

describe("JsonlRoomEventLog retention", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("trims oldest room JSONL records past maxRecords", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-retain-"));
		dirs.push(dir);
		const log = new JsonlRoomEventLog(dir, { maxRecords: 5 });
		for (let i = 1; i <= 12; i += 1) {
			log.appendSync("r1", muteEvent("r1", i));
		}
		expect(log.latestSeq("r1")).toBe(12);
		const retained = log.readSinceSync("r1", 0);
		expect(retained).toHaveLength(5);
		expect(retained[0]?.seq).toBe(8);
		expect(retained[4]?.seq).toBe(12);

		const path = resolveDriveRoomEventsPath(dir, "r1");
		expect(countNonEmptyLines(readFileSync(path, "utf8"))).toBe(5);
		// Idempotent trim when already at cap.
		expect(trimJsonlFileToMaxRecords(path, 5)).toBe(5);
	});

	it("MemoryRoomEventLog trims oldest in-memory records", () => {
		const log = new MemoryRoomEventLog({ maxRecords: 3 });
		for (let i = 1; i <= 7; i += 1) {
			log.appendSync("r1", muteEvent("r1", i));
		}
		expect(log.latestSeq("r1")).toBe(7);
		const retained = log.readSinceSync("r1", 0);
		expect(retained.map((r) => r.seq)).toEqual([5, 6, 7]);
	});
});

describe("bankEventLog retention", () => {
	const dirs: string[] = [];

	afterEach(() => {
		resetBankLogRetentionCacheForTests();
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("trims oldest bank JSONL records past maxRecords", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-bank-retain-"));
		dirs.push(dir);
		for (let i = 1; i <= 10; i += 1) {
			appendBankLogEvent(dir, openedBank(i), { maxRecords: 4 });
		}
		const retained = readBankLogSince(dir, 0);
		expect(retained).toHaveLength(4);
		expect(retained.map((e) => e.seq)).toEqual([7, 8, 9, 10]);
		expect(retained[0]?.event.type).toBe("drive_task_opened");
		// nextSeq remains monotonic past the trim window
		const again = appendBankLogEvent(dir, openedBank(11), {
			maxRecords: 4,
		});
		expect(again.seq).toBe(11);
		expect(readBankLogSince(dir, 0).map((e) => e.seq)).toEqual([
			8, 9, 10, 11,
		]);
	});
});
