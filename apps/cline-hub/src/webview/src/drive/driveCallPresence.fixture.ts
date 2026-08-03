/**
 * Recorded Drive room broadcasts, verbatim.
 *
 * Captured by driving the real hub handlers
 * (`sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts` and
 * `drive-handlers.ts`) through join / unmute / raise hand / mute / leave, then
 * a second room through join / end, and wrapping each published hub event
 * exactly as `apps/cline-hub/src/server/hub.ts` wraps it for the webview. Ids
 * and timestamps are from that run; nothing here is hand-written.
 *
 * Typed as the raw `HostMessage` the gateway receives, not as the narrowed
 * session message: the hub really does send fields the webview type does not
 * declare (`director.doBacklog`, `activeScript`, …). The test narrows them
 * through `isDriveSessionHostMessage` first, which is the production path.
 */

import type { HostMessage } from "../lib/host-message-gateway";

/** `call_join` broadcast. The hub seats the human muted on join. */
export const JOIN_ROOM_SNAPSHOT: HostMessage = {
	type: "room_snapshot",
	roomId: "presence-fixture",
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture",
		createdAt: "2026-08-03T15:12:37.261Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [
					{
						kind: "manual",
					},
				],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: "drive:partner",
			},
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": true,
		},
		raisedHandByParticipantId: {},
		appliedEventIds: [
			"join_e3501aa5-f998-4156-8b50-6e78f391312d",
			"join_a2339c00-c63e-4ccd-a0b2-40a6059b3666",
			"mode_5acb1623-49a7-434b-95c5-18142135d596",
			"stage_3ba1d60c-0025-44f2-af97-cdb30469c746",
		],
	},
	seq: 4,
};

/** `call_mute` with muted:false — control.mute event plus the folded snapshot. */
export const UNMUTE_DRIVE_EVENT: HostMessage = {
	type: "drive_event",
	roomId: "presence-fixture",
	event: {
		schemaVersion: 1,
		id: "mute_0593e376-9439-4307-ba58-a0c9abe77c72",
		roomId: "presence-fixture",
		at: "2026-08-03T15:12:37.292Z",
		actorId: "drive:human",
		type: "control.mute",
		track: "control",
		participantId: "drive:human",
		muted: false,
		callSessionId: "cs_74050b71-556b-42b9-9756-33183b8de431",
	},
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture",
		createdAt: "2026-08-03T15:12:37.261Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [
					{
						kind: "manual",
					},
				],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: "drive:partner",
			},
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": false,
		},
		raisedHandByParticipantId: {},
		appliedEventIds: [
			"join_e3501aa5-f998-4156-8b50-6e78f391312d",
			"join_a2339c00-c63e-4ccd-a0b2-40a6059b3666",
			"mode_5acb1623-49a7-434b-95c5-18142135d596",
			"stage_3ba1d60c-0025-44f2-af97-cdb30469c746",
			"mute_0593e376-9439-4307-ba58-a0c9abe77c72",
		],
	},
	seq: 5,
};

/** `call_raise_hand` with raised:true. */
export const RAISE_HAND_DRIVE_EVENT: HostMessage = {
	type: "drive_event",
	roomId: "presence-fixture",
	event: {
		schemaVersion: 1,
		id: "hand_91afcbbb-7ad6-491d-bfa1-6eff8b59e700",
		roomId: "presence-fixture",
		at: "2026-08-03T15:12:37.303Z",
		actorId: "drive:human",
		type: "control.raise_hand",
		track: "control",
		participantId: "drive:human",
		raised: true,
		callSessionId: "cs_74050b71-556b-42b9-9756-33183b8de431",
	},
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture",
		createdAt: "2026-08-03T15:12:37.261Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [
					{
						kind: "manual",
					},
				],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: "drive:partner",
			},
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": false,
		},
		raisedHandByParticipantId: {
			"drive:human": true,
		},
		appliedEventIds: [
			"join_e3501aa5-f998-4156-8b50-6e78f391312d",
			"join_a2339c00-c63e-4ccd-a0b2-40a6059b3666",
			"mode_5acb1623-49a7-434b-95c5-18142135d596",
			"stage_3ba1d60c-0025-44f2-af97-cdb30469c746",
			"mute_0593e376-9439-4307-ba58-a0c9abe77c72",
			"hand_91afcbbb-7ad6-491d-bfa1-6eff8b59e700",
		],
	},
	seq: 6,
};

/** `drive.participant.mute.set` — the live-room patch, no snapshot attached. */
export const ROOM_CHANGED_MUTE: HostMessage = {
	type: "drive_room_changed",
	room: {
		roomId: "presence-fixture",
		spotlightParticipantId: "drive:partner",
		participantAudio: [
			{
				participantId: "drive:human",
				muted: true,
				deafened: false,
			},
			{
				participantId: "drive:partner",
				muted: false,
				deafened: false,
			},
		],
		director: {
			doBacklog: [],
			showBacklog: [],
			activeScript: null,
			activeBeatId: null,
			activeShowId: null,
			stickyShowIds: [],
			spotlightParticipantId: "drive:partner",
			lastPresentedAt: null,
		},
		seatedParticipantIds: ["drive:human", "drive:partner"],
		chatForks: [],
		version: 8,
	},
};

