import type { SessionHistoryRecord } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import type { LegacyChatHistoryTarget } from "./history-target";
import { createLegacyChatHistoryAdapter } from "./legacy-history-adapter";

function historyRow(
	overrides: Partial<SessionHistoryRecord> = {},
): SessionHistoryRecord {
	return {
		sessionId: "session-legacy",
		parentSessionId: null,
		rootSessionId: "session-legacy",
		startedAt: "2026-08-17T12:00:00.000Z",
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

describe("createLegacyChatHistoryAdapter", () => {
	it("returns only frozen Legacy compatibility rows", async () => {
		const legacy = historyRow();
		const managed = historyRow({
			sessionId: "session-managed",
			metadata: {
				title: "Managed chat",
				chatCatalog: {
					projection: "catalog",
					chatId: "chat-managed",
					catalogState: "active",
					headSessionId: "session-managed",
					lastActivityAt: "2026-08-17T13:00:00.000Z",
					revision: 2,
					sourceKind: "interactive",
				},
			},
		});
		const listSessions = vi.fn(async () => [legacy, managed]);
		const adapter = createLegacyChatHistoryAdapter({
			listSessions,
			exportSession: vi.fn(),
			resolveSessionAuthority: vi.fn(),
		});

		const page = await adapter.list({
			limit: 25,
			workspaceRoot: "/workspace",
			hydrate: true,
		});

		expect(listSessions).toHaveBeenCalledWith(25, {
			workspaceRoot: "/workspace",
			hydrate: true,
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]).toMatchObject({
			target: { kind: "legacy", sessionId: "session-legacy" },
			title: "Legacy chat",
			canResume: false,
			canExport: true,
		});
		expect(Object.isFrozen(page)).toBe(true);
		expect(Object.isFrozen(page.items)).toBe(true);
		expect(Object.isFrozen(page.items[0])).toBe(true);
		expect(Object.isFrozen(page.items[0]?.target)).toBe(true);
		expect("record" in (page.items[0] ?? {})).toBe(false);
	});

	it("fails malformed catalog-shaped input instead of exposing it as Legacy", async () => {
		const malformed = historyRow({
			metadata: {
				chatCatalog: {
					projection: "catalog",
					chatId: "",
					catalogState: "active",
					headSessionId: "session-managed",
					lastActivityAt: "2026-08-17T13:00:00.000Z",
					revision: 2,
					sourceKind: "interactive",
				},
			},
		});
		const adapter = createLegacyChatHistoryAdapter({
			listSessions: vi.fn(async () => [malformed]),
			exportSession: vi.fn(),
			resolveSessionAuthority: vi.fn(),
		});

		await expect(adapter.list()).rejects.toMatchObject({
			code: "invalid_history_target",
		});
	});

	it("rejects invalid page sizes before local history access", async () => {
		const listSessions = vi.fn();
		const adapter = createLegacyChatHistoryAdapter({
			listSessions,
			exportSession: vi.fn(),
			resolveSessionAuthority: vi.fn(),
		});

		for (const limit of [0, 101, Number.NaN, 1.5]) {
			await expect(adapter.list({ limit })).rejects.toThrow(
				"Legacy history page size is invalid.",
			);
		}
		expect(listSessions).not.toHaveBeenCalled();
	});

	it("exports only an explicit Legacy target", async () => {
		const exportSession = vi.fn(async () => "/tmp/session-legacy.html");
		const resolveSessionAuthority = vi.fn(async () => ({
			kind: "legacy" as const,
			sessionId: "session-legacy",
		}));
		const adapter = createLegacyChatHistoryAdapter({
			listSessions: vi.fn(),
			exportSession,
			resolveSessionAuthority,
		});
		const target = Object.freeze({
			kind: "legacy",
			sessionId: "session-legacy",
		}) satisfies LegacyChatHistoryTarget;

		await expect(
			adapter.export({
				target,
				format: "html",
				outputDirectory: "/tmp",
			}),
		).resolves.toBe("/tmp/session-legacy.html");
		expect(resolveSessionAuthority).toHaveBeenCalledWith("session-legacy");
		expect(exportSession).toHaveBeenCalledWith({
			sessionId: "session-legacy",
			format: "html",
			outputPath: undefined,
			outputDirectory: "/tmp",
		});
	});

	it("rejects a forged managed target before export access", async () => {
		const exportSession = vi.fn();
		const adapter = createLegacyChatHistoryAdapter({
			listSessions: vi.fn(),
			exportSession,
			resolveSessionAuthority: vi.fn(),
		});
		const forged = {
			kind: "managed",
			chatId: "chat-managed",
			headSessionId: "session-managed",
			expectedRevision: 2,
			catalogState: "active",
		} as unknown as LegacyChatHistoryTarget;

		await expect(
			adapter.export({ target: forged, format: "html" }),
		).rejects.toMatchObject({ code: "invalid_history_target" });
		expect(exportSession).not.toHaveBeenCalled();
	});

	it("rejects a managed session relabeled as Legacy at action admission", async () => {
		const exportSession = vi.fn();
		const resolveSessionAuthority = vi.fn(async () => ({
			kind: "managed" as const,
			chatId: "chat-managed",
			headSessionId: "session-managed",
			expectedRevision: 2,
			catalogState: "active" as const,
		}));
		const adapter = createLegacyChatHistoryAdapter({
			listSessions: vi.fn(),
			exportSession,
			resolveSessionAuthority,
		});

		await expect(
			adapter.export({
				target: { kind: "legacy", sessionId: "session-managed" },
				format: "html",
			}),
		).rejects.toMatchObject({ code: "invalid_history_target" });
		expect(resolveSessionAuthority).toHaveBeenCalledWith("session-managed");
		expect(exportSession).not.toHaveBeenCalled();
	});

	it("rejects missing or changed Legacy authority before artifact access", async () => {
		const exportSession = vi.fn();
		const resolveSessionAuthority = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({
				kind: "legacy",
				sessionId: "session-other",
			});
		const adapter = createLegacyChatHistoryAdapter({
			listSessions: vi.fn(),
			exportSession,
			resolveSessionAuthority,
		});
		const action = {
			target: { kind: "legacy", sessionId: "session-legacy" } as const,
			format: "html" as const,
		};

		await expect(adapter.export(action)).rejects.toMatchObject({
			code: "invalid_history_target",
		});
		await expect(adapter.export(action)).rejects.toMatchObject({
			code: "invalid_history_target",
		});
		expect(exportSession).not.toHaveBeenCalled();
	});
});
