/**
 * Typed wrappers over the desktop transport for every Drive sidecar command.
 *
 * The sidecar owns the one hub connection; the webview only ever asks it to
 * run a hub command and folds the events it broadcasts. Nothing here keeps an
 * authoritative copy of room state — see `room-state.ts` for the fold.
 */

import type { DriveRoomDirectoryEntry, StatusSessionRow } from "@cline/drive";
import type { RoomSnapshot } from "@cline/shared";
import { desktopClient } from "@/lib/desktop-client";

export const DRIVE_HUB_EVENT_NAME = "drive_hub_event";

export type DriveHubStatus = {
	connected: boolean;
	url: string | null;
	error: string | null;
	workspaceRoot: string;
};

export type DriveCallOp =
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

/** Exactly what the hub's `call_*` reply projects into `room_snapshot`. */
export type DriveCallReply = {
	roomId: string;
	snapshot: RoomSnapshot;
	seq?: number;
	callSessionId?: string;
	whileAwayNote?: string;
	handoffNarration?: string;
	ended?: boolean;
};

export type DriveCommandName =
	| "drive.room.get"
	| "drive.presenter.grant"
	| "drive.presenter.transfer"
	| "drive.presenter.revoke"
	| "drive.presenter.status"
	| "drive.spotlight.set"
	| "drive.participant.mute.set"
	| "drive.participant.deafen.set"
	| "drive.show.present"
	| "drive.show.enqueue"
	| "drive.show.tick"
	| "drive.do.enqueue"
	| "drive.planner.set"
	| "drive.script.attach"
	| "drive.script.advance"
	| "drive.artifacts.list"
	| "drive.fork.list"
	| "drive.fork.audit.get"
	| "drive.fork.retain.set"
	| "drive.fork.cancel";

export type DriveStatusOp =
	| "query"
	| "board"
	| "current"
	| "subjects"
	| "tasks_snapshot"
	| "summary";

export type DriveBankOp =
	| "get"
	| "seed"
	| "create_task"
	| "edit_plan_tasks"
	| "complete_task"
	| "bind_now"
	| "activate_plan"
	| "record_failure"
	| "accept_sdlc_freeze";

export type DriveAgentHomeOp = "get" | "list" | "put";
export type DriveAgentProfilesOp = "get" | "put";
export type DriveConfigOp = "get" | "put" | "upsert_profile";

export type DriveSessionRollupsRequest = {
	workspaceRoot?: string;
	limit?: number;
	callSessionId?: string;
};

export type DriveSessionRollupsReply = {
	sessions: StatusSessionRow[];
};

export type DriveRoomsListReply = {
	rooms: DriveRoomDirectoryEntry[];
};

/** Payload of the sidecar `drive_hub_event` broadcast. */
export type DriveHubEvent = {
	event: string;
	payload: Record<string, unknown>;
	seq?: number;
	timestamp?: string;
};

export type DriveCommandPayload = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Runtime shape guard for the broadcast — never trust the wire blindly. */
export function isDriveHubEvent(value: unknown): value is DriveHubEvent {
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.event !== "string" || !value.event.trim()) {
		return false;
	}
	if (value.payload !== undefined && !isRecord(value.payload)) {
		return false;
	}
	if (value.seq !== undefined && typeof value.seq !== "number") {
		return false;
	}
	if (value.timestamp !== undefined && typeof value.timestamp !== "string") {
		return false;
	}
	return true;
}

export function normalizeDriveHubEvent(value: DriveHubEvent): DriveHubEvent {
	return {
		event: value.event,
		payload: value.payload ?? {},
		...(value.seq !== undefined ? { seq: value.seq } : {}),
		...(value.timestamp !== undefined ? { timestamp: value.timestamp } : {}),
	};
}

export function driveHubStatus(): Promise<DriveHubStatus> {
	return desktopClient.invoke<DriveHubStatus>("drive_hub_status");
}

export function driveCall(
	op: DriveCallOp,
	roomId: string,
	payload: DriveCommandPayload = {},
): Promise<DriveCallReply> {
	return desktopClient.invoke<DriveCallReply>("drive_call", {
		...payload,
		op,
		roomId,
	});
}

export function driveRoomsList(
	workspaceRoot?: string,
): Promise<DriveRoomsListReply> {
	return desktopClient.invoke<DriveRoomsListReply>("drive_rooms_list", {
		...(workspaceRoot ? { workspaceRoot } : {}),
	});
}

export function driveCommand<T = Record<string, unknown>>(
	command: DriveCommandName,
	payload: DriveCommandPayload = {},
): Promise<T> {
	return desktopClient.invoke<T>("drive_command", { command, payload });
}

export function driveStatus<T = Record<string, unknown>>(
	op: DriveStatusOp,
	payload: DriveCommandPayload = {},
): Promise<T> {
	return desktopClient.invoke<T>("drive_status", { ...payload, op });
}

export function driveBank<T = Record<string, unknown>>(
	op: DriveBankOp,
	payload: DriveCommandPayload = {},
): Promise<T> {
	return desktopClient.invoke<T>("drive_bank", { ...payload, op });
}

export function driveSessionRollups(
	request: DriveSessionRollupsRequest = {},
): Promise<DriveSessionRollupsReply> {
	return desktopClient.invoke<DriveSessionRollupsReply>(
		"drive_session_rollups",
		{ ...request },
	);
}

export function driveAgentHome<T = Record<string, unknown>>(
	op: DriveAgentHomeOp,
	payload: DriveCommandPayload = {},
): Promise<T> {
	return desktopClient.invoke<T>("drive_agent_home", { ...payload, op });
}

export function driveAgentProfiles<T = Record<string, unknown>>(
	op: DriveAgentProfilesOp,
	payload: DriveCommandPayload = {},
): Promise<T> {
	return desktopClient.invoke<T>("drive_agent_profiles", { ...payload, op });
}

export function driveConfig<T = Record<string, unknown>>(
	op: DriveConfigOp,
	payload: DriveCommandPayload = {},
): Promise<T> {
	return desktopClient.invoke<T>("drive_config", { ...payload, op });
}

/**
 * Subscribe to hub events relayed by the sidecar. Malformed payloads are
 * dropped rather than thrown: one bad frame must not unsubscribe the room.
 */
export function subscribeDriveHubEvents(
	handler: (event: DriveHubEvent) => void,
): () => void {
	return desktopClient.subscribe(DRIVE_HUB_EVENT_NAME, (payload) => {
		if (!isDriveHubEvent(payload)) {
			return;
		}
		handler(normalizeDriveHubEvent(payload));
	});
}

export type DriveCommandErrorInfo = {
	/** The `<code>` prefix the sidecar keeps first, or null. */
	code: string | null;
	text: string;
};

const ERROR_CODE_PREFIX = /^([a-z][a-z0-9_.-]*):\s+([\s\S]+)$/i;

/**
 * The sidecar serializes `DriveCommandError` as `"<code>: <message>"`. Split
 * that back apart so surfaces can branch on the code and show the text.
 */
export function parseDriveCommandError(
	message: string | Error | unknown,
): DriveCommandErrorInfo {
	const raw =
		message instanceof Error
			? message.message
			: typeof message === "string"
				? message
				: String(message ?? "");
	const trimmed = raw.trim();
	const match = ERROR_CODE_PREFIX.exec(trimmed);
	if (!match) {
		return { code: null, text: trimmed || "Drive command failed." };
	}
	return { code: match[1].toLowerCase(), text: match[2].trim() };
}
