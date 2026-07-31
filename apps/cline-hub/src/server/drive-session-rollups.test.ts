import { describe, expect, it, vi } from "vitest";
import { handleDriveSessionRollupsWebviewCommand } from "./drive-session-rollups";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

describe("handleDriveSessionRollupsWebviewCommand", () => {
	it("errors when hub is disconnected", async () => {
		const send = vi.fn();
		const ctx = {
			uiClient: null,
			send,
		} as unknown as HubContext;
		const peer = {} as BrowserPeer;
		await handleDriveSessionRollupsWebviewCommand(ctx, peer, {
			type: "drive_session_rollups",
			workspaceRoot: "/tmp/ws",
			requestId: "r1",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "drive_session_rollups_error",
				code: "hub_disconnected",
				requestId: "r1",
			}),
		);
	});

	it("forwards rollups dump from hub command", async () => {
		const send = vi.fn();
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: {
				rollups: [{ callSessionId: "cs-1", tasksCompleted: 2 }],
				dump: "Session rollups (local, n=1)\n",
			},
		});
		const ctx = {
			uiClient: { command },
			send,
		} as unknown as HubContext;
		const peer = {} as BrowserPeer;
		await handleDriveSessionRollupsWebviewCommand(ctx, peer, {
			type: "drive_session_rollups",
			workspaceRoot: "/tmp/ws",
			limit: 5,
			requestId: "r2",
		});
		expect(command).toHaveBeenCalledWith("drive_session_rollups", {
			workspaceRoot: "/tmp/ws",
			limit: 5,
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "drive_session_rollups",
				requestId: "r2",
				dump: "Session rollups (local, n=1)\n",
			}),
		);
	});
});
