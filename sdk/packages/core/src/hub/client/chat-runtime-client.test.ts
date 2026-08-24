import type {
	HubChatRuntimeCursor,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	HubChatRuntimeClient,
	type HubChatRuntimeClientTransport,
} from "./chat-runtime-client";

const ABORT_RESULT = {
	operationId: "abort-1",
	sessionId: "session-1",
	runId: "run-1",
	accepted: true,
} as const;

function transportFixture(reply?: HubReplyEnvelope) {
	const subscriptions: Array<{
		listener: (event: HubEventEnvelope) => void;
		options: NonNullable<
			Parameters<HubChatRuntimeClientTransport["subscribe"]>[1]
		>;
		release: ReturnType<typeof vi.fn>;
	}> = [];
	const command = vi.fn(
		async () =>
			(reply ?? {
				version: "v1",
				ok: true,
				payload: { result: ABORT_RESULT },
			}) satisfies HubReplyEnvelope,
	);
	const subscribe = vi.fn(
		(
			next: (event: HubEventEnvelope) => void,
			options: NonNullable<
				Parameters<HubChatRuntimeClientTransport["subscribe"]>[1]
			>,
		) => {
			const release = vi.fn();
			subscriptions.push({ listener: next, options, release });
			return release;
		},
	);
	const transport: HubChatRuntimeClientTransport = {
		command,
		subscribe,
	};
	return {
		transport,
		command,
		subscribe,
		emit: (event: HubEventEnvelope, index = subscriptions.length - 1) =>
			subscriptions[index]?.listener(event),
		status: (
			status: {
				status: "ready" | "rejected";
				errorCode?: string;
				runtimeCursor?: HubChatRuntimeCursor;
			},
			index = subscriptions.length - 1,
		) => subscriptions[index]?.options.onStatus?.(status),
		subscriptions,
	};
}

function runtimeEvent(
	sessionSequence: number,
	options: {
		streamId?: string;
		sessionSequenceStart?: number;
		text?: string;
	} = {},
): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.runtime",
		eventId: `event-${sessionSequence}`,
		streamId: options.streamId ?? "runtime-stream-1",
		sessionId: "session-1",
		timestamp: sessionSequence,
		processSequence: sessionSequence,
		...(options.sessionSequenceStart === undefined
			? {}
			: { sessionSequenceStart: options.sessionSequenceStart }),
		sessionSequence,
		payload: {
			kind: "assistant.delta",
			runId: "run-1",
			text: options.text ?? "hello",
		},
	} as HubEventEnvelope;
}

