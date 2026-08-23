import { resolve } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
	type HubWorkspaceManagedRuntimeEventInvocation,
} from "./workspace-managed-core-pool";

const WORKSPACE = resolve("/tmp/hub-chat-runtime-events");
const EVENT = {
	version: "v1",
	event: "chat.runtime",
	eventId: "event-runtime-1",
	streamId: "runtime-stream-1",
	sessionId: "session-managed-1",
	timestamp: 1,
	processSequence: 8,
	sessionSequence: 2,
	payload: {
		kind: "assistant.delta",
		runId: "run-managed-1",
		text: "hello",
	},
} as const;

function fakeSessionHost() {
	return { subscribe: vi.fn(() => () => {}), dispose: vi.fn() } as never;
}

function register(clientId: string) {
	return {
		version: "v1" as const,
		command: "client.register" as const,
		requestId: `register-${clientId}`,
		clientId,
		payload: { clientId, clientType: "test", transport: "browser-ws" },
	};
}

describe("Hub managed runtime events", () => {
	const transports: HubServerTransport[] = [];

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
	});

	function setup(core: HubWorkspaceManagedCore) {
		const authority = new HubWorkspaceCapabilityAuthority();
		const pool = new HubWorkspaceManagedCorePool(authority, {
			create: vi.fn(async () => core),
		});
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
			},
			authority,
			pool,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-managed-runtime-events",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		return { authority, identity, transport };
	}

	it("keeps strict runtime subscriptions on their explicit session lane", async () => {
		let invocation: HubWorkspaceManagedRuntimeEventInvocation | undefined;
		const unsubscribeRuntime = vi.fn();
		const unsubscribeLifecycle = vi.fn();
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			eventWire: { subscribe: () => unsubscribeLifecycle },
			runtimeEventWire: {
				subscribe: (input) => {
					invocation = input;
					return unsubscribeRuntime;
				},
			},
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime-events"));
		const events: HubEventEnvelope[] = [];
		const release = await connection.subscribe(
			"client-runtime-events",
			(event) => events.push(event),
			{ sessionId: "session-managed-1" },
		);
		expect(invocation).toMatchObject({
			identity,
			sessionId: "session-managed-1",
			signal: expect.any(AbortSignal),
		});
		invocation?.emit(EVENT);
		invocation?.emit({
			...EVENT,
			payload: { ...EVENT.payload, inputJson: "secret" },
		});
		invocation?.emit({ ...EVENT, sessionId: "session-other" });
		expect(events).toEqual([EVENT]);
		release();
		expect(unsubscribeRuntime).toHaveBeenCalledOnce();
		expect(unsubscribeLifecycle).not.toHaveBeenCalled();
	});

	it("suppresses late runtime events after authority revocation", async () => {
		let invocation: HubWorkspaceManagedRuntimeEventInvocation | undefined;
		const { authority, identity, transport } = setup({
			chatLifecycle: {} as never,
			eventWire: { subscribe: () => () => {} },
			runtimeEventWire: {
				subscribe: (input) => {
					invocation = input;
					return () => {};
				},
			},
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime-event-revoke"));
		const events: HubEventEnvelope[] = [];
		await connection.subscribe(
			"client-runtime-event-revoke",
			(event) => events.push(event),
			{ sessionId: "session-managed-1" },
		);
		authority.revokeWorkspace({ workspaceKey: identity.workspaceKey });
		expect(invocation?.signal.aborted).toBe(true);
		invocation?.emit(EVENT);
		expect(events).toEqual([]);
	});

	it("rejects setup and fences the source when replay delivery fails", async () => {
		let invocation: HubWorkspaceManagedRuntimeEventInvocation | undefined;
		const unsubscribeLifecycle = vi.fn();
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			eventWire: { subscribe: () => unsubscribeLifecycle },
			runtimeEventWire: {
				subscribe: (input) => {
					invocation = input;
					input.emit(EVENT);
					return vi.fn();
				},
			},
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime-replay-failure"));
		await expect(
			connection.subscribe(
				"client-runtime-replay-failure",
				() => {
					throw new Error("outbound replay admission failed");
				},
				{ sessionId: "session-managed-1" },
			),
		).rejects.toThrow("outbound replay admission failed");
		expect(unsubscribeLifecycle).not.toHaveBeenCalled();
		expect(() => invocation?.emit(EVENT)).not.toThrow();
	});

	it("rejects unfenced global managed subscriptions", async () => {
		const subscribeRuntime = vi.fn(() => vi.fn());
		const subscribeLifecycle = vi.fn(() => vi.fn());
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			eventWire: { subscribe: subscribeLifecycle },
			runtimeEventWire: { subscribe: subscribeRuntime },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-global-lifecycle"));

		await expect(
			connection.subscribe("client-global-lifecycle", vi.fn()),
		).rejects.toMatchObject({ code: "invalid_input" });

		expect(subscribeLifecycle).not.toHaveBeenCalled();
		expect(subscribeRuntime).not.toHaveBeenCalled();
	});
});
