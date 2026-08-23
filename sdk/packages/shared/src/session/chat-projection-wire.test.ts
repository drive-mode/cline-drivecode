import { describe, expect, it } from "vitest";
import { HUB_CHAT_PROJECTION_COMMANDS } from "../hub";
import {
	HUB_CHAT_PROJECTION_REQUEST_SCHEMAS,
	HUB_CHAT_PROJECTION_RESULT_SCHEMAS,
	parseHubChatProjectionWireReply,
	parseHubChatProjectionWireRequest,
	parseHubChatProjectionWireResult,
} from "./chat-projection-wire";

const ACTIVE_CHAT = {
	chatId: "chat-active",
	catalogState: "active",
	headSessionId: "session-active",
	title: "Active chat",
	titleSource: "owner",
	sourceKind: "interactive",
	createdAt: "2026-08-15T10:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	revision: 2,
	sessionCount: 1,
	bindingCount: 1,
	sessions: [
		{
			chatId: "chat-active",
			sessionId: "session-active",
			relationKind: "root",
			ordinal: 0,
			attachedAt: "2026-08-15T10:00:00.000Z",
			executionStatus: "idle",
		},
	],
	bindings: [
		{
			bindingId: "binding-active",
			transport: "slack",
			instanceId: "installation-1",
			channelId: "channel-1",
			threadId: "thread-1",
			participantScope: "participant-1",
			bound: true,
			chatId: "chat-active",
			sessionId: "session-active",
			revision: 1,
			updatedAt: "2026-08-15T12:00:00.000Z",
		},
	],
} as const;

const ARCHIVED_CHAT = {
	...ACTIVE_CHAT,
	chatId: "chat-archived",
	catalogState: "archived",
	headSessionId: "session-archived",
	title: "Archived chat",
	lastActivityAt: "2026-08-15T11:00:00.000Z",
	archivedAt: "2026-08-15T11:30:00.000Z",
	revision: 3,
	bindingCount: 0,
	sessions: [
		{
			...ACTIVE_CHAT.sessions[0],
			chatId: "chat-archived",
			sessionId: "session-archived",
		},
	],
	bindings: [],
} as const;

const LIST_RESULT = {
	snapshotId: "snapshot-1",
	snapshotSequence: 42,
	chats: [ACTIVE_CHAT, ARCHIVED_CHAT],
	nextCursor: "cursor-2",
	hasMore: true,
} as const;

describe("managed chat projection wire", () => {
	it("keeps the public request and result schema sets exhaustive", () => {
		expect(Object.keys(HUB_CHAT_PROJECTION_REQUEST_SCHEMAS)).toEqual([
			...HUB_CHAT_PROJECTION_COMMANDS,
		]);
		expect(Object.keys(HUB_CHAT_PROJECTION_RESULT_SCHEMAS)).toEqual([
			...HUB_CHAT_PROJECTION_COMMANDS,
		]);
	});

	it("accepts only bounded list/get requests and inseparable page cursors", () => {
		expect(
			parseHubChatProjectionWireRequest({
				version: "v1",
				command: "chat_projection.list",
				payload: { catalogState: "all", limit: 50 },
			}),
		).toEqual({
			version: "v1",
			command: "chat_projection.list",
			payload: { catalogState: "all", limit: 50 },
		});
		expect(
			parseHubChatProjectionWireRequest({
				version: "v1",
				command: "chat_projection.list",
				payload: {
					catalogState: "all",
					limit: 50,
					snapshotId: "snapshot-1",
					cursor: "cursor-2",
				},
			}),
		).toMatchObject({ command: "chat_projection.list" });
		expect(() =>
			parseHubChatProjectionWireRequest({
				version: "v1",
				command: "chat_projection.list",
				payload: { cursor: "cursor-2" },
			}),
		).toThrow();
		expect(() =>
			parseHubChatProjectionWireRequest({
				version: "v1",
				command: "chat_catalog.list",
				payload: {},
			}),
		).toThrow();
	});

	it("validates a sanitized stable-order snapshot and strict reply", () => {
		expect(
			parseHubChatProjectionWireResult("chat_projection.list", LIST_RESULT),
		).toEqual(LIST_RESULT);
		expect(
			parseHubChatProjectionWireReply("chat_projection.list", {
				version: "v1",
				requestId: "request-1",
				ok: true,
				payload: { result: LIST_RESULT },
			}),
		).toMatchObject({ ok: true });
		expect(
			parseHubChatProjectionWireResult("chat_projection.get", {
				snapshotId: "snapshot-get",
				snapshotSequence: 43,
				chat: ACTIVE_CHAT,
			}),
		).toMatchObject({ chat: { chatId: "chat-active" } });
	});

	it("rejects unstable ordering, broken lineage, and inconsistent continuation", () => {
		expect(() =>
			parseHubChatProjectionWireResult("chat_projection.list", {
				...LIST_RESULT,
				chats: [ARCHIVED_CHAT, ACTIVE_CHAT],
			}),
		).toThrow();
		expect(() =>
			parseHubChatProjectionWireResult("chat_projection.list", {
				...LIST_RESULT,
				nextCursor: undefined,
			}),
		).toThrow();
		expect(() =>
			parseHubChatProjectionWireResult("chat_projection.list", {
				...LIST_RESULT,
				chats: [],
			}),
		).toThrow();
		expect(() =>
			parseHubChatProjectionWireResult("chat_projection.get", {
				snapshotId: "snapshot-get",
				snapshotSequence: 43,
				chat: { ...ACTIVE_CHAT, headSessionId: "session-missing" },
			}),
		).toThrow();
	});

	it("rejects paths, authority, credentials, transcripts, and unknown fields", () => {
		for (const forbidden of [
			{ workspaceKey: "/private/workspace" },
			{ workspaceRoot: "/private/workspace" },
			{ audienceId: "audience-secret" },
			{ authorityClassId: "interactive" },
			{ leaseToken: "secret" },
			{ prompt: "private prompt" },
			{ transcript: "private transcript" },
			{ providerConfig: { apiKey: "secret" } },
		]) {
			expect(() =>
				parseHubChatProjectionWireResult("chat_projection.get", {
					snapshotId: "snapshot-get",
					snapshotSequence: 43,
					chat: { ...ACTIVE_CHAT, ...forbidden },
				}),
			).toThrow();
		}
	});
});
