import { describe, expect, it } from "vitest";
import type { HostMessage } from "../lib/host-message-gateway";
import {
	DRIVE_CALL_PRESENCE_MESSAGE_TYPES,
	foldDriveCallPresence,
	IDLE_DRIVE_CALL_PRESENCE,
	seedDriveCallPresence,
} from "./driveCallPresence";
import {
	END_DRIVE_EVENT,
	END_ROOM_JOIN_SNAPSHOT,
	JOIN_ROOM_SNAPSHOT,
	LEAVE_DRIVE_EVENT,
	NARRATION_DRIVE_EVENT,
	RAISE_HAND_DRIVE_EVENT,
	ROOM_CHANGED_MUTE,
	UNMUTE_DRIVE_EVENT,
} from "./driveCallPresence.fixture";
import {
	DRIVE_SESSION_MESSAGE_TYPES,
	type DriveSessionHostMessage,
	isDriveSessionHostMessage,
} from "./driveSessionPolicy";

const RECORDED: readonly HostMessage[] = [
	JOIN_ROOM_SNAPSHOT,
	UNMUTE_DRIVE_EVENT,
	RAISE_HAND_DRIVE_EVENT,
	ROOM_CHANGED_MUTE,
	LEAVE_DRIVE_EVENT,
	END_ROOM_JOIN_SNAPSHOT,
	NARRATION_DRIVE_EVENT,
	END_DRIVE_EVENT,
];

/**
 * Narrow a recorded payload the way the gateway does before dispatch, so no
 * test can feed the fold something production would have dropped.
 */
function routed(message: HostMessage): DriveSessionHostMessage {
	if (!isDriveSessionHostMessage(message)) {
		throw new Error(`guard rejected recorded "${message.type}" payload`);
	}
	return message;
}

const join = routed(JOIN_ROOM_SNAPSHOT);
const unmute = routed(UNMUTE_DRIVE_EVENT);
const raiseHand = routed(RAISE_HAND_DRIVE_EVENT);
const roomChangedMute = routed(ROOM_CHANGED_MUTE);
const leave = routed(LEAVE_DRIVE_EVENT);
const endRoomJoin = routed(END_ROOM_JOIN_SNAPSHOT);
const narration = routed(NARRATION_DRIVE_EVENT);
const end = routed(END_DRIVE_EVENT);

function fold(messages: readonly DriveSessionHostMessage[]) {
	return messages.reduce(foldDriveCallPresence, IDLE_DRIVE_CALL_PRESENCE);
}

