import {
	HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS,
	HUB_CHAT_RUNTIME_REQUEST_SCHEMAS,
	HUB_CHAT_RUNTIME_RESULT_SCHEMAS,
	parseHubChatLifecycleWireResult,
	parseHubChatRuntimeWireResult,
} from "@cline/shared";
import type {
	InteractiveRuntimeCheckpointPage,
	InteractiveRuntimeCompactionResult,
	InteractiveRuntimeCompactionSnapshot,
	InteractiveRuntimeContextMetric,
	InteractiveRuntimePendingPromptMutation,
	InteractiveRuntimePendingPromptPage,
	InteractiveRuntimeTurnResult,
	InteractiveRuntimeUsageSnapshot,
} from "./interactive-runtime-contract";

const MAX_PROMPT_PAGE_SIZE = 20;
const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_PROMPT_PAGE_BYTES = 512 * 1024;
const MAX_ATTACHMENT_SUMMARIES = 12;
const MAX_CHECKPOINTS = 200;
const MAX_TURN_TEXT_BYTES = 192 * 1024;

type LegacyFinishReason =
	| "completed"
	| "max_iterations"
	| "aborted"
	| "mistake_limit"
	| "error";

type PlainRecord = Record<string, unknown>;

export class InvalidLegacyRuntimeProjectionError extends Error {
	readonly code = "invalid_legacy_runtime_projection";

	constructor() {
		super("Legacy runtime state cannot be projected for the interactive app.");
		this.name = "InvalidLegacyRuntimeProjectionError";
	}
}

function fail(): never {
	throw new InvalidLegacyRuntimeProjectionError();
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
	if (!descriptor || !("value" in descriptor)) fail();
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

function truncateUtf8(value: string, maximumBytes: number): string {
	let bytes = 0;
	let utf16Length = 0;
	for (const character of value) {
		const width = utf8Width(character);
		if (bytes + width > maximumBytes) break;
		bytes += width;
		utf16Length += character.length;
	}
	return value.slice(0, utf16Length);
}

function id(value: unknown): string {
	if (typeof value !== "string" || value.length > 512) return fail();
	const normalized = value.trim();
	if (normalized.length === 0) return fail();
	return normalized;
}

function optionalBoolean(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	return typeof value === "boolean" ? value : fail();
}

function revision(value: unknown): number {
	return Number.isSafeInteger(value) && (value as number) >= 0
		? (value as number)
		: fail();
}

function finiteNonnegative(value: unknown, defaultValue?: number): number {
	if (value === undefined && defaultValue !== undefined) return defaultValue;
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fail();
}

function timestamp(value: unknown): string {
	if (typeof value === "string") {
		if (value.length > 64) return fail();
		const milliseconds = Date.parse(value);
		if (!Number.isFinite(milliseconds)) return fail();
		return new Date(milliseconds).toISOString();
	}
	if (
		value instanceof Date &&
		Object.getPrototypeOf(value) === Date.prototype
	) {
		try {
			const milliseconds = Date.prototype.getTime.call(value);
			if (!Number.isFinite(milliseconds)) return fail();
			return new Date(milliseconds).toISOString();
		} catch {
			return fail();
		}
	}
	return fail();
}

function freezeOutput<Value>(value: Value): Value {
	const pending: object[] = [];
	const seen = new WeakSet<object>();
	if (value && typeof value === "object") pending.push(value);
	while (pending.length > 0) {
		const candidate = pending.pop();
		if (!candidate || seen.has(candidate)) continue;
		seen.add(candidate);
		for (const nested of Object.values(candidate)) {
			if (nested && typeof nested === "object") pending.push(nested);
		}
		Object.freeze(candidate);
	}
	return value;
}

function attachmentSummaries(prompt: PlainRecord) {
	const attachments: Array<Readonly<{ kind: "image" | "file" }>> = [];
	for (const [key, kind] of [
		["userImages", "image"],
		["userFiles", "file"],
	] as const) {
		const values = ownData(prompt, key);
		if (values === undefined) continue;
		const count = plainArrayLength(values);
		for (
			let index = 0;
			index < count && attachments.length < MAX_ATTACHMENT_SUMMARIES;
			index += 1
		) {
			attachments.push(Object.freeze({ kind }));
		}
	}
	return attachments;
}

function projectPrompt(value: unknown): unknown {
	const prompt = plainRecord(value);
	const text = ownData(prompt, "prompt");
	const delivery = ownData(prompt, "delivery");
	if (typeof text !== "string") fail();
	if (delivery !== "queue" && delivery !== "steer") fail();
	const mode = ownData(prompt, "mode");
	if (
		mode !== undefined &&
		mode !== "act" &&
		mode !== "plan" &&
		mode !== "yolo"
	) {
		fail();
	}
	return {
		promptId: id(ownData(prompt, "id")),
		prompt: truncateUtf8(text, MAX_PROMPT_BYTES),
		delivery,
		...(mode ? { mode } : {}),
		attachments: attachmentSummaries(prompt),
	};
}

function promptPage(input: {
	sessionId: string;
	prompts: unknown;
}): InteractiveRuntimePendingPromptPage {
	const count = plainArrayLength(input.prompts, MAX_PROMPT_PAGE_SIZE);
	const prompts = input.prompts as readonly unknown[];
	const page: unknown[] = [];
	let pageBytes = 0;
	for (let index = 0; index < count; index += 1) {
		const projected = projectPrompt(arrayData(prompts, index));
		const projectedBytes = new TextEncoder().encode(
			JSON.stringify(projected),
		).byteLength;
		if (projectedBytes > MAX_PROMPT_PAGE_BYTES) fail();
		if (pageBytes + projectedBytes > MAX_PROMPT_PAGE_BYTES) fail();
		page.push(projected);
		pageBytes += projectedBytes;
	}
	const result = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
		"chat_runtime.pending_prompts.list"
	].parse({
		sessionId: input.sessionId,
		prompts: page,
		hasMore: false,
	});
	parseHubChatRuntimeWireResult("chat_runtime.pending_prompts.list", result);
	return freezeOutput(result);
}