/** `call_leave` — the room stays live but the human seat is gone. */
export const LEAVE_DRIVE_EVENT: HostMessage = {
	type: "drive_event",
	roomId: "presence-fixture",
	event: {
		schemaVersion: 1,
		id: "leave_9197c0c3-a2cb-41ac-b2be-e940dfebbe25",
		roomId: "presence-fixture",
		at: "2026-08-03T15:12:37.318Z",
		actorId: "drive:human",
		callSessionId: "cs_74050b71-556b-42b9-9756-33183b8de431",
		type: "control.leave",
		track: "control",
		participantId: "drive:human",
		durationMs: 57,
	},
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture",
		createdAt: "2026-08-03T15:12:37.261Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [
					{
						kind: "manual",
					},
				],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: "drive:partner",
			},
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": true,
		},
		raisedHandByParticipantId: {
			"drive:human": true,
		},
		appliedEventIds: [
			"join_e3501aa5-f998-4156-8b50-6e78f391312d",
			"join_a2339c00-c63e-4ccd-a0b2-40a6059b3666",
			"mode_5acb1623-49a7-434b-95c5-18142135d596",
			"stage_3ba1d60c-0025-44f2-af97-cdb30469c746",
			"mute_0593e376-9439-4307-ba58-a0c9abe77c72",
			"hand_91afcbbb-7ad6-491d-bfa1-6eff8b59e700",
			"mute_a2e94438-7fb7-4d8b-94e5-891d4b56114a",
			"leave_9197c0c3-a2cb-41ac-b2be-e940dfebbe25",
		],
	},
	seq: 8,
};

/** `call_join` for the second recorded room, which is then ended. */
export const END_ROOM_JOIN_SNAPSHOT: HostMessage = {
	type: "room_snapshot",
	roomId: "presence-fixture-narration",
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture-narration",
		createdAt: "2026-08-03T15:12:37.326Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [
					{
						kind: "manual",
					},
				],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: "drive:partner",
			},
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": true,
		},
		raisedHandByParticipantId: {},
		appliedEventIds: [
			"join_2a322e64-f361-45e9-a214-8c72443000f2",
			"join_39a8a741-7620-4ee3-a01d-42d2fb784ec2",
			"mode_b09d67d4-dd6c-4eea-855d-0c50fee890b1",
			"stage_c774c073-887f-40a2-a475-e1d099f127ae",
		],
	},
	seq: 4,
};

/** `call_end` handoff narration, minted while the human is still seated. */
export const NARRATION_DRIVE_EVENT: HostMessage = {
	type: "drive_event",
	roomId: "presence-fixture-narration",
	event: {
		schemaVersion: 1,
		id: "narration_ad919c0b-0aa2-4879-a7cf-d731e872ca8e",
		roomId: "presence-fixture-narration",
		at: "2026-08-03T15:12:37.352Z",
		actorId: "drive:human",
		callSessionId: "cs_dd8f0b25-abeb-4fb5-b8ba-8400b82ddc5c",
		type: "conversation.narration",
		track: "conversation",
		text: "Session handoff: Done: (none). Open: (none).",
	},
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture-narration",
		createdAt: "2026-08-03T15:12:37.326Z",
		driveActive: true,
		subMode: "act",
		participants: [
			{
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [
					{
						kind: "manual",
					},
				],
			},
		],
		stage: {
			sharer: {
				kind: "agent",
				participantId: "drive:partner",
			},
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": true,
		},
		raisedHandByParticipantId: {},
		appliedEventIds: [
			"join_2a322e64-f361-45e9-a214-8c72443000f2",
			"join_39a8a741-7620-4ee3-a01d-42d2fb784ec2",
			"mode_b09d67d4-dd6c-4eea-855d-0c50fee890b1",
			"stage_c774c073-887f-40a2-a475-e1d099f127ae",
			"narration_ad919c0b-0aa2-4879-a7cf-d731e872ca8e",
		],
	},
	seq: 5,
};

/** `call_end` close — driveActive false and the roster emptied. */
export const END_DRIVE_EVENT: HostMessage = {
	type: "drive_event",
	roomId: "presence-fixture-narration",
	event: {
		schemaVersion: 1,
		id: "end_bde917e2-2ae7-4ce4-a326-9464cfd6a213",
		roomId: "presence-fixture-narration",
		at: "2026-08-03T15:12:37.353Z",
		actorId: "drive:human",
		callSessionId: "cs_dd8f0b25-abeb-4fb5-b8ba-8400b82ddc5c",
		type: "control.end",
		track: "control",
		durationMs: 27,
	},
	snapshot: {
		schemaVersion: 1,
		roomId: "presence-fixture-narration",
		createdAt: "2026-08-03T15:12:37.326Z",
		driveActive: false,
		subMode: "act",
		participants: [],
		stage: {
			sharer: null,
			pin: null,
			cards: [],
		},
		addressSet: {
			mode: "everyone",
		},
		muteByParticipantId: {
			"drive:human": true,
		},
		raisedHandByParticipantId: {},
		appliedEventIds: [
			"join_2a322e64-f361-45e9-a214-8c72443000f2",
			"join_39a8a741-7620-4ee3-a01d-42d2fb784ec2",
			"mode_b09d67d4-dd6c-4eea-855d-0c50fee890b1",
			"stage_c774c073-887f-40a2-a475-e1d099f127ae",
			"narration_ad919c0b-0aa2-4879-a7cf-d731e872ca8e",
			"end_bde917e2-2ae7-4ce4-a326-9464cfd6a213",
		],
	},
	seq: 6,
};
