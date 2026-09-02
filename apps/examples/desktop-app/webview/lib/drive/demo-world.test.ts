import { activePresenterGrant } from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	createDemoDriveSource,
	DEMO_HUMAN_ID,
	DEMO_PARTNER_ID,
	DEMO_RILEY_ID,
	DEMO_ROOM_ID,
} from "./demo-world";
import type { DriveHubEvent } from "./drive-client";
import { parseDriveCommandError } from "./drive-client";
import {
	applyCallReply,
	applyDriveHubEvent,
	EMPTY_DRIVE_ROOM_STATE,
	selectCallLive,
	selectFeed,
	selectSpotlight,
} from "./room-state";

const FIXED_NOW = "2026-09-01T10:00:00.000Z";

function makeSource() {
	let tickCount = 0;
	const source = createDemoDriveSource({
		now: () => new Date(Date.parse(FIXED_NOW) + tickCount * 1000),
		autoTick: false,
	});
	return {
		source,
		advanceClock: () => {
			tickCount += 1;
		},
	};
}

describe("demo world", () => {
	it("seats You, Cline, Riley and Sam with Cline presenting", async () => {
		const { source } = makeSource();
		expect(source.kind).toBe("demo");
		const status = await source.hubStatus();
		expect(status.connected).toBe(true);

		const reply = await source.call("call_get_room", DEMO_ROOM_ID);
		expect(reply.roomId).toBe(DEMO_ROOM_ID);
		expect(reply.snapshot.participants.map((p) => p.displayName)).toEqual([
			"You",
			"Cline",
			"Riley",
			"Sam",
		]);
		expect(reply.snapshot.driveActive).toBe(true);
		expect(reply.snapshot.stage.sharer).toEqual({
			kind: "agent",
			participantId: DEMO_PARTNER_ID,
		});
		expect(reply.snapshot.stage.cards.map((card) => card.category)).toEqual([
			"edit",
			"command",
			"test",
		]);
		const grant = activePresenterGrant(reply.snapshot, FIXED_NOW);
		expect(grant?.agentId).toBe(DEMO_PARTNER_ID);
		expect(reply.snapshot.createdAt).toBe("2026-09-01T09:52:00.000Z");
	});

	it("is deterministic for the same clock", async () => {
		const a = await makeSource().source.call("call_get_room", DEMO_ROOM_ID);
		const b = await makeSource().source.call("call_get_room", DEMO_ROOM_ID);
		expect(a.snapshot).toEqual(b.snapshot);
	});

	it("folds call ops through reduceRoom and broadcasts them", async () => {
		const { source } = makeSource();
		const events: DriveHubEvent[] = [];
		source.subscribe((event) => events.push(event));

		let state = applyCallReply(
			EMPTY_DRIVE_ROOM_STATE,
			await source.call("call_get_room", DEMO_ROOM_ID),
		);
		expect(selectCallLive(state)).toBe(true);

		await source.call("call_mute", DEMO_ROOM_ID, {
			participantId: DEMO_HUMAN_ID,
			muted: false,
		});
		for (const event of events.splice(0)) {
			state = applyDriveHubEvent(state, event);
		}
		expect(state.snapshot?.muteByParticipantId[DEMO_HUMAN_ID]).toBe(false);
		expect(state.needsResync).toBe(false);

		await source.call("call_set_stage", DEMO_ROOM_ID, {
			sharer: { kind: "human", participantId: DEMO_HUMAN_ID },
			pin: { kind: "file", label: "router.ts" },
		});
		for (const event of events.splice(0)) {
			state = applyDriveHubEvent(state, event);
		}
		expect(selectSpotlight(state, FIXED_NOW).sharer?.participantId).toBe(
			DEMO_HUMAN_ID,
		);
		expect(state.spotlight?.to).toBe(DEMO_HUMAN_ID);

		await source.call("call_leave", DEMO_ROOM_ID, {
			participantId: DEMO_HUMAN_ID,
		});
		for (const event of events.splice(0)) {
			state = applyDriveHubEvent(state, event);
		}
		expect(selectCallLive(state)).toBe(false);

		const rejoin = await source.call("call_join", DEMO_ROOM_ID, {
			human: { id: DEMO_HUMAN_ID, displayName: "You" },
			agent: { id: DEMO_PARTNER_ID, displayName: "Cline" },
		});
		expect(rejoin.whileAwayNote).toContain("While you were away");
		state = applyCallReply(state, rejoin);
		expect(selectCallLive(state)).toBe(true);

		const ended = await source.call("call_end", DEMO_ROOM_ID);
		expect(ended.ended).toBe(true);
		expect(ended.handoffNarration).toContain("Stopping here");
		expect(ended.snapshot.participants).toEqual([]);
		expect(source.paused).toBe(true);
	});

	it("grants, transfers and revokes Presenter with the hub's exclusivity", async () => {
		const { source } = makeSource();
		await expect(
			source.command("drive.presenter.grant", {
				roomId: DEMO_ROOM_ID,
				agentId: DEMO_RILEY_ID,
			}),
		).rejects.toThrow(/presenter_exclusive/);

		const transferred = await source.command<{
			presenter: { agentId: string } | null;
		}>("drive.presenter.transfer", {
			roomId: DEMO_ROOM_ID,
			agentId: DEMO_RILEY_ID,
		});
		expect(transferred.presenter?.agentId).toBe(DEMO_RILEY_ID);
		expect(source.snapshot().stage.sharer?.participantId).toBe(DEMO_RILEY_ID);

		const revoked = await source.command<{ presenter: unknown }>(
			"drive.presenter.revoke",
			{ roomId: DEMO_ROOM_ID },
		);
		expect(revoked.presenter).toBeNull();
		expect(source.snapshot().stage.sharer).toBeNull();
		expect(source.snapshot().stage.presenterGrantId).toBeNull();

		const regranted = await source.command<{
			presenter: { agentId: string } | null;
		}>("drive.presenter.grant", {
			roomId: DEMO_ROOM_ID,
			agentId: DEMO_PARTNER_ID,
		});
		expect(regranted.presenter?.agentId).toBe(DEMO_PARTNER_ID);
	});

	it("loops scripted beats, presents artifacts and honours pause", async () => {
		const { source, advanceClock } = makeSource();
		const events: DriveHubEvent[] = [];
		source.subscribe((event) => events.push(event));
		let state = applyCallReply(
			EMPTY_DRIVE_ROOM_STATE,
			await source.call("call_get_room", DEMO_ROOM_ID),
		);

		source.tick();
		advanceClock();
		source.tick();
		for (const event of events.splice(0)) {
			state = applyDriveHubEvent(state, event);
		}
		expect(source.beatIndex).toBe(2);
		expect(state.beats.map((beat) => beat.beatId)).toEqual([
			"beat-race",
			"beat-guard",
		]);
		expect(state.presentedShow?.showItemId).toBe("show-retry-path");
		expect(state.presentedShow?.artifactKind).toBe("diagram.architecture");
		expect(state.presentedShow?.uri?.startsWith("data:image/svg+xml")).toBe(
			true,
		);
		expect(state.live?.director.activeBeatId).toBe("beat-guard");
		expect(
			selectFeed(state).filter((entry) => entry.kind === "beat"),
		).toHaveLength(2);
		expect(state.needsResync).toBe(false);

		// Six beats loop back to the first one; the human beat pins the Spotlight.
		for (let index = 0; index < 4; index += 1) {
			advanceClock();
			source.tick();
		}
		for (const event of events.splice(0)) {
			state = applyDriveHubEvent(state, event);
		}
		expect(state.beats.at(-1)?.beatId).toBe("beat-commit");
		expect(state.beats.some((beat) => beat.beatId === "beat-handoff")).toBe(
			true,
		);
		expect(selectSpotlight(state, FIXED_NOW).sharer?.participantId).toBe(
			DEMO_PARTNER_ID,
		);

		source.pause();
		expect(source.paused).toBe(true);
		source.resume();
		expect(source.paused).toBe(false);
		source.dispose();
	});

	it("serves rooms, artifacts, status, rollups, homes and profiles", async () => {
		const { source } = makeSource();
		const { rooms } = await source.listRooms();
		expect(rooms.map((room) => [room.roomId, room.status])).toEqual([
			[DEMO_ROOM_ID, "live"],
			["auth-migration", "paused"],
			["docs-refresh", "ended"],
		]);
		expect(rooms[0]?.participantNames).toEqual([
			"You",
			"Cline",
			"Riley",
			"Sam",
		]);
		expect(rooms[0]?.cardCount).toBe(3);

		const artifacts = await source.command<{
			artifacts: { artifactKind: string }[];
			tags: string[];
		}>("drive.artifacts.list", { workspaceRoot: "/anything" });
		expect(artifacts.artifacts.length).toBeGreaterThanOrEqual(6);
		expect(
			new Set(artifacts.artifacts.map((a) => a.artifactKind)).size,
		).toBeGreaterThanOrEqual(5);
		expect(artifacts.tags).toContain("router");
		const routerOnly = await source.command<{ artifacts: unknown[] }>(
			"drive.artifacts.list",
			{ tag: "router" },
		);
		expect(routerOnly.artifacts.length).toBeLessThan(
			artifacts.artifacts.length,
		);

		const board = await source.status<{ updates: { subject: string }[] }>(
			"board",
		);
		expect(board.updates.length).toBeGreaterThan(0);
		const summary = await source.status<{
			summary: { total: number; byState: Record<string, number> };
		}>("summary");
		expect(summary.summary.total).toBe(board.updates.length);
		expect(summary.summary.byState.blocked).toBe(1);

		const tasks = await source.status<{
			teams: unknown[];
			annotations: unknown;
		}>("tasks_snapshot");
		expect(tasks.teams.length).toBeGreaterThan(0);
		expect(tasks.annotations).not.toBeNull();

		const rollups = await source.sessionRollups({ limit: 2 });
		expect(rollups.sessions).toHaveLength(2);

		const homes = await source.agentHome<{ homes: { slug: string }[] }>("list");
		expect(homes.homes.map((home) => home.slug)).toEqual([
			"riley",
			"sam",
			"scribe",
		]);
		const profiles = await source.agentProfiles<{ profiles: { id: string }[] }>(
			"get",
		);
		expect(profiles.profiles.map((profile) => profile.id)).toContain(
			"driveagent.riley",
		);
	});

	it("reports unsupported ops with a parseable code", async () => {
		const { source } = makeSource();
		try {
			await source.call("call_add_roster_pack", DEMO_ROOM_ID, { packId: "x" });
			throw new Error("expected rejection");
		} catch (error) {
			expect(parseDriveCommandError(error)).toEqual({
				code: "not_supported",
				text: "Roster packs are not part of the demo world.",
			});
		}
		await expect(source.call("call_get_room", "elsewhere")).rejects.toThrow(
			/room_not_found/,
		);
	});
});
