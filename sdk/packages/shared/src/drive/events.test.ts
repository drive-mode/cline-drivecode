import { describe, expect, it } from "vitest";
import {
	DRIVE_EVENT_FORBIDDEN_KEYS,
	DRIVE_SCHEMA_VERSION,
	DriveEventSchema,
	EVERYONE_ADDRESS,
	parseAddressSet,
	parseDriveEvent,
	parseRoomSnapshot,
	type DriveEvent,
} from "./index";

const MEDIA_BYTE_KEYS = [
	"uri",
	"dataUri",
	"svg",
	"image",
	"bytes",
	"thumbnail",
];

const base = {
	schemaVersion: DRIVE_SCHEMA_VERSION,
	id: "evt_1",
	roomId: "room_1",
	at: "2026-07-25T12:00:00.000Z",
	actorId: "user_1",
} as const;

describe("DriveEvent schemas", () => {
	it("parses a versioned control.join event", () => {
		const event = parseDriveEvent({
			...base,
			type: "control.join",
			track: "control",
			participant: {
				id: "user_1",
				kind: "human",
				displayName: "Ada",
				role: "host",
				status: "idle",
			},
		});
		expect(event.type).toBe("control.join");
		expect(event.schemaVersion).toBe(1);
	});

	it("round-trips through JSON", () => {
		const original = parseDriveEvent({
			...base,
			type: "conversation.message",
			track: "conversation",
			text: "hello",
			addressSet: EVERYONE_ADDRESS,
		});
		const roundTripped = parseDriveEvent(
			JSON.parse(JSON.stringify(original)) as unknown,
		);
		expect(roundTripped).toEqual(original);
	});

	it("rejects unversioned payloads", () => {
		expect(() =>
			parseDriveEvent({
				id: "evt_1",
				roomId: "room_1",
				at: "2026-07-25T12:00:00.000Z",
				type: "control.mute",
				track: "control",
				participantId: "user_1",
				muted: true,
			}),
		).toThrow();
	});

	it("rejects wrong schemaVersion", () => {
		expect(() =>
			parseDriveEvent({
				...base,
				schemaVersion: 99,
				type: "control.mute",
				track: "control",
				participantId: "user_1",
				muted: true,
			}),
		).toThrow();
	});

	it("supports addressSet on messages and control.address", () => {
		const message = parseDriveEvent({
			...base,
			type: "conversation.message",
			track: "conversation",
			text: "only for partner",
			addressSet: { mode: "agents", agentIds: ["agent_partner"] },
		});
		expect(message.type).toBe("conversation.message");
		if (message.type === "conversation.message") {
			expect(message.addressSet).toEqual({
				mode: "agents",
				agentIds: ["agent_partner"],
			});
		}

		const address = parseDriveEvent({
			...base,
			id: "evt_2",
			type: "control.address",
			track: "control",
			addressSet: { mode: "pack", packId: "pack_review" },
		});
		expect(address.type).toBe("control.address");
	});

	it("compiles an exhaustive switch over DriveEvent.type", () => {
		const event = parseDriveEvent({
			...base,
			type: "work.plan_step",
			track: "work",
			title: "Ship schemas",
			status: "in_progress",
		});

		const label = (e: DriveEvent): string => {
			switch (e.type) {
				case "control.join":
				case "control.leave":
				case "control.end":
				case "control.mute":
				case "control.stage":
				case "control.mode":
				case "control.raise_hand":
				case "control.rename":
				case "control.address":
					return "control";
				case "conversation.message":
				case "conversation.narration":
					return "conversation";
				case "work.edit":
				case "work.command":
				case "work.test_result":
				case "work.plan_step":
				case "work.decision":
					return "work";
				case "presence.speaking":
				case "presence.typing":
				case "presence.status":
					return "presence";
				case "media.artifact":
					return "media";
				default: {
					const _exhaustive: never = e;
					return _exhaustive;
				}
			}
		};

		expect(label(event)).toBe("work");
	});
});

