import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubChatRuntimeWireEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { WebSocket as WsWebSocket } from "ws";
import { HubChatCatalogConfirmationBroker } from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import { ChatCatalogError } from "../../chat-catalog/sqlite-chat-catalog-service";
import { ManagedSessionController, NodeHubClient } from "../client";
import { HubChatRuntimeClient } from "../client/chat-runtime-client";
import { HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY } from "../daemon/chat-management-profiles";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import {
	isLocalHubHostName,
	isLocalHubOrigin,
	readBearerToken,
	readWebSocketWorkspaceCapability,
	resolveHubCapabilities,
	resolveHubMaxInboundPayloadBytes,
	resolveHubResourceOptions,
	startHubWebSocketServer,
} from "./hub-websocket-server";
import type {
	HubWorkspaceManagedRuntimeEventInvocation,
	HubWorkspaceManagedRuntimeInvocation,
} from "./workspace-managed-core-pool";
import {
	ManagedRuntimeAdapter,
	type ManagedRuntimeCoreHandle,
} from "./workspace-managed-runtime-adapter";

describe("hub capability advertisement", () => {
	it("keeps managed chat capabilities unadvertised until composition is complete", () => {
		expect(resolveHubCapabilities({})).not.toContain("chat_catalog.v1");
		expect(resolveHubCapabilities({})).not.toContain("chat_projection.v1");
		expect(resolveHubCapabilities({})).not.toContain("chat_lifecycle.v1");
		expect(resolveHubCapabilities({})).not.toContain("chat_runtime.v1");
		expect(resolveHubCapabilities({ chatCatalog: {} as never })).not.toContain(
			"chat_catalog.v1",
		);
		expect(resolveHubCapabilities({ chatCatalog: {} as never })).not.toContain(
			"chat_lifecycle.v1",
		);
		const managed = resolveHubCapabilities({
			managedChatLifecycleEnabled: true,
		});
		expect(managed).toEqual(
			expect.arrayContaining([
				"chat_projection.v1",
				"chat_lifecycle.v1",
				"chat_runtime.v1",
			]),
		);
	});
});

describe("owned chat catalog shutdown", () => {
	it("disposes the host once through the authenticated HTTP shutdown path", async () => {
		const dispose = vi.fn(async () => undefined);
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: createInMemoryHubOwnerContext("owned-chat-catalog-shutdown"),
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker: new HubChatCatalogConfirmationBroker(),
				authorize: vi.fn() as never,
				dispose,
			},
		});
		const shutdownUrl = new URL(server.url);
		shutdownUrl.protocol = "http:";
		shutdownUrl.pathname = "/shutdown";
		const response = await fetch(shutdownUrl, {
			method: "POST",
			headers: { authorization: `Bearer ${server.authToken}` },
		});

		expect(response.status).toBe(202);
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		await expect(server.close()).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledOnce();
	});
});

describe("websocket payload limit", () => {
	it("defaults to one MiB and accepts a configured maximum", () => {
		expect(resolveHubMaxInboundPayloadBytes({})).toBe(1024 * 1024);
		expect(
			resolveHubMaxInboundPayloadBytes({ maxInboundPayloadBytes: 42 }),
		).toBe(42);
	});

	it("resolves central policy defaults with explicit transport precedence", () => {
		const options = resolveHubResourceOptions({
			runtimeHandlers: {} as never,
			resourcePolicy: {
				transport: {
					websocket: {
						softWatermarkBytes: 2000,
						hardWatermarkBytes: 4000,
						maxInboundPayloadBytes: 8000,
						maxActiveSubscriptions: 9,
					},
				},
			},
			websocketDelivery: { softWatermarkBytes: 3000 },
		});

		expect(options.maxInboundPayloadBytes).toBe(8000);
		expect(options.websocketDelivery).toMatchObject({
			softWatermarkBytes: 3000,
			hardWatermarkBytes: 4000,
		});
		expect(options.resourcePolicy).toMatchObject({
			version: 1,
			transport: { websocket: { maxActiveSubscriptions: 9 } },
		});
	});
});