describe("driveCallPresence recorded broadcasts", () => {
	it("every recorded payload passes the session guard the reader subscribes with", () => {
		for (const message of RECORDED) {
			expect(isDriveSessionHostMessage(message)).toBe(true);
			expect(DRIVE_SESSION_MESSAGE_TYPES).toContain(message.type);
		}
	});

	it("subscribes to a subset of the session message types", () => {
		for (const type of DRIVE_CALL_PRESENCE_MESSAGE_TYPES) {
			expect(DRIVE_SESSION_MESSAGE_TYPES).toContain(type);
		}
	});

	it("goes active on the join snapshot, seated muted", () => {
		expect(fold([join])).toEqual({
			active: true,
			roomId: "presence-fixture",
			partnerName: "Adam",
			muted: true,
			handRaised: false,
			narration: null,
		});
	});

	it("folds unmute and raise hand from drive_event snapshots", () => {
		expect(fold([join, unmute])).toMatchObject({
			active: true,
			muted: false,
			handRaised: false,
		});
		expect(fold([join, unmute, raiseHand])).toMatchObject({
			active: true,
			muted: false,
			handRaised: true,
		});
	});

	it("folds the drive_room_changed live-room mute patch", () => {
		const unmuted = fold([join, unmute]);
		expect(unmuted.muted).toBe(false);
		const patched = foldDriveCallPresence(unmuted, roomChangedMute);
		expect(patched).toMatchObject({
			active: true,
			roomId: "presence-fixture",
			muted: true,
		});
	});

	it("keeps the room and partner across the whole live sequence", () => {
		const presence = fold([join, unmute, raiseHand, roomChangedMute]);
		expect(presence).toEqual({
			active: true,
			roomId: "presence-fixture",
			partnerName: "Adam",
			muted: true,
			handRaised: true,
			narration: null,
		});
	});

	it("goes inactive on leave even though the room is still live", () => {
		// The hub keeps driveActive true for drop-in rejoin; only the seat leaves.
		expect(leave.snapshot?.driveActive).toBe(true);
		const presence = fold([join, unmute, raiseHand, leave]);
		expect(presence).toEqual(IDLE_DRIVE_CALL_PRESENCE);
	});

	it("goes inactive on room end", () => {
		expect(fold([endRoomJoin, end])).toEqual(IDLE_DRIVE_CALL_PRESENCE);
	});

	it("carries the handoff narration while still seated, then drops it on end", () => {
		const narrating = fold([endRoomJoin, narration]);
		expect(narrating.active).toBe(true);
		expect(narrating.narration).toBe(
			"Session handoff: Done: (none). Open: (none).",
		);
		expect(foldDriveCallPresence(narrating, end).narration).toBeNull();
	});

	it("switches rooms when a snapshot seats the human somewhere else", () => {
		const first = fold([join, unmute]);
		expect(first).toMatchObject({ roomId: "presence-fixture", muted: false });
		const switched = foldDriveCallPresence(first, endRoomJoin);
		expect(switched).toEqual({
			active: true,
			roomId: "presence-fixture-narration",
			partnerName: "Adam",
			// Not carried over from the previous room — the new room seats muted.
			muted: true,
			handRaised: false,
			narration: null,
		});
	});

	it("ignores a live-room patch and a foreign unseated snapshot while idle", () => {
		expect(
			foldDriveCallPresence(IDLE_DRIVE_CALL_PRESENCE, roomChangedMute),
		).toBe(IDLE_DRIVE_CALL_PRESENCE);
		expect(foldDriveCallPresence(IDLE_DRIVE_CALL_PRESENCE, leave)).toBe(
			IDLE_DRIVE_CALL_PRESENCE,
		);
	});

	it("leaves presence untouched when another room's traffic arrives", () => {
		const joined = fold([join, unmute]);
		const otherRoomLeave = {
			...leave,
			roomId: "other-room",
			snapshot: {
				// biome-ignore lint/style/noNonNullAssertion: recorded fixture always has one.
				...leave.snapshot!,
				roomId: "other-room",
			},
		};
		expect(foldDriveCallPresence(joined, otherRoomLeave)).toBe(joined);
	});

	it("drops a snapshot whose envelope names a different room", () => {
		const mismatched = { ...join, roomId: "spoofed-room" };
		expect(foldDriveCallPresence(IDLE_DRIVE_CALL_PRESENCE, mismatched)).toBe(
			IDLE_DRIVE_CALL_PRESENCE,
		);
	});

	it("returns the same reference when a broadcast changes nothing", () => {
		const joined = fold([join]);
		expect(foldDriveCallPresence(joined, join)).toBe(joined);
	});

	it("is a pure fold — replaying the sequence gives an equal result", () => {
		const sequence = [join, unmute, raiseHand, roomChangedMute, leave];
		expect(fold(sequence)).toEqual(fold(sequence));
	});
});

describe("seedDriveCallPresence", () => {
	it("is idle without persisted state or when the call was not active", () => {
		expect(seedDriveCallPresence(undefined)).toBe(IDLE_DRIVE_CALL_PRESENCE);
		expect(seedDriveCallPresence(null)).toBe(IDLE_DRIVE_CALL_PRESENCE);
		expect(seedDriveCallPresence({ active: false, roomId: "r1" })).toBe(
			IDLE_DRIVE_CALL_PRESENCE,
		);
	});

	it("rehydrates an active call without inventing narration", () => {
		expect(
			seedDriveCallPresence({
				active: true,
				roomId: "presence-fixture",
				partnerName: "Adam",
				muted: true,
				handRaised: false,
			}),
		).toEqual({
			active: true,
			roomId: "presence-fixture",
			partnerName: "Adam",
			muted: true,
			handRaised: false,
			narration: null,
		});
	});

	it("is superseded by the first real snapshot for every field it carries", () => {
		const seeded = seedDriveCallPresence({
			active: true,
			roomId: "presence-fixture",
			partnerName: "Stale",
			muted: false,
			handRaised: true,
		});
		expect(foldDriveCallPresence(seeded, join)).toEqual({
			active: true,
			roomId: "presence-fixture",
			partnerName: "Adam",
			muted: true,
			// The join snapshot has no raised-hand entry for the human, and an
			// absent entry keeps the current value — the same fallback
			// `applyRoomSnapshot` uses, so both readers agree.
			handRaised: true,
			narration: null,
		});
	});

	it("drops a seeded room the hub reports the human is no longer seated in", () => {
		const seeded = seedDriveCallPresence({
			active: true,
			roomId: "presence-fixture",
			partnerName: "Adam",
			muted: false,
			handRaised: false,
		});
		expect(foldDriveCallPresence(seeded, leave)).toEqual(
			IDLE_DRIVE_CALL_PRESENCE,
		);
	});
});
