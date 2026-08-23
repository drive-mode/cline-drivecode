import { HUB_CHAT_RUNTIME_RESULT_SCHEMAS, type Message } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	InvalidLegacyMessageProjectionError,
	projectLegacyMessagePage,
} from "./legacy-message-projection";

function asMessage(value: unknown): Message {
	return value as Message;
}

describe("projectLegacyMessagePage", () => {
	it("projects stable, frozen display messages through the strict wire schema", () => {
		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [
				asMessage({
					id: "SECRET_SOURCE_MESSAGE_ID",
					role: "assistant",
					ts: Date.parse("2026-08-17T12:00:00.000Z"),
					content: [
						{ type: "text", text: "first" },
						{ type: "text", text: "second" },
					],
				}),
			],
		});

		expect(page).toEqual({
			sessionId: "session-legacy",
			messages: [
				{
					messageId: "legacy-message-3-0",
					sequence: 0,
					role: "assistant",
					timestamp: "2026-08-17T12:00:00.000Z",
					text: "first\nsecond",
					attachments: [],
				},
			],
			hasMore: false,
		});
		expect(() =>
			HUB_CHAT_RUNTIME_RESULT_SCHEMAS["chat_runtime.messages.list"].parse(page),
		).not.toThrow();
		expect(Object.isFrozen(page)).toBe(true);
		expect(Object.isFrozen(page.messages)).toBe(true);
		expect(Object.isFrozen(page.messages[0])).toBe(true);
		expect(Object.isFrozen(page.messages[0]?.attachments)).toBe(true);
		expect(JSON.stringify(page)).not.toContain("SECRET_SOURCE_MESSAGE_ID");
	});

	it("never copies paths, file/image bodies, tool payloads/results, or reasoning", () => {
		const cyclicInput: Record<string, unknown> = {
			credential: "SECRET_TOOL_INPUT",
		};
		cyclicInput.self = cyclicInput;
		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [
				asMessage({
					id: "SECRET_SOURCE_MESSAGE_ID",
					agent: "SECRET_AGENT_ID",
					sessionId: "SECRET_SOURCE_SESSION_ID",
					metadata: { token: "SECRET_METADATA" },
					modelInfo: {
						id: "SECRET_MODEL_ID",
						provider: "SECRET_PROVIDER_ID",
					},
					metrics: { cost: 123_456 },
					role: "assistant",
					content: [
						{
							type: "file",
							path: "/SECRET_ABSOLUTE_PATH",
							content: "SECRET_FILE_BODY",
							source: "SECRET_FILE_SOURCE",
						},
						{
							type: "image",
							data: "SECRET_IMAGE_DATA",
							mediaType: "image/png",
						},
						{
							type: "thinking",
							thinking: "SECRET_REASONING",
							signature: "SECRET_THOUGHT_SIGNATURE",
							details: [{ secret: "SECRET_REASONING_DETAIL" }],
						},
						{
							type: "redacted_thinking",
							data: "SECRET_REDACTED_DATA",
						},
						{
							type: "tool_use",
							id: "SECRET_TOOL_CALL_ID",
							call_id: "SECRET_PROVIDER_CALL_ID",
							name: "SECRET_TOOL_NAME",
							input: cyclicInput,
							signature: "SECRET_TOOL_SIGNATURE",
						},
						{
							type: "tool_result",
							tool_use_id: "tool-call-1",
							name: "read_file",
							content: [
								{ type: "text", text: "SECRET_TOOL_RESULT" },
								{
									type: "file",
									path: "/SECRET_RESULT_PATH",
									content: "SECRET_RESULT_FILE",
								},
							],
						},
					],
				}),
			],
		});

		expect(page.messages[0]).toEqual({
			messageId: "legacy-message-3-0",
			sequence: 0,
			role: "tool",
			text: "",
			attachments: [{ kind: "file" }, { kind: "image" }],
			tool: {
				toolCallId: "legacy-tool-3-0-4",
				toolName: "tool",
				status: "started",
			},
		});
		const serialized = JSON.stringify(page);
		for (const secret of [
			"SECRET_ABSOLUTE_PATH",
			"SECRET_FILE_BODY",
			"SECRET_FILE_SOURCE",
			"SECRET_IMAGE_DATA",
			"SECRET_REASONING",
			"SECRET_THOUGHT_SIGNATURE",
			"SECRET_REASONING_DETAIL",
			"SECRET_REDACTED_DATA",
			"SECRET_PROVIDER_CALL_ID",
			"SECRET_SOURCE_MESSAGE_ID",
			"SECRET_AGENT_ID",
			"SECRET_SOURCE_SESSION_ID",
			"SECRET_METADATA",
			"SECRET_MODEL_ID",
			"SECRET_PROVIDER_ID",
			"SECRET_TOOL_CALL_ID",
			"SECRET_TOOL_NAME",
			"SECRET_TOOL_INPUT",
			"SECRET_TOOL_SIGNATURE",
			"SECRET_TOOL_RESULT",
			"SECRET_RESULT_PATH",
			"SECRET_RESULT_FILE",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});

	it("projects a tool result as bounded status without retaining its body", () => {
		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [
				asMessage({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "result-1",
							name: "shell",
							content: "SECRET_STDOUT",
							is_error: true,
						},
					],
				}),
			],
		});

		expect(page.messages[0]).toMatchObject({
			role: "tool",
			text: "",
			tool: {
				toolCallId: "legacy-tool-3-0-0",
				toolName: "tool",
				status: "failed",
			},
		});
		expect(JSON.stringify(page)).not.toContain("SECRET_STDOUT");
	});

	it("paginates with absolute sequence numbers and a closed cursor grammar", () => {
		const messages = Array.from({ length: 4 }, (_, index) =>
			asMessage({ role: "user", content: `message ${index}` }),
		);
		const first = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages,
			limit: 2,
		});
		const second = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages,
			cursor: first.nextCursor,
			limit: 2,
		});

		expect(first.messages.map((message) => message.sequence)).toEqual([0, 1]);
		expect(first.hasMore).toBe(true);
		expect(first.nextCursor).toMatch(/^legacy-message-3-2-[a-f0-9]{16}$/);
		expect(second.messages.map((message) => message.sequence)).toEqual([2, 3]);
		expect(second).toMatchObject({ hasMore: false });
		expect(second.nextCursor).toBeUndefined();
		const nextGeneration = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 4,
			messages,
			limit: 1,
		});
		expect(nextGeneration.messages[0]?.messageId).toBe("legacy-message-4-0");
		expect(() =>
			projectLegacyMessagePage({
				sessionId: "session-legacy",
				generation: 4,
				messages,
				cursor: first.nextCursor,
			}),
		).toThrow(InvalidLegacyMessageProjectionError);
		expect(() =>
			projectLegacyMessagePage({
				sessionId: "session-other",
				generation: 3,
				messages,
				cursor: first.nextCursor,
			}),
		).toThrow(InvalidLegacyMessageProjectionError);
	});

	it("stops at the page byte budget without skipping the next sequence", () => {
		const messages = Array.from({ length: 4 }, () =>
			asMessage({ role: "assistant", content: "x".repeat(192 * 1024) }),
		);
		const first = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages,
			limit: 4,
		});
		const second = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages,
			cursor: first.nextCursor,
			limit: 4,
		});

		expect(first.messages.map((message) => message.sequence)).toEqual([
			0, 1, 2,
		]);
		expect(first.nextCursor).toMatch(/^legacy-message-3-3-[a-f0-9]{16}$/);
		expect(second.messages.map((message) => message.sequence)).toEqual([3]);
		expect(second.hasMore).toBe(false);
	});

	it("bounds UTF-8 text and attachment summaries before schema validation", () => {
		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [
				asMessage({
					role: "user",
					content: [
						{ type: "text", text: "🧪".repeat(100_000) },
						...Array.from({ length: 20 }, () => ({
							type: "image",
							data: "SECRET_IMAGE",
							mediaType: "image/png",
						})),
					],
				}),
			],
		});

		expect(new TextEncoder().encode(page.messages[0]?.text).byteLength).toBe(
			192 * 1024,
		);
		expect(page.messages[0]?.attachments).toHaveLength(12);
		expect(JSON.stringify(page)).not.toContain("SECRET_IMAGE");
	});

	it("detaches output and omits finite timestamps outside the Date range", () => {
		const source = asMessage({
			role: "user",
			ts: 8.64e15 + 1,
			content: [{ type: "text", text: "before" }],
		});
		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [source],
		});
		const sourceBlock = (
			source.content as Array<{ type: "text"; text: string }>
		)[0];
		if (!sourceBlock)
			throw new Error("message projection test fixture is invalid");
		sourceBlock.text = "after";

		expect(page.messages[0]?.text).toBe("before");
		expect(page.messages[0]?.timestamp).toBeUndefined();
		expect(Object.isFrozen(page.messages[0])).toBe(true);
	});

	it("rejects invalid identity and pagination with a fixed error", () => {
		const valid = [asMessage({ role: "user", content: "hello" })];
		const invalidInputs = [
			{ sessionId: "../secret", generation: 3, messages: valid },
			{
				sessionId: "session-legacy",
				generation: 3,
				messages: valid,
				cursor: "offset-01",
			},
			{
				sessionId: "session-legacy",
				generation: 3,
				messages: valid,
				cursor: "SECRET_CURSOR",
			},
			{ sessionId: "session-legacy", generation: 3, messages: valid, limit: 0 },
			{
				sessionId: "session-legacy",
				generation: 3,
				messages: valid,
				limit: 201,
			},
			{ sessionId: "session-legacy", generation: -1, messages: valid },
		];

		for (const input of invalidInputs) {
			let caught: unknown;
			try {
				projectLegacyMessagePage(input);
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(InvalidLegacyMessageProjectionError);
			expect(caught).toMatchObject({
				code: "invalid_legacy_message_projection",
				message: "Legacy messages cannot be projected for interactive display.",
			});
			expect(String(caught)).not.toContain("SECRET");
		}
	});

	it("substitutes static notices for malformed messages without invoking data getters", () => {
		let getterCalls = 0;
		const accessorMessage = { role: "user" } as Record<string, unknown>;
		Object.defineProperty(accessorMessage, "content", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return "SECRET_GETTER";
			},
		});
		class ExoticMessage {
			role = "user";
			content = "SECRET_CLASS";
		}
		const hostileProxy = new Proxy(
			{ role: "user", content: "SECRET_PROXY" },
			{
				getPrototypeOf() {
					throw new Error("SECRET_PROXY_TRAP");
				},
			},
		);

		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [
				accessorMessage,
				new ExoticMessage(),
				hostileProxy,
				asMessage({ role: "notice", content: "SECRET_ROLE" }),
				asMessage({
					role: "user",
					content: Array.from({ length: 65 }, () => ({
						type: "text",
						text: "SECRET_OVERSIZED_BLOCKS",
					})),
				}),
			],
		});

		expect(page.messages).toHaveLength(5);
		for (const [sequence, message] of page.messages.entries()) {
			expect(message).toEqual({
				messageId: `legacy-message-3-${sequence}`,
				sequence,
				role: "notice",
				text: "Legacy message is unavailable.",
				attachments: [],
			});
		}
		expect(getterCalls).toBe(0);
		const serialized = JSON.stringify(page);
		for (const secret of [
			"SECRET_GETTER",
			"SECRET_CLASS",
			"SECRET_PROXY",
			"SECRET_ROLE",
			"SECRET_OVERSIZED_BLOCKS",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});

	it("uses the first tool block in source order without forwarding native metadata", () => {
		const page = projectLegacyMessagePage({
			sessionId: "session-legacy",
			generation: 3,
			messages: [
				asMessage({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "SECRET_RESULT_ID",
							name: "SECRET_RESULT_NAME",
							content: "SECRET_RESULT_BODY",
							is_error: true,
						},
						{
							type: "tool_use",
							id: "SECRET_USE_ID",
							name: "SECRET_USE_NAME",
							input: { token: "SECRET_USE_INPUT" },
						},
					],
				}),
			],
		});

		expect(page.messages[0]?.tool).toEqual({
			toolCallId: "legacy-tool-3-0-0",
			toolName: "tool",
			status: "failed",
		});
		expect(JSON.stringify(page)).not.toContain("SECRET_");
	});
});
