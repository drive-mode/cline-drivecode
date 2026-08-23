import type {
	HubChatLifecycleResult,
	HubChatProjectionChat,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createChatIdentityFactory } from "./chat-identities";
import {
	createManagedChatHistoryAdapter,
	InvalidManagedHistoryActionError,
} from "./managed-history-adapter";

type ManagedHistoryClient = Parameters<
	typeof createManagedChatHistoryAdapter
>[0]["client"];

function projection(
	overrides: Partial<HubChatProjectionChat> = {},
): HubChatProjectionChat {
	return {
		chatId: "chat-1",
		catalogState: "active",
		headSessionId: "session-1",
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
				chatId: "chat-1",
				sessionId: "session-1",
				relationKind: "root",
				ordinal: 0,
				attachedAt: "2026-08-17T12:00:00.000Z",
				executionStatus: "idle",
			},
		],
		bindings: [],
		...overrides,
	};
}

function detail(
	overrides: Partial<HubChatLifecycleResult<"chat_lifecycle.archive">> = {},
): HubChatLifecycleResult<"chat_lifecycle.archive"> {
	const chat = projection();
	const {
		sessionCount: _sessionCount,
		bindingCount: _bindingCount,
		...rest
	} = chat;
	return {
		...rest,
		...overrides,
	};
}

function harness() {
	const client = {
		getProjectionSnapshot: vi.fn(() => ({
			snapshotId: "snapshot-1",
			snapshotSequence: 9,
			checkpoint: 11,
			chats: [projection()],
			nextCursor: "cursor-2",
		})),
		listChats: vi.fn(async () => ({
			snapshotId: "snapshot-1",
			snapshotSequence: 9,
			chats: [projection()],
			hasMore: false,
		})),
		archiveChat: vi.fn(async () =>
			detail({
				catalogState: "archived",
				archivedAt: "2026-08-17T14:00:00.000Z",
				revision: 5,
			}),
		),
		activateChat: vi.fn(async () =>
			detail({ catalogState: "active", revision: 6 }),
		),
		renameChat: vi.fn(async (input) =>
			detail({ title: input.title, revision: 5 }),
		),
		purgeChat: vi.fn(async () => ({
			chatId: "chat-1",
			sessionIds: ["session-1"],
			applied: true,
		})),
	} satisfies ManagedHistoryClient;
	let nextId = 0;
	const identities = createChatIdentityFactory({
		createId: (prefix) => {
			nextId += 1;
			return `${prefix}${nextId}`;
		},
	});
	return {
		client,
		identities,
		adapter: createManagedChatHistoryAdapter({ client }),
	};
}

const ACTIVE_TARGET = {
	kind: "managed",
	chatId: "chat-1",
	headSessionId: "session-1",
	expectedRevision: 4,
	catalogState: "active",
} as const;

const ARCHIVED_TARGET = {
	...ACTIVE_TARGET,
	catalogState: "archived",
} as const;

