/**
 * Session rollup reader — fixture JSONL / synthetic events.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BankDriveEvent, DriveEvent } from "@cline/shared";
import {
	resolveDriveRoomEventsPath,
	resolveDriveRoomsDir,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { appendBankLogEvent } from "./bankEventLog";
import {
	createFsSessionRollupSource,
	formatSessionRollupsDump,
	listRecentCallSessionIds,
	loadAllBankEvents,
	loadAllRoomEvents,
	readSessionRollups,
	rollupFromLoadedEvents,
} from "./sessionRollupReader";

function bank(
	partial: Record<string, unknown> & {
		id?: string;
		at: string;
		roomId: string;
		type: BankDriveEvent["type"];
	},
): BankDriveEvent {
	return {
		schemaVersion: 1,
		id: partial.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
		...partial,
	} as unknown as BankDriveEvent;
}

function joinEvent(
	callSessionId: string,
	roomId: string,
	at: string,
	id: string,
): DriveEvent {
	return {
		schemaVersion: 1,
		id,
		roomId,
		at,
		callSessionId,
		type: "control.join",
		track: "control",
		participant: {
			id: "human",
			kind: "human",
			displayName: "You",
			role: "host",
			status: "idle",
		},
	};
}

function leaveEvent(
	callSessionId: string,
	roomId: string,
	at: string,
	id: string,
	durationMs: number,
): DriveEvent {
	return {
		schemaVersion: 1,
		id,
		roomId,
		at,
		callSessionId,
		type: "control.leave",
		track: "control",
		participantId: "human",
		durationMs,
	};
}

function writeRoomJsonl(
	configParent: string,
	roomId: string,
	events: DriveEvent[],
): void {
	const path = resolveDriveRoomEventsPath(configParent, roomId);
	mkdirSync(join(resolveDriveRoomsDir(configParent), roomId), {
		recursive: true,
	});
	writeFileSync(
		path,
		events.map((event, i) => JSON.stringify({ seq: i + 1, event })).join("\n") +
			"\n",
		"utf8",
	);
}

describe("sessionRollupReader", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads room + bank JSONL and derives rollup for callSessionId", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-rollup-reader-"));
		dirs.push(dir);
		const callSessionId = "cs-clean";
		const roomId = "room-1";

		writeRoomJsonl(dir, roomId, [
			joinEvent(callSessionId, roomId, "2026-07-30T10:00:00.000Z", "j1"),
			leaveEvent(
				callSessionId,
				roomId,
				"2026-07-30T10:10:00.000Z",
				"l1",
				600_000,
			),
		]);

		appendBankLogEvent(
			dir,
			bank({
				id: "a1",
				at: "2026-07-30T10:01:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_activated",
				planId: "p1",
				title: "Ship",
			}),
		);
		appendBankLogEvent(
			dir,
			bank({
				id: "c1",
				at: "2026-07-30T10:05:00.000Z",
				roomId,
				callSessionId,
				type: "drive_task_completed",
				taskId: "t1",
			}),
		);
		appendBankLogEvent(
			dir,
			bank({
				id: "pa1",
				at: "2026-07-30T10:06:00.000Z",
				roomId,
				callSessionId,
				type: "drive_plan_archived",
				planId: "p1",
			}),
		);

		const roomEvents = loadAllRoomEvents(dir);
		const bankEvents = loadAllBankEvents(dir);
		expect(roomEvents).toHaveLength(2);
		expect(bankEvents.length).toBeGreaterThanOrEqual(3);

		const [rollup] = readSessionRollups(dir, { callSessionId });
		expect(rollup).toBeDefined();
		expect(rollup?.tasksCompleted).toBe(1);
		expect(rollup?.planCleanDrain).toBe(true);
		expect(rollup?.durationMs).toBe(600_000);
		expect(rollup?.failureStickyCount).toBe(0);
	});

	it("returns recent rollups newest-first with limit", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-rollup-recent-"));
		dirs.push(dir);
		const roomId = "room-a";

		writeRoomJsonl(dir, roomId, [
			joinEvent("cs-old", roomId, "2026-07-30T09:00:00.000Z", "j-old"),
			leaveEvent(
				"cs-old",
				roomId,
				"2026-07-30T09:05:00.000Z",
				"l-old",
				300_000,
			),
			joinEvent("cs-new", roomId, "2026-07-30T11:00:00.000Z", "j-new"),
			leaveEvent(
				"cs-new",
				roomId,
				"2026-07-30T11:05:00.000Z",
				"l-new",
				300_000,
			),
		]);

		appendBankLogEvent(
			dir,
			bank({
				id: "c-old",
				at: "2026-07-30T09:02:00.000Z",
				roomId,
				callSessionId: "cs-old",
				type: "drive_task_completed",
				taskId: "t-old",
			}),
		);
		appendBankLogEvent(
			dir,
			bank({
				id: "c-new",
				at: "2026-07-30T11:02:00.000Z",
				roomId,
				callSessionId: "cs-new",
				type: "drive_task_completed",
				taskId: "t-new",
			}),
		);

		const rollups = readSessionRollups(dir, { limit: 1 });
		expect(rollups).toHaveLength(1);
		expect(rollups[0]?.callSessionId).toBe("cs-new");
		expect(rollups[0]?.tasksCompleted).toBe(1);

		const all = readSessionRollups(dir, { limit: 10 });
		expect(all.map((r) => r.callSessionId)).toEqual(["cs-new", "cs-old"]);
	});

	it("createFsSessionRollupSource matches readSessionRollups", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-rollup-src-"));
		dirs.push(dir);
		expect(createFsSessionRollupSource(dir).readRollups()).toEqual([]);
		expect(formatSessionRollupsDump([])).toContain("No session rollups");
	});

	it("rollupFromLoadedEvents is pure for Status port reuse", () => {
		const callSessionId = "cs-pure";
		const roomId = "r";
		const roomEvents: DriveEvent[] = [
			joinEvent(callSessionId, roomId, "2026-07-30T10:00:00.000Z", "j1"),
			leaveEvent(
				callSessionId,
				roomId,
				"2026-07-30T10:05:00.000Z",
				"l1",
				300_000,
			),
		];
		const bankEvents: BankDriveEvent[] = [
			bank({
				id: "c1",
				at: "2026-07-30T10:02:00.000Z",
				roomId,
				callSessionId,
				type: "drive_task_completed",
				taskId: "t1",
			}),
		];
		const ids = listRecentCallSessionIds(roomEvents, bankEvents);
		expect(ids).toEqual([callSessionId]);
		const rollup = rollupFromLoadedEvents({
			callSessionId,
			roomEvents,
			bankEvents,
		});
		expect(rollup.tasksCompleted).toBe(1);
		expect(formatSessionRollupsDump([rollup])).toContain(callSessionId);
		expect(formatSessionRollupsDump([rollup])).toContain("S2=1");
	});

	it("returns empty for unknown callSessionId", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-rollup-miss-"));
		dirs.push(dir);
		expect(readSessionRollups(dir, { callSessionId: "missing" })).toEqual(
			[],
		);
	});
});
