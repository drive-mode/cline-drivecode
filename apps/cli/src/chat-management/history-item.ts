import type { SessionHistoryRecord } from "@cline/core";
import type { HubChatProjectionChat, SharedSessionStatus } from "@cline/shared";
import {
	chatHistoryTargetKey,
	historyTargetFromManagedProjection,
	historyTargetFromSessionRecord,
	type LegacyChatHistoryTarget,
	type ManagedChatHistoryTarget,
} from "./history-target";

const MAX_HISTORY_TITLE_LENGTH = 512;
const DEFAULT_MANAGED_TITLE = "Untitled managed chat";
const DEFAULT_LEGACY_TITLE = "Untitled legacy session";

export type ChatHistoryLineageKind =
	HubChatProjectionChat["sessions"][number]["relationKind"];

type ChatHistoryItemFields = Readonly<{
	title: string;
	lastActivityAt: string;
	lineageKind?: ChatHistoryLineageKind;
	executionStatus?: SharedSessionStatus;
	canResume: boolean;
	canArchive: boolean;
	canActivate: boolean;
	canRename: boolean;
	canPurge: boolean;
	canExport: boolean;
}>;

export type ManagedChatHistoryItem = Readonly<
	ChatHistoryItemFields & { target: ManagedChatHistoryTarget }
>;
export type LegacyChatHistoryItem = Readonly<
	ChatHistoryItemFields & { target: LegacyChatHistoryTarget }
>;
export type ChatHistoryItem = ManagedChatHistoryItem | LegacyChatHistoryItem;

export class InvalidChatHistoryItemError extends Error {
	readonly code = "invalid_history_item";

	constructor() {
		super("History data does not contain a valid app-facing item.");
		this.name = "InvalidChatHistoryItemError";
	}
}

function displayTitle(value: unknown, fallback: string): string {
	if (value !== undefined && typeof value !== "string") {
		throw new InvalidChatHistoryItemError();
	}
	const normalized = value?.replace(/\s+/g, " ").trim() || fallback;
	return normalized.slice(0, MAX_HISTORY_TITLE_LENGTH);
}

function timestamp(value: unknown): string {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new InvalidChatHistoryItemError();
	}
	return value;
}

export function historyItemFromManagedProjection(
	chat: HubChatProjectionChat,
): ManagedChatHistoryItem {
	const target = historyTargetFromManagedProjection(chat);
	const head = chat.sessions.find(
		(session) => session.sessionId === target.headSessionId,
	);
	if (!head) throw new InvalidChatHistoryItemError();
	const archived = target.catalogState === "archived";
	return Object.freeze({
		target,
		title: displayTitle(chat.title, DEFAULT_MANAGED_TITLE),
		lastActivityAt: timestamp(chat.lastActivityAt),
		lineageKind: head.relationKind,
		executionStatus: head.executionStatus,
		// Enable only when the corresponding authority port is implemented.
		canResume: false,
		canArchive: !archived,
		canActivate: archived,
		canRename: true,
		canPurge: archived,
		canExport: false,
	});
}

export function historyItemFromLegacyRecord(
	row: SessionHistoryRecord,
): LegacyChatHistoryItem {
	const target = historyTargetFromSessionRecord(row);
	if (target.kind !== "legacy") throw new InvalidChatHistoryItemError();
	return Object.freeze({
		target,
		title: displayTitle(
			row.metadata?.title ?? row.prompt,
			DEFAULT_LEGACY_TITLE,
		),
		lastActivityAt: timestamp(row.updatedAt),
		executionStatus: row.status,
		canResume: false,
		canArchive: false,
		canActivate: false,
		canRename: false,
		canPurge: false,
		canExport: true,
	});
}

export function sortChatHistoryItems<Item extends ChatHistoryItem>(
	items: readonly Item[],
): readonly Item[] {
	const keys = new Set<string>();
	const cloned = items.map((item): Item => {
		const key = chatHistoryTargetKey(item.target);
		if (keys.has(key)) throw new InvalidChatHistoryItemError();
		keys.add(key);
		return Object.freeze({
			...structuredClone(item),
			target: Object.freeze(structuredClone(item.target)),
		}) as Item;
	});
	cloned.sort((left, right) => {
		const activityOrder =
			Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
		return activityOrder !== 0
			? activityOrder
			: chatHistoryTargetKey(left.target).localeCompare(
					chatHistoryTargetKey(right.target),
				);
	});
	return Object.freeze(cloned);
}