describe("managed runtime range delivery", () => {
	it("coalesces adjacent deltas across a physical workspace WebSocket without manufacturing a gap", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "runtime-range-wire-"));
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let client: NodeHubClient | undefined;
		let release: (() => void) | undefined;
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			let runtimeSubscription:
				| HubWorkspaceManagedRuntimeEventInvocation
				| undefined;
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "runtime-range-delivery",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: {
					subscribe: vi.fn(() => () => undefined),
					dispose: vi.fn(),
				} as never,
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				},
				workspaceManagedCoreFactory: {
					create: async () => ({
						chatLifecycle: {} as never,
						eventWire: { subscribe: () => () => undefined },
						runtimeEventWire: {
							subscribe: (input) => {
								runtimeSubscription = input;
								input.ready?.({
									streamId: "runtime-stream-1",
									sessionSequence: 0,
								});
								return () => undefined;
							},
						},
						dispose: async () => undefined,
					}),
				},
				managedChatLifecycleEnabled: true,
				websocketDelivery: {
					softWatermarkBytes: 1,
					hardWatermarkBytes: 4096,
				},
			});
			const control = server.workspaceAuthority;
			const registration = control?.list()[0];
			if (!control || !registration) {
				throw new Error("missing workspace authority registration");
			}
			client = new NodeHubClient({
				url: server.url,
				clientId: "runtime-range-client",
				clientType: "test",
				workspaceRoot: canonicalWorkspaceRoot,
				workspaceCapabilityProvider: {
					getFreshCapability: () =>
						control.issue({ workspaceId: registration.workspaceId }),
				},
			});
			await client.connect();
			const runtimeClient = new HubChatRuntimeClient(client);
			const received: HubChatRuntimeWireEvent[] = [];
			const errors: Error[] = [];
			release = runtimeClient.subscribe(
				{
					onEvent: (event) =>
						received.push(event as unknown as HubChatRuntimeWireEvent),
					onError: (error) => errors.push(error),
				},
				{ sessionId: "session-1" },
			);
			await vi.waitFor(() => expect(runtimeSubscription).toBeDefined());

			for (const [sessionSequence, text] of [
				[1, "a"],
				[2, "b"],
				[3, "é"],
			] as const) {
				runtimeSubscription?.emit({
					version: "v1",
					event: "chat.runtime",
					eventId: `event-${sessionSequence}`,
					streamId: "runtime-stream-1",
					sessionId: "session-1",
					timestamp: sessionSequence,
					processSequence: sessionSequence,
					sessionSequence,
					payload: {
						kind: "assistant.delta",
						runId: "run-1",
						text,
					},
				});
			}

			await vi.waitFor(() => expect(received).toHaveLength(2));
			expect(errors).toEqual([]);
			expect(received[0]).toMatchObject({
				sessionSequence: 1,
				payload: { kind: "assistant.delta", text: "a" },
			});
			expect(received[1]).toMatchObject({
				eventId: "event-3",
				processSequence: 3,
				sessionSequenceStart: 2,
				sessionSequence: 3,
				payload: { kind: "assistant.delta", text: "bé" },
			});
		} finally {
			release?.();
			await client?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("recovers one forward gap over a physical workspace WebSocket", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "runtime-gap-wire-"));
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let client: NodeHubClient | undefined;
		let release: (() => void) | undefined;
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const streamId = "runtime-stream-gap";
			const runtimeSubscriptions: HubWorkspaceManagedRuntimeEventInvocation[] =
				[];
			const runtimeReleases: Array<ReturnType<typeof vi.fn>> = [];
			const retained = new Map<number, HubChatRuntimeWireEvent>();
			let recoveryCursor:
				| { streamId: string; sessionSequence: number }
				| undefined;
			const event = (sessionSequence: number): HubChatRuntimeWireEvent => ({
				version: "v1",
				event: "chat.runtime",
				eventId: `gap-event-${sessionSequence}`,
				streamId,
				sessionId: "session-1",
				timestamp: sessionSequence,
				processSequence: sessionSequence,
				sessionSequence,
				payload: {
					kind: "assistant.delta",
					runId: "run-gap",
					text: `${sessionSequence}`,
				},
			});
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "runtime-gap-delivery",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: {
					subscribe: vi.fn(() => () => undefined),
					dispose: vi.fn(),
				} as never,
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				},
				workspaceManagedCoreFactory: {
					create: async () => ({
						chatLifecycle: {} as never,
						eventWire: { subscribe: () => () => undefined },
						runtimeEventWire: {
							subscribe: (input) => {
								runtimeSubscriptions.push(input);
								const releaseRuntime = vi.fn();
								runtimeReleases.push(releaseRuntime);
								if (!input.cursor) {
									input.ready?.({ streamId, sessionSequence: 0 });
									return releaseRuntime;
								}
								recoveryCursor = input.cursor;
								for (
									let sequence = input.cursor.sessionSequence + 1;
									sequence <= 3;
									sequence += 1
								) {
									const replay = retained.get(sequence);
									if (!replay) throw new Error("missing retained gap event");
									input.emit(replay);
								}
								input.ready?.({ streamId, sessionSequence: 3 });
								return releaseRuntime;
							},
						},
						dispose: async () => undefined,
					}),
				},
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			const registration = control?.list()[0];
			if (!control || !registration) {
				throw new Error("missing workspace authority registration");
			}
			client = new NodeHubClient({
				url: server.url,
				clientId: "runtime-gap-client",
				clientType: "test",
				workspaceRoot: canonicalWorkspaceRoot,
				workspaceCapabilityProvider: {
					getFreshCapability: () =>
						control.issue({ workspaceId: registration.workspaceId }),
				},
			});
			await client.connect();
			const received: HubChatRuntimeWireEvent[] = [];
			const errors: Error[] = [];
			release = new HubChatRuntimeClient(client).subscribe(
				{
					onEvent: (input) =>
						received.push(input as unknown as HubChatRuntimeWireEvent),
					onError: (error) => errors.push(error),
				},
				{ sessionId: "session-1" },
			);
			await vi.waitFor(() => expect(runtimeSubscriptions).toHaveLength(1));

			for (let sequence = 1; sequence <= 3; sequence += 1) {
				retained.set(sequence, event(sequence));
			}
			runtimeSubscriptions[0]?.emit(retained.get(1));
			runtimeSubscriptions[0]?.emit(retained.get(3));

			await vi.waitFor(() => expect(runtimeSubscriptions).toHaveLength(2));
			await vi.waitFor(() => expect(received).toHaveLength(3));
			expect(recoveryCursor).toEqual({
				streamId,
				sessionSequence: 1,
			});
			expect(runtimeReleases[0]).toHaveBeenCalledOnce();
			expect(received.map((input) => input.sessionSequence)).toEqual([1, 2, 3]);
			expect(errors).toEqual([]);
		} finally {
			release?.();
			await client?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("registers, durably reclaims, and cursor-replays across replacement physical sockets", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "runtime-reclaim-wire-"));
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let client: NodeHubClient | undefined;
		let controller: ManagedSessionController | undefined;
		const wireOrder: string[] = [];
		const runtimeOrder: string[] = [];
		const timeline: string[] = [];
		const recordWire = (entry: string): void => {
			wireOrder.push(entry);
			timeline.push(entry);
		};
		const recordRuntime = (entry: string): void => {
			runtimeOrder.push(entry);
			timeline.push(entry);
		};
		const sockets: RecordingWebSocket[] = [];
		class RecordingWebSocket {
			readonly #inner: WsWebSocket;

			constructor(url: string, protocols?: string | string[]) {
				this.#inner = new WsWebSocket(url, protocols);
				sockets.push(this);
			}

			get readyState(): number {
				return this.#inner.readyState;
			}

			send(data: string): void {
				const frame = JSON.parse(data) as {
					kind?: string;
					runtimeCursor?: { sessionSequence?: number };
					envelope?: {
						command?: string;
						payload?: Record<string, unknown>;
					};
				};
				if (frame.kind === "command") {
					const command = frame.envelope?.command ?? "unknown";
					if (command === "chat_runtime.session.reclaim") {
						recordWire(
							`wire:${command}:${String(frame.envelope?.payload?.operationId)}:${String(frame.envelope?.payload?.expectedWriterGeneration)}`,
						);
					} else {
						recordWire(`wire:${command}`);
					}
				} else if (frame.kind === "stream.subscribe") {
					recordWire(
						`wire:stream.subscribe:${frame.runtimeCursor?.sessionSequence ?? "none"}`,
					);
				} else if (frame.kind === "stream.unsubscribe") {
					recordWire("wire:stream.unsubscribe");
				}
				this.#inner.send(data);
			}

			close(): void {
				this.#inner.close();
			}

			addEventListener(
				type: string,
				listener: (...args: unknown[]) => void,
			): void {
				(
					this.#inner as unknown as {
						addEventListener(
							type: string,
							listener: (...args: unknown[]) => void,
						): void;
					}
				).addEventListener(type, listener);
			}
		}

		try {
			vi.stubGlobal("WebSocket", RecordingWebSocket);
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const streamId = "runtime-stream-reclaim";
			const retained = new Map<number, HubChatRuntimeWireEvent>();
			const event = (sessionSequence: number): HubChatRuntimeWireEvent => ({
				version: "v1",
				event: "chat.runtime",
				eventId: `reclaim-event-${sessionSequence}`,
				streamId,
				sessionId: "session-1",
				timestamp: sessionSequence,
				processSequence: sessionSequence,
				sessionSequence,
				payload: {
					kind: "assistant.delta",
					runId: "run-reclaim",
					text: `${sessionSequence}`,
				},
			});
			let writerGeneration = 1;
			let ownerConnectionId: string | undefined;
			const receipts = new Map<
				string,
				{
					readonly expectedWriterGeneration: number;
					readonly targetConnectionId: string;
					readonly writerGeneration: number;
				}
			>();
			let loseFirstReply = true;
			const bindOwner = (connectionId: string, signal: AbortSignal): void => {
				ownerConnectionId = connectionId;
				signal.addEventListener(
					"abort",
					() => {
						if (ownerConnectionId === connectionId) {
							ownerConnectionId = undefined;
						}
					},
					{ once: true },
				);
			};
			const invokeReclaim = async (
				input: HubWorkspaceManagedRuntimeInvocation,
			): Promise<unknown> => {
				const operationId = String(input.payload.operationId);
				const expectedWriterGeneration = Number(
					input.payload.expectedWriterGeneration,
				);
				recordRuntime(
					`runtime:reclaim:${operationId}:${expectedWriterGeneration}`,
				);
				const receipt = receipts.get(operationId);
				if (receipt) {
					if (receipt.expectedWriterGeneration !== expectedWriterGeneration) {
						throw new ChatCatalogError(
							"invocation_replay_conflict",
							"changed reclaim intent",
						);
					}
					const ownerTransferred =
						receipt.targetConnectionId === input.identity.connectionId &&
						ownerConnectionId === input.identity.connectionId;
					if (!ownerTransferred && ownerConnectionId !== undefined) {
						throw new ChatCatalogError(
							"invocation_replay_conflict",
							"receipt belongs to an active owner",
						);
					}
					recordRuntime(
						`runtime:reply:${ownerTransferred}:${receipt.writerGeneration}`,
					);
					return {
						sessionId: "session-1",
						leaseRevision: receipt.writerGeneration,
						writerGeneration: receipt.writerGeneration,
						leaseExpiresAt: "2026-08-17T12:05:00.000Z",
						ownerTransferred,
					};
				}
				if (
					expectedWriterGeneration !== writerGeneration ||
					ownerConnectionId !== undefined
				) {
					throw new ChatCatalogError(
						"lease_conflict",
						"owner is not reclaimable",
					);
				}
				writerGeneration += 1;
				receipts.set(operationId, {
					expectedWriterGeneration,
					targetConnectionId: input.identity.connectionId,
					writerGeneration,
				});
				bindOwner(input.identity.connectionId, input.signal);
				recordRuntime(`runtime:commit:${writerGeneration}`);
				if (loseFirstReply) {
					loseFirstReply = false;
					sockets.at(-1)?.close();
					await new Promise<void>((resolve) => {
						if (input.signal.aborted) {
							resolve();
							return;
						}
						input.signal.addEventListener("abort", () => resolve(), {
							once: true,
						});
					});
				}
				recordRuntime(`runtime:reply:true:${writerGeneration}`);
				return {
					sessionId: "session-1",
					leaseRevision: writerGeneration,
					writerGeneration,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
					ownerTransferred: true,
				};
			};
			const runtimeSubscriptions: HubWorkspaceManagedRuntimeEventInvocation[] =
				[];
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "runtime-reclaim-delivery",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: {
					subscribe: vi.fn(() => () => undefined),
					dispose: vi.fn(),
				} as never,
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				},
				workspaceManagedCoreFactory: {
					create: async () => ({
						chatLifecycle: {} as never,
						eventWire: { subscribe: () => () => undefined },
						runtimeWire: { invoke: invokeReclaim },
						runtimeEventWire: {
							subscribe: (input) => {
								runtimeSubscriptions.push(input);
								if (!input.cursor) {
									bindOwner(input.identity.connectionId, input.signal);
									recordRuntime("runtime:ready:0");
									input.ready?.({ streamId, sessionSequence: 0 });
									return () => undefined;
								}
								if (
									ownerConnectionId !== input.identity.connectionId ||
									input.cursor.streamId !== streamId ||
									input.cursor.sessionSequence !== 1
								) {
									throw new ChatCatalogError(
										"lease_conflict",
										"cursor subscription lacks physical ownership",
									);
								}
								const replay = retained.get(2);
								if (!replay)
									throw new Error("missing retained reconnect event");
								recordRuntime("runtime:replay:2");
								input.emit(replay);
								recordRuntime("runtime:ready:2");
								input.ready?.({ streamId, sessionSequence: 2 });
								return () => undefined;
							},
						},
						dispose: async () => undefined,
					}),
				},
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			const registration = control?.list()[0];
			if (!control || !registration) {
				throw new Error("missing workspace authority registration");
			}
			const getFreshCapability = vi.fn(() =>
				control.issue({ workspaceId: registration.workspaceId }),
			);
			client = new NodeHubClient({
				url: server.url,
				clientId: "runtime-reclaim-client",
				clientType: "test",
				workspaceRoot: canonicalWorkspaceRoot,
				workspaceCapabilityProvider: { getFreshCapability },
			});
			const received: HubChatRuntimeWireEvent[] = [];
			const errors: Error[] = [];
			const operationIds = ["physical-reclaim-a", "physical-reclaim-b"];
			controller = new ManagedSessionController({
				transport: client,
				sessionId: "session-1",
				writerGeneration: 1,
				onEvent: (input) =>
					received.push(input as unknown as HubChatRuntimeWireEvent),
				onError: (error) => errors.push(error),
				operationIdFactory: () =>
					operationIds.shift() ?? "physical-reclaim-extra",
				retryDelayMs: 0,
				readinessTimeoutMs: 2_000,
				recoveryTimeoutMs: 8_000,
			});
			await controller.start();
			await vi.waitFor(() => expect(runtimeSubscriptions).toHaveLength(1));
			runtimeSubscriptions[0]?.emit(event(1));
			await vi.waitFor(() => expect(received).toHaveLength(1));

			const disconnectedOwner = ownerConnectionId;
			sockets[0]?.close();
			retained.set(2, event(2));
			recordRuntime("runtime:journal:2");
			await vi.waitFor(() =>
				expect(ownerConnectionId).not.toBe(disconnectedOwner),
			);

			await vi.waitFor(
				() =>
					expect(controller?.getSnapshot()).toMatchObject({
						state: "ready",
						writerGeneration: 3,
						connectionGeneration: 3,
					}),
				{ timeout: 8_000 },
			);
			await vi.waitFor(() => expect(received).toHaveLength(2));

			expect(getFreshCapability).toHaveBeenCalledTimes(3);
			expect(received.map((input) => input.sessionSequence)).toEqual([1, 2]);
			expect(errors).toEqual([]);
			expect(wireOrder).toEqual([
				"wire:client.register",
				"wire:stream.subscribe:none",
				"wire:client.register",
				"wire:chat_runtime.session.reclaim:physical-reclaim-a:1",
				"wire:client.register",
				"wire:chat_runtime.session.reclaim:physical-reclaim-a:1",
				"wire:chat_runtime.session.reclaim:physical-reclaim-b:2",
				"wire:stream.subscribe:1",
			]);
			const finalReply = timeline.indexOf("runtime:reply:true:3");
			const freshSubscribe = timeline.indexOf("wire:stream.subscribe:1");
			const replay = timeline.indexOf("runtime:replay:2");
			const ready = timeline.indexOf("runtime:ready:2");
			expect(finalReply).toBeGreaterThan(-1);
			expect(freshSubscribe).toBeGreaterThan(finalReply);
			expect(replay).toBeGreaterThan(freshSubscribe);
			expect(ready).toBeGreaterThan(replay);
			expect(runtimeOrder).toContain("runtime:reply:false:2");
			expect(runtimeOrder).toContain("runtime:journal:2");
		} finally {
			controller?.dispose();
			await client?.dispose();
			await server?.close();
			vi.unstubAllGlobals();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("cancels a committed reclaim over its original physical socket after receipt eviction", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "runtime-cancel-wire-"));
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let original: NodeHubClient | undefined;
		let replacementOne: NodeHubClient | undefined;
		let replacementTwo: NodeHubClient | undefined;
		let releaseReplacementTwo: (() => void) | undefined;
		let adapter: ManagedRuntimeAdapter | undefined;
		const originalReleases: Array<() => void> = [];
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const rekeyManagedSessionAuthority = vi.fn(
				async (input: {
					operationId: string;
					sessionId: string;
					expectedWriterGeneration: number;
					signal?: AbortSignal;
				}) => ({
					sessionId: input.sessionId,
					leaseRevision: input.expectedWriterGeneration + 1,
					writerGeneration: input.expectedWriterGeneration + 1,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
				}),
			);
			const core: ManagedRuntimeCoreHandle = {
				abort: vi.fn(async () => undefined),
				rekeyManagedSessionAuthority,
				verifyManagedSessionAuthority: vi.fn(async (sessionId) => ({
					sessionId,
					leaseRevision: 1,
					writerGeneration: 1,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
				})),
				pendingPrompts: {
					list: vi.fn(async () => []),
					update: vi.fn(async ({ sessionId }) => ({
						sessionId,
						prompts: [],
						updated: false,
					})),
					delete: vi.fn(async ({ sessionId }) => ({
						sessionId,
						prompts: [],
						removed: false,
					})),
				},
				getAccumulatedUsage: vi.fn(async () => undefined),
				readMessages: vi.fn(async () => []),
				get: vi.fn(async () => undefined),
				readSessionCompactionState: vi.fn(async () => undefined),
				subscribe: vi.fn(() => () => undefined),
			};
			const registeredSessions = new Set<string>();
			const originalSignals: AbortSignal[] = [];
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "runtime-cancel-delivery",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: {
					subscribe: vi.fn(() => () => undefined),
					dispose: vi.fn(),
				} as never,
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				},
				workspaceManagedCoreFactory: {
					create: async (scope) => {
						adapter = new ManagedRuntimeAdapter({
							core,
							scope,
							invocations: new AsyncLocalStorage(),
							resolveAudienceSession: (sessionId) =>
								registeredSessions.has(sessionId) ||
								sessionId.startsWith("session-")
									? ({ chatId: "chat-runtime" } as never)
									: null,
							ownerTransitionReceiptLimit: 1,
						});
						return {
							chatLifecycle: {} as never,
							eventWire: { subscribe: () => () => undefined },
							runtimeWire: {
								invoke: (input) => adapter?.invoke(input) as Promise<unknown>,
							},
							runtimeEventWire: {
								subscribe: (input) => {
									const sessionId = input.sessionId;
									if (sessionId && !registeredSessions.has(sessionId)) {
										registeredSessions.add(sessionId);
										originalSignals.push(input.signal);
										adapter?.registerSession(
											sessionId,
											input.identity,
											input.signal,
											1,
										);
									}
									return adapter?.subscribe(input) ?? (() => undefined);
								},
							},
							dispose: async () => adapter?.dispose(),
						};
					},
				},
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			const registration = control?.list()[0];
			if (!control || !registration) {
				throw new Error("missing workspace authority registration");
			}
			const createClient = (clientId: string): NodeHubClient =>
				new NodeHubClient({
					url: server?.url ?? "",
					clientId,
					clientType: "test",
					workspaceRoot: canonicalWorkspaceRoot,
					workspaceCapabilityProvider: {
						getFreshCapability: () =>
							control.issue({ workspaceId: registration.workspaceId }),
					},
				});

			original = createClient("runtime-cancel-original");
			await original.connect();
			const originalRuntime = new HubChatRuntimeClient(original);
			const readySessions: string[] = [];
			for (const sessionId of ["session-1", "session-2"]) {
				originalReleases.push(
					originalRuntime.subscribe(
						{
							onEvent: vi.fn(),
							onReady: () => readySessions.push(sessionId),
						},
						{ sessionId },
					),
				);
			}
			await vi.waitFor(() =>
				expect(new Set(readySessions)).toEqual(
					new Set(["session-1", "session-2"]),
				),
			);
			await original.dispose();
			original = undefined;
			await vi.waitFor(() =>
				expect(originalSignals.every((signal) => signal.aborted)).toBe(true),
			);

			replacementOne = createClient("runtime-cancel-replacement-one");
			await replacementOne.connect();
			const firstRuntime = new HubChatRuntimeClient(replacementOne);
			const firstPayload = {
				operationId: "physical-reclaim-before-eviction",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
			};
			await expect(
				firstRuntime.invoke({
					command: "chat_runtime.session.reclaim",
					payload: firstPayload,
				}),
			).resolves.toMatchObject({ writerGeneration: 2, ownerTransferred: true });
			await expect(
				firstRuntime.invoke({
					command: "chat_runtime.session.reclaim",
					payload: firstPayload,
				}),
			).resolves.toMatchObject({ writerGeneration: 2, ownerTransferred: true });

			replacementTwo = createClient("runtime-cancel-replacement-two");
			await replacementTwo.connect();
			const secondRuntime = new HubChatRuntimeClient(replacementTwo);
			await expect(
				secondRuntime.invoke({
					command: "chat_runtime.session.reclaim",
					payload: {
						operationId: "physical-reclaim-causing-eviction",
						sessionId: "session-2",
						expectedWriterGeneration: 1,
					},
				}),
			).resolves.toMatchObject({ writerGeneration: 2, ownerTransferred: true });
			let replacementTwoReady = false;
			releaseReplacementTwo = secondRuntime.subscribe(
				{
					onEvent: vi.fn(),
					onReady: () => {
						replacementTwoReady = true;
					},
				},
				{ sessionId: "session-2" },
			);
			await vi.waitFor(() => expect(replacementTwoReady).toBe(true));
			await expect(
				replacementOne.command("chat_runtime.session.reclaim", firstPayload),
			).rejects.toMatchObject({ code: "lease_conflict" });

			await expect(
				firstRuntime.invoke({
					command: "chat_runtime.session.reclaim.cancel",
					payload: firstPayload,
				}),
			).resolves.toEqual({
				operationId: firstPayload.operationId,
				sessionId: firstPayload.sessionId,
				writerGeneration: 2,
				cancellationAccepted: true,
			});
			await expect(
				replacementOne.command("chat_runtime.messages.list", {
					sessionId: "session-1",
				}),
			).rejects.toMatchObject({ code: "unsupported_capability" });
			await expect(
				secondRuntime.invoke({
					command: "chat_runtime.messages.list",
					payload: { sessionId: "session-2" },
				}),
			).resolves.toMatchObject({
				sessionId: "session-2",
				messages: [],
				hasMore: false,
			});
			expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(2);
		} finally {
			for (const release of originalReleases) release();
			releaseReplacementTwo?.();
			await original?.dispose();
			await replacementOne?.dispose();
			await replacementTwo?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});
});

