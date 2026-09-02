import { createEmptyRoomSnapshot, reduceRoom } from "@cline/drive";
import {
	createEmptyDriveRoomLiveState,
	type DriveEvent,
	type RoomSnapshot,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { DriveHubEvent } from "./drive-client";
import {
	applyCallReply,
	applyDriveHubEvent,
	DRIVE_FEED_LIMIT,
	EMPTY_DRIVE_ROOM_STATE,
	markResyncRequested,
	selectCallLive,
	selectFeed,
	selectRoster,
	selectSpotlight,
} from "./room-state";

const T0 = "2026-09-01T10:00:00.000Z";
const ROOM = "router-fix";

type JoinParticipant = Extract<
	DriveEvent,
	{ type: "control.join" }
>["participant"];

function joinEvent(
	id: string,
	participant: JoinParticipant,
	at = T0,
): DriveEvent {
	return {
		schemaVersion: 1,
		type: "control.join",
		track: "control",
		id,
		roomId: ROOM,
		at,
		participant,
	};
}

function baseSnapshot(): RoomSnapshot {
	let snapshot = createEmptyRoomSnapshot({ roomId: ROOM, createdAt: T0 });
	snapshot = reduceRoom(
		snapshot,
		joinEvent("j1", {
			id: "drive:human",
			kind: "human",
			displayName: "You",
			role: "host",
			status: "idle",
		}),
	);
	snapshot = reduceRoom(
		snapshot,
		joinEvent("j2", {
			id: "drive:partner",
			kind: "agent",
			displayName: "Cline",
			role: "partner",
			status: "idle",
			seatSources: [{ kind: "manual" }],
		}),
	);
	snapshot = reduceRoom(snapshot, {
		schemaVersion: 1,
		type: "control.mode",
		track: "control",
		id: "m1",
		roomId: ROOM,
		at: T0,
		subMode: "act",
		driveActive: true,
	});
	return snapshot;
}

function hubEvent(
	event: string,
	payload: Record<string, unknown>,
	extra: Partial<DriveHubEvent> = {},
): DriveHubEvent {
	return { event, payload, timestamp: T0, ...extra };
}

describe("applyDriveHubEvent", () => {
	it("adopts a room.snapshot and ignores older ones", () => {
		const snapshot = baseSnapshot();
		let state = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("room.snapshot", { roomId: ROOM, snapshot, seq: 5 }),
		);
		expect(state.roomId).toBe(ROOM);
		expect(state.seq).toBe(5);
		expect(state.snapshot?.participants).toHaveLength(2);

		const stale = createEmptyRoomSnapshot({ roomId: ROOM, createdAt: T0 });
		state = applyDriveHubEvent(
			state,
			hubEvent("room.snapshot", { roomId: ROOM, snapshot: stale, seq: 3 }),
		);
		expect(state.seq).toBe(5);
		expect(state.snapshot?.participants).toHaveLength(2);
	});

	it("ignores snapshots for another room once bound", () => {
		const state = applyDriveHubEvent(
			{ ...EMPTY_DRIVE_ROOM_STATE, roomId: ROOM },
			hubEvent("room.snapshot", {
				roomId: "other",
				snapshot: createEmptyRoomSnapshot({ roomId: "other", createdAt: T0 }),
				seq: 1,
			}),
		);
		expect(state.snapshot).toBeNull();
	});

	it("folds a contiguous room.event through reduceRoom", () => {
		const snapshot = baseSnapshot();
		let state = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("room.snapshot", { roomId: ROOM, snapshot, seq: 3 }),
		);
		const mute: DriveEvent = {
			schemaVersion: 1,
			type: "control.mute",
			track: "control",
			id: "mute1",
			roomId: ROOM,
			at: "2026-09-01T10:01:00.000Z",
			participantId: "drive:human",
			muted: true,
		};
		state = applyDriveHubEvent(
			state,
			hubEvent("room.event", { roomId: ROOM, event: mute, seq: 4 }),
		);
		expect(state.seq).toBe(4);
		expect(state.snapshot?.muteByParticipantId["drive:human"]).toBe(true);
		expect(state.needsResync).toBe(false);
		expect(state.lastEventAt).toBe("2026-09-01T10:01:00.000Z");
	});

	it("flags needsResync when a room.event skips ahead of the held seq", () => {
		let state = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("room.snapshot", {
				roomId: ROOM,
				snapshot: baseSnapshot(),
				seq: 3,
			}),
		);
		const narration: DriveEvent = {
			schemaVersion: 1,
			type: "conversation.narration",
			track: "conversation",
			id: "n1",
			roomId: ROOM,
			at: T0,
			actorId: "drive:partner",
			text: "Found the race.",
		};
		state = applyDriveHubEvent(
			state,
			hubEvent("room.event", { roomId: ROOM, event: narration, seq: 9 }),
		);
		expect(state.needsResync).toBe(true);
		expect(state.seq).toBe(9);
		expect(selectFeed(state)).toEqual([
			expect.objectContaining({ kind: "narration", text: "Found the race." }),
		]);
		expect(markResyncRequested(state).needsResync).toBe(false);
	});

	it("flags needsResync for an unparseable event or a missing snapshot", () => {
		const garbage = applyDriveHubEvent(
			{ ...EMPTY_DRIVE_ROOM_STATE, roomId: ROOM, snapshot: baseSnapshot() },
			hubEvent("room.event", { roomId: ROOM, event: { nope: true }, seq: 1 }),
		);
		expect(garbage.needsResync).toBe(true);

		const orphan = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("room.event", {
				roomId: ROOM,
				event: {
					schemaVersion: 1,
					type: "control.mode",
					track: "control",
					id: "m9",
					roomId: ROOM,
					at: T0,
					subMode: "plan",
				},
				seq: 1,
			}),
		);
		expect(orphan.needsResync).toBe(true);
		expect(orphan.roomId).toBe(ROOM);
	});

	it("caps the feed at the newest 200 entries", () => {
		let state = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("room.snapshot", {
				roomId: ROOM,
				snapshot: baseSnapshot(),
				seq: 0,
			}),
		);
		for (let index = 0; index < DRIVE_FEED_LIMIT + 25; index += 1) {
			state = applyDriveHubEvent(
				state,
				hubEvent("room.event", {
					roomId: ROOM,
					event: {
						schemaVersion: 1,
						type: "conversation.message",
						track: "conversation",
						id: `msg-${index}`,
						roomId: ROOM,
						at: T0,
						actorId: "drive:human",
						text: `message ${index}`,
					},
				}),
			);
		}
		const feed = selectFeed(state);
		expect(feed).toHaveLength(DRIVE_FEED_LIMIT);
		expect(feed[0]?.text).toBe("message 25");
		expect(feed.at(-1)?.text).toBe(`message ${DRIVE_FEED_LIMIT + 24}`);
	});

	it("tracks live room, presented show, planned status and beats", () => {
		const live = createEmptyDriveRoomLiveState(ROOM);
		live.director.showBacklog = [
			{
				id: "show-arch",
				ownerParticipantId: "drive:partner",
				title: "Architecture overview",
				intent: "Explain layout",
				artifactKind: "diagram.architecture",
				mediaClass: "still",
				caption: "Hub → backlog → stage",
				produce: { tool: "render_mermaid", args: {} },
				priority: 10,
				status: "ready",
				scoreReasons: [],
			},
		];
		live.director.activeScript = {
			scriptId: "script-1",
			ownerParticipantId: "drive:partner",
			title: "Walkthrough",
			stickyShowIds: ["show-arch"],
			beats: [
				{
					beatId: "b1",
					say: "Here is the layout.",
					showItemId: "show-arch",
					sticky: { mode: "hold" },
					advance: "on_human",
				},
			],
		};
		let state = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("drive.room.changed", { room: live }),
		);
		expect(state.live?.roomId).toBe(ROOM);
		expect(state.showBacklog).toHaveLength(1);

		state = applyDriveHubEvent(
			state,
			hubEvent("drive.show.presented", {
				showItemId: "show-arch",
				ownerParticipantId: "drive:partner",
				uri: "data:image/svg+xml;base64,AAA",
				caption: "Hub → backlog → stage",
				title: "Architecture overview",
			}),
		);
		expect(state.presentedShow).toMatchObject({
			showItemId: "show-arch",
			artifactKind: "diagram.architecture",
			sticky: "hold",
			uri: "data:image/svg+xml;base64,AAA",
		});
		expect(state.showBacklog[0]?.status).toBe("showing");

		state = applyDriveHubEvent(
			state,
			hubEvent("drive.show.planned", {
				showItemId: "show-arch",
				status: "shown",
				title: "Architecture overview",
				priority: 12,
			}),
		);
		expect(state.showBacklog[0]).toMatchObject({
			status: "shown",
			priority: 12,
		});

		state = applyDriveHubEvent(
			state,
			hubEvent("drive.script.beat", {
				beatId: "b1",
				say: "Here is the layout.",
				showItemId: "show-arch",
				stickyShowIds: ["show-arch"],
				activeScriptId: "script-1",
			}),
		);
		expect(state.beats).toHaveLength(1);
		expect(state.presentedShow?.caption).toBe("Here is the layout.");
		expect(selectFeed(state)).toEqual([
			expect.objectContaining({
				kind: "beat",
				participantId: "drive:partner",
				text: "Here is the layout.",
			}),
		]);

		state = applyDriveHubEvent(
			state,
			hubEvent("drive.spotlight.changed", {
				from: "drive:partner",
				to: "drive:human",
				reason: "human",
				via: "call_set_stage",
			}),
		);
		expect(state.spotlight).toMatchObject({
			from: "drive:partner",
			to: "drive:human",
			via: "call_set_stage",
		});
	});

	it("leaves room state alone for unrelated hub events", () => {
		const state = applyDriveHubEvent(
			EMPTY_DRIVE_ROOM_STATE,
			hubEvent("status.updated", { update: { seq: 1 } }),
		);
		expect(state).toBe(EMPTY_DRIVE_ROOM_STATE);
	});
});

