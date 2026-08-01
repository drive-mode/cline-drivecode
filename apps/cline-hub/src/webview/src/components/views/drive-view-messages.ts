/**
 * Host-message shape guards for the Drive home view. Room preview payloads
 * stay shallow here because `applyDriveRoomPreviewMessage` re-validates the
 * snapshot (`isRoomSnapshot`) and room id before touching the projection.
 */

import type { StatusSummary } from "@cline/shared";
import {
	type HostMessage,
	isOptionalString,
	isRecord,
} from "../../lib/host-message-gateway";
import { isStatusSummaryPayload } from "./status-view-messages";

export const DRIVE_VIEW_MESSAGE_TYPES = [
	"status_summary_result",
	"status_updated",
	"call_error",
	"room_snapshot",
	"drive_event",
	"room_not_found",
] as const;

export type DriveViewHostMessage = HostMessage &
	(
		| {
				type: "status_summary_result";
				requestId?: string;
				summary: StatusSummary;
		  }
		| { type: "status_updated" }
		| { type: "call_error"; text?: string; code?: string; command?: string }
		| {
				type: "room_snapshot" | "drive_event";
				roomId?: string;
				snapshot?: Record<string, unknown>;
		  }
		| { type: "room_not_found"; roomId?: string }
	);

export function isDriveViewHostMessage(
	message: HostMessage,
): message is DriveViewHostMessage {
	switch (message.type) {
		case "status_summary_result":
			return (
				isOptionalString(message.requestId) &&
				isStatusSummaryPayload(message.summary)
			);
		case "status_updated":
			return true;
		case "call_error":
			return (
				isOptionalString(message.text) &&
				isOptionalString(message.code) &&
				isOptionalString(message.command)
			);
		case "room_snapshot":
		case "drive_event":
			return (
				isOptionalString(message.roomId) &&
				(message.snapshot === undefined || isRecord(message.snapshot))
			);
		case "room_not_found":
			return isOptionalString(message.roomId);
		default:
			return false;
	}
}
