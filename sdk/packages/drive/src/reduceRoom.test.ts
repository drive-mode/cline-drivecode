import type { DriveEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	activePresenterGrant,
	createEmptyRoomSnapshot,
	projectActiveTitleGrants,
	projectRoster,
	projectStage,
	reduceRoom,
} from "./reduceRoom";

const at = "2026-07-25T12:00:00.000Z";

describe("reduceRoom", () => {
	it("stores non-Presenter titles without changing stage authority", () => {
		const room = reduceRoom(
			createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at }),
			{
				schemaVersion: 1,
				id: "grant_researcher",
				roomId: "room_1",
				at,
				type: "control.title_granted",
				track: "control",
				grant: {
					id: "researcher_a1",
					agentId: "a1",
					title: "researcher",
					definitionRef: "researcher@1",
					scope: { kind: "repository", ref: "target_1" },
					skillBundleRefs: ["research-evidence"],
					resourceGrantRefs: [],
					delegatedAgentIds: [],
					permissions: ["source.read"],
					grantedAt: at,
					expiresAt: "2026-07-25T13:00:00.000Z",
				},
			},
		);

		expect(room.titleGrantsById.researcher_a1?.title).toBe("researcher");
		expect(room.stage.presenterGrantId).toBeNull();
		expect(room.stage.sharer).toBeNull();
	});

	it("rejects stale transfers and same-agent Builder/Reviewer grants during replay", () => {
		const builder = {
			id: "builder_a1",
			agentId: "a1",
			title: "builder" as const,
			definitionRef: "builder@1",
			scope: { kind: "target" as const, ref: "target_1" },
			skillBundleRefs: ["builder-target"],
			resourceGrantRefs: [],
			delegatedAgentIds: [],
			permissions: ["target.modify" as const],
			grantedAt: at,
			expiresAt: "2026-07-25T13:00:00.000Z",
			generation: 2,
			exclusivityKey: "target/target_1",
		};
		let room = reduceRoom(
			createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at }),
			{
				schemaVersion: 1,
				id: "grant_builder",
				roomId: "room_1",
				at,
				type: "control.title_granted",
				track: "control",
				grant: builder,
			},
		);

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "grant_self_reviewer",
			roomId: "room_1",
			at: "2026-07-25T12:01:00.000Z",
			type: "control.title_granted",
			track: "control",
			grant: {
				...builder,
				id: "reviewer_a1",
				title: "reviewer",
				definitionRef: "reviewer@1",
				skillBundleRefs: ["review-findings"],
				permissions: ["review.findings"],
				exclusivityKey: "target/target_1/reviewer/a1",
			},
		});
		expect(room.titleGrantsById.reviewer_a1).toBeUndefined();

		const staleTransfer = {
			...builder,
			id: "builder_a2_stale",
			agentId: "a2",
			grantedAt: "2026-07-25T12:02:00.000Z",
		};
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "transfer_builder_stale",
			roomId: "room_1",
			at: staleTransfer.grantedAt,
			type: "control.title_transferred",
			track: "control",
			title: "builder",
			fromGrantId: builder.id,
			toGrant: staleTransfer,
			transferredAt: staleTransfer.grantedAt,
		});
		expect(room.titleGrantsById[builder.id]?.revokedAt).toBeUndefined();
		expect(room.titleGrantsById[staleTransfer.id]).toBeUndefined();
	});

	it("requires one temporary Presenter and replays transfer, revoke, and expiry", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		const firstGrant = {
			id: "presenter_a1",
			agentId: "a1",
			title: "presenter" as const,
			scope: { kind: "stage" as const, ref: "room_1" },
			skillBundleRefs: ["presenter-stage"],
			resourceGrantRefs: ["typed-stage"],
			delegatedAgentIds: [],
			permissions: ["stage.present" as const],
			grantedAt: at,
			expiresAt: "2026-07-25T13:00:00.000Z",
		};

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "stage_without_title",
			roomId: "room_1",
			at: "2026-07-25T12:00:01.000Z",
			type: "control.stage",
			track: "control",
			sharer: { kind: "agent", participantId: "a1" },
		});
		expect(room.stage.sharer).toBeNull();

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "grant_a1",
			roomId: "room_1",
			at,
			type: "control.title_granted",
			track: "control",
			actorId: "cline:coordinator",
			grant: firstGrant,
		});
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "stage_a1",
			roomId: "room_1",
			at: "2026-07-25T12:00:02.000Z",
			type: "control.stage",
			track: "control",
			sharer: { kind: "agent", participantId: "a1" },
		});
		expect(room.stage).toMatchObject({
			sharer: { kind: "agent", participantId: "a1" },
			presenterGrantId: firstGrant.id,
		});

		const secondGrant = {
			...firstGrant,
			id: "presenter_a2",
			agentId: "a2",
			grantedAt: "2026-07-25T12:05:00.000Z",
		};
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "competing_grant",
			roomId: "room_1",
			at: secondGrant.grantedAt,
			type: "control.title_granted",
			track: "control",
			grant: secondGrant,
		});
		expect(room.titleGrantsById[secondGrant.id]).toBeUndefined();

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "transfer_a2",
			roomId: "room_1",
			at: secondGrant.grantedAt,
			type: "control.title_transferred",
			track: "control",
			actorId: "cline:coordinator",
			title: "presenter",
			fromGrantId: firstGrant.id,
			toGrant: secondGrant,
			transferredAt: secondGrant.grantedAt,
		});
		expect(room.titleGrantsById[firstGrant.id]?.revokedAt).toBe(
			secondGrant.grantedAt,
		);
		expect(room.stage).toMatchObject({
			sharer: { kind: "agent", participantId: "a2" },
			presenterGrantId: secondGrant.id,
		});

		const revokedAt = "2026-07-25T12:06:00.000Z";
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "revoke_a2",
			roomId: "room_1",
			at: revokedAt,
			type: "control.title_revoked",
			track: "control",
			actorId: "cline:coordinator",
			grantId: secondGrant.id,
			revokedAt,
			reason: "revoked",
		});
		expect(projectActiveTitleGrants(room, revokedAt)).toHaveLength(0);
		expect(room.stage.sharer).toBeNull();

		const expiringGrant = {
			...firstGrant,
			id: "presenter_expiring",
			grantedAt: "2026-07-25T12:07:00.000Z",
			expiresAt: "2026-07-25T12:08:00.000Z",
		};
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "grant_expiring",
			roomId: "room_1",
			at: expiringGrant.grantedAt,
			type: "control.title_granted",
			track: "control",
			grant: expiringGrant,
		});
		expect(activePresenterGrant(room, expiringGrant.grantedAt)?.id).toBe(
			expiringGrant.id,
		);
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "after_expiry",
			roomId: "room_1",
			at: expiringGrant.expiresAt,
			type: "control.mode",
			track: "control",
			subMode: "act",
		});
		expect(activePresenterGrant(room, expiringGrant.expiresAt)).toBeUndefined();
		expect(room.stage.presenterGrantId).toBeNull();
	});

	it("revokes Presenter authority when its agent leaves", () => {
		const grant = {
			id: "presenter_leaving",
			agentId: "a1",
			title: "presenter" as const,
			scope: { kind: "stage" as const, ref: "room_1" },
			skillBundleRefs: ["presenter-stage"],
			resourceGrantRefs: ["typed-stage"],
			delegatedAgentIds: [],
			permissions: ["stage.present" as const],
			grantedAt: at,
			expiresAt: "2026-07-25T13:00:00.000Z",
		};
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "grant_leaving",
			roomId: "room_1",
			at,
			type: "control.title_granted",
			track: "control",
			grant,
		});
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "stage_leaving",
			roomId: "room_1",
			at: "2026-07-25T12:00:01.000Z",
			type: "control.stage",
			track: "control",
			sharer: { kind: "agent", participantId: "a1" },
		});
		const leftAt = "2026-07-25T12:01:00.000Z";
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "leave_presenter",
			roomId: "room_1",
			at: leftAt,
			type: "control.leave",
			track: "control",
			participantId: "a1",
		});
		expect(room.titleGrantsById[grant.id]?.revokedAt).toBe(leftAt);
		expect(room.stage.presenterGrantId).toBeNull();
		expect(room.stage.sharer).toBeNull();
	});

	it("folds join/mode/stage/work idempotently", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });

		const join: DriveEvent = {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "u1",
				kind: "human",
				displayName: "Ada",
				role: "host",
				status: "idle",
			},
		};
		room = reduceRoom(room, join);
		expect(projectRoster(room)).toHaveLength(1);

		room = reduceRoom(room, join);
		expect(projectRoster(room)).toHaveLength(1);
		expect(room.appliedEventIds).toEqual(["e1"]);

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e2",
			roomId: "room_1",
			at,
			type: "control.mode",
			track: "control",
			subMode: "act",
			driveActive: true,
		});
		expect(room.subMode).toBe("act");
		expect(room.driveActive).toBe(true);

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e3",
			roomId: "room_1",
			at,
			type: "work.plan_step",
			track: "work",
			title: "Schemas",
			status: "in_progress",
		});
		expect(projectStage(room).cards[0]?.title).toBe("Schemas");
	});

	it("renames a seated participant displayName", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Cline",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e2",
			roomId: "room_1",
			at,
			type: "control.rename",
			track: "control",
			participantId: "adam",
			displayName: "Nova",
		});
		expect(projectRoster(room)[0]?.displayName).toBe("Nova");
	});

	it("defaults a newly joining human to muted (hot-mic-on-join is unsafe)", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "u1",
				kind: "human",
				displayName: "Ada",
				role: "host",
				status: "idle",
			},
		});
		expect(room.muteByParticipantId.u1).toBe(true);
	});

	it("does not default an agent join to muted", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Adam",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		expect(room.muteByParticipantId.adam).toBeUndefined();
	});

	it("never overwrites an explicit mute state on rejoin", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		const join = (eventId: string): DriveEvent => ({
			schemaVersion: 1,
			id: eventId,
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "u1",
				kind: "human",
				displayName: "Ada",
				role: "host",
				status: "idle",
			},
		});
		room = reduceRoom(room, join("e1"));
		expect(room.muteByParticipantId.u1).toBe(true);

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e2",
			roomId: "room_1",
			at,
			type: "control.mute",
			track: "control",
			participantId: "u1",
			muted: false,
		});
		expect(room.muteByParticipantId.u1).toBe(false);

		// Rejoin (e.g. reconnect after a hub restart) must not re-mute a human
		// who explicitly unmuted earlier this room.
		room = reduceRoom(room, join("e3"));
		expect(room.muteByParticipantId.u1).toBe(false);
	});

	it("tracks speaking presence on and off", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Cline",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		// Distinct ids: reduceRoom dedupes by appliedEventIds.
		const speaking = (eventId: string, on: boolean): DriveEvent => ({
			schemaVersion: 1,
			id: eventId,
			roomId: "room_1",
			at,
			type: "presence.speaking",
			track: "presence",
			participantId: "adam",
			speaking: on,
		});

		room = reduceRoom(room, speaking("e2", true));
		expect(projectRoster(room)[0]?.status).toBe("speaking");

		room = reduceRoom(room, speaking("e3", false));
		expect(projectRoster(room)[0]?.status).toBe("idle");
	});

	it("speaking off never clobbers a status set during playback", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "room_1",
			at,
			type: "control.join",
			track: "control",
			participant: {
				id: "adam",
				kind: "agent",
				displayName: "Cline",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e2",
			roomId: "room_1",
			at,
			type: "presence.status",
			track: "presence",
			participantId: "adam",
			status: "working",
		});
		// The agent started working while the utterance was still playing;
		// clearing speaking must not rewrite that to idle.
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "e3",
			roomId: "room_1",
			at,
			type: "presence.speaking",
			track: "presence",
			participantId: "adam",
			speaking: false,
		});
		expect(projectRoster(room)[0]?.status).toBe("working");
	});

	it("ignores events for other rooms", () => {
		const room = createEmptyRoomSnapshot({
			roomId: "room_1",
			createdAt: at,
		});
		const next = reduceRoom(room, {
			schemaVersion: 1,
			id: "e1",
			roomId: "other",
			at,
			type: "control.mute",
			track: "control",
			participantId: "u1",
			muted: true,
		});
		expect(next).toBe(room);
	});

	it("records media.artifact as applied without touching the stage", () => {
		const room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		const next = reduceRoom(room, {
			schemaVersion: 1,
			id: "m1",
			roomId: "room_1",
			at,
			type: "media.artifact",
			track: "media",
			showItemId: "show-1",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			title: "Topology",
			caption: "Hub is the single writer",
			ownerParticipantId: "agent_partner",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "flowchart LR\n  A --> B" },
			},
			status: "shown",
		});
		expect(next.appliedEventIds).toEqual(["m1"]);
		expect(projectStage(next)).toEqual(projectStage(room));
		expect(projectRoster(next)).toEqual(projectRoster(room));
	});

	it("prefers work.command and work.test_result summary when present", () => {
		let room = createEmptyRoomSnapshot({ roomId: "room_1", createdAt: at });
		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "c1",
			roomId: "room_1",
			at,
			type: "work.command",
			track: "work",
			command: "bun test",
			failed: false,
			summary: "built ok",
		});
		expect(projectStage(room).cards[0]?.summary).toBe("built ok");

		room = reduceRoom(room, {
			schemaVersion: 1,
			id: "t1",
			roomId: "room_1",
			at,
			type: "work.test_result",
			track: "work",
			label: "unit",
			passed: true,
			summary: "3 pass",
		});
		const testCard = projectStage(room).cards.find(
			(c) => c.category === "test",
		);
		expect(testCard?.summary).toBe("3 pass");
	});
});