describe("applyCallReply", () => {
	it("binds the room, remembers the call session and reads the end flag", () => {
		let state = applyCallReply(
			EMPTY_DRIVE_ROOM_STATE,
			{
				roomId: ROOM,
				snapshot: baseSnapshot(),
				seq: 7,
				callSessionId: "call-1",
				whileAwayNote: "Riley finished the retry test.",
			},
			{ now: T0 },
		);
		expect(state.roomId).toBe(ROOM);
		expect(state.seq).toBe(7);
		expect(state.callSessionId).toBe("call-1");
		expect(state.whileAwayNote).toBe("Riley finished the retry test.");
		expect(selectCallLive(state)).toBe(true);

		state = applyCallReply(state, {
			roomId: ROOM,
			snapshot: baseSnapshot(),
			seq: 8,
			handoffNarration: "Stopping here; the retry path is green.",
			ended: true,
		});
		expect(state.ended).toBe(true);
		expect(state.callSessionId).toBeNull();
		expect(state.handoffNarration).toBe(
			"Stopping here; the retry path is green.",
		);
		expect(selectCallLive(state)).toBe(false);
	});

	it("never lets a reply move the seq backwards and resets on a room switch", () => {
		let state = applyCallReply(EMPTY_DRIVE_ROOM_STATE, {
			roomId: ROOM,
			snapshot: baseSnapshot(),
			seq: 10,
		});
		state = applyCallReply(state, {
			roomId: ROOM,
			snapshot: baseSnapshot(),
			seq: 4,
		});
		expect(state.seq).toBe(10);

		state = applyCallReply(
			{
				...state,
				conversation: [
					{ id: "x", kind: "system", participantId: null, text: "old", at: T0 },
				],
			},
			{
				roomId: "other",
				snapshot: createEmptyRoomSnapshot({ roomId: "other", createdAt: T0 }),
				seq: 1,
			},
		);
		expect(state.roomId).toBe("other");
		expect(state.seq).toBe(1);
		expect(state.conversation).toEqual([]);
	});
});

