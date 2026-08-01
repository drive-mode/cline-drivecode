"use client";

import type { WebviewOutboundMessage } from "../../../webview-protocol";
import { postToHost } from "../vscode";
import {
	type HostMessage,
	isRecord,
	subscribeToHostMessages,
} from "./host-message-gateway";

type PostToHost = typeof postToHost;

type PendingRequest = {
	command: string;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 120_000;
const BROWSER_TRANSPORT_FAILURE_MESSAGES = new Set([
	"Disconnected from the Cline Hub server.",
	"Failed to connect to the Cline Hub server.",
	"Received an invalid message from the Cline Hub server.",
]);

export function isBrowserTransportFailure(
	message: WebviewOutboundMessage,
): boolean {
	if (message.type !== "status" && message.type !== "error") {
		return false;
	}
	return BROWSER_TRANSPORT_FAILURE_MESSAGES.has(message.text);
}

const DESKTOP_CLIENT_MESSAGE_TYPES = [
	"status",
	"error",
	"desktopCommandResult",
] as const;

type DesktopClientHostMessage =
	| { type: "status"; text: string }
	| { type: "error"; text: string }
	| { type: "desktopCommandResult"; id: string; ok: true; result?: unknown }
	| { type: "desktopCommandResult"; id: string; ok: false; error: string };

export function isDesktopClientHostMessage(
	message: HostMessage,
): message is DesktopClientHostMessage {
	switch (message.type) {
		case "status":
		case "error":
			return typeof message.text === "string";
		case "desktopCommandResult":
			return (
				typeof message.id === "string" &&
				typeof message.ok === "boolean" &&
				(message.ok || typeof message.error === "string")
			);
		default:
			return false;
	}
}

export class HubDesktopClient {
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly postToHost: PostToHost;

	constructor(options: { postToHost?: PostToHost; listen?: boolean } = {}) {
		this.postToHost = options.postToHost ?? postToHost;
		if ((options.listen ?? true) && typeof window !== "undefined") {
			subscribeToHostMessages({
				types: DESKTOP_CLIENT_MESSAGE_TYPES,
				guard: isDesktopClientHostMessage,
				onMessage: (message) => {
					this.onHostMessage(message);
				},
			});
		}
	}

	/** Test seam: feed one payload as if it arrived from the host bridge. */
	handleMessage(event: Pick<MessageEvent<WebviewOutboundMessage>, "data">) {
		const data: unknown = event.data;
		if (
			!isRecord(data) ||
			typeof data.type !== "string" ||
			!isDesktopClientHostMessage(data as HostMessage)
		) {
			return;
		}
		this.onHostMessage(data as DesktopClientHostMessage);
	}

	private onHostMessage(message: DesktopClientHostMessage) {
		if (message.type === "status" || message.type === "error") {
			if (isBrowserTransportFailure(message) && this.pending.size > 0) {
				const error = new Error(message.text);
				for (const pending of this.pending.values()) {
					clearTimeout(pending.timeoutId);
					pending.reject(error);
				}
				this.pending.clear();
			}
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeoutId);
		this.pending.delete(message.id);
		if (message.ok) {
			pending.resolve(message.result);
			return;
		}
		pending.reject(new Error(message.error));
	}

	async invoke<T>(
		command: string,
		args?: Record<string, unknown>,
		options?: { timeoutMs?: number },
	): Promise<T> {
		const id = `desktop_${Date.now()}_${this.requestCounter++}`;
		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for desktop command: ${command}`));
			}, options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
			this.pending.set(id, {
				command,
				resolve: (value) => resolve(value as T),
				reject,
				timeoutId,
			});
			this.postToHost({ type: "desktopCommand", id, command, args });
		});
	}
}

export const desktopClient = new HubDesktopClient();
