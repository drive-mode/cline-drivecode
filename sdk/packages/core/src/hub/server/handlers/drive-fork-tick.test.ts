import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDriveRoomStore } from "../../collaboration";
import type { HubTransportContext } from "./context";
import { __resetDriveForkRoomsForTests } from "./drive-fork-handlers";
import { handleDriveForkTickCommand } from "./drive-fork-tick";
import {
	__resetDriveRoomsForTests,
	handleDriveCommand,
} from "./drive-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-1",
		payload,
	};
}

function createCtx() {
	const published: HubEventEnvelope[] = [];
	const messagesBySession = new Map<string, unknown[]>();
	const ctx = {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		pendingDriveToolInputs: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: {
			startSession: vi.fn(
				async (input: { config?: { sessionId?: string } }) => {
					const sessionId = input.config?.sessionId ?? "worker-generated";
					messagesBySession.set(sessionId, [
						{ role: "user", content: "seed" },
						{ role: "assistant", content: "worked" },
					]);
					return {
						sessionId,
						manifest: {},
						manifestPath: "",
						messagesPath: "",
					};
				},
			),
			abort: vi.fn(async () => undefined),
			runTurn: vi.fn(async () => undefined),
			deleteSession: vi.fn(async () => true),
			readSessionMessages: vi.fn(async (sessionId: string) => {
				return messagesBySession.get(sessionId) ?? [];
			}),
			/** Default: unknown session, i.e. not a chat-fork worker. */
			getSession: vi.fn(async () => undefined),
		},
		publish: (event: HubEventEnvelope) => {
			published.push(event);
		},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
	return { ctx, published };
}

describe("drive.do.enqueue → drive.fork.tick", () => {
	beforeEach(() => {
		__resetDriveRoomsForTests();
		__resetDriveForkRoomsForTests();
	});

	it("claims a newly enqueued Do item without a prior claim payload", async () => {
		const { ctx, published } = createCtx();
		const enqueue = await handleDriveCommand(
			ctx,
			envelope("drive.do.enqueue", {
				roomId: "r-tick",
				doItem: {
					id: "do-new",
					title: "Ship show link",
					goal: "Prove enqueue→tick→claim",
					priority: 40,
					status: "queued",
					dependsOn: [],
					source: "planner",
				},
			}),
		);
		expect(enqueue.ok).toBe(true);

		const tick = await handleDriveForkTickCommand(
			ctx,
			envelope("drive.fork.tick", {
				roomId: "r-tick",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				parentBriefing: "Keep green",
			}),
		);
		expect(tick.ok).toBe(true);
		expect(tick.payload?.claimed).toBe(1);
		const room = tick.payload?.room as {
			chatForks: Array<{ seed: { doItemId: string }; lifecycle: string }>;
			director: { doBacklog: Array<{ id: string; status: string }> };
		};
		expect(room.chatForks).toHaveLength(1);
		expect(room.chatForks[0]?.seed.doItemId).toBe("do-new");
		expect(room.chatForks[0]?.lifecycle).toBe("running");
		expect(room.director.doBacklog[0]?.status).toBe("active");
		expect(
			published.some((event) => event.event === "drive.fork.changed"),
		).toBe(true);
	});

	it("does not fall back to a session that is a worker per its own persisted metadata, even when the room's live chatForks list is empty (post-restart)", async () => {
		const { ctx } = createCtx();
		const store = getDriveRoomStore();
		store.create("r-restart");
		// Simulates a worker session that existed before a hub restart wiped
		// the room's ephemeral chatForks list — only its own durable session
		// record still says it is a chat-fork worker.
		store.linkSession("worker-1", "r-restart");
		ctx.sessionHost.getSession = vi.fn(async (sessionId: string) =>
			sessionId === "worker-1"
				? { sessionId, metadata: { chatFork: true } }
				: undefined,
		) as typeof ctx.sessionHost.getSession;

		const enqueue = await handleDriveCommand(
			ctx,
			envelope("drive.do.enqueue", {
				roomId: "r-restart",
				doItem: {
					id: "do-restart",
					title: "After restart",
					goal: "Prove ancestry survives a restart",
					priority: 10,
					status: "queued",
					dependsOn: [],
					source: "planner",
				},
			}),
		);
		expect(enqueue.ok).toBe(true);

		const tick = await handleDriveForkTickCommand(
			ctx,
			envelope("drive.fork.tick", {
				roomId: "r-restart",
				assigneeParticipantId: "agent-1",
				// No parentSessionId: exercises the non-fork-parent fallback.
			}),
		);
		// worker-1 is the only room-linked session and it is a known worker,
		// so no legal parent is found — the tick must not silently treat the
		// worker as a fresh root.
		expect(tick.ok).toBe(false);
		expect(tick.payload?.claimed ?? 0).toBe(0);
	});

	it("is a no-op when Do backlog is empty", async () => {
		const { ctx } = createCtx();
		const tick = await handleDriveForkTickCommand(
			ctx,
			envelope("drive.fork.tick", {
				roomId: "r-empty",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
			}),
		);
		expect(tick.ok).toBe(true);
		expect(tick.payload?.claimed).toBe(0);
		expect(tick.payload?.errors).toEqual([]);
		const room = tick.payload?.room as { chatForks?: unknown[] };
		expect(room.chatForks ?? []).toHaveLength(0);
	});
});
