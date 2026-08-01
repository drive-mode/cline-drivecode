/**
 * Host-message shape guards for the App shell listener (hub state, workspace
 * defaults, recent sessions), kept out of the component so they can be tested
 * under the node environment the webview suite runs in.
 *
 * The hub_state check is shallow past the fields HomeView's logic consumes:
 * list items are validated as records and their deeper fields render as React
 * text, which is inert.
 */

import type {
	WebviewHubState,
	WebviewSessionSummary,
} from "../../webview-protocol";
import {
	type HostMessage,
	isOptionalString,
	isRecord,
} from "./lib/host-message-gateway";

export const APP_HOST_MESSAGE_TYPES = [
	"hub_state",
	"defaults",
	"sessions",
] as const;

export type AppHostMessage = HostMessage &
	(
		| WebviewHubState
		| { type: "defaults"; defaults?: { workspaceRoot?: string } }
		| { type: "sessions"; sessions: WebviewSessionSummary[] }
	);

const HUB_STATE_LIST_KEYS = [
	"clients",
	"connectors",
	"sessions",
	"clientSummaries",
	"sessionSummaries",
] as const;

function isHubStatePayload(message: HostMessage): boolean {
	if (typeof message.connected !== "boolean") {
		return false;
	}
	// HomeView slices events without a fallback, then renders id/title/body
	// directly and formats timestamp arithmetic.
	if (
		!Array.isArray(message.events) ||
		!message.events.every(
			(event) =>
				isRecord(event) &&
				typeof event.id === "string" &&
				typeof event.title === "string" &&
				typeof event.body === "string" &&
				typeof event.timestamp === "number",
		)
	) {
		return false;
	}
	for (const key of HUB_STATE_LIST_KEYS) {
		const value = message[key];
		if (
			value !== undefined &&
			!(Array.isArray(value) && value.every(isRecord))
		) {
			return false;
		}
	}
	return (
		isOptionalString(message.hubUrl) &&
		isOptionalString(message.hubUptime) &&
		isOptionalString(message.coreVersion)
	);
}

export function isAppHostMessage(
	message: HostMessage,
): message is AppHostMessage {
	switch (message.type) {
		case "hub_state":
			return isHubStatePayload(message);
		case "defaults":
			return (
				message.defaults === undefined ||
				(isRecord(message.defaults) &&
					isOptionalString(message.defaults.workspaceRoot))
			);
		case "sessions":
			return (
				Array.isArray(message.sessions) &&
				message.sessions.every(
					(session) =>
						isRecord(session) &&
						typeof session.sessionId === "string" &&
						isOptionalString(session.workspaceRoot),
				)
			);
		default:
			return false;
	}
}
