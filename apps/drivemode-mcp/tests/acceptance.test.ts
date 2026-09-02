import { afterAll, describe, expect, test } from "bun:test";
import { startHttpWriter } from "../apps/writer/src/http.ts";
import { createRoomService } from "../apps/writer/src/roomService.ts";
import { createWriterStore } from "../apps/writer/src/store.ts";
import { validateCodingWork } from "../packages/packs-coding/src/index.ts";
import { validateDemoOpsWork } from "../packages/packs-demo-ops/src/index.ts";

describe("packs", () => {
	test("coding pack accepts work.decision", () => {
		const v = validateCodingWork("work.decision", {
			title: "Ship?",
			choice: "yes",
		});
		expect(v.type).toBe("work.decision");
	});

	test("coding pack rejects bad payload", () => {
		expect(() => validateCodingWork("work.decision", { title: "x" })).toThrow();
	});

	test("demo-ops pack accepts alert", () => {
		const v = validateDemoOpsWork("work.ops.alert", {
			title: "Checkout latency",
			severity: "p1",
		});
		expect(v.type).toBe("work.ops.alert");
	});
});

describe("writer acceptance", () => {
	const store = createWriterStore({ roomId: "default" });
	const service = createRoomService(store);
	let baseUrl = "";
	let stop: (() => void) | null = null;

	test("boot + join + decision spotlight + raise-hand + demo-ops + resume", async () => {
		const { server, url } = await startHttpWriter({ store, service, port: 0 });
		baseUrl = url;
		stop = () => server.stop(true);

		// empty room
		let snap = await fetch(`${baseUrl}/snapshot`).then((r) => r.json());
		expect(snap.room.participants).toEqual([]);

		// human join via rpc
		await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "room_join",
				args: {
					id: "drive:human",
					kind: "human",
					displayName: "You",
					role: "host",
				},
			}),
		});
		await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "room_join",
				args: {
					id: "drive:partner",
					kind: "agent",
					displayName: "Partner",
				},
			}),
		});
		await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "title_grant",
				args: {
					grantId: "grant-drive-partner",
					agentId: "drive:partner",
					title: "presenter",
					scopeKind: "room",
					scopeRef: "default",
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				},
			}),
		});
		await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "stage_set_sharer",
				args: { participantId: "drive:partner", kind: "agent" },
			}),
		});

		snap = await fetch(`${baseUrl}/snapshot`).then((r) => r.json());
		expect(snap.room.participants.length).toBe(2);
		expect(snap.room.stage.presenterGrantId).toBe("grant-drive-partner");

		const decision = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "stage_publish_work",
				args: {
					packId: "coding",
					type: "work.decision",
					payload: { title: "Ship v0?", choice: "yes" },
					actorId: "drive:partner",
				},
			}),
		}).then((r) => r.json());
		expect(decision.ok).toBe(true);
		expect(decision.result.spotlight.cards.at(-1).category).toBe("decision");

		const hand = await fetch(`${baseUrl}/api/raise-hand`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ participantId: "drive:human", raised: true }),
		}).then((r) => r.json());
		expect(hand.room.raisedHandByParticipantId["drive:human"]).toBe(true);

		const ack = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "interrupt_ack",
				args: { participantId: "drive:partner", intent: "stop" },
			}),
		}).then((r) => r.json());
		expect(ack.ok).toBe(true);
		expect(ack.result.event.type).toBe("control.interrupt_ack");

		const session = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "session_create",
				args: {
					sessionId: "session-auth",
					organizerId: "drive:human",
					title: "Auth middleware — working session",
					project: "Auth middleware",
					participantIds: ["drive:human", "drive:partner"],
					agendaTaskIds: ["task-review-gate"],
					note: "Review the gate together.",
				},
			}),
		}).then((r) => r.json());
		expect(session.ok).toBe(true);
		expect(session.result.event.type).toBe("control.session_created");

		const scheduled = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "session_schedule",
				args: {
					sessionId: "session-auth",
					scheduledFor: "2026-08-18T20:00:00.000Z",
					actorId: "drive:human",
				},
			}),
		}).then((r) => r.json());
		expect(scheduled.ok).toBe(true);
		expect(scheduled.result.event.type).toBe("control.session_scheduled");

		const invite = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "room_invite",
				args: {
					inviterId: "drive:human",
					inviteeId: "drive:partner",
					sessionId: "session-auth",
					title: "Auth middleware — working session",
					note: "Review the gate together.",
				},
			}),
		}).then((r) => r.json());
		expect(invite.ok).toBe(true);
		expect(invite.result.event.sessionId).toBe("session-auth");

		const badSession = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "session_start",
				args: { programId: "program-auth" },
			}),
		}).then((r) => r.json());
		expect(badSession.ok).toBe(false);

		await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tool: "pack_set", args: { packId: "demo-ops" } }),
		});
		const ops = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "stage_publish_work",
				args: {
					packId: "demo-ops",
					type: "work.ops.alert",
					payload: {
						title: "Pager: checkout latency",
						severity: "p1",
						service: "checkout",
					},
				},
			}),
		}).then((r) => r.json());
		expect(ops.ok).toBe(true);
		expect(ops.result.event.type).toBe("work.generic");
		expect(ops.result.event.packId).toBe("demo-ops");

		const bad = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "stage_publish_work",
				args: {
					packId: "coding",
					type: "work.decision",
					payload: { nope: true },
				},
			}),
		}).then((r) => r.json());
		expect(bad.ok).toBe(false);

		const since = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tool: "events_since",
				args: { sinceSeq: 0 },
			}),
		}).then((r) => r.json());
		expect(since.result.events.length).toBeGreaterThan(0);
		const ids = since.result.events.map(
			(e: { event: { id: string } }) => e.event.id,
		);
		expect(new Set(ids).size).toBe(ids.length);
	});

	afterAll(() => {
		stop?.();
	});
});
