import { describe, expect, test } from "bun:test";
import { PACK_ID_VALUES } from "../apps/writer/src/packIds.ts";
import {
	createRoomService,
	listPackIds,
} from "../apps/writer/src/roomService.ts";
import { createWriterStore } from "../apps/writer/src/store.ts";
import { validateArtifactsWork } from "../packages/packs-artifacts/src/index.ts";
import { validateDirectionWork } from "../packages/packs-direction/src/index.ts";
import { validateTasksWork } from "../packages/packs-tasks/src/index.ts";

describe("fleet packs — validation", () => {
	test("tasks pack accepts created with deps", () => {
		const v = validateTasksWork("work.task.created", {
			taskId: "t1",
			title: "Gate JWT refresh",
			project: "Auth middleware",
			state: "running",
			deps: ["t2"],
		});
		expect(v.type).toBe("work.task.created");
		if (v.type === "work.task.created") {
			expect(v.payload.deps).toEqual(["t2"]);
		}
	});

	test("tasks pack rejects out-of-range progress", () => {
		expect(() =>
			validateTasksWork("work.task.progress", { taskId: "t1", progress: 1.2 }),
		).toThrow();
	});

	test("artifacts pack accepts ephemeral ttl life", () => {
		const v = validateArtifactsWork("work.artifact.created", {
			artifactId: "a1",
			title: "Staging config capture",
			kind: "capture",
			life: { ttlDays: 7 },
			sizeKb: 980,
		});
		expect(v.type).toBe("work.artifact.created");
	});

	test("artifacts pack rejects a life that is both permanent and ttl", () => {
		expect(() =>
			validateArtifactsWork("work.artifact.created", {
				artifactId: "a1",
				title: "x",
				kind: "doc",
				life: { permanent: true, ttlDays: 7 },
			}),
		).toThrow();
	});

	test("direction pack accepts a beat annotation", () => {
		const v = validateDirectionWork("work.direction.beat", {
			programId: "auth-session-1",
			beatIndex: 1,
			kind: "diagram",
			title: "Request path",
			caption: "Every refresh now passes through verifyJwt.",
		});
		expect(v.type).toBe("work.direction.beat");
	});
});

describe("fleet packs — writer mapping", () => {
	test("task/artifact/beat publishes land as timestamped work.generic events", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);

		service.publishWork({
			packId: "tasks",
			type: "work.task.created",
			payload: {
				taskId: "t1",
				title: "Gate JWT refresh",
				project: "Auth middleware",
				state: "running",
				deps: ["t2"],
			},
			narrate: false,
		});
		service.publishWork({
			packId: "artifacts",
			type: "work.artifact.created",
			payload: {
				artifactId: "a1",
				title: "Room replay",
				kind: "replay",
				life: { ttlDays: 30 },
				sizeKb: 4300,
			},
			narrate: false,
		});
		service.publishWork({
			packId: "direction",
			type: "work.direction.beat",
			payload: {
				programId: "auth-session-1",
				beatIndex: 0,
				kind: "plan",
				title: "Ship auth middleware",
				directorId: "maya",
			},
			narrate: false,
		});

		const events = store
			.eventsSince(-1)
			.map((entry) => entry.event)
			.filter((event) => event.type === "work.generic");
		expect(events.length).toBe(3);

		const [task, artifact, beat] = events;
		expect(task.kind).toBe("work.task.created");
		expect(task.summary).toContain("Auth middleware");
		expect((task.payload as { deps: string[] }).deps).toEqual(["t2"]);

		expect(artifact.kind).toBe("work.artifact.created");
		expect(artifact.summary).toContain("30d ttl");

		expect(beat.kind).toBe("work.direction.beat");
		expect(beat.summary).toContain("beat 1");

		// Ask 1 from DATA-NEEDS: every event carries wall-clock time.
		for (const event of events) {
			expect(Date.parse(event.at)).toBeGreaterThan(0);
		}
	});

	test("unknown pack kinds are rejected", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		expect(() =>
			service.publishWork({
				packId: "tasks",
				type: "work.task.rename",
				payload: { taskId: "t1" },
				narrate: false,
			}),
		).toThrow();
	});
});

