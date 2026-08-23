import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
	type HubWorkspaceManagedProjectionInvocation,
} from "./workspace-managed-core-pool";

const WORKSPACE = resolve("/tmp/hub-chat-projection-wire");
const PROJECTION_CHAT = {
	chatId: "chat-managed-1",
	catalogState: "active" as const,
	headSessionId: "session-managed-1",
	title: "Managed chat",
	titleSource: "owner",
	sourceKind: "interactive",
	createdAt: "2026-08-15T11:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	revision: 1,
	sessionCount: 1,
	bindingCount: 0,
	sessions: [
		{
			chatId: "chat-managed-1",
			sessionId: "session-managed-1",
			relationKind: "root" as const,
			ordinal: 0,
			attachedAt: "2026-08-15T11:00:00.000Z",
			executionStatus: "idle" as const,
		},
	],
	bindings: [],
};
const LIST_RESULT = {
	snapshotId: "snap_projection_1",
	snapshotSequence: 4,
	chats: [PROJECTION_CHAT],
	hasMore: false,
};

function fakeSessionHost() {
	return {
		subscribe: vi.fn(() => () => {}),
		startSession: vi.fn(),
		stopSession: vi.fn(),
		runTurn: vi.fn(),
		abort: vi.fn(),
		dispose: vi.fn(),
		getSession: vi.fn(),
		getAccumulatedUsage: vi.fn(),
		listSessions: vi.fn(),
		deleteSession: vi.fn(),
		updateSession: vi.fn(),
		dispatchHookEvent: vi.fn(),
		readSessionMessages: vi.fn(),
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

function list(clientId: string, payload: Record<string, unknown> = {}) {
	return {
		version: "v1" as const,
		command: "chat_projection.list" as const,
		requestId: "managed-projection-list",
		clientId,
		payload,
	};
}

describe("Hub managed projection wire", () => {
	const transports: HubServerTransport[] = [];

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
	});

	function setup(core: HubWorkspaceManagedCore, enabled = true) {
		const authority = new HubWorkspaceCapabilityAuthority();
		const create = vi.fn(async () => core);
		const pool = new HubWorkspaceManagedCorePool(authority, { create });
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
				principalId: "owner-managed-projection",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		return { create, identity, transport };
	}

	it("keeps projection inert while the managed release gate is off", async () => {
		const invoke = vi.fn(async () => LIST_RESULT);
		const { create, identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				projectionWire: { invoke },
				dispose: vi.fn(async () => {}),
			},
			false,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-disabled"));
		expect(await connection.command(list("client-disabled"))).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(create).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("dispatches only a strict frozen audience-scoped projection request", async () => {
		const invoke = vi.fn(
			async (_input: HubWorkspaceManagedProjectionInvocation) => LIST_RESULT,
		);
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			projectionWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-projection"));
		expect(
			await connection.command(
				list("client-projection", { catalogState: "active", limit: 1 }),
			),
		).toMatchObject({ ok: true, payload: { result: LIST_RESULT } });
		const invocation = invoke.mock.calls[0]?.[0];
		expect(invocation).toMatchObject({
			identity,
			command: "chat_projection.list",
			payload: { catalogState: "active", limit: 1 },
			signal: expect.any(AbortSignal),
		});
		expect(Object.isFrozen(invocation)).toBe(true);
		expect(Object.isFrozen(invocation?.payload)).toBe(true);
	});

	it("rejects malformed, unscoped, and raw-catalog requests before Core use", async () => {
		const invoke = vi.fn(async () => LIST_RESULT);
		const { create, identity, transport } = setup({
			chatLifecycle: {} as never,
			projectionWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const scoped = transport.openConnection(identity);
		await scoped.command(register("client-rejected"));
		expect(
			await scoped.command(list("client-rejected", { limit: 101 })),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		expect(
			await scoped.command({
				version: "v1",
				command: "chat_catalog.get",
				requestId: "raw-catalog-known-id",
				clientId: "client-rejected",
				payload: { chatId: "known-foreign-chat" },
			}),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});

		const unscoped = transport.openUnscopedConnection();
		await unscoped.command(register("client-unscoped"));
		expect(await unscoped.command(list("client-unscoped"))).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(create).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("rejects malformed host results and a missing projection adapter", async () => {
		for (const core of [
			{
				chatLifecycle: {} as never,
				projectionWire: {
					invoke: vi.fn(async () => ({
						...LIST_RESULT,
						workspaceKey: WORKSPACE,
					})),
				},
				dispose: vi.fn(async () => {}),
			},
			{
				chatLifecycle: {} as never,
				dispose: vi.fn(async () => {}),
			},
		] satisfies HubWorkspaceManagedCore[]) {
			const { identity, transport } = setup(core);
			const connection = transport.openConnection(identity);
			const clientId = `client-malformed-${transports.length}`;
			await connection.command(register(clientId));
			expect(await connection.command(list(clientId))).toMatchObject({
				ok: false,
				error: { code: "unsupported_capability" },
			});
		}
	});
});