describe("createManagedChatHistoryAdapter", () => {
	it("maps the reconciled client snapshot without provider-native fields", () => {
		const { adapter } = harness();
		const page = adapter.getSnapshot();

		expect(page).toMatchObject({
			snapshotId: "snapshot-1",
			snapshotSequence: 9,
			checkpoint: 11,
			nextCursor: "cursor-2",
			hasMore: true,
			items: [
				{
					target: ACTIVE_TARGET,
					title: "Managed chat",
				},
			],
		});
		expect(Object.isFrozen(page)).toBe(true);
		expect(Object.isFrozen(page.items)).toBe(true);
		expect("provider" in (page.items[0] ?? {})).toBe(false);
	});

	it("passes an opaque continuation through the same managed client", async () => {
		const { adapter, client } = harness();
		const page = await adapter.listPage({
			catalogState: "archived",
			limit: 25,
			snapshotId: "snapshot-1",
			cursor: "cursor-2",
		});

		expect(client.listChats).toHaveBeenCalledWith({
			catalogState: "archived",
			limit: 25,
			snapshotId: "snapshot-1",
			cursor: "cursor-2",
		});
		expect(page).toMatchObject({
			snapshotId: "snapshot-1",
			snapshotSequence: 9,
			hasMore: false,
		});
		expect("checkpoint" in page).toBe(false);
	});

	it("archives with the rendered revision and one retained intent", async () => {
		const { adapter, client, identities } = harness();
		const intent = identities.operation("archive");
		const item = await adapter.archive({
			intent,
			target: ACTIVE_TARGET,
			stopRunning: true,
			clearBindings: true,
		});

		expect(client.archiveChat).toHaveBeenCalledWith({
			operationId: intent.operationId,
			chatId: "chat-1",
			expectedRevision: 4,
			stopRunning: true,
			clearBindings: true,
		});
		expect(item.target).toEqual({
			...ARCHIVED_TARGET,
			expectedRevision: 5,
		});
		expect(item.canActivate).toBe(true);
	});

	it("activates only an Archived revision-bearing target", async () => {
		const { adapter, client, identities } = harness();
		const intent = identities.operation("activate");

		await adapter.activate({ intent, target: ARCHIVED_TARGET });
		expect(client.activateChat).toHaveBeenCalledWith({
			operationId: intent.operationId,
			chatId: "chat-1",
			expectedRevision: 4,
		});
		await expect(
			adapter.activate({ intent, target: ACTIVE_TARGET }),
		).rejects.toBeInstanceOf(InvalidManagedHistoryActionError);
		expect(client.activateChat).toHaveBeenCalledTimes(1);
	});

	it("renames catalog title only and trims it before dispatch", async () => {
		const { adapter, client, identities } = harness();
		const intent = identities.operation("rename");
		const item = await adapter.rename({
			intent,
			target: ACTIVE_TARGET,
			title: "  New title  ",
		});

		expect(client.renameChat).toHaveBeenCalledWith({
			operationId: intent.operationId,
			chatId: "chat-1",
			expectedRevision: 4,
			title: "New title",
		});
		expect(item.title).toBe("New title");
	});

	it("purges only Archived targets and freezes the bounded result", async () => {
		const { adapter, client, identities } = harness();
		const intent = identities.operation("purge");
		const result = await adapter.purge({
			intent,
			target: ARCHIVED_TARGET,
		});

		expect(client.purgeChat).toHaveBeenCalledWith({
			operationId: intent.operationId,
			chatId: "chat-1",
			expectedRevision: 4,
		});
		expect(result).toEqual({
			chatId: "chat-1",
			sessionIds: ["session-1"],
			applied: true,
		});
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.sessionIds)).toBe(true);
	});

	it.each([
		["another chat", { chatId: "chat-other" }],
		["another head", { headSessionId: "session-other" }],
		["a non-advancing revision", { revision: 4 }],
		["the wrong lifecycle state", { catalogState: "active" as const }],
	])("rejects an archive result for %s", async (_name, mismatch) => {
		const { adapter, client, identities } = harness();
		client.archiveChat.mockResolvedValue(
			detail({
				catalogState: "archived",
				archivedAt: "2026-08-17T14:00:00.000Z",
				revision: 5,
				...mismatch,
			}),
		);

		await expect(
			adapter.archive({
				intent: identities.operation("archive"),
				target: ACTIVE_TARGET,
			}),
		).rejects.toBeInstanceOf(InvalidManagedHistoryActionError);
	});

	it.each([
		["another chat", { chatId: "chat-other", sessionIds: ["session-1"] }],
		["a missing head", { chatId: "chat-1", sessionIds: ["session-other"] }],
		[
			"duplicate sessions",
			{ chatId: "chat-1", sessionIds: ["session-1", "session-1"] },
		],
	])("rejects a purge result for %s", async (_name, mismatch) => {
		const { adapter, client, identities } = harness();
		client.purgeChat.mockResolvedValue({ ...mismatch, applied: true });

		await expect(
			adapter.purge({
				intent: identities.operation("purge"),
				target: ARCHIVED_TARGET,
			}),
		).rejects.toBeInstanceOf(InvalidManagedHistoryActionError);
	});

	it("rejects Legacy targets and mismatched intents before client dispatch", async () => {
		const { adapter, client, identities } = harness();
		const wrongIntent = identities.operation("rename");

		await expect(
			adapter.archive({
				intent: identities.operation("archive"),
				target: {
					kind: "legacy",
					sessionId: "session-legacy",
				} as unknown as Parameters<typeof adapter.archive>[0]["target"],
			}),
		).rejects.toBeInstanceOf(InvalidManagedHistoryActionError);
		await expect(
			adapter.archive({
				intent: wrongIntent as unknown as Parameters<
					typeof adapter.archive
				>[0]["intent"],
				target: ACTIVE_TARGET,
			}),
		).rejects.toBeInstanceOf(InvalidManagedHistoryActionError);
		expect(client.archiveChat).not.toHaveBeenCalled();
	});

	it("exposes no resume, delete, local update, or export escape hatch", () => {
		const { adapter } = harness();

		expect("resume" in adapter).toBe(false);
		expect("delete" in adapter).toBe(false);
		expect("update" in adapter).toBe(false);
		expect("export" in adapter).toBe(false);
	});
});
