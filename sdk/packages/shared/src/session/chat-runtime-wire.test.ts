import { describe, expect, it } from "vitest";
import {
	HUB_CHAT_RUNTIME_COMMANDS,
	type HubChatRuntimeCommandName,
} from "../hub";
import {
	CHAT_RUNTIME_MAX_ATTACHMENT_BUNDLE_CHARS,
	CHAT_RUNTIME_MAX_FILE_CONTENT_CHARS,
	CHAT_RUNTIME_MAX_IMAGE_BASE64_CHARS,
	CHAT_RUNTIME_MAX_JSON_CHARS,
	CHAT_RUNTIME_MAX_OUTBOUND_WIRE_BYTES,
	CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE,
	getHubChatRuntimeSessionSequenceRange,
	HUB_CHAT_RUNTIME_ATTACHMENT_BUNDLE_SCHEMA,
	HUB_CHAT_RUNTIME_REQUEST_SCHEMAS,
	HUB_CHAT_RUNTIME_RESULT_SCHEMAS,
	parseHubChatRuntimeCursor,
	parseHubChatRuntimeEventSubscription,
	parseHubChatRuntimeWireEvent,
	parseHubChatRuntimeWireReply,
	parseHubChatRuntimeWireRequest,
} from "./chat-runtime-wire";

const OPERATION = { operationId: "operation-1", sessionId: "session-1" };
const PROMPT = {
	promptId: "prompt-1",
	prompt: "Continue",
	delivery: "queue",
	attachments: [],
};
const USAGE = {
	inputTokens: 10,
	outputTokens: 20,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	totalCost: 0.01,
};
const PROFILE_AUTHORITY = {
	profileId: "cline.chat.interactive.v1",
	profileRevision: 2,
	authorityClassId: "cline.chat.authority.interactive-owner.v1",
	policyEpoch: 2,
	allowedModes: ["act", "plan"] as const,
};
const BASELINE = {
	streamId: "runtime-stream-1",
	sessionSequence: 0,
};

const VALID_REQUESTS = {
	"chat_runtime.abort": { ...OPERATION, runId: "run-1", reason: "stop" },
	"chat_runtime.session.continuity": { sessionId: "session-1" },
	"chat_runtime.session.hydrate": {
		sessionId: "session-1",
		expectedWriterGeneration: 2,
		baseline: BASELINE,
	},
	"chat_runtime.session.reclaim": {
		...OPERATION,
		expectedWriterGeneration: 1,
	},
	"chat_runtime.session.reclaim.cancel": {
		...OPERATION,
		expectedWriterGeneration: 1,
	},
	"chat_runtime.approval.respond": {
		...OPERATION,
		runId: "run-1",
		approvalId: "approval-1",
		decision: "approve",
	},
	"chat_runtime.pending_prompts.list": { sessionId: "session-1" },
	"chat_runtime.pending_prompts.update": {
		...OPERATION,
		promptId: "prompt-1",
		prompt: "Updated",
	},
	"chat_runtime.pending_prompts.remove": {
		...OPERATION,
		promptId: "prompt-1",
	},
	"chat_runtime.messages.list": { sessionId: "session-1", limit: 50 },
	"chat_runtime.checkpoints.list": { sessionId: "session-1" },
	"chat_runtime.usage.get": { sessionId: "session-1" },
	"chat_runtime.compaction.get": { sessionId: "session-1" },
	"chat_runtime.compaction.run": OPERATION,
	"chat_runtime.capability.respond": {
		...OPERATION,
		runId: "run-1",
		requestId: "request-1",
		capability: "tool.execute",
		result: { ok: true },
	},
} satisfies Record<HubChatRuntimeCommandName, Record<string, unknown>>;

