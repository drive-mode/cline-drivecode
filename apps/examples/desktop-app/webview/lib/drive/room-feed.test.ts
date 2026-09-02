import type { DriveEvent, Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { DriveHubEvent } from "./drive-client";
import {
	appendRoomFeedItem,
	filterRoomFeed,
	mergeRoomFeed,
	participantNames,
	ROOM_FEED_LIMIT,
	roomFeedGroup,
	roomFeedItemFromDriveEvent,
	roomFeedItemFromHubEvent,
	roomFeedSyncItem,
} from "./room-feed";
import type { DriveFeedEntry } from "./room-state";

const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const ROOM = "router-fix";

const roster: Participant[] = [
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
		displayName: "Cline",
		role: "partner",
		status: "working",
		seatSources: [],
	},
	{
		id: "agent:riley",
		kind: "agent",
		displayName: "Riley",
		role: "specialist",
		status: "working",
		seatSources: [],
	},
];
const names = participantNames(roster);

function control<T extends DriveEvent>(event: T): T {
	return event;
}

const base = { schemaVersion: 1 as const, roomId: ROOM };

describe("roomFeedItemFromDriveEvent", () => {
	it("narrates join, leave and end", () => {
		const join = roomFeedItemFromDriveEvent(
			control({
				...base,
				type: "control.join",
				track: "control",
				id: "e1",
				at: iso(0),
				participant: roster[2] as Participant,
			}),
			names,
		);
		expect(join).toMatchObject({
			id: "e1",
			kind: "join",
			group: "room",
			participantId: "agent:riley",
			text: "Riley joined as specialist",
		});
		const leave = roomFeedItemFromDriveEvent(
			control({
				...base,
				type: "control.leave",
				track: "control",
				id: "e2",
				at: iso(1),
				participantId: "agent:riley",
				reason: "timeout",
			}),
			names,
		);
		expect(leave).toMatchObject({
			kind: "leave",
			text: "Riley left the call",
			detail: "timeout",
		});
		const end = roomFeedItemFromDriveEvent(
			control({
				...base,
				type: "control.end",
				track: "control",
				id: "e3",
				at: iso(2),
				actorId: "drive:human",
			}),
			names,
		);
		expect(end).toMatchObject({ kind: "end", text: "You ended the call" });
	});

	it("narrates mode, address and stage with the pin as detail", () => {
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.mode",
					track: "control",
					id: "m",
					at: iso(0),
					subMode: "plan",
				}),
				names,
			),
		).toMatchObject({ kind: "mode", text: "Mode set to plan" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.mode",
					track: "control",
					id: "m2",
					at: iso(0),
					subMode: "act",
					driveActive: false,
				}),
				names,
			),
		).toMatchObject({ text: "Drive paused" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.address",
					track: "control",
					id: "a",
					at: iso(0),
					addressSet: {
						mode: "agents",
						agentIds: ["agent:riley", "drive:partner"],
					},
				}),
				names,
			),
		).toMatchObject({ kind: "address", text: "Now addressing Riley + Cline" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.stage",
					track: "control",
					id: "s",
					at: iso(0),
					sharer: { kind: "human", participantId: "drive:human" },
					pin: { kind: "selection", label: "router.ts · scheduleRetry" },
				}),
				names,
			),
		).toMatchObject({
			kind: "stage",
			participantId: "drive:human",
			text: "You took the Spotlight",
			detail: "selection · router.ts · scheduleRetry",
		});
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.stage",
					track: "control",
					id: "s2",
					at: iso(0),
					sharer: null,
				}),
				names,
			),
		).toMatchObject({ text: "Spotlight cleared", participantId: null });
	});

	it("narrates titles, hands, mutes and work", () => {
		const grant = {
			id: "g1",
			agentId: "agent:riley",
			title: "presenter" as const,
			scope: { kind: "stage" as const, ref: ROOM },
			skillBundleRefs: [],
			resourceGrantRefs: [],
			delegatedAgentIds: [],
			permissions: ["stage.present" as const],
			grantedAt: iso(0),
			expiresAt: iso(60_000),
		};
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.title_granted",
					track: "control",
					id: "t1",
					at: iso(0),
					grant,
				}),
				names,
			),
		).toMatchObject({ kind: "title", text: "Riley granted presenter" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.title_transferred",
					track: "control",
					id: "t2",
					at: iso(0),
					title: "presenter",
					fromGrantId: "g0",
					toGrant: grant,
					transferredAt: iso(0),
				}),
				names,
			),
		).toMatchObject({ text: "presenter transferred to Riley" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.title_revoked",
					track: "control",
					id: "t3",
					at: iso(0),
					grantId: "g1",
					revokedAt: iso(0),
					reason: "expired",
				}),
				names,
			),
		).toMatchObject({ text: "A title expired" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.raise_hand",
					track: "control",
					id: "h",
					at: iso(0),
					participantId: "drive:human",
					raised: true,
				}),
				names,
			),
		).toMatchObject({ kind: "hand", text: "You raised a hand" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "control.mute",
					track: "control",
					id: "mu",
					at: iso(0),
					participantId: "drive:partner",
					muted: true,
				}),
				names,
			),
		).toMatchObject({ kind: "mute", text: "Cline muted" });
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "work.command",
					track: "work",
					id: "w",
					at: iso(0),
					actorId: "agent:riley",
					command: "bun test",
					failed: true,
				}),
				names,
			),
		).toMatchObject({
			kind: "work",
			text: "Riley ran a command — failed",
			detail: "bun test",
		});
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "work.decision",
					track: "work",
					id: "d",
					at: iso(0),
					actorId: "unknown:agent",
					title: "Guard lives in scheduleRetry",
					choice: "One place owns the flag.",
				}),
				names,
			),
		).toMatchObject({
			text: "unknown:agent decided: Guard lives in scheduleRetry",
		});
	});

	it("ignores conversation, presence and media events", () => {
		expect(
			roomFeedItemFromDriveEvent(
				control({
					...base,
					type: "conversation.narration",
					track: "conversation",
					id: "n",
					at: iso(0),
					text: "hi",
				}),
				names,
			),
		).toBeNull();
	});
});

