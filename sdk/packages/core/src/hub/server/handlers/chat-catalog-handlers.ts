import {
	type HubChatCatalogCommandName,
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	parseHubChatCatalogWireReply,
	parseHubChatCatalogWireRequest,
} from "@cline/shared";
import {
	assertChatCatalogAuthority,
	assertChatCatalogMutationFenceSource,
	type ChatCatalogAuthorityContext,
	type ChatCatalogConfirmationGrant,
	type ChatCatalogMutationFence,
} from "../../../chat-catalog/chat-catalog-authority";
import { consumeHubChatCatalogConfirmation } from "../../../chat-catalog/hub-chat-catalog-confirmation-broker";
import { ChatCatalogError } from "../../../chat-catalog/sqlite-chat-catalog-service";
import type { HubAuthenticatedConnection } from "../workspace-capability-authority";
import { errorReply, type HubTransportContext, okReply } from "./context";

type Payload = Record<string, unknown>;

const FORBIDDEN_AUTHORITY_FIELDS = [
	"workspaceKey",
	"tenantId",
	"principalId",
	"actor",
	"actorKind",
	"source",
	"provenance",
	"occurredAt",
	"confirmation",
	"confirmed",
	"confirmations",
] as const;

function invalid(message: string): never {
	throw new ChatCatalogError("invalid_input", message);
}

function payloadOf(envelope: HubCommandEnvelope): Payload {
	if (envelope.payload === undefined) return {};
	if (
		typeof envelope.payload !== "object" ||
		envelope.payload === null ||
		Array.isArray(envelope.payload)
	) {
		return invalid("chat catalog payload must be an object");
	}
	return envelope.payload;
}

function requiredString(payload: Payload, key: string): string {
	const value = payload[key];
	if (typeof value !== "string" || !value.trim()) {
		return invalid(`${key} must be a non-empty string`);
	}
	return value;
}

function optionalString(payload: Payload, key: string): string | undefined {
	const value = payload[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string") return invalid(`${key} must be a string`);
	return value;
}

function requiredRevision(payload: Payload, key: string): number {
	const value = payload[key];
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		return invalid(`${key} must be a non-negative safe integer`);
	}
	return Number(value);
}

function optionalPositiveInteger(
	payload: Payload,
	key: string,
): number | undefined {
	const value = payload[key];
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		return invalid(`${key} must be a positive safe integer`);
	}
	return Number(value);
}

function optionalBoolean(payload: Payload, key: string): boolean | undefined {
	const value = payload[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") return invalid(`${key} must be a boolean`);
	return value;
}

function optionalCursor(payload: Payload) {
	const value = payload.cursor;
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return invalid("cursor must be an object");
	}
	const cursor = value as Payload;
	return {
		lastActivityAt: requiredString(cursor, "lastActivityAt"),
		chatId: requiredString(cursor, "chatId"),
	};
}

function bindingScope(payload: Payload) {
	return {
		transport: requiredString(payload, "transport"),
		...(optionalString(payload, "instanceId") !== undefined
			? { instanceId: optionalString(payload, "instanceId") }
			: {}),
		...(optionalString(payload, "channelId") !== undefined
			? { channelId: optionalString(payload, "channelId") }
			: {}),
		...(optionalString(payload, "threadId") !== undefined
			? { threadId: optionalString(payload, "threadId") }
			: {}),
		...(optionalString(payload, "participantScope") !== undefined
			? { participantScope: optionalString(payload, "participantScope") }
			: {}),
	};
}