describe("room_invite", () => {
	test("invite lands as a control.invite event on the log", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		const result = service.invite({
			inviterId: "maya",
			inviteeId: "you",
			sessionId: "session-payments",
			title: "Payments refactor",
			note: "Plan review, ~15 minutes.",
		});
		expect(result.event.type).toBe("control.invite");
		const logged = store.eventsSince(-1).map((entry) => entry.event);
		const invite = logged.find((event) => event.type === "control.invite");
		expect(invite).toBeDefined();
		if (invite?.type === "control.invite") {
			expect(invite.inviteeId).toBe("you");
			expect(invite.sessionId).toBe("session-payments");
			expect(Date.parse(invite.at)).toBeGreaterThan(0);
		}
	});
});

describe("session registry", () => {
	test("lifecycle methods append ordered, typed control events", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		service.createSession({
			sessionId: "session-auth",
			organizerId: "you",
			title: "Auth middleware — working session",
			project: "Auth middleware",
			participantIds: ["you", "maya"],
			agendaTaskIds: ["task-review-gate"],
			note: "Review the gate together.",
		});
		service.scheduleSession("session-auth", "2026-08-18T20:00:00.000Z", "you");
		service.startSession("session-auth", "program-auth", "you");
		service.endSession({
			sessionId: "session-auth",
			outcome: "completed",
			replayArtifactId: "artifact-auth-replay",
			actorId: "you",
		});

		expect(store.eventsSince(-1).map((entry) => entry.event.type)).toEqual([
			"control.session_created",
			"control.session_scheduled",
			"control.session_started",
			"control.session_ended",
		]);
	});
});

describe("Agent Titles writer", () => {
	function setup() {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		for (const [id, displayName] of [
			["maya", "Maya"],
			["scout", "Scout"],
		] as const) {
			service.join({
				id,
				kind: "agent",
				displayName,
				role: "partner",
				status: "idle",
				seatSources: [{ kind: "manual" }],
			});
		}
		return { store, service };
	}

	test("requires Presenter before agent stage sharing", () => {
		const { service } = setup();
		expect(() =>
			service.setSharer({ kind: "agent", participantId: "maya" }),
		).toThrow("requires an active Presenter");

		const expiresAt = new Date(Date.now() + 60_000).toISOString();
		service.grantTitle({
			grantId: "grant-maya",
			agentId: "maya",
			title: "presenter",
			scope: { kind: "room", ref: "default" },
			skillBundleRefs: ["bundle-present"],
			resourceGrantRefs: ["typed-stage"],
			expiresAt,
		});
		const stage = service.setSharer({ kind: "agent", participantId: "maya" });
		expect(stage.snapshot.stage.sharer?.participantId).toBe("maya");
		expect(stage.snapshot.stage.presenterGrantId).toBe("grant-maya");
	});

	test("rejects competing grants and logs transfer plus revoke", () => {
		const { store, service } = setup();
		const expiresAt = new Date(Date.now() + 60_000).toISOString();
		service.grantTitle({
			grantId: "grant-maya",
			agentId: "maya",
			title: "presenter",
			scope: { kind: "room", ref: "default" },
			expiresAt,
		});
		expect(() =>
			service.grantTitle({
				grantId: "grant-scout-direct",
				agentId: "scout",
				title: "presenter",
				scope: { kind: "room", ref: "default" },
				expiresAt,
			}),
		).toThrow("use title_transfer");

		const transferred = service.transferTitle({
			fromGrantId: "grant-maya",
			toGrantId: "grant-scout",
			toAgentId: "scout",
			title: "presenter",
			expiresAt,
		});
		expect(transferred.snapshot.stage.sharer?.participantId).toBe("scout");
		expect(transferred.snapshot.stage.presenterGrantId).toBe("grant-scout");

		const revoked = service.revokeTitle({ grantId: "grant-scout" });
		expect(revoked.snapshot.stage.sharer).toBeNull();
		expect(revoked.snapshot.stage.presenterGrantId).toBeNull();
		expect(
			store
				.eventsSince(-1)
				.map((entry) => entry.event.type)
				.filter((type) => type.startsWith("control.title_")),
		).toEqual([
			"control.title_granted",
			"control.title_transferred",
			"control.title_revoked",
		]);
	});

	test("stores only sanitized runtime badge metadata", () => {
		const { service } = setup();
		const result = service.setProfile("maya", {
			displayName: "Maya",
			runtimeBadge: { family: "claude", executionLocation: "host" },
		});
		expect(result.snapshot.profilesByParticipantId.maya?.runtimeBadge).toEqual({
			family: "claude",
			executionLocation: "host",
		});
	});

	test("leave and room end revoke Presenter authority like the coordinator", () => {
		const { store, service } = setup();
		const expiresAt = new Date(Date.now() + 60_000).toISOString();
		service.grantTitle({
			grantId: "grant-maya",
			agentId: "maya",
			title: "presenter",
			scope: { kind: "room", ref: "default" },
			expiresAt,
		});
		service.setSharer({ kind: "agent", participantId: "maya" });

		// The presenter leaving revokes their grant and clears the stage.
		const left = service.leave("maya", "handoff");
		expect(
			left.snapshot.titleGrantsById["grant-maya"]?.revokedAt,
		).toBeDefined();
		expect(left.snapshot.stage.sharer).toBeNull();
		expect(left.snapshot.stage.presenterGrantId).toBeNull();

		// A fresh grant works after the revocation…
		service.grantTitle({
			grantId: "grant-scout",
			agentId: "scout",
			title: "presenter",
			scope: { kind: "room", ref: "default" },
			expiresAt,
		});
		service.setSharer({ kind: "agent", participantId: "scout" });

		// …and room end clears roster and stage and revokes every grant.
		const ended = service.end("wrapped");
		expect(ended.event.type).toBe("control.end");
		expect(ended.snapshot.participants).toHaveLength(0);
		expect(ended.snapshot.driveActive).toBe(false);
		expect(ended.snapshot.stage.sharer).toBeNull();
		expect(ended.snapshot.stage.presenterGrantId).toBeNull();
		expect(
			ended.snapshot.titleGrantsById["grant-scout"]?.revokedAt,
		).toBeDefined();

		// Repeating room_end is a coordinator-parity no-op, even if a
		// configuration event lands while the room remains stopped.
		const eventCountAtEnd = store.eventsSince(-1).length;
		const again = service.end("wrapped again");
		expect(again).toEqual(ended);
		expect(store.eventsSince(-1)).toHaveLength(eventCountAtEnd);
		service.setAddress({ mode: "agents", agentIds: ["scout"] });
		const stillEnded = service.end("still wrapped");
		expect(stillEnded).toEqual(ended);
		expect(store.eventsSince(-1)).toHaveLength(eventCountAtEnd + 1);

		// A successful join reopens the room and permits one fresh end.
		service.join({
			id: "scout",
			kind: "agent",
			displayName: "Scout",
			role: "partner",
			status: "idle",
			seatSources: [{ kind: "manual" }],
		});
		const endedAfterJoin = service.end("wrapped after rejoin");
		expect(endedAfterJoin.seq).toBeGreaterThan(ended.seq);
		expect(endedAfterJoin.snapshot.participants).toHaveLength(0);
		expect(() =>
			service.setSharer({ kind: "agent", participantId: "scout" }),
		).toThrow("requires an active Presenter");
	});
});