describe("readBearerToken", () => {
	it("reads a bearer token with case-insensitive scheme", () => {
		expect(readBearerToken("Bearer token")).toBe("token");
		expect(readBearerToken("bearer token")).toBe("token");
	});

	it("reads a bearer token separated by tabs without regex backtracking", () => {
		expect(readBearerToken(`bearer\t\t${"token"}`)).toBe("token");
		expect(readBearerToken(`bearer${"\t".repeat(10_000)}token`)).toBe("token");
	});

	it("rejects missing and malformed bearer tokens", () => {
		expect(readBearerToken(undefined)).toBeNull();
		expect(readBearerToken("Bearer")).toBeNull();
		expect(readBearerToken("BearerToken")).toBeNull();
		expect(readBearerToken("Basic token")).toBeNull();
	});
});

describe("workspace upgrade protocol", () => {
	it("extracts only the dedicated one-time workspace credential", () => {
		expect(
			readWebSocketWorkspaceCapability(
				"cline-hub-auth.daemon, cline-hub-workspace.one-time",
			),
		).toBe("one-time");
		expect(
			readWebSocketWorkspaceCapability("cline-hub-auth.daemon"),
		).toBeNull();
		expect(readWebSocketWorkspaceCapability("cline-hub-workspace.")).toBeNull();
		expect(
			readWebSocketWorkspaceCapability(
				"cline-hub-workspace.first, cline-hub-workspace.second",
			),
		).toBeNull();
	});
});

describe("loopback websocket origin auth", () => {
	it("recognizes loopback Hub hosts and browser origins", () => {
		expect(isLocalHubHostName("127.0.0.1")).toBe(true);
		expect(isLocalHubHostName("localhost")).toBe(true);
		expect(isLocalHubHostName("::1")).toBe(true);
		expect(isLocalHubOrigin("http://localhost:3000")).toBe(true);
		expect(isLocalHubOrigin("http://127.0.0.1:3017")).toBe(true);
	});

	it("rejects non-loopback browser origins", () => {
		expect(isLocalHubOrigin("https://example.com")).toBe(false);
		expect(isLocalHubOrigin("http://192.168.1.10:3000")).toBe(false);
		expect(isLocalHubOrigin(undefined)).toBe(false);
	});
});
