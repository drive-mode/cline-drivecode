import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatDetail } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { SqliteSessionStore } from "../services/storage/sqlite-session-store";
import { CoreSessionService } from "../session/services/session-service";
import type { SessionHistoryRecord } from "../types/sessions";
import {
	listCatalogSessionHistoryFromBackend,
	projectChatCatalogHistory,
	projectLegacyHistory,
} from "./chat-history-projection";
import { SqliteChatCatalogService } from "./sqlite-chat-catalog-service";

function row(
	sessionId: string,
	workspaceRoot = "/tmp/workspace-a",
	updatedAt = "2026-08-14T09:00:00.000Z",
): SessionHistoryRecord {
	return {
		sessionId,
		source: "cli",
		pid: 1,
		startedAt: updatedAt,
		status: "completed",
		interactive: true,
		provider: "test",
		model: "model",
		cwd: workspaceRoot,
		workspaceRoot,
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
		updatedAt,
	};
}

function chat(): ChatDetail {
	return {
		chatId: "chat-1",
		workspaceKey: "/tmp/workspace-a",
		catalogState: "archived",
		headSessionId: "successor",
		parentChatId: "source-chat",
		title: "Canonical chat title",
		titleSource: "host",
		sourceKind: "cli",
		createdAt: "2026-08-14T08:00:00.000Z",
		lastActivityAt: "2026-08-14T12:00:00.000Z",
		archivedAt: "2026-08-14T13:00:00.000Z",
		revision: 4,
		sessions: [
			{
				chatId: "chat-1",
				sessionId: "root",
				relationKind: "root",
				ordinal: 0,
				attachedAt: "2026-08-14T08:00:00.000Z",
				executionStatus: "completed",
			},
			{
				chatId: "chat-1",
				sessionId: "successor",
				relationKind: "recovery",
				parentSessionId: "root",
				ordinal: 1,
				attachedAt: "2026-08-14T09:00:00.000Z",
				executionStatus: "idle",
			},
		],
		bindings: [],
	};
}

