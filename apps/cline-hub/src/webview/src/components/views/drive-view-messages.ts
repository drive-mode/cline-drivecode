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
	"provider_catalog",
	"provider_settings_saved",
	"provider_oauth_login_done",
	"providers",
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
		| { type: "provider_catalog"; providers: unknown[] }
		| {
				type: "provider_settings_saved";
				providerId?: string;
				enabled?: boolean;
		  }
		| {
				type: "provider_oauth_login_done";
				providerId?: string;
				accessTokenPresent?: boolean;
		  }
		| { type: "providers"; providers: unknown[] }
	);

function isOptionalBoolean(value: unknown): value is boolean | undefined {
	return value === undefined || typeof value === "boolean";
}

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
		case "provider_catalog":
		case "providers":
			return Array.isArray(message.providers);
		case "provider_settings_saved":
			return (
				isOptionalString(message.providerId) &&
				isOptionalBoolean(message.enabled)
			);
		case "provider_oauth_login_done":
			return (
				isOptionalString(message.providerId) &&
				isOptionalBoolean(message.accessTokenPresent)
			);
		default:
			return false;
	}
}