describe("event log — sequence numbering", () => {
	// `eventsSince` is exclusive and both wire callers default `sinceSeq` to 0
	// (`/rpc events_since` and the `/events` SSE backlog), so a 0-based log hid
	// the room's very first event from every fresh client.
	test("a client resuming from the default seq receives the first event", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);

		service.publishWork({
			packId: "tasks",
			type: "work.task.created",
			payload: {
				taskId: "t1",
				title: "First ever event",
				project: "Auth middleware",
				state: "running",
			},
			narrate: false,
		});

		expect(store.eventsSince(-1)).toHaveLength(1);
		// What a wire client actually asks for.
		expect(store.eventsSince(0)).toHaveLength(1);
		expect(store.eventsSince(0)[0]?.seq).toBe(1);
	});

	test("latestSeq distinguishes an empty room from a room with one event", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);

		expect(service.snapshot().seq).toBe(0);

		service.publishWork({
			packId: "tasks",
			type: "work.task.created",
			payload: {
				taskId: "t1",
				title: "First ever event",
				project: "Auth middleware",
				state: "running",
			},
			narrate: false,
		});

		expect(service.snapshot().seq).toBe(1);
	});
});

describe("pack_set — MCP enum vs packs on disk", () => {
	test("pack_set accepts every registered pack id", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		expect(listPackIds().slice().sort()).toEqual([...PACK_ID_VALUES].sort());
		for (const packId of PACK_ID_VALUES) {
			expect(service.setActivePack(packId)).toEqual({ activePackId: packId });
			expect(service.snapshot().activePackId).toBe(packId);
		}
	});
});
