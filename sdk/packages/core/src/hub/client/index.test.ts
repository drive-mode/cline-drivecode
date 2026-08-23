import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInProcessHubWorkspaceCapabilityProvider,
	HubTransportError,
	isHubReconnectableTransportError,
	NodeHubClient,
} from "../client";

type SocketListener = (...args: unknown[]) => void;
type MessageListener = (event: { data: string }) => void;
type GenericListener = (...args: unknown[]) => void;

class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: MockWebSocket[] = [];
	static registrationFailures = 0;

	readyState = MockWebSocket.CONNECTING;
	readonly sentFrames: unknown[] = [];
	private readonly listeners = new Map<string, SocketListener[]>();

	constructor(
		public readonly url: string,
		public readonly protocols?: string | string[],
	) {
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = MockWebSocket.OPEN;
			this.emit("open");
		});
	}

	static reset(): void {
		MockWebSocket.instances = [];
		MockWebSocket.registrationFailures = 0;
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: { requestId?: string; command?: string };
		};
		this.sentFrames.push(frame);
		if (frame.kind === "command" && frame.envelope?.requestId) {
			const rejectRegistration =
				frame.envelope.command === "client.register" &&
				MockWebSocket.registrationFailures-- > 0;
			queueMicrotask(() => {
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							command: "client.register",
							requestId: frame.envelope?.requestId,
							ok: !rejectRegistration,
							clientId: "hub",
							...(rejectRegistration
								? {
										error: {
											code: "client_conflict",
											message: "registration rejected",
										},
									}
								: { payload: {} }),
						},
					}),
				});
			});
		}
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
		queueMicrotask(() => {
			this.emit("close", { code: 1000, reason: "" });
		});
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	emit(type: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(...args);
		}
	}
}

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];

	public readyState = 0;
	private readonly listeners = new Map<string, Set<GenericListener>>();

	constructor(_url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: GenericListener): void {
		const current = this.listeners.get(type) ?? new Set<GenericListener>();
		current.add(listener);
		this.listeners.set(type, current);
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: { requestId?: string; command?: string };
		};
		if (
			frame.kind === "command" &&
			frame.envelope?.command === "client.register" &&
			frame.envelope.requestId
		) {
			queueMicrotask(() => {
				this.emit("message", {
					data: JSON.stringify({
						kind: "reply",
						envelope: {
							version: "v1",
							requestId: frame.envelope?.requestId,
							ok: true,
							payload: {},
						},
					}),
				});
			});
		}
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	open(): void {
		this.readyState = 1;
		this.emit("open");
	}

	fail(payload?: unknown): void {
		this.emit("error", payload);
	}

	private emit(type: string, payload?: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) {
			if (type === "message") {
				(listener as MessageListener)(payload as { data: string });
				continue;
			}
			listener(payload);
		}
	}
}

