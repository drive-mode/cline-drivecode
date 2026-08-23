import { createHash } from "node:crypto";
import {
	HUB_CHAT_RUNTIME_REQUEST_SCHEMAS,
	HUB_CHAT_RUNTIME_RESULT_SCHEMAS,
	parseHubChatRuntimeWireResult,
} from "@cline/shared";
import type { InteractiveRuntimeDisplayMessagePage } from "./interactive-runtime-contract";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_CONTENT_BLOCKS = 64;
const MAX_ATTACHMENT_SUMMARIES = 12;
const MAX_DISPLAY_TEXT_BYTES = 192 * 1024;
const MAX_PAGE_BYTES = 640 * 1024;
const MESSAGE_CURSOR =
	/^legacy-message-(0|[1-9]\d*)-(0|[1-9]\d*)-([a-f0-9]{16})$/;

type PlainRecord = Record<string, unknown>;

export class InvalidLegacyMessageProjectionError extends Error {
	readonly code = "invalid_legacy_message_projection";

	constructor() {
		super("Legacy messages cannot be projected for interactive display.");
		this.name = "InvalidLegacyMessageProjectionError";
	}
}

function fail(): never {
	throw new InvalidLegacyMessageProjectionError();
}

function plainRecord(value: unknown): PlainRecord {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value)) fail();
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) fail();
	} catch {
		fail();
	}
	return value as PlainRecord;
}

function ownData(record: PlainRecord, key: string): unknown {
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(record, key);
	} catch {
		return fail();
	}
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) return fail();
	return descriptor.value;
}

function plainArrayLength(value: unknown, maximum?: number): number {
	try {
		if (!Array.isArray(value)) fail();
		if (Object.getPrototypeOf(value) !== Array.prototype) fail();
		const descriptor = Object.getOwnPropertyDescriptor(value, "length");
		if (
			!descriptor ||
			!("value" in descriptor) ||
			!Number.isSafeInteger(descriptor.value) ||
			descriptor.value < 0 ||
			(maximum !== undefined && descriptor.value > maximum)
		) {
			fail();
		}
		return descriptor.value;
	} catch {
		return fail();
	}
}

function arrayData(value: readonly unknown[], index: number): unknown {
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(value, String(index));
	} catch {
		return fail();
	}
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) return fail();
	return descriptor.value;
}

function utf8Width(character: string): number {
	const codePoint = character.codePointAt(0);
	if (codePoint === undefined) return 0;
	if (codePoint <= 0x7f) return 1;
	if (codePoint <= 0x7ff) return 2;
	if (codePoint <= 0xffff) return 3;
	return 4;
}

function truncateUtf8(
	value: string,
	maximumBytes: number,
): { text: string; bytes: number } {
	let bytes = 0;
	let utf16Length = 0;
	for (const character of value) {
		const width = utf8Width(character);
		if (bytes + width > maximumBytes) break;
		bytes += width;
		utf16Length += character.length;
	}
	return { text: value.slice(0, utf16Length), bytes };
}

function appendText(
	current: { text: string; bytes: number },
	value: string,
): { text: string; bytes: number } {
	if (value.length === 0 || current.bytes >= MAX_DISPLAY_TEXT_BYTES) {
		return current;
	}
	const separator = current.text.length > 0 ? "\n" : "";
	const separatorBytes = separator.length;
	if (current.bytes + separatorBytes >= MAX_DISPLAY_TEXT_BYTES) return current;
	const truncated = truncateUtf8(
		value,
		MAX_DISPLAY_TEXT_BYTES - current.bytes - separatorBytes,
	);
	if (truncated.text.length === 0) return current;
	return {
		text: `${current.text}${separator}${truncated.text}`,
		bytes: current.bytes + separatorBytes + truncated.bytes,
	};
}

function safeTimestamp(value: unknown): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	try {
		return new Date(value).toISOString();
	} catch {
		return undefined;
	}
}

type DisplayTool = Readonly<{
	toolCallId: string;
	toolName: string;
	status: "started" | "completed" | "failed";
}>;

function projectContent(
	content: unknown,
	generation: number,
	sequence: number,
): Readonly<{
	text: string;
	attachments: readonly Readonly<{ kind: "image" | "file" }>[];
	tool?: DisplayTool;
}> {
	if (typeof content === "string") {
		const truncated = truncateUtf8(content, MAX_DISPLAY_TEXT_BYTES);
		return {
			text: truncated.text,
			attachments: [],
		};
	}
	const length = plainArrayLength(content, MAX_CONTENT_BLOCKS);
	const blocks = content as readonly unknown[];
	let displayText = { text: "", bytes: 0 };
	const attachments: Array<Readonly<{ kind: "image" | "file" }>> = [];
	let tool: DisplayTool | undefined;
	for (let index = 0; index < length; index += 1) {
		const candidate = arrayData(blocks, index);
		if (candidate === undefined) continue;
		const block = plainRecord(candidate);
		const type = ownData(block, "type");
		switch (type) {
			case "text": {
				const text = ownData(block, "text");
				if (typeof text !== "string") fail();
				displayText = appendText(displayText, text);
				break;
			}
			case "image":
			case "file":
				if (attachments.length < MAX_ATTACHMENT_SUMMARIES) {
					attachments.push(Object.freeze({ kind: type }));
				}
				break;
			case "tool_use":
				if (!tool) {
					tool = Object.freeze({
						toolCallId: `legacy-tool-${generation}-${sequence}-${index}`,
						toolName: "tool",
						status: "started" as const,
					});
				}
				break;
			case "tool_result":
				if (!tool) {
					const isError = ownData(block, "is_error");
					if (isError !== undefined && typeof isError !== "boolean") fail();
					tool = Object.freeze({
						toolCallId: `legacy-tool-${generation}-${sequence}-${index}`,
						toolName: "tool",
						status:
							isError === true ? ("failed" as const) : ("completed" as const),
					});
				}
				break;
			case "thinking":
			case "redacted_thinking":
				break;
			default:
				// Unknown provider blocks carry no presentation authority.
				break;
		}
	}
	return {
		text: displayText.text,
		attachments,
		...(tool ? { tool } : {}),
	};
}

