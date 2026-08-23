import { describe, expect, it } from "vitest";
import {
	HUB_CHAT_LIFECYCLE_COMMANDS,
	type HubChatLifecycleCommandName,
} from "../hub";
import {
	CHAT_LIFECYCLE_MAX_RUN_TURN_BYTES,
	HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS,
	HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS,
	parseHubChatLifecycleWireReply,
	parseHubChatLifecycleWireRequest,
} from "./chat-lifecycle-wire";

const START = { profileId: "profile-1" };
const PROFILE_AUTHORITY = {
	profileId: "profile-1",
	profileRevision: 1,
	authorityClassId: "cline.chat.authority.interactive-owner.v1",
	policyEpoch: 0,
	allowedModes: ["act", "plan", "yolo"] as const,
};
const START_RESULT = {
	sessionId: "session-1",
	chatId: "chat-1",
	leaseRevision: 1,
	writerGeneration: 1,
	leaseExpiresAt: "2026-08-15T12:00:00.000Z",
	profileAuthority: PROFILE_AUTHORITY,
};
const BINDING = {
	bindingId: "binding-1",
	transport: "connector",
	instanceId: "instance-1",
	channelId: "channel-1",
	threadId: "thread-1",
	participantScope: "participant-1",
	bound: true,
	chatId: "chat-1",
	sessionId: "session-1",
	revision: 1,
	updatedAt: "2026-08-15T12:00:00.000Z",
};
const CHAT = {
	chatId: "chat-1",
	catalogState: "active",
	headSessionId: "session-1",
	sourceKind: "interactive",
	createdAt: "2026-08-15T12:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	revision: 1,
	sessions: [],
	bindings: [],
};

const VALID_REQUESTS = {
	"chat_lifecycle.start_root": {
		operationId: "operation-1",
		sessionId: "session-1",
		start: START,
	},
	"chat_lifecycle.start_related": {
		operationId: "operation-2",
		sessionId: "session-2",
		chatId: "chat-2",
		parentSessionId: "session-1",
		relationKind: "fork",
		start: START,
	},
	"chat_lifecycle.restore_checkpoint": {
		operationId: "operation-3",
		sessionId: "session-3",
		chatId: "chat-3",
		parentSessionId: "session-1",
		checkpointRunCount: 2,
		start: START,
	},
	"chat_lifecycle.resume": {
		operationId: "operation-4",
		sessionId: "session-1",
		start: START,
	},
	"chat_lifecycle.recover_lost_lease": {
		operationId: "operation-5",
		sessionId: "session-1",
		start: START,
	},
	"chat_lifecycle.run_turn": {
		operationId: "operation-6",
		sessionId: "session-1",
		prompt: "Continue",
		attachments: {
			images: [{ mediaType: "image/png", dataBase64: "aGVsbG8=" }],
			files: [{ name: "notes.txt", content: "hello" }],
		},
	},
	"chat_lifecycle.binding.get": { profileId: "binding-profile-1" },
	"chat_lifecycle.bind": {
		operationId: "operation-7",
		sessionId: "session-1",
		target: {
			profileId: "binding-profile-1",
			bindingId: "binding-1",
			expectedBindingRevision: 0,
		},
	},
	"chat_lifecycle.reset": {
		operationId: "operation-8",
		sessionId: "session-1",
	},
	"chat_lifecycle.archive": {
		operationId: "operation-9",
		chatId: "chat-1",
		expectedRevision: 1,
	},
	"chat_lifecycle.activate": {
		operationId: "operation-10",
		chatId: "chat-1",
		expectedRevision: 2,
	},
	"chat_lifecycle.rename": {
		operationId: "operation-11",
		chatId: "chat-1",
		expectedRevision: 2,
		title: "Renamed",
	},
	"chat_lifecycle.purge": {
		operationId: "operation-12",
		chatId: "chat-1",
		expectedRevision: 3,
	},
	"chat_lifecycle.stop": {
		operationId: "operation-13",
		sessionId: "session-1",
	},
} satisfies Record<HubChatLifecycleCommandName, Record<string, unknown>>;

