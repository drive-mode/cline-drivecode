import {
	type HubChatRuntimeCommandName,
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	parseHubChatRuntimeWireReply,
	parseHubChatRuntimeWireRequest,
	parseHubChatRuntimeWireResult,
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

export async function handleChatRuntimeCommand(
	envelope: HubCommandEnvelope,
	identity: HubAuthenticatedConnection,
	authority: HubWorkspaceCapabilityAuthority,
	pool: HubWorkspaceManagedCorePool,
): Promise<HubReplyEnvelope> {
	let command: HubChatRuntimeCommandName;
	let payload: Record<string, unknown>;
	try {
		const parsed = parseHubChatRuntimeWireRequest({
			version: envelope.version,
			command: envelope.command,
			payload: envelope.payload,
		});
		command = parsed.command;
		payload = freezeWireValue(parsed.payload);
	} catch {
		return errorReply(
			envelope,
			"invalid_input",
			"Managed runtime request failed v1 schema validation.",
		);
	}

	try {
		authority.assertActive(identity);
		const signal = authority.signal(identity);
		const core = await pool.get(identity);
		authority.assertActive(identity);
		if (!core.runtimeWire) {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Managed runtime wire is not configured for this workspace.",
			);
		}
		const result = await core.runtimeWire.invoke(
			Object.freeze({ identity, signal, command, payload }),
		);
		authority.assertActive(identity);
		let normalized: unknown;
		try {
			normalized = parseHubChatRuntimeWireResult(command, result);
		} catch {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Managed runtime result failed v1 schema validation.",
			);
		}
		return parseHubChatRuntimeWireReply(
			command,
			okReply(envelope, { result: normalized as Record<string, unknown> }),
		);
	} catch (error) {
		if (error instanceof ChatCatalogError) {
			return errorReply(
				envelope,
				error.code,
				"Managed runtime command was rejected.",
			);
		}
		return errorReply(
			envelope,
			"chat_runtime_failed",
			"Managed runtime command failed.",
		);
	}
}
