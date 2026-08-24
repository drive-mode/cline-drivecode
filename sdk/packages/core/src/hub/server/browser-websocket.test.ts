import type { HubEventEnvelope, HubReplyEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";

function createSocket(autoComplete = true) {
	const messageListeners = new Set<(event: { data: string }) => void>();
	const closeListeners = new Set<() => void>();
	const pendingCompletions: Array<(error?: unknown) => void> = [];
	return {
		sent: [] as string[],
		pendingCompletions,
		closed: [] as Array<[number | undefined, string | undefined]>,
		terminated: 0,
		send(data: string, callback?: (error?: unknown) => void) {
			this.sent.push(data);
			if (autoComplete) callback?.();
			else if (callback) pendingCompletions.push(callback);
		},
		completeNext(error?: unknown) {
			pendingCompletions.shift()?.(error);
		},
		close(code?: number, reason?: string) {
			this.closed.push([code, reason]);
		},
		terminate() {
			this.terminated += 1;
		},
		addEventListener(
			type: "message" | "close",
			listener: ((event: { data: string }) => void) | (() => void),
		) {
			if (type === "message") {
				messageListeners.add(listener as (event: { data: string }) => void);
				return;
			}
			closeListeners.add(listener as () => void);
		},
		removeEventListener(
			type: "message" | "close",
			listener: ((event: { data: string }) => void) | (() => void),
		) {
			if (type === "message") {
				messageListeners.delete(listener as (event: { data: string }) => void);
				return;
			}
			closeListeners.delete(listener as () => void);
		},
		async emitMessage(data: string) {
			await Promise.all(
				[...messageListeners].map((listener) => listener({ data })),
			);
		},
		emitClose() {
			for (const listener of closeListeners) {
				listener();
			}
		},
		listenerCounts() {
			return {
				message: messageListeners.size,
				close: closeListeners.size,
			};
		},
	};
}

function runtimeEvent(
	sessionSequence: number,
	payload: Record<string, unknown>,
): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.runtime",
		eventId: `event-${sessionSequence}`,
		streamId: "runtime-stream-1",
		sessionId: "session-1",
		timestamp: sessionSequence,
		processSequence: sessionSequence,
		sessionSequence,
		payload,
	} as HubEventEnvelope;
}

function lifecycleEvent(
	catalogSequence: number,
	previousDeliveredSequence: number,
): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.changed",
		eventId: `catalog-event-${catalogSequence}`,
		timestamp: Date.parse("2026-08-15T12:00:00.000Z"),
		catalogSequence,
		previousDeliveredSequence,
		payload: {
			chatId: "chat-1",
			eventType: "chat.renamed",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			previousRevision: 1,
			resultingRevision: 2,
			occurredAt: "2026-08-15T12:00:00.000Z",
			chat: null,
		},
	} as HubEventEnvelope;
}

function asSocketTransport<T extends object>(transport: T) {
	return { ...transport, closeConnection: vi.fn() } as never;
}

