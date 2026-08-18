import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShowBacklogItem } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { mintClinePresenterGrant } from "../directorPolicy";
import {
	recordShowBacklogArtifacts,
	resetArtifactLogRetentionCacheForTests,
} from "./artifactEventLog";
import { JsonlRoomEventLog } from "./eventLog";
import { joinCall } from "./join-call";
import { DriveRoomStore, resetDriveRoomStoreForTests } from "./room";

describe("DriveRoomStore", () => {
	it("joins, mutes, sets stage/mode, and leaves while persisting the room", () => {
		const store = new DriveRoomStore();
		store.create("room_1", "2026-07-25T20:00:00.000Z");

		const joined = store.join({
			roomId: "room_1",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			at: "2026-07-25T20:00:01.000Z",
		});
		expect(joined.snapshot.participants).toHaveLength(1);

		store.mute({
			roomId: "room_1",
			participantId: "you",
			muted: true,
			at: "2026-07-25T20:00:02.000Z",
		});
		expect(store.getOrThrow("room_1").muteByParticipantId.you).toBe(true);

		store.raiseHand({
			roomId: "room_1",
			participantId: "you",
			raised: true,
			at: "2026-07-25T20:00:02.500Z",
		});
		expect(store.getOrThrow("room_1").raisedHandByParticipantId.you).toBe(true);

		store.renameParticipant({
			roomId: "room_1",
			participantId: "you",
			displayName: "Ada",
			at: "2026-07-25T20:00:02.750Z",
		});
		expect(store.getOrThrow("room_1").participants[0]?.displayName).toBe("Ada");

		store.setStage({
			roomId: "room_1",
			sharer: { kind: "human", participantId: "you" },
			pin: { kind: "file", label: "router.ts" },
			at: "2026-07-25T20:00:03.000Z",
		});
		expect(store.getOrThrow("room_1").stage.sharer?.participantId).toBe("you");
		expect(store.getOrThrow("room_1").stage.pin?.kind).toBe("file");
		expect(store.getOrCreateLive("room_1").spotlightParticipantId).toBe("you");
		expect(
			store.getOrCreateLive("room_1").director.spotlightParticipantId,
		).toBe("you");

		store.setMode({
			roomId: "room_1",
			subMode: "ask",
			driveActive: true,
			at: "2026-07-25T20:00:04.000Z",
		});
		expect(store.getOrThrow("room_1").subMode).toBe("ask");
		expect(store.getOrThrow("room_1").driveActive).toBe(true);

		store.leave({
			roomId: "room_1",
			participantId: "you",
			at: "2026-07-25T20:00:05.000Z",
		});
		const afterLeave = store.getOrThrow("room_1");
		expect(afterLeave.participants).toHaveLength(0);
		expect(afterLeave.driveActive).toBe(true);
	});

	it("mints callSessionId on join, reuses while open, and closes with durationMs", () => {
		const store = new DriveRoomStore();
		store.create("room_cs", "2026-07-30T10:00:00.000Z");
		const first = store.join({
			roomId: "room_cs",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			at: "2026-07-30T10:00:01.000Z",
		});
		expect(first.event.callSessionId).toBeTruthy();
		const sessionId = first.event.callSessionId;
		if (!sessionId) {
			throw new Error("expected a callSessionId on first join");
		}
		expect(store.getActiveCallSessionId("room_cs")).toBe(sessionId);

		const partner = store.join({
			roomId: "room_cs",
			participant: {
				id: "partner",
				kind: "agent",
				displayName: "Partner",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
			at: "2026-07-30T10:00:02.000Z",
		});
		expect(partner.event.callSessionId).toBe(sessionId);

		const leftPartner = store.leave({
			roomId: "room_cs",
			participantId: "partner",
			at: "2026-07-30T10:00:03.000Z",
		});
		expect(leftPartner.event.type).toBe("control.leave");
		if (leftPartner.event.type === "control.leave") {
			expect(leftPartner.event.durationMs).toBeUndefined();
		}
		expect(store.getActiveCallSessionId("room_cs")).toBe(sessionId);

		const leftHuman = store.leave({
			roomId: "room_cs",
			participantId: "you",
			at: "2026-07-30T10:05:01.000Z",
		});
		expect(leftHuman.event.type).toBe("control.leave");
		if (leftHuman.event.type === "control.leave") {
			expect(leftHuman.event.callSessionId).toBe(sessionId);
			expect(leftHuman.event.durationMs).toBe(300_000);
		}
		expect(store.getActiveCallSessionId("room_cs")).toBeUndefined();

		const rejoined = store.join({
			roomId: "room_cs",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			at: "2026-07-30T11:00:00.000Z",
		});
		expect(rejoined.event.callSessionId).toBeTruthy();
		expect(rejoined.event.callSessionId).not.toBe(sessionId);
	});

	it("end closes roster and is idempotent; leave persists participants elsewhere", () => {
		const store = new DriveRoomStore();
		store.create("room_end", "2026-07-30T12:00:00.000Z");
		store.join({
			roomId: "room_end",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			at: "2026-07-30T12:00:01.000Z",
		});
		store.join({
			roomId: "room_end",
			participant: {
				id: "partner",
				kind: "agent",
				displayName: "Partner",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
			at: "2026-07-30T12:00:02.000Z",
		});
		store.setMode({
			roomId: "room_end",
			subMode: "act",
			driveActive: true,
			at: "2026-07-30T12:00:03.000Z",
		});

		const first = store.end({
			roomId: "room_end",
			actorId: "you",
			at: "2026-07-30T12:10:01.000Z",
		});
		expect(first.event.type).toBe("control.end");
		if (first.event.type === "control.end") {
			expect(first.event.durationMs).toBe(600_000);
		}
		const afterEnd = store.getOrThrow("room_end");
		expect(afterEnd.participants).toHaveLength(0);
		expect(afterEnd.driveActive).toBe(false);
		expect(store.getActiveCallSessionId("room_end")).toBeUndefined();
		expect(store.isEnded("room_end")).toBe(true);

		const second = store.end({
			roomId: "room_end",
			actorId: "you",
			at: "2026-07-30T12:11:00.000Z",
		});
		expect(second.event.id).toBe(first.event.id);
		expect(second.seq).toBe(first.seq);
	});

	it("syncLiveFromSnapshot always overwrites live spotlight from stage sharer", () => {
		const store = new DriveRoomStore();
		store.create("room_sync");
		store.join({
			roomId: "room_sync",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
		});
		store.join({
			roomId: "room_sync",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Cline",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		store.grantTitle({
			roomId: "room_sync",
			grant: mintClinePresenterGrant({
				roomId: "room_sync",
				agentId: "adam",
			}),
		});
		store.setStage({
			roomId: "room_sync",
			sharer: { kind: "agent", participantId: "adam" },
		});
		expect(store.getOrCreateLive("room_sync").spotlightParticipantId).toBe(
			"adam",
		);

		// Simulate a divergent live spotlight (pre-converge / dual-write race).
		const live = store.getOrCreateLive("room_sync");
		store.setLive({
			...live,
			spotlightParticipantId: "you",
			director: { ...live.director, spotlightParticipantId: "you" },
		});
		expect(store.getOrCreateLive("room_sync").spotlightParticipantId).toBe(
			"you",
		);

		store.setStage({
			roomId: "room_sync",
			sharer: { kind: "agent", participantId: "adam" },
			pin: null,
		});
		const synced = store.getOrCreateLive("room_sync");
		expect(synced.spotlightParticipantId).toBe("adam");
		expect(synced.director.spotlightParticipantId).toBe("adam");
	});

	it("is idempotent on re-join of the same participant id", () => {
		const store = new DriveRoomStore();
		const participant = {
			id: "adam",
			kind: "agent" as const,
			displayName: "Cline",
			role: "partner" as const,
			status: "idle" as const,
			seatSources: [],
		};
		store.create("room_2");
		store.join({ roomId: "room_2", participant });
		store.join({
			roomId: "room_2",
			participant: { ...participant, displayName: "Cline II" },
		});
		const snapshot = store.getOrThrow("room_2");
		expect(snapshot.participants).toHaveLength(1);
		expect(snapshot.participants[0]?.displayName).toBe("Cline II");
	});

	it("recordWork upserts stage.cards from edit and command", () => {
		const store = new DriveRoomStore();
		store.create("room_work", "2026-07-26T10:00:00.000Z");
		store.recordWork({
			roomId: "room_work",
			work: {
				kind: "edit",
				path: "src/router.ts",
				summary: "route /drive",
			},
			at: "2026-07-26T10:00:01.000Z",
			eventId: "work_edit_1",
		});
		store.recordWork({
			roomId: "room_work",
			work: {
				kind: "command",
				command: "bun test",
				failed: false,
			},
			at: "2026-07-26T10:00:02.000Z",
			eventId: "work_cmd_1",
		});
		const cards = store.getOrThrow("room_work").stage.cards;
		expect(cards.map((c) => c.category).sort()).toEqual(["command", "edit"]);
		expect(cards.find((c) => c.category === "edit")?.title).toBe(
			"src/router.ts",
		);
		expect(cards.find((c) => c.category === "command")?.title).toBe("bun test");
	});

	it("links sessionId to room for the work bridge", () => {
		const store = new DriveRoomStore();
		store.create("room_link");
		store.linkSession("sess_1", "room_link");
		expect(store.getRoomIdForSession("sess_1")).toBe("room_link");
		store.unlinkSession("sess_1");
		expect(store.getRoomIdForSession("sess_1")).toBeUndefined();
	});

	it("setAddress commits control.address onto the snapshot", () => {
		const store = new DriveRoomStore();
		store.create("room_addr");
		store.setAddress({
			roomId: "room_addr",
			addressSet: { mode: "agents", agentIds: ["adam"] },
		});
		expect(store.getOrThrow("room_addr").addressSet).toEqual({
			mode: "agents",
			agentIds: ["adam"],
		});
	});
});

describe("joinCall", () => {
	it("seats host + pair partner and activates agent stage", () => {
		resetDriveRoomStoreForTests();
		const first = joinCall({
			roomId: "call_1",
			human: { id: "you", displayName: "You" },
			agent: { id: "adam", displayName: "Cline" },
		});
		expect(first.created).toBe(true);
		expect(first.snapshot.participants.map((p) => p.id).sort()).toEqual([
			"adam",
			"you",
		]);
		expect(first.snapshot.driveActive).toBe(true);
		expect(first.snapshot.stage.sharer).toEqual({
			kind: "agent",
			participantId: "adam",
		});
		expect(
			Object.values(first.snapshot.titleGrantsById).filter(
				(grant) => grant.revokedAt === undefined,
			),
		).toHaveLength(1);

		const second = joinCall({
			roomId: "call_1",
			human: { id: "you", displayName: "You" },
			agent: { id: "adam", displayName: "Cline" },
		});
		expect(second.created).toBe(false);
		expect(second.snapshot.participants).toHaveLength(2);
	});
});

describe("DriveRoomStore artifact rehydrate", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		resetArtifactLogRetentionCacheForTests();
	});

	function scratch(): string {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-artifacts-"));
		dirs.push(dir);
		return dir;
	}

	function artifact(overrides: Partial<ShowBacklogItem> = {}): ShowBacklogItem {
		return {
			id: "show_arch",
			ownerParticipantId: "adam",
			title: "Architecture",
			intent: "orient the room",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			uri: "data:image/svg+xml;base64,PHN2Zy8+",
			caption: "Three lanes",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; log-->live" },
			},
			priority: 5,
			status: "showing",
			scoreReasons: [],
			...overrides,
		};
	}

	function seedRoom(dir: string, roomId: string): void {
		const store = new DriveRoomStore();
		store.attachEventLog(new JsonlRoomEventLog(dir));
		store.create(roomId);
		store.join({
			roomId,
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
		});
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId,
			before: [],
			after: [artifact()],
		});
	}

	it("rebuilds the show backlog from the corpus after the room stops", () => {
		const dir = scratch();
		seedRoom(dir, "r1");

		// Hub restart: a brand-new store, nothing but the logs on disk.
		const restarted = new DriveRoomStore();
		restarted.attachEventLog(new JsonlRoomEventLog(dir));
		expect(restarted.getOrCreateLive("r1").director.showBacklog).toHaveLength(
			0,
		);

		const snapshot = restarted.hydrateFromLogSync("r1");
		expect(snapshot?.participants).toHaveLength(1);

		const backlog = restarted.getOrCreateLive("r1").director.showBacklog;
		expect(backlog).toHaveLength(1);
		expect(backlog[0]?.id).toBe("show_arch");
		expect(backlog[0]?.title).toBe("Architecture");
		expect(backlog[0]?.uri).toBeUndefined();
		expect(backlog[0]?.produce.args.mermaidSource).toBe("graph TD; log-->live");
	});

	it("rebuilds the backlog on the async hydrate path too", async () => {
		const dir = scratch();
		seedRoom(dir, "r1");

		const restarted = new DriveRoomStore();
		restarted.attachEventLog(new JsonlRoomEventLog(dir));
		await restarted.hydrateFromLog("r1");

		expect(
			restarted.getOrCreateLive("r1").director.showBacklog.map((i) => i.id),
		).toEqual(["show_arch"]);
	});

	it("restores only the hydrated room's artifacts", () => {
		const dir = scratch();
		seedRoom(dir, "r1");
		recordShowBacklogArtifacts({
			configParent: dir,
			roomId: "r2",
			before: [],
			after: [artifact({ id: "show_other" })],
		});

		const restarted = new DriveRoomStore();
		restarted.attachEventLog(new JsonlRoomEventLog(dir));
		restarted.hydrateFromLogSync("r1");

		expect(
			restarted.getOrCreateLive("r1").director.showBacklog.map((i) => i.id),
		).toEqual(["show_arch"]);
	});

	it("keeps live backlog items when hydrating a room that already has them", () => {
		const dir = scratch();
		seedRoom(dir, "r1");

		const restarted = new DriveRoomStore();
		restarted.attachEventLog(new JsonlRoomEventLog(dir));
		const live = restarted.getOrCreateLive("r1");
		const inFlight = artifact({ id: "show_arch", title: "Live title" });
		restarted.setLive({
			...live,
			director: { ...live.director, showBacklog: [inFlight] },
		});

		restarted.hydrateFromLogSync("r1");

		const backlog = restarted.getOrCreateLive("r1").director.showBacklog;
		expect(backlog).toHaveLength(1);
		expect(backlog[0]?.title).toBe("Live title");
	});

	it("restores nothing when no workspace root owns the corpus", () => {
		const store = new DriveRoomStore();
		store.create("r1");
		store.join({
			roomId: "r1",
			participant: {
				id: "you",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
		});
		const restarted = new DriveRoomStore();
		restarted.hydrateFromLogSync("r1");
		expect(restarted.getOrCreateLive("r1").director.showBacklog).toHaveLength(
			0,
		);
	});
});
