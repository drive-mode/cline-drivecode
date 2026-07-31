import type { HubCommandName } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DriveSessionRollupsWebviewFrame = {
	type: "drive_session_rollups";
	workspaceRoot: string;
	requestId?: string;
	limit?: number;
	callSessionId?: string;
	[key: string]: unknown;
};

/**
 * Bridges Chat Drive Settings debug dump → hub `drive_session_rollups`.
 * Localhost-only rollups; no telemetry.
 */
export async function handleDriveSessionRollupsWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveSessionRollupsWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "drive_session_rollups_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
			requestId,
		});
		return;
	}

	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	if (!workspaceRoot) {
		ctx.send(peer, {
			type: "drive_session_rollups_error",
			text: "workspaceRoot is required.",
			code: "invalid_payload",
			requestId,
		});
		return;
	}

	const payload: Record<string, unknown> = { workspaceRoot };
	if (typeof frame.limit === "number" && frame.limit > 0) {
		payload.limit = Math.floor(frame.limit);
	}
	if (typeof frame.callSessionId === "string" && frame.callSessionId.trim()) {
		payload.callSessionId = frame.callSessionId.trim();
	}

	try {
		const reply = await ctx.uiClient.command(
			"drive_session_rollups" as HubCommandName,
			payload,
		);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "drive_session_rollups_error",
				text: reply.error?.message ?? "Session rollups failed.",
				code: reply.error?.code,
				requestId,
			});
			return;
		}
		ctx.send(peer, {
			type: "drive_session_rollups",
			rollups: reply.payload?.rollups ?? [],
			dump:
				typeof reply.payload?.dump === "string"
					? reply.payload.dump
					: "",
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_session_rollups_error",
			text: error instanceof Error ? error.message : String(error),
			code: "drive_session_rollups_failed",
			requestId,
		});
	}
}
