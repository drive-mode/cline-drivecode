import type { SessionHistoryRecord } from "@cline/core";
import type { HubChatProjectionChat } from "@cline/shared";

const MAX_HISTORY_ID_LENGTH = 512;
const HISTORY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ManagedChatHistoryTarget = Readonly<{
	kind: "managed";
	chatId: string;
	headSessionId: string;
	expectedRevision: number;
	catalogState: "active" | "archived";
}>;

export type LegacyChatHistoryTarget = Readonly<{
	kind: "legacy";
	sessionId: string;
}>;

export type ChatHistoryTarget =
	| ManagedChatHistoryTarget
	| LegacyChatHistoryTarget;

export class InvalidChatHistoryTargetError extends Error {
	readonly code = "invalid_history_target";

	constructor() {
		super("History row does not contain a valid authority target.");
		this.name = "InvalidChatHistoryTargetError";
	}
}

function opaqueId(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_HISTORY_ID_LENGTH ||
		value.trim() !== value
	) {
		throw new InvalidChatHistoryTargetError();
	}
	if (!HISTORY_ID_PATTERN.test(value) || value === "." || value === "..") {
		throw new InvalidChatHistoryTargetError();
	}
	return value;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function legacyHistoryTarget(sessionId: unknown): LegacyChatHistoryTarget {
	return Object.freeze({
		kind: "legacy",
		sessionId: opaqueId(sessionId),
	});
}

/**
 * Converts only the explicit local compatibility discriminant. Managed Hub
 * projection adapters construct the same target directly from their strict
 * wire result.
 */
export function historyTargetFromSessionRecord(
	row: SessionHistoryRecord,
): ChatHistoryTarget {
	const rawMetadata: unknown = row.metadata;
	if (rawMetadata === undefined) return legacyHistoryTarget(row.sessionId);
	const metadata = objectRecord(rawMetadata);
	if (!metadata) throw new InvalidChatHistoryTargetError();
	if (!Object.hasOwn(metadata, "chatCatalog")) {
		return legacyHistoryTarget(row.sessionId);
	}
	const projection = objectRecord(metadata.chatCatalog);
	if (!projection || !Object.hasOwn(projection, "projection")) {
		throw new InvalidChatHistoryTargetError();
	}
	if (projection.projection === "legacy") {
		if (
			Object.keys(projection).length !== 1 ||
			Object.keys(projection)[0] !== "projection"
		) {
			throw new InvalidChatHistoryTargetError();
		}
		return legacyHistoryTarget(row.sessionId);
	}
	if (projection.projection !== "catalog") {
		throw new InvalidChatHistoryTargetError();
	}
	return managedHistoryTarget({
		chatId: projection.chatId,
		headSessionId: projection.headSessionId,
		revision: projection.revision,
		catalogState: projection.catalogState,
	});
}

export function historyTargetFromManagedProjection(
	chat: HubChatProjectionChat,
): ManagedChatHistoryTarget {
	return managedHistoryTarget(chat);
}

export function assertManagedChatHistoryTarget(
	target: unknown,
): ManagedChatHistoryTarget {
	if (!target || typeof target !== "object") {
		throw new InvalidChatHistoryTargetError();
	}
	const candidate = target as Record<string, unknown>;
	if (candidate.kind !== "managed") {
		throw new InvalidChatHistoryTargetError();
	}
	return managedHistoryTarget({
		chatId: candidate.chatId,
		headSessionId: candidate.headSessionId,
		revision: candidate.expectedRevision,
		catalogState: candidate.catalogState,
	});
}

export function assertLegacyChatHistoryTarget(
	target: unknown,
): LegacyChatHistoryTarget {
	if (!target || typeof target !== "object") {
		throw new InvalidChatHistoryTargetError();
	}
	const candidate = target as Record<string, unknown>;
	if (candidate.kind !== "legacy") {
		throw new InvalidChatHistoryTargetError();
	}
	return legacyHistoryTarget(candidate.sessionId);
}

function managedHistoryTarget(input: {
	readonly chatId: unknown;
	readonly headSessionId: unknown;
	readonly revision: unknown;
	readonly catalogState: unknown;
}): ManagedChatHistoryTarget {
	if (
		(input.catalogState !== "active" && input.catalogState !== "archived") ||
		!Number.isSafeInteger(input.revision) ||
		(input.revision as number) < 0
	) {
		throw new InvalidChatHistoryTargetError();
	}
	return Object.freeze({
		kind: "managed",
		chatId: opaqueId(input.chatId),
		headSessionId: opaqueId(input.headSessionId),
		expectedRevision: input.revision as number,
		catalogState: input.catalogState,
	});
}

export function chatHistoryTargetKey(target: ChatHistoryTarget): string {
	return target.kind === "managed"
		? `managed:${target.chatId}`
		: `legacy:${target.sessionId}`;
}

export function sessionHistoryRecordTargetKey(
	row: SessionHistoryRecord,
): string {
	return chatHistoryTargetKey(historyTargetFromSessionRecord(row));
}

export function isManagedChatHistoryTarget(
	target: ChatHistoryTarget,
): target is ManagedChatHistoryTarget {
	return target.kind === "managed";
}