function validatePayload(
	command: HubChatCatalogCommandName,
	payload: Payload,
): void {
	for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
		if (field in payload) {
			invalid(`${field} is host authority and is not accepted in payload`);
		}
	}
	const invocation = () => requiredString(payload, "invocationId");
	const revisionedChat = () => {
		requiredString(payload, "chatId");
		requiredRevision(payload, "expectedRevision");
		invocation();
	};
	const confirmedLifecycle = () => {
		revisionedChat();
		requiredString(payload, "confirmationCredential");
	};
	const confirmedLease = () => {
		requiredString(payload, "sessionId");
		requiredRevision(payload, "expectedRevision");
		invocation();
		requiredString(payload, "confirmationCredential");
	};
	switch (command) {
		case "chat_catalog.list": {
			const state = optionalString(payload, "catalogState");
			if (
				state !== undefined &&
				state !== "active" &&
				state !== "archived" &&
				state !== "all"
			) {
				invalid("catalogState must be active, archived, or all");
			}
			optionalString(payload, "sourceKind");
			optionalPositiveInteger(payload, "limit");
			optionalCursor(payload);
			return;
		}
		case "chat_catalog.get":
			requiredString(payload, "chatId");
			return;
		case "chat_catalog.adopt_root":
			requiredString(payload, "chatId");
			requiredString(payload, "sessionId");
			optionalString(payload, "title");
			optionalString(payload, "titleSource");
			invocation();
			return;
		case "chat_catalog.record_branch": {
			requiredString(payload, "chatId");
			requiredString(payload, "sessionId");
			requiredString(payload, "sourceChatId");
			requiredString(payload, "sourceSessionId");
			const relation = requiredString(payload, "relationKind");
			if (relation !== "fork" && relation !== "checkpoint_restore") {
				invalid("relationKind must be fork or checkpoint_restore");
			}
			optionalString(payload, "title");
			optionalString(payload, "titleSource");
			invocation();
			return;
		}
		case "chat_catalog.attach_successor": {
			requiredString(payload, "chatId");
			requiredString(payload, "sessionId");
			requiredString(payload, "parentSessionId");
			const relation = requiredString(payload, "relationKind");
			if (relation !== "config_restart" && relation !== "recovery") {
				invalid("relationKind must be config_restart or recovery");
			}
			requiredRevision(payload, "expectedRevision");
			invocation();
			return;
		}
		case "chat_catalog.record_activity":
			revisionedChat();
			requiredString(payload, "sessionId");
			return;
		case "chat_catalog.rename":
			revisionedChat();
			requiredString(payload, "title");
			return;
		case "chat_catalog.archive":
			confirmedLifecycle();
			optionalBoolean(payload, "stopRunningIntent");
			optionalBoolean(payload, "clearBindings");
			return;
		case "chat_catalog.activate":
		case "chat_catalog.purge":
			confirmedLifecycle();
			return;
		case "chat_catalog.bind":
			bindingScope(payload);
			requiredString(payload, "bindingId");
			requiredString(payload, "chatId");
			requiredString(payload, "sessionId");
			requiredRevision(payload, "expectedBindingRevision");
			invocation();
			return;
		case "chat_catalog.unbind":
			bindingScope(payload);
			requiredString(payload, "expectedBindingId");
			requiredString(payload, "expectedChatId");
			requiredString(payload, "expectedSessionId");
			requiredRevision(payload, "expectedBindingRevision");
			invocation();
			return;
		case "chat_catalog.lease.get":
			requiredString(payload, "sessionId");
			return;
		case "chat_catalog.lease.verify":
			requiredString(payload, "sessionId");
			requiredString(payload, "leaseToken");
			requiredRevision(payload, "expectedRevision");
			return;
		case "chat_catalog.lease.acquire":
			requiredString(payload, "sessionId");
			requiredRevision(payload, "expectedRevision");
			optionalPositiveInteger(payload, "ttlMs");
			invocation();
			return;
		case "chat_catalog.lease.renew":
			requiredString(payload, "sessionId");
			requiredString(payload, "leaseToken");
			requiredRevision(payload, "expectedRevision");
			optionalPositiveInteger(payload, "ttlMs");
			invocation();
			return;
		case "chat_catalog.lease.release":
			requiredString(payload, "sessionId");
			requiredString(payload, "leaseToken");
			requiredRevision(payload, "expectedRevision");
			invocation();
			return;
		case "chat_catalog.lease.revoke":
			confirmedLease();
			return;
	}
}

