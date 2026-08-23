import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
	type HubWorkspaceManagedRuntimeInvocation,
} from "./workspace-managed-core-pool";

const WORKSPACE = resolve("/tmp/hub-chat-runtime-wire");
const ABORT_RESULT = {
	operationId: "operation-abort-1",
	sessionId: "session-managed-1",
	runId: "run-managed-1",
	accepted: true,
};

const RECLAIM_RESULT = {
	sessionId: "session-managed-1",
	leaseRevision: 2,
	writerGeneration: 2,
	leaseExpiresAt: "2026-08-15T12:02:00.000Z",
	ownerTransferred: true,
};

const RECLAIM_CANCEL_RESULT = {
	operationId: "operation-reclaim-1",
	sessionId: "session-managed-1",
	writerGeneration: 2,
	cancellationAccepted: true,
};

const RUNTIME_BASELINE = {
	streamId: "runtime-stream-managed-1",
	sessionSequence: 4,
};

const CONTINUITY_RESULT = {
	sessionId: "session-managed-1",
	state: "orphaned" as const,
	writerGeneration: 1,
	runtimeBaseline: RUNTIME_BASELINE,
};

const HYDRATION_RESULT = {
	sessionId: "session-managed-1",
	chatId: "chat-managed-1",
	writerGeneration: 2,
	profileAuthority: {
		profileId: "cline.chat.interactive.v1",
		profileRevision: 1,
		authorityClassId: "cline.chat.authority.interactive-owner.v1",
		policyEpoch: 1,
		allowedModes: ["act", "plan"] as const,
	},
	requestedBaseline: RUNTIME_BASELINE,
	runtimeBaseline: RUNTIME_BASELINE,
	replayAvailable: true,
	messages: [],
	messagesTruncated: false,
	pendingPrompts: [],
	pendingPromptsTruncated: false,
	checkpoints: [],
	checkpointsTruncated: false,
	compaction: null,
};

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

function abortTurn(clientId: string, payload: Record<string, unknown> = {}) {
	return {
		version: "v1" as const,
		command: "chat_runtime.abort" as const,
		requestId: "managed-abort",
		clientId,
		payload: {
			operationId: "operation-abort-1",
			sessionId: "session-managed-1",
			runId: "run-managed-1",
			...payload,
		},
	};
}

function reclaimSession(clientId: string) {
	return {
		version: "v1" as const,
		command: "chat_runtime.session.reclaim" as const,
		requestId: "managed-reclaim",
		clientId,
		payload: {
			operationId: "operation-reclaim-1",
			sessionId: "session-managed-1",
			expectedWriterGeneration: 1,
		},
	};
}

function cancelReclaim(clientId: string) {
	return {
		version: "v1" as const,
		command: "chat_runtime.session.reclaim.cancel" as const,
		requestId: "managed-reclaim-cancel",
		clientId,
		payload: {
			operationId: "operation-reclaim-1",
			sessionId: "session-managed-1",
			expectedWriterGeneration: 1,
		},
	};
}

function inspectContinuity(
	clientId: string,
	payload: Record<string, unknown> = {},
) {
	return {
		version: "v1" as const,
		command: "chat_runtime.session.continuity" as const,
		requestId: "managed-continuity",
		clientId,
		payload: {
			sessionId: "session-managed-1",
			...payload,
		},
	};
}

function hydrateSession(clientId: string) {
	return {
		version: "v1" as const,
		command: "chat_runtime.session.hydrate" as const,
		requestId: "managed-hydrate",
		clientId,
		payload: {
			sessionId: "session-managed-1",
			expectedWriterGeneration: 2,
			baseline: RUNTIME_BASELINE,
		},
	};
}

