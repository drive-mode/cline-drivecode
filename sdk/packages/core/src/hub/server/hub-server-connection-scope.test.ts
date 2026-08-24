import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueChatCatalogAuthority } from "../../chat-catalog/chat-catalog-authority";
import { HubChatCatalogConfirmationBroker } from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
} from "./workspace-managed-core-pool";

const WORKSPACE = resolve("/tmp/hub-server-connection-scope");

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
		listSessions: vi.fn(async () => []),
		deleteSession: vi.fn(),
		updateSession: vi.fn(),
		dispatchHookEvent: vi.fn(),
		readSessionMessages: vi.fn(),
	} as never;
}

function createTransport(authority = new HubWorkspaceCapabilityAuthority()) {
	return {
		authority,
		transport: new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
			},
			authority,
		),
	};
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

describe("HubServerTransport connection scope", () => {
	const transports: HubServerTransport[] = [];

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
	});

	it("binds registration, update, unregister, subscription, and cleanup to one handle", async () => {
		const { transport } = createTransport();
		transports.push(transport);
		const first = transport.openUnscopedConnection();
		const second = transport.openUnscopedConnection();

		expect(await first.command(register("client-1"))).toMatchObject({
			ok: true,
		});
		expect(await second.command(register("client-1"))).toMatchObject({
			ok: false,
			error: { code: "client_conflict" },
		});
		for (const command of ["client.update", "client.unregister"] as const) {
			expect(
				await second.command({
					version: "v1",
					command,
					requestId: `spoof-${command}`,
					clientId: "client-1",
				}),
			).toMatchObject({
				ok: false,
				error: { code: "client_not_registered" },
			});
		}
		expect(() => second.subscribe("client-1", () => {})).toThrow(
			"registered client identity",
		);
		const unsubscribe = await first.subscribe("client-1", () => {});
		first.closeConnection();
		expect(() => unsubscribe()).not.toThrow();

		expect(await second.command(register("client-2"))).toMatchObject({
			ok: true,
		});
		const listed = await second.command({
			version: "v1",
			command: "client.list",
			requestId: "list-after-close",
			clientId: "client-2",
		});
		expect(listed.payload?.clients).toEqual([
			expect.objectContaining({ clientId: "client-2" }),
		]);
	});

	it("enforces the resource-policy subscription bound per connection", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const host = fakeSessionHost() as unknown as {
			subscribe: ReturnType<typeof vi.fn>;
		};
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: host as never,
				resourcePolicy: {
					transport: { websocket: { maxActiveSubscriptions: 1 } },
				},
			},
			authority,
		);
		transports.push(transport);
		const connection = transport.openUnscopedConnection();
		expect(await connection.command(register("client-bounded"))).toMatchObject({
			ok: true,
		});

		const release = await connection.subscribe("client-bounded", vi.fn());
		expect(() => connection.subscribe("client-bounded", vi.fn())).toThrow(
			"active subscription bound",
		);
		release();
		const replacement = await connection.subscribe("client-bounded", vi.fn());
		expect(typeof replacement).toBe("function");
		replacement();
	});

	it("counts asynchronous source setup against the subscription bound", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		let resolveCore: ((core: HubWorkspaceManagedCore) => void) | undefined;
		const managedCores = new HubWorkspaceManagedCorePool(authority, {
			create: vi.fn(
				() =>
					new Promise<HubWorkspaceManagedCore>((resolve) => {
						resolveCore = resolve;
					}),
			),
		});
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
				resourcePolicy: {
					transport: { websocket: { maxActiveSubscriptions: 1 } },
				},
			},
			authority,
			managedCores,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-pending-subscription",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		const connection = transport.openConnection(identity);
		expect(
			await connection.command(register("client-pending-subscription")),
		).toMatchObject({ ok: true });

		const first = connection.subscribe("client-pending-subscription", vi.fn(), {
			sessionId: "session-1",
		});
		await vi.waitFor(() => expect(resolveCore).toBeTypeOf("function"));
		expect(() =>
			connection.subscribe("client-pending-subscription", vi.fn(), {
				sessionId: "session-2",
			}),
		).toThrow("active subscription bound");

		resolveCore?.({
			chatLifecycle: {} as never,
			eventWire: { subscribe: () => vi.fn() },
			dispose: vi.fn(async () => {}),
		});
		const release = await first;
		release();
	});

	it("accepts only identities from its private authority and fences revocation", async () => {
		const { authority, transport } = createTransport();
		transports.push(transport);
		const foreignAuthority = new HubWorkspaceCapabilityAuthority();
		const foreignIdentity = foreignAuthority.consume({
			credential: foreignAuthority.issue({
				principalId: "owner-foreign",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		expect(() => transport.openConnection(foreignIdentity)).toThrow(
			"invalid or revoked",
		);

		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		const connection = transport.openConnection(identity);
		expect(await connection.command(register("client-auth"))).toMatchObject({
			ok: true,
		});
		authority.revokeWorkspace({ workspaceKey: WORKSPACE });

		expect(
			await connection.command({
				version: "v1",
				command: "client.list",
				requestId: "after-revoke",
				clientId: "client-auth",
			}),
		).toMatchObject({
			ok: false,
			error: { code: "workspace_connection_revoked" },
		});
		expect(() => connection.subscribe("client-auth", () => {})).toThrow(
			"invalid or revoked",
		);
		connection.closeConnection();
	});

	it("revokes pending catalog confirmations when the connection closes", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const confirmationBroker = new HubChatCatalogConfirmationBroker();
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
				chatCatalog: {
					port: {} as never,
					confirmationBroker,
					authorize: vi.fn() as never,
				},
			},
			authority,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-confirmation-close",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		const connection = transport.openConnection(identity);
		const target = {
			confirmation: "purge" as const,
			invocationId: "purge-on-close",
			aggregateKind: "chat" as const,
			aggregateId: "chat-on-close",
			expectedRevision: 2,
		};
		const grant = confirmationBroker.issue({
			authenticatedClientId: identity.connectionId,
			target,
		});

		connection.closeConnection();

		expect(() =>
			confirmationBroker.consume({
				authenticatedClientId: identity.connectionId,
				credential: grant.credential,
				target,
			}),
		).toThrow("missing, mismatched, expired, or consumed");
	});

	it("rechecks workspace authority after asynchronous host authorization", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const listChats = vi.fn();
		let resolveAuthorization:
			| ((context: ReturnType<typeof issueChatCatalogAuthority>) => void)
			| undefined;
		const authorize = vi.fn(
			() =>
				new Promise<ReturnType<typeof issueChatCatalogAuthority>>((resolve) => {
					resolveAuthorization = resolve;
				}),
		);
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
				chatCatalog: {
					port: { listChats } as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize,
				},
			},
			authority,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-authorization-race",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		const connection = transport.openConnection(identity);
		expect(
			await connection.command(register("client-authorization-race")),
		).toMatchObject({
			ok: true,
		});
		const pending = connection.command({
			version: "v1",
			command: "chat_catalog.list",
			requestId: "list-authorization-race",
			clientId: "client-authorization-race",
			payload: {},
		});
		await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce());
		authority.revokeWorkspace({ workspaceKey: identity.workspaceKey });
		resolveAuthorization?.(
			issueChatCatalogAuthority({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
				actorKind: "human",
				source: {
					kind: "hub",
					clientId: identity.connectionId,
					transport: identity.transport,
				},
			}),
		);

		expect(await pending).toMatchObject({ ok: false });
		expect(listChats).not.toHaveBeenCalled();
	});

	it("denies raw commands and unfenced subscriptions before Core while preserving legacy unscoped traffic", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const create = vi.fn(async () => ({
			chatLifecycle: {} as never,
			dispose: vi.fn(async () => {}),
		}));
		const managedCores = new HubWorkspaceManagedCorePool(authority, { create });
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
			},
			authority,
			managedCores,
		);
		transports.push(transport);
		const authenticated = authority.consume({
			credential: authority.issue({
				principalId: "owner-managed-wire",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		const connections = [
			{
				clientId: "client-managed-wire-scoped",
				connection: transport.openConnection(authenticated),
				scoped: true,
			},
			{
				clientId: "client-managed-wire-unscoped",
				connection: transport.openUnscopedConnection(),
				scoped: false,
			},
		];
		for (const { clientId, connection, scoped } of connections) {
			const registration = register(clientId);
			if (scoped) {
				registration.payload = {
					...registration.payload,
					metadata: { workspaceRoot: "/secret/metadata" },
					workspaceContext: {
						workspaceRoot: "/secret/workspace",
						cwd: "/secret/cwd",
					},
					capabilities: [{ name: "secret-capability" }],
				} as never;
			}
			expect(await connection.command(registration)).toMatchObject({
				ok: true,
			});
			for (const command of [
				"client.list",
				"session.list",
				"run.abort",
				"schedule.create",
				"drive.wave.run",
				"status.tasks_snapshot",
			] as const) {
				const reply = await connection.command({
					version: "v1",
					command,
					requestId: `managed-deny-${clientId}-${command}`,
					clientId,
					payload: {},
				});
				if (scoped) {
					expect(reply).toMatchObject({
						ok: false,
						error: { code: "unsupported_capability" },
					});
				} else if (command === "client.list" || command === "session.list") {
					expect(reply).toMatchObject({ ok: true });
				}
			}
			if (scoped) expect(create).not.toHaveBeenCalled();
			if (scoped) {
				await expect(
					connection.subscribe(clientId, () => {}),
				).rejects.toMatchObject({ code: "invalid_input" });
			} else {
				const unsubscribe = await connection.subscribe(clientId, () => {});
				expect(typeof unsubscribe).toBe("function");
				unsubscribe();
			}
		}
		const scoped = connections[0];
		if (!scoped) throw new Error("Expected scoped connection.");
		expect(
			await scoped.connection.command({
				version: "v1",
				command: "client.update",
				requestId: "update-sanitized-managed-client",
				clientId: scoped.clientId,
				payload: { metadata: { cwd: "/secret/update" } },
			}),
		).toMatchObject({ ok: true });
		const unscoped = connections[1];
		if (!unscoped) throw new Error("Expected unscoped connection.");
		const listed = await unscoped.connection.command({
			version: "v1",
			command: "client.list",
			requestId: "list-sanitized-managed-client",
			clientId: unscoped.clientId,
		});
		expect(JSON.stringify(listed)).not.toContain("/secret/");
		expect(listed.payload?.clients).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clientId: "client-managed-wire-scoped",
					capabilities: [],
				}),
			]),
		);
		expect(() =>
			transport.subscribe("direct-managed-client", () => {}),
		).not.toThrow();
		expect(
			await transport.handleCommand(register("direct-managed")),
		).toMatchObject({ ok: true });
		expect(create).not.toHaveBeenCalled();
	});

	it("keeps a configured managed factory inert while the release gate is off", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const authorize = vi.fn();
		const create = vi.fn(async () => ({
			chatLifecycle: {} as never,
			dispose: vi.fn(async () => {}),
		}));
		const managedCores = new HubWorkspaceManagedCorePool(authority, { create });
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: false,
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: authorize as never,
				},
			},
			authority,
			managedCores,
		);
		transports.push(transport);
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-inert-factory",
				workspaceKey: WORKSPACE,
			}).credential,
			transport: "websocket",
		});
		const connection = transport.openConnection(identity);
		expect(
			await connection.command(register("client-inert-factory")),
		).toMatchObject({ ok: true });
		expect(
			await connection.command({
				version: "v1",
				command: "session.list",
				requestId: "inert-factory-session-list",
				clientId: "client-inert-factory",
				payload: {},
			}),
		).toMatchObject({ ok: true });
		expect(
			await connection.command({
				version: "v1",
				command: "chat_catalog.list",
				requestId: "inert-factory-catalog-list",
				clientId: "client-inert-factory",
				payload: {},
			}),
		).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(authorize).not.toHaveBeenCalled();
		const unsubscribe = await connection.subscribe(
			"client-inert-factory",
			() => {},
		);
		unsubscribe();
		expect(create).not.toHaveBeenCalled();
	});
});
