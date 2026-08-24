import {
	type HubChatProjectionCommandName,
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	parseHubChatProjectionWireReply,
	parseHubChatProjectionWireRequest,
	parseHubChatProjectionWireResult,
} from "@cline/shared";
import { ChatCatalogError } from "../../../chat-catalog/sqlite-chat-catalog-service";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "../workspace-capability-authority";
import type { HubWorkspaceManagedCorePool } from "../workspace-managed-core-pool";
import { errorReply, okReply } from "./context";

function freezeWireValue<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value)) freezeWireValue(child);
	return Object.freeze(value);
}

export async function handleChatProjectionCommand(
	envelope: HubCommandEnvelope,
	identity: HubAuthenticatedConnection,
	authority: HubWorkspaceCapabilityAuthority,
	pool: HubWorkspaceManagedCorePool,
): Promise<HubReplyEnvelope> {
	let command: HubChatProjectionCommandName;
	let payload: Record<string, unknown>;
	try {
		const parsed = parseHubChatProjectionWireRequest({
			version: envelope.version,
			command: envelope.command,
			payload: envelope.payload,
		});
		command = parsed.command;
		payload = parsed.payload;
	} catch {
		return errorReply(
			envelope,
			"invalid_input",
			"Managed projection request failed v1 schema validation.",
		);
	}

	try {
		authority.assertActive(identity);
		const signal = authority.signal(identity);
		const core = await pool.get(identity);
		authority.assertActive(identity);
		if (!core.projectionWire) {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Managed projection wire is not configured for this workspace.",
			);
		}
		const result = await core.projectionWire.invoke(
			Object.freeze({
				identity,
				signal,
				command,
				payload: freezeWireValue(payload),
			}),
		);
		authority.assertActive(identity);
		let normalized: unknown;
		try {
			normalized = parseHubChatProjectionWireResult(command, result);
		} catch {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Managed projection result failed v1 schema validation.",
			);
		}
		return parseHubChatProjectionWireReply(
			command,
			okReply(envelope, { result: normalized as Record<string, unknown> }),
		);
	} catch (error) {
		if (error instanceof ChatCatalogError) {
			return errorReply(
				envelope,
				error.code,
				"Managed projection command was rejected.",
			);
		}
		return errorReply(
			envelope,
			"chat_projection_failed",
			"Managed projection command failed.",
		);
	}
}
