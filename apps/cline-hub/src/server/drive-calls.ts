import type { HubCommandName, RoomSnapshot } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function asRoomSnapshot(value: unknown): RoomSnapshot | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.roomId !== "string") {
		return undefined;
	}
	return value as RoomSnapshot;
}

export async function handleCallCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: {
		type:
			| "call_join"
			| "call_leave"
			| "call_end"
			| "call_mute"
			| "call_raise_hand"
			| "call_rename_participant"
			| "call_set_stage"
			| "call_set_address"
			| "call_set_mode"
			| "call_seat"
			| "call_add_roster_pack"
			| "call_remove_roster_pack"
			| "call_get_room";
		[key: string]: unknown;
	},
): Promise<void> {
	// Every call_* frame names its room. Errors carry it back so a client
	// waiting on one room's command cannot be tripped by another room's
	// failure of the same command.
	const frameRoomId =
		typeof frame.roomId === "string" && frame.roomId.trim()
			? frame.roomId
			: undefined;
	if (!ctx.uiClient) {
		ctx.send(peer, {
			type: "call_error",
			text: "Hub is not connected.",
			code: "hub_disconnected",
			command: frame.type,
			...(frameRoomId ? { roomId: frameRoomId } : {}),
		});
		return;
	}

	const command = frame.type as HubCommandName;
	const { type: _type, ...payload } = frame;
	try {
		const reply = await ctx.uiClient.command(
			command,
			payload as Record<string, unknown>,
		);
		if (!reply.ok) {
			ctx.send(peer, {
				type: "call_error",
				text: reply.error?.message ?? "Call command failed.",
				code: reply.error?.code,
				command: frame.type,
				...(frameRoomId ? { roomId: frameRoomId } : {}),
			});
			return;
		}
		const snapshot = asRoomSnapshot(reply.payload?.snapshot);
		const roomId =
			(typeof reply.payload?.roomId === "string"
				? reply.payload.roomId
				: undefined) ?? snapshot?.roomId;
		const seq =
			typeof reply.payload?.seq === "number" ? reply.payload.seq : undefined;
		const callSessionId =
			typeof reply.payload?.callSessionId === "string"
				? reply.payload.callSessionId
				: undefined;
		const whileAwayNote =
			typeof reply.payload?.whileAwayNote === "string"
				? reply.payload.whileAwayNote
				: undefined;
		const handoffNarration =
			typeof reply.payload?.handoffNarration === "string"
				? reply.payload.handoffNarration
				: undefined;
		// Only call_end sets `ended`, on both its normal and idempotent
		// double-end paths, and broadcast snapshots never carry it. That makes
		// it the one field that says "this snapshot is the reply to a stop".
		const ended = reply.payload?.ended === true;
		if (snapshot && roomId) {
			ctx.send(peer, {
				type: "room_snapshot",
				roomId,
				snapshot,
				...(seq !== undefined ? { seq } : {}),
				...(callSessionId ? { callSessionId } : {}),
				...(whileAwayNote ? { whileAwayNote } : {}),
				...(handoffNarration ? { handoffNarration } : {}),
				...(ended ? { ended: true } : {}),
			});
		}
	} catch (error) {
		ctx.send(peer, {
			type: "call_error",
			text: error instanceof Error ? error.message : String(error),
			code: "call_command_failed",
			command: frame.type,
			...(frameRoomId ? { roomId: frameRoomId } : {}),
		});
	}
}
