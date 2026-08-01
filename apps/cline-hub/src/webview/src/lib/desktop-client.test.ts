import { describe, expect, it, vi } from "vitest";
import type { WebviewInboundMessage } from "../../../webview-protocol";
import {
	HubDesktopClient,
	isBrowserTransportFailure,
	isDesktopClientHostMessage,
} from "./desktop-client";

function createClient() {
	const postToHost = vi.fn<(message: WebviewInboundMessage) => void>();
	const client = new HubDesktopClient({ postToHost, listen: false });
	return { client, postToHost };
}

function lastDesktopCommand(postToHost: ReturnType<typeof vi.fn>) {
	const message = postToHost.mock.lastCall?.[0] as
		| Extract<WebviewInboundMessage, { type: "desktopCommand" }>
		| undefined;
	if (message?.type !== "desktopCommand") {
		throw new Error("Expected a desktop command to be posted");
	}
	return message;
}

describe("HubDesktopClient", () => {
	it("does not reject pending desktop commands for unrelated hub errors", async () => {
		const { client, postToHost } = createClient();
		const pending = client.invoke<{ installedKeys: string[] }>(
			"list_marketplace_installed_entries",
		);
		const command = lastDesktopCommand(postToHost);

		client.handleMessage({
			data: { type: "error", text: "Failed to restore previous session." },
		});
		client.handleMessage({
			data: {
				type: "desktopCommandResult",
				id: command.id,
				ok: true,
				result: { installedKeys: ["plugin:goal"] },
			},
		});

		await expect(pending).resolves.toEqual({ installedKeys: ["plugin:goal"] });
	});

	it("rejects pending desktop commands for browser transport failures", async () => {
		const { client } = createClient();
		const pending = client.invoke("list_marketplace_installed_entries");

		client.handleMessage({
			data: { type: "status", text: "Disconnected from the Cline Hub server." },
		});

		await expect(pending).rejects.toThrow(
			"Disconnected from the Cline Hub server.",
		);
	});

	it("only treats exact browser lifecycle messages as transport failures", () => {
		expect(
			isBrowserTransportFailure({
				type: "error",
				text: "Failed to connect to the Cline Hub server.",
			}),
		).toBe(true);
		expect(
			isBrowserTransportFailure({
				type: "error",
				text: "Failed to restore previous session.",
			}),
		).toBe(false);
	});

	it("ignores malformed command results instead of settling with garbage", async () => {
		const { client, postToHost } = createClient();
		const pending = client.invoke(
			"list_marketplace_installed_entries",
			undefined,
			{ timeoutMs: 50 },
		);
		const command = lastDesktopCommand(postToHost);

		// ok:false without a string error fails the shape guard and is dropped.
		client.handleMessage({
			data: {
				type: "desktopCommandResult",
				id: command.id,
				ok: false,
				error: 42,
			} as never,
		});

		await expect(pending).rejects.toThrow(/Timed out waiting/);
	});
});

describe("isDesktopClientHostMessage", () => {
	it("accepts status, error, and well-formed command results", () => {
		expect(isDesktopClientHostMessage({ type: "status", text: "ok" })).toBe(
			true,
		);
		expect(isDesktopClientHostMessage({ type: "error", text: "boom" })).toBe(
			true,
		);
		expect(
			isDesktopClientHostMessage({
				type: "desktopCommandResult",
				id: "d1",
				ok: true,
				result: { installedKeys: [] },
			}),
		).toBe(true);
		expect(
			isDesktopClientHostMessage({
				type: "desktopCommandResult",
				id: "d1",
				ok: false,
				error: "denied",
			}),
		).toBe(true);
	});

	it("rejects malformed payloads and other types", () => {
		expect(isDesktopClientHostMessage({ type: "status", text: 42 })).toBe(
			false,
		);
		expect(
			isDesktopClientHostMessage({ type: "desktopCommandResult", ok: true }),
		).toBe(false);
		expect(
			isDesktopClientHostMessage({
				type: "desktopCommandResult",
				id: "d1",
				ok: false,
			}),
		).toBe(false);
		expect(isDesktopClientHostMessage({ type: "hub_state" })).toBe(false);
	});
});
