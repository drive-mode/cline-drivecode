/**
 * Host-message shape guards for the Chat view listener, kept out of the
 * component so they can be tested under the node environment the webview
 * suite runs in.
 *
 * Each branch checks the fields Chat's message handler logic consumes;
 * payload fields that only render as React text (chat message bodies, tool
 * event details, approval inputs) stay shallow because rendering is inert.
 */

import type { WebviewOutboundMessage } from "../../webview-protocol";
import {
	type HostMessage,
	isOptionalString,
	isRecord,
} from "./lib/host-message-gateway";

export const CHAT_HOST_MESSAGE_TYPES = [
	"status",
	"error",
	"defaults",
	"sessions",
	"providers",
	"models",
	"session_started",
	"session_hydrated",
	"assistant_delta",
	"reasoning_delta",
	"assistant_media",
	"tool_event",
	"approval_request",
	"approval_resolved",
	"turn_done",
	"pending_prompts",
	"pending_prompt_submitted",
	"reset_done",
	"fork_done",
	"fork_error",
] as const;

export type ChatHostMessageType = (typeof CHAT_HOST_MESSAGE_TYPES)[number];

export type ChatHostMessage = HostMessage &
	Extract<WebviewOutboundMessage, { type: ChatHostMessageType }>;

function isPendingPromptPayload(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.prompt === "string" &&
		(value.delivery === "queue" || value.delivery === "steer")
	);
}

function isHydratedMessagePayload(value: unknown): boolean {
	// Shallow: merge logic keys on id/role; message bodies render as text.
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.role === "string"
	);
}

export function isChatHostMessage(
	message: HostMessage,
): message is ChatHostMessage {
	switch (message.type) {
		case "status":
		case "fork_error":
			return typeof message.text === "string";
		case "error":
			return (
				typeof message.text === "string" &&
				isOptionalString(message.code) &&
				(message.recoverable === undefined ||
					typeof message.recoverable === "boolean")
			);
		case "defaults":
			return (
				isRecord(message.defaults) &&
				isOptionalString(message.defaults.provider) &&
				isOptionalString(message.defaults.model) &&
				isOptionalString(message.defaults.workspaceRoot) &&
				isOptionalString(message.defaults.cwd)
			);
		case "sessions":
			return (
				Array.isArray(message.sessions) &&
				message.sessions.every(
					(session) =>
						isRecord(session) &&
						typeof session.sessionId === "string" &&
						isOptionalString(session.title),
				)
			);
		case "providers":
			return (
				Array.isArray(message.providers) &&
				message.providers.every(
					(provider) =>
						isRecord(provider) &&
						typeof provider.id === "string" &&
						typeof provider.enabled === "boolean" &&
						isOptionalString(provider.name),
				)
			);
		case "models":
			return (
				typeof message.providerId === "string" &&
				Array.isArray(message.models) &&
				message.models.every(
					(model) => isRecord(model) && typeof model.id === "string",
				)
			);
		case "session_started":
			return typeof message.sessionId === "string";
		case "session_hydrated":
			return (
				typeof message.sessionId === "string" &&
				isOptionalString(message.status) &&
				isOptionalString(message.providerId) &&
				isOptionalString(message.modelId) &&
				Array.isArray(message.messages) &&
				message.messages.every(isHydratedMessagePayload)
			);
		case "assistant_delta":
			return (
				typeof message.text === "string" && isOptionalString(message.speakerId)
			);
		case "reasoning_delta":
			return (
				typeof message.text === "string" &&
				(message.redacted === undefined ||
					typeof message.redacted === "boolean")
			);
		case "assistant_media":
			return (
				isRecord(message.media) &&
				typeof message.media.id === "string" &&
				typeof message.media.modality === "string" &&
				typeof message.media.mediaType === "string" &&
				isRecord(message.media.source)
			);
		case "tool_event":
			return (
				typeof message.text === "string" &&
				(message.event === undefined || isRecord(message.event))
			);
		case "approval_request":
			return (
				typeof message.approvalId === "string" &&
				typeof message.toolName === "string"
			);
		case "approval_resolved":
			return typeof message.approvalId === "string";
		case "turn_done":
			return (
				typeof message.finishReason === "string" &&
				typeof message.iterations === "number" &&
				(message.usage === undefined || isRecord(message.usage))
			);
		case "pending_prompts":
			return (
				Array.isArray(message.prompts) &&
				message.prompts.every(isPendingPromptPayload)
			);
		case "pending_prompt_submitted":
			return isPendingPromptPayload(message.prompt);
		case "reset_done":
			return true;
		case "fork_done":
			return typeof message.newSessionId === "string";
		default:
			return false;
	}
}
