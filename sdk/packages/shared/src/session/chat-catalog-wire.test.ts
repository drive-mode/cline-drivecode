import { describe, expect, it } from "vitest";
import { HUB_CHAT_CATALOG_COMMANDS } from "../hub";
import {
	HUB_CHAT_CATALOG_REQUEST_SCHEMAS,
	HUB_CHAT_CATALOG_RESULT_SCHEMAS,
	parseHubChatCatalogWireReply,
	parseHubChatCatalogWireRequest,
} from "./chat-catalog-wire";

describe("chat catalog v1 wire schemas", () => {
	it("defines request and result schemas for every catalog command", () => {
		expect(Object.keys(HUB_CHAT_CATALOG_REQUEST_SCHEMAS)).toEqual([
			...HUB_CHAT_CATALOG_COMMANDS,
		]);
		expect(Object.keys(HUB_CHAT_CATALOG_RESULT_SCHEMAS)).toEqual([
			...HUB_CHAT_CATALOG_COMMANDS,
		]);
	});

	it("rejects protocol drift and unknown authority-shaped payload fields", () => {
		expect(() =>
			parseHubChatCatalogWireRequest({
				version: "v2",
				command: "chat_catalog.get",
				payload: { chatId: "chat-1" },
			}),
		).toThrow();
		expect(() =>
			parseHubChatCatalogWireRequest({
				version: "v1",
				command: "chat_catalog.get",
				payload: { chatId: "chat-1", workspaceKey: "/forged" },
			}),
		).toThrow();
	});

	it("admits atomic binding clear only on confirmed archive", () => {
		const archive = {
			version: "v1" as const,
			command: "chat_catalog.archive" as const,
			payload: {
				chatId: "chat-1",
				expectedRevision: 2,
				invocationId: "archive-1",
				confirmationCredential: "confirmation-1",
				clearBindings: true,
			},
		};
		expect(parseHubChatCatalogWireRequest(archive)).toEqual(archive);
		expect(() =>
			parseHubChatCatalogWireRequest({
				...archive,
				command: "chat_catalog.activate",
			}),
		).toThrow();
	});

	it("accepts a strict revisioned rename without confirmation authority", () => {
		const rename = {
			version: "v1" as const,
			command: "chat_catalog.rename" as const,
			payload: {
				chatId: "chat-1",
				title: "Research queue",
				expectedRevision: 2,
				invocationId: "rename-1",
			},
		};
		expect(parseHubChatCatalogWireRequest(rename)).toEqual(rename);
		expect(() =>
			parseHubChatCatalogWireRequest({
				...rename,
				payload: { ...rename.payload, confirmationCredential: "forged" },
			}),
		).toThrow();
	});

	it("rejects malformed success projections and accepts strict error replies", () => {
		expect(() =>
			parseHubChatCatalogWireReply("chat_catalog.list", {
				version: "v1",
				ok: true,
				payload: { result: { items: [{ chatId: "incomplete" }] } },
			}),
		).toThrow();
		expect(
			parseHubChatCatalogWireReply("chat_catalog.list", {
				version: "v1",
				requestId: "request-1",
				ok: false,
				error: { code: "chat_not_found", message: "not found" },
			}),
		).toMatchObject({ ok: false, error: { code: "chat_not_found" } });
	});

	it("binds writer generation to lease projections, not bindings", () => {
		const lease = {
			sessionId: "session-1",
			ownerId: "owner-1",
			active: true,
			expiresAt: "2026-08-14T10:01:00.000Z",
			revision: 1,
			writerGeneration: 1,
			updatedAt: "2026-08-14T10:00:00.000Z",
		};
		expect(
			HUB_CHAT_CATALOG_RESULT_SCHEMAS["chat_catalog.lease.verify"].safeParse(
				lease,
			).success,
		).toBe(true);
		const { writerGeneration: _writerGeneration, ...leaseWithoutGeneration } =
			lease;
		expect(
			HUB_CHAT_CATALOG_RESULT_SCHEMAS["chat_catalog.lease.verify"].safeParse(
				leaseWithoutGeneration,
			).success,
		).toBe(false);

		const bindingMutation = {
			receipt: {
				invocationId: "bind-1",
				operation: "bind_chat",
				aggregateKind: "binding",
				aggregateId: "binding-1",
				applied: true,
				replayed: false,
				resultingRevision: 1,
			},
			current: {
				bindingId: "binding-1",
				transport: "slack",
				instanceId: "instance-1",
				channelId: "channel-1",
				threadId: "thread-1",
				participantScope: "all",
				bound: true,
				chatId: "chat-1",
				sessionId: "session-1",
				revision: 1,
				updatedAt: "2026-08-14T10:00:00.000Z",
			},
		};
		expect(
			HUB_CHAT_CATALOG_RESULT_SCHEMAS["chat_catalog.bind"].safeParse(
				bindingMutation,
			).success,
		).toBe(true);
		expect(
			HUB_CHAT_CATALOG_RESULT_SCHEMAS["chat_catalog.bind"].safeParse({
				...bindingMutation,
				current: { ...bindingMutation.current, writerGeneration: 1 },
			}).success,
		).toBe(false);
	});
});
