import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { HubChatCatalogConfirmationBroker } from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import type {
	HubWebSocketServer,
	HubWorkspaceCatalogConfirmationRequest,
} from "./hub-server-options";
import { startHubWebSocketServer } from "./hub-websocket-server";

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

async function openWorkspaceSocket(
	url: string,
	credential: string,
): Promise<WebSocket> {
	const socket = new WebSocket(url, [`cline-hub-workspace.${credential}`]);
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", reject);
	});
	return socket;
}

async function rejectedUpgradeStatus(
	url: string,
	credential: string,
): Promise<number | undefined> {
	const socket = new WebSocket(url, [`cline-hub-workspace.${credential}`]);
	return await new Promise<number | undefined>((resolve, reject) => {
		socket.once("open", () => {
			socket.close();
			reject(new Error("Expected workspace upgrade rejection."));
		});
		socket.once("unexpected-response", (_request, response) => {
			resolve(response.statusCode);
		});
		socket.once("error", () => resolve(undefined));
	});
}

describe("Hub in-process workspace upgrade", () => {
	const servers = new Set<HubWebSocketServer>();
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const server of servers) await server.close();
		servers.clear();
		for (const path of tempDirs.splice(0)) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("consumes one opaque-ID grant, rejects replay, and closes on epoch revoke", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-upgrade-"));
		tempDirs.push(root);
		const discoveryPath = join(root, "hub-discovery.json");
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: {
				ownerId: "owner-workspace-upgrade",
				discoveryPath,
			},
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker: new HubChatCatalogConfirmationBroker(),
				authorize: vi.fn() as never,
			},
			workspaceAuthority: { trustedWorkspaceKeys: [root] },
		});
		servers.add(server);
		if (process.platform !== "win32") {
			expect(statSync(discoveryPath).mode & 0o777).toBe(0o600);
		}
		const control = server.workspaceAuthority;
		expect(control).toBeDefined();
		if (!control) throw new Error("Expected workspace authority control.");
		const registrations = control.list();
		expect(registrations).toHaveLength(1);
		expect(JSON.stringify(registrations)).not.toContain(root);
		const grant = control.issue({
			workspaceId: registrations[0]?.workspaceId ?? "",
		});

		const socket = await openWorkspaceSocket(server.url, grant.credential);
		expect(await rejectedUpgradeStatus(server.url, grant.credential)).toBe(401);
		const close = new Promise<number>((resolve) => {
			socket.once("close", (code) => resolve(code));
		});
		await control.revoke(registrations[0]?.workspaceId ?? "");
		expect(await close).toBe(4003);

		const versionUrl = new URL(server.url);
		versionUrl.protocol = "http:";
		versionUrl.pathname = "/version";
		const version = (await (await fetch(versionUrl)).json()) as {
			capabilities?: string[];
		};
		expect(version.capabilities).not.toContain("chat_catalog.v1");
		versionUrl.pathname = "/workspace-capability";
		const unauthorizedMint = await fetch(versionUrl, { method: "POST" });
		expect(unauthorizedMint.status).toBe(401);
		const selectorMint = await fetch(versionUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${server.authToken}` },
			body: JSON.stringify({ workspaceId: "forged-selector" }),
		});
		expect(selectorMint.status).toBe(400);
		const querySelectorUrl = new URL(versionUrl);
		querySelectorUrl.searchParams.set("workspaceId", "forged-selector");
		const querySelectorMint = await fetch(querySelectorUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${server.authToken}` },
		});
		expect(querySelectorMint.status).toBe(400);
		const mintResponse = await fetch(versionUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${server.authToken}` },
		});
		expect(mintResponse.status).toBe(201);
		expect(mintResponse.headers.get("cache-control")).toBe("no-store");
		const minted = (await mintResponse.json()) as Record<string, unknown>;
		expect(Object.keys(minted).sort()).toEqual(["credential", "expiresAt"]);
		expect(JSON.stringify(minted)).not.toContain(root);
		const ownerMintedSocket = await openWorkspaceSocket(
			server.url,
			String(minted.credential),
		);
		ownerMintedSocket.close();
	});

	it("requires trusted installed-instance issuance for connector classes", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-instance-bound-"));
		tempDirs.push(root);
		const interactivePolicy = {
			authorityClassId: "interactive.owner.v1",
			audienceId: "aud_interactive_owner_v1",
			policyEpoch: 1,
			allowedStartProfileIds: ["interactive.v1"],
			allowedBindingProfileIds: [],
		};
		const connectorPolicy = {
			authorityClassId: "connector.slack.v1",
			audienceId: "aud_connector_slack_bootstrap_v1",
			policyEpoch: 1,
			allowedStartProfileIds: ["connector.slack.v1"],
			allowedBindingProfileIds: ["connector.slack.v1"],
		};
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: {
				ownerId: "owner-instance-bound-upgrade",
				discoveryPath: join(root, "hub-discovery.json"),
			},
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker: new HubChatCatalogConfirmationBroker(),
				authorize: vi.fn() as never,
			},
			workspaceAuthority: {
				trustedWorkspaceKeys: [root],
				connectionPolicies: [interactivePolicy, connectorPolicy],
				defaultConnectionPolicy: interactivePolicy,
				instanceBoundAuthorityClassIds: [connectorPolicy.authorityClassId],
			},
		});
		servers.add(server);
		const control = server.workspaceAuthority;
		if (!control) throw new Error("Expected workspace authority control.");
		const registration = control.list()[0];
		if (!registration) throw new Error("Expected workspace registration.");

		expect(() =>
			control.issue({
				workspaceId: registration.workspaceId,
				authorityClassId: connectorPolicy.authorityClassId,
			}),
		).toThrow("requires an installed-instance binding");
		expect(() =>
			control.issueForInstalledInstance({
				workspaceId: registration.workspaceId,
				authorityClassId: interactivePolicy.authorityClassId,
				installedInstanceId: "forged-default-instance",
			}),
		).toThrow("class is unavailable");

		const first = await openWorkspaceSocket(
			server.url,
			control.issueForInstalledInstance({
				workspaceId: registration.workspaceId,
				authorityClassId: connectorPolicy.authorityClassId,
				installedInstanceId: "slack:installation-a",
			}).credential,
		);
		const second = await openWorkspaceSocket(
			server.url,
			control.issueForInstalledInstance({
				workspaceId: registration.workspaceId,
				authorityClassId: connectorPolicy.authorityClassId,
				installedInstanceId: "slack:installation-b",
			}).credential,
		);
		expect(
			control
				.listConnections()
				.map((connection) => connection.authorityClassId),
		).toEqual([
			connectorPolicy.authorityClassId,
			connectorPolicy.authorityClassId,
		]);
		first.close();
		second.close();
	});

	it("issues pathless connection-bound confirmation and revokes it with the workspace", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-confirmation-"));
		tempDirs.push(root);
		const confirmationBroker = new HubChatCatalogConfirmationBroker();
		const confirmCatalogMutation = vi.fn(
			async (_request: HubWorkspaceCatalogConfirmationRequest) => true,
		);
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: {
				ownerId: "owner-workspace-confirmation",
				discoveryPath: join(root, "hub-discovery.json"),
			},
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker,
				authorize: vi.fn() as never,
			},
			workspaceAuthority: {
				trustedWorkspaceKeys: [root],
				confirmCatalogMutation,
			},
		});
		servers.add(server);
		const control = server.workspaceAuthority;
		if (!control) throw new Error("Expected workspace authority control.");
		const registration = control.list()[0];
		if (!registration) throw new Error("Expected workspace registration.");
		const socket = await openWorkspaceSocket(
			server.url,
			control.issue({ workspaceId: registration.workspaceId }).credential,
		);
		const connection = control.listConnections()[0];
		if (!connection) throw new Error("Expected active workspace connection.");
		expect(JSON.stringify(connection)).not.toContain(root);
		const target = {
			confirmation: "archive" as const,
			invocationId: "archive-confirmation-1",
			aggregateKind: "chat" as const,
			aggregateId: "chat-confirmation-1",
			expectedRevision: 3,
			effects: ["clear_bindings" as const],
		};
		const grant = await control.requestCatalogConfirmation({
			connectionId: connection.connectionId,
			target,
		});
		expect(confirmCatalogMutation).toHaveBeenCalledWith({
			target: {
				confirmation: target.confirmation,
				aggregateKind: target.aggregateKind,
				aggregateId: target.aggregateId,
				expectedRevision: target.expectedRevision,
				effects: target.effects,
			},
			signal: expect.any(AbortSignal),
		});
		const prompt = confirmCatalogMutation.mock.calls[0]?.[0];
		expect(Object.isFrozen(prompt)).toBe(true);
		expect(Object.isFrozen(prompt?.target)).toBe(true);
		expect(Object.isFrozen(prompt?.target.effects)).toBe(true);
		const serializedPrompt = JSON.stringify(prompt);
		expect(serializedPrompt).not.toContain(root);
		expect(serializedPrompt).not.toContain(target.invocationId);
		for (const privateValue of [
			connection.connectionId,
			connection.principalId,
			connection.tenantId,
			connection.workspaceId,
			connection.authorityClassId,
		]) {
			expect(serializedPrompt).not.toContain(privateValue);
		}
		for (const privateField of [
			"connectionId",
			"principalId",
			"tenantId",
			"workspaceId",
			"workspaceEpoch",
			"authorityClassId",
			"policyEpoch",
			"authenticatedAt",
		]) {
			expect(serializedPrompt).not.toContain(privateField);
		}
		expect(grant.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const close = new Promise<number>((resolve) => {
			socket.once("close", (code) => resolve(code));
		});
		await control.revoke(registration.workspaceId);
		expect(() =>
			confirmationBroker.consume({
				authenticatedClientId: connection.connectionId,
				credential: grant.credential,
				target,
			}),
		).toThrow("missing, mismatched, expired, or consumed");
		expect(await close).toBe(4003);
		expect(control.listConnections()).toEqual([]);
	});

	it("does not mint after workspace revocation during human confirmation", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-confirm-race-"));
		tempDirs.push(root);
		let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
		let promptSignal: AbortSignal | undefined;
		const confirmCatalogMutation = vi.fn(
			(request: HubWorkspaceCatalogConfirmationRequest) => {
				promptSignal = request.signal;
				return new Promise<boolean>((resolve) => {
					resolveConfirmation = resolve;
				});
			},
		);
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: {
				ownerId: "owner-workspace-confirm-race",
				discoveryPath: join(root, "hub-discovery.json"),
			},
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker: new HubChatCatalogConfirmationBroker(),
				authorize: vi.fn() as never,
			},
			workspaceAuthority: {
				trustedWorkspaceKeys: [root],
				confirmCatalogMutation,
			},
		});
		servers.add(server);
		const control = server.workspaceAuthority;
		if (!control) throw new Error("Expected workspace authority control.");
		const registration = control.list()[0];
		if (!registration) throw new Error("Expected workspace registration.");
		await openWorkspaceSocket(
			server.url,
			control.issue({ workspaceId: registration.workspaceId }).credential,
		);
		const connection = control.listConnections()[0];
		if (!connection) throw new Error("Expected active workspace connection.");
		const pending = control.requestCatalogConfirmation({
			connectionId: connection.connectionId,
			target: {
				confirmation: "purge",
				invocationId: "purge-confirm-race",
				aggregateKind: "chat",
				aggregateId: "chat-confirm-race",
				expectedRevision: 4,
			},
		});
		await vi.waitFor(() =>
			expect(confirmCatalogMutation).toHaveBeenCalledOnce(),
		);
		await control.revoke(registration.workspaceId);
		expect(promptSignal?.aborted).toBe(true);
		resolveConfirmation?.(true);
		await expect(pending).rejects.toThrow("Hub catalog confirmation failed");
	});

	it.each(["disconnect", "shutdown"] as const)(
		"aborts a pending human confirmation on physical %s",
		async (termination) => {
			const root = mkdtempSync(
				join(tmpdir(), `hub-workspace-confirm-${termination}-`),
			);
			tempDirs.push(root);
			let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
			let promptSignal: AbortSignal | undefined;
			const confirmCatalogMutation = vi.fn(
				(request: HubWorkspaceCatalogConfirmationRequest) => {
					promptSignal = request.signal;
					return new Promise<boolean>((resolve) => {
						resolveConfirmation = resolve;
					});
				},
			);
			const server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: `owner-workspace-confirm-${termination}`,
					discoveryPath: join(root, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [root],
					confirmCatalogMutation,
				},
			});
			servers.add(server);
			const control = server.workspaceAuthority;
			if (!control) throw new Error("Expected workspace authority control.");
			const registration = control.list()[0];
			if (!registration) throw new Error("Expected workspace registration.");
			const socket = await openWorkspaceSocket(
				server.url,
				control.issue({ workspaceId: registration.workspaceId }).credential,
			);
			const connection = control.listConnections()[0];
			if (!connection) throw new Error("Expected active workspace connection.");
			const outcome = control
				.requestCatalogConfirmation({
					connectionId: connection.connectionId,
					target: {
						confirmation: "purge",
						invocationId: `purge-confirm-${termination}`,
						aggregateKind: "chat",
						aggregateId: `chat-confirm-${termination}`,
						expectedRevision: 6,
					},
				})
				.then(
					() => undefined,
					(error: unknown) => error,
				);
			await vi.waitFor(() =>
				expect(confirmCatalogMutation).toHaveBeenCalledOnce(),
			);

			if (termination === "disconnect") {
				const closed = new Promise<void>((resolve) => {
					socket.once("close", () => resolve());
				});
				socket.close();
				await closed;
			} else {
				await server.close();
				servers.delete(server);
			}
			await vi.waitFor(() => expect(promptSignal?.aborted).toBe(true));
			resolveConfirmation?.(true);
			expect(await outcome).toEqual(
				expect.objectContaining({
					message: "Hub catalog confirmation failed.",
				}),
			);
		},
	);

	it("sanitizes prompt failures and aborts a timed-out human confirmation", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-confirm-timeout-"));
		tempDirs.push(root);
		let mode: "throw" | "decline" | "timeout" = "throw";
		let declineSignal: AbortSignal | undefined;
		let timeoutSignal: AbortSignal | undefined;
		const confirmCatalogMutation = vi.fn(
			(request: HubWorkspaceCatalogConfirmationRequest) => {
				if (mode === "throw") {
					throw new Error(`private callback detail: ${root}`);
				}
				if (mode === "decline") {
					declineSignal = request.signal;
					return false;
				}
				timeoutSignal = request.signal;
				return new Promise<boolean>(() => {});
			},
		);
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: {
				ownerId: "owner-workspace-confirm-timeout",
				discoveryPath: join(root, "hub-discovery.json"),
			},
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker: new HubChatCatalogConfirmationBroker(),
				authorize: vi.fn() as never,
			},
			workspaceAuthority: {
				trustedWorkspaceKeys: [root],
				confirmCatalogMutation,
				confirmationPromptTimeoutMs: 5,
			},
		});
		servers.add(server);
		const control = server.workspaceAuthority;
		if (!control) throw new Error("Expected workspace authority control.");
		const registration = control.list()[0];
		if (!registration) throw new Error("Expected workspace registration.");
		await openWorkspaceSocket(
			server.url,
			control.issue({ workspaceId: registration.workspaceId }).credential,
		);
		const connection = control.listConnections()[0];
		if (!connection) throw new Error("Expected active workspace connection.");
		const target = {
			confirmation: "activate" as const,
			invocationId: "activate-confirm-timeout",
			aggregateKind: "chat" as const,
			aggregateId: "chat-confirm-timeout",
			expectedRevision: 5,
		};
		const callbackError = await control
			.requestCatalogConfirmation({
				connectionId: connection.connectionId,
				target,
			})
			.catch((error: unknown) => error);
		expect(callbackError).toEqual(
			expect.objectContaining({
				message: "Hub catalog confirmation failed.",
			}),
		);
		expect(String(callbackError)).not.toContain(root);

		mode = "decline";
		await expect(
			control.requestCatalogConfirmation({
				connectionId: connection.connectionId,
				target: { ...target, invocationId: "activate-confirm-decline" },
			}),
		).rejects.toThrow("Hub catalog confirmation was declined");
		expect(declineSignal?.aborted).toBe(true);

		mode = "timeout";
		await expect(
			control.requestCatalogConfirmation({
				connectionId: connection.connectionId,
				target: { ...target, invocationId: "activate-confirm-timeout-2" },
			}),
		).rejects.toThrow("Hub catalog confirmation failed");
		expect(timeoutSignal?.aborted).toBe(true);
	});

	it("fails startup when workspace enrollment lacks a catalog host", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-no-host-"));
		tempDirs.push(root);
		await expect(
			startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "owner-no-catalog-host",
					discoveryPath: join(root, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				workspaceAuthority: { trustedWorkspaceKeys: [root] },
			}),
		).rejects.toThrow("requires a configured chat catalog host");
	});

	it("fails startup when a binding-capable class omits instance binding", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-workspace-unbound-class-"));
		tempDirs.push(root);
		const interactivePolicy = {
			authorityClassId: "interactive.owner.v1",
			audienceId: "aud_interactive_owner_v1",
			policyEpoch: 1,
			allowedStartProfileIds: ["interactive.v1"],
			allowedBindingProfileIds: [],
		};
		await expect(
			startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "owner-unbound-connector-class",
					discoveryPath: join(root, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [root],
					connectionPolicies: [
						interactivePolicy,
						{
							authorityClassId: "connector.slack.v1",
							audienceId: "aud_connector_slack_bootstrap_v1",
							policyEpoch: 1,
							allowedStartProfileIds: ["connector.slack.v1"],
							allowedBindingProfileIds: ["connector.slack.v1"],
						},
					],
					defaultConnectionPolicy: interactivePolicy,
				},
			}),
		).rejects.toThrow(
			"binding-capable workspace authority classes must require an installed instance",
		);
	});

	it("fails startup when managed Core construction lacks workspace authority", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-managed-core-no-authority-"));
		tempDirs.push(root);
		await expect(
			startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "owner-managed-core-no-authority",
					discoveryPath: join(root, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				workspaceManagedCoreFactory: {
					create: vi.fn(),
				},
			}),
		).rejects.toThrow("requires configured workspace authority");
	});

	it("fails startup when lifecycle routing is enabled without a managed Core", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-managed-lifecycle-no-core-"));
		tempDirs.push(root);
		await expect(
			startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "owner-managed-lifecycle-no-core",
					discoveryPath: join(root, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				managedChatLifecycleEnabled: true,
			}),
		).rejects.toThrow("requires a configured managed Core factory");
	});
});
