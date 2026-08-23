import { describe, expect, it, vi } from "vitest";
import {
	assertChatCatalogId,
	assertChatOperationIntent,
	assertChatSessionId,
	CHAT_OPERATION_KINDS,
	createChatIdentityFactory,
	InvalidChatIdentityError,
} from "./chat-identities";

describe("createChatIdentityFactory", () => {
	it("creates branded operation, session, and chat identities with explicit purposes", () => {
		const createId = vi.fn((prefix: string) => `${prefix}stable-id`);
		const factory = createChatIdentityFactory({ createId });

		const operation = factory.operation("config_restart");
		const sessionId = factory.session();
		const chatId = factory.chat();

		expect(operation).toEqual({
			kind: "config_restart",
			operationId: "cli_chat_config_restart_stable-id",
		});
		expect(sessionId).toBe("cli_session_stable-id");
		expect(chatId).toBe("cli_catalog_chat_stable-id");
		expect(createId.mock.calls).toEqual([
			["cli_chat_config_restart_"],
			["cli_session_"],
			["cli_catalog_chat_"],
		]);
		expect(Object.isFrozen(factory)).toBe(true);
		expect(Object.isFrozen(operation)).toBe(true);
	});

	it("supports every closed operation kind", () => {
		const prefixes: string[] = [];
		const factory = createChatIdentityFactory({
			createId: (prefix) => {
				prefixes.push(prefix);
				return `${prefix}${prefixes.length}`;
			},
		});

		for (const kind of CHAT_OPERATION_KINDS) factory.operation(kind);

		expect(prefixes).toEqual(
			CHAT_OPERATION_KINDS.map((kind) => `cli_chat_${kind}_`),
		);
	});

	it.each(["", " padded", "x".repeat(513)])(
		"rejects malformed generated identity %j",
		(generated) => {
			const factory = createChatIdentityFactory({
				createId: () => generated,
			});

			expect(() => factory.operation("turn")).toThrow(InvalidChatIdentityError);
			expect(() => factory.session()).toThrow(InvalidChatIdentityError);
			expect(() => factory.chat()).toThrow(InvalidChatIdentityError);
		},
	);

	it.each(["../session", "session/child", ".", ".."])(
		"rejects path-unsafe generated session and chat identity %j",
		(generated) => {
			const factory = createChatIdentityFactory({
				createId: () => generated,
			});

			expect(() => factory.session()).toThrow(InvalidChatIdentityError);
			expect(() => factory.chat()).toThrow(InvalidChatIdentityError);
		},
	);

	it("revalidates imported identities and returns frozen retained intents", () => {
		const intent = assertChatOperationIntent(
			{ kind: "turn", operationId: "turn-1" },
			"turn",
		);

		expect(intent).toEqual({ kind: "turn", operationId: "turn-1" });
		expect(Object.isFrozen(intent)).toBe(true);
		expect(assertChatSessionId("session-1")).toBe("session-1");
		expect(assertChatCatalogId("chat-1")).toBe("chat-1");
		expect(() =>
			assertChatOperationIntent(
				{ kind: "abort", operationId: "turn-1" },
				"turn",
			),
		).toThrow(InvalidChatIdentityError);
		expect(() => assertChatSessionId("../session")).toThrow(
			InvalidChatIdentityError,
		);
	});

	it("rejects an unknown runtime operation kind before generating an ID", () => {
		const createId = vi.fn(() => "unreachable");
		const factory = createChatIdentityFactory({ createId });

		expect(() =>
			factory.operation("delete" as Parameters<typeof factory.operation>[0]),
		).toThrow(InvalidChatIdentityError);
		expect(createId).not.toHaveBeenCalled();
	});
});
