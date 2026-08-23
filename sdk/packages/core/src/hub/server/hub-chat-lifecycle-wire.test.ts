import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { resolveManagedWorkspaceCwd } from "./handlers/chat-lifecycle-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedConfirmationRequester,
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
	type HubWorkspaceManagedLifecycleInvocation,
} from "./workspace-managed-core-pool";

const WORKSPACE = resolve("/tmp/hub-chat-lifecycle-wire");
const START_RESULT = {
	sessionId: "session-managed-1",
	chatId: "chat-managed-1",
	leaseRevision: 1,
	writerGeneration: 1,
	leaseExpiresAt: "2026-08-15T12:00:00.000Z",
	profileAuthority: {
		profileId: "profile-managed-default",
		profileRevision: 1,
		authorityClassId: "cline.chat.authority.interactive-owner.v1",
		policyEpoch: 0,
		allowedModes: ["act", "plan", "yolo"],
	},
};
const CHAT_RESULT = {
	chatId: "chat-managed-1",
	catalogState: "archived",
	headSessionId: "session-managed-1",
	sourceKind: "interactive",
	createdAt: "2026-08-15T12:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	revision: 2,
	sessions: [],
	bindings: [],
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

function startRoot(clientId: string, payload: Record<string, unknown> = {}) {
	return {
		version: "v1" as const,
		command: "chat_lifecycle.start_root" as const,
		requestId: "managed-start-root",
		clientId,
		payload: {
			operationId: "operation-managed-1",
			sessionId: "session-managed-1",
			start: { profileId: "profile-managed-default" },
			...payload,
		},
	};
}

function archive(clientId: string, payload: Record<string, unknown> = {}) {
	return {
		version: "v1" as const,
		command: "chat_lifecycle.archive" as const,
		requestId: "managed-archive",
		clientId,
		payload: {
			operationId: "operation-archive-1",
			chatId: "chat-managed-1",
			expectedRevision: 1,
			...payload,
		},
	};
}

function resume(clientId: string, payload: Record<string, unknown> = {}) {
	return {
		version: "v1" as const,
		command: "chat_lifecycle.resume" as const,
		requestId: `managed-resume-${clientId}`,
		clientId,
		payload: {
			operationId: "operation-resume-1",
			sessionId: "session-managed-1",
			start: { profileId: "profile-managed-default" },
			...payload,
		},
	};
}

describe("Hub managed lifecycle wire", () => {
	const transports: HubServerTransport[] = [];

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
	});

	function setup(
		core: HubWorkspaceManagedCore,
		enabled = true,
		requestConfirmation?: HubWorkspaceManagedConfirmationRequester,
	) {
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
			requestConfirmation,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-managed-wire",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		return { authority, create, identity, transport };
	}

	it("keeps a configured managed Core inert until lifecycle is enabled", async () => {
		const invoke = vi.fn(async () => START_RESULT);
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				lifecycleWire: { invoke },
				dispose: vi.fn(async () => {}),
			},
			false,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-disabled"));
		expect(
			await connection.command(startRoot("client-disabled")),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(invoke).not.toHaveBeenCalled();
	});

	it("dispatches a strict frozen request through authenticated workspace scope", async () => {
		const invoke = vi.fn(
			async (_input: HubWorkspaceManagedLifecycleInvocation) => START_RESULT,
		);
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			lifecycleWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		expect(await connection.command(register("client-managed"))).toMatchObject({
			ok: true,
		});

		expect(await connection.command(startRoot("client-managed"))).toMatchObject(
			{
				ok: true,
				payload: { result: START_RESULT },
			},
		);
		expect(invoke).toHaveBeenCalledOnce();
		const invocation = invoke.mock.calls[0]?.[0];
		expect(invocation).toMatchObject({
			identity,
			command: "chat_lifecycle.start_root",
			payload: {
				operationId: "operation-managed-1",
				sessionId: "session-managed-1",
				start: { profileId: "profile-managed-default" },
			},
			signal: expect.any(AbortSignal),
		});
		expect(Object.isFrozen(invocation)).toBe(true);
		expect(Object.isFrozen(invocation?.payload)).toBe(true);
		expect(
			Object.isFrozen(
				(invocation?.payload as { start?: unknown } | undefined)?.start,
			),
		).toBe(true);
	});

	it("binds Core confirmation to the exact lifecycle operation and retires it after dispatch", async () => {
		let retainedConfirm:
			| HubWorkspaceManagedLifecycleInvocation["confirm"]
			| undefined;
		const invoke = vi.fn(
			async (input: HubWorkspaceManagedLifecycleInvocation) => {
				retainedConfirm = input.confirm;
				expect(
					await input.confirm?.({
						confirmation: "archive",
						aggregateKind: "chat",
						aggregateId: "chat-managed-1",
						expectedRevision: 1,
					}),
				).toBe(true);
				return CHAT_RESULT;
			},
		);
		const requestConfirmation = vi.fn(async () => true);
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				lifecycleWire: { invoke },
				dispose: vi.fn(async () => {}),
			},
			true,
			requestConfirmation,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-confirm"));

		expect(await connection.command(archive("client-confirm"))).toMatchObject({
			ok: true,
			payload: { result: CHAT_RESULT },
		});
		expect(requestConfirmation).toHaveBeenCalledWith(
			expect.objectContaining({
				identity,
				command: "chat_lifecycle.archive",
				operationId: "operation-archive-1",
				request: {
					confirmation: "archive",
					aggregateKind: "chat",
					aggregateId: "chat-managed-1",
					expectedRevision: 1,
				},
			}),
		);
		if (!retainedConfirm) throw new Error("Expected retained confirmation.");
		await expect(
			Promise.resolve(
				retainedConfirm({
					confirmation: "archive",
					aggregateKind: "chat",
					aggregateId: "chat-managed-1",
					expectedRevision: 1,
				}),
			),
		).rejects.toBeDefined();
		expect(requestConfirmation).toHaveBeenCalledOnce();
	});

	it("rejects a Core confirmation target that does not match the wire operation", async () => {
		const invoke = vi.fn(
			async (input: HubWorkspaceManagedLifecycleInvocation) => {
				await input.confirm?.({
					confirmation: "purge",
					aggregateKind: "chat",
					aggregateId: "chat-managed-1",
					expectedRevision: 1,
				});
				return CHAT_RESULT;
			},
		);
		const requestConfirmation = vi.fn(async () => true);
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				lifecycleWire: { invoke },
				dispose: vi.fn(async () => {}),
			},
			true,
			requestConfirmation,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-confirm-mismatch"));

		expect(
			await connection.command(archive("client-confirm-mismatch")),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		expect(requestConfirmation).not.toHaveBeenCalled();
	});

	it("rejects caller-supplied confirmation state before Core dispatch", async () => {
		const invoke = vi.fn(async () => CHAT_RESULT);
		const requestConfirmation = vi.fn(async () => true);
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				lifecycleWire: { invoke },
				dispose: vi.fn(async () => {}),
			},
			true,
			requestConfirmation,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-confirm-injection"));

		expect(
			await connection.command(
				archive("client-confirm-injection", {
					confirmed: true,
					confirmationCredential: "caller-supplied-credential",
					confirmation: {
						confirmation: "archive",
						aggregateKind: "chat",
						aggregateId: "chat-managed-1",
					},
				}),
			),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		expect(invoke).not.toHaveBeenCalled();
		expect(requestConfirmation).not.toHaveBeenCalled();
	});

	it("binds archived resume confirmation to its authoritative session projection", async () => {
		const expectedTarget = {
			confirmation: "activate" as const,
			aggregateKind: "chat" as const,
			aggregateId: "chat-managed-1",
			expectedRevision: 4,
		};
		const resolveConfirmationTarget = vi.fn(async () => expectedTarget);
		const invoke = vi.fn(
			async (input: HubWorkspaceManagedLifecycleInvocation) => {
				expect(await input.confirm?.(expectedTarget)).toBe(true);
				return START_RESULT;
			},
		);
		const requestConfirmation = vi.fn(async () => true);
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				lifecycleWire: { invoke, resolveConfirmationTarget },
				dispose: vi.fn(async () => {}),
			},
			true,
			requestConfirmation,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register("client-resume-confirm"));

		expect(
			await connection.command(resume("client-resume-confirm")),
		).toMatchObject({ ok: true, payload: { result: START_RESULT } });
		expect(resolveConfirmationTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				identity,
				command: "chat_lifecycle.resume",
				payload: expect.objectContaining({
					operationId: "operation-resume-1",
					sessionId: "session-managed-1",
				}),
			}),
		);
		expect(requestConfirmation).toHaveBeenCalledWith(
			expect.objectContaining({
				identity,
				command: "chat_lifecycle.resume",
				operationId: "operation-resume-1",
				request: expectedTarget,
			}),
		);
	});

	it.each([
		{
			label: "unrelated chat",
			request: {
				confirmation: "activate" as const,
				aggregateKind: "chat" as const,
				aggregateId: "chat-managed-foreign",
				expectedRevision: 4,
			},
		},
		{
			label: "wrong revision",
			request: {
				confirmation: "activate" as const,
				aggregateKind: "chat" as const,
				aggregateId: "chat-managed-1",
				expectedRevision: 5,
			},
		},
	])("rejects archived resume confirmation for $label", async ({ request }) => {
		const expectedTarget = {
			confirmation: "activate" as const,
			aggregateKind: "chat" as const,
			aggregateId: "chat-managed-1",
			expectedRevision: 4,
		};
		const invoke = vi.fn(
			async (input: HubWorkspaceManagedLifecycleInvocation) => {
				await input.confirm?.(request);
				return START_RESULT;
			},
		);
		const requestConfirmation = vi.fn(async () => true);
		const clientId = `client-resume-mismatch-${transports.length}`;
		const { identity, transport } = setup(
			{
				chatLifecycle: {} as never,
				lifecycleWire: {
					invoke,
					resolveConfirmationTarget: vi.fn(async () => expectedTarget),
				},
				dispose: vi.fn(async () => {}),
			},
			true,
			requestConfirmation,
		);
		const connection = transport.openConnection(identity);
		await connection.command(register(clientId));

		expect(await connection.command(resume(clientId))).toMatchObject({
			ok: false,
			error: { code: "invalid_input" },
		});
		expect(requestConfirmation).not.toHaveBeenCalled();
	});

	it("canonicalizes contained cwd hints and rejects symlink escapes", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "hub-lifecycle-workspace-"));
		const outside = await mkdtemp(join(tmpdir(), "hub-lifecycle-outside-"));
		try {
			await mkdir(join(workspace, "packages", "core"), { recursive: true });
			await symlink(outside, join(workspace, "escape"));
			const canonicalWorkspace = await realpath(workspace);
			await expect(
				resolveManagedWorkspaceCwd(workspace, "packages/core"),
			).resolves.toBe(join(canonicalWorkspace, "packages", "core"));
			await expect(
				resolveManagedWorkspaceCwd(workspace, "escape"),
			).rejects.toMatchObject({ code: "invalid_input" });
		} finally {
			await rm(workspace, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("denies unscoped commands and forged authority before Core construction", async () => {
		const invoke = vi.fn(
			async (_input: HubWorkspaceManagedLifecycleInvocation) => START_RESULT,
		);
		const { create, transport } = setup({
			chatLifecycle: {} as never,
			lifecycleWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openUnscopedConnection();
		expect(await connection.command(register("client-unscoped"))).toMatchObject(
			{
				ok: true,
			},
		);
		expect(
			await connection.command(startRoot("client-unscoped")),
		).toMatchObject({ ok: false, error: { code: "unsupported_capability" } });
		expect(
			await transport.handleCommand(
				startRoot("client-unscoped", { workspaceRoot: "/tmp/forged" }),
			),
		).toMatchObject({ ok: false });
		expect(create).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("requires successful transport registration for lifecycle dispatch", async () => {
		const invoke = vi.fn(
			async (_input: HubWorkspaceManagedLifecycleInvocation) => START_RESULT,
		);
		const { identity, transport } = setup({
			chatLifecycle: {} as never,
			lifecycleWire: { invoke },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		expect(
			await connection.command(startRoot("client-never-registered")),
		).toMatchObject({
			ok: false,
			error: { code: "client_not_registered" },
		});
		expect(
			await connection.command({ ...startRoot("unused"), clientId: undefined }),
		).toMatchObject({
			ok: false,
			error: { code: "client_not_registered" },
		});
		expect(invoke).not.toHaveBeenCalled();
	});

	it("rejects malformed host results and missing lifecycle adapters", async () => {
		for (const core of [
			{
				chatLifecycle: {} as never,
				lifecycleWire: {
					invoke: vi.fn(async () => ({
						...START_RESULT,
						leaseToken: "must-not-cross",
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
			expect(await connection.command(startRoot(clientId))).toMatchObject({
				ok: false,
				error: { code: "unsupported_capability" },
			});
		}
	});

	it("aborts the invocation and withholds a late result after revocation", async () => {
		let observedSignal: AbortSignal | undefined;
		let finish: (() => void) | undefined;
		const invoke = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
			observedSignal = signal;
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return START_RESULT;
		});
		const { authority, identity, transport } = setup({
			chatLifecycle: {} as never,
			lifecycleWire: { invoke: invoke as never },
			dispose: vi.fn(async () => {}),
		});
		const connection = transport.openConnection(identity);
		await connection.command(register("client-revoked"));
		const pending = connection.command(startRoot("client-revoked"));
		await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
		authority.revokeWorkspace({ workspaceKey: identity.workspaceKey });
		expect(observedSignal?.aborted).toBe(true);
		finish?.();
		expect(await pending).toMatchObject({ ok: false });
	});
});