const VALID_RESULTS = {
	"chat_lifecycle.start_root": START_RESULT,
	"chat_lifecycle.start_related": START_RESULT,
	"chat_lifecycle.restore_checkpoint": {
		...START_RESULT,
		checkpoint: { createdAt: 1, runCount: 2, kind: "stash" },
		restoredMessageCount: 3,
	},
	"chat_lifecycle.resume": START_RESULT,
	"chat_lifecycle.recover_lost_lease": START_RESULT,
	"chat_lifecycle.run_turn": { turn: null },
	"chat_lifecycle.binding.get": null,
	"chat_lifecycle.bind": BINDING,
	"chat_lifecycle.reset": null,
	"chat_lifecycle.archive": CHAT,
	"chat_lifecycle.activate": CHAT,
	"chat_lifecycle.rename": { ...CHAT, title: "Renamed" },
	"chat_lifecycle.purge": {
		chatId: "chat-1",
		sessionIds: ["session-1"],
		applied: true,
	},
	"chat_lifecycle.stop": { stopped: true },
} satisfies Record<HubChatLifecycleCommandName, unknown>;

describe("managed chat lifecycle wire", () => {
	it("keeps request and result registries exhaustive", () => {
		expect(Object.keys(HUB_CHAT_LIFECYCLE_REQUEST_SCHEMAS)).toEqual([
			...HUB_CHAT_LIFECYCLE_COMMANDS,
		]);
		expect(Object.keys(HUB_CHAT_LIFECYCLE_RESULT_SCHEMAS)).toEqual([
			...HUB_CHAT_LIFECYCLE_COMMANDS,
		]);
	});

	it("parses a minimal request and result for every lifecycle command", () => {
		for (const command of HUB_CHAT_LIFECYCLE_COMMANDS) {
			expect(
				parseHubChatLifecycleWireRequest({
					version: "v1",
					command,
					payload: VALID_REQUESTS[command],
				}),
			).toMatchObject({ command });
			expect(
				parseHubChatLifecycleWireReply(command, {
					version: "v1",
					ok: true,
					payload: { result: VALID_RESULTS[command] },
				}),
			).toMatchObject({ ok: true });
		}
	});

	it("requires a canonical non-credential profile authority on admissions", () => {
		for (const profileAuthority of [
			undefined,
			{ ...PROFILE_AUTHORITY, allowedModes: ["plan", "act"] },
			{ ...PROFILE_AUTHORITY, allowedModes: ["act", "act"] },
			{ ...PROFILE_AUTHORITY, executionPolicyDigest: "a".repeat(64) },
		]) {
			expect(() =>
				parseHubChatLifecycleWireReply("chat_lifecycle.start_root", {
					version: "v1",
					ok: true,
					payload: {
						result: { ...START_RESULT, profileAuthority },
					},
				}),
			).toThrow();
		}
	});

	it("accepts opaque profiles and rejects paths, credentials, and authority claims", () => {
		const request = {
			version: "v1",
			command: "chat_lifecycle.start_root",
			payload: {
				operationId: "operation-1",
				sessionId: "session-1",
				start: {
					profileId: "profile-owner-default",
					relativeCwd: "packages/core",
				},
			},
		} as const;
		expect(parseHubChatLifecycleWireRequest(request)).toMatchObject(request);

		for (const forbidden of [
			{ prompt: "Plan before admission" },
			{ workspaceRoot: "/tmp/other" },
			{ cwd: "/tmp/other" },
			{ apiKey: "secret" },
			{ principalId: "forged" },
			{ tenantId: "forged" },
			{ connectionId: "forged" },
			{ source: { kind: "connector" } },
		]) {
			expect(() =>
				parseHubChatLifecycleWireRequest({
					...request,
					payload: { ...request.payload, ...forbidden },
				}),
			).toThrow();
		}
	});

	it("rejects absolute or escaping cwd hints", () => {
		for (const relativeCwd of [
			"/tmp/outside",
			"../outside",
			"packages/../../outside",
			"C:\\outside",
			"\\\\server\\share",
		]) {
			expect(() =>
				parseHubChatLifecycleWireRequest({
					version: "v1",
					command: "chat_lifecycle.resume",
					payload: {
						operationId: "operation-resume",
						sessionId: "session-resume",
						start: { profileId: "profile-1", relativeCwd },
					},
				}),
			).toThrow("relative cwd");
		}
	});

	it("rejects session identifiers that can become filesystem paths", () => {
		for (const sessionId of [
			"../../outside",
			"nested/session",
			"nested\\session",
			".",
			"..",
		]) {
			expect(() =>
				parseHubChatLifecycleWireRequest({
					version: "v1",
					command: "chat_lifecycle.start_root",
					payload: {
						operationId: "operation-path-safe",
						sessionId,
						start: { profileId: "profile-1" },
					},
				}),
			).toThrow("path-safe segment");
		}
	});

	it("accepts inline turn attachments and rejects attachment paths", () => {
		expect(
			parseHubChatLifecycleWireRequest({
				version: "v1",
				command: "chat_lifecycle.run_turn",
				payload: VALID_REQUESTS["chat_lifecycle.run_turn"],
			}),
		).toMatchObject({ command: "chat_lifecycle.run_turn" });

		for (const file of [
			{ name: "../secret", content: "no" },
			{ name: "/etc/passwd", content: "no" },
			{ name: "nested/file.txt", content: "no" },
			{ name: "file.txt", content: "no", path: "/etc/passwd" },
		]) {
			expect(() =>
				parseHubChatLifecycleWireRequest({
					version: "v1",
					command: "chat_lifecycle.run_turn",
					payload: {
						operationId: "operation-attachment",
						sessionId: "session-1",
						prompt: "inspect",
						attachments: { files: [file] },
					},
				}),
			).toThrow();
		}
	});

	it("rejects schema-valid parts whose combined JSON exceeds the default transport", () => {
		expect(CHAT_LIFECYCLE_MAX_RUN_TURN_BYTES).toBeLessThan(1024 * 1024);
		expect(() =>
			parseHubChatLifecycleWireRequest({
				version: "v1",
				command: "chat_lifecycle.run_turn",
				payload: {
					operationId: "operation-transport-bound",
					sessionId: "session-1",
					prompt: "p".repeat(256 * 1024),
					attachments: {
						files: [
							{
								name: "escaped.txt",
								content: "\0".repeat(100_000),
							},
						],
					},
				},
			}),
		).toThrow("transport byte limit");
	});

	it("binds successor revisions to the relationship kind", () => {
		const base = {
			version: "v1",
			command: "chat_lifecycle.start_related",
			payload: {
				operationId: "operation-related",
				sessionId: "session-related",
				chatId: "chat-related",
				parentSessionId: "session-parent",
				start: { profileId: "profile-1" },
			},
		} as const;
		expect(() =>
			parseHubChatLifecycleWireRequest({
				...base,
				payload: { ...base.payload, relationKind: "recovery" },
			}),
		).toThrow("expected revision");
		expect(() =>
			parseHubChatLifecycleWireRequest({
				...base,
				payload: {
					...base.payload,
					relationKind: "fork",
					expectedRevision: 2,
				},
			}),
		).toThrow("expected revision");
		expect(
			parseHubChatLifecycleWireRequest({
				...base,
				payload: {
					...base.payload,
					relationKind: "recovery",
					expectedRevision: 2,
				},
			}),
		).toMatchObject({ command: "chat_lifecycle.start_related" });
	});

	it("rejects unsanitized start results and malformed replies", () => {
		const result = {
			sessionId: "session-1",
			chatId: "chat-1",
			leaseRevision: 1,
			writerGeneration: 1,
			leaseExpiresAt: "2026-08-15T12:00:00.000Z",
			profileAuthority: PROFILE_AUTHORITY,
		};
		expect(
			parseHubChatLifecycleWireReply("chat_lifecycle.start_root", {
				version: "v1",
				requestId: "request-1",
				ok: true,
				payload: { result },
			}),
		).toMatchObject({ ok: true });

		for (const forbidden of [
			{ manifestPath: "/private/session/manifest.json" },
			{ messagesPath: "/private/session/messages.json" },
			{ leaseToken: "secret" },
			{ apiKey: "secret" },
		]) {
			expect(() =>
				parseHubChatLifecycleWireReply("chat_lifecycle.start_root", {
					version: "v1",
					ok: true,
					payload: { result: { ...result, ...forbidden } },
				}),
			).toThrow();
		}
	});

	it("keeps canonical workspace paths out of lifecycle projections", () => {
		expect(() =>
			parseHubChatLifecycleWireReply("chat_lifecycle.archive", {
				version: "v1",
				ok: true,
				payload: {
					result: {
						chatId: "chat-1",
						workspaceKey: "/private/workspace",
						catalogState: "archived",
						headSessionId: "session-1",
						sourceKind: "interactive",
						createdAt: "2026-08-15T12:00:00.000Z",
						lastActivityAt: "2026-08-15T12:00:00.000Z",
						archivedAt: "2026-08-15T12:00:00.000Z",
						revision: 2,
						sessions: [],
						bindings: [],
					},
				},
			}),
		).toThrow();
	});
});
