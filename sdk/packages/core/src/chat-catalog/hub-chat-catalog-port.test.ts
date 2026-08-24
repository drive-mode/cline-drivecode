import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	HubChatCatalogCommandName,
	HubCommandEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../hub/daemon/runtime-handlers";
import { HubServerTransport } from "../hub/server/hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "../hub/server/workspace-capability-authority";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { SessionSource } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import {
	type ChatCatalogAuthorityContext,
	type ChatCatalogConfirmationGrant,
	issueChatCatalogAuthority,
} from "./chat-catalog-authority";
import type { ChatCatalogPort } from "./chat-catalog-port";
import { LocalChatCatalogPort } from "./chat-catalog-port";
import {
	consumeHubChatCatalogConfirmation,
	HubChatCatalogConfirmationBroker,
} from "./hub-chat-catalog-confirmation-broker";
import { HubChatCatalogPort } from "./hub-chat-catalog-port";
import { SqliteChatCatalogService } from "./sqlite-chat-catalog-service";

const WORKSPACE_A = resolve("/tmp/chat-catalog-hub-workspace-a");
const WORKSPACE_B = resolve("/tmp/chat-catalog-hub-workspace-b");
const NOW = "2026-08-14T10:00:00.000Z";
const GRANT_EXPIRY = "2026-08-14T10:05:00.000Z";
const LIFECYCLE_GRANTS = [
	{
		confirmation: "archive",
		invocationId: "archive-main",
		aggregateKind: "chat",
		aggregateId: "chat-main",
		expectedRevision: 1,
	},
	{
		confirmation: "archive",
		invocationId: "archive-clear-main",
		aggregateKind: "chat",
		aggregateId: "chat-main",
		expectedRevision: 1,
		effects: ["clear_bindings"],
	},
	{
		confirmation: "activate",
		invocationId: "activate-main",
		aggregateKind: "chat",
		aggregateId: "chat-main",
		expectedRevision: 2,
	},
	{
		confirmation: "archive",
		invocationId: "stale-archive-main",
		aggregateKind: "chat",
		aggregateId: "chat-main",
		expectedRevision: 4,
	},
	{
		confirmation: "archive",
		invocationId: "final-archive-main",
		aggregateKind: "chat",
		aggregateId: "chat-main",
		expectedRevision: 5,
	},
	{
		confirmation: "purge",
		invocationId: "purge-main",
		aggregateKind: "chat",
		aggregateId: "chat-main",
		expectedRevision: 6,
	},
	{
		confirmation: "revoke_lease",
		invocationId: "revoke-lost-hub-lease",
		aggregateKind: "lease",
		aggregateId: "session-lost-hub-lease",
		expectedRevision: 1,
	},
] as const;
let confirmationSequence = 0;

function lifecycleGrants(prefix: string): ChatCatalogConfirmationGrant[] {
	return LIFECYCLE_GRANTS.map((grant) => ({
		...grant,
		credential: `${prefix}-${++confirmationSequence}`,
		issuedAt: NOW,
		expiresAt: GRANT_EXPIRY,
	}));
}

function session(
	sessionId: string,
	updatedAt: string,
	workspaceRoot = WORKSPACE_A,
): SessionRecord {
	return {
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		startedAt: "2026-08-14T09:00:00.000Z",
		endedAt: "2026-08-14T09:01:00.000Z",
		status: "completed",
		interactive: true,
		provider: "test-provider",
		model: "test-model",
		cwd: workspaceRoot,
		workspaceRoot,
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt,
	};
}

function context(
	workspaceKey = WORKSPACE_A,
	confirmationGrants = lifecycleGrants("local"),
): ChatCatalogAuthorityContext {
	return issueChatCatalogAuthority({
		principalId: "human-1",
		workspaceKey,
		actorKind: "human",
		source: { kind: "hub", clientId: "client-1", transport: "websocket" },
		confirmationGrants,
		clock: () => new Date(NOW),
	});
}

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

function openCatalogConnection(
	transport: HubServerTransport,
	workspaceCapabilities: HubWorkspaceCapabilityAuthority,
	workspaceKey = WORKSPACE_A,
) {
	const grant = workspaceCapabilities.issue({
		principalId: "human-1",
		workspaceKey,
	});
	const identity = workspaceCapabilities.consume({
		credential: grant.credential,
		transport: "websocket",
	});
	return { identity, connection: transport.openConnection(identity) };
}

