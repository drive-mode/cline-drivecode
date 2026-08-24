import type { SessionHistoryRecord } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	assertLegacyChatHistoryTarget,
	assertManagedChatHistoryTarget,
	chatHistoryTargetKey,
	historyTargetFromManagedProjection,
	historyTargetFromSessionRecord,
	InvalidChatHistoryTargetError,
	isManagedChatHistoryTarget,
	sessionHistoryRecordTargetKey,
} from "./history-target";

function historyRow(
	overrides: Partial<SessionHistoryRecord> = {},
): SessionHistoryRecord {
	return {
		sessionId: "session-1",
		parentSessionId: null,
		rootSessionId: "session-1",
		startedAt: "2026-08-17T12:00:00.000Z",
		updatedAt: "2026-08-17T12:00:00.000Z",
		status: "completed",
		source: "cli",
		provider: "test",
		model: "test",
		...overrides,
	} as SessionHistoryRecord;
}

describe("historyTargetFromSessionRecord", () => {
	it("preserves the complete revision-bound managed target", () => {
		const target = historyTargetFromSessionRecord(
			historyRow({
				sessionId: "stale-row-session",
				metadata: {
					chatCatalog: {
						projection: "catalog",
						chatId: "chat-1",
						catalogState: "archived",
						headSessionId: "session-head",
						lastActivityAt: "2026-08-17T13:00:00.000Z",
						revision: 7,
						sourceKind: "interactive",
					},
				},
			}),
		);

		expect(target).toEqual({
			kind: "managed",
			chatId: "chat-1",
			headSessionId: "session-head",
			expectedRevision: 7,
			catalogState: "archived",
		});
		expect(Object.isFrozen(target)).toBe(true);
		expect(isManagedChatHistoryTarget(target)).toBe(true);
		expect(chatHistoryTargetKey(target)).toBe("managed:chat-1");
	});

	it("constructs the same target directly from the strict managed projection", () => {
		const target = historyTargetFromManagedProjection({
			chatId: "chat-managed",
			catalogState: "active",
			headSessionId: "session-managed",
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
					relationKind: "root",
					ordinal: 0,
					attachedAt: "2026-08-17T12:00:00.000Z",
					executionStatus: "idle",
				},
			],
			bindings: [],
		});

		expect(target).toEqual({
			kind: "managed",
			chatId: "chat-managed",
			headSessionId: "session-managed",
			expectedRevision: 4,
			catalogState: "active",
		});
		expect(Object.isFrozen(target)).toBe(true);
	});

	it("keeps explicit and pre-catalog compatibility rows Legacy", () => {
		const explicit = historyTargetFromSessionRecord(
			historyRow({
				metadata: { chatCatalog: { projection: "legacy" } },
			}),
		);
		const preCatalog = historyTargetFromSessionRecord(historyRow());

		expect(explicit).toEqual({
			kind: "legacy",
			sessionId: "session-1",
		});
		expect(preCatalog).toEqual(explicit);
		expect(Object.isFrozen(explicit)).toBe(true);
		expect(isManagedChatHistoryTarget(explicit)).toBe(false);
		expect(chatHistoryTargetKey(explicit)).toBe("legacy:session-1");
	});

	it("keys managed successors by stable chat identity", () => {
		const first = historyRow({
			sessionId: "session-1",
			metadata: {
				chatCatalog: {
					projection: "catalog",
					chatId: "chat-1",
					catalogState: "active",
					headSessionId: "session-1",
					lastActivityAt: "2026-08-17T12:00:00.000Z",
					revision: 1,
					sourceKind: "interactive",
				},
			},
		});
		const successor = historyRow({
			sessionId: "session-2",
			metadata: {
				chatCatalog: {
					projection: "catalog",
					chatId: "chat-1",
					catalogState: "active",
					headSessionId: "session-2",
					lastActivityAt: "2026-08-17T13:00:00.000Z",
					revision: 2,
					sourceKind: "interactive",
					relationKind: "config_restart",
				},
			},
		});

		expect(sessionHistoryRecordTargetKey(first)).toBe(
			sessionHistoryRecordTargetKey(successor),
		);
	});

	it.each([
		{
			name: "empty chat identity",
			chatId: "",
			headSessionId: "session-1",
			revision: 1,
			catalogState: "active",
		},
		{
			name: "padded head identity",
			chatId: "chat-1",
			headSessionId: " session-1",
			revision: 1,
			catalogState: "active",
		},
		{
			name: "unsafe revision",
			chatId: "chat-1",
			headSessionId: "session-1",
			revision: Number.MAX_SAFE_INTEGER + 1,
			catalogState: "active",
		},
		{
			name: "deleting lifecycle",
			chatId: "chat-1",
			headSessionId: "session-1",
			revision: 1,
			catalogState: "deleting",
		},
	])("rejects $name instead of downgrading it to Legacy", (projection) => {
		const row = historyRow({
			metadata: {
				chatCatalog: {
					projection: "catalog",
					lastActivityAt: "2026-08-17T12:00:00.000Z",
					sourceKind: "interactive",
					...projection,
				} as NonNullable<
					NonNullable<SessionHistoryRecord["metadata"]>["chatCatalog"]
				>,
			},
		});

		expect(() => historyTargetFromSessionRecord(row)).toThrow(
			InvalidChatHistoryTargetError,
		);
	});

	it("rejects an empty Legacy identity", () => {
		expect(() =>
			historyTargetFromSessionRecord(historyRow({ sessionId: "" })),
		).toThrow(InvalidChatHistoryTargetError);
	});

	it.each([
		["null catalog metadata", null],
		["undefined catalog metadata", undefined],
		["unknown catalog discriminator", { projection: "future" }],
		[
			"hybrid Legacy/catalog metadata",
			{
				projection: "legacy",
				chatId: "chat-1",
				headSessionId: "session-1",
			},
		],
	])("rejects %s instead of downgrading it", (_name, chatCatalog) => {
		expect(() =>
			historyTargetFromSessionRecord(
				historyRow({
					metadata: {
						chatCatalog,
					} as unknown as SessionHistoryRecord["metadata"],
				}),
			),
		).toThrow(InvalidChatHistoryTargetError);
	});

	it.each(["../managed", "a".repeat(513)])(
		"rejects the unsafe imported Legacy identity %s",
		(sessionId) => {
			expect(() =>
				historyTargetFromSessionRecord(historyRow({ sessionId })),
			).toThrow(InvalidChatHistoryTargetError);
		},
	);

	it("rejects unsafe imported managed identities", () => {
		expect(() =>
			assertManagedChatHistoryTarget({
				kind: "managed",
				chatId: "../chat",
				headSessionId: "session-1",
				expectedRevision: 3,
				catalogState: "active",
			}),
		).toThrow(InvalidChatHistoryTargetError);
	});

	it("revalidates a managed target at an action boundary", () => {
		const target = assertManagedChatHistoryTarget({
			kind: "managed",
			chatId: "chat-1",
			headSessionId: "session-1",
			expectedRevision: 3,
			catalogState: "active",
		});

		expect(target).toEqual({
			kind: "managed",
			chatId: "chat-1",
			headSessionId: "session-1",
			expectedRevision: 3,
			catalogState: "active",
		});
		expect(Object.isFrozen(target)).toBe(true);
		expect(() =>
			assertManagedChatHistoryTarget({
				...target,
				expectedRevision: Number.NaN,
			}),
		).toThrow(InvalidChatHistoryTargetError);
	});

	it("revalidates a Legacy target without accepting managed identity", () => {
		expect(
			assertLegacyChatHistoryTarget({
				kind: "legacy",
				sessionId: "session-legacy",
			}),
		).toEqual({ kind: "legacy", sessionId: "session-legacy" });
		expect(() =>
			assertLegacyChatHistoryTarget({
				kind: "managed",
				sessionId: "session-legacy",
			}),
		).toThrow(InvalidChatHistoryTargetError);
	});
});
