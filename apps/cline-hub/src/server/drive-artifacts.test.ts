import { HubCommandError } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { handleDriveArtifactsWebviewCommand } from "./drive-artifacts";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

const peer = {} as BrowserPeer;

function context(command?: ReturnType<typeof vi.fn>) {
	const send = vi.fn();
	return {
		send,
		ctx: {
			uiClient: command ? { command } : null,
			send,
		} as unknown as HubContext,
	};
}

describe("handleDriveArtifactsWebviewCommand", () => {
	it("errors when the hub is disconnected", async () => {
		const { ctx, send } = context();
		await handleDriveArtifactsWebviewCommand(ctx, peer, {
			type: "drive_artifacts_list",
			workspaceRoot: "/tmp/ws",
			requestId: "r1",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "drive_artifacts_error",
				code: "hub_disconnected",
				requestId: "r1",
			}),
		);
	});

	it("refuses to guess a workspace root", async () => {
		const command = vi.fn();
		const { ctx, send } = context(command);
		await handleDriveArtifactsWebviewCommand(ctx, peer, {
			type: "drive_artifacts_list",
			workspaceRoot: "   ",
			requestId: "r2",
		});
		expect(command).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "drive_artifacts_error",
				code: "invalid_payload",
				requestId: "r2",
			}),
		);
	});

	it("forwards the corpus from the hub command", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: { artifacts: [{ showItemId: "a" }, { showItemId: "b" }] },
		});
		const { ctx, send } = context(command);
		await handleDriveArtifactsWebviewCommand(ctx, peer, {
			type: "drive_artifacts_list",
			workspaceRoot: " /tmp/ws ",
			requestId: "r3",
		});
		expect(command).toHaveBeenCalledWith("drive.artifacts.list", {
			workspaceRoot: "/tmp/ws",
		});
		expect(send).toHaveBeenCalledWith(peer, {
			type: "drive_artifacts",
			artifacts: [{ showItemId: "a" }, { showItemId: "b" }],
			requestId: "r3",
		});
	});

	it("sends an empty list rather than undefined when the payload is odd", async () => {
		const command = vi.fn().mockResolvedValue({ ok: true, payload: {} });
		const { ctx, send } = context(command);
		await handleDriveArtifactsWebviewCommand(ctx, peer, {
			type: "drive_artifacts_list",
			workspaceRoot: "/tmp/ws",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({ type: "drive_artifacts", artifacts: [] }),
		);
	});

	/**
	 * The hub client throws a non-ok reply instead of returning it, so reading
	 * the code off the reply object would never fire. The page keys its "no
	 * corpus here yet" empty state on `workspace_not_bound`; losing the code
	 * turns every cold hub into a red error banner.
	 */
	it("forwards the hub's own error code off the thrown error", async () => {
		const command = vi
			.fn()
			.mockRejectedValue(
				new HubCommandError(
					"drive.artifacts.list",
					"workspace_not_bound",
					"workspaceRoot must be the workspace this hub is bound to",
				),
			);
		const { ctx, send } = context(command);
		await handleDriveArtifactsWebviewCommand(ctx, peer, {
			type: "drive_artifacts_list",
			workspaceRoot: "/tmp/ws",
			requestId: "r4",
		});
		expect(send).toHaveBeenCalledWith(peer, {
			type: "drive_artifacts_error",
			text: "workspaceRoot must be the workspace this hub is bound to",
			code: "workspace_not_bound",
			requestId: "r4",
		});
	});

	it("falls back to its own code when the failure carries none", async () => {
		const command = vi.fn().mockRejectedValue(new Error("socket closed"));
		const { ctx, send } = context(command);
		await handleDriveArtifactsWebviewCommand(ctx, peer, {
			type: "drive_artifacts_list",
			workspaceRoot: "/tmp/ws",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "drive_artifacts_error",
				text: "socket closed",
				code: "drive_artifacts_list_failed",
			}),
		);
	});
});
