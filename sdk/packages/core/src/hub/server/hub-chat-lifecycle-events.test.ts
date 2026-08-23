import { resolve } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
	type HubWorkspaceManagedEventInvocation,
} from "./workspace-managed-core-pool";

const WORKSPACE = resolve("/tmp/hub-chat-lifecycle-events");
const EVENT = {
	version: "v1",
	event: "chat.changed",
	eventId: "event-managed-1",
	timestamp: 1,
	catalogSequence: 1,
	previousDeliveredSequence: 0,
	payload: {
		chatId: "chat-managed-1",
		eventType: "chat.archived",
		aggregateKind: "chat",
		aggregateId: "chat-managed-1",
		previousRevision: 1,
		resultingRevision: 2,
		occurredAt: "2026-08-15T12:00:00.000Z",
		chat: null,
	},
} as const;

function fakeSessionHost() {
	return {
		subscribe: vi.fn(() => () => {}),
		dispose: vi.fn(),
	} as never;
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

describe("Hub managed lifecycle events", () => {
	const transports: HubServerTransport[] = [];

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
	});

	function setup(core: HubWorkspaceManagedCore, enabled = true) {
		const authority = new HubWorkspaceCapabilityAuthority();
		const pool = new HubWorkspaceManagedCorePool(authority, {
			create: vi.fn(async () => core),
		});
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: enabled,
			},
			authority,
			pool,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-managed-events",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		return { authority, identity, transport };
	}

	it("keeps managed event routing inert until lifecycle is enabled", async () => {
		const subscribe = vi.fn(() => () => {});
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				eventWire: { subscribe },
				dispose: vi.fn(async () => {}),
			},
			false,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-events-disabled"));
		const release = await connection.subscribe(
			"client-events-disabled",
			() => {},
		);
		expect(typeof release).toBe("function");
		release();
		expect(subscribe).not.toHaveBeenCalled();
	});

	it("projects only strict reconciled events through registered authenticated scope", async () => {
		let invocation: HubWorkspaceManagedEventInvocation | undefined;
		const unsubscribe = vi.fn();
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			eventWire: {
				subscribe: (input) => {
					invocation = input;
					input.ready?.(0);
					return unsubscribe;
				},
			},
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-events"));
		const events: HubEventEnvelope[] = [];
		const release = await connection.subscribe(
			"client-events",
			(event) => events.push(event),
			{ lifecycleCursor: { afterSequence: 0 } },
		);
		expect(Object.isFrozen(invocation)).toBe(true);
		expect(invocation).toMatchObject({
			identity,
			afterSequence: 0,
			signal: expect.any(AbortSignal),
		});
		invocation?.emit(EVENT);
		expect(() =>
			invocation?.emit({
				...EVENT,
				payload: { ...EVENT.payload, workspaceKey: "/tmp/private" },
			}),
		).toThrow();
		expect(events).toEqual([EVENT]);
		release();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("requires registration and an authenticated configured event adapter", async () => {
		for (const core of [
			{ chatLifecycle: {} as never, dispose: vi.fn(async () => {}) },
			{
				chatLifecycle: {} as never,
				eventWire: {
					subscribe: vi.fn((input) => {
						input.ready?.(0);
						return () => {};
					}),
				},
				dispose: vi.fn(async () => {}),
			},
		] satisfies HubWorkspaceManagedCore[]) {
			const { identity, transport } = setup(core);
			const connection = transport.openConnection(identity);
			expect(() => connection.subscribe("never-registered", () => {})).toThrow(
				"registered client identity",
			);
			await connection.command(register("client-event-config"));
			if (!core.eventWire) {
				await expect(
					connection.subscribe("client-event-config", () => {}, {
						lifecycleCursor: { afterSequence: 0 },
					}),
				).rejects.toMatchObject({ code: "unsupported_capability" });
			}
		}
	});

	it("aborts and suppresses late events after workspace revocation", async () => {
		let invocation: HubWorkspaceManagedEventInvocation | undefined;
		const { authority, identity, transport } = setup({
			chatLifecycle: {} as never,
			eventWire: {
				subscribe: (input) => {
					invocation = input;
					input.ready?.(0);
					return () => {};
				},
			},
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-event-revoke"));
		const events: HubEventEnvelope[] = [];
		await connection.subscribe(
			"client-event-revoke",
			(event) => events.push(event),
			{ lifecycleCursor: { afterSequence: 0 } },
		);
		authority.revokeWorkspace({ workspaceKey: identity.workspaceKey });
		expect(invocation?.signal.aborted).toBe(true);
		invocation?.emit(EVENT);
		expect(events).toEqual([]);
	});

	it("releases a source when authority is revoked during subscription setup", async () => {
		let authority: HubWorkspaceCapabilityAuthority | undefined;
		const unsubscribe = vi.fn(() => {
			throw new Error("adapter cleanup failure");
		});
		const fixture = setup({
			chatLifecycle: {} as never,
			eventWire: {
				subscribe: (input) => {
					authority?.revokeWorkspace({
						workspaceKey: input.identity.workspaceKey,
					});
					return unsubscribe;
				},
			},
			dispose: vi.fn(async () => {}),
		});
		authority = fixture.authority;
		const connection = fixture.transport.openConnection(fixture.identity);
		await connection.command(register("client-event-setup-revoke"));
		await expect(
			connection.subscribe("client-event-setup-revoke", () => {}, {
				lifecycleCursor: { afterSequence: 0 },
			}),
		).rejects.toMatchObject({ code: "invalid_input" });
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(() => connection.closeConnection()).not.toThrow();
	});
});
