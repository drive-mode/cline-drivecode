import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DriveRoomsWebviewFrame = {
	type: "call_list_rooms";
	requestId?: string;
	workspaceRoot?: string;
	[key: string]: unknown;
};

/**
 * Bridges the Rooms page → hub `call_list_rooms`. Read-only directory over
 * the durable room log (ADR-0013); the hub stays the single writer, so this
 * never mutates room state — Stop/Start go through call_end / call_join.
 */
export async function handleDriveRoomsWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveRoomsWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;

	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "drive_rooms_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
			requestId,
		});
		return;
	}

	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	const payload: Record<string, unknown> = workspaceRoot
		? { workspaceRoot }
		: {};

	try {
		const reply = await ctx.uiClient.command("call_list_rooms", payload);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "drive_rooms_error",
				text: reply.error?.message ?? "Listing rooms failed.",
				code: reply.error?.code,
				requestId,
			});
			return;
		}
		ctx.send(peer, {
			type: "drive_rooms",
			rooms: Array.isArray(reply.payload?.rooms) ? reply.payload.rooms : [],
			requestId,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "drive_rooms_error",
			text: error instanceof Error ? error.message : String(error),
			code: "call_list_rooms_failed",
			requestId,
		});
	}
}
