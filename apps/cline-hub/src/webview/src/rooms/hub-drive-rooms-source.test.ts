import { describe, expect, it } from "vitest";
import type { HostMessage } from "../lib/host-message-gateway";
import {
	isRoomStopReply,
	type RoomStopReply,
	roomStopReplyMatches,
} from "./hub-drive-rooms-source";

/** The reply the hub sends when `call_end` actually closes a room. */
function endReply(roomId: string, over: Partial<RoomStopReply> = {}) {
	return {
		type: "room_snapshot",
		roomId,
		ended: true,
		handoffNarration: "Session handoff: Done: (none).",
		...over,
	} as RoomStopReply;
}

describe("roomStopReplyMatches", () => {
	it("matches the call_end reply for the room being stopped", () => {
		expect(roomStopReplyMatches(endReply("demo-polish"), "demo-polish")).toBe(
			true,
		);
	});

	/**
	 * The idempotent second end returns `ended` with no handoff narration —
	 * keying on narration would leave this Stop hanging until it timed out.
	 */
	it("matches an idempotent double-end that carries no narration", () => {
		expect(
			roomStopReplyMatches(
				endReply("demo-polish", { handoffNarration: undefined }),
				"demo-polish",
			),
		).toBe(true);
	});

	/**
	 * `room_snapshot` is broadcast for roster changes and mid-call updates, so
	 * the room being stopped emits them constantly. Resolving on one would
	 * report the stop finished before `call_end` had run.
	 */
	it("ignores an ordinary snapshot for the same room", () => {
		expect(
			roomStopReplyMatches(
				{
					type: "room_snapshot",
					roomId: "demo-polish",
					seq: 12,
				} as RoomStopReply,
				"demo-polish",
			),
		).toBe(false);
	});

	it("ignores an end snapshot for a different room", () => {
		expect(roomStopReplyMatches(endReply("voice-clips"), "demo-polish")).toBe(
			false,
		);
	});

	it("matches a call_end failure for the room being stopped", () => {
		expect(
			roomStopReplyMatches(
				{
					type: "call_error",
					roomId: "demo-polish",
					command: "call_end",
					text: "room_not_found",
				} as RoomStopReply,
				"demo-polish",
			),
		).toBe(true);
	});

	/** Two rooms stopping at once must not abort each other. */
	it("ignores a call_end failure raised for another room", () => {
		expect(
			roomStopReplyMatches(
				{
					type: "call_error",
					roomId: "voice-clips",
					command: "call_end",
					text: "room_not_found",
				} as RoomStopReply,
				"demo-polish",
			),
		).toBe(false);
	});

	it("ignores a failure of a different command on the same room", () => {
		expect(
			roomStopReplyMatches(
				{
					type: "call_error",
					roomId: "demo-polish",
					command: "call_mute",
					text: "nope",
				} as RoomStopReply,
				"demo-polish",
			),
		).toBe(false);
	});

	/** An older hub that does not stamp roomId must not resolve a stop. */
	it("ignores replies that name no room at all", () => {
		expect(
			roomStopReplyMatches(
				{ type: "call_error", command: "call_end" } as RoomStopReply,
				"demo-polish",
			),
		).toBe(false);
		expect(
			roomStopReplyMatches(
				{ type: "room_snapshot", ended: true } as RoomStopReply,
				"demo-polish",
			),
		).toBe(false);
	});
});

describe("isRoomStopReply", () => {
	it("accepts the reply shapes a stop waits on", () => {
		expect(isRoomStopReply(endReply("demo-polish") as HostMessage)).toBe(true);
		expect(
			isRoomStopReply({
				type: "call_error",
				roomId: "demo-polish",
				command: "call_end",
				text: "boom",
			}),
		).toBe(true);
	});

	it("rejects other message types and malformed fields", () => {
		expect(isRoomStopReply({ type: "drive_rooms", rooms: [] })).toBe(false);
		expect(
			isRoomStopReply({
				type: "room_snapshot",
				roomId: 7 as unknown as string,
			}),
		).toBe(false);
		expect(
			isRoomStopReply({
				type: "room_snapshot",
				roomId: "demo-polish",
				ended: "yes" as unknown as boolean,
			}),
		).toBe(false);
	});
});
