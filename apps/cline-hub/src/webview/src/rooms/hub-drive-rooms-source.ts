import type { DriveRoomDirectoryEntry } from "@cline/drive";
import { DRIVE_PARTICIPANT_HUMAN } from "../drive/types";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";
import type { DriveRoomsSource } from "./drive-rooms-source";
import { roomDirectoryEntryFromUnknown } from "./roomCardModel";

const TIMEOUT_MS = 5_000;

const ROOMS_REPLY_TYPES = ["drive_rooms", "drive_rooms_error"] as const;

type RoomsReply = HostMessage & {
	type: "drive_rooms" | "drive_rooms_error";
	requestId?: string;
	rooms?: unknown[];
	text?: string;
};

function isRoomsReply(message: HostMessage): message is RoomsReply {
	return (
		(message.type === "drive_rooms" || message.type === "drive_rooms_error") &&
		isOptionalString(message.requestId) &&
		(message.rooms === undefined || Array.isArray(message.rooms)) &&
		isOptionalString(message.text)
	);
}

const STOP_REPLY_TYPES = ["room_snapshot", "call_error"] as const;

export type RoomStopReply = HostMessage & {
	type: "room_snapshot" | "call_error";
	roomId?: string;
	command?: string;
	text?: string;
	ended?: boolean;
};

export function isRoomStopReply(
	message: HostMessage,
): message is RoomStopReply {
	return (
		(message.type === "room_snapshot" || message.type === "call_error") &&
		isOptionalString(message.roomId) &&
		isOptionalString(message.command) &&
		isOptionalString(message.text) &&
		(message.ended === undefined || typeof message.ended === "boolean")
	);
}

/**
 * `call_end` carries no requestId, so a pending stop has to recognise its own
 * reply out of the shared host-message stream. Two things can fool a naive
 * match, and both are ordinary traffic rather than edge cases:
 *
 * - `room_snapshot` is also **broadcast** for roster changes and mid-call
 *   updates, so the room's own snapshots arrive constantly. Only a `call_end`
 *   reply sets `ended` — on both the normal close and the idempotent
 *   double-end. Handoff narration would not do: the idempotent path returns no
 *   narration, so keying on it would hang a second Stop instead of resolving
 *   it.
 * - `call_error` needs the room as well as the command. Two rooms stopping at
 *   once would otherwise abort each other, and an unrelated `call_end` failure
 *   would abort both.
 */
export function roomStopReplyMatches(
	message: RoomStopReply,
	roomId: string,
): boolean {
	if (message.roomId !== roomId) {
		return false;
	}
	if (message.type === "call_error") {
		return message.command === "call_end";
	}
	return message.ended === true;
}

/**
 * Live hub adapter: reads the durable room directory via `call_list_rooms`.
 * Read-only — Stop and Start are separate call_end / call_join ops so the hub
 * stays the single writer of room state (ADR-0000 D2).
 */
export class HubDriveRoomsSource implements DriveRoomsSource {
	listRooms(workspaceRoot?: string): Promise<DriveRoomDirectoryEntry[]> {
		const requestId = `drive-rooms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const root = workspaceRoot?.trim();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error("call_list_rooms timed out"));
			}, TIMEOUT_MS);

			const unsubscribe = subscribeToHostMessages({
				types: ROOMS_REPLY_TYPES,
				guard: isRoomsReply,
				onMessage: (message) => {
					if (message.requestId !== requestId) {
						return;
					}
					clearTimeout(timer);
					unsubscribe();
					if (message.type === "drive_rooms_error") {
						reject(new Error(message.text?.trim() || "call_list_rooms failed"));
						return;
					}
					const entries: DriveRoomDirectoryEntry[] = [];
					for (const raw of message.rooms ?? []) {
						const entry = roomDirectoryEntryFromUnknown(raw);
						if (entry) {
							entries.push(entry);
						}
					}
					resolve(entries);
				},
			});

			postToHost({
				type: "call_list_rooms",
				requestId,
				...(root ? { workspaceRoot: root } : {}),
			});
		});
	}

	stopRoom(roomId: string, workspaceRoot?: string): Promise<void> {
		const root = workspaceRoot?.trim();

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error("call_end timed out"));
			}, TIMEOUT_MS);

			const unsubscribe = subscribeToHostMessages({
				types: STOP_REPLY_TYPES,
				guard: isRoomStopReply,
				onMessage: (message) => {
					if (!roomStopReplyMatches(message, roomId)) {
						return;
					}
					clearTimeout(timer);
					unsubscribe();
					if (message.type === "call_error") {
						reject(new Error(message.text?.trim() || "call_end failed"));
						return;
					}
					resolve();
				},
			});

			postToHost({
				type: "call_end",
				roomId,
				actorId: DRIVE_PARTICIPANT_HUMAN,
				...(root ? { workspaceRoot: root } : {}),
			});
		});
	}
}