describe("NodeHubClient", () => {
	describe("subscription re-registration", () => {
		afterEach(() => {
			MockWebSocket.reset();
			vi.unstubAllGlobals();
		});

		it("re-subscribes global listeners without sending the wildcard sentinel", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);

			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			expect(client.isConnected()).toBe(false);
			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(client.getConnectionError()).toBeNull();
			client.subscribe(() => {});

			const firstSocket = MockWebSocket.instances[0];
			expect(firstSocket.sentFrames).toContainEqual({
				kind: "stream.subscribe",
				clientId: client.getClientId(),
			});

			firstSocket.emit("close", { code: 1006, reason: "" });
			expect(client.isConnected()).toBe(false);
			expect(client.getConnectionError()).toMatchObject({
				code: "hub_connection_closed",
				message: "Hub connection closed (code=1006)",
			});

			await client.connect();
			expect(client.isConnected()).toBe(true);
			expect(client.getConnectionError()).toBeNull();

			const secondSocket = MockWebSocket.instances[1];
			expect(secondSocket.sentFrames).toContainEqual({
				kind: "stream.subscribe",
				clientId: client.getClientId(),
			});
			expect(secondSocket.sentFrames).not.toContainEqual({
				kind: "stream.subscribe",
				clientId: client.getClientId(),
				sessionId: "*",
			});
		});

		it("fences stale events across runtime unsubscribe and resubscribe", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			await client.connect();
			const socket = MockWebSocket.instances[0];
			const firstListener = vi.fn();
			const releaseFirst = client.subscribe(firstListener, {
				sessionId: "session-1",
				fenced: true,
			});
			const firstSubscribe = socket.sentFrames.find(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as { subscriptionId?: string } | undefined;
			expect(firstSubscribe?.subscriptionId).toMatch(/^hub_subscription_/);

			socket.emit("message", {
				data: JSON.stringify({
					kind: "event",
					subscriptionId: firstSubscribe?.subscriptionId,
					envelope: {
						version: "v1",
						event: "chat.runtime",
						sessionId: "session-1",
						payload: {},
					},
				}),
			});
			expect(firstListener).toHaveBeenCalledOnce();

			releaseFirst();
			const secondListener = vi.fn();
			client.subscribe(secondListener, {
				sessionId: "session-1",
				fenced: true,
			});
			const subscriptionFrames = socket.sentFrames.filter(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as Array<{ subscriptionId?: string }>;
			const secondSubscriptionId = subscriptionFrames.at(-1)?.subscriptionId;
			expect(secondSubscriptionId).toMatch(/^hub_subscription_/);
			expect(secondSubscriptionId).not.toBe(firstSubscribe?.subscriptionId);

			for (const subscriptionId of [
				firstSubscribe?.subscriptionId,
				undefined,
				secondSubscriptionId,
			]) {
				socket.emit("message", {
					data: JSON.stringify({
						kind: "event",
						...(subscriptionId ? { subscriptionId } : {}),
						envelope: {
							version: "v1",
							event: "chat.runtime",
							sessionId: "session-1",
							payload: {},
						},
					}),
				});
			}
			expect(secondListener).toHaveBeenCalledOnce();
			await client.dispose();
		});

		it("requires durable reclaim before reconnecting a cursor subscription", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientId: "cursor-client",
			});
			expect(client.getRegisteredConnectionGeneration()).toBeUndefined();
			await client.connect();
			const firstConnectionGeneration =
				client.getRegisteredConnectionGeneration();
			expect(firstConnectionGeneration).toBeTypeOf("number");
			if (firstConnectionGeneration === undefined) {
				throw new Error("registered connection generation missing");
			}
			let cursor = {
				streamId: "runtime-stream-1",
				sessionSequence: 1,
			};
			const onStatus = vi.fn();
			const release = client.subscribe(() => undefined, {
				sessionId: "session-1",
				fenced: true,
				runtimeCursor: () => cursor,
				onStatus,
			});
			const firstSocket = MockWebSocket.instances[0];
			const firstSubscribe = firstSocket?.sentFrames.find(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as
				| {
						subscriptionId: string;
						runtimeCursor: typeof cursor;
				  }
				| undefined;
			expect(firstSubscribe?.runtimeCursor).toEqual(cursor);
			firstSocket?.emit("message", {
				data: JSON.stringify({
					kind: "stream.status",
					clientId: "cursor-client",
					sessionId: "session-1",
					subscriptionId: firstSubscribe?.subscriptionId,
					status: "ready",
					runtimeCursor: cursor,
				}),
			});
			expect(onStatus).toHaveBeenLastCalledWith({
				status: "ready",
				runtimeCursor: cursor,
			});

			cursor = { ...cursor, sessionSequence: 3 };
			firstSocket?.emit("close", { code: 1006, reason: "transport lost" });
			expect(client.getRegisteredConnectionGeneration()).toBeUndefined();
			expect(onStatus).toHaveBeenLastCalledWith({
				status: "rejected",
				errorCode: "session_reclaim_required",
			});
			expect(onStatus).toHaveBeenCalledTimes(2);
			await client.connect();
			expect(client.getRegisteredConnectionGeneration()).toBeGreaterThan(
				firstConnectionGeneration,
			);
			const secondSocket = MockWebSocket.instances[1];
			expect(() =>
				client.subscribe(() => undefined, {
					sessionId: "session-1",
					fenced: true,
					requiredConnectionGeneration: firstConnectionGeneration,
				}),
			).toThrow(expect.objectContaining({ code: "hub_connection_changed" }));
			expect(
				secondSocket?.sentFrames.filter(
					(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
				),
			).toEqual([]);
			expect(onStatus).toHaveBeenLastCalledWith({
				status: "rejected",
				errorCode: "session_reclaim_required",
			});
			expect(onStatus).toHaveBeenCalledTimes(2);
			release();
			expect(
				secondSocket?.sentFrames.filter(
					(frame) => (frame as { kind?: string }).kind === "stream.unsubscribe",
				),
			).toEqual([]);
			await client.dispose();
		});

		it("re-evaluates a lifecycle checkpoint for each physical subscription", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientId: "lifecycle-cursor-client",
			});
			await client.connect();
			let checkpoint = 10;
			const onStatus = vi.fn();
			const release = client.subscribe(() => undefined, {
				fenced: true,
				lifecycleCursor: () => ({ afterSequence: checkpoint }),
				onStatus,
			});
			const firstSocket = MockWebSocket.instances[0];
			const firstSubscribe = firstSocket?.sentFrames.find(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as
				| {
						subscriptionId: string;
						lifecycleCursor: { afterSequence: number };
				  }
				| undefined;
			expect(firstSubscribe?.lifecycleCursor).toEqual({ afterSequence: 10 });
			firstSocket?.emit("message", {
				data: JSON.stringify({
					kind: "stream.status",
					clientId: "lifecycle-cursor-client",
					subscriptionId: firstSubscribe?.subscriptionId,
					status: "ready",
					lifecycleReady: {
						version: "v1",
						stream: "chat.changed",
						afterSequence: 10,
						throughSequence: 12,
					},
				}),
			});
			expect(onStatus).toHaveBeenLastCalledWith({
				status: "ready",
				lifecycleReady: expect.objectContaining({ throughSequence: 12 }),
			});

			checkpoint = 15;
			firstSocket?.emit("close", { code: 1006, reason: "transport lost" });
			await client.connect();
			const secondSocket = MockWebSocket.instances[1];
			const secondSubscribe = secondSocket?.sentFrames.find(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as
				| {
						subscriptionId: string;
						lifecycleCursor: { afterSequence: number };
				  }
				| undefined;
			expect(secondSubscribe?.lifecycleCursor).toEqual({ afterSequence: 15 });
			expect(onStatus).toHaveBeenCalledTimes(1);
			release();
			await client.dispose();
		});

		it("retires a session-scoped ready frame for a global lifecycle cursor", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientId: "lifecycle-scope-client",
			});
			await client.connect();
			client.subscribe(() => undefined, {
				fenced: true,
				lifecycleCursor: () => ({ afterSequence: 10 }),
			});
			const socket = MockWebSocket.instances[0];
			const subscribe = socket?.sentFrames.find(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as { subscriptionId?: string } | undefined;
			socket?.emit("message", {
				data: JSON.stringify({
					kind: "stream.status",
					clientId: "lifecycle-scope-client",
					sessionId: "session-1",
					subscriptionId: subscribe?.subscriptionId,
					status: "ready",
					lifecycleReady: {
						version: "v1",
						stream: "chat.changed",
						afterSequence: 10,
						throughSequence: 10,
					},
				}),
			});

			expect(client.getConnectionError()).toMatchObject({
				code: "hub_protocol_error",
			});
			expect(socket?.readyState).toBe(MockWebSocket.CLOSED);
			await client.dispose();
		});

		it("rejects a command fenced to a retired connection before sending", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientId: "command-generation-client",
			});
			await client.connect();
			const retiredGeneration = client.getRegisteredConnectionGeneration();
			if (retiredGeneration === undefined) {
				throw new Error("registered connection generation missing");
			}
			client.close();
			await client.connect();
			const replacement = MockWebSocket.instances[1];

			await expect(
				client.command("client.list", undefined, undefined, {
					requiredConnectionGeneration: retiredGeneration,
				}),
			).rejects.toMatchObject({ code: "hub_connection_changed" });
			expect(
				replacement?.sentFrames.filter(
					(frame) =>
						(frame as { envelope?: { command?: string } }).envelope?.command ===
						"client.list",
				),
			).toEqual([]);
			await client.dispose();
		});

		it("rejects every fenced physical subscription that is not acknowledged", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientId: "ack-timeout-client",
			});
			await client.connect();
			vi.useFakeTimers();
			try {
				const onStatus = vi.fn();
				client.subscribe(() => undefined, {
					sessionId: "session-1",
					fenced: true,
					onStatus,
				});
				await vi.advanceTimersByTimeAsync(10_001);
				expect(onStatus).toHaveBeenCalledOnce();
				expect(onStatus).toHaveBeenCalledWith({
					status: "rejected",
					errorCode: "subscription_ack_timeout",
				});
			} finally {
				client.close();
				vi.useRealTimers();
			}
		});

		it("cancels the physical acknowledgement watchdog after readiness", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientId: "ack-ready-client",
			});
			await client.connect();
			vi.useFakeTimers();
			try {
				const onStatus = vi.fn();
				client.subscribe(() => undefined, {
					sessionId: "session-1",
					fenced: true,
					onStatus,
				});
				const socket = MockWebSocket.instances[0];
				const subscribe = socket?.sentFrames.find(
					(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
				) as { subscriptionId?: string } | undefined;
				socket?.emit("message", {
					data: JSON.stringify({
						kind: "stream.status",
						clientId: "ack-ready-client",
						sessionId: "session-1",
						subscriptionId: subscribe?.subscriptionId,
						status: "ready",
					}),
				});
				await vi.advanceTimersByTimeAsync(10_001);
				expect(onStatus).toHaveBeenCalledOnce();
				expect(onStatus).toHaveBeenCalledWith({ status: "ready" });
			} finally {
				client.close();
				vi.useRealTimers();
			}
		});

		it("reconnects and re-subscribes active listeners after an idle close", async () => {
			vi.useFakeTimers();
			vi.stubGlobal("WebSocket", MockWebSocket);

			try {
				const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
				await client.connect();
				client.subscribe(() => {});

				const firstSocket = MockWebSocket.instances[0];
				firstSocket.emit("close", { code: 1006, reason: "Connection ended" });

				await vi.advanceTimersByTimeAsync(251);
				await Promise.resolve();
				await Promise.resolve();

				const secondSocket = MockWebSocket.instances[1];
				expect(secondSocket).toBeDefined();
				expect(secondSocket.sentFrames).toContainEqual({
					kind: "stream.subscribe",
					clientId: client.getClientId(),
				});

				await client.dispose();
			} finally {
				vi.useRealTimers();
			}
		});

		it("acquires a fresh workspace capability for every physical socket", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const credentials = ["A".repeat(43), "B".repeat(43)];
			const getFreshCapability = vi.fn(() => ({
				credential: credentials.shift() ?? "C".repeat(43),
			}));
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				authToken: "daemon-token-must-not-be-combined",
				workspaceCapabilityProvider: { getFreshCapability },
			});

			await client.connect();
			client.close();
			await client.connect();

			expect(getFreshCapability).toHaveBeenCalledTimes(2);
			expect(MockWebSocket.instances[0]?.protocols).toEqual([
				`cline-hub-workspace.${"A".repeat(43)}`,
			]);
			expect(MockWebSocket.instances[1]?.protocols).toEqual([
				`cline-hub-workspace.${"B".repeat(43)}`,
			]);
			expect(JSON.stringify(MockWebSocket.instances)).not.toContain(
				"daemon-token-must-not-be-combined",
			);
			await client.dispose();
		});

		it("retires a rejected registration and retries with a fresh capability", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			MockWebSocket.registrationFailures = 1;
			const credentials = ["H".repeat(43), "I".repeat(43)];
			const getFreshCapability = vi.fn(() => ({
				credential: credentials.shift() ?? "J".repeat(43),
			}));
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				workspaceCapabilityProvider: { getFreshCapability },
			});

			await expect(client.connect()).rejects.toMatchObject({
				code: "client_conflict",
			});
			expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED);
			await expect(client.connect()).resolves.toBeUndefined();

			expect(getFreshCapability).toHaveBeenCalledTimes(2);
			expect(MockWebSocket.instances).toHaveLength(2);
			expect(MockWebSocket.instances[1]?.protocols).toEqual([
				`cline-hub-workspace.${"I".repeat(43)}`,
			]);
			await client.dispose();
		});

		it("retires malformed inbound frames, reconnects, and isolates listeners", async () => {
			vi.useFakeTimers();
			vi.stubGlobal("WebSocket", MockWebSocket);
			try {
				const client = new NodeHubClient({
					url: "ws://127.0.0.1:25463/hub",
				});
				const delivered = vi.fn();
				client.subscribe(() => {
					throw new Error("consumer failed");
				});
				client.subscribe(delivered);
				await client.connect();
				const firstSocket = MockWebSocket.instances[0];
				firstSocket.emit("message", { data: "{" });

				expect(client.getConnectionError()).toMatchObject({
					code: "hub_protocol_error",
					message: "Hub sent a malformed transport frame.",
				});
				expect(firstSocket.readyState).toBe(MockWebSocket.CLOSED);
				await vi.advanceTimersByTimeAsync(251);
				await Promise.resolve();
				await Promise.resolve();
				const secondSocket = MockWebSocket.instances[1];
				expect(secondSocket).toBeDefined();

				secondSocket.emit("message", {
					data: JSON.stringify({
						kind: "event",
						envelope: {
							version: "v1",
							event: "session.updated",
							payload: {},
						},
					}),
				});
				expect(delivered).toHaveBeenCalledOnce();
				await client.dispose();
			} finally {
				vi.useRealTimers();
			}
		});

		it("drops queued frames from a retired physical socket", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
			});
			await client.connect();
			const delivered = vi.fn();
			client.subscribe(delivered, {
				sessionId: "session-1",
				fenced: true,
			});
			const socket = MockWebSocket.instances[0];
			const subscription = socket?.sentFrames.find(
				(frame) => (frame as { kind?: string }).kind === "stream.subscribe",
			) as { subscriptionId?: string } | undefined;

			socket?.emit("message", { data: "{" });
			socket?.emit("message", {
				data: JSON.stringify({
					kind: "event",
					subscriptionId: subscription?.subscriptionId,
					envelope: {
						version: "v1",
						event: "chat.runtime",
						sessionId: "session-1",
						payload: {},
					},
				}),
			});

			expect(delivered).not.toHaveBeenCalled();
			client.close();
		});

		it("deduplicates concurrent capability acquisition and sanitizes failures", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			let resolveGrant: ((grant: { credential: string }) => void) | undefined;
			const getFreshCapability = vi.fn(
				() =>
					new Promise<{ credential: string }>((resolve) => {
						resolveGrant = resolve;
					}),
			);
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				workspaceCapabilityProvider: { getFreshCapability },
			});

			const first = client.connect();
			const second = client.connect();
			expect(getFreshCapability).toHaveBeenCalledTimes(1);
			resolveGrant?.({ credential: "D".repeat(43) });
			await Promise.all([first, second]);
			expect(MockWebSocket.instances).toHaveLength(1);
			await client.dispose();

			MockWebSocket.reset();
			const secret = "E".repeat(43);
			const failing = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				workspaceCapabilityProvider: {
					getFreshCapability: () => {
						throw new Error(`provider leaked ${secret}`);
					},
				},
			});
			await expect(failing.connect()).rejects.toMatchObject({
				code: "hub_workspace_capability_failed",
				message: "Failed to obtain a fresh Hub workspace capability.",
			});
			expect(failing.getConnectionError()?.message).not.toContain(secret);
			expect(MockWebSocket.instances).toHaveLength(0);
		});

		it("adapts the in-process issuer without exposing workspace paths", async () => {
			const issue = vi.fn(() => ({ credential: "F".repeat(43) }));
			const provider = createInProcessHubWorkspaceCapabilityProvider(
				{ issue },
				"opaque-workspace-id",
			);

			await expect(
				Promise.resolve(
					provider.getFreshCapability({
						hubUrl: "ws://127.0.0.1:25463/hub",
						clientId: "client-1",
					}),
				),
			).resolves.toEqual({ credential: "F".repeat(43) });
			expect(issue).toHaveBeenCalledWith({
				workspaceId: "opaque-workspace-id",
			});
			expect(() =>
				createInProcessHubWorkspaceCapabilityProvider({ issue }, " "),
			).toThrow("Workspace ID is required");
		});

		it("does not open a socket when closed during capability acquisition", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);
			let resolveGrant: ((grant: { credential: string }) => void) | undefined;
			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				workspaceCapabilityProvider: {
					getFreshCapability: () =>
						new Promise<{ credential: string }>((resolve) => {
							resolveGrant = resolve;
						}),
				},
			});
			const connecting = client.connect();
			client.close();
			resolveGrant?.({ credential: "G".repeat(43) });

			await expect(connecting).rejects.toMatchObject({
				code: "hub_connection_closed",
			});
			expect(MockWebSocket.instances).toHaveLength(0);
		});

		it("unregisters before closing when disposed", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);

			const client = new NodeHubClient({
				url: "ws://127.0.0.1:25463/hub",
				clientType: "code-sidecar",
			});
			await client.connect();
			const socket = MockWebSocket.instances[0];

			await client.dispose();

			expect(socket.sentFrames).toContainEqual(
				expect.objectContaining({
					kind: "command",
					envelope: expect.objectContaining({
						command: "client.unregister",
						clientId: client.getClientId(),
					}),
				}),
			);
			expect(socket.readyState).toBe(MockWebSocket.CLOSED);
		});

		it("ignores stale close events from retired sockets", async () => {
			vi.stubGlobal("WebSocket", MockWebSocket);

			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			await client.connect();
			client.close();

			await expect(client.connect()).resolves.toBeUndefined();

			expect(MockWebSocket.instances).toHaveLength(2);
			expect(MockWebSocket.instances[1]?.sentFrames).toContainEqual(
				expect.objectContaining({
					kind: "command",
					envelope: expect.objectContaining({
						command: "client.register",
						clientId: client.getClientId(),
					}),
				}),
			);

			await client.dispose();
		});
	});

	describe("timeouts", () => {
		const originalWebSocket = globalThis.WebSocket;

		beforeEach(() => {
			vi.useFakeTimers();
			FakeWebSocket.instances = [];
			(
				globalThis as unknown as { WebSocket?: typeof FakeWebSocket }
			).WebSocket = FakeWebSocket;
		});

		afterEach(() => {
			vi.useRealTimers();
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
		});

		it("times out when the hub connection never opens", async () => {
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			const connectPromise = client.connect();
			const expectation = expect(connectPromise).rejects.toThrow(
				"Timed out connecting to hub after 8000ms",
			);

			await vi.advanceTimersByTimeAsync(8_001);
			await expectation;
			await expect(connectPromise).rejects.toMatchObject({
				name: "HubTransportError",
				code: "hub_connect_timeout",
			});
		});

		it("times out when a hub command never replies", async () => {
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			const connectPromise = client.connect();
			const socket = FakeWebSocket.instances[0];
			if (!socket) {
				throw new Error("expected fake websocket instance");
			}
			socket.open();
			await connectPromise;

			const commandPromise = client.command("client.list");
			const expectation = expect(commandPromise).rejects.toThrow(
				"Hub command client.list timed out after 30000ms",
			);
			await vi.advanceTimersByTimeAsync(30_001);
			await expectation;
		});

		it("allows commands to opt out of the reply timeout", async () => {
			const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
			const connectPromise = client.connect();
			const socket = FakeWebSocket.instances[0];
			if (!socket) {
				throw new Error("expected fake websocket instance");
			}
			socket.open();
			await connectPromise;

			const commandPromise = client.command(
				"client.list",
				undefined,
				undefined,
				{ timeoutMs: null },
			);
			await vi.advanceTimersByTimeAsync(30_001);

			let settled = false;
			void commandPromise.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			await Promise.resolve();

			expect(settled).toBe(false);
			const requestId = [
				...(
					client as unknown as { pendingReplies: Map<string, unknown> }
				).pendingReplies.keys(),
			][0];

			(
				socket as unknown as { emit: (type: string, payload: unknown) => void }
			).emit("message", {
				data: JSON.stringify({
					kind: "reply",
					envelope: {
						version: "v1",
						requestId,
						ok: true,
						payload: { clients: [] },
					},
				}),
			});
			await expect(commandPromise).resolves.toMatchObject({
				ok: true,
				payload: { clients: [] },
			});
		});
	});

	it("normalizes websocket error events during connect", async () => {
		const originalWebSocket = globalThis.WebSocket;
		(globalThis as unknown as { WebSocket?: typeof FakeWebSocket }).WebSocket =
			FakeWebSocket;
		FakeWebSocket.instances = [];

		const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
		const connectPromise = client.connect();
		const socket = FakeWebSocket.instances[0];
		if (!socket) {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
			throw new Error("expected fake websocket instance");
		}

		socket.fail({ type: "error" });

		try {
			await expect(connectPromise).rejects.toThrow(
				"Failed to connect to hub at ws://127.0.0.1:25463/hub (error event before socket open).",
			);
		} finally {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
		}
	});

	it("surfaces websocket error messages during connect", async () => {
		const originalWebSocket = globalThis.WebSocket;
		(globalThis as unknown as { WebSocket?: typeof FakeWebSocket }).WebSocket =
			FakeWebSocket;
		FakeWebSocket.instances = [];

		const client = new NodeHubClient({ url: "ws://127.0.0.1:25463/hub" });
		const connectPromise = client.connect();
		const socket = FakeWebSocket.instances[0];
		if (!socket) {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
			throw new Error("expected fake websocket instance");
		}

		socket.fail({ type: "error", message: "socket unavailable" });

		try {
			await expect(connectPromise).rejects.toThrow("socket unavailable");
		} finally {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
		}
	});

	it("marks transport errors as reconnectable", () => {
		expect(
			isHubReconnectableTransportError(
				new HubTransportError("hub_connection_closed", "closed"),
			),
		).toBe(true);
		expect(isHubReconnectableTransportError(new Error("closed"))).toBe(false);
	});

	it("rediscovers the local hub and retries commands after transport close", async () => {
		vi.resetModules();
		const originalWebSocket = globalThis.WebSocket;
		const recoveredUrl = "ws://127.0.0.1:25464/hub";
		const record = {
			hubId: "hub-test",
			protocolVersion: "v1",
			buildId: "test-build",
			authToken: "token",
			host: "127.0.0.1",
			port: 25464,
			url: recoveredUrl,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		class RecoveryWebSocket {
			readyState = 0;
			private failedCommand = false;
			private readonly listeners = new Map<string, Set<GenericListener>>();

			constructor(
				private readonly url: string,
				_protocols?: string | string[],
			) {
				queueMicrotask(() => {
					this.readyState = 1;
					this.emit("open");
				});
			}

			addEventListener(type: string, listener: GenericListener): void {
				const current = this.listeners.get(type) ?? new Set<GenericListener>();
				current.add(listener);
				this.listeners.set(type, current);
			}

			send(data: string): void {
				const frame = JSON.parse(data) as {
					kind?: string;
					envelope?: { requestId?: string; command?: string };
				};
				if (frame.kind !== "command" || !frame.envelope?.requestId) {
					return;
				}
				if (frame.envelope.command === "client.register") {
					queueMicrotask(() => {
						this.emit("message", {
							data: JSON.stringify({
								kind: "reply",
								envelope: {
									version: "v1",
									requestId: frame.envelope?.requestId,
									ok: true,
									payload: {},
								},
							}),
						});
					});
					return;
				}
				if (this.url.includes(":25463/") && !this.failedCommand) {
					this.failedCommand = true;
					queueMicrotask(() => {
						this.readyState = 3;
						this.emit("close", { code: 1006, reason: "" });
					});
					return;
				}
				queueMicrotask(() => {
					this.emit("message", {
						data: JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								requestId: frame.envelope?.requestId,
								ok: true,
								payload: { clients: [] },
							},
						}),
					});
				});
			}

			close(): void {
				this.readyState = 3;
				this.emit("close", { code: 1000, reason: "" });
			}

			private emit(type: string, payload?: unknown): void {
				for (const listener of this.listeners.get(type) ?? []) {
					if (type === "message") {
						(listener as MessageListener)(payload as { data: string });
						continue;
					}
					listener(payload);
				}
			}
		}

		(
			globalThis as unknown as { WebSocket?: typeof RecoveryWebSocket }
		).WebSocket = RecoveryWebSocket;
		vi.doMock("../daemon", () => ({
			spawnDetachedHubServerWithRetry: vi.fn(async () => undefined),
		}));
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery-recovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "test-build",
				readHubDiscovery: vi.fn(async () => record),
				probeHubServer: vi.fn(async (url: string) =>
					url.includes(":25464/") ? record : undefined,
				),
				clearHubDiscovery: vi.fn(async () => undefined),
			};
		});

		try {
			const { NodeHubClient: DynamicClient, rememberRecoverableLocalHubUrl } =
				await import(".");
			rememberRecoverableLocalHubUrl("ws://127.0.0.1:25463/hub");
			const client = new DynamicClient({
				url: "ws://127.0.0.1:25463/hub",
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
			});

			await expect(client.command("client.list")).resolves.toMatchObject({
				ok: true,
				payload: { clients: [] },
			});
			expect(client.getUrl()).toBe(recoveredUrl);
			await client.dispose();
		} finally {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
			vi.resetModules();
		}
	});

	it("does not rediscover explicit local hub endpoints", async () => {
		vi.resetModules();
		const originalWebSocket = globalThis.WebSocket;
		const originalUrl = "ws://127.0.0.1:25463/hub";
		const recoveredUrl = "ws://127.0.0.1:25464/hub";
		const record = {
			hubId: "hub-test",
			protocolVersion: "v1",
			buildId: "test-build",
			authToken: "token",
			host: "127.0.0.1",
			port: 25464,
			url: recoveredUrl,
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		class ExplicitEndpointWebSocket {
			readyState = 0;
			private readonly listeners = new Map<string, Set<GenericListener>>();

			constructor(
				private readonly url: string,
				_protocols?: string | string[],
			) {
				queueMicrotask(() => {
					this.readyState = 1;
					this.emit("open");
				});
			}

			addEventListener(type: string, listener: GenericListener): void {
				const current = this.listeners.get(type) ?? new Set<GenericListener>();
				current.add(listener);
				this.listeners.set(type, current);
			}

			send(data: string): void {
				const frame = JSON.parse(data) as {
					kind?: string;
					envelope?: { requestId?: string; command?: string };
				};
				if (frame.kind !== "command" || !frame.envelope?.requestId) {
					return;
				}
				if (frame.envelope.command === "client.register") {
					queueMicrotask(() => {
						this.emit("message", {
							data: JSON.stringify({
								kind: "reply",
								envelope: {
									version: "v1",
									requestId: frame.envelope?.requestId,
									ok: true,
									payload: {},
								},
							}),
						});
					});
					return;
				}
				if (this.url === originalUrl) {
					queueMicrotask(() => {
						this.readyState = 3;
						this.emit("close", { code: 1006, reason: "" });
					});
					return;
				}
				queueMicrotask(() => {
					this.emit("message", {
						data: JSON.stringify({
							kind: "reply",
							envelope: {
								version: "v1",
								requestId: frame.envelope?.requestId,
								ok: true,
								payload: { clients: [] },
							},
						}),
					});
				});
			}

			close(): void {
				this.readyState = 3;
				this.emit("close", { code: 1000, reason: "" });
			}

			private emit(type: string, payload?: unknown): void {
				for (const listener of this.listeners.get(type) ?? []) {
					if (type === "message") {
						(listener as MessageListener)(payload as { data: string });
						continue;
					}
					listener(payload);
				}
			}
		}

		(
			globalThis as unknown as { WebSocket?: typeof ExplicitEndpointWebSocket }
		).WebSocket = ExplicitEndpointWebSocket;
		vi.doMock("../daemon", () => ({
			spawnDetachedHubServerWithRetry: vi.fn(async () => undefined),
		}));
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery-explicit.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "test-build",
				readHubDiscovery: vi.fn(async () => record),
				probeHubServer: vi.fn(async (url: string) =>
					url.includes(":25464/") ? record : undefined,
				),
				clearHubDiscovery: vi.fn(async () => undefined),
			};
		});

		try {
			const { NodeHubClient: DynamicClient } = await import(".");
			const client = new DynamicClient({
				url: originalUrl,
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
			});

			await expect(client.command("client.list")).rejects.toMatchObject({
				name: "HubTransportError",
				code: "hub_connection_closed",
			});
			expect(client.getUrl()).toBe(originalUrl);
			await client.dispose();
		} finally {
			if (originalWebSocket) {
				globalThis.WebSocket = originalWebSocket;
			} else {
				delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
			}
			vi.resetModules();
		}
	});
});