export function projectLegacyPendingPromptPage(input: {
	sessionId: string;
	prompts: unknown;
}): InteractiveRuntimePendingPromptPage {
	try {
		HUB_CHAT_RUNTIME_REQUEST_SCHEMAS["chat_runtime.pending_prompts.list"].parse(
			{ sessionId: input.sessionId },
		);
		return promptPage(input);
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}

export function projectLegacyPendingPromptMutation(input: {
	kind: "update" | "remove";
	sessionId: string;
	result: unknown;
}): InteractiveRuntimePendingPromptMutation {
	try {
		const raw = plainRecord(input.result);
		if (id(ownData(raw, "sessionId")) !== input.sessionId) fail();
		const page = promptPage({
			sessionId: input.sessionId,
			prompts: ownData(raw, "prompts"),
		});
		const selected = ownData(raw, "prompt");
		const candidate = {
			...page,
			...(selected === undefined ? {} : { prompt: projectPrompt(selected) }),
			...(ownData(raw, "updated") === undefined
				? {}
				: { updated: optionalBoolean(ownData(raw, "updated")) }),
			...(ownData(raw, "removed") === undefined
				? {}
				: { removed: optionalBoolean(ownData(raw, "removed")) }),
		};
		const command =
			input.kind === "update"
				? "chat_runtime.pending_prompts.update"
				: "chat_runtime.pending_prompts.remove";
		const result =
			input.kind === "update"
				? HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
						"chat_runtime.pending_prompts.update"
					].parse(candidate)
				: HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
						"chat_runtime.pending_prompts.remove"
					].parse(candidate);
		parseHubChatRuntimeWireResult(command, result);
		return freezeOutput(result);
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}

export function projectLegacyCheckpointPage(input: {
	sessionId: string;
	checkpoints: unknown;
	limit?: number;
}): InteractiveRuntimeCheckpointPage {
	try {
		HUB_CHAT_RUNTIME_REQUEST_SCHEMAS["chat_runtime.checkpoints.list"].parse({
			sessionId: input.sessionId,
			...(input.limit === undefined ? {} : { limit: input.limit }),
		});
		const count = plainArrayLength(input.checkpoints);
		const checkpoints = input.checkpoints as readonly unknown[];
		const limit = input.limit ?? MAX_CHECKPOINTS;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CHECKPOINTS) {
			fail();
		}
		const projected: unknown[] = [];
		for (let index = Math.max(0, count - limit); index < count; index += 1) {
			const checkpoint = plainRecord(arrayData(checkpoints, index));
			const kind = ownData(checkpoint, "kind");
			if (kind !== undefined && kind !== "stash" && kind !== "commit") fail();
			projected.push({
				createdAt: finiteNonnegative(ownData(checkpoint, "createdAt")),
				runCount: revision(ownData(checkpoint, "runCount")),
				...(kind ? { kind } : {}),
			});
		}
		const result = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
			"chat_runtime.checkpoints.list"
		].parse({ sessionId: input.sessionId, checkpoints: projected });
		parseHubChatRuntimeWireResult("chat_runtime.checkpoints.list", result);
		return freezeOutput(result);
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}

function usage(value: unknown): unknown {
	const raw = plainRecord(value);
	return {
		inputTokens: finiteNonnegative(ownData(raw, "inputTokens"), 0),
		outputTokens: finiteNonnegative(ownData(raw, "outputTokens"), 0),
		cacheReadTokens: finiteNonnegative(ownData(raw, "cacheReadTokens"), 0),
		cacheWriteTokens: finiteNonnegative(ownData(raw, "cacheWriteTokens"), 0),
		totalCost: finiteNonnegative(ownData(raw, "totalCost"), 0),
	};
}

