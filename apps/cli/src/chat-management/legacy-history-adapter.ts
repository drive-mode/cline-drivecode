import type { SessionHistoryRecord } from "@cline/core";
import type { HistoryExportFormat } from "../session/history-export";
import {
	historyItemFromLegacyRecord,
	type LegacyChatHistoryItem,
} from "./history-item";
import {
	assertLegacyChatHistoryTarget,
	type ChatHistoryTarget,
	historyTargetFromSessionRecord,
	InvalidChatHistoryTargetError,
	type LegacyChatHistoryTarget,
} from "./history-target";

const MAX_LEGACY_HISTORY_PAGE_SIZE = 100;

export type LegacyChatHistoryPage = Readonly<{
	items: readonly LegacyChatHistoryItem[];
}>;

export interface LegacyChatHistoryAdapterDependencies {
	readonly listSessions: (
		limit: number,
		options: { workspaceRoot?: string; hydrate?: boolean },
	) => Promise<SessionHistoryRecord[]>;
	readonly exportSession: (input: {
		sessionId: string;
		format: HistoryExportFormat;
		outputPath?: string;
		outputDirectory?: string;
	}) => Promise<string>;
	/** Re-resolves durable Catalog/Legacy authority at action admission. */
	readonly resolveSessionAuthority: (
		sessionId: string,
	) => Promise<ChatHistoryTarget | undefined>;
}

export interface LegacyChatHistoryAdapter {
	list(input?: {
		limit?: number;
		workspaceRoot?: string;
		hydrate?: boolean;
	}): Promise<LegacyChatHistoryPage>;
	export(input: {
		target: LegacyChatHistoryTarget;
		format: HistoryExportFormat;
		outputPath?: string;
		outputDirectory?: string;
	}): Promise<string>;
}

type LegacyChatHistoryListInput = NonNullable<
	Parameters<LegacyChatHistoryAdapter["list"]>[0]
>;
type LegacyChatHistoryExportInput = Parameters<
	LegacyChatHistoryAdapter["export"]
>[0];

function pageSize(value: number | undefined): number {
	const size = value ?? 50;
	if (
		!Number.isSafeInteger(size) ||
		size < 1 ||
		size > MAX_LEGACY_HISTORY_PAGE_SIZE
	) {
		throw new Error("Legacy history page size is invalid.");
	}
	return size;
}

/**
 * Explicitly read-only compatibility boundary. Catalog-shaped rows are
 * excluded, not adopted, and malformed catalog-shaped rows fail the read.
 */
export function createLegacyChatHistoryAdapter(
	dependencies: LegacyChatHistoryAdapterDependencies,
): LegacyChatHistoryAdapter {
	const adapter: LegacyChatHistoryAdapter = {
		async list(input: LegacyChatHistoryListInput = {}) {
			const rows = await dependencies.listSessions(pageSize(input.limit), {
				workspaceRoot: input.workspaceRoot,
				hydrate: input.hydrate,
			});
			const items: LegacyChatHistoryItem[] = [];
			for (const row of rows) {
				const target = historyTargetFromSessionRecord(row);
				if (target.kind === "managed") continue;
				items.push(historyItemFromLegacyRecord(row));
			}
			return Object.freeze({
				items: Object.freeze(items),
			});
		},
		async export(input: LegacyChatHistoryExportInput) {
			const target = assertLegacyChatHistoryTarget(input.target);
			const current = assertLegacyChatHistoryTarget(
				await dependencies.resolveSessionAuthority(target.sessionId),
			);
			if (current.sessionId !== target.sessionId) {
				throw new InvalidChatHistoryTargetError();
			}
			return await dependencies.exportSession({
				sessionId: target.sessionId,
				format: input.format,
				outputPath: input.outputPath,
				outputDirectory: input.outputDirectory,
			});
		},
	};
	return Object.freeze(adapter);
}
