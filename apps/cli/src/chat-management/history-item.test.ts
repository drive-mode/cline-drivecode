import type { SessionHistoryRecord } from "@cline/core";
import type { HubChatProjectionChat } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	historyItemFromLegacyRecord,
	historyItemFromManagedProjection,
	InvalidChatHistoryItemError,
	sortChatHistoryItems,
} from "./history-item";

function managedProjection(
	overrides: Partial<HubChatProjectionChat> = {},
): HubChatProjectionChat {
	return {
		chatId: "chat-managed",
		catalogState: "active",
		headSessionId: "session-managed",
		title: "Managed chat",
		titleSource: "owner",
		sourceKind: "interactive",
		createdAt: "2026-08-17T12:00:00.000Z",
		lastActivityAt: "2026-08-17T13:00:00.000Z",
		revision: 4,
		sessionCount: 1,
		bindingCount: 0,
		sessions: [
			{
				chatId: "chat-managed",
				sessionId: "session-managed",
				relationKind: "config_restart",
				ordinal: 1,
				attachedAt: "2026-08-17T12:00:00.000Z",
				executionStatus: "idle",
			},
		],
		bindings: [],
		...overrides,
	};
}

function legacyRecord(
	overrides: Partial<SessionHistoryRecord> = {},
): SessionHistoryRecord {
	return {
		sessionId: "session-legacy",
		parentSessionId: null,
		rootSessionId: "session-legacy",
		startedAt: "2026-08-17T11:00:00.000Z",
		updatedAt: "2026-08-17T12:00:00.000Z",
		status: "completed",
		source: "cli",
		provider: "test",
		model: "test",
		metadata: {
			title: "Legacy chat",
			chatCatalog: { projection: "legacy" },
		},
		...overrides,
	} as SessionHistoryRecord;
}

describe("history app item", () => {
	it("maps an Active managed projection without inventing provider fields", () => {
		const item = historyItemFromManagedProjection(managedProjection());

		expect(item).toEqual({
			target: {
				kind: "managed",
				chatId: "chat-managed",
				headSessionId: "session-managed",
				expectedRevision: 4,
				catalogState: "active",
			},
			title: "Managed chat",
			lastActivityAt: "2026-08-17T13:00:00.000Z",
			lineageKind: "config_restart",
			executionStatus: "idle",
			canResume: false,
			canArchive: true,
			canActivate: false,
			canRename: true,
			canPurge: false,
			canExport: false,
		});
		expect(Object.isFrozen(item)).toBe(true);
		expect(Object.isFrozen(item.target)).toBe(true);
		expect("provider" in item).toBe(false);
		expect("prompt" in item).toBe(false);
	});

	it("derives Archived actions from catalog state, not runtime status", () => {
		const item = historyItemFromManagedProjection(
			managedProjection({
				catalogState: "archived",
				archivedAt: "2026-08-17T14:00:00.000Z",
				sessions: [
					{
						...managedProjection().sessions[0],
						executionStatus: "failed",
					},
				],
			}),
		);

		expect(item).toMatchObject({
			executionStatus: "failed",
			canResume: false,
			canArchive: false,
			canActivate: true,
			canRename: true,
			canPurge: true,
			canExport: false,
		});
	});

	it("maps an explicit Legacy row to the read-only compatibility policy", () => {
		const item = historyItemFromLegacyRecord(
			legacyRecord({
				metadata: {
					title: "  Legacy\n chat  ",
					chatCatalog: { projection: "legacy" },
				},
			}),
		);

		expect(item).toMatchObject({
			target: { kind: "legacy", sessionId: "session-legacy" },
			title: "Legacy chat",
			executionStatus: "completed",
			canResume: false,
			canArchive: false,
			canActivate: false,
			canRename: false,
			canPurge: false,
			canExport: true,
		});
	});

	it("rejects a catalog-managed compatibility row at the Legacy mapper", () => {
		expect(() =>
			historyItemFromLegacyRecord(
				legacyRecord({
					metadata: {
						chatCatalog: {
							projection: "catalog",
							chatId: "chat-managed",
							catalogState: "active",
							headSessionId: "session-managed",
							lastActivityAt: "2026-08-17T13:00:00.000Z",
							revision: 1,
							sourceKind: "interactive",
						},
					},
				}),
			),
		).toThrow(InvalidChatHistoryItemError);
	});

	it("requires the managed head session to be present", () => {
		expect(() =>
			historyItemFromManagedProjection(managedProjection({ sessions: [] })),
		).toThrow(InvalidChatHistoryItemError);
	});

	it("sorts frozen authority items by activity with stable namespaced ties", () => {
		const managed = historyItemFromManagedProjection(managedProjection());
		const legacy = historyItemFromLegacyRecord(
			legacyRecord({ updatedAt: managed.lastActivityAt }),
		);
		const sorted = sortChatHistoryItems([legacy, managed]);

		expect(sorted.map((item) => item.target.kind)).toEqual([
			"legacy",
			"managed",
		]);
		expect(Object.isFrozen(sorted)).toBe(true);
		expect(Object.isFrozen(sorted[0])).toBe(true);
		expect(sorted[0]).not.toBe(legacy);
	});

	it("rejects duplicate authority keys instead of overwriting a row", () => {
		const item = historyItemFromLegacyRecord(legacyRecord());

		expect(() => sortChatHistoryItems([item, item])).toThrow(
			InvalidChatHistoryItemError,
		);
	});
});