export function projectLegacyUsageSnapshot(input: {
	sessionId: string;
	summary: unknown;
}): InteractiveRuntimeUsageSnapshot {
	try {
		HUB_CHAT_RUNTIME_REQUEST_SCHEMAS["chat_runtime.usage.get"].parse({
			sessionId: input.sessionId,
		});
		const summary =
			input.summary === undefined ? undefined : plainRecord(input.summary);
		const direct = summary ? ownData(summary, "usage") : undefined;
		const aggregate = summary ? ownData(summary, "aggregateUsage") : undefined;
		const result = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
			"chat_runtime.usage.get"
		].parse({
			sessionId: input.sessionId,
			...(direct === undefined ? {} : { usage: usage(direct) }),
			...(aggregate === undefined ? {} : { aggregateUsage: usage(aggregate) }),
		});
		parseHubChatRuntimeWireResult("chat_runtime.usage.get", result);
		return freezeOutput(result);
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}

function compaction(value: unknown): unknown | null {
	if (value === undefined || value === null) return null;
	const raw = plainRecord(value);
	const updatedAt = ownData(raw, "updated_at");
	const messages = ownData(raw, "messages");
	return {
		version: revision(ownData(raw, "version")),
		...(updatedAt === undefined ? {} : { updatedAt: timestamp(updatedAt) }),
		sourceMessageCount: revision(ownData(raw, "source_message_count")),
		compactedMessageCount: plainArrayLength(messages),
	};
}

export function projectLegacyCompactionSnapshot(input: {
	sessionId: string;
	state: unknown;
}): InteractiveRuntimeCompactionSnapshot {
	try {
		HUB_CHAT_RUNTIME_REQUEST_SCHEMAS["chat_runtime.compaction.get"].parse({
			sessionId: input.sessionId,
		});
		const result = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
			"chat_runtime.compaction.get"
		].parse({ sessionId: input.sessionId, state: compaction(input.state) });
		parseHubChatRuntimeWireResult("chat_runtime.compaction.get", result);
		return freezeOutput(result);
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}

export function projectLegacyCompactionResult(input: {
	sessionId: string;
	operationId: string;
	compacted: boolean;
	state: unknown;
}): InteractiveRuntimeCompactionResult {
	try {
		const projectedState = input.compacted ? compaction(input.state) : null;
		if (input.compacted && projectedState === null) fail();
		const result = HUB_CHAT_RUNTIME_RESULT_SCHEMAS[
			"chat_runtime.compaction.run"
		].parse({
			sessionId: input.sessionId,
			operationId: input.operationId,
			outcome: input.compacted ? "completed" : "skipped",
			...(input.compacted ? { state: projectedState } : {}),
		});
		parseHubChatRuntimeWireResult("chat_runtime.compaction.run", result);
		return freezeOutput(result);
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}

function contextMetric(value: unknown): InteractiveRuntimeContextMetric {
	if (value === undefined) return { kind: "unavailable" };
	return {
		kind: "available",
		tokens: finiteNonnegative(value),
	};
}

function legacyFinishReason(value: unknown): LegacyFinishReason {
	switch (value) {
		case "completed":
		case "max_iterations":
		case "aborted":
		case "mistake_limit":
		case "error":
			return value;
		default:
			return fail();
	}
}

function projectedTurnText(
	raw: PlainRecord,
	finishReason: LegacyFinishReason,
): string {
	switch (finishReason) {
		case "completed": {
			const text = ownData(raw, "text");
			return typeof text === "string"
				? truncateUtf8(text, MAX_TURN_TEXT_BYTES)
				: fail();
		}
		case "aborted":
			return "Legacy run aborted.";
		case "max_iterations":
			return "Legacy run reached its iteration limit.";
		case "mistake_limit":
			return "Legacy run stopped after repeated mistakes.";
		case "error":
			return "Legacy run failed.";
	}
}

export function projectLegacyTurnResult(input: {
	result: unknown;
	contextTokens: unknown;
}): InteractiveRuntimeTurnResult {
	try {
		const context = contextMetric(input.contextTokens);
		let turn: unknown = null;
		if (input.result !== undefined && input.result !== null) {
			const raw = plainRecord(input.result);
			const finishReason = legacyFinishReason(ownData(raw, "finishReason"));
			const model = plainRecord(ownData(raw, "model"));
			turn = {
				text: projectedTurnText(raw, finishReason),
				usage: usage(ownData(raw, "usage")),
				iterations: revision(ownData(raw, "iterations")),
				finishReason,
				model: {
					id: id(ownData(model, "id")),
					provider: id(ownData(model, "provider")),
				},
				startedAt: timestamp(ownData(raw, "startedAt")),
				endedAt: timestamp(ownData(raw, "endedAt")),
				durationMs: finiteNonnegative(ownData(raw, "durationMs")),
			};
		}
		const strict = HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS[
			"chat_lifecycle.run_turn"
		].parse({ turn });
		parseHubChatLifecycleWireResult("chat_lifecycle.run_turn", strict);
		return freezeOutput({ ...strict, context });
	} catch (error) {
		if (error instanceof InvalidLegacyRuntimeProjectionError) throw error;
		return fail();
	}
}