describe("Room / address schemas", () => {
	it("parses a room snapshot with stage sharer and addressSet", () => {
		const room = parseRoomSnapshot({
			schemaVersion: 1,
			roomId: "room_1",
			createdAt: "2026-07-25T12:00:00.000Z",
			driveActive: true,
			subMode: "plan",
			participants: [
				{
					id: "user_1",
					kind: "human",
					displayName: "Ada",
					role: "host",
					status: "idle",
				},
				{
					id: "agent_1",
					kind: "agent",
					displayName: "Partner",
					role: "partner",
					status: "idle",
					seatSources: [],
				},
			],
			stage: {
				sharer: { kind: "agent", participantId: "agent_1" },
				pin: null,
				cards: [],
			},
			addressSet: EVERYONE_ADDRESS,
			muteByParticipantId: {},
			raisedHandByParticipantId: {},
			appliedEventIds: [],
		});
		expect(room.stage.sharer?.participantId).toBe("agent_1");
	});

	it("parses address sets including reserved pack mode", () => {
		expect(parseAddressSet({ mode: "everyone" })).toEqual(EVERYONE_ADDRESS);
		expect(
			parseAddressSet({ mode: "agents", agentIds: ["a1"] }),
		).toEqual({ mode: "agents", agentIds: ["a1"] });
		expect(parseAddressSet({ mode: "pack", packId: "p1" })).toEqual({
			mode: "pack",
			packId: "p1",
		});
		expect(() =>
			parseAddressSet({ mode: "agents", agentIds: [] }),
		).toThrow();
	});
});

describe("media.artifact", () => {
	const artifact = {
		...base,
		id: "evt_artifact",
		type: "media.artifact",
		track: "media",
		showItemId: "show-abc123",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		title: "Cline drive topology",
		caption: "Hub daemon is the single writer",
		ownerParticipantId: "agent_partner",
		produce: {
			tool: "render_mermaid",
			templateId: "kit.arch.cline_drive",
			args: { mermaidSource: "flowchart LR\n  A --> B" },
		},
		tags: ["architecture", "hub"],
		status: "shown",
	} as const;

	it("parses a bytes-free artifact record", () => {
		const event = parseDriveEvent(artifact);
		expect(event.type).toBe("media.artifact");
		if (event.type !== "media.artifact") {
			throw new Error("expected media.artifact");
		}
		expect(event.track).toBe("media");
		expect(event.showItemId).toBe("show-abc123");
		expect(event.artifactKind).toBe("diagram.architecture");
		expect(event.tags).toEqual(["architecture", "hub"]);
		expect(event.produce.args).toEqual({
			mermaidSource: "flowchart LR\n  A --> B",
		});
	});

	it("round-trips through JSON", () => {
		const original = parseDriveEvent(artifact);
		expect(parseDriveEvent(JSON.parse(JSON.stringify(original)))).toEqual(
			original,
		);
	});

	it("rejects the data-uri field the producers build", () => {
		const result = DriveEventSchema.safeParse({
			...artifact,
			uri: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
		});
		expect(result.success).toBe(false);
	});

	it("rejects artifact bytes smuggled through produce.args", () => {
		const result = DriveEventSchema.safeParse({
			...artifact,
			produce: {
				...artifact.produce,
				args: {
					mermaidSource: "flowchart LR\n  A --> B",
					dataUri: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
				},
			},
		});
		expect(result.success).toBe(false);
	});

	it("accepts a tagless artifact but rejects an empty tag", () => {
		const { tags: _tags, ...untagged } = artifact;
		expect(DriveEventSchema.safeParse(untagged).success).toBe(true);
		expect(
			DriveEventSchema.safeParse({ ...artifact, tags: [""] }).success,
		).toBe(false);
	});
});

describe("privacy gate", () => {
	it("forbids the media byte keys the producers populate", () => {
		for (const key of MEDIA_BYTE_KEYS) {
			expect(DRIVE_EVENT_FORBIDDEN_KEYS).toContain(key);
		}
	});

	it("does not accept forbidden audio / transcript payload fields", () => {
		for (const key of DRIVE_EVENT_FORBIDDEN_KEYS) {
			const result = DriveEventSchema.safeParse({
				...base,
				type: "conversation.message",
				track: "conversation",
				text: "hi",
				[key]: "should-not-be-allowed",
			});
			expect(result.success).toBe(false);
		}
	});

	it("rejects payloads that smuggle audio under an allowed envelope", () => {
		const result = DriveEventSchema.safeParse({
			...base,
			type: "presence.speaking",
			track: "presence",
			participantId: "user_1",
			speaking: true,
			audio: { pcm: [0, 1, 2] },
			transcript: "secret full transcript",
		});
		expect(result.success).toBe(false);
	});
});