const VALID_RESULTS = {
	"chat_runtime.abort": { ...OPERATION, runId: "run-1", accepted: true },
	"chat_runtime.session.continuity": {
		sessionId: "session-1",
		state: "orphaned",
		writerGeneration: 1,
		runtimeBaseline: BASELINE,
	},
	"chat_runtime.session.hydrate": {
		sessionId: "session-1",
		chatId: "chat-1",
		writerGeneration: 2,
		profileAuthority: PROFILE_AUTHORITY,
		requestedBaseline: BASELINE,
		runtimeBaseline: BASELINE,
		replayAvailable: true,
		messages: [],
		messagesTruncated: false,
		pendingPrompts: [],
		pendingPromptsTruncated: false,
		checkpoints: [],
		checkpointsTruncated: false,
		compaction: null,
	},
	"chat_runtime.session.reclaim": {
		sessionId: "session-1",
		leaseRevision: 2,
		writerGeneration: 2,
		leaseExpiresAt: "2026-08-15T12:02:00.000Z",
		ownerTransferred: true,
	},
	"chat_runtime.session.reclaim.cancel": {
		...OPERATION,
		writerGeneration: 1,
		cancellationAccepted: true,
	},
	"chat_runtime.approval.respond": {
		...OPERATION,
		runId: "run-1",
		approvalId: "approval-1",
		decision: "approve",
	},
	"chat_runtime.pending_prompts.list": {
		sessionId: "session-1",
		prompts: [PROMPT],
		hasMore: false,
	},
	"chat_runtime.pending_prompts.update": {
		sessionId: "session-1",
		prompts: [PROMPT],
		prompt: PROMPT,
		updated: true,
		hasMore: false,
	},
	"chat_runtime.pending_prompts.remove": {
		sessionId: "session-1",
		prompts: [],
		removed: true,
		hasMore: false,
	},
	"chat_runtime.messages.list": {
		sessionId: "session-1",
		messages: [
			{
				messageId: "message-1",
				sequence: 1,
				role: "assistant",
				text: "Done",
				attachments: [],
			},
		],
		hasMore: false,
	},
	"chat_runtime.checkpoints.list": {
		sessionId: "session-1",
		checkpoints: [{ createdAt: 1, runCount: 1, kind: "stash" }],
	},
	"chat_runtime.usage.get": { sessionId: "session-1", usage: USAGE },
	"chat_runtime.compaction.get": { sessionId: "session-1", state: null },
	"chat_runtime.compaction.run": {
		...OPERATION,
		outcome: "completed",
		state: {
			version: 1,
			updatedAt: "2026-08-15T12:00:00.000Z",
			sourceMessageCount: 10,
			compactedMessageCount: 2,
		},
	},
	"chat_runtime.capability.respond": {
		...OPERATION,
		runId: "run-1",
		requestId: "request-1",
		accepted: true,
	},
} satisfies Record<HubChatRuntimeCommandName, unknown>;

const EVENT = {
	version: "v1",
	event: "chat.runtime",
	eventId: "event-1",
	streamId: "runtime-stream-1",
	sessionId: "session-1",
	timestamp: 1,
	processSequence: 10,
	sessionSequence: 2,
	payload: {
		kind: "tool.updated",
		runId: "run-1",
		toolCallId: "tool-call-1",
		toolName: "read_file",
		status: "running",
		summary: "Reading one workspace file",
	},
} as const;

