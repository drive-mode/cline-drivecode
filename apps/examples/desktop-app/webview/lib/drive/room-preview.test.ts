import { describe, expect, it } from "vitest";
import {
	createDemoDriveSource,
	DEMO_HUMAN_ID,
	DEMO_PARTNER_ID,
	DEMO_ROOM_ID,
} from "./demo-world";
import { DRIVE_DEFAULT_ROOM_ID } from "./drive-ids";
import {
	addressSetLabel,
	driveSubModeLabel,
	formatRemaining,
	projectRoomPreview,
	ROOM_HUB_UNREACHABLE_MESSAGE,
	ROOM_LOOKUP_FOUND,
	ROOM_LOOKUP_NOT_FOUND,
	ROOM_LOOKUP_PENDING,
	ROOM_LOOKUP_TIMED_OUT,
	roomLookupFromError,
	roomPreviewTitle,
} from "./room-preview";
import {
	applyCallReply,
	type DriveRoomState,
	resetDriveRoomState,
} from "./room-state";

const FIXED_NOW = "2026-09-01T10:00:00.000Z";

async function demoRoomState(): Promise<DriveRoomState> {
	const source = createDemoDriveSource({
		now: () => new Date(FIXED_NOW),
		autoTick: false,
	});
	const reply = await source.call("call_get_room", DEMO_ROOM_ID);
	source.dispose();
	return applyCallReply(resetDriveRoomState(DEMO_ROOM_ID), reply, {
		now: FIXED_NOW,
	});
}

describe("projectRoomPreview", () => {
	it("reads checking while the phase is connecting and the lookup is open", () => {
		const preview = projectRoomPreview({
			phase: "connecting",
			room: resetDriveRoomState(DRIVE_DEFAULT_ROOM_ID),
			lookup: ROOM_LOOKUP_PENDING,
			roomId: DRIVE_DEFAULT_ROOM_ID,
		});
		expect(preview.state).toBe("checking");
		expect(preview.title).toBe("Pairing room");
		expect(preview.action.enabled).toBe(false);
		expect(preview.hasSnapshot).toBe(false);
	});

	it("turns a stalled connect into an honest unreachable state with Retry", () => {
		const preview = projectRoomPreview({
			phase: "connecting",
			room: resetDriveRoomState(DRIVE_DEFAULT_ROOM_ID),
			lookup: ROOM_LOOKUP_TIMED_OUT,
			roomId: DRIVE_DEFAULT_ROOM_ID,
		});
		expect(preview.state).toBe("unreachable");
		expect(preview.action).toEqual({
			kind: "retry",
			label: "Retry",
			enabled: true,
		});
		expect(preview.problem).toBe(ROOM_HUB_UNREACHABLE_MESSAGE);
	});

	it("offers Start a call when the live hub says there is no room", () => {
		const preview = projectRoomPreview({
			phase: "live",
			room: resetDriveRoomState(DRIVE_DEFAULT_ROOM_ID),
			lookup: ROOM_LOOKUP_NOT_FOUND,
			roomId: DRIVE_DEFAULT_ROOM_ID,
		});
		expect(preview.state).toBe("empty");
		expect(preview.badge).toBe("Off");
		expect(preview.action.kind).toBe("start");
		expect(preview.action.label).toBe("Start a call");
	});

	it("keeps checking after a found reply until the fold carries the snapshot", () => {
		const preview = projectRoomPreview({
			phase: "live",
			room: resetDriveRoomState(DRIVE_DEFAULT_ROOM_ID),
			lookup: ROOM_LOOKUP_FOUND,
			roomId: DRIVE_DEFAULT_ROOM_ID,
		});
		expect(preview.state).toBe("checking");
	});

	it("surfaces a failed lookup's text instead of inventing a room", () => {
		const preview = projectRoomPreview({
			phase: "live",
			room: resetDriveRoomState("default"),
			lookup: { kind: "failed", text: "hub_disconnected: socket closed" },
			roomId: "default",
		});
		expect(preview.state).toBe("unreachable");
		expect(preview.description).toBe("hub_disconnected: socket closed");
		expect(preview.problem).toBe("hub_disconnected: socket closed");
	});

	it("projects the demo room as seated with roster, sharer, presenter and mode", async () => {
		const room = await demoRoomState();
		const preview = projectRoomPreview({
			phase: "demo",
			room,
			lookup: ROOM_LOOKUP_FOUND,
			roomId: DEMO_ROOM_ID,
			humanParticipantId: DEMO_HUMAN_ID,
			now: FIXED_NOW,
		});
		expect(preview.state).toBe("seated");
		expect(preview.title).toBe(DEMO_ROOM_ID);
		expect(preview.action).toEqual({
			kind: "continue",
			label: "Continue call",
			enabled: true,
		});
		expect(preview.hasSnapshot).toBe(true);
		expect(preview.roster.map((p) => p.displayName)).toEqual([
			"You",
			"Cline",
			"Riley",
			"Sam",
		]);
		const you = preview.roster[0];
		expect(you.isYou).toBe(true);
		expect(you.kind).toBe("human");
		const cline = preview.roster[1];
		expect(cline.sharing).toBe(true);
		expect(cline.presenting).toBe(true);
		expect(preview.sharer).toEqual({
			participantId: DEMO_PARTNER_ID,
			kind: "agent",
			displayName: "Cline",
		});
		expect(preview.presenter?.agentId).toBe(DEMO_PARTNER_ID);
		expect(preview.presenter?.displayName).toBe("Cline");
		expect(preview.presenter?.remainingLabel).toMatch(/left$/);
		expect(preview.subMode).toBe(room.snapshot?.subMode);
		expect(preview.subModeLabel).toBe(
			driveSubModeLabel(room.snapshot?.subMode ?? "plan"),
		);
		expect(preview.cardCount).toBe(room.snapshot?.stage.cards.length);
		expect(preview.seq).toBe(room.seq);
		expect(preview.lastEventAt).toBe(FIXED_NOW);
	});

	it("reads available when Drive is active but the human seat is empty", async () => {
		const seated = await demoRoomState();
		const snapshot = seated.snapshot;
		if (!snapshot) {
			throw new Error("demo snapshot missing");
		}
		const room: DriveRoomState = {
			...seated,
			snapshot: {
				...snapshot,
				participants: snapshot.participants.filter((p) => p.kind !== "human"),
			},
		};
		const preview = projectRoomPreview({
			phase: "live",
			room,
			lookup: ROOM_LOOKUP_FOUND,
			roomId: DEMO_ROOM_ID,
			now: FIXED_NOW,
		});
		expect(preview.state).toBe("available");
		expect(preview.action.kind).toBe("join");
		expect(preview.roster.some((p) => p.isYou)).toBe(false);
	});

	it("reads available again once a call_end reply landed", async () => {
		const seated = await demoRoomState();
		const preview = projectRoomPreview({
			phase: "live",
			room: { ...seated, ended: true },
			lookup: ROOM_LOOKUP_FOUND,
			roomId: DEMO_ROOM_ID,
			humanParticipantId: DEMO_HUMAN_ID,
			now: FIXED_NOW,
		});
		expect(preview.state).toBe("available");
	});
});