function requireRegisteredClient(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): string {
	const clientId = envelope.clientId?.trim();
	const client = clientId ? ctx.clients.get(clientId) : undefined;
	if (!client) {
		throw new ChatCatalogError(
			"invalid_input",
			"chat catalog commands require a registered hub client",
		);
	}
	return client.clientId;
}

async function authorize(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	payload: Payload,
	authenticatedConnection: HubAuthenticatedConnection,
	mutationFence: ChatCatalogMutationFence,
): Promise<ChatCatalogAuthorityContext> {
	const host = ctx.chatCatalog;
	if (!host) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"hub chat catalog authority is not configured",
		);
	}
	requireRegisteredClient(ctx, envelope);
	const authenticatedClientId = authenticatedConnection.connectionId;
	const confirmation =
		envelope.command === "chat_catalog.archive"
			? "archive"
			: envelope.command === "chat_catalog.activate"
				? "activate"
				: envelope.command === "chat_catalog.purge"
					? "purge"
					: envelope.command === "chat_catalog.lease.revoke"
						? "revoke_lease"
						: undefined;
	if (!confirmation && "confirmationCredential" in payload) {
		throw new ChatCatalogError(
			"invalid_input",
			"confirmationCredential is accepted only for confirmed commands",
		);
	}
	const authorityRequest = {
		authenticatedConnection,
		authenticatedClientId,
		mutationFence,
		command: envelope.command as HubChatCatalogCommandName,
		...(envelope.requestId ? { requestId: envelope.requestId } : {}),
	};
	let authority: ChatCatalogAuthorityContext;
	if (confirmation) {
		const aggregateKind = confirmation === "revoke_lease" ? "lease" : "chat";
		const aggregateId = requiredString(
			payload,
			aggregateKind === "lease" ? "sessionId" : "chatId",
		);
		const effects =
			confirmation === "archive"
				? [
						...(optionalBoolean(payload, "stopRunningIntent") === true
							? (["stop_running"] as const)
							: []),
						...(optionalBoolean(payload, "clearBindings") === true
							? (["clear_bindings"] as const)
							: []),
					]
				: [];
		let confirmationGrant: ChatCatalogConfirmationGrant;
		try {
			confirmationGrant = consumeHubChatCatalogConfirmation(
				host.confirmationBroker,
				{
					authenticatedClientId,
					credential: requiredString(payload, "confirmationCredential"),
					target: {
						confirmation,
						invocationId: requiredString(payload, "invocationId"),
						aggregateKind,
						aggregateId,
						expectedRevision: requiredRevision(payload, "expectedRevision"),
						...(effects.length > 0 ? { effects } : {}),
					},
				},
			);
		} catch {
			throw new ChatCatalogError(
				"invalid_input",
				"host confirmation credential is missing, mismatched, expired, or consumed",
			);
		}
		authority = await host.authorize({
			...authorityRequest,
			confirmationGrant,
		});
	} else {
		authority = await host.authorize(authorityRequest);
	}
	assertChatCatalogAuthority(authority);
	assertChatCatalogMutationFenceSource(authority, mutationFence);
	if (
		authority.principalId !== authenticatedConnection.principalId ||
		authority.tenantId !== authenticatedConnection.tenantId ||
		authority.workspaceKey !== authenticatedConnection.workspaceKey ||
		authority.source.kind !== "hub" ||
		authority.source.clientId !== authenticatedClientId ||
		authority.source.transport !== authenticatedConnection.transport
	) {
		throw new ChatCatalogError(
			"invalid_input",
			"hub catalog authority does not match the authenticated connection",
		);
	}
	return authority;
}

