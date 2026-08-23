import { resolve } from "node:path";
import type { ChatDetail, ChatListCursor, ChatPage } from "@cline/shared";
import type { SessionHistoryListOptions } from "../runtime/host/history";
import { listSessionHistoryFromBackend } from "../runtime/host/history";
import type { SessionBackend } from "../runtime/host/local/session-record";
import { toSessionRecord } from "../services/session-data";
import { CoreSessionService } from "../session/services/session-service";
import type { SessionHistoryRecord } from "../types/sessions";
import { SqliteChatCatalogService } from "./sqlite-chat-catalog-service";

type MaybePromise<T> = T | Promise<T>;

export interface ChatCatalogHistoryReader {
	listWorkspaceKeys?(): MaybePromise<string[]>;
	listChats(input: {
		workspaceKey: string;
		catalogState: "all";
		limit: number;
		cursor?: ChatListCursor;
	}): MaybePromise<ChatPage>;
	getChat(chatId: string): MaybePromise<ChatDetail | undefined>;
	isSessionTombstoned(sessionId: string): MaybePromise<boolean>;
}

export interface ChatCatalogHistoryProjectionOptions {
	limit?: number;
	workspaceRoot?: string;
	/** Resolves a catalog head that was outside the bounded legacy scan. */
	resolveSession?: (
		sessionId: string,
	) => MaybePromise<SessionHistoryRecord | undefined>;
}

export interface CatalogSessionHistoryListOptions
	extends SessionHistoryListOptions {
	workspaceRoot?: string;
}

function normalizeLimit(limit: number | undefined): number {
	const candidate = limit ?? 200;
	return Number.isFinite(candidate)
		? Math.max(0, Math.min(2000, Math.floor(candidate)))
		: 200;
}

function canonicalWorkspace(value: string): string {
	return resolve(value.trim());
}

function activityOf(row: SessionHistoryRecord): string {
	const projection = row.metadata?.chatCatalog;
	return projection?.projection === "catalog"
		? projection.lastActivityAt
		: row.updatedAt;
}

function stableIdentityOf(row: SessionHistoryRecord): string {
	const projection = row.metadata?.chatCatalog;
	return projection?.projection === "catalog"
		? projection.chatId
		: row.sessionId;
}

function asLegacy(row: SessionHistoryRecord): SessionHistoryRecord {
	return {
		...row,
		metadata: {
			...(row.metadata ?? {}),
			chatCatalog: { projection: "legacy" },
		},
	};
}

async function listWorkspaceChats(
	reader: ChatCatalogHistoryReader,
	workspaceKey: string,
): Promise<ChatDetail[]> {
	const details: ChatDetail[] = [];
	const seenChatIds = new Set<string>();
	let cursor: ChatListCursor | undefined;
	do {
		const page = await reader.listChats({
			workspaceKey,
			catalogState: "all",
			limit: 100,
			...(cursor ? { cursor } : {}),
		});
		for (const summary of page.items) {
			if (seenChatIds.has(summary.chatId)) continue;
			seenChatIds.add(summary.chatId);
			const detail = await reader.getChat(summary.chatId);
			if (detail) details.push(detail);
		}
		cursor = page.nextCursor;
	} while (cursor);
	return details;
}

/**
 * Compatibility projection for M0/M1 history surfaces.
 *
 * Catalog chats are canonical and collapse every attached runtime session into
 * the current head row. Unattached rows remain visible only as explicit Legacy
 * entries. Tombstoned rows never fall back from manifests or the session index.
 */
