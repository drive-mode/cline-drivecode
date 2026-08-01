import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type HostMessage,
	subscribeToHostMessages,
} from "./host-message-gateway";

function stubWindowMessageBus() {
	const listeners = new Set<(event: MessageEvent) => void>();
	const windowStub = {
		addEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") {
				listeners.add(listener as (event: MessageEvent) => void);
			}
		},
		removeEventListener: (
			_type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			listeners.delete(listener as (event: MessageEvent) => void);
		},
		location: { origin: "https://hub.local" },
	};
	vi.stubGlobal("window", windowStub);
	return {
		windowStub,
		listenerCount: () => listeners.size,
		dispatch(event: Partial<MessageEvent>) {
			for (const listener of [...listeners]) {
				listener(event as MessageEvent);
			}
		},
	};
}

type PingMessage = HostMessage & { type: "ping"; text: string };

function isPingMessage(message: HostMessage): message is PingMessage {
	return message.type === "ping" && typeof message.text === "string";
}

function subscribePing(onMessage: (message: PingMessage) => void): () => void {
	return subscribeToHostMessages({
		types: ["ping"],
		guard: isPingMessage,
		onMessage,
	});
}

describe("subscribeToHostMessages", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("delivers a synthetic host message (empty origin, null source)", () => {
		const bus = stubWindowMessageBus();
		const onMessage = vi.fn();
		subscribePing(onMessage);

		// Mirrors vscode.ts: window.dispatchEvent(new MessageEvent("message", { data })).
		bus.dispatch({
			data: { type: "ping", text: "hi" },
			origin: "",
			source: null,
		});

		expect(onMessage).toHaveBeenCalledWith({ type: "ping", text: "hi" });
	});

	it("rejects cross-origin window messages", () => {
		const bus = stubWindowMessageBus();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const onMessage = vi.fn();
		subscribePing(onMessage);

		bus.dispatch({
			data: { type: "ping", text: "hi" },
			origin: "https://evil.example",
			source: {} as Window,
		});

		expect(onMessage).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("untrusted source"),
			"https://evil.example",
		);
	});

	it("rejects same-origin messages posted by another window", () => {
		const bus = stubWindowMessageBus();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const onMessage = vi.fn();
		subscribePing(onMessage);

		bus.dispatch({
			data: { type: "ping", text: "hi" },
			origin: bus.windowStub.location.origin,
			source: {} as Window,
		});

		expect(onMessage).not.toHaveBeenCalled();
	});

	it("accepts a same-window, same-origin postMessage", () => {
		const bus = stubWindowMessageBus();
		const onMessage = vi.fn();
		subscribePing(onMessage);

		bus.dispatch({
			data: { type: "ping", text: "hi" },
			origin: bus.windowStub.location.origin,
			source: bus.windowStub as unknown as Window,
		});

		expect(onMessage).toHaveBeenCalledWith({ type: "ping", text: "hi" });
	});

	it("drops malformed payloads for subscribed types", () => {
		const bus = stubWindowMessageBus();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const onMessage = vi.fn();
		subscribePing(onMessage);

		bus.dispatch({
			data: { type: "ping", text: 42 },
			origin: "",
			source: null,
		});

		expect(onMessage).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('malformed "ping"'),
		);
	});

	it("ignores unrelated message types silently", () => {
		const bus = stubWindowMessageBus();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const onMessage = vi.fn();
		subscribePing(onMessage);

		bus.dispatch({ data: { type: "pong" }, origin: "", source: null });
		bus.dispatch({ data: "not an object", origin: "", source: null });

		expect(onMessage).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it("unsubscribe removes the window listener", () => {
		const bus = stubWindowMessageBus();
		const unsubscribe = subscribePing(vi.fn());

		expect(bus.listenerCount()).toBe(1);
		unsubscribe();
		expect(bus.listenerCount()).toBe(0);
	});
});