describe("room preview helpers", () => {
	it("names the hub default room and passes other ids through", () => {
		expect(roomPreviewTitle(DRIVE_DEFAULT_ROOM_ID)).toBe("Pairing room");
		expect(roomPreviewTitle("router-fix")).toBe("router-fix");
	});

	it("labels sub-modes with the product vocabulary", () => {
		expect(driveSubModeLabel("plan")).toBe("Plan");
		expect(driveSubModeLabel("act")).toBe("Agent");
		expect(driveSubModeLabel("ask")).toBe("Ask");
		expect(driveSubModeLabel("debug")).toBe("Debug");
		expect(driveSubModeLabel("")).toBe("—");
	});

	it("labels address sets from the roster", () => {
		const participants = [
			{
				id: "agent:riley",
				kind: "agent" as const,
				displayName: "Riley",
				role: "specialist" as const,
				status: "idle" as const,
				seatSources: [{ kind: "manual" as const }],
			},
		];
		expect(addressSetLabel(undefined)).toBe("Everyone");
		expect(addressSetLabel({ mode: "everyone" })).toBe("Everyone");
		expect(
			addressSetLabel(
				{ mode: "agents", agentIds: ["agent:riley", "agent:sam"] },
				participants,
			),
		).toBe("Riley + agent:sam");
		expect(addressSetLabel({ mode: "pack", packId: "review" })).toBe(
			"Pack · review",
		);
	});

	it("formats presenter time remaining", () => {
		const now = Date.parse(FIXED_NOW);
		expect(formatRemaining(new Date(now + 42_000).toISOString(), now)).toBe(
			"42s left",
		);
		expect(
			formatRemaining(new Date(now + 12 * 60_000).toISOString(), now),
		).toBe("12m left");
		expect(
			formatRemaining(new Date(now + 3 * 3_600_000).toISOString(), now),
		).toBe("3h left");
		expect(formatRemaining(new Date(now - 1).toISOString(), now)).toBe(
			"expired",
		);
		expect(formatRemaining("not a date", now)).toBe("");
	});

	it("classifies lookup errors by hub code, including the legacy text form", () => {
		expect(
			roomLookupFromError({ code: "room_not_found", text: "no such room" }),
		).toEqual(ROOM_LOOKUP_NOT_FOUND);
		expect(
			roomLookupFromError({ code: null, text: "room_not_found: default" }),
		).toEqual(ROOM_LOOKUP_NOT_FOUND);
		expect(
			roomLookupFromError({ code: "hub_disconnected", text: "socket closed" }),
		).toEqual({ kind: "failed", text: "socket closed" });
		expect(roomLookupFromError({ code: null, text: "" })).toEqual({
			kind: "failed",
			text: "Could not check the room.",
		});
	});
});
