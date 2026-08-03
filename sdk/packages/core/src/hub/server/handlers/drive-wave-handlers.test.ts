import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import { __resetDriveForkRoomsForTests } from "./drive-fork-handlers";
import { handleDriveWaveCommand } from "./drive-wave-handlers";
import { doBacklogToWaveInputs } from "./drive-wave-map";
import { getDriveRoomStore } from "../../collaboration";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-wave-1",
		payload,
	};
}

function createCtx() {
	const published: HubEventEnvelope[] = [];
	const metadataBySession = new Map<string, Record<string, unknown> | undefined>();
	const ctx = {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {
			startSession: vi.fn(
				async (input: {
					config?: { sessionId?: string };
					sessionMetadata?: Record<string, unknown>;
				}) => {
					const sessionId = input.config?.sessionId ?? "worker-generated";
					metadataBySession.set(sessionId, input.sessionMetadata);
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
			readSessionMessages: vi.fn(async () => []),
			getSession: vi.fn(async (sessionId: string) => {
				if (!metadataBySession.has(sessionId)) {
					return undefined;
				}
				return { sessionId, metadata: metadataBySession.get(sessionId) };
			}),
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

describe("doBacklogToWaveInputs", () => {
	it("maps queued items with dependsOn", () => {
		const inputs = doBacklogToWaveInputs([
			{
				id: "a",
				title: "A",
				goal: "ga",
				priority: 1,
				status: "queued",
				dependsOn: [],
				source: "planner",
			},
			{
				id: "b",
				title: "B",
				goal: "gb",
				priority: 2,
				status: "queued",
				dependsOn: ["a"],
				source: "planner",
			},
			{
				id: "c",
				title: "C",
				goal: "gc",
				priority: 3,
				status: "done",
				dependsOn: [],
				source: "planner",
			},
		]);
		expect(inputs).toHaveLength(2);
		expect(inputs[1]?.dependsOn).toEqual(["a"]);
	});
});

describe("handleDriveWaveCommand", () => {
	beforeEach(() => {
		__resetDriveForkRoomsForTests();
	});

	it("runs a 2-item wave respecting dependsOn with syncComplete", async () => {
		const { ctx, published } = createCtx();
		const store = getDriveRoomStore();
		store.create("r-wave");
		store.setLive({
			...store.getOrCreateLive("r-wave"),
			director: {
				...store.getOrCreateLive("r-wave").director,
				doBacklog: [
					{
						id: "a",
						title: "First",
						goal: "do a",
						priority: 10,
						status: "queued",
						dependsOn: [],
						source: "planner",
					},
					{
						id: "b",
						title: "Second",
						goal: "do b",
						priority: 5,
						status: "queued",
						dependsOn: ["a"],
						source: "planner",
					},
				],
			},
		});

		const reply = await handleDriveWaveCommand(
			ctx,
			envelope("drive.wave.run", {
				roomId: "r-wave",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				syncComplete: true,
				concurrency: 2,
			}),
		);

		expect(reply.ok).toBe(true);
		const result = reply.payload?.result as {
			success: boolean;
			tasks: Array<{ id: string; status: string }>;
		};
		expect(result.success).toBe(true);
		expect(result.tasks).toHaveLength(2);
		expect(result.tasks.every((t) => t.status === "succeeded")).toBe(true);
		expect(published.some((e) => e.event === "drive.wave.started")).toBe(true);
		expect(published.some((e) => e.event === "drive.wave.completed")).toBe(true);

		const startOrder = (
			ctx.sessionHost.startSession as ReturnType<typeof vi.fn>
		).mock.invocationCallOrder;
		expect(startOrder.length).toBe(2);
		// a must start before b (dependsOn)
		expect(startOrder[0]).toBeLessThan(startOrder[1]);
	});

	it("accepts explicit work[] payload", async () => {
		const { ctx } = createCtx();
		const reply = await handleDriveWaveCommand(
			ctx,
			envelope("drive.wave.run", {
				roomId: "r-explicit",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				syncComplete: true,
				work: [
					{
						id: "w1",
						kind: "do_item",
						payload: {
							doItem: {
								id: "w1",
								title: "W1",
								goal: "g",
								priority: 1,
								status: "queued",
								dependsOn: [],
								source: "system",
							},
						},
					},
				],
			}),
		);
		expect(reply.ok).toBe(true);
	});
});