describe("selectors", () => {
	it("projects the Spotlight with the presenter grant and the roster", () => {
		let snapshot = baseSnapshot();
		snapshot = reduceRoom(snapshot, {
			schemaVersion: 1,
			type: "control.title_granted",
			track: "control",
			id: "g1",
			roomId: ROOM,
			at: T0,
			grant: {
				id: "grant-1",
				agentId: "drive:partner",
				title: "presenter",
				scope: { kind: "stage", ref: ROOM },
				skillBundleRefs: [],
				resourceGrantRefs: [],
				delegatedAgentIds: [],
				permissions: ["stage.present"],
				grantedAt: T0,
				expiresAt: "2026-09-01T12:00:00.000Z",
			},
		});
		snapshot = reduceRoom(snapshot, {
			schemaVersion: 1,
			type: "control.stage",
			track: "control",
			id: "s1",
			roomId: ROOM,
			at: T0,
			sharer: { kind: "agent", participantId: "drive:partner" },
		});
		snapshot = reduceRoom(snapshot, {
			schemaVersion: 1,
			type: "work.edit",
			track: "work",
			id: "w1",
			roomId: ROOM,
			at: T0,
			path: "router.ts",
			summary: "Guard scheduleRetry.",
		});
		const state = applyCallReply(EMPTY_DRIVE_ROOM_STATE, {
			roomId: ROOM,
			snapshot,
		});
		const spotlight = selectSpotlight(state, "2026-09-01T10:30:00.000Z");
		expect(spotlight.sharer).toEqual({
			kind: "agent",
			participantId: "drive:partner",
		});
		expect(spotlight.sharerParticipant?.displayName).toBe("Cline");
		expect(spotlight.cards.map((card) => card.category)).toEqual(["edit"]);
		expect(spotlight.presenterGrant?.id).toBe("grant-1");
		expect(selectRoster(state).map((p) => p.displayName)).toEqual([
			"You",
			"Cline",
		]);
	});

	it("returns an empty Spotlight without a snapshot", () => {
		expect(selectSpotlight(EMPTY_DRIVE_ROOM_STATE)).toEqual({
			sharer: null,
			sharerParticipant: null,
			cards: [],
			pin: null,
			presenterGrant: null,
		});
		expect(selectRoster(EMPTY_DRIVE_ROOM_STATE)).toEqual([]);
	});
});
