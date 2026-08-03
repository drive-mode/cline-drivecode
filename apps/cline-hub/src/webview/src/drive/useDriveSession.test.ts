import { describe, expect, it } from "vitest";
import { DRIVE_DEFAULT_ROOM_ID } from "./types";
import {
	buildDriveJoinPayload,
	hasPendingDriveJoinRequest,
	isDriveRoomSnapshotForTarget,
	isDriveSessionHostMessage,
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
			note: "Room ended. Join again.",
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
			note: "Room ended. Join again.",
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

	it("makes hub-down / version skew a terminal empty state", () => {
		expect(
			resolveDriveCallError({
				code: "hub_disconnected",
				command: "call_get_room",
				text: "Hub is not connected.",
				wasJoining: false,
			}),
		).toEqual({
			kind: "reset",
			note: "Hub is down: Hub is not connected.",
			phase: "error",
		});
		expect(
			resolveDriveCallError({
				code: "version_skew",
				command: "call_get_room",
				text: "major mismatch",
				wasJoining: false,
			}),
		).toEqual({
			kind: "reset",
			note: "Drive schema skew — reconnect blocked: major mismatch",
			phase: "error",
		});
	});

	it("treats a failed room refresh as a terminal notice", () => {
		expect(
			resolveDriveCallError({
				code: "timeout",
				command: "call_get_room",
				text: "timed out",
				wasJoining: false,
			}),
		).toEqual({
			kind: "notice",
			note: "Could not refresh the Drive call: timed out",
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

describe("Drive join workspace-root gating", () => {
	// Regression: a join fired before the host's `defaults` reply resolved
	// workspaceRoot used to send call_join with no workspaceRoot at all —
	// indistinguishable, on the hub, from "this workspace truly has none" —
	// so ensureEventLog never bound a durable log. A live call could then
	// have nothing on disk to survive a crash.
	it("defers the join until workspaceRoot has resolved", () => {
		expect(
			buildDriveJoinPayload({
				roomId: DRIVE_DEFAULT_ROOM_ID,
				partnerName: "Cline",
				sessionId: "session-1",
				workspaceRoot: "/workspace",
				workspaceRootReady: false,
			}),
		).toBeNull();
	});

	it("sends once resolved, carrying the real workspaceRoot", () => {
		const payload = buildDriveJoinPayload({
			roomId: DRIVE_DEFAULT_ROOM_ID,
			partnerName: "Cline",
			sessionId: "session-1",
			workspaceRoot: "/workspace",
			workspaceRootReady: true,
		});
		expect(payload).toMatchObject({
			type: "call_join",
			roomId: DRIVE_DEFAULT_ROOM_ID,
			sessionId: "session-1",
			workspaceRoot: "/workspace",
		});
	});

	it("sends once resolved even when there truly is no workspace", () => {
		const payload = buildDriveJoinPayload({
			roomId: DRIVE_DEFAULT_ROOM_ID,
			partnerName: "Cline",
			workspaceRoot: "",
			workspaceRootReady: true,
		});
		expect(payload).not.toBeNull();
		expect(payload?.workspaceRoot).toBeUndefined();
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

	it("falls back when the requested room is not a string", () => {
		// Regression: DriveHeaderControls wired joinDrive straight into onClick,
		// so React passed the MouseEvent in as requestedRoomId and this threw
		// `candidate?.trim is not a function` — Join call was dead on arrival.
		expect(
			resolveDriveTargetRoomId({
				requestedRoomId: { type: "click" } as unknown as string,
				currentRoomId: "current-room",
			}),
		).toBe("current-room");
		expect(
			resolveDriveTargetRoomId({
				requestedRoomId: { type: "click" } as unknown as string,
			}),
		).toBe(DRIVE_DEFAULT_ROOM_ID);
	});
});

describe("Drive session host message guard", () => {
	const validSnapshot = {
		schemaVersion: 1,
		roomId: "pairing-room",
		createdAt: "2026-07-31T00:00:00.000Z",
		driveActive: true,
		subMode: "pairing",
		participants: [
			{ id: "human-1", kind: "human", displayName: "Harrison" },
			{ id: "agent-1", kind: "agent", displayName: "Partner" },
		],
		stage: { sharer: null, pin: null, cards: [] },
		muteByParticipantId: {},
		raisedHandByParticipantId: {},
	};

	it("accepts a room_snapshot with a structurally valid snapshot", () => {
		expect(
			isDriveSessionHostMessage({
				type: "room_snapshot",
				roomId: "pairing-room",
				snapshot: validSnapshot,
				seq: 3,
			}),
		).toBe(true);
	});

	it("rejects a room_snapshot whose snapshot is malformed", () => {
		expect(
			isDriveSessionHostMessage({
				type: "room_snapshot",
				roomId: "pairing-room",
				snapshot: { ...validSnapshot, participants: "not-an-array" },
			}),
		).toBe(false);
		expect(
			isDriveSessionHostMessage({
				type: "room_snapshot",
				snapshot: { ...validSnapshot, muteByParticipantId: undefined },
			}),
		).toBe(false);
	});

	it("rejects a drive_event narration without string text", () => {
		expect(
			isDriveSessionHostMessage({
				type: "drive_event",
				roomId: "pairing-room",
				snapshot: validSnapshot,
				event: { type: "conversation.narration" },
			}),
		).toBe(false);
	});

	it("requires a string showItemId on drive_show_presented", () => {
		expect(
			isDriveSessionHostMessage({
				type: "drive_show_presented",
				showItemId: "show-1",
				title: "Demo",
			}),
		).toBe(true);
		expect(
			isDriveSessionHostMessage({
				type: "drive_show_presented",
				showItemId: { nested: "object" },
			}),
		).toBe(false);
	});

	it("rejects drive_room_changed with a malformed show backlog", () => {
		expect(
			isDriveSessionHostMessage({
				type: "drive_room_changed",
				room: {
					spotlightParticipantId: null,
					director: {
						activeShowId: "show-1",
						showBacklog: [{ id: "show-1", title: 42, caption: "c" }],
					},
				},
			}),
		).toBe(false);
	});

	it("rejects unknown message types", () => {
		expect(isDriveSessionHostMessage({ type: "totally_unknown" })).toBe(false);
	});
});