async function dispatch(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	authenticatedConnection: HubAuthenticatedConnection,
	connectionFence: (
		identity: HubAuthenticatedConnection,
	) => ChatCatalogMutationFence,
): Promise<unknown> {
	const fence = connectionFence(authenticatedConnection);
	fence.assertActive();
	const rawPayload = payloadOf(envelope);
	let payload: Payload;
	try {
		payload = parseHubChatCatalogWireRequest({
			version: envelope.version,
			command: envelope.command,
			payload: rawPayload,
		}).payload;
	} catch {
		return invalid("chat catalog v1 request schema rejected the payload");
	}
	validatePayload(envelope.command as HubChatCatalogCommandName, payload);
	const authority = await authorize(
		ctx,
		envelope,
		payload,
		authenticatedConnection,
		fence,
	);
	const port = ctx.chatCatalog?.port;
	if (!port) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"hub chat catalog port is not configured",
		);
	}
	// `host.authorize` may be asynchronous. Epoch revocation or socket close
	// before this final synchronous boundary must prevent catalog entry.
	fence.assertActive();
	const invocationId = () => requiredString(payload, "invocationId");

	switch (envelope.command) {
		case "chat_catalog.list": {
			const catalogState = optionalString(payload, "catalogState");
			if (
				catalogState !== undefined &&
				catalogState !== "active" &&
				catalogState !== "archived" &&
				catalogState !== "all"
			) {
				return invalid("catalogState must be active, archived, or all");
			}
			return port.listChats(authority, {
				workspaceKey: authority.workspaceKey,
				...(catalogState ? { catalogState } : {}),
				...(optionalString(payload, "sourceKind") !== undefined
					? { sourceKind: optionalString(payload, "sourceKind") }
					: {}),
				...(optionalPositiveInteger(payload, "limit") !== undefined
					? { limit: optionalPositiveInteger(payload, "limit") }
					: {}),
				...(optionalCursor(payload) ? { cursor: optionalCursor(payload) } : {}),
			});
		}
		case "chat_catalog.get":
			return (
				(await port.getChat(authority, requiredString(payload, "chatId"))) ??
				null
			);
		case "chat_catalog.adopt_root":
			return port.adoptRootSession(authority, {
				chatId: requiredString(payload, "chatId"),
				sessionId: requiredString(payload, "sessionId"),
				...(optionalString(payload, "title") !== undefined
					? { title: optionalString(payload, "title") }
					: {}),
				...(optionalString(payload, "titleSource") !== undefined
					? { titleSource: optionalString(payload, "titleSource") }
					: {}),
				invocationId: invocationId(),
			});
		case "chat_catalog.record_branch": {
			const relationKind = requiredString(payload, "relationKind");
			if (relationKind !== "fork" && relationKind !== "checkpoint_restore") {
				return invalid("relationKind must be fork or checkpoint_restore");
			}
			return port.recordBranch(authority, {
				chatId: requiredString(payload, "chatId"),
				sessionId: requiredString(payload, "sessionId"),
				sourceChatId: requiredString(payload, "sourceChatId"),
				sourceSessionId: requiredString(payload, "sourceSessionId"),
				relationKind,
				...(optionalString(payload, "title") !== undefined
					? { title: optionalString(payload, "title") }
					: {}),
				...(optionalString(payload, "titleSource") !== undefined
					? { titleSource: optionalString(payload, "titleSource") }
					: {}),
				invocationId: invocationId(),
			});
		}
		case "chat_catalog.attach_successor": {
			const relationKind = requiredString(payload, "relationKind");
			if (relationKind !== "config_restart" && relationKind !== "recovery") {
				return invalid("relationKind must be config_restart or recovery");
			}
			return port.attachSuccessorSession(authority, {
				chatId: requiredString(payload, "chatId"),
				sessionId: requiredString(payload, "sessionId"),
				parentSessionId: requiredString(payload, "parentSessionId"),
				relationKind,
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		}
		case "chat_catalog.record_activity":
			return port.recordChatActivity(authority, {
				chatId: requiredString(payload, "chatId"),
				sessionId: requiredString(payload, "sessionId"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		case "chat_catalog.rename":
			return port.renameChat(authority, {
				chatId: requiredString(payload, "chatId"),
				title: requiredString(payload, "title"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		case "chat_catalog.archive":
			return port.archiveChat(authority, {
				chatId: requiredString(payload, "chatId"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				...(optionalBoolean(payload, "stopRunningIntent") === true
					? { stopRunningIntent: true }
					: {}),
				...(optionalBoolean(payload, "clearBindings") === true
					? { clearBindings: true }
					: {}),
				invocationId: invocationId(),
			});
		case "chat_catalog.activate":
			return port.activateChat(authority, {
				chatId: requiredString(payload, "chatId"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		case "chat_catalog.bind":
			return port.bindChat(authority, {
				...bindingScope(payload),
				bindingId: requiredString(payload, "bindingId"),
				chatId: requiredString(payload, "chatId"),
				sessionId: requiredString(payload, "sessionId"),
				expectedBindingRevision: requiredRevision(
					payload,
					"expectedBindingRevision",
				),
				invocationId: invocationId(),
			});
		case "chat_catalog.unbind":
			return port.unbindChat(authority, {
				...bindingScope(payload),
				expectedBindingId: requiredString(payload, "expectedBindingId"),
				expectedChatId: requiredString(payload, "expectedChatId"),
				expectedSessionId: requiredString(payload, "expectedSessionId"),
				expectedBindingRevision: requiredRevision(
					payload,
					"expectedBindingRevision",
				),
				invocationId: invocationId(),
			});
		case "chat_catalog.lease.get":
			return (
				(await port.getSessionLease(
					authority,
					requiredString(payload, "sessionId"),
				)) ?? null
			);
		case "chat_catalog.lease.verify":
			return port.verifySessionLease(authority, {
				sessionId: requiredString(payload, "sessionId"),
				leaseToken: requiredString(payload, "leaseToken"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
			});
		case "chat_catalog.lease.acquire":
			return port.acquireSessionLease(authority, {
				sessionId: requiredString(payload, "sessionId"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				...(optionalPositiveInteger(payload, "ttlMs") !== undefined
					? { ttlMs: optionalPositiveInteger(payload, "ttlMs") }
					: {}),
				invocationId: invocationId(),
			});
		case "chat_catalog.lease.renew":
			return port.renewSessionLease(authority, {
				sessionId: requiredString(payload, "sessionId"),
				leaseToken: requiredString(payload, "leaseToken"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				...(optionalPositiveInteger(payload, "ttlMs") !== undefined
					? { ttlMs: optionalPositiveInteger(payload, "ttlMs") }
					: {}),
				invocationId: invocationId(),
			});
		case "chat_catalog.lease.release":
			return port.releaseSessionLease(authority, {
				sessionId: requiredString(payload, "sessionId"),
				leaseToken: requiredString(payload, "leaseToken"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		case "chat_catalog.lease.revoke":
			return port.revokeSessionLease(authority, {
				sessionId: requiredString(payload, "sessionId"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		case "chat_catalog.purge":
			return port.purgeChat(authority, {
				chatId: requiredString(payload, "chatId"),
				expectedRevision: requiredRevision(payload, "expectedRevision"),
				invocationId: invocationId(),
			});
		default:
			return invalid("unknown chat catalog command");
	}
}

export async function handleChatCatalogCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	authenticatedConnection: HubAuthenticatedConnection,
	connectionFence: (
		identity: HubAuthenticatedConnection,
	) => ChatCatalogMutationFence,
): Promise<HubReplyEnvelope> {
	try {
		const result = await dispatch(
			ctx,
			envelope,
			authenticatedConnection,
			connectionFence,
		);
		const reply = okReply(envelope, { result });
		try {
			return parseHubChatCatalogWireReply(
				envelope.command as HubChatCatalogCommandName,
				reply,
			);
		} catch {
			return errorReply(
				envelope,
				"unsupported_capability",
				"Chat catalog result failed v1 schema validation.",
			);
		}
	} catch (error) {
		if (error instanceof ChatCatalogError) {
			return errorReply(envelope, error.code, error.message);
		}
		return errorReply(
			envelope,
			"chat_catalog_failed",
			"Chat catalog command failed.",
		);
	}
}