describe("HubChatRuntimeClient", () => {
	it("validates requests and authoritative results around transport", async () => {
		const fixture = transportFixture();
		const client = new HubChatRuntimeClient(fixture.transport);
		await expect(
			client.invoke({
				command: "chat_runtime.abort",
				payload: {
					operationId: "abort-1",
					sessionId: "session-1",
					runId: "run-1",
				},
			}),
		).resolves.toEqual(ABORT_RESULT);
		expect(fixture.command).toHaveBeenCalledWith(
			"chat_runtime.abort",
			expect.objectContaining({ sessionId: "session-1", runId: "run-1" }),
			undefined,
			undefined,
		);
	});

	it("rejects malformed input and output", async () => {
		const fixture = transportFixture({
			version: "v1",
			ok: true,
			payload: { result: { ...ABORT_RESULT, workspaceRoot: "/private" } },
		});
		const client = new HubChatRuntimeClient(fixture.transport);
		await expect(
			client.invoke({
				command: "chat_runtime.abort",
				payload: {
					operationId: "abort-1",
					sessionId: "../escape",
					runId: "run-1",
				},
			}),
		).rejects.toThrow();
		expect(fixture.command).not.toHaveBeenCalled();

		await expect(
			client.invoke({
				command: "chat_runtime.abort",
				payload: {
					operationId: "abort-1",
					sessionId: "session-1",
					runId: "run-1",
				},
			}),
		).rejects.toThrow();
	});

	it("validates events and permanently releases a malformed stream", () => {
		const fixture = transportFixture();
		const client = new HubChatRuntimeClient(fixture.transport);
		const onEvent = vi.fn();
		const onError = vi.fn();
		client.subscribe({ onEvent, onError }, { sessionId: "session-1" });
		expect(fixture.subscribe).toHaveBeenCalledWith(
			expect.any(Function),
			expect.objectContaining({
				sessionId: "session-1",
				fenced: true,
				runtimeCursor: expect.any(Function),
				onStatus: expect.any(Function),
			}),
		);
		fixture.emit({
			version: "v1",
			event: "chat.runtime",
			eventId: "event-1",
			streamId: "runtime-stream-1",
			sessionId: "session-1",
			timestamp: 1,
			processSequence: 1,
			sessionSequence: 1,
			payload: {
				kind: "assistant.delta",
				runId: "run-1",
				text: "hello",
			},
		} as HubEventEnvelope);
		expect(onEvent).toHaveBeenCalledOnce();

		fixture.emit({
			version: "v1",
			event: "chat.runtime",
			eventId: "event-bad",
			streamId: "runtime-stream-1",
			sessionId: "session-1",
			timestamp: 2,
			payload: { inputJson: "secret" },
		} as HubEventEnvelope);
		expect(fixture.subscriptions[0]?.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Managed runtime event failed v1 validation.",
			}),
		);
	});

	it("rejects strict runtime subscriptions without a session scope", () => {
		const fixture = transportFixture();
		const client = new HubChatRuntimeClient(fixture.transport);
		expect(() =>
			(
				client.subscribe as unknown as (
					handlers: { onEvent: () => void },
					options?: Record<string, never>,
				) => () => void
			)({ onEvent: vi.fn() }),
		).toThrow("require a session scope");
		expect(fixture.subscribe).not.toHaveBeenCalled();
	});

	it("recovers one forward gap from the last epoch-bearing cursor", () => {
		const fixture = transportFixture();
		const client = new HubChatRuntimeClient(fixture.transport);
		const onEvent = vi.fn();
		const onError = vi.fn();
		client.subscribe({ onEvent, onError }, { sessionId: "session-1" });
		fixture.emit(runtimeEvent(10), 0);
		fixture.emit(runtimeEvent(12), 0);
		expect(onEvent).toHaveBeenCalledOnce();
		expect(fixture.subscriptions[0]?.release).toHaveBeenCalledOnce();
		expect(fixture.subscriptions).toHaveLength(2);
		expect(fixture.subscriptions[1]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 10,
		});
		fixture.emit(runtimeEvent(11), 1);
		fixture.emit(runtimeEvent(12), 1);
		fixture.status(
			{
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 12,
				},
			},
			1,
		);
		expect(onEvent).toHaveBeenCalledTimes(3);
		expect(onError).not.toHaveBeenCalled();
	});

	it("fails terminally when a recovered stream develops another gap", () => {
		const fixture = transportFixture();
		const onEvent = vi.fn();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent, onError },
			{ sessionId: "session-1" },
		);
		fixture.emit(runtimeEvent(1), 0);
		fixture.emit(runtimeEvent(3), 0);
		fixture.emit(runtimeEvent(2), 1);
		fixture.emit(runtimeEvent(3), 1);
		fixture.status(
			{
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 3,
				},
			},
			1,
		);
		fixture.emit(runtimeEvent(5), 1);
		expect(fixture.subscriptions).toHaveLength(2);
		expect(fixture.subscriptions[1]?.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("repeated") }),
		);
	});

	it("fails terminally when cursor recovery is rejected", () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent: vi.fn(), onError },
			{ sessionId: "session-1" },
		);
		fixture.emit(runtimeEvent(1), 0);
		fixture.emit(runtimeEvent(3), 0);
		fixture.status(
			{ status: "rejected", errorCode: "subscription_rejected" },
			1,
		);
		expect(fixture.subscriptions[1]?.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("rejected") }),
		);
	});

	it("anchors a quiet session at sequence zero before its first event", () => {
		const fixture = transportFixture();
		const onEvent = vi.fn();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent, onError },
			{ sessionId: "session-1" },
		);
		fixture.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 0,
			},
		});
		expect(fixture.subscriptions[0]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 0,
		});
		fixture.emit(runtimeEvent(1));
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
	});

	it("anchors a replacement subscription at its retained cursor before readiness", () => {
		const fixture = transportFixture();
		const onCursor = vi.fn();
		const onEvent = vi.fn();
		const onReady = vi.fn();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onCursor, onEvent, onReady, onError },
			{
				sessionId: "session-1",
				initialCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 10,
				},
				readinessTimeoutMs: 100,
			},
		);

		expect(fixture.subscriptions[0]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 10,
		});
		fixture.emit(runtimeEvent(11));
		fixture.emit(runtimeEvent(12));
		fixture.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 12,
			},
		});

		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(onCursor).toHaveBeenLastCalledWith({
			streamId: "runtime-stream-1",
			sessionSequence: 12,
		});
		expect(onReady).toHaveBeenCalledWith({
			streamId: "runtime-stream-1",
			sessionSequence: 12,
		});
		expect(onError).not.toHaveBeenCalled();

		fixture.emit(runtimeEvent(14));
		expect(fixture.subscriptions).toHaveLength(2);
		expect(fixture.subscriptions[1]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 12,
		});
	});

	it("hands a retained cursor to the reconnect owner without a generic failure", () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		const onReclaimRequired = vi.fn();
		const onEvent = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent, onError, onReclaimRequired },
			{ sessionId: "session-1" },
		);
		fixture.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 0,
			},
		});
		fixture.emit(runtimeEvent(1));
		fixture.status({
			status: "rejected",
			errorCode: "session_reclaim_required",
		});

		expect(fixture.subscriptions[0]?.release).toHaveBeenCalledOnce();
		expect(onReclaimRequired).toHaveBeenCalledWith({
			sessionId: "session-1",
			cursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 1,
			},
		});
		expect(onError).not.toHaveBeenCalled();
		fixture.emit(runtimeEvent(2));
		expect(onEvent).toHaveBeenCalledOnce();
	});

	it("fails reconnect when no accepted cursor exists", () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		const onReclaimRequired = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent: vi.fn(), onError, onReclaimRequired },
			{ sessionId: "session-1" },
		);
		fixture.status({
			status: "rejected",
			errorCode: "session_reclaim_required",
		});

		expect(onReclaimRequired).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("no retained cursor"),
			}),
		);
	});

	it("fails terminally when cursor recovery is never acknowledged", async () => {
		vi.useFakeTimers();
		try {
			const fixture = transportFixture();
			const onError = vi.fn();
			clientFor(fixture).subscribe(
				{ onEvent: vi.fn(), onError },
				{ sessionId: "session-1" },
			);
			fixture.emit(runtimeEvent(1), 0);
			fixture.emit(runtimeEvent(3), 0);
			await vi.advanceTimersByTimeAsync(10_001);
			expect(fixture.subscriptions[1]?.release).toHaveBeenCalledOnce();
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("timed out"),
				}),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("accepts a ready cutoff captured before newer contiguous live delivery", () => {
		const fixture = transportFixture();
		const onEvent = vi.fn();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent, onError },
			{ sessionId: "session-1" },
		);
		fixture.emit(runtimeEvent(1), 0);
		fixture.emit(runtimeEvent(3), 0);
		fixture.emit(runtimeEvent(2), 1);
		fixture.emit(runtimeEvent(3), 1);
		fixture.status(
			{
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 2,
				},
			},
			1,
		);
		expect(onEvent).toHaveBeenCalledTimes(3);
		expect(fixture.subscriptions[1]?.release).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("fails terminally when recovery acknowledges a cutoff beyond delivery", () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent: vi.fn(), onError },
			{ sessionId: "session-1" },
		);
		fixture.emit(runtimeEvent(1), 0);
		fixture.emit(runtimeEvent(3), 0);
		fixture.emit(runtimeEvent(2), 1);
		fixture.emit(runtimeEvent(3), 1);
		fixture.status(
			{
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 4,
				},
			},
			1,
		);
		expect(fixture.subscriptions[1]?.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("mismatched"),
			}),
		);
	});

	it("aborts an in-flight recovery without accepting late replay or status", () => {
		const fixture = transportFixture();
		const onEvent = vi.fn();
		const onError = vi.fn();
		const release = clientFor(fixture).subscribe(
			{ onEvent, onError },
			{ sessionId: "session-1" },
		);
		fixture.emit(runtimeEvent(1), 0);
		fixture.emit(runtimeEvent(3), 0);
		release();
		fixture.emit(runtimeEvent(2), 1);
		fixture.status(
			{
				status: "ready",
				runtimeCursor: {
					streamId: "runtime-stream-1",
					sessionSequence: 2,
				},
			},
			1,
		);
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
		expect(fixture.subscriptions[1]?.release).toHaveBeenCalledOnce();
	});

	it("fails a quiet scoped subscription whose readiness omits its baseline", () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent: vi.fn(), onError },
			{ sessionId: "session-1" },
		);
		fixture.status({ status: "ready" });
		expect(fixture.subscriptions[0]?.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("omitted its accepted cursor"),
			}),
		);
	});

	it("fails terminally when the runtime stream epoch changes", () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		clientFor(fixture).subscribe(
			{ onEvent: vi.fn(), onError },
			{ sessionId: "session-1" },
		);
		fixture.emit(runtimeEvent(1), 0);
		fixture.emit(runtimeEvent(2, { streamId: "runtime-stream-2" }), 0);
		expect(fixture.subscriptions).toHaveLength(1);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining("epoch") }),
		);
	});

	it("advances through declared contiguous additive ranges", () => {
		const fixture = transportFixture();
		const client = new HubChatRuntimeClient(fixture.transport);
		const onEvent = vi.fn();
		const onError = vi.fn();
		client.subscribe({ onEvent, onError }, { sessionId: "session-1" });
		for (const [sessionSequenceStart, sessionSequence, text] of [
			[undefined, 10, "a"],
			[11, 12, "bc"],
			[undefined, 13, "d"],
		] as const) {
			fixture.emit({
				version: "v1",
				event: "chat.runtime",
				eventId: `event-${sessionSequence}`,
				streamId: "runtime-stream-1",
				sessionId: "session-1",
				timestamp: sessionSequence,
				processSequence: sessionSequence,
				...(sessionSequenceStart === undefined ? {} : { sessionSequenceStart }),
				sessionSequence,
				payload: {
					kind: "assistant.delta",
					runId: "run-1",
					text,
				},
			} as HubEventEnvelope);
		}

		expect(onEvent).toHaveBeenCalledTimes(3);
		expect(onError).not.toHaveBeenCalled();
		expect(fixture.subscriptions[0]?.release).not.toHaveBeenCalled();
	});

	it("fails closed on overlapping or regressing declared ranges", () => {
		for (const [sessionSequenceStart, sessionSequence] of [
			[10, 11],
			[8, 9],
		] as const) {
			const fixture = transportFixture();
			const client = new HubChatRuntimeClient(fixture.transport);
			const onEvent = vi.fn();
			const onError = vi.fn();
			client.subscribe({ onEvent, onError }, { sessionId: "session-1" });
			for (const event of [
				{
					version: "v1",
					event: "chat.runtime",
					eventId: "event-10",
					streamId: "runtime-stream-1",
					sessionId: "session-1",
					timestamp: 10,
					processSequence: 10,
					sessionSequence: 10,
					payload: {
						kind: "assistant.delta",
						runId: "run-1",
						text: "a",
					},
				},
				{
					version: "v1",
					event: "chat.runtime",
					eventId: `event-${sessionSequence}`,
					streamId: "runtime-stream-1",
					sessionId: "session-1",
					timestamp: sessionSequence,
					processSequence: sessionSequence,
					sessionSequenceStart,
					sessionSequence,
					payload: {
						kind: "assistant.delta",
						runId: "run-1",
						text: "b",
					},
				},
			] as unknown as HubEventEnvelope[]) {
				fixture.emit(event);
			}

			expect(onEvent).toHaveBeenCalledOnce();
			expect(fixture.subscriptions[0]?.release).toHaveBeenCalledOnce();
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringMatching(/overlaps|regresses/),
				}),
			);
		}
	});
});

function clientFor(fixture: ReturnType<typeof transportFixture>) {
	return new HubChatRuntimeClient(fixture.transport);
}
