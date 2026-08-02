import type { DriveEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createEmptyRoomSnapshot, reduceRoom } from "../reduceRoom";
import {
	type DriveRoomDirectoryEntry,
	projectRoomDirectoryEntry,
	sortRoomDirectory,
} from "./roomDirectory";

const ROOM = "demo-polish";

function ts(minute: number): string {
	return `2026-07-31T16:${String(minute).padStart(2, "0")}:00.000Z`;
}

const HUMAN = {
	id: "drive:human",
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
} as const;

const AGENT = {
	id: "drive:partner",
	kind: "agent",
	displayName: "Cline",
	role: "partner",
	status: "idle",
	seatSources: [],
} as const;

/** A session that configures the room, does work, then stops on purpose. */
function stoppedRoomEvents(): DriveEvent[] {
	return [
		{
			schemaVersion: 1,
			id: "e1",
			roomId: ROOM,
			at: ts(58),
			type: "control.join",
			track: "control",
			participant: HUMAN,
		},
		{
			schemaVersion: 1,
			id: "e2",
			roomId: ROOM,
			at: ts(58),
			type: "control.join",
			track: "control",
			participant: AGENT,
		},
		{
			schemaVersion: 1,
			id: "e3",
			roomId: ROOM,
			at: ts(59),
			type: "control.mode",
			track: "control",
			subMode: "act",
			driveActive: true,
		},
		{
			schemaVersion: 1,
			id: "e4",
			roomId: ROOM,
			at: ts(59),
			type: "control.address",
			track: "control",
			addressSet: { mode: "direct", participantIds: [AGENT.id] },
		},
		{
			schemaVersion: 1,
			id: "e5",
			roomId: ROOM,
			at: ts(59),
			type: "work.edit",
			track: "work",
			path: "src/app.ts",
			summary: "wire the rail",
		},
		{
			schemaVersion: 1,
			id: "e6",
			roomId: ROOM,
			at: ts(59),
			type: "work.test_result",
			track: "work",
			label: "unit",
			passed: true,
		},
		{
			schemaVersion: 1,
			id: "e7",
			roomId: ROOM,
			at: ts(59),
			type: "control.end",
			track: "control",
			reason: "stopped",
		},
	];
}

describe("projectRoomDirectoryEntry", () => {
	it("keeps config and history after the room is stopped", () => {
		const entry = projectRoomDirectoryEntry({
			roomId: ROOM,
			events: stoppedRoomEvents(),
		});

		expect(entry.status).toBe("ended");
		// Config survives control.end (which only clears the roster).
		expect(entry.subMode).toBe("act");
		expect(entry.addressMode).toBe("direct");
		// History survives too: one card per work category.
		expect(entry.cardCount).toBe(2);
		expect(entry.participantNames).toEqual([]);
		expect(entry.createdAt).toBe(ts(58));
		expect(entry.updatedAt).toBe(ts(59));
		expect(entry.eventCount).toBe(7);
	});

	it("reports live again once the stopped room is rejoined", () => {
		const entry = projectRoomDirectoryEntry({
			roomId: ROOM,
			events: [
				...stoppedRoomEvents(),
				{
					schemaVersion: 1,
					id: "e8",
					roomId: ROOM,
					at: ts(5),
					type: "control.join",
					track: "control",
					participant: HUMAN,
				},
			],
		});

		expect(entry.status).toBe("live");
		expect(entry.participantNames).toEqual(["You"]);
		// Restart does not reset what the room knew.
		expect(entry.subMode).toBe("act");
		expect(entry.cardCount).toBe(2);
	});

	/**
	 * Regression: `control.leave` does not clear `driveActive`, so a room
	 * everyone left still carries the flag. Reading liveness off it left
	 * drained rooms stuck on "Live" against a real hub.
	 */
	it("calls a drained room paused even though driveActive is still set", () => {
		const events: DriveEvent[] = [
			{
				schemaVersion: 1,
				id: "e1",
				roomId: ROOM,
				at: ts(10),
				type: "control.join",
				track: "control",
				participant: HUMAN,
			},
			{
				schemaVersion: 1,
				id: "e2",
				roomId: ROOM,
				at: ts(15),
				type: "control.mode",
				track: "control",
				subMode: "act",
				driveActive: true,
			},
			{
				schemaVersion: 1,
				id: "e3",
				roomId: ROOM,
				at: ts(20),
				type: "control.leave",
				track: "control",
				participantId: HUMAN.id,
			},
		];

		let folded = createEmptyRoomSnapshot({ roomId: ROOM, createdAt: ts(10) });
		for (const event of events) {
			folded = reduceRoom(folded, event);
		}
		expect(folded.driveActive).toBe(true);

		expect(projectRoomDirectoryEntry({ roomId: ROOM, events }).status).toBe(
			"paused",
		);
	});

	it("prefers the resident snapshot over a trimmed log", () => {
		const trimmed: DriveEvent[] = [
			{
				schemaVersion: 1,
				id: "e9",
				roomId: ROOM,
				at: ts(30),
				type: "work.command",
				track: "work",
				command: "bun test",
				failed: false,
			},
		];
		let live = createEmptyRoomSnapshot({ roomId: ROOM, createdAt: ts(1) });
		live = reduceRoom(live, {
			schemaVersion: 1,
			id: "seed",
			roomId: ROOM,
			at: ts(1),
			type: "control.join",
			track: "control",
			participant: AGENT,
		});

		const entry = projectRoomDirectoryEntry({
			roomId: ROOM,
			events: trimmed,
			liveSnapshot: live,
		});

		expect(entry.status).toBe("live");
		expect(entry.participantNames).toEqual(["Cline"]);
		expect(entry.createdAt).toBe(ts(1));
		expect(entry.updatedAt).toBe(ts(30));
	});

	it("survives an empty log", () => {
		const entry = projectRoomDirectoryEntry({ roomId: ROOM, events: [] });
		expect(entry.status).toBe("paused");
		expect(entry.eventCount).toBe(0);
		expect(entry.subMode).toBe("plan");
	});
});

describe("sortRoomDirectory", () => {
	it("orders live first, then most recently touched", () => {
		const entry = (
			roomId: string,
			status: DriveRoomDirectoryEntry["status"],
			updatedAt: string,
		): DriveRoomDirectoryEntry => ({
			roomId,
			status,
			createdAt: ts(0),
			updatedAt,
			subMode: "plan",
			addressMode: "everyone",
			participantNames: [],
			cardCount: 0,
			eventCount: 1,
		});

		const sorted = sortRoomDirectory([
			entry("ended-new", "ended", ts(50)),
			entry("paused-old", "paused", ts(10)),
			entry("paused-new", "paused", ts(40)),
			entry("live", "live", ts(5)),
		]);

		expect(sorted.map((e) => e.roomId)).toEqual([
			"live",
			"paused-new",
			"paused-old",
			"ended-new",
		]);
	});
});