interface Harness {
	store: SqliteSessionStore;
	catalog: SqliteChatCatalogService;
	port: ChatCatalogPort;
	authority: () => ChatCatalogAuthorityContext;
	transport?: HubServerTransport;
	rawCommand?: (
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	) => Promise<HubReplyEnvelope>;
}

describe("hub ChatCatalog parity", () => {
	const tempDirs: string[] = [];
	const stores: SqliteSessionStore[] = [];
	const catalogs: SqliteChatCatalogService[] = [];
	const transports: HubServerTransport[] = [];

	function baseFixture() {
		const dataDir = mkdtempSync(join(tmpdir(), "hub-chat-catalog-"));
		tempDirs.push(dataDir);
		const store = new SqliteSessionStore({ sessionsDir: dataDir });
		const catalog = new SqliteChatCatalogService({
			dataDir,
			clock: () => new Date(NOW),
			artifactCleanup: {
				cleanupChatArtifacts: async (input) => ({
					receiptId: `${input.attemptId}:${input.chatId}:${input.sessionIds.join(",")}`,
				}),
			},
		});
		const localPort = new LocalChatCatalogPort({
			service: catalog,
			clock: () => new Date(NOW),
		});
		stores.push(store);
		catalogs.push(catalog);
		return { store, catalog, localPort };
	}

	function localHarness(): Harness {
		const { store, catalog, localPort } = baseFixture();
		return { store, catalog, port: localPort, authority: context };
	}

	async function hubHarness(): Promise<Harness> {
		const { store, catalog, localPort } = baseFixture();
		const confirmationBroker = new HubChatCatalogConfirmationBroker({
			clock: () => new Date(NOW),
		});
		const workspaceCapabilities = new HubWorkspaceCapabilityAuthority();
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
				chatCatalog: {
					port: localPort,
					confirmationBroker,
					authorize: ({
						authenticatedConnection,
						authenticatedClientId,
						confirmationGrant,
						mutationFence,
					}) => {
						return issueChatCatalogAuthority({
							principalId: authenticatedConnection.principalId,
							tenantId: authenticatedConnection.tenantId,
							workspaceKey: authenticatedConnection.workspaceKey,
							actorKind: "human",
							source: {
								kind: "hub",
								clientId: authenticatedClientId,
								transport: authenticatedConnection.transport,
							},
							confirmationGrants: confirmationGrant ? [confirmationGrant] : [],
							mutationFence,
							clock: () => new Date(NOW),
						});
					},
				},
			},
			workspaceCapabilities,
		);
		transports.push(transport);
		const { identity, connection } = openCatalogConnection(
			transport,
			workspaceCapabilities,
		);
		const authority = () => {
			const grants = LIFECYCLE_GRANTS.map((target) =>
				confirmationBroker.issue({
					authenticatedClientId: identity.connectionId,
					target,
				}),
			);
			return context(WORKSPACE_A, grants);
		};
		const registration = await connection.command({
			version: "v1",
			command: "client.register",
			requestId: "register-client-1",
			clientId: "client-1",
			payload: {
				clientId: "client-1",
				clientType: "core-test",
				transport: "native",
				// Registration workspace is self-attested metadata and intentionally
				// differs from the host-authorized workspace.
				workspaceContext: { workspaceRoot: WORKSPACE_B, cwd: WORKSPACE_B },
			},
		});
		expect(registration.ok).toBe(true);
		let request = 0;
		const client = {
			command: (
				command: HubCommandEnvelope["command"],
				payload?: Record<string, unknown>,
			): Promise<HubReplyEnvelope> => {
				request += 1;
				return connection.command({
					version: "v1",
					command,
					requestId: `request-${request}`,
					clientId: "client-1",
					payload,
				});
			},
		};
		return {
			store,
			catalog,
			port: new HubChatCatalogPort({
				client,
				workspaceKey: WORKSPACE_A,
				clock: () => new Date(NOW),
			}),
			authority,
			transport,
			rawCommand: client.command,
		};
	}

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
		for (const catalog of catalogs.splice(0)) catalog.close();
		for (const store of stores.splice(0)) store.close();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	async function errorCode(operation: Promise<unknown>): Promise<string> {
		try {
			await operation;
			return "none";
		} catch (error) {
			return String((error as { code?: unknown }).code ?? "unknown");
		}
	}

	async function exercise(harness: Harness) {
		harness.store.create(session("session-root", "2026-08-14T09:01:00.000Z"));
		harness.store.update({
			sessionId: "session-root",
			updatedAt: "2026-08-14T09:01:00.000Z",
		});
		harness.store.create(
			session("session-successor", "2026-08-14T09:02:00.000Z"),
		);
		harness.store.update({
			sessionId: "session-successor",
			updatedAt: "2026-08-14T09:02:00.000Z",
		});
		const { port, authority } = harness;
		const adopt = await port.adoptRootSession(authority(), {
			chatId: "chat-main",
			sessionId: "session-root",
			title: "Main chat",
			titleSource: "test",
			invocationId: "adopt-main",
		});
		const listed = await port.listChats(authority(), {
			workspaceKey: WORKSPACE_A,
			catalogState: "all",
		});
		const binding = await port.bindChat(authority(), {
			bindingId: "binding-main",
			transport: "slack",
			instanceId: "instance-1",
			channelId: "channel-1",
			threadId: "thread-1",
			participantScope: "all",
			chatId: "chat-main",
			sessionId: "session-root",
			expectedBindingRevision: 0,
			invocationId: "bind-main",
		});
		const lease = await port.acquireSessionLease(authority(), {
			sessionId: "session-root",
			expectedRevision: 0,
			ttlMs: 5_000,
			invocationId: "lease-main",
		});
		const renewedLease = await port.renewSessionLease(authority(), {
			sessionId: "session-root",
			leaseToken: lease.leaseToken ?? "",
			expectedRevision: 1,
			ttlMs: 5_000,
			invocationId: "renew-lease-main",
		});
		const verifiedLease = await port.verifySessionLease(authority(), {
			sessionId: "session-root",
			leaseToken: lease.leaseToken ?? "",
			expectedRevision: 2,
		});
		const release = await port.releaseSessionLease(authority(), {
			sessionId: "session-root",
			leaseToken: lease.leaseToken ?? "",
			expectedRevision: 2,
			invocationId: "release-main",
		});
		const archiveInput = {
			chatId: "chat-main",
			expectedRevision: 1,
			invocationId: "archive-main",
		};
		const archive = await port.archiveChat(authority(), archiveInput);
		const activate = await port.activateChat(authority(), {
			chatId: "chat-main",
			expectedRevision: 2,
			invocationId: "activate-main",
		});
		const rename = await port.renameChat(authority(), {
			chatId: "chat-main",
			title: "Renamed main chat",
			expectedRevision: 3,
			invocationId: "rename-main",
		});
		const archiveReplay = await port.archiveChat(authority(), archiveInput);
		const successor = await port.attachSuccessorSession(authority(), {
			chatId: "chat-main",
			sessionId: "session-successor",
			parentSessionId: "session-root",
			relationKind: "recovery",
			expectedRevision: 4,
			invocationId: "successor-main",
		});
		const staleArchiveCode = await errorCode(
			port.archiveChat(authority(), {
				chatId: "chat-main",
				expectedRevision: 4,
				invocationId: "stale-archive-main",
			}),
		);
		const finalArchive = await port.archiveChat(authority(), {
			chatId: "chat-main",
			expectedRevision: 5,
			invocationId: "final-archive-main",
		});
		const purgeInput = {
			chatId: "chat-main",
			expectedRevision: 6,
			invocationId: "purge-main",
		};
		const purge = await port.purgeChat(authority(), purgeInput);
		const purgeReplay = await port.purgeChat(authority(), purgeInput);
		const events = harness.catalog.listEvents("chat-main").map((event) => {
			const { eventId: _eventId, ...stable } = event;
			return stable;
		});

		return {
			adopt,
			listed,
			binding,
			lease: { ...lease, leaseToken: Boolean(lease.leaseToken) },
			renewedLease,
			verifiedLease,
			release,
			archive,
			activate,
			rename,
			archiveReplay,
			successor,
			staleArchiveCode,
			finalArchive,
			purge,
			purgeReplay,
			getAfterPurge: await port.getChat(authority(), "chat-main"),
			events,
		};
	}

	it("matches local results, conflicts, replay receipts, and provenance", async () => {
		const local = await exercise(localHarness());
		const hub = await exercise(await hubHarness());
		expect(hub).toEqual(local);
		expect(hub.archiveReplay).toMatchObject({
			receipt: { replayed: true, resultingRevision: 2 },
			current: { catalogState: "active", revision: 4 },
		});
		expect(hub.rename).toMatchObject({
			receipt: { operation: "rename_chat", resultingRevision: 4 },
			current: { title: "Renamed main chat", titleSource: "manual" },
		});
		expect(hub.staleArchiveCode).toBe("revision_conflict");
		expect(hub.purgeReplay.receipt).toMatchObject({
			replayed: true,
			applied: true,
		});
		expect(
			hub.events.every(
				(event) =>
					event.actorId === "human-1" &&
					event.sourceKind === "hub" &&
					event.transport === "websocket",
			),
		).toBe(true);
	});

	it("carries effect-bound archive confirmation through the Hub adapter", async () => {
		const harness = await hubHarness();
		harness.store.create(
			session("session-effect-archive", "2026-08-14T09:01:00.000Z"),
		);
		await harness.port.adoptRootSession(harness.authority(), {
			chatId: "chat-main",
			sessionId: "session-effect-archive",
			invocationId: "adopt-effect-archive",
		});
		const scope = {
			bindingId: "binding-effect-archive",
			transport: "telegram",
			threadId: "thread-effect-archive",
		};
		await harness.port.bindChat(harness.authority(), {
			...scope,
			chatId: "chat-main",
			sessionId: "session-effect-archive",
			expectedBindingRevision: 0,
			invocationId: "bind-effect-archive",
		});

		await expect(
			harness.port.archiveChat(harness.authority(), {
				chatId: "chat-main",
				expectedRevision: 1,
				invocationId: "archive-clear-main",
				clearBindings: true,
			}),
		).resolves.toMatchObject({
			current: { catalogState: "archived", bindings: [] },
		});
		expect(harness.catalog.getBinding(scope)).toMatchObject({
			bound: false,
			revision: 2,
		});
	});

	it("fails closed when the hub has no catalog host", async () => {
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
		});
		transports.push(transport);
		await transport.handleCommand({
			version: "v1",
			command: "client.register",
			clientId: "client-unsupported",
			payload: {
				clientId: "client-unsupported",
				clientType: "test",
				transport: "native",
				workspaceContext: { workspaceRoot: WORKSPACE_A },
			},
		});
		const reply = await transport.handleCommand({
			version: "v1",
			command: "chat_catalog.list",
			clientId: "client-unsupported",
			payload: {},
		});
		expect(reply).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
	});

	it("rejects malformed or version-drifted hub results before exposure", async () => {
		const malformed = new HubChatCatalogPort({
			workspaceKey: WORKSPACE_A,
			client: {
				command: async () =>
					({
						version: "v1",
						ok: true,
						payload: { result: { items: [{ chatId: "incomplete" }] } },
					}) as HubReplyEnvelope,
			},
		});
		await expect(
			malformed.listChats(context(), {
				workspaceKey: WORKSPACE_A,
				catalogState: "all",
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });

		const drifted = new HubChatCatalogPort({
			workspaceKey: WORKSPACE_A,
			client: {
				command: async () =>
					({
						version: "v2",
						ok: true,
						payload: { result: { items: [] } },
					}) as unknown as HubReplyEnvelope,
			},
		});
		await expect(
			drifted.listChats(context(), {
				workspaceKey: WORKSPACE_A,
				catalogState: "all",
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
	});

	it("rejects malformed host results at the server boundary", async () => {
		const workspaceCapabilities = new HubWorkspaceCapabilityAuthority();
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
				chatCatalog: {
					port: {
						listChats: async () => ({
							items: [{ chatId: "incomplete", tokenHash: "must-not-cross" }],
						}),
					} as unknown as ChatCatalogPort,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: ({
						authenticatedConnection,
						authenticatedClientId,
						mutationFence,
					}) =>
						issueChatCatalogAuthority({
							principalId: authenticatedConnection.principalId,
							tenantId: authenticatedConnection.tenantId,
							workspaceKey: authenticatedConnection.workspaceKey,
							actorKind: "human",
							source: {
								kind: "hub",
								clientId: authenticatedClientId,
								transport: authenticatedConnection.transport,
							},
							mutationFence,
						}),
				},
			},
			workspaceCapabilities,
		);
		transports.push(transport);
		const unscopedReply = await transport.handleCommand({
			version: "v1",
			command: "chat_catalog.list",
			requestId: "unscoped-malformed-result-request",
			clientId: "malformed-result-client",
			payload: { catalogState: "all" },
		});
		expect(unscopedReply).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		const { connection } = openCatalogConnection(
			transport,
			workspaceCapabilities,
		);
		await connection.command({
			version: "v1",
			command: "client.register",
			clientId: "malformed-result-client",
			payload: {
				clientId: "malformed-result-client",
				clientType: "test",
				transport: "native",
			},
		});
		const reply = await connection.command({
			version: "v1",
			command: "chat_catalog.list",
			requestId: "malformed-result-request",
			clientId: "malformed-result-client",
			payload: { catalogState: "all" },
		});
		expect(reply).toMatchObject({
			ok: false,
			error: { code: "unsupported_capability" },
		});
		expect(JSON.stringify(reply)).not.toContain("must-not-cross");
	});

	it("requires and globally consumes a host-issued credential for raw lifecycle commands", async () => {
		const harness = await hubHarness();
		harness.store.create(session("session-raw", "2026-08-14T09:01:00.000Z"));
		await harness.port.adoptRootSession(harness.authority(), {
			chatId: "chat-main",
			sessionId: "session-raw",
			invocationId: "adopt-raw",
		});
		const bindingScope = {
			bindingId: "binding-raw",
			transport: "telegram",
			threadId: "thread-raw",
		};
		await harness.port.bindChat(harness.authority(), {
			...bindingScope,
			chatId: "chat-main",
			sessionId: "session-raw",
			expectedBindingRevision: 0,
			invocationId: "bind-raw",
		});
		const payload = {
			chatId: "chat-main",
			expectedRevision: 1,
			invocationId: "archive-clear-main",
			clearBindings: true,
		};
		const rawCommand = harness.rawCommand;
		if (!rawCommand) throw new Error("hub harness omitted raw command client");
		expect(await rawCommand("chat_catalog.archive", payload)).toMatchObject({
			ok: false,
			error: { code: "invalid_input" },
		});
		expect(
			await rawCommand("chat_catalog.archive", {
				...payload,
				confirmationCredential: "request-derived-forgery",
			}),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		const grant = harness
			.authority()
			.confirmationGrants.find(
				(candidate) => candidate.invocationId === "archive-clear-main",
			);
		if (!grant) throw new Error("hub harness omitted archive grant");
		const { clearBindings: _clearBindings, ...ordinaryArchivePayload } =
			payload;
		expect(
			await rawCommand("chat_catalog.archive", {
				...ordinaryArchivePayload,
				confirmationCredential: grant.credential,
			}),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
		const approvedPayload = {
			...payload,
			confirmationCredential: grant.credential,
		};
		const approvedReply = await rawCommand(
			"chat_catalog.archive",
			approvedPayload,
		);
		if (!approvedReply.ok) {
			throw new Error(JSON.stringify(approvedReply.error));
		}
		expect(harness.catalog.getBinding(bindingScope)).toMatchObject({
			bound: false,
			revision: 2,
		});
		expect(
			await rawCommand("chat_catalog.archive", approvedPayload),
		).toMatchObject({ ok: false, error: { code: "invalid_input" } });
	});

	it("binds broker credentials to client, operation, invocation, chat, and revision", async () => {
		const broker = new HubChatCatalogConfirmationBroker({
			clock: () => new Date(NOW),
		});
		const target = {
			confirmation: "archive" as const,
			invocationId: "archive-bound",
			aggregateKind: "chat" as const,
			aggregateId: "chat-bound",
			expectedRevision: 7,
		};
		const grant = broker.issue({
			authenticatedClientId: "client-bound",
			target,
		});
		const rejected = [
			{ authenticatedClientId: "client-stolen", target },
			{
				authenticatedClientId: "client-bound",
				target: { ...target, confirmation: "activate" as const },
			},
			{
				authenticatedClientId: "client-bound",
				target: { ...target, invocationId: "archive-substituted" },
			},
			{
				authenticatedClientId: "client-bound",
				target: { ...target, aggregateId: "chat-substituted" },
			},
			{
				authenticatedClientId: "client-bound",
				target: { ...target, aggregateKind: "lease" as const },
			},
			{
				authenticatedClientId: "client-bound",
				target: { ...target, expectedRevision: 8 },
			},
		];
		for (const candidate of rejected) {
			expect(() =>
				consumeHubChatCatalogConfirmation(broker, {
					...candidate,
					credential: grant.credential,
				}),
			).toThrowError(expect.objectContaining({ code: "invalid_input" }));
		}
		expect(
			consumeHubChatCatalogConfirmation(broker, {
				authenticatedClientId: "client-bound",
				credential: grant.credential,
				target,
			}),
		).toEqual(grant);
		expect(() =>
			consumeHubChatCatalogConfirmation(broker, {
				authenticatedClientId: "client-bound",
				credential: grant.credential,
				target,
			}),
		).toThrowError(expect.objectContaining({ code: "invalid_input" }));

		const concurrent = broker.issue({
			authenticatedClientId: "client-bound",
			target,
		});
		const attempts = await Promise.allSettled([
			Promise.resolve().then(() =>
				consumeHubChatCatalogConfirmation(broker, {
					authenticatedClientId: "client-bound",
					credential: concurrent.credential,
					target,
				}),
			),
			Promise.resolve().then(() =>
				consumeHubChatCatalogConfirmation(broker, {
					authenticatedClientId: "client-bound",
					credential: concurrent.credential,
					target,
				}),
			),
		]);
		expect(
			attempts.filter((attempt) => attempt.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			attempts.filter((attempt) => attempt.status === "rejected"),
		).toHaveLength(1);
	});

	it("bounds pending confirmation state, collision attempts, and expired entries", () => {
		let now = new Date(NOW);
		let sequence = 0;
		const target = {
			confirmation: "purge" as const,
			invocationId: "purge-bounded",
			aggregateKind: "chat" as const,
			aggregateId: "chat-bounded",
			expectedRevision: 2,
		};
		const broker = new HubChatCatalogConfirmationBroker({
			clock: () => now,
			credentialFactory: () => `credential-${++sequence}`,
			maxPending: 2,
			maxPendingPerClient: 1,
		});
		broker.issue({ authenticatedClientId: "client-a", target, ttlMs: 10 });
		expect(() =>
			broker.issue({ authenticatedClientId: "client-a", target, ttlMs: 10 }),
		).toThrow("pending limit");
		broker.issue({ authenticatedClientId: "client-b", target, ttlMs: 10 });
		expect(() =>
			broker.issue({ authenticatedClientId: "client-c", target, ttlMs: 10 }),
		).toThrow("pending limit");

		now = new Date(new Date(NOW).getTime() + 11);
		expect(() =>
			broker.issue({ authenticatedClientId: "client-c", target, ttlMs: 10 }),
		).not.toThrow();

		const duplicateBroker = new HubChatCatalogConfirmationBroker({
			clock: () => new Date(NOW),
			credentialFactory: () => "duplicate-confirmation-credential",
			maxPending: 2,
			maxPendingPerClient: 2,
		});
		duplicateBroker.issue({ authenticatedClientId: "client-a", target });
		expect(() =>
			duplicateBroker.issue({ authenticatedClientId: "client-b", target }),
		).toThrow("could not produce a unique value");
	});

	it("keeps non-destructive activity recording reachable through the hub", async () => {
		const harness = await hubHarness();
		harness.store.create(
			session("session-activity", "2026-08-14T09:01:00.000Z"),
		);
		await harness.port.adoptRootSession(harness.authority(), {
			chatId: "chat-activity",
			sessionId: "session-activity",
			invocationId: "adopt-activity",
		});
		harness.store.update({
			sessionId: "session-activity",
			updatedAt: "2026-08-14T09:02:00.000Z",
		});
		const activity = await harness.port.recordChatActivity(
			harness.authority(),
			{
				chatId: "chat-activity",
				sessionId: "session-activity",
				expectedRevision: 1,
				invocationId: "activity-main",
			},
		);
		expect(activity).toMatchObject({
			current: { chatId: "chat-activity", revision: 1 },
			receipt: { operation: "record_chat_activity" },
		});
	});

	it("recovers from a lost lifecycle reply only with a fresh human credential", async () => {
		const harness = await hubHarness();
		harness.store.create(
			session("session-timeout", "2026-08-14T09:01:00.000Z"),
		);
		await harness.port.adoptRootSession(harness.authority(), {
			chatId: "chat-main",
			sessionId: "session-timeout",
			invocationId: "adopt-timeout",
		});
		const rawCommand = harness.rawCommand;
		if (!rawCommand) throw new Error("hub harness omitted raw command client");
		let loseArchiveReply = true;
		const flakyPort = new HubChatCatalogPort({
			workspaceKey: WORKSPACE_A,
			clock: () => new Date(NOW),
			client: {
				command: async (command, payload) => {
					const reply = await rawCommand(command, payload);
					if (command === "chat_catalog.archive" && loseArchiveReply) {
						loseArchiveReply = false;
						throw new Error("simulated lost reply");
					}
					return reply;
				},
			},
		});
		const archiveInput = {
			chatId: "chat-main",
			expectedRevision: 1,
			invocationId: "archive-main",
		};
		const spentAuthority = harness.authority();
		await expect(
			flakyPort.archiveChat(spentAuthority, archiveInput),
		).rejects.toThrow("simulated lost reply");
		await expect(
			flakyPort.archiveChat(spentAuthority, archiveInput),
		).rejects.toMatchObject({ code: "invalid_input" });
		const recovered = await flakyPort.archiveChat(
			harness.authority(),
			archiveInput,
		);
		expect(recovered.receipt).toMatchObject({
			applied: true,
			replayed: true,
			resultingRevision: 2,
		});
	});

	it("recovers from a lost lease acquisition reply by confirmed revocation", async () => {
		const harness = await hubHarness();
		harness.store.create(
			session("session-lost-hub-lease", "2026-08-14T09:01:00.000Z"),
		);
		await harness.port.adoptRootSession(harness.authority(), {
			chatId: "chat-lost-hub-lease",
			sessionId: "session-lost-hub-lease",
			invocationId: "adopt-lost-hub-lease",
		});
		const rawCommand = harness.rawCommand;
		if (!rawCommand) throw new Error("hub harness omitted raw command client");
		let loseAcquireReply = true;
		let loseRevokeReply = true;
		let inaccessibleToken = "";
		const flakyPort = new HubChatCatalogPort({
			workspaceKey: WORKSPACE_A,
			clock: () => new Date(NOW),
			client: {
				command: async (command, payload) => {
					const reply = await rawCommand(command, payload);
					if (command === "chat_catalog.lease.acquire" && loseAcquireReply) {
						loseAcquireReply = false;
						const result = (
							reply.payload as { result?: { leaseToken?: string } }
						)?.result;
						inaccessibleToken = result?.leaseToken ?? "";
						throw new Error("simulated lost lease acquire reply");
					}
					if (command === "chat_catalog.lease.revoke" && loseRevokeReply) {
						loseRevokeReply = false;
						throw new Error("simulated lost lease revoke reply");
					}
					return reply;
				},
			},
		});
		const acquireInput = {
			sessionId: "session-lost-hub-lease",
			expectedRevision: 0,
			ttlMs: 5_000,
			invocationId: "acquire-lost-hub-lease",
		};
		await expect(
			flakyPort.acquireSessionLease(harness.authority(), acquireInput),
		).rejects.toThrow("simulated lost lease acquire reply");
		expect(inaccessibleToken).toBeTruthy();
		const retry = await flakyPort.acquireSessionLease(
			harness.authority(),
			acquireInput,
		);
		expect(retry).toMatchObject({
			receipt: { applied: true, replayed: true, resultingRevision: 1 },
			current: { active: true, revision: 1 },
		});
		expect(retry.leaseToken).toBeUndefined();
		const reconciled = await flakyPort.getSessionLease(
			harness.authority(),
			"session-lost-hub-lease",
		);
		expect(reconciled).toMatchObject({
			ownerId: "human-1",
			active: true,
			revision: 1,
		});
		expect(reconciled).not.toHaveProperty("leaseToken");

		const revokeInput = {
			sessionId: "session-lost-hub-lease",
			expectedRevision: 1,
			invocationId: "revoke-lost-hub-lease",
		};
		const spentAuthority = harness.authority();
		await expect(
			flakyPort.revokeSessionLease(spentAuthority, revokeInput),
		).rejects.toThrow("simulated lost lease revoke reply");
		expect(
			await flakyPort.getSessionLease(
				harness.authority(),
				"session-lost-hub-lease",
			),
		).toMatchObject({ active: false, revision: 2 });
		await expect(
			flakyPort.revokeSessionLease(spentAuthority, revokeInput),
		).rejects.toMatchObject({ code: "invalid_input" });
		const revokeReplay = await flakyPort.revokeSessionLease(
			harness.authority(),
			revokeInput,
		);
		expect(revokeReplay).toMatchObject({
			receipt: { applied: true, replayed: true, resultingRevision: 2 },
			current: { active: false, revision: 2 },
		});

		const replacement = await flakyPort.acquireSessionLease(
			harness.authority(),
			{
				sessionId: "session-lost-hub-lease",
				expectedRevision: 2,
				ttlMs: 5_000,
				invocationId: "replace-lost-hub-lease",
			},
		);
		expect(replacement).toMatchObject({
			current: { active: true, revision: 3 },
		});
		expect(replacement.leaseToken).toBeTruthy();
		expect(replacement.leaseToken).not.toBe(inaccessibleToken);
		await expect(
			flakyPort.releaseSessionLease(harness.authority(), {
				sessionId: "session-lost-hub-lease",
				leaseToken: inaccessibleToken,
				expectedRevision: 3,
				invocationId: "release-inaccessible-hub-lease",
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(
			await flakyPort.releaseSessionLease(harness.authority(), {
				sessionId: "session-lost-hub-lease",
				leaseToken: replacement.leaseToken ?? "",
				expectedRevision: 3,
				invocationId: "release-replacement-hub-lease",
			}),
		).toMatchObject({ current: { active: false, revision: 4 } });
	});

	it("rejects payload authority fields and forged host authority", async () => {
		const { localPort } = baseFixture();
		const commands: HubChatCatalogCommandName[] = [];
		const workspaceCapabilities = new HubWorkspaceCapabilityAuthority();
		const transport = new HubServerTransport(
			{
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeSessionHost(),
				managedChatLifecycleEnabled: true,
				chatCatalog: {
					port: localPort,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: ({ command }) => {
						commands.push(command);
						return {
							principalId: "client-forged",
							tenantId: "local",
							workspaceKey: WORKSPACE_B,
							actorKind: "human",
							source: { kind: "hub" },
							confirmationGrants: [],
						} as ChatCatalogAuthorityContext;
					},
				},
			},
			workspaceCapabilities,
		);
		transports.push(transport);
		const { connection } = openCatalogConnection(
			transport,
			workspaceCapabilities,
		);
		await connection.command({
			version: "v1",
			command: "client.register",
			clientId: "client-forged",
			payload: {
				clientId: "client-forged",
				clientType: "test",
				transport: "native",
				workspaceContext: { workspaceRoot: WORKSPACE_A },
			},
		});
		const payloadReply = await connection.command({
			version: "v1",
			command: "chat_catalog.list",
			clientId: "client-forged",
			payload: { workspaceKey: WORKSPACE_B },
		});
		expect(commands).toEqual([]);
		expect(payloadReply).toMatchObject({
			ok: false,
			error: { code: "invalid_input" },
		});
		const authorityReply = await connection.command({
			version: "v1",
			command: "chat_catalog.list",
			clientId: "client-forged",
			payload: {},
		});
		expect(commands).toEqual(["chat_catalog.list"]);
		expect(authorityReply).toMatchObject({
			ok: false,
			error: { code: "invalid_input" },
		});
	});
});
