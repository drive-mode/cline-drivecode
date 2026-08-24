import type { HubReplyEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	HubChatProjectionClient,
	type HubChatProjectionClientTransport,
	HubChatProjectionProtocolError,
} from "./chat-projection-client";

function chat(chatId: string, lastActivityAt: string): Record<string, unknown> {
	const sessionId = `session-${chatId}`;
	return {
		chatId,
		catalogState: "active",
		headSessionId: sessionId,
		title: chatId,
		sourceKind: "interactive",
		createdAt: "2026-08-15T10:00:00.000Z",
		lastActivityAt,
		revision: 1,
		sessionCount: 1,
		bindingCount: 0,
		sessions: [
			{
				chatId,
				sessionId,
				relationKind: "root",
				ordinal: 0,
				attachedAt: "2026-08-15T10:00:00.000Z",
				executionStatus: "idle",
			},
		],
		bindings: [],
	};
}

function success(result: unknown): HubReplyEnvelope {
	return { version: "v1", ok: true, payload: { result } };
}

function fixture(replies: HubReplyEnvelope[]) {
	const command = vi.fn(
		async (
			_command: Parameters<HubChatProjectionClientTransport["command"]>[0],
			_payload?: Parameters<HubChatProjectionClientTransport["command"]>[1],
			_sessionId?: Parameters<HubChatProjectionClientTransport["command"]>[2],
			_options?: Parameters<HubChatProjectionClientTransport["command"]>[3],
		) => {
			const reply = replies.shift();
			if (!reply) throw new Error("missing test reply");
			return reply;
		},
	);
	return {
		command,
		transport: { command } satisfies HubChatProjectionClientTransport,
	};
}