describe("roomFeedItemFromHubEvent", () => {
	it("reads room.event and drive.show.presented, nothing else", () => {
		const roomEvent: DriveHubEvent = {
			event: "room.event",
			payload: {
				roomId: ROOM,
				event: {
					...base,
					type: "control.mode",
					track: "control",
					id: "m",
					at: iso(0),
					subMode: "ask",
				},
			},
		};
		expect(roomFeedItemFromHubEvent(roomEvent, names)).toMatchObject({
			kind: "mode",
			text: "Mode set to ask",
		});
		const presented: DriveHubEvent = {
			event: "drive.show.presented",
			payload: {
				showItemId: "show-plan",
				ownerParticipantId: "drive:partner",
				title: "Plan",
			},
			timestamp: iso(5),
		};
		expect(roomFeedItemFromHubEvent(presented, names)).toMatchObject({
			id: `show:show-plan:${iso(5)}`,
			kind: "show",
			participantId: "drive:partner",
			text: "Cline presented “Plan”",
			at: iso(5),
		});
		expect(
			roomFeedItemFromHubEvent({ event: "room.snapshot", payload: {} }, names),
		).toBeNull();
		expect(
			roomFeedItemFromHubEvent(
				{ event: "room.event", payload: { event: { nope: true } } },
				names,
			),
		).toBeNull();
	});
});