describe("BrowserWebSocketHubAdapter", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("ignores malformed websocket frames instead of throwing", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const adapter = new BrowserWebSocketHubAdapter();
			adapter.attach(socket, asSocketTransport(transport));

			await expect(async () => {
				socket.emitMessage("{bad json");
				await Promise.resolve();
			}).not.toThrow();

			expect(transport.command).not.toHaveBeenCalled();
			expect(socket.sent).toHaveLength(0);
			expect(errorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					'"message":"rejected malformed websocket frame"',
				),
			);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("rejects command-shaped frames without a validated envelope", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const adapter = new BrowserWebSocketHubAdapter();
		adapter.attach(socket, asSocketTransport(transport));

		await expect(
			socket.emitMessage('{"kind":"command"}'),
		).resolves.toBeUndefined();

		expect(transport.command).not.toHaveBeenCalled();
		expect(socket.sent).toHaveLength(0);
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('"message":"rejected malformed websocket frame"'),
		);
	});

	it("closes immediately when an oversized runtime reply cannot be delivered", async () => {
		const transport = {
			command: vi.fn(async (envelope: { command: string }) =>
				envelope.command === "client.register"
					? ({ version: "v1", ok: true } satisfies HubReplyEnvelope)
					: ({
							version: "v1",
							ok: true,
							payload: { result: { text: "x".repeat(2_000) } },
						} satisfies HubReplyEnvelope),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter(undefined, {
			softWatermarkBytes: 256,
			hardWatermarkBytes: 512,
		});
		adapter.attach(socket, asSocketTransport(transport));
		await socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					requestId: "register-1",
					command: "client.register",
					clientId: "client-1",
					payload: { clientId: "client-1" },
				},
			}),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					requestId: "runtime-1",
					command: "chat_runtime.messages.list",
					clientId: "client-1",
					payload: { sessionId: "session-1" },
				},
			}),
		);
		expect(socket.closed).toEqual([[1013, "WebSocket outbound congestion"]]);
	});

	it("coalesces only adjacent assistant deltas and declares their exact range", async () => {
		let emit: ((event: HubEventEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(_clientId: string, listener: (event: HubEventEnvelope) => void) => {
					emit = listener;
					return () => undefined;
				},
			),
		};
		const socket = createSocket(false);
		const adapter = new BrowserWebSocketHubAdapter(undefined, {
			softWatermarkBytes: 1,
			hardWatermarkBytes: 4096,
		});
		adapter.attach(socket, asSocketTransport(transport));
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
				subscriptionId: "subscription-1",
			}),
		);
		expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
			kind: "stream.status",
			subscriptionId: "subscription-1",
			status: "ready",
		});
		socket.completeNext();

		emit?.(
			runtimeEvent(1, {
				kind: "assistant.delta",
				runId: "run-1",
				text: "a",
			}),
		);
		emit?.(
			runtimeEvent(2, {
				kind: "assistant.delta",
				runId: "run-1",
				text: "b",
			}),
		);
		emit?.(
			runtimeEvent(3, {
				kind: "assistant.delta",
				runId: "run-1",
				text: "é",
			}),
		);

		expect(socket.sent).toHaveLength(2);
		socket.completeNext();
		await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
		const merged = JSON.parse(socket.sent[2] ?? "{}");
		expect(merged).toEqual({
			kind: "event",
			subscriptionId: "subscription-1",
			envelope: {
				...runtimeEvent(3, {
					kind: "assistant.delta",
					runId: "run-1",
					text: "bé",
				}),
				sessionSequenceStart: 2,
			},
		});
	});

	it("enqueues cursor replay before acknowledging a fenced subscription", async () => {
		const replayed = runtimeEvent(2, {
			kind: "assistant.delta",
			runId: "run-1",
			text: "replayed",
		});
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(
					_clientId: string,
					listener: (event: HubEventEnvelope) => void,
					options: {
						onRuntimeReady?: (cursor: {
							streamId: string;
							sessionSequence: number;
						}) => void;
					},
				) => {
					listener(replayed);
					options.onRuntimeReady?.({
						streamId: "runtime-stream-1",
						sessionSequence: 2,
					});
					return () => undefined;
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
				subscriptionId: "subscription-recovery",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 1,
				},
			}),
		);
		expect(transport.subscribe).toHaveBeenCalledWith(
			"client-1",
			expect.any(Function),
			expect.objectContaining({
				sessionId: "session-1",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 1,
				},
				onRuntimeReady: expect.any(Function),
			}),
		);
		expect(socket.sent.map((frame) => JSON.parse(frame).kind)).toEqual([
			"event",
			"stream.status",
		]);
		expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({
			clientId: "client-1",
			subscriptionId: "subscription-recovery",
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 2,
			},
		});
	});

	it("enqueues lifecycle replay before acknowledging its fenced replay cut", async () => {
		const replayed = lifecycleEvent(2, 1);
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(
					_clientId: string,
					listener: (event: HubEventEnvelope) => void,
					options: {
						onLifecycleReady?: (ready: {
							version: "v1";
							stream: "chat.changed";
							afterSequence: number;
							throughSequence: number;
						}) => void;
					},
				) => {
					listener(replayed);
					options.onLifecycleReady?.({
						version: "v1",
						stream: "chat.changed",
						afterSequence: 1,
						throughSequence: 2,
					});
					return () => undefined;
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				subscriptionId: "lifecycle-recovery",
				lifecycleCursor: { afterSequence: 1 },
			}),
		);
		expect(transport.subscribe).toHaveBeenCalledWith(
			"client-1",
			expect.any(Function),
			expect.objectContaining({
				lifecycleCursor: { afterSequence: 1 },
				onLifecycleReady: expect.any(Function),
			}),
		);
		expect(socket.sent.map((frame) => JSON.parse(frame).kind)).toEqual([
			"event",
			"stream.status",
		]);
		expect(JSON.parse(socket.sent[1] ?? "{}")).toMatchObject({
			clientId: "client-1",
			subscriptionId: "lifecycle-recovery",
			status: "ready",
			lifecycleReady: {
				version: "v1",
				stream: "chat.changed",
				afterSequence: 1,
				throughSequence: 2,
			},
		});
	});

	it("rejects lifecycle replay when the source omits its ready cut", async () => {
		const release = vi.fn();
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(() => release),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				subscriptionId: "lifecycle-no-ready",
				lifecycleCursor: { afterSequence: 1 },
			}),
		);
		expect(release).toHaveBeenCalledOnce();
		expect(socket.sent.map((entry) => JSON.parse(entry))).toEqual([
			{
				kind: "stream.status",
				clientId: "client-1",
				subscriptionId: "lifecycle-no-ready",
				status: "rejected",
				errorCode: "subscription_rejected",
			},
		]);
	});

	it("rejects malformed or session-scoped lifecycle cursors before source use", async () => {
		const transport = { command: vi.fn(), subscribe: vi.fn() };
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		for (const frame of [
			{
				kind: "stream.subscribe",
				clientId: "client-1",
				subscriptionId: "lifecycle-malformed",
				lifecycleCursor: { afterSequence: -1 },
			},
			{
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
				subscriptionId: "lifecycle-session-scoped",
				lifecycleCursor: { afterSequence: 1 },
			},
		]) {
			await socket.emitMessage(JSON.stringify(frame));
		}
		expect(transport.subscribe).not.toHaveBeenCalled();
		expect(socket.sent.map((entry) => JSON.parse(entry).status)).toEqual([
			"rejected",
			"rejected",
		]);
	});

	it("returns a fixed rejected status when a cursor is unavailable", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(() => {
				throw new Error("private cursor detail");
			}),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
				subscriptionId: "subscription-rejected",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 1,
				},
			}),
		);
		expect(socket.sent).toHaveLength(1);
		expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({
			kind: "stream.status",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-rejected",
			status: "rejected",
			errorCode: "subscription_rejected",
		});
		expect(socket.sent[0]).not.toContain("private cursor detail");
	});

	it("makes duplicate subscription tokens idempotent only for identical cursor intent", async () => {
		const release = vi.fn();
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(
					_clientId: string,
					_listener: (event: HubEventEnvelope) => void,
					options: {
						onRuntimeReady?: (cursor: {
							streamId: string;
							sessionSequence: number;
						}) => void;
					},
				) => {
					options.onRuntimeReady?.({
						streamId: "runtime-stream-1",
						sessionSequence: 4,
					});
					return release;
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		const frame = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-idempotent",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 3,
			},
		};
		await socket.emitMessage(JSON.stringify(frame));
		await socket.emitMessage(JSON.stringify(frame));
		await socket.emitMessage(
			JSON.stringify({
				...frame,
				runtimeCursor: { ...frame.runtimeCursor, sessionSequence: 2 },
			}),
		);
		expect(transport.subscribe).toHaveBeenCalledOnce();
		expect(release).not.toHaveBeenCalled();
		expect(socket.sent.map((entry) => JSON.parse(entry))).toEqual([
			expect.objectContaining({
				kind: "stream.status",
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 4,
				},
			}),
			expect.objectContaining({
				kind: "stream.status",
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 4,
				},
			}),
			expect.objectContaining({
				kind: "stream.status",
				status: "rejected",
				errorCode: "subscription_rejected",
			}),
		]);
	});

	it("bounds active subscriptions before creating a source", async () => {
		const releases: Array<ReturnType<typeof vi.fn>> = [];
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(() => {
				const release = vi.fn();
				releases.push(release);
				return release;
			}),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 1).attach(
			socket,
			asSocketTransport(transport),
		);
		const first = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-1",
		};
		const second = {
			...first,
			subscriptionId: "subscription-2",
		};

		await socket.emitMessage(JSON.stringify(first));
		await socket.emitMessage(JSON.stringify(first));
		await socket.emitMessage(JSON.stringify(second));
		expect(transport.subscribe).toHaveBeenCalledOnce();
		expect(socket.sent.map((entry) => JSON.parse(entry).status)).toEqual([
			"ready",
			"ready",
			"rejected",
		]);

		await socket.emitMessage(
			JSON.stringify({ ...first, kind: "stream.unsubscribe" }),
		);
		await socket.emitMessage(JSON.stringify(second));
		expect(releases[0]).toHaveBeenCalledOnce();
		expect(transport.subscribe).toHaveBeenCalledTimes(2);
		expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
			kind: "stream.status",
			status: "ready",
			subscriptionId: "subscription-2",
		});
	});

	it("bounds pending subscription admission before the socket barrier", async () => {
		let finishSubscription: (() => void) | undefined;
		const subscriptionGate = new Promise<void>((resolve) => {
			finishSubscription = resolve;
		});
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(async () => {
				await subscriptionGate;
				return vi.fn();
			}),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 1).attach(
			socket,
			asSocketTransport(transport),
		);
		const first = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-pending-1",
		};
		const firstAdmission = socket.emitMessage(JSON.stringify(first));
		await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());

		// Exact retries coalesce without waiting on or extending the barrier.
		await Promise.all(
			Array.from({ length: 1_000 }, () =>
				socket.emitMessage(JSON.stringify(first)),
			),
		);
		await socket.emitMessage(
			JSON.stringify({
				...first,
				sessionId: "session-2",
				subscriptionId: "subscription-pending-2",
			}),
		);

		expect(transport.subscribe).toHaveBeenCalledOnce();
		expect(socket.sent.map((entry) => JSON.parse(entry))).toEqual([
			expect.objectContaining({
				kind: "stream.status",
				subscriptionId: "subscription-pending-2",
				status: "rejected",
			}),
		]);

		finishSubscription?.();
		await firstAdmission;
		expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
			kind: "stream.status",
			subscriptionId: "subscription-pending-1",
			status: "ready",
		});
	});

	it("coalesces unique subscription churn while source setup is unresolved", async () => {
		let finishFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const releases: Array<ReturnType<typeof vi.fn>> = [];
		let sourceCalls = 0;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(async () => {
				sourceCalls += 1;
				if (sourceCalls === 1) await firstGate;
				const release = vi.fn();
				releases.push(release);
				return release;
			}),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 1).attach(
			socket,
			asSocketTransport(transport),
		);
		let current = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-0",
			subscriptionId: "subscription-0",
		};
		const firstAdmission = socket.emitMessage(JSON.stringify(current));
		await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());

		const transitions: Array<Promise<void>> = [];
		for (let index = 1; index <= 1_000; index += 1) {
			transitions.push(
				socket.emitMessage(
					JSON.stringify({ ...current, kind: "stream.unsubscribe" }),
				),
			);
			current = {
				...current,
				sessionId: `session-${index}`,
				subscriptionId: `subscription-${index}`,
			};
			transitions.push(socket.emitMessage(JSON.stringify(current)));
		}

		// Every superseded admission and unsubscribe settles without adding work
		// behind the unresolved source. Only the final desired admission waits.
		await Promise.all([firstAdmission, ...transitions.slice(0, -1)]);
		expect(transport.subscribe).toHaveBeenCalledOnce();
		expect(socket.sent).toEqual([]);

		finishFirst?.();
		await transitions.at(-1);
		expect(transport.subscribe).toHaveBeenCalledTimes(2);
		expect(releases[0]).toHaveBeenCalledOnce();
		expect(releases[1]).not.toHaveBeenCalled();
		expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
			kind: "stream.status",
			status: "ready",
			sessionId: "session-1000",
			subscriptionId: "subscription-1000",
		});
	});

	it("admits a replacement after an ordered unsubscribe frees virtual capacity", async () => {
		let finishFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const activeSessions = new Set<string>();
		let sourceCount = 0;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				async (
					_clientId: string,
					_listener: unknown,
					options?: { sessionId?: string },
				) => {
					sourceCount += 1;
					if (sourceCount === 1) await firstGate;
					const sessionId = options?.sessionId ?? "*";
					activeSessions.add(sessionId);
					return () => activeSessions.delete(sessionId);
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 1).attach(
			socket,
			asSocketTransport(transport),
		);
		const first = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-a",
		};
		const firstAdmission = socket.emitMessage(JSON.stringify(first));
		await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());
		const removingFirst = socket.emitMessage(
			JSON.stringify({ ...first, kind: "stream.unsubscribe" }),
		);
		const replacementAdmission = socket.emitMessage(
			JSON.stringify({
				...first,
				sessionId: "session-2",
				subscriptionId: "subscription-b",
			}),
		);
		await Promise.resolve();
		expect(socket.sent).toEqual([]);

		finishFirst?.();
		await Promise.all([firstAdmission, removingFirst, replacementAdmission]);
		expect(transport.subscribe).toHaveBeenCalledTimes(2);
		expect(activeSessions).toEqual(new Set(["session-2"]));
		expect(socket.sent.map((entry) => JSON.parse(entry).status)).toEqual([
			"ready",
		]);
		expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
			sessionId: "session-2",
			subscriptionId: "subscription-b",
		});
	});

	it("does not coalesce an exact resubscribe across an unsubscribe", async () => {
		let finishFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			finishFirst = resolve;
		});
		const releases: Array<ReturnType<typeof vi.fn>> = [];
		const listeners: Array<(event: HubEventEnvelope) => void> = [];
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				async (
					_clientId: string,
					listener: (event: HubEventEnvelope) => void,
				) => {
					listeners.push(listener);
					if (releases.length === 0) await firstGate;
					const release = vi.fn();
					releases.push(release);
					return release;
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 1).attach(
			socket,
			asSocketTransport(transport),
		);
		const frame = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-a",
		};
		const firstAdmission = socket.emitMessage(JSON.stringify(frame));
		await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());
		const unsubscribe = socket.emitMessage(
			JSON.stringify({ ...frame, kind: "stream.unsubscribe" }),
		);
		const secondAdmission = socket.emitMessage(JSON.stringify(frame));
		listeners[0]?.(
			runtimeEvent(1, {
				kind: "assistant.delta",
				runId: "run-stale",
				text: "must not cross generations",
			}),
		);
		expect(socket.sent).toEqual([]);

		finishFirst?.();
		await Promise.all([firstAdmission, unsubscribe, secondAdmission]);
		expect(transport.subscribe).toHaveBeenCalledTimes(2);
		expect(releases[0]).toHaveBeenCalledOnce();
		expect(releases[1]).not.toHaveBeenCalled();
		expect(socket.sent.map((entry) => JSON.parse(entry).status)).toEqual([
			"ready",
		]);
	});

	it("restarts physical cleanup before admitting a replacement after an await", async () => {
		let finishSecond: (() => void) | undefined;
		const secondGate = new Promise<void>((resolve) => {
			finishSecond = resolve;
		});
		const activeSessions = new Set<string>();
		const releases: Array<ReturnType<typeof vi.fn>> = [];
		let sourceCalls = 0;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				async (
					_clientId: string,
					_listener: unknown,
					options?: { sessionId?: string },
				) => {
					sourceCalls += 1;
					if (sourceCalls === 2) await secondGate;
					const sessionId = options?.sessionId ?? "*";
					activeSessions.add(sessionId);
					const release = vi.fn(() => activeSessions.delete(sessionId));
					releases.push(release);
					return release;
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 2).attach(
			socket,
			asSocketTransport(transport),
		);
		const first = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-a",
			subscriptionId: "subscription-a",
		};
		const second = {
			...first,
			sessionId: "session-x",
			subscriptionId: "subscription-x",
		};
		await socket.emitMessage(JSON.stringify(first));
		const admittingSecond = socket.emitMessage(JSON.stringify(second));
		await vi.waitFor(() =>
			expect(transport.subscribe).toHaveBeenCalledTimes(2),
		);
		const removingFirst = socket.emitMessage(
			JSON.stringify({ ...first, kind: "stream.unsubscribe" }),
		);
		const replacement = {
			...first,
			sessionId: "session-b",
			subscriptionId: "subscription-b",
		};
		const admittingReplacement = socket.emitMessage(
			JSON.stringify(replacement),
		);

		finishSecond?.();
		await Promise.all([admittingSecond, removingFirst, admittingReplacement]);
		expect(transport.subscribe).toHaveBeenCalledTimes(3);
		expect(releases[0]).toHaveBeenCalledOnce();
		expect(activeSessions).toEqual(new Set(["session-x", "session-b"]));
		expect(socket.sent.map((entry) => JSON.parse(entry).status)).toEqual([
			"ready",
			"ready",
			"ready",
		]);
		expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
			status: "ready",
			sessionId: "session-b",
			subscriptionId: "subscription-b",
		});
	});

	it("does not inherit an active source across an exact resubscribe generation", async () => {
		let finishSecond: (() => void) | undefined;
		const secondGate = new Promise<void>((resolve) => {
			finishSecond = resolve;
		});
		const releases: Array<ReturnType<typeof vi.fn>> = [];
		let sourceCalls = 0;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(async () => {
				sourceCalls += 1;
				if (sourceCalls === 2) await secondGate;
				const release = vi.fn();
				releases.push(release);
				return release;
			}),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {}, 2).attach(
			socket,
			asSocketTransport(transport),
		);
		const first = {
			kind: "stream.subscribe",
			clientId: "client-1",
			sessionId: "session-a",
			subscriptionId: "subscription-a",
		};
		const unrelated = {
			...first,
			sessionId: "session-x",
			subscriptionId: "subscription-x",
		};
		await socket.emitMessage(JSON.stringify(first));
		const admittingUnrelated = socket.emitMessage(JSON.stringify(unrelated));
		await vi.waitFor(() =>
			expect(transport.subscribe).toHaveBeenCalledTimes(2),
		);
		const unsubscribe = socket.emitMessage(
			JSON.stringify({ ...first, kind: "stream.unsubscribe" }),
		);
		const resubscribe = socket.emitMessage(JSON.stringify(first));

		finishSecond?.();
		await Promise.all([admittingUnrelated, unsubscribe, resubscribe]);
		expect(transport.subscribe).toHaveBeenCalledTimes(3);
		expect(releases[0]).toHaveBeenCalledOnce();
		expect(releases[1]).not.toHaveBeenCalled();
		expect(releases[2]).not.toHaveBeenCalled();
		expect(socket.sent.map((entry) => JSON.parse(entry).status)).toEqual([
			"ready",
			"ready",
			"ready",
		]);
		expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toMatchObject({
			status: "ready",
			sessionId: "session-a",
			subscriptionId: "subscription-a",
		});
	});

	it("rejects a malformed cursor on an otherwise valid fenced subscription", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter().attach(
			socket,
			asSocketTransport(transport),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
				subscriptionId: "subscription-malformed-cursor",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: -1,
				},
			}),
		);
		expect(transport.subscribe).not.toHaveBeenCalled();
		expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({
			kind: "stream.status",
			clientId: "client-1",
			sessionId: "session-1",
			subscriptionId: "subscription-malformed-cursor",
			status: "rejected",
			errorCode: "subscription_rejected",
		});
	});

	it("never acknowledges readiness after replay admission fails", async () => {
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(
					_clientId: string,
					listener: (event: HubEventEnvelope) => void,
					options: {
						onRuntimeReady?: (cursor: {
							streamId: string;
							sessionSequence: number;
						}) => void;
					},
				) => {
					listener(
						runtimeEvent(2, {
							kind: "assistant.delta",
							runId: "run-1",
							text: "x".repeat(2_000),
						}),
					);
					options.onRuntimeReady?.({
						streamId: "runtime-stream-1",
						sessionSequence: 2,
					});
					return () => undefined;
				},
			),
		};
		const socket = createSocket();
		new BrowserWebSocketHubAdapter(undefined, {
			softWatermarkBytes: 256,
			hardWatermarkBytes: 512,
		}).attach(socket, asSocketTransport(transport));
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
				subscriptionId: "subscription-over-capacity",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 1,
				},
			}),
		);
		expect(socket.sent).toEqual([]);
		expect(socket.closed).toEqual([[1013, "WebSocket outbound congestion"]]);
	});

	it("does not merge deltas across runtime or subscription boundaries", async () => {
		let emit: ((event: HubEventEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(_clientId: string, listener: (event: HubEventEnvelope) => void) => {
					emit = listener;
					return () => undefined;
				},
			),
		};
		const socket = createSocket(false);
		const adapter = new BrowserWebSocketHubAdapter(undefined, {
			softWatermarkBytes: 1,
			hardWatermarkBytes: 8192,
		});
		adapter.attach(socket, asSocketTransport(transport));
		const subscribe = () =>
			socket.emitMessage(
				JSON.stringify({
					kind: "stream.subscribe",
					clientId: "client-1",
					sessionId: "session-1",
				}),
			);
		await subscribe();

		emit?.(
			runtimeEvent(1, {
				kind: "assistant.delta",
				runId: "run-1",
				text: "a",
			}),
		);
		emit?.(
			runtimeEvent(2, {
				kind: "assistant.delta",
				runId: "run-1",
				text: "b",
			}),
		);
		emit?.(
			runtimeEvent(3, {
				kind: "tool.started",
				runId: "run-1",
				toolCallId: "tool-1",
				toolName: "read_file",
				status: "started",
			}),
		);
		emit?.(
			runtimeEvent(4, {
				kind: "assistant.delta",
				runId: "run-1",
				text: "c",
			}),
		);
		emit?.(
			runtimeEvent(5, {
				kind: "assistant.delta",
				runId: "run-2",
				text: "d",
			}),
		);
		await socket.emitMessage(
			JSON.stringify({
				kind: "stream.unsubscribe",
				clientId: "client-1",
				sessionId: "session-1",
			}),
		);
		await subscribe();
		emit?.(
			runtimeEvent(6, {
				kind: "assistant.delta",
				runId: "run-2",
				text: "e",
			}),
		);

		while (socket.pendingCompletions.length > 0) {
			socket.completeNext();
			await Promise.resolve();
			await Promise.resolve();
		}
		const runtimeFrames = socket.sent.map((entry) => JSON.parse(entry));
		expect(
			runtimeFrames.map((frame) => frame.envelope.sessionSequence),
		).toEqual([1, 2, 3, 4, 5, 6]);
		expect(
			runtimeFrames.every(
				(frame) => frame.envelope.sessionSequenceStart === undefined,
			),
		).toBe(true);
	});

	it("keeps run.start open past the default command timeout", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		let resolveCommand: ((reply: HubReplyEnvelope) => void) | undefined;
		const transport = {
			command: vi.fn(
				() =>
					new Promise<HubReplyEnvelope>((resolve) => {
						resolveCommand = resolve;
					}),
			),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter();
		adapter.attach(socket, asSocketTransport(transport));

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "run.start",
					requestId: "req-run",
					clientId: "client-1",
					sessionId: "session-1",
					payload: { input: "hello" },
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(30_001);
		expect(socket.sent).toHaveLength(0);

		resolveCommand?.({
			version: "v1",
			requestId: "req-run",
			ok: true,
			payload: { result: { finishReason: "completed" } },
		});
		await Promise.resolve();

		expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
			kind: "reply",
			envelope: {
				version: "v1",
				requestId: "req-run",
				ok: true,
				payload: { result: { finishReason: "completed" } },
			},
		});
	});

	it("applies the default command timeout to fast commands", async () => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const transport = {
			command: vi.fn(() => new Promise<HubReplyEnvelope>(() => {})),
			subscribe: vi.fn(),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter();
		adapter.attach(socket, asSocketTransport(transport));

		socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.list",
					requestId: "req-list",
					clientId: "client-1",
				},
			}),
		);

		await vi.advanceTimersByTimeAsync(30_001);

		expect(socket.sent.map((entry) => JSON.parse(entry))).toContainEqual({
			kind: "reply",
			envelope: {
				version: "v1",
				requestId: "req-list",
				ok: false,
				error: {
					code: "hub_command_timeout",
					message:
						"Hub command client.list did not complete within 30000ms. Check hub-daemon.log for command.start/command.slow logs with requestId req-list.",
				},
			},
		});
	});

	it("binds chat catalog commands and client IDs to one socket", async () => {
		const transport = {
			command: vi.fn(async (envelope) => ({
				version: "v1" as const,
				requestId: envelope.requestId,
				ok: true,
			})),
			subscribe: vi.fn(),
		};
		const firstSocket = createSocket();
		const secondSocket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter();
		adapter.attach(firstSocket, asSocketTransport(transport));
		adapter.attach(secondSocket, asSocketTransport(transport));

		await firstSocket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId: "register-first",
					clientId: "client-1",
					payload: {
						clientId: "client-1",
						clientType: "test",
						transport: "browser-ws",
					},
				},
			}),
		);
		await secondSocket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "chat_catalog.list",
					requestId: "spoof-catalog",
					clientId: "client-1",
					payload: {},
				},
			}),
		);
		await secondSocket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "chat_lifecycle.start_root",
					requestId: "spoof-lifecycle",
					clientId: "client-1",
					payload: {},
				},
			}),
		);
		await secondSocket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId: "duplicate-client",
					clientId: "client-1",
					payload: {
						clientId: "client-1",
						clientType: "attacker",
						transport: "browser-ws",
					},
				},
			}),
		);

		expect(transport.command).toHaveBeenCalledTimes(1);
		expect(secondSocket.sent.map((entry) => JSON.parse(entry))).toEqual([
			{
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: "spoof-catalog",
					ok: false,
					error: {
						code: "client_not_registered",
						message:
							"Workspace authority commands require this connection's registered client identity.",
					},
				},
			},
			{
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: "spoof-lifecycle",
					ok: false,
					error: {
						code: "client_not_registered",
						message:
							"Workspace authority commands require this connection's registered client identity.",
					},
				},
			},
			{
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: "duplicate-client",
					ok: false,
					error: {
						code: "client_conflict",
						message: "Client ID is already registered on another connection.",
					},
				},
			},
		]);
	});

	it("finishes an earlier subscription before dispatching a following managed command", async () => {
		let finishSubscription: (() => void) | undefined;
		const subscriptionGate = new Promise<void>((resolve) => {
			finishSubscription = resolve;
		});
		const transport = {
			command: vi.fn(async (envelope) => ({
				version: "v1" as const,
				requestId: envelope.requestId,
				ok: true,
			})),
			subscribe: vi.fn(async () => {
				await subscriptionGate;
				return () => undefined;
			}),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter();
		adapter.attach(socket, asSocketTransport(transport));
		await socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "client.register",
					requestId: "register-subscription-barrier",
					clientId: "client-1",
					payload: {
						clientId: "client-1",
						clientType: "test",
						transport: "browser-ws",
					},
				},
			}),
		);

		const subscribing = socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
			}),
		);
		await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());
		const commanding = socket.emitMessage(
			JSON.stringify({
				kind: "command",
				envelope: {
					version: "v1",
					command: "chat_lifecycle.run_turn",
					requestId: "turn-after-subscribe",
					clientId: "client-1",
					payload: {
						operationId: "turn-after-subscribe",
						sessionId: "session-1",
						prompt: "continue",
					},
				},
			}),
		);
		await Promise.resolve();
		expect(transport.command).toHaveBeenCalledTimes(1);

		finishSubscription?.();
		await Promise.all([subscribing, commanding]);
		expect(transport.command).toHaveBeenCalledTimes(2);
		expect(transport.command.mock.calls[1]?.[0]).toMatchObject({
			command: "chat_lifecycle.run_turn",
		});
	});

	it("releases a subscription that settles after its socket closes", async () => {
		let finishSubscription: (() => void) | undefined;
		const subscriptionGate = new Promise<void>((resolve) => {
			finishSubscription = resolve;
		});
		const unsubscribe = vi.fn();
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(async () => {
				await subscriptionGate;
				return unsubscribe;
			}),
		};
		const socket = createSocket();
		const adapter = new BrowserWebSocketHubAdapter();
		const detach = adapter.attach(socket, asSocketTransport(transport));
		const subscribing = socket.emitMessage(
			JSON.stringify({
				kind: "stream.subscribe",
				clientId: "client-1",
				sessionId: "session-1",
			}),
		);
		await vi.waitFor(() => expect(transport.subscribe).toHaveBeenCalledOnce());

		detach();
		finishSubscription?.();
		await subscribing;

		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(socket.listenerCounts()).toEqual({ message: 0, close: 0 });
	});

	it("releases subscriptions and listeners during sustained session churn", async () => {
		const activeSubscriptions = new Set<string>();
		const transport = {
			command: vi.fn(),
			subscribe: vi.fn(
				(
					clientId: string,
					_listener: unknown,
					options?: {
						sessionId?: string;
					},
				) => {
					const key = `${clientId}:${options?.sessionId ?? "*"}`;
					activeSubscriptions.add(key);
					return () => activeSubscriptions.delete(key);
				},
			),
		};
		const adapter = new BrowserWebSocketHubAdapter();
		const socketCount = 200;
		const sessionsPerSocket = 20;

		for (let socketIndex = 0; socketIndex < socketCount; socketIndex++) {
			const socket = createSocket();
			const detach = adapter.attach(socket, asSocketTransport(transport));
			for (
				let sessionIndex = 0;
				sessionIndex < sessionsPerSocket;
				sessionIndex++
			) {
				await socket.emitMessage(
					JSON.stringify({
						kind: "stream.subscribe",
						clientId: `client-${socketIndex}`,
						sessionId: `session-${sessionIndex}`,
					}),
				);
			}

			expect(activeSubscriptions.size).toBe(sessionsPerSocket);
			detach();
			expect(activeSubscriptions.size).toBe(0);
			expect(socket.listenerCounts()).toEqual({ message: 0, close: 0 });
		}

		expect(transport.subscribe).toHaveBeenCalledTimes(
			socketCount * sessionsPerSocket,
		);
	});
});