describe("HubChatProjectionClient", () => {
	it("fences strict list/get commands to one registered connection", async () => {
		const first = {
			snapshotId: "snapshot-1",
			snapshotSequence: 10,
			chats: [chat("chat-a", "2026-08-15T12:00:00.000Z")],
			nextCursor: "cursor-2",
			hasMore: true,
		};
		const second = {
			...first,
			chats: [chat("chat-b", "2026-08-15T11:00:00.000Z")],
			nextCursor: undefined,
			hasMore: false,
		};
		const getResult = {
			snapshotId: "snapshot-get",
			snapshotSequence: 11,
			chat: chat("chat-a", "2026-08-15T12:00:00.000Z"),
		};
		const test = fixture([success(first), success(second), success(getResult)]);
		const client = new HubChatProjectionClient(test.transport);

		await expect(
			client.list(
				{ catalogState: "all", limit: 1 },
				{ requiredConnectionGeneration: 4 },
			),
		).resolves.toEqual(first);
		await expect(
			client.list(
				{
					catalogState: "all",
					limit: 1,
					snapshotId: "snapshot-1",
					cursor: "cursor-2",
				},
				{ requiredConnectionGeneration: 4 },
			),
		).resolves.toEqual(second);
		await expect(
			client.get({ chatId: "chat-a" }, { requiredConnectionGeneration: 4 }),
		).resolves.toEqual(getResult);
		expect(test.command).toHaveBeenNthCalledWith(
			1,
			"chat_projection.list",
			expect.objectContaining({ catalogState: "all" }),
			undefined,
			{ requiredConnectionGeneration: 4 },
		);
		expect(
			test.command.mock.calls.every(
				([name]) =>
					name === "chat_projection.list" || name === "chat_projection.get",
			),
		).toBe(true);
	});

	it("fails before transport for an unowned, repeated, or changed continuation", async () => {
		const first = {
			snapshotId: "snapshot-1",
			snapshotSequence: 10,
			chats: [chat("chat-a", "2026-08-15T12:00:00.000Z")],
			nextCursor: "cursor-2",
			hasMore: true,
		};
		const test = fixture([success(first)]);
		const client = new HubChatProjectionClient(test.transport);
		await client.list(
			{ catalogState: "all", limit: 1 },
			{ requiredConnectionGeneration: 2 },
		);

		await expect(
			client.list(
				{
					catalogState: "active",
					snapshotId: "snapshot-1",
					cursor: "cursor-2",
				},
				{ requiredConnectionGeneration: 2 },
			),
		).rejects.toBeInstanceOf(HubChatProjectionProtocolError);
		await expect(
			client.list(
				{
					catalogState: "all",
					snapshotId: "snapshot-unknown",
					cursor: "cursor-2",
				},
				{ requiredConnectionGeneration: 2 },
			),
		).rejects.toBeInstanceOf(HubChatProjectionProtocolError);
		await expect(
			client.list(
				{
					catalogState: "all",
					snapshotId: "snapshot-1",
					cursor: "cursor-2",
				},
				{ requiredConnectionGeneration: 3 },
			),
		).rejects.toThrow("connection generation");
		expect(test.command).toHaveBeenCalledTimes(1);
	});

	it("leases a continuation cursor to exactly one in-flight request", async () => {
		const first = {
			snapshotId: "snapshot-1",
			snapshotSequence: 10,
			chats: [chat("chat-a", "2026-08-15T12:00:00.000Z")],
			nextCursor: "cursor-2",
			hasMore: true,
		};
		const second = {
			...first,
			chats: [chat("chat-b", "2026-08-15T11:00:00.000Z")],
			nextCursor: undefined,
			hasMore: false,
		};
		let call = 0;
		let releaseContinuation = (_reply: HubReplyEnvelope): void => {
			throw new Error("continuation was not started");
		};
		const command = vi.fn(async (): Promise<HubReplyEnvelope> => {
			call += 1;
			if (call === 1) return success(first);
			return await new Promise<HubReplyEnvelope>((resolve) => {
				releaseContinuation = resolve;
			});
		});
		const client = new HubChatProjectionClient({ command });
		await client.list(
			{ catalogState: "all", limit: 1 },
			{ requiredConnectionGeneration: 2 },
		);
		const continuation = {
			catalogState: "all" as const,
			limit: 1,
			snapshotId: "snapshot-1",
			cursor: "cursor-2",
		};
		const firstContinuation = client.list(continuation, {
			requiredConnectionGeneration: 2,
		});
		await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));

		await expect(
			client.list(continuation, { requiredConnectionGeneration: 2 }),
		).rejects.toThrow("already in flight");
		expect(command).toHaveBeenCalledTimes(2);

		releaseContinuation(success(second));
		await expect(firstContinuation).resolves.toEqual(second);
	});

	it("rejects a changed snapshot cut and a mismatched get target", async () => {
		const first = {
			snapshotId: "snapshot-1",
			snapshotSequence: 10,
			chats: [chat("chat-a", "2026-08-15T12:00:00.000Z")],
			nextCursor: "cursor-2",
			hasMore: true,
		};
		const changed = {
			...first,
			snapshotSequence: 11,
			chats: [chat("chat-b", "2026-08-15T11:00:00.000Z")],
			nextCursor: undefined,
			hasMore: false,
		};
		const wrongTarget = {
			snapshotId: "snapshot-get",
			snapshotSequence: 11,
			chat: chat("chat-b", "2026-08-15T11:00:00.000Z"),
		};
		const test = fixture([
			success(first),
			success(changed),
			success(wrongTarget),
		]);
		const client = new HubChatProjectionClient(test.transport);
		await client.list(
			{ catalogState: "all", limit: 1 },
			{ requiredConnectionGeneration: 2 },
		);
		await expect(
			client.list(
				{
					catalogState: "all",
					limit: 1,
					snapshotId: "snapshot-1",
					cursor: "cursor-2",
				},
				{ requiredConnectionGeneration: 2 },
			),
		).rejects.toThrow("catalog cut");
		await expect(
			client.get({ chatId: "chat-a" }, { requiredConnectionGeneration: 2 }),
		).rejects.toThrow("different chat target");
	});

	it("rejects a continuation cursor that does not advance", async () => {
		const first = {
			snapshotId: "snapshot-1",
			snapshotSequence: 10,
			chats: [chat("chat-a", "2026-08-15T12:00:00.000Z")],
			nextCursor: "cursor-2",
			hasMore: true,
		};
		const repeated = {
			...first,
			chats: [chat("chat-b", "2026-08-15T11:00:00.000Z")],
		};
		const test = fixture([success(first), success(repeated)]);
		const client = new HubChatProjectionClient(test.transport);
		await client.list(
			{ catalogState: "all", limit: 1 },
			{ requiredConnectionGeneration: 2 },
		);
		await expect(
			client.list(
				{
					catalogState: "all",
					limit: 1,
					snapshotId: "snapshot-1",
					cursor: "cursor-2",
				},
				{ requiredConnectionGeneration: 2 },
			),
		).rejects.toThrow("did not advance");
	});

	it("sanitizes malformed and rejected replies", async () => {
		const malformed = fixture([
			success({
				snapshotId: "snapshot-1",
				snapshotSequence: 10,
				chats: [],
				hasMore: false,
				workspaceRoot: "/private",
			}),
		]);
		await expect(
			new HubChatProjectionClient(malformed.transport).list(
				{},
				{ requiredConnectionGeneration: 1 },
			),
		).rejects.toEqual(
			expect.objectContaining({
				name: "HubChatProjectionProtocolError",
				message: "Managed projection output failed v1 validation.",
			}),
		);

		const rejected = fixture([
			{
				version: "v1",
				ok: false,
				error: { code: "projection_denied", message: "private server text" },
			},
		]);
		await expect(
			new HubChatProjectionClient(rejected.transport).get(
				{ chatId: "chat-a" },
				{ requiredConnectionGeneration: 1 },
			),
		).rejects.toEqual(
			expect.objectContaining({
				name: "HubChatProjectionCommandError",
				code: "projection_denied",
				message: "Managed projection command was rejected.",
			}),
		);
	});

	it("rejects an invalid connection fence before transport", async () => {
		const test = fixture([]);
		await expect(
			new HubChatProjectionClient(test.transport).list(
				{},
				{ requiredConnectionGeneration: 0 },
			),
		).rejects.toThrow("connection generation");
		expect(test.command).not.toHaveBeenCalled();
	});
});