export async function projectChatCatalogHistory(
	rows: readonly SessionHistoryRecord[],
	reader: ChatCatalogHistoryReader,
	options: ChatCatalogHistoryProjectionOptions = {},
): Promise<SessionHistoryRecord[]> {
	const limit = normalizeLimit(options.limit);
	if (limit === 0) return [];
	const requestedWorkspace = options.workspaceRoot?.trim()
		? canonicalWorkspace(options.workspaceRoot)
		: undefined;
	const scopedRows = rows.filter(
		(row) =>
			!requestedWorkspace ||
			canonicalWorkspace(row.workspaceRoot) === requestedWorkspace,
	);
	const catalogWorkspaceKeys =
		!requestedWorkspace && reader.listWorkspaceKeys
			? await reader.listWorkspaceKeys()
			: [];
	const workspaceKeys = requestedWorkspace
		? [requestedWorkspace]
		: [
				...new Set([
					...catalogWorkspaceKeys.map(canonicalWorkspace),
					...scopedRows.map((row) => canonicalWorkspace(row.workspaceRoot)),
				]),
			];
	const details = (
		await Promise.all(
			workspaceKeys.map((workspaceKey) =>
				listWorkspaceChats(reader, workspaceKey),
			),
		)
	).flat();
	const rowBySessionId = new Map(
		scopedRows.map((row) => [row.sessionId, row] as const),
	);
	const attachedSessionIds = new Set<string>();
	const projected: SessionHistoryRecord[] = [];

	for (const chat of details) {
		for (const member of chat.sessions) {
			attachedSessionIds.add(member.sessionId);
		}
		if (chat.catalogState === "deleting") continue;
		const row =
			rowBySessionId.get(chat.headSessionId) ??
			(await options.resolveSession?.(chat.headSessionId));
		if (!row) continue;
		const catalogWorkspace = canonicalWorkspace(chat.workspaceKey);
		if (
			canonicalWorkspace(row.workspaceRoot) !== catalogWorkspace ||
			(requestedWorkspace && catalogWorkspace !== requestedWorkspace)
		) {
			continue;
		}
		const head = chat.sessions.find(
			(member) => member.sessionId === chat.headSessionId,
		);
		projected.push({
			...row,
			status: head?.executionStatus ?? row.status,
			updatedAt: chat.lastActivityAt,
			metadata: {
				...(row.metadata ?? {}),
				...(chat.title ? { title: chat.title } : {}),
				chatCatalog: {
					projection: "catalog",
					chatId: chat.chatId,
					catalogState: chat.catalogState,
					headSessionId: chat.headSessionId,
					lastActivityAt: chat.lastActivityAt,
					revision: chat.revision,
					sourceKind: chat.sourceKind,
					...(chat.parentChatId ? { parentChatId: chat.parentChatId } : {}),
					...(head
						? {
								relationKind: head.relationKind,
								...(head.parentSessionId
									? { parentSessionId: head.parentSessionId }
									: {}),
							}
						: {}),
				},
			},
		});
	}

	for (const row of scopedRows) {
		if (attachedSessionIds.has(row.sessionId)) continue;
		if (await reader.isSessionTombstoned(row.sessionId)) continue;
		projected.push(asLegacy(row));
	}

	return projected
		.sort(
			(left, right) =>
				activityOf(right).localeCompare(activityOf(left)) ||
				stableIdentityOf(left).localeCompare(stableIdentityOf(right)),
		)
		.slice(0, limit);
}

export function projectLegacyHistory(
	rows: readonly SessionHistoryRecord[],
	options: ChatCatalogHistoryProjectionOptions = {},
): SessionHistoryRecord[] {
	const limit = normalizeLimit(options.limit);
	const workspaceRoot = options.workspaceRoot?.trim()
		? canonicalWorkspace(options.workspaceRoot)
		: undefined;
	return rows
		.filter(
			(row) =>
				!workspaceRoot ||
				canonicalWorkspace(row.workspaceRoot) === workspaceRoot,
		)
		.map(asLegacy)
		.slice(0, limit);
}

/**
 * Read-only compatibility entrypoint used by CLI/TUI history. The concrete
 * catalog authority remains inside core; file/remote-compatible backends are
 * projected as explicitly Legacy rather than treated as lifecycle truth.
 */
export async function listCatalogSessionHistoryFromBackend(
	backend: SessionBackend,
	options: CatalogSessionHistoryListOptions = {},
): Promise<SessionHistoryRecord[]> {
	const limit = normalizeLimit(options.limit);
	if (limit === 0) return [];
	const scanLimit = Math.min(Math.max(limit * 4, 100), 1000);
	const rows = await listSessionHistoryFromBackend(backend, {
		limit: scanLimit,
		includeManifestFallback: options.includeManifestFallback,
		hydrate: options.hydrate,
		includeSubagents: options.includeSubagents,
	});
	if (!(backend instanceof CoreSessionService)) {
		return projectLegacyHistory(rows, {
			limit,
			workspaceRoot: options.workspaceRoot,
		});
	}

	const ownedCatalog = new SqliteChatCatalogService(
		backend.catalogStorageIdentity(),
	);
	try {
		return await projectChatCatalogHistory(rows, ownedCatalog, {
			limit,
			workspaceRoot: options.workspaceRoot,
			resolveSession: async (sessionId) => {
				const row = await backend.getSession(sessionId);
				return row ? toSessionRecord(row) : undefined;
			},
		});
	} finally {
		ownedCatalog.close();
	}
}