describe("resolveCompatibleLocalHubUrl", () => {
	// Reset the module registry *before* each test so the `vi.doMock(...)`
	// calls below register against a fresh `./client` module graph. Without
	// this, the static `import { NodeHubClient } from "../client"` at the top
	// of the file has already cached `./client` (and its real `./discovery`
	// + `./workspace` bindings) before any test runs, so `vi.doMock` never
	// takes effect for the dynamic `await import(".")`. That cache
	// contamination causes the test to hit the real discovery/probe code
	// path and fail locally whenever a stray hub daemon is listening on
	// the default port (passes in CI only because no daemon is running).
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.CLINE_HUB_BUILD_ID;
		vi.resetModules();
	});

	it("does not clear discovery on transient probe failure", async () => {
		const clearHubDiscoveryMock = vi.fn();
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "test-build",
				readHubDiscovery: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					buildId: "test-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
				clearHubDiscovery: vi.fn(async (...args: unknown[]) => {
					clearHubDiscoveryMock(...args);
				}),
				probeHubServer: vi.fn(async () => undefined),
			};
		});

		const { resolveCompatibleLocalHubUrl } = await import(".");

		await expect(resolveCompatibleLocalHubUrl()).resolves.toBeUndefined();
		expect(clearHubDiscoveryMock).not.toHaveBeenCalled();
	});

	it("keeps discovery on build mismatch when protocol is compatible", async () => {
		const clearHubDiscoveryMock = vi.fn();
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "current-build",
				readHubDiscovery: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					buildId: "old-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
				clearHubDiscovery: vi.fn(async (...args: unknown[]) => {
					clearHubDiscoveryMock(...args);
				}),
				probeHubServer: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					buildId: "old-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
			};
		});

		const { resolveCompatibleLocalHubUrl } = await import(".");

		await expect(resolveCompatibleLocalHubUrl()).resolves.toBe(
			"ws://127.0.0.1:59999/hub",
		);
		expect(clearHubDiscoveryMock).not.toHaveBeenCalled();
	});

	it("keeps discovery when a hub omits build metadata but has compatible protocol", async () => {
		const clearHubDiscoveryMock = vi.fn();
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "current-build",
				readHubDiscovery: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
				clearHubDiscovery: vi.fn(async (...args: unknown[]) => {
					clearHubDiscoveryMock(...args);
				}),
				probeHubServer: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v1",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
			};
		});

		const { resolveCompatibleLocalHubUrl } = await import(".");

		await expect(resolveCompatibleLocalHubUrl()).resolves.toBe(
			"ws://127.0.0.1:59999/hub",
		);
		expect(clearHubDiscoveryMock).not.toHaveBeenCalled();
	});

	it("clears discovery on protocol mismatch", async () => {
		const clearHubDiscoveryMock = vi.fn();
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				readHubDiscovery: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v0",
					buildId: "old-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
				clearHubDiscovery: vi.fn(async (...args: unknown[]) => {
					clearHubDiscoveryMock(...args);
				}),
				probeHubServer: vi.fn(async () => ({
					hubId: "hub-test",
					protocolVersion: "v0",
					buildId: "old-build",
					host: "127.0.0.1",
					port: 59999,
					url: "ws://127.0.0.1:59999/hub",
					startedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})),
			};
		});

		const { resolveCompatibleLocalHubUrl } = await import(".");

		await expect(resolveCompatibleLocalHubUrl()).resolves.toBeUndefined();
		expect(clearHubDiscoveryMock).toHaveBeenCalledWith(
			"/tmp/hub-discovery.json",
		);
	});

	it("starts missing local hubs through the retrying daemon spawn API", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const spawnDetachedHubServerWithRetryMock = vi.fn(async () => undefined);
		const record = {
			hubId: "hub-test",
			protocolVersion: "v1",
			buildId: "test-build",
			authToken: "token",
			host: "127.0.0.1",
			port: 25464,
			url: "ws://127.0.0.1:25464/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const readHubDiscoveryMock = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(record);
		vi.doMock("../daemon", () => ({
			spawnDetachedHubServerWithRetry: spawnDetachedHubServerWithRetryMock,
		}));
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				resolveHubBuildId: () => "test-build",
				readHubDiscovery: readHubDiscoveryMock,
				probeHubServer: vi.fn(async () => record),
				clearHubDiscovery: vi.fn(async () => undefined),
			};
		});

		const { ensureCompatibleLocalHubUrl } = await import(".");

		await expect(
			ensureCompatibleLocalHubUrl({
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
			}),
		).resolves.toBe("ws://127.0.0.1:25464/hub");
		expect(spawnDetachedHubServerWithRetryMock).toHaveBeenCalledWith(
			"/tmp/project",
		);
		expect(
			spawnDetachedHubServerWithRetryMock.mock.invocationCallOrder[0],
		).toBeGreaterThan(readHubDiscoveryMock.mock.invocationCallOrder[0]);
		expect(
			spawnDetachedHubServerWithRetryMock.mock.invocationCallOrder[0],
		).toBeLessThan(readHubDiscoveryMock.mock.invocationCallOrder[1]);
	});

	it("waits on shared discovery after spawning in development builds", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const originalBuildEnv = process.env.CLINE_BUILD_ENV;
		process.env.CLINE_BUILD_ENV = "development";
		const spawnDetachedHubServerWithRetryMock = vi.fn(async () => undefined);
		const record = {
			hubId: "hub-test",
			protocolVersion: "v1",
			buildId: "test-build",
			authToken: "token",
			host: "127.0.0.1",
			port: 25466,
			url: "ws://127.0.0.1:25466/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		const readHubDiscoveryMock = vi.fn(async (path: string) =>
			path === "/tmp/shared-hub-discovery.json" ? record : undefined,
		);
		vi.doMock("../daemon", () => ({
			spawnDetachedHubServerWithRetry: spawnDetachedHubServerWithRetryMock,
		}));
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "production",
				discoveryPath: "/tmp/production-hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "shared",
				discoveryPath: "/tmp/shared-hub-discovery.json",
			}),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				readHubDiscovery: readHubDiscoveryMock,
				probeHubServer: vi.fn(async () => record),
				clearHubDiscovery: vi.fn(async () => undefined),
			};
		});

		try {
			const { ensureCompatibleLocalHubUrl } = await import(".");

			await expect(
				ensureCompatibleLocalHubUrl({
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				}),
			).resolves.toBe("ws://127.0.0.1:25466/hub");
			expect(readHubDiscoveryMock).toHaveBeenCalledWith(
				"/tmp/shared-hub-discovery.json",
			);
			expect(readHubDiscoveryMock).not.toHaveBeenCalledWith(
				"/tmp/production-hub-discovery.json",
			);
		} finally {
			if (originalBuildEnv === undefined) {
				delete process.env.CLINE_BUILD_ENV;
			} else {
				process.env.CLINE_BUILD_ENV = originalBuildEnv;
			}
		}
	});

	it("does not restart explicit local endpoints after startup timeout", async () => {
		const readHubDiscoveryMock = vi.fn(async () => ({
			hubId: "hub-test",
			protocolVersion: "v1",
			buildId: "test-build",
			authToken: "token",
			host: "127.0.0.1",
			port: 25463,
			url: "ws://127.0.0.1:25463/hub",
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		}));
		vi.doMock("../discovery/workspace", () => ({
			resolveProductionHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
			resolveSharedHubOwnerContext: () => ({
				ownerId: "hub-test",
				discoveryPath: "/tmp/hub-discovery.json",
			}),
		}));
		vi.doMock("../daemon", () => ({
			spawnDetachedHubServerWithRetry: vi.fn(async () => undefined),
		}));
		vi.doMock("../discovery", async () => {
			const actual =
				await vi.importActual<typeof import("../discovery")>("../discovery");
			return {
				...actual,
				readHubDiscovery: readHubDiscoveryMock,
			};
		});

		const { restartLocalHubIfIdleAfterStartupTimeout } = await import(".");

		await expect(
			restartLocalHubIfIdleAfterStartupTimeout({
				url: "ws://127.0.0.1:25463/hub",
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
			}),
		).resolves.toBeUndefined();
		expect(readHubDiscoveryMock).not.toHaveBeenCalled();
	});
});