describe("Hub managed runtime wire", () => {
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
				principalId: "owner-managed-runtime",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		return { authority, create, identity, transport };
	}

	it("keeps a configured runtime adapter inert until managed chat is enabled", async () => {
		const invoke = vi.fn(async () => ABORT_RESULT);
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				runtimeWire: { invoke },
				dispose: vi.fn(async () => {}),
			},
			false,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime-disabled"));
		expect(
			await connection.command(abortTurn("client-runtime-disabled")),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(invoke).not.toHaveBeenCalled();
	});

	it("gates and dispatches the strict reclaim command through authenticated scope", async () => {
		const disabledInvoke = vi.fn(async () => RECLAIM_RESULT);
		const disabled = setup(
			{
				chatLifecycle: {} as never,
				runtimeWire: { invoke: disabledInvoke },
				dispose: vi.fn(async () => {}),
			},
			false,
		);
		const disabledConnection = disabled.transport.openConnection(
			disabled.identity,
		);
		await disabledConnection.command(register("client-reclaim-disabled"));
		expect(
			await disabledConnection.command(
				reclaimSession("client-reclaim-disabled"),
			),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(disabledInvoke).not.toHaveBeenCalled();

		const invoke = vi.fn(async (input: HubWorkspaceManagedRuntimeInvocation) =>
			input.command === "chat_runtime.session.reclaim.cancel"
				? RECLAIM_CANCEL_RESULT
				: RECLAIM_RESULT,
		);
		const enabled = setup({
			chatLifecycle: {} as never,
			runtimeWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = enabled.transport.openConnection(enabled.identity);
		await connection.command(register("client-reclaim-enabled"));
		expect(
			await connection.command(reclaimSession("client-reclaim-enabled")),
		).toMatchObject({
			ok: true,
			payload: { result: RECLAIM_RESULT },
		});
		expect(invoke).toHaveBeenCalledWith(
			expect.objectContaining({
				identity: enabled.identity,
				command: "chat_runtime.session.reclaim",
				payload: {
					operationId: "operation-reclaim-1",
					sessionId: "session-managed-1",
					expectedWriterGeneration: 1,
				},
				signal: expect.any(AbortSignal),
			}),
		);
		expect(
			await connection.command(cancelReclaim("client-reclaim-enabled")),
		).toMatchObject({
			ok: true,
			payload: { result: RECLAIM_CANCEL_RESULT },
		});
		expect(invoke).toHaveBeenLastCalledWith(
			expect.objectContaining({
				identity: enabled.identity,
				command: "chat_runtime.session.reclaim.cancel",
				payload: {
					operationId: "operation-reclaim-1",
					sessionId: "session-managed-1",
					expectedWriterGeneration: 1,
				},
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("routes strict continuity and bounded hydration through authenticated scope", async () => {
		const invoke = vi.fn(async (input: HubWorkspaceManagedRuntimeInvocation) =>
			input.command === "chat_runtime.session.continuity"
				? CONTINUITY_RESULT
				: HYDRATION_RESULT,
		);
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			runtimeWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-continuity-enabled"));

		expect(
			await connection.command(inspectContinuity("client-continuity-enabled")),
		).toMatchObject({
			ok: true,
			payload: { result: CONTINUITY_RESULT },
		});
		expect(
			await connection.command(hydrateSession("client-continuity-enabled")),
		).toMatchObject({
			ok: true,
			payload: { result: HYDRATION_RESULT },
		});
		expect(invoke).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				identity,
				command: "chat_runtime.session.continuity",
				payload: { sessionId: "session-managed-1" },
				signal: expect.any(AbortSignal),
			}),
		);
		expect(invoke).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				identity,
				command: "chat_runtime.session.hydrate",
				payload: {
					sessionId: "session-managed-1",
					expectedWriterGeneration: 2,
					baseline: RUNTIME_BASELINE,
				},
				signal: expect.any(AbortSignal),
			}),
		);

		expect(
			await connection.command(
				inspectContinuity("client-continuity-enabled", {
					ownerCredential: "must-not-cross-wire",
				}),
			),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it("dispatches a strict frozen request through authenticated scope", async () => {
		const invoke = vi.fn(
			async (_input: HubWorkspaceManagedRuntimeInvocation) => ABORT_RESULT,
		);
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			runtimeWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime"));
		expect(await connection.command(abortTurn("client-runtime"))).toMatchObject(
			{
				ok: true,
				payload: { result: ABORT_RESULT },
			},
		);
		const invocation = invoke.mock.calls[0]?.[0];
		expect(invocation).toMatchObject({
			identity,
			command: "chat_runtime.abort",
			payload: {
				operationId: "operation-abort-1",
				sessionId: "session-managed-1",
				runId: "run-managed-1",
			},
			signal: expect.any(AbortSignal),
		});
		expect(Object.isFrozen(invocation)).toBe(true);
		expect(Object.isFrozen(invocation?.payload)).toBe(true);
	});

	it("requires registration, scope, run correlation, and strict results", async () => {
		const invoke = vi.fn(async () => ({ ...ABORT_RESULT, cwd: WORKSPACE }));
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			runtimeWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		expect(
			await connection.command(abortTurn("never-registered")),
		).toMatchObject({ ok: false, error: { code: "client_not_registered" } });
		await connection.command(register("client-runtime-strict"));
		expect(
			await connection.command(
				abortTurn("client-runtime-strict", { runId: undefined }),
			),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		expect(invoke).not.toHaveBeenCalled();
		expect(
			await connection.command(abortTurn("client-runtime-strict")),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});

		const unscoped = transport.openUnscopedConnection();
		await unscoped.command(register("client-runtime-unscoped"));
		expect(
			await unscoped.command(abortTurn("client-runtime-unscoped")),
		).toMatchObject({ ok: false, error: { code: "unsupported_capability" } });
	});

	it("fails closed when the resident Core has no runtime adapter", async () => {
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime-missing"));
		expect(
			await connection.command(abortTurn("client-runtime-missing")),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
	});

	it("aborts invocation and withholds late output after revocation", async () => {
		let observedSignal: AbortSignal | undefined;
		let finish: (() => void) | undefined;
		const invoke = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
			observedSignal = signal;
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return ABORT_RESULT;
		});
		const { authority, identity, transport } = setup({
			chatLifecycle: {} as never,
			runtimeWire: { invoke: invoke as never },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-runtime-revoked"));
		const pending = connection.command(abortTurn("client-runtime-revoked"));
		await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
		authority.revokeWorkspace({ workspaceKey: identity.workspaceKey });
		expect(observedSignal?.aborted).toBe(true);
		finish?.();
		expect(await pending).toMatchObject({ ok: false });
	});
});
