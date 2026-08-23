import type {
	ManagedHubChatClient,
	ManagedHubChatProjectionSnapshot,
} from "@cline/core";
import type {
	HubChatLifecycleResult,
	HubChatProjectionListRequest,
	HubChatProjectionListResult,
} from "@cline/shared";
import type { ChatOperationIntent } from "./chat-identities";
import {
	historyItemFromManagedProjection,
	type ManagedChatHistoryItem,
	sortChatHistoryItems,
} from "./history-item";
import {
	assertManagedChatHistoryTarget,
	type ManagedChatHistoryTarget,
} from "./history-target";

type ManagedHistoryClient = Pick<
	ManagedHubChatClient,
	| "getProjectionSnapshot"
	| "listChats"
	| "archiveChat"
	| "activateChat"
	| "renameChat"
	| "purgeChat"
>;

type ManagedChatDetail = HubChatLifecycleResult<"chat_lifecycle.archive">;

export type ManagedChatHistoryPage = Readonly<{
	snapshotId: string;
	snapshotSequence: number;
	checkpoint?: number;
	items: readonly ManagedChatHistoryItem[];
	nextCursor?: string;
	hasMore: boolean;
}>;

export type ManagedChatPurgeResult = Readonly<{
	chatId: string;
	sessionIds: readonly string[];
	applied: boolean;
}>;

export class InvalidManagedHistoryActionError extends Error {
	readonly code = "invalid_managed_history_action";

	constructor() {
		super("Managed history action is invalid for the selected target.");
		this.name = "InvalidManagedHistoryActionError";
	}
}

function operationId<Kind extends ChatOperationIntent["kind"]>(
	intent: ChatOperationIntent<Kind>,
	kind: Kind,
): string {
	if (
		!intent ||
		intent.kind !== kind ||
		typeof intent.operationId !== "string" ||
		intent.operationId.length === 0 ||
		intent.operationId.length > 512 ||
		intent.operationId.trim() !== intent.operationId
	) {
		throw new InvalidManagedHistoryActionError();
	}
	return intent.operationId;
}

function targetFor(
	target: ManagedChatHistoryTarget,
	state?: ManagedChatHistoryTarget["catalogState"],
): ManagedChatHistoryTarget {
	let validated: ManagedChatHistoryTarget;
	try {
		validated = assertManagedChatHistoryTarget(target);
	} catch {
		throw new InvalidManagedHistoryActionError();
	}
	if (state !== undefined && validated.catalogState !== state) {
		throw new InvalidManagedHistoryActionError();
	}
	return validated;
}

function itemFromMutation(input: {
	chat: ManagedChatDetail;
	target: ManagedChatHistoryTarget;
	expectedState: ManagedChatHistoryTarget["catalogState"];
	expectedTitle?: string;
}): ManagedChatHistoryItem {
	const { chat, target, expectedState, expectedTitle } = input;
	if (
		chat.chatId !== target.chatId ||
		chat.headSessionId !== target.headSessionId ||
		chat.revision <= target.expectedRevision ||
		chat.catalogState !== expectedState ||
		(expectedTitle !== undefined && chat.title !== expectedTitle)
	) {
		throw new InvalidManagedHistoryActionError();
	}
	return historyItemFromManagedProjection({
		...chat,
		catalogState: chat.catalogState,
		sessionCount: chat.sessions.length,
		bindingCount: chat.bindings.length,
	});
}

function pageFromProjection(
	projection: ManagedHubChatProjectionSnapshot | HubChatProjectionListResult,
): ManagedChatHistoryPage {
	const items = sortChatHistoryItems(
		projection.chats.map(historyItemFromManagedProjection),
	);
	return Object.freeze({
		snapshotId: projection.snapshotId,
		snapshotSequence: projection.snapshotSequence,
		...(isManagedSnapshot(projection)
			? { checkpoint: projection.checkpoint }
			: {}),
		items,
		...(projection.nextCursor ? { nextCursor: projection.nextCursor } : {}),
		hasMore: projection.nextCursor !== undefined,
	});
}

function isManagedSnapshot(
	projection: ManagedHubChatProjectionSnapshot | HubChatProjectionListResult,
): projection is ManagedHubChatProjectionSnapshot {
	return "checkpoint" in projection;
}

function title(value: string): string {
	const normalized = value?.trim();
	if (!normalized || normalized.length > 512) {
		throw new InvalidManagedHistoryActionError();
	}
	return normalized;
}

/**
 * Gate-off managed history boundary. It never constructs Legacy/Core state and
 * intentionally exposes no resume method while ADR-0045 remains Proposed.
 */
export function createManagedChatHistoryAdapter(input: {
	client: ManagedHistoryClient;
}) {
	const { client } = input;
	return Object.freeze({
		getSnapshot(): ManagedChatHistoryPage {
			return pageFromProjection(client.getProjectionSnapshot());
		},
		async listPage(
			request: HubChatProjectionListRequest = {},
		): Promise<ManagedChatHistoryPage> {
			return pageFromProjection(await client.listChats(request));
		},
		async archive(action: {
			intent: ChatOperationIntent<"archive">;
			target: ManagedChatHistoryTarget;
			stopRunning?: boolean;
			clearBindings?: boolean;
		}): Promise<ManagedChatHistoryItem> {
			const target = targetFor(action.target, "active");
			const chat = await client.archiveChat({
				operationId: operationId(action.intent, "archive"),
				chatId: target.chatId,
				expectedRevision: target.expectedRevision,
				...(action.stopRunning === undefined
					? {}
					: { stopRunning: action.stopRunning }),
				...(action.clearBindings === undefined
					? {}
					: { clearBindings: action.clearBindings }),
			});
			return itemFromMutation({
				chat,
				target,
				expectedState: "archived",
			});
		},
		async activate(action: {
			intent: ChatOperationIntent<"activate">;
			target: ManagedChatHistoryTarget;
		}): Promise<ManagedChatHistoryItem> {
			const target = targetFor(action.target, "archived");
			const chat = await client.activateChat({
				operationId: operationId(action.intent, "activate"),
				chatId: target.chatId,
				expectedRevision: target.expectedRevision,
			});
			return itemFromMutation({
				chat,
				target,
				expectedState: "active",
			});
		},
		async rename(action: {
			intent: ChatOperationIntent<"rename">;
			target: ManagedChatHistoryTarget;
			title: string;
		}): Promise<ManagedChatHistoryItem> {
			const target = targetFor(action.target);
			const nextTitle = title(action.title);
			const chat = await client.renameChat({
				operationId: operationId(action.intent, "rename"),
				chatId: target.chatId,
				expectedRevision: target.expectedRevision,
				title: nextTitle,
			});
			return itemFromMutation({
				chat,
				target,
				expectedState: target.catalogState,
				expectedTitle: nextTitle,
			});
		},
		async purge(action: {
			intent: ChatOperationIntent<"purge">;
			target: ManagedChatHistoryTarget;
		}): Promise<ManagedChatPurgeResult> {
			const target = targetFor(action.target, "archived");
			const result = await client.purgeChat({
				operationId: operationId(action.intent, "purge"),
				chatId: target.chatId,
				expectedRevision: target.expectedRevision,
			});
			const sessionIds = new Set(result.sessionIds);
			if (
				result.chatId !== target.chatId ||
				!sessionIds.has(target.headSessionId) ||
				sessionIds.size !== result.sessionIds.length
			) {
				throw new InvalidManagedHistoryActionError();
			}
			return Object.freeze({
				chatId: result.chatId,
				sessionIds: Object.freeze([...result.sessionIds]),
				applied: result.applied,
			});
		},
	});
}