describe("managed chat runtime wire", () => {
	it("keeps request and result registries exhaustive", () => {
		expect(Object.keys(HUB_CHAT_RUNTIME_REQUEST_SCHEMAS)).toEqual([
			...HUB_CHAT_RUNTIME_COMMANDS,
		]);
		expect(Object.keys(HUB_CHAT_RUNTIME_RESULT_SCHEMAS)).toEqual([
			...HUB_CHAT_RUNTIME_COMMANDS,
		]);
	});

	it("parses a minimal request and result for every runtime command", () => {
		for (const command of HUB_CHAT_RUNTIME_COMMANDS) {
			expect(
				parseHubChatRuntimeWireRequest({
					version: "v1",
					command,
					payload: VALID_REQUESTS[command],
				}),
			).toMatchObject({ command });
			expect(
				parseHubChatRuntimeWireReply(command, {
					version: "v1",
					ok: true,
					payload: { result: VALID_RESULTS[command] },
				}),
			).toMatchObject({ ok: true });
		}
	});

	it("accepts sequenced sanitized events and scoped subscriptions", () => {
		expect(parseHubChatRuntimeWireEvent(EVENT)).toEqual(EVENT);
		const ranged = parseHubChatRuntimeWireEvent({
			...EVENT,
			sessionSequenceStart: 1,
			payload: {
				kind: "assistant.delta",
				runId: "run-1",
				text: "hello",
			},
		});
		expect(getHubChatRuntimeSessionSequenceRange(ranged)).toEqual({
			start: 1,
			end: 2,
		});
		expect(
			parseHubChatRuntimeWireEvent({
				...EVENT,
				payload: {
					kind: "compaction.skipped",
					operationId: "compact-1",
					reason: "Nothing to compact.",
				},
			}),
		).toMatchObject({ payload: { kind: "compaction.skipped" } });
		expect(
			parseHubChatRuntimeEventSubscription({ sessionId: "session-1" }),
		).toEqual({ sessionId: "session-1" });
		const cursor = {
			streamId: "runtime-stream-1",
			sessionSequence: 0,
		};
		expect(parseHubChatRuntimeCursor(cursor)).toEqual(cursor);
		expect(
			parseHubChatRuntimeEventSubscription({
				sessionId: "session-1",
				cursor,
			}),
		).toEqual({ sessionId: "session-1", cursor });
		expect(() => parseHubChatRuntimeEventSubscription({ cursor })).toThrow(
			"requires one session",
		);
		expect(() =>
			parseHubChatRuntimeCursor({ ...cursor, sessionSequence: -1 }),
		).toThrow();
	});

	it("keeps continuity and hydration descriptive, strict, and credential-free", () => {
		for (const state of ["not_resident", "owned_elsewhere"] as const) {
			expect(
				parseHubChatRuntimeWireReply("chat_runtime.session.continuity", {
					version: "v1",
					ok: true,
					payload: { result: { sessionId: "session-1", state } },
				}),
			).toMatchObject({ ok: true });
		}
		expect(() =>
			parseHubChatRuntimeWireReply("chat_runtime.session.continuity", {
				version: "v1",
				ok: true,
				payload: {
					result: {
						...VALID_RESULTS["chat_runtime.session.continuity"],
						connectionId: "private-owner",
					},
				},
			}),
		).toThrow();
		expect(() =>
			parseHubChatRuntimeWireReply("chat_runtime.session.hydrate", {
				version: "v1",
				ok: true,
				payload: {
					result: {
						...VALID_RESULTS["chat_runtime.session.hydrate"],
						leaseToken: "secret",
					},
				},
			}),
		).toThrow();
		expect(() =>
			parseHubChatRuntimeWireRequest({
				version: "v1",
				command: "chat_runtime.session.hydrate",
				payload: {
					...VALID_REQUESTS["chat_runtime.session.hydrate"],
					workspaceRoot: "/private",
				},
			}),
		).toThrow();
	});

	it("bounds sequence ranges and reserves compression for assistant deltas", () => {
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				sessionSequenceStart: EVENT.sessionSequence,
			}),
		).toThrow("must omit");
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				sessionSequenceStart: 3,
			}),
		).toThrow("must not regress");
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				sessionSequenceStart: 1,
				sessionSequence: CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE + 1,
			}),
		).toThrow("coalescing limit");
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				sessionSequenceStart: 1,
				sessionSequence: CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE,
				payload: {
					kind: "assistant.delta",
					runId: "run-1",
					text: "bounded",
				},
			}),
		).not.toThrow();
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				sessionSequenceStart: 1,
				payload: {
					kind: "run.completed",
					runId: "run-1",
				},
			}),
		).toThrow("require assistant.delta");
	});

	it("rejects paths, credentials, authority claims, and raw tool payloads", () => {
		for (const forbidden of [
			{ workspaceRoot: "/tmp/private" },
			{ cwd: "/tmp/private" },
			{ apiKey: "secret" },
			{ leaseToken: "secret" },
			{ principalId: "forged" },
			{ connectionId: "forged" },
		]) {
			expect(() =>
				parseHubChatRuntimeWireRequest({
					version: "v1",
					command: "chat_runtime.abort",
					payload: { ...OPERATION, runId: "run-1", ...forbidden },
				}),
			).toThrow();
		}

		for (const forbidden of [
			{ messages: [{ role: "user", content: "private" }] },
			{ summary: "caller-authored" },
			{ compactionState: { version: 1 } },
			{ providerConfig: { apiKey: "secret" } },
			{ writerLease: { leaseToken: "secret" } },
		]) {
			expect(() =>
				parseHubChatRuntimeWireRequest({
					version: "v1",
					command: "chat_runtime.compaction.run",
					payload: { ...OPERATION, ...forbidden },
				}),
			).toThrow();
		}

		for (const forbidden of [
			{ inputJson: '{"path":"/tmp/private"}' },
			{ input: { path: "/tmp/private" } },
			{ output: "provider output" },
			{ providerMessage: { role: "assistant" } },
			{ workspacePath: "/tmp/private" },
		]) {
			expect(() =>
				parseHubChatRuntimeWireEvent({
					...EVENT,
					payload: { ...EVENT.payload, ...forbidden },
				}),
			).toThrow();
		}
	});

	it("correlates terminal compaction outcomes with sanitized state", () => {
		expect(() =>
			parseHubChatRuntimeWireReply("chat_runtime.compaction.run", {
				version: "v1",
				ok: true,
				payload: {
					result: { ...OPERATION, outcome: "completed" },
				},
			}),
		).toThrow("completed compaction requires state");
		expect(() =>
			parseHubChatRuntimeWireReply("chat_runtime.compaction.run", {
				version: "v1",
				ok: true,
				payload: {
					result: {
						...OPERATION,
						outcome: "skipped",
						state: {
							version: 1,
							sourceMessageCount: 2,
							compactedMessageCount: 1,
						},
					},
				},
			}),
		).toThrow("skipped compaction forbids");
	});

	it("rejects traversal-shaped sessions and filenames", () => {
		expect(() =>
			parseHubChatRuntimeEventSubscription({ sessionId: "../../outside" }),
		).toThrow();
		expect(() =>
			parseHubChatRuntimeWireRequest({
				version: "v1",
				command: "chat_runtime.abort",
				payload: {
					...OPERATION,
					sessionId: "nested/session",
					runId: "run-1",
				},
			}),
		).toThrow("path-safe segment");

		for (const name of ["../secret", "/etc/passwd", "nested/file.txt"]) {
			expect(() =>
				parseHubChatRuntimeWireRequest({
					version: "v1",
					command: "chat_runtime.capability.respond",
					payload: VALID_REQUESTS["chat_runtime.capability.respond"],
				}),
			).not.toThrow();
			expect(() =>
				HUB_CHAT_RUNTIME_REQUEST_SCHEMAS["chat_runtime.abort"].parse({
					...OPERATION,
					attachments: { files: [{ name, content: "secret" }] },
				}),
			).toThrow();
		}
	});

	it("enforces attachment and callback payload bounds", () => {
		expect(() =>
			parseHubChatRuntimeWireRequest({
				version: "v1",
				command: "chat_runtime.capability.respond",
				payload: {
					...OPERATION,
					runId: "run-1",
					requestId: "request-1",
					capability: "tool.execute",
					result: { text: "x".repeat(CHAT_RUNTIME_MAX_JSON_CHARS + 1) },
				},
			}),
		).toThrow();

		expect(() =>
			parseHubChatRuntimeWireRequest({
				version: "v1",
				command: "chat_runtime.capability.respond",
				payload: {
					...OPERATION,
					runId: "run-1",
					requestId: "request-1",
					capability: "tool.execute",
					result: { ok: true },
					error: "both are forbidden",
				},
			}),
		).toThrow("exactly one");

		expect(CHAT_RUNTIME_MAX_FILE_CONTENT_CHARS).toBeGreaterThan(0);
		expect(CHAT_RUNTIME_MAX_ATTACHMENT_BUNDLE_CHARS).toBeLessThan(1024 * 1024);
		expect(CHAT_RUNTIME_MAX_IMAGE_BASE64_CHARS).toBeLessThan(
			CHAT_RUNTIME_MAX_ATTACHMENT_BUNDLE_CHARS,
		);
		expect(() =>
			HUB_CHAT_RUNTIME_ATTACHMENT_BUNDLE_SCHEMA.parse({
				files: [
					{
						name: "unicode.txt",
						content: "é".repeat(CHAT_RUNTIME_MAX_FILE_CONTENT_CHARS),
					},
				],
			}),
		).toThrow("byte limit");
	});

	it("keeps terminal text below the outbound frame ceiling and correlates callbacks to runs", () => {
		expect(CHAT_RUNTIME_MAX_OUTBOUND_WIRE_BYTES).toBeLessThan(1024 * 1024);
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				payload: {
					kind: "assistant.finished",
					runId: "run-1",
					text: "x".repeat(256 * 1024 + 1),
				},
			}),
		).toThrow();
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				payload: {
					kind: "capability.requested",
					requestId: "request-1",
					capability: "host.prompt",
					request: {},
					expiresAt: "2026-08-15T12:00:00.000Z",
				},
			}),
		).toThrow();
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				payload: {
					kind: "capability.requested",
					runId: "run-1",
					requestId: "request-1",
					capability: "host.prompt",
					request: {},
					expiresAt: "2026-08-15T12:00:00.000Z",
				},
			}),
		).not.toThrow();
		expect(() =>
			parseHubChatRuntimeWireEvent({
				...EVENT,
				payload: {
					kind: "assistant.finished",
					runId: "run-1",
					text: "😀".repeat(70_000),
				},
			}),
		).toThrow("byte limit");
		expect(() =>
			parseHubChatRuntimeWireReply("chat_runtime.pending_prompts.list", {
				version: "v1",
				ok: true,
				payload: {
					result: {
						sessionId: "session-1",
						prompts: Array.from({ length: 20 }, (_, index) => ({
							...PROMPT,
							promptId: `prompt-${index}`,
							prompt: "\0".repeat(64 * 1024),
						})),
						hasMore: false,
					},
				},
			}),
		).toThrow("transport byte limit");
	});

	it("requires a real pending prompt mutation", () => {
		expect(() =>
			parseHubChatRuntimeWireRequest({
				version: "v1",
				command: "chat_runtime.pending_prompts.update",
				payload: { ...OPERATION, promptId: "prompt-1" },
			}),
		).toThrow("mutable field");
	});
});
