import { createSessionId } from "@cline/shared";

const MAX_MANAGED_ID_LENGTH = 512;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const CHAT_OPERATION_KINDS = [
	"start",
	"resume",
	"config_restart",
	"reset",
	"turn",
	"abort",
	"approval",
	"capability",
	"pending_prompt_update",
	"pending_prompt_remove",
	"compaction",
	"fork",
	"restore",
	"archive",
	"activate",
	"rename",
	"purge",
	"stop",
] as const;

export type ChatOperationKind = (typeof CHAT_OPERATION_KINDS)[number];
export type ChatOperationId = string & {
	readonly __chatOperationId: unique symbol;
};
export type ChatSessionId = string & {
	readonly __chatSessionId: unique symbol;
};
export type ChatCatalogId = string & {
	readonly __chatCatalogId: unique symbol;
};
export type ChatOperationIntent<
	Kind extends ChatOperationKind = ChatOperationKind,
> = Readonly<{
	kind: Kind;
	operationId: ChatOperationId;
}>;

export class InvalidChatIdentityError extends Error {
	readonly code = "invalid_chat_identity";

	constructor() {
		super("Chat identity generation failed closed.");
		this.name = "InvalidChatIdentityError";
	}
}

export interface ChatIdentityFactory {
	operation<Kind extends ChatOperationKind>(
		kind: Kind,
	): ChatOperationIntent<Kind>;
	session(): ChatSessionId;
	chat(): ChatCatalogId;
}

export interface ChatIdentityFactoryOptions {
	readonly createId?: (prefix: string) => string;
}

function assertOpaqueId(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_MANAGED_ID_LENGTH ||
		value.trim() !== value
	) {
		throw new InvalidChatIdentityError();
	}
	return value;
}

function assertPathSafeId(value: unknown): string {
	const sessionId = assertOpaqueId(value);
	if (
		!SESSION_ID_PATTERN.test(sessionId) ||
		sessionId === "." ||
		sessionId === ".."
	) {
		throw new InvalidChatIdentityError();
	}
	return sessionId;
}

export function assertChatOperationIntent<Kind extends ChatOperationKind>(
	intent: unknown,
	kind: Kind,
): ChatOperationIntent<Kind> {
	if (
		!intent ||
		typeof intent !== "object" ||
		(intent as Record<string, unknown>).kind !== kind
	) {
		throw new InvalidChatIdentityError();
	}
	const operationId = assertOpaqueId(
		(intent as Record<string, unknown>).operationId,
	) as ChatOperationId;
	return Object.freeze({ kind, operationId });
}

export function assertChatSessionId(value: unknown): ChatSessionId {
	return assertPathSafeId(value) as ChatSessionId;
}

export function assertChatCatalogId(value: unknown): ChatCatalogId {
	return assertPathSafeId(value) as ChatCatalogId;
}

/**
 * Generates a new identity once per caller intent. Callers retain and reuse the
 * returned operation ID for retries of that exact intent; retries do not call
 * the factory again.
 */
export function createChatIdentityFactory(
	options: ChatIdentityFactoryOptions = {},
): ChatIdentityFactory {
	if (
		options.createId !== undefined &&
		typeof options.createId !== "function"
	) {
		throw new InvalidChatIdentityError();
	}
	const createId = options.createId ?? createSessionId;
	const operationKinds = new Set<string>(CHAT_OPERATION_KINDS);
	return Object.freeze({
		operation<Kind extends ChatOperationKind>(
			kind: Kind,
		): ChatOperationIntent<Kind> {
			if (!operationKinds.has(kind)) throw new InvalidChatIdentityError();
			return Object.freeze({
				kind,
				operationId: assertOpaqueId(
					createId(`cli_chat_${kind}_`),
				) as ChatOperationId,
			});
		},
		session(): ChatSessionId {
			return assertChatSessionId(createId("cli_session_"));
		},
		chat(): ChatCatalogId {
			return assertChatCatalogId(createId("cli_catalog_chat_"));
		},
	});
}