function projectMessage(
	message: unknown,
	generation: number,
	sequence: number,
): unknown {
	const record = plainRecord(message);
	const role = ownData(record, "role");
	if (role !== "user" && role !== "assistant") fail();
	const projectedContent = projectContent(
		ownData(record, "content"),
		generation,
		sequence,
	);
	const timestamp = safeTimestamp(ownData(record, "ts"));
	return {
		messageId: `legacy-message-${generation}-${sequence}`,
		sequence,
		role: projectedContent.tool ? "tool" : role,
		...(timestamp ? { timestamp } : {}),
		text: projectedContent.text,
		attachments: projectedContent.attachments,
		...(projectedContent.tool ? { tool: projectedContent.tool } : {}),
	};
}

function unavailableMessage(generation: number, sequence: number): unknown {
	return {
		messageId: `legacy-message-${generation}-${sequence}`,
		sequence,
		role: "notice" as const,
		text: "Legacy message is unavailable.",
		attachments: [],
	};
}

function freezePage<Value>(value: Value): Value {
	const pending: object[] = [];
	if (value && typeof value === "object") pending.push(value);
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (!candidate || Object.isFrozen(candidate)) continue;
		for (const nested of Object.values(candidate)) {
			if (nested && typeof nested === "object") pending.push(nested);
		}
		Object.freeze(candidate);
	}
	return value;
}

function cursorAuthority(sessionId: string, generation: number): string {
	return createHash("sha256")
		.update(sessionId)
		.update("\0")
		.update(String(generation))
		.digest("hex")
		.slice(0, 16);
}

function messageCursor(
	sessionId: string,
	generation: number,
	offset: number,
): string {
	return `legacy-message-${generation}-${offset}-${cursorAuthority(sessionId, generation)}`;
}

function parseOffset(
	cursor: string | undefined,
	sessionId: string,
	generation: number,
): number {
	if (cursor === undefined) return 0;
	const match = MESSAGE_CURSOR.exec(cursor);
	if (!match) return fail();
	const cursorGeneration = Number(match[1]);
	const offset = Number(match[2]);
	if (
		!Number.isSafeInteger(cursorGeneration) ||
		cursorGeneration !== generation ||
		!Number.isSafeInteger(offset) ||
		match[3] !== cursorAuthority(sessionId, generation)
	) {
		return fail();
	}
	return offset;
}

/**
 * Copies provider-native Legacy messages into the strict app display model.
 * Raw file contents/paths, images, tool payloads/results, and reasoning are
 * deliberately never read and therefore cannot cross this boundary. Explicit
 * top-level user/assistant text is the authorized display channel and requires
 * the caller to have access to the owning Legacy session.
 */
export function projectLegacyMessagePage(input: {
	sessionId: string;
	generation: number;
	messages: unknown;
	cursor?: string;
	limit?: number;
}): InteractiveRuntimeDisplayMessagePage {
	try {
		HUB_CHAT_RUNTIME_REQUEST_SCHEMAS["chat_runtime.messages.list"].parse({
			sessionId: input.sessionId,
			...(input.cursor === undefined ? {} : { cursor: input.cursor }),
			...(input.limit === undefined ? {} : { limit: input.limit }),
		});
		if (!Number.isSafeInteger(input.generation) || input.generation < 0) fail();
		const messageCount = plainArrayLength(input.messages);
		const rawMessages = input.messages as readonly unknown[];
		const offset = parseOffset(input.cursor, input.sessionId, input.generation);
		const limit = input.limit ?? DEFAULT_PAGE_SIZE;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
			fail();
		const messages: unknown[] = [];
		let pageBytes = 0;
		let nextOffset = offset;
		while (nextOffset < messageCount && messages.length < limit) {
			const rawMessage = arrayData(rawMessages, nextOffset);
			if (rawMessage === undefined) fail();
			let projected: unknown;
			try {
				projected = projectMessage(rawMessage, input.generation, nextOffset);
			} catch (error) {
				if (!(error instanceof InvalidLegacyMessageProjectionError))
					throw error;
				projected = unavailableMessage(input.generation, nextOffset);
			}
			const projectedBytes = new TextEncoder().encode(
				JSON.stringify(projected),
			).byteLength;
			if (projectedBytes > MAX_PAGE_BYTES) fail();
			if (messages.length > 0 && pageBytes + projectedBytes > MAX_PAGE_BYTES) {
				break;
			}
			messages.push(projected);
			pageBytes += projectedBytes;
			nextOffset += 1;
		}
		const result = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
			"chat_runtime.messages.list"
		].parse({
			sessionId: input.sessionId,
			messages,
			...(nextOffset < messageCount
				? {
						nextCursor: messageCursor(
							input.sessionId,
							input.generation,
							nextOffset,
						),
					}
				: {}),
			hasMore: nextOffset < messageCount,
		});
		parseHubChatRuntimeWireResult("chat_runtime.messages.list", result);
		return freezePage(result);
	} catch (error) {
		if (error instanceof InvalidLegacyMessageProjectionError) throw error;
		return fail();
	}
}