describe("chat history projection", () => {
	it("collapses catalog members to the head, labels legacy, and suppresses tombstones", async () => {
		const detail = chat();
		const reader = {
			listChats: vi.fn().mockReturnValue({
				items: [detail],
			}),
			getChat: vi.fn().mockReturnValue(detail),
			isSessionTombstoned: vi.fn(
				(sessionId: string) => sessionId === "purged-artifact",
			),
		};
		const rows = await projectChatCatalogHistory(
			[
				row("root"),
				row("successor"),
				row("legacy", "/tmp/workspace-a", "2026-08-14T10:00:00.000Z"),
				row("purged-artifact", "/tmp/workspace-a", "2026-08-14T14:00:00.000Z"),
			],
			reader,
			{ workspaceRoot: "/tmp/workspace-a", limit: 10 },
		);

		expect(rows.map((item) => item.sessionId)).toEqual(["successor", "legacy"]);
		expect(rows[0]).toMatchObject({
			status: "idle",
			updatedAt: "2026-08-14T12:00:00.000Z",
			metadata: {
				title: "Canonical chat title",
				chatCatalog: {
					projection: "catalog",
					chatId: "chat-1",
					catalogState: "archived",
					headSessionId: "successor",
					relationKind: "recovery",
					parentSessionId: "root",
				},
			},
		});
		expect(rows[1]?.metadata?.chatCatalog).toEqual({
			projection: "legacy",
		});
	});

	it("filters canonical and legacy rows by workspace", async () => {
		const detail = chat();
		const rows = await projectChatCatalogHistory(
			[row("successor"), row("other", "/tmp/workspace-b")],
			{
				listChats: ({ workspaceKey }) => ({
					items: workspaceKey === "/tmp/workspace-a" ? [detail] : [],
				}),
				getChat: () => detail,
				isSessionTombstoned: () => false,
			},
			{ workspaceRoot: "/tmp/workspace-b" },
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			sessionId: "other",
			metadata: { chatCatalog: { projection: "legacy" } },
		});
	});

	it("loads a canonical head that falls outside the bounded legacy scan", async () => {
		const detail = chat();
		const resolveSession = vi.fn().mockReturnValue(row("successor"));
		const rows = await projectChatCatalogHistory(
			[row("legacy")],
			{
				listChats: () => ({ items: [detail] }),
				getChat: () => detail,
				isSessionTombstoned: () => false,
			},
			{ resolveSession },
		);

		expect(resolveSession).toHaveBeenCalledWith("successor");
		expect(rows.map((item) => item.sessionId)).toEqual(["successor", "legacy"]);
	});

	it("does not relabel members as Legacy while a listed chat begins deleting", async () => {
		const deleting = { ...chat(), catalogState: "deleting" as const };
		const rows = await projectChatCatalogHistory(
			[row("root"), row("successor"), row("legacy")],
			{
				listChats: () => ({ items: [chat()] }),
				getChat: () => deleting,
				isSessionTombstoned: () => false,
			},
		);

		expect(rows.map((item) => item.sessionId)).toEqual(["legacy"]);
		expect(rows[0]?.metadata?.chatCatalog).toEqual({ projection: "legacy" });
	});

	it("rejects a resolved head whose session workspace contradicts the catalog", async () => {
		const detail = chat();
		const rows = await projectChatCatalogHistory(
			[row("successor", "/tmp/workspace-b"), row("legacy")],
			{
				listChats: () => ({ items: [detail] }),
				getChat: () => detail,
				isSessionTombstoned: () => false,
			},
		);

		expect(rows.map((item) => item.sessionId)).toEqual(["legacy"]);
	});

	it("discovers unscoped catalog workspaces independently of the legacy scan", async () => {
		const detail = chat();
		const rows = await projectChatCatalogHistory(
			[row("legacy", "/tmp/workspace-b")],
			{
				listWorkspaceKeys: () => ["/tmp/workspace-a"],
				listChats: ({ workspaceKey }) => ({
					items: workspaceKey === "/tmp/workspace-a" ? [detail] : [],
				}),
				getChat: () => detail,
				isSessionTombstoned: () => false,
			},
			{ resolveSession: () => row("successor") },
		);

		expect(rows.map((item) => item.sessionId)).toEqual(["successor", "legacy"]);
	});

	it("opens the catalog from the exact backend database and tenant", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "chat-history-projection-"));
		const store = new SqliteSessionStore({
			sessionsDir: dataDir,
			tenantId: "tenant-a",
		});
		const backend = new CoreSessionService(store, {
			sessionArtifactsDir: join(dataDir, "artifacts"),
		});
		const catalog = new SqliteChatCatalogService({
			dataDir,
			tenantId: "tenant-a",
		});
		try {
			store.create(row("successor"));
			catalog.adoptRootSession({
				chatId: "chat-custom-store",
				sessionId: "successor",
				provenance: {
					invocationId: "adopt-custom-store",
					occurredAt: "2026-08-14T12:00:00.000Z",
					actor: { kind: "human", id: "tester" },
					source: { kind: "interactive", transport: "test" },
				},
			});

			const rows = await listCatalogSessionHistoryFromBackend(backend, {
				includeManifestFallback: false,
				limit: 10,
			});

			expect(rows).toHaveLength(1);
			expect(rows[0]?.metadata?.chatCatalog).toMatchObject({
				projection: "catalog",
				chatId: "chat-custom-store",
			});
		} finally {
			catalog.close();
			store.close();
			await rm(dataDir, { recursive: true, force: true });
		}
	});

	it("labels unsupported backend rows as Legacy", () => {
		expect(
			projectLegacyHistory([row("a"), row("b", "/tmp/workspace-b")], {
				workspaceRoot: "/tmp/workspace-a",
			}),
		).toEqual([
			expect.objectContaining({
				sessionId: "a",
				metadata: { chatCatalog: { projection: "legacy" } },
			}),
		]);
	});
});
