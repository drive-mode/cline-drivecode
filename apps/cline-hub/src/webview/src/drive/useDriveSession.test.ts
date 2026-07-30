import { describe, expect, it } from "vitest";
import {
	hasPendingDriveJoinRequest,
	isDriveRoomSnapshotForTarget,
	resolveDriveCallError,
	resolveDriveTargetRoomId,
	shouldReattachDriveSession,
} from "./useDriveSession";

describe("Drive call error transitions", () => {
	it("clears a stale missing room without requesting another refresh", () => {
		expect(
			resolveDriveCallError({
				code: "room_not_found",
				command: "call_get_room",
				text: "room_not_found:default",
				wasJoining: false,
			}),
		).toEqual({
			kind: "reset",
			note: "The Drive call is no longer available.",
			phase: "off",
		});
	});

	it("clears a stale missing room from a legacy call_error without code", () => {
		expect(
			resolveDriveCallError({
				command: "call_get_room",
				text: "room_not_found:default",
				wasJoining: false,
			}),
		).toEqual({
			kind: "reset",
			note: "The Drive call is no longer available.",
			phase: "off",
		});
	});

	it("makes a failed join retryable", () => {
		expect(
			resolveDriveCallError({
				code: "room_not_found",
				command: "call_join",
				text: "room_not_found:default",
				wasJoining: true,
			}),
		).toEqual({
			kind: "reset",
			note: "Could not join Drive: room_not_found:default",
			phase: "error",
		});
	});

	it("treats a failed room refresh as a terminal notice", () => {
		expect(
			resolveDriveCallError({
				code: "hub_disconnected",
				command: "call_get_room",
				text: "Hub is not connected.",
				wasJoining: false,
			}),
		).toEqual({
			kind: "notice",
			note: "Could not refresh the Drive call: Hub is not connected.",
		});
	});

	it("refreshes after a recoverable in-call mutation error", () => {
		expect(
			resolveDriveCallError({
				command: "call_rename_participant",
				text: "duplicate name",
				wasJoining: false,
			}),
		).toEqual({
			kind: "refresh",
			note: "Could not rename participant: duplicate name",
		});
	});

	it("keeps an authoritative call intact when session attachment fails", () => {
		expect(
			resolveDriveCallError({
				code: "room_not_found",
				command: "call_join",
				text: "room_not_found:default",
				wasJoining: false,
			}),
		).toEqual({
			kind: "notice",
			note: "Could not attach this Chat session to Drive: room_not_found:default",
		});
	});
});

describe("Drive session reattachment", () => {
	it("reattaches a new Chat session once while the call is active", () => {
		expect(
			shouldReattachDriveSession({
				active: true,
				confirmedAttachedSessionId: "session-1",
				connectionPhase: "on",
				driveIntended: true,
				failedAttachedSessionId: null,
				pendingAttachedSessionId: null,
				sessionId: "session-2",
			}),
		).toBe(true);
		expect(
			shouldReattachDriveSession({
				active: true,
				confirmedAttachedSessionId: "session-2",
				connectionPhase: "on",
				driveIntended: true,
				failedAttachedSessionId: null,
				pendingAttachedSessionId: null,
				sessionId: "session-2",
			}),
		).toBe(false);
	});

	it("does not attach before the call is seated", () => {
		expect(
			shouldReattachDriveSession({
				active: false,
				confirmedAttachedSessionId: null,
				connectionPhase: "joining",
				driveIntended: true,
				failedAttachedSessionId: null,
				pendingAttachedSessionId: null,
				sessionId: "session-2",
			}),
		).toBe(false);
	});

	it("does not retry an attachment while pending or after failure", () => {
		expect(
			shouldReattachDriveSession({
				active: true,
				confirmedAttachedSessionId: "session-1",
				connectionPhase: "on",
				driveIntended: true,
				failedAttachedSessionId: null,
				pendingAttachedSessionId: "session-2",
				sessionId: "session-2",
			}),
		).toBe(false);
		expect(
			shouldReattachDriveSession({
				active: true,
				confirmedAttachedSessionId: "session-1",
				connectionPhase: "on",
				driveIntended: true,
				failedAttachedSessionId: "session-2",
				pendingAttachedSessionId: null,
				sessionId: "session-2",
			}),
		).toBe(false);
	});

	it("does not treat a late join error as pending work", () => {
		expect(
			hasPendingDriveJoinRequest({
				pendingRoomJoin: false,
				pendingAttachedSessionId: null,
			}),
		).toBe(false);
		expect(
			hasPendingDriveJoinRequest({
				pendingRoomJoin: false,
				pendingAttachedSessionId: "session-2",
			}),
		).toBe(true);
	});
});

describe("Drive room targeting", () => {
	it("requires both the envelope and snapshot to match the target room", () => {
		expect(
			isDriveRoomSnapshotForTarget({
				expectedRoomId: "pairing-room",
				outerRoomId: "pairing-room",
				snapshotRoomId: "pairing-room",
			}),
		).toBe(true);
		expect(
			isDriveRoomSnapshotForTarget({
				expectedRoomId: "pairing-room",
				outerRoomId: "foreign-room",
				snapshotRoomId: "pairing-room",
			}),
		).toBe(false);
		expect(
			isDriveRoomSnapshotForTarget({
				expectedRoomId: "pairing-room",
				outerRoomId: "pairing-room",
				snapshotRoomId: "foreign-room",
			}),
		).toBe(false);
		expect(
			isDriveRoomSnapshotForTarget({
				expectedRoomId: "pairing-room",
				snapshotRoomId: "pairing-room",
			}),
		).toBe(true);
	});

	it("prefers an explicit normalized target room", () => {
		expect(
			resolveDriveTargetRoomId({
				requestedRoomId: "  pairing-room  ",
				currentRoomId: "current-room",
				expectedRoomId: "expected-room",
			}),
		).toBe("pairing-room");
		expect(
			resolveDriveTargetRoomId({
				currentRoomId: null,
				expectedRoomId: "expected-room",
			}),
		).toBe("expected-room");
	});
});
