/**
 * Validated gateway for host -> webview `window` "message" traffic.
 *
 * The hub bridge in `vscode.ts` delivers every host message by dispatching a
 * synthetic MessageEvent on `window` (`window.dispatchEvent`). Synthetic
 * events carry no source window and an empty origin, and only code already
 * running in this page can dispatch them. A real `postMessage` from another
 * window (an embedding page, opener, or iframe) always stamps the sender's
 * window and origin, so the gateway rejects it unless the sender is this
 * exact window on this exact origin. Listeners additionally supply a runtime
 * shape guard so no field of `event.data` reaches state without validation.
 */

export type HostMessage = { type: string } & Record<string, unknown>;

/** True when the event came from this page itself, not a foreign window. */
export function isTrustedHostMessageEvent(event: MessageEvent): boolean {
	// Synthetic dispatch from vscode.ts: `source` is null and `origin` empty.
	if (!event.source && !event.origin) {
		return true;
	}
	// Defense in depth: the app never posts across windows, so the only
	// acceptable real postMessage sender is this window on its own origin.
	return event.source === window && event.origin === window.location.origin;
}

function isHostMessage(value: unknown): value is HostMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string"
	);
}

export type HostMessageSubscription<T extends HostMessage> = {
	/** Message types this subscriber consumes; other types pass by silently. */
	types: readonly string[];
	/** Shape guard for a routed message; mismatches are dropped and logged. */
	guard: (message: HostMessage) => message is T;
	onMessage: (message: T) => void;
};

/**
 * Listen for host messages through the origin/source and shape checks.
 * Returns an unsubscribe function.
 */
export function subscribeToHostMessages<T extends HostMessage>(
	subscription: HostMessageSubscription<T>,
): () => void {
	const listener = (event: MessageEvent) => {
		if (!isTrustedHostMessageEvent(event)) {
			console.warn(
				"[host-message-gateway] dropped window message from untrusted source",
				event.origin || "<no origin>",
			);
			return;
		}
		const data: unknown = event.data;
		if (!isHostMessage(data) || !subscription.types.includes(data.type)) {
			return;
		}
		if (!subscription.guard(data)) {
			console.warn(
				`[host-message-gateway] dropped malformed "${data.type}" message`,
			);
			return;
		}
		subscription.onMessage(data);
	};
	window.addEventListener("message", listener);
	return () => window.removeEventListener("message", listener);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

export function isOptionalStringArray(
	value: unknown,
): value is string[] | undefined {
	return value === undefined || isStringArray(value);
}