describe("mergeRoomFeed", () => {
	const talk: DriveFeedEntry[] = [
		{
			id: "n1",
			kind: "narration",
			participantId: "drive:partner",
			text: "one",
			at: iso(1_000),
		},
		{
			id: "b1",
			kind: "beat",
			participantId: "drive:partner",
			text: "two",
			at: iso(3_000),
		},
	];

	it("interleaves by time with room lines ahead of talk on ties", () => {
		const items = mergeRoomFeed(talk, [
			{
				id: "s",
				kind: "stage",
				group: "room",
				participantId: null,
				text: "stage",
				at: iso(1_000),
			},
			{
				id: "j",
				kind: "join",
				group: "room",
				participantId: null,
				text: "join",
				at: iso(0),
			},
			{
				id: "n1",
				kind: "narration",
				group: "talk",
				participantId: null,
				text: "dupe",
				at: iso(9_000),
			},
		]);
		// The room copy of `n1` was seen first, so its (later) timestamp wins.
		expect(items.map((item) => item.id)).toEqual(["j", "s", "b1", "n1"]);
		expect(items[3]?.text).toBe("dupe");
	});

	it("drops a beat that echoes a narration line, keeping distinct beats", () => {
		const echoed = mergeRoomFeed(
			[
				{
					id: "n",
					kind: "narration",
					participantId: "drive:partner",
					text: "Found the race.",
					at: iso(0),
				},
				{
					id: "b",
					kind: "beat",
					participantId: null,
					text: "Found the race. ",
					at: iso(2_000),
				},
				{
					id: "b2",
					kind: "beat",
					participantId: null,
					text: "Something else.",
					at: iso(3_000),
				},
				{
					id: "b3",
					kind: "beat",
					participantId: null,
					text: "Found the race.",
					at: iso(60_000),
				},
			],
			[],
		);
		expect(echoed.map((item) => item.id)).toEqual(["n", "b2", "b3"]);
	});

	it("caps at the limit keeping the newest", () => {
		const many = Array.from({ length: ROOM_FEED_LIMIT + 5 }, (_, index) => ({
			id: `r${index}`,
			kind: "mode" as const,
			group: "room" as const,
			participantId: null,
			text: String(index),
			at: iso(index * 1000),
		}));
		const items = mergeRoomFeed([], many);
		expect(items).toHaveLength(ROOM_FEED_LIMIT);
		expect(items[0]?.id).toBe("r5");
	});
});

describe("appendRoomFeedItem / filterRoomFeed", () => {
	const item = (
		id: string,
		kind: "mode" | "narration",
		participantId: string | null,
	) => ({
		id,
		kind,
		group: roomFeedGroup(kind),
		participantId,
		text: id,
		at: iso(0),
	});

	it("appends once and caps", () => {
		const one = appendRoomFeedItem([], item("a", "mode", null));
		expect(appendRoomFeedItem(one, item("a", "mode", null))).toHaveLength(1);
		const capped = appendRoomFeedItem(
			[item("x", "mode", null), item("y", "mode", null)],
			item("z", "mode", null),
			2,
		);
		expect(capped.map((entry) => entry.id)).toEqual(["y", "z"]);
	});

	it("filters by group and participant", () => {
		const items = [
			item("a", "mode", null),
			item("b", "narration", "drive:partner"),
			item("c", "narration", "agent:riley"),
		];
		expect(
			filterRoomFeed(items, { filter: "talk" }).map((entry) => entry.id),
		).toEqual(["b", "c"]);
		expect(
			filterRoomFeed(items, { filter: "room" }).map((entry) => entry.id),
		).toEqual(["a"]);
		expect(
			filterRoomFeed(items, {
				filter: "all",
				participantId: "agent:riley",
			}).map((entry) => entry.id),
		).toEqual(["c"]);
	});
});

describe("roomFeedSyncItem", () => {
	it("says what the sync knew", () => {
		expect(
			roomFeedSyncItem({
				roomId: ROOM,
				seq: 12,
				participantCount: 4,
				at: iso(0),
			}),
		).toMatchObject({
			id: `sync:${ROOM}:12`,
			kind: "system",
			text: "Synced with the hub · 4 seats · seq 12",
		});
		expect(
			roomFeedSyncItem({
				roomId: ROOM,
				seq: 1,
				participantCount: 1,
				at: iso(0),
			}).text,
		).toContain("1 seat ·");
	});
});
