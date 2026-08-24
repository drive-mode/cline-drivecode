import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import type { AgentResult, MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionCompactionState } from "../../session/models/session-compaction";
import { SessionManualCompactionOperationConflictError } from "../../session/models/session-manual-compaction-operation";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import {
	ManagedRuntimeAdapter,
	type ManagedRuntimeCoreHandle,
} from "./workspace-managed-runtime-adapter";
import { HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY } from "./workspace-managed-runtime-capabilities";

function fixture(
	options: {
		grantAskQuestion?: boolean;
		capabilityTimeoutMs?: number;
		managedAuthoritySignal?: AbortSignal;
		connectionSignal?: AbortSignal;
		ownerTransitionReceiptLimit?: number;
		registerSession?: boolean;
		recoveryJournal?: {
			maxSessionEvents?: number;
			maxSessionBytes?: number;
			maxEvents?: number;
			maxBytes?: number;
			maxSessions?: number;
		};
	} = {},
) {
	const authority = new HubWorkspaceCapabilityAuthority();
	const identity = authority.consume({
		credential: authority.issue({
			principalId: "owner-runtime-adapter",
			workspaceKey: resolve("/tmp/managed-runtime-adapter"),
		}).credential,
		transport: "websocket",
	});
	let listener: ((event: CoreSessionEvent) => void) | undefined;
	const abort = vi.fn(async () => {});
	const rekeyManagedSessionAuthority = vi.fn(
		async (input: {
			operationId: string;
			sessionId: string;
			expectedWriterGeneration: number;
			signal?: AbortSignal;
		}) => ({
			sessionId: input.sessionId,
			leaseRevision: input.expectedWriterGeneration + 1,
			writerGeneration: input.expectedWriterGeneration + 1,
			leaseExpiresAt: "2026-08-15T12:02:00.000Z",
		}),
	);
	const manualCompactionIntents = new Map<string, string | undefined>();
	const runSessionManualCompaction = vi.fn(
		async (input: {
			operationId: string;
			sessionId: string;
			reason?: string;
			signal?: AbortSignal;
			onStarted?: () => void;
			onFailed?: () => void;
		}): Promise<{
			operationId: string;
			sessionId: string;
			outcome: "compacted" | "skipped";
			state?: SessionCompactionState;
		}> => {
			if (manualCompactionIntents.has(input.operationId)) {
				if (manualCompactionIntents.get(input.operationId) !== input.reason) {
					throw new SessionManualCompactionOperationConflictError();
				}
			} else {
				manualCompactionIntents.set(input.operationId, input.reason);
				input.onStarted?.();
			}
			return {
				operationId: input.operationId,
				sessionId: input.sessionId,
				outcome: "compacted" as const,
				state: {
					version: 1 as const,
					updated_at: "2026-08-15T12:00:00.000Z",
					source_message_count: 10,
					messages: [{ role: "user" as const, content: "private summary" }],
					system_prompt: "private system prompt",
				},
			};
		},
	);
	const managedAuthoritySignal = options.managedAuthoritySignal;
	const core: ManagedRuntimeCoreHandle = {
		abort,
		...(managedAuthoritySignal
			? {
					managedSessionAuthoritySignal: () => managedAuthoritySignal,
				}
			: {}),
		rekeyManagedSessionAuthority,
		runSessionManualCompaction,
		verifyManagedSessionAuthority: vi.fn(async (sessionId) => ({
			sessionId,
			leaseRevision: 1,
			writerGeneration: 1,
			leaseExpiresAt: "2026-08-15T12:01:00.000Z",
		})),
		pendingPrompts: {
			list: vi.fn(
				async () =>
					[
						{
							id: "prompt-1",
							prompt: "queued",
							delivery: "queue",
							attachmentCount: 2,
							userImages: ["data:image/png;base64,c2VjcmV0"],
							userFiles: ["/tmp/private.txt"],
						},
					] as SessionPendingPrompt[],
			),
			update: vi.fn(async ({ sessionId }) => ({
				sessionId,
				prompts: [],
				updated: true,
			})),
			delete: vi.fn(async ({ sessionId }) => ({
				sessionId,
				prompts: [],
				removed: true,
			})),
		},
		getAccumulatedUsage: vi.fn(async () => ({
			usage: {
				inputTokens: 1,
				outputTokens: 2,
				cacheReadTokens: 3,
				cacheWriteTokens: 4,
				totalCost: 0.1,
			},
		})),
		readMessages: vi.fn(
			async () =>
				[
					{
						id: "message-1",
						role: "user",
						content: [
							{ type: "text", text: "inspect this" },
							{ type: "file", path: "/tmp/private.txt", content: "secret" },
						],
					},
					{
						id: "message-2",
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "tool-call-1",
								name: "read_file",
								input: { path: "/tmp/private.txt", apiKey: "secret" },
							},
						],
					},
				] as MessageWithMetadata[],
		),
		get: vi.fn(
			async () =>
				({
					sessionId: "session-1",
					metadata: {
						__clineManagedProfileAuthorityV1: {
							profileId: "managed-test-profile",
							profileRevision: 1,
							authorityClassId: identity.policy.authorityClassId,
							policyEpoch: identity.policy.policyEpoch,
							connectionPolicyDigest: "a".repeat(64),
							executionPolicyDigest: "b".repeat(64),
							interactive: true,
							allowedModes: ["act", "plan"],
						},
						checkpoint: {
							history: [
								{
									ref: "refs/cline/private",
									createdAt: 1,
									runCount: 1,
									kind: "stash",
								},
							],
						},
					},
				}) as never,
		),
		readSessionCompactionState: vi.fn(
			async () =>
				({
					version: 1 as const,
					updated_at: "2026-08-15T12:00:00.000Z",
					source_message_count: 10,
					messages: [{ role: "user", content: "private summary" }],
					system_prompt: "private system prompt",
				}) as SessionCompactionState,
		),
		subscribe: vi.fn((next) => {
			listener = next;
			return () => {
				listener = undefined;
			};
		}),
	};
	const adapter = new ManagedRuntimeAdapter({
		core,
		scope: {
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: authority.signal(identity),
		},
		invocations: new AsyncLocalStorage(),
		resolveAudienceSession: (sessionId) =>
			sessionId === "session-1" ? ({ chatId: "chat-1" } as never) : null,
		...(options.capabilityTimeoutMs === undefined
			? {}
			: { capabilityTimeoutMs: options.capabilityTimeoutMs }),
		...(options.recoveryJournal
			? { recoveryJournal: options.recoveryJournal }
			: {}),
		...(options.ownerTransitionReceiptLimit === undefined
			? {}
			: {
					ownerTransitionReceiptLimit: options.ownerTransitionReceiptLimit,
				}),
	});
	const capabilityManifest = {
		callbacks: options.grantAskQuestion
			? [HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY]
			: [],
	} as const;
	if (options.registerSession !== false) {
		adapter.registerSession(
			"session-1",
			identity,
			options.connectionSignal ?? authority.signal(identity),
			1,
			capabilityManifest,
		);
	}
	return {
		abort,
		adapter,
		authority,
		core,
		emit: (event: CoreSessionEvent) => listener?.(event),
		identity,
		capabilityManifest,
		rekeyManagedSessionAuthority,
		runSessionManualCompaction,
	};
}

describe("managed runtime adapter", () => {
	it("sanitizes messages, prompts, checkpoints, usage, and compaction reads", async () => {
		const { adapter, authority, identity } = fixture();
		const invoke = (
			command: Parameters<typeof adapter.invoke>[0]["command"],
			payload: Record<string, unknown>,
		) =>
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command,
				payload,
			});

		const results = await Promise.all([
			invoke("chat_runtime.pending_prompts.list", { sessionId: "session-1" }),
			invoke("chat_runtime.messages.list", { sessionId: "session-1" }),
			invoke("chat_runtime.checkpoints.list", { sessionId: "session-1" }),
			invoke("chat_runtime.usage.get", { sessionId: "session-1" }),
			invoke("chat_runtime.compaction.get", { sessionId: "session-1" }),
		]);
		const serialized = JSON.stringify(results);
		expect(serialized).not.toContain("/tmp/private");
		expect(serialized).not.toContain("refs/cline/private");
		expect(serialized).not.toContain("private summary");
		expect(serialized).not.toContain("private system prompt");
		expect(serialized).not.toContain("apiKey");
		expect(serialized).not.toContain("c2VjcmV0");
		expect(results[1]).toMatchObject({
			sessionId: "session-1",
			messages: [
				{ role: "user", text: "inspect this", attachments: [{ kind: "file" }] },
				{
					role: "tool",
					tool: { toolName: "read_file", status: "started" },
				},
			],
		});
		adapter.dispose();
	});

	it("paginates prompt reads and byte-bounds Unicode message projections", async () => {
		const { adapter, authority, core, identity } = fixture();
		(core.pendingPrompts.list as ReturnType<typeof vi.fn>).mockResolvedValue(
			Array.from({ length: 25 }, (_, index) => ({
				id: `prompt-${index}`,
				prompt: "\0".repeat(64 * 1024),
				delivery: "queue" as const,
				attachmentCount: 0,
			})),
		);
		(core.readMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
			{
				id: "message-unicode",
				role: "assistant",
				content: "😀".repeat(300_000),
			},
		]);
		const promptPage = (await adapter.invoke({
			identity,
			signal: authority.signal(identity),
			command: "chat_runtime.pending_prompts.list",
			payload: { sessionId: "session-1", limit: 20 },
		})) as {
			prompts: unknown[];
			nextCursor?: string;
			hasMore: boolean;
		};
		expect(promptPage.prompts.length).toBeGreaterThan(0);
		expect(promptPage.prompts.length).toBeLessThan(20);
		expect(promptPage.hasMore).toBe(true);
		expect(promptPage.nextCursor).toMatch(/^offset-/);
		expect(
			new TextEncoder().encode(JSON.stringify(promptPage)).byteLength,
		).toBeLessThan(768 * 1024);

		const messagePage = (await adapter.invoke({
			identity,
			signal: authority.signal(identity),
			command: "chat_runtime.messages.list",
			payload: { sessionId: "session-1" },
		})) as { messages: Array<{ text: string }> };
		expect(
			new TextEncoder().encode(messagePage.messages[0]?.text ?? "").byteLength,
		).toBeLessThanOrEqual(192 * 1024);
		expect(
			new TextEncoder().encode(JSON.stringify(messagePage)).byteLength,
		).toBeLessThan(768 * 1024);
		adapter.dispose();
	});

	it("runs trusted manual compaction once, replays its receipt, and emits only sanitized state", async () => {
		const { adapter, authority, identity, runSessionManualCompaction } =
			fixture();
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		const request = {
			identity,
			signal: authority.signal(identity),
			command: "chat_runtime.compaction.run" as const,
			payload: {
				operationId: "compact-1",
				sessionId: "session-1",
				reason: "user requested",
			},
		};

		const first = await adapter.invoke(request);
		const replay = await adapter.invoke(request);

		expect(first).toEqual({
			operationId: "compact-1",
			sessionId: "session-1",
			outcome: "completed",
			state: {
				version: 1,
				updatedAt: "2026-08-15T12:00:00.000Z",
				sourceMessageCount: 10,
				compactedMessageCount: 1,
			},
		});
		expect(replay).toEqual(first);
		expect(runSessionManualCompaction).toHaveBeenCalledTimes(2);
		expect(runSessionManualCompaction).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "compact-1",
				sessionId: "session-1",
				reason: "user requested",
				signal: expect.any(AbortSignal),
			}),
		);
		expect(events.map((event) => event.payload)).toEqual([
			{ kind: "compaction.started", operationId: "compact-1" },
			{
				kind: "compaction.completed",
				operationId: "compact-1",
				state: {
					version: 1,
					updatedAt: "2026-08-15T12:00:00.000Z",
					sourceMessageCount: 10,
					compactedMessageCount: 1,
				},
			},
		]);
		expect(JSON.stringify(events)).not.toContain("private summary");
		expect(JSON.stringify(events)).not.toContain("private system prompt");
		await expect(
			adapter.invoke({
				...request,
				payload: { ...request.payload, reason: "changed intent" },
			}),
		).rejects.toMatchObject({ code: "invocation_replay_conflict" });
		adapter.dispose();
	});

	it("emits an explicit skipped terminal event for a successful no-op compaction", async () => {
		const { adapter, authority, identity, runSessionManualCompaction } =
			fixture();
		runSessionManualCompaction.mockImplementationOnce(async (input) => {
			input.onStarted?.();
			return {
				operationId: "compact-skip",
				sessionId: "session-1",
				outcome: "skipped",
			};
		});
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});

		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.compaction.run",
				payload: {
					operationId: "compact-skip",
					sessionId: "session-1",
				},
			}),
		).resolves.toMatchObject({ outcome: "skipped" });
		expect(events.at(-1)?.payload).toEqual({
			kind: "compaction.skipped",
			operationId: "compact-skip",
			reason: "The conversation did not contain compactable context.",
		});
		adapter.dispose();
	});

	it("does not emit lifecycle events when the host returns a durable replay", async () => {
		const { adapter, authority, identity, runSessionManualCompaction } =
			fixture();
		runSessionManualCompaction.mockResolvedValueOnce({
			operationId: "compact-durable-replay",
			sessionId: "session-1",
			outcome: "compacted",
			state: {
				version: 1,
				updated_at: "2026-08-15T12:00:00.000Z",
				source_message_count: 10,
				messages: [{ role: "user", content: "private summary" }],
			},
		});
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});

		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.compaction.run",
				payload: {
					operationId: "compact-durable-replay",
					sessionId: "session-1",
				},
			}),
		).resolves.toMatchObject({ outcome: "completed" });
		expect(events).toEqual([]);
		adapter.dispose();
	});

	it("emits failed only when the host confirms a durable failed receipt", async () => {
		const fresh = fixture();
		fresh.runSessionManualCompaction.mockImplementationOnce(async (input) => {
			input.onStarted?.();
			input.onFailed?.();
			throw new Error("provider failed");
		});
		const freshEvents: Array<Record<string, unknown>> = [];
		fresh.adapter.subscribe({
			identity: fresh.identity,
			signal: fresh.authority.signal(fresh.identity),
			sessionId: "session-1",
			emit: (event) => freshEvents.push(event as Record<string, unknown>),
		});
		await expect(
			fresh.adapter.invoke({
				identity: fresh.identity,
				signal: fresh.authority.signal(fresh.identity),
				command: "chat_runtime.compaction.run",
				payload: {
					operationId: "compact-failed",
					sessionId: "session-1",
				},
			}),
		).rejects.toThrow("provider failed");
		expect(freshEvents.map((event) => event.payload)).toEqual([
			{ kind: "compaction.started", operationId: "compact-failed" },
			{
				kind: "compaction.failed",
				operationId: "compact-failed",
				error: "Manual compaction failed.",
			},
		]);
		fresh.adapter.dispose();

		const replay = fixture();
		replay.runSessionManualCompaction.mockRejectedValueOnce(
			new Error("manual compaction operation previously failed"),
		);
		const replayEvents: Array<Record<string, unknown>> = [];
		replay.adapter.subscribe({
			identity: replay.identity,
			signal: replay.authority.signal(replay.identity),
			sessionId: "session-1",
			emit: (event) => replayEvents.push(event as Record<string, unknown>),
		});
		await expect(
			replay.adapter.invoke({
				identity: replay.identity,
				signal: replay.authority.signal(replay.identity),
				command: "chat_runtime.compaction.run",
				payload: {
					operationId: "compact-failed-replay",
					sessionId: "session-1",
				},
			}),
		).rejects.toThrow("previously failed");
		expect(replayEvents).toEqual([]);
		replay.adapter.dispose();
	});

	it("keeps manual compaction and managed turns mutually exclusive", async () => {
		const { adapter, authority, identity, runSessionManualCompaction } =
			fixture();
		let finishCompaction:
			| ((value: {
					operationId: string;
					sessionId: string;
					outcome: "skipped";
			  }) => void)
			| undefined;
		runSessionManualCompaction.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishCompaction = resolve;
				}),
		);
		const compacting = adapter.invoke({
			identity,
			signal: authority.signal(identity),
			command: "chat_runtime.compaction.run",
			payload: {
				operationId: "compact-exclusive",
				sessionId: "session-1",
			},
		});
		await vi.waitFor(() =>
			expect(runSessionManualCompaction).toHaveBeenCalledTimes(1),
		);
		await expect(
			adapter.runTurn({
				operationId: "run-during-compact",
				sessionId: "session-1",
				identity,
				signal: authority.signal(identity),
				run: vi.fn(),
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		finishCompaction?.({
			operationId: "compact-exclusive",
			sessionId: "session-1",
			outcome: "skipped",
		});
		await compacting;
		adapter.dispose();
	});

	it("rejects compaction during an active run and aborts compaction when its owner disconnects", async () => {
		const first = fixture();
		let finishRun: ((result: AgentResult | undefined) => void) | undefined;
		const running = first.adapter.runTurn({
			operationId: "run-before-compact",
			sessionId: "session-1",
			identity: first.identity,
			signal: first.authority.signal(first.identity),
			run: () =>
				new Promise<AgentResult | undefined>((resolve) => {
					finishRun = resolve;
				}),
		});
		await expect(
			first.adapter.invoke({
				identity: first.identity,
				signal: first.authority.signal(first.identity),
				command: "chat_runtime.compaction.run",
				payload: {
					operationId: "compact-during-run",
					sessionId: "session-1",
				},
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(first.runSessionManualCompaction).not.toHaveBeenCalled();
		finishRun?.({ finishReason: "completed", text: "done" } as AgentResult);
		await running;
		first.adapter.dispose();

		const second = fixture();
		let observedSignal: AbortSignal | undefined;
		second.runSessionManualCompaction.mockImplementationOnce(
			(input) =>
				new Promise((_resolve, reject) => {
					observedSignal = input.signal;
					input.signal?.addEventListener(
						"abort",
						() => reject(input.signal?.reason ?? new Error("aborted")),
						{ once: true },
					);
				}),
		);
		const compacting = second.adapter.invoke({
			identity: second.identity,
			signal: second.authority.signal(second.identity),
			command: "chat_runtime.compaction.run",
			payload: {
				operationId: "compact-disconnect",
				sessionId: "session-1",
			},
		});
		await vi.waitFor(() => expect(observedSignal).toBeDefined());
		second.authority.release(second.identity);
		await expect(compacting).rejects.toBeDefined();
		expect(observedSignal?.aborted).toBe(true);
		second.adapter.dispose();
	});

	it("binds abort to the active run and emits sequenced sanitized events", async () => {
		const { abort, adapter, authority, emit, identity } = fixture();
		const events: unknown[] = [];
		const release = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event),
		});
		let finish: ((result: AgentResult | undefined) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-1",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () => {
				emit({
					type: "agent_event",
					payload: {
						sessionId: "session-1",
						event: {
							type: "content_start",
							contentType: "tool",
							toolCallId: "tool-1",
							toolName: "read_file",
							input: { path: "/tmp/private", apiKey: "secret" },
						},
					},
				});
				return new Promise<AgentResult | undefined>((resolve) => {
					finish = resolve;
				});
			},
		});
		expect(
			await adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.abort",
				payload: {
					operationId: "abort-1",
					sessionId: "session-1",
					runId: "run-1",
				},
			}),
		).toMatchObject({ accepted: true, runId: "run-1" });
		expect(abort).toHaveBeenCalledWith("session-1", "managed runtime abort");
		finish?.({ finishReason: "aborted", text: "" } as AgentResult);
		await running;
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain("/tmp/private");
		expect(serialized).not.toContain("apiKey");
		expect(events).toHaveLength(3);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					processSequence: 1,
					sessionSequence: 1,
					payload: {
						kind: "run.started",
						runId: "run-1",
						operationId: "run-1",
					},
				}),
				expect.objectContaining({
					processSequence: 2,
					payload: expect.objectContaining({ kind: "tool.started" }),
				}),
				expect.objectContaining({
					processSequence: 3,
					payload: { kind: "run.aborted", runId: "run-1" },
				}),
			]),
		);
		release();
		adapter.dispose();
	});

	it("replays one exact retained suffix before continuing live delivery", async () => {
		const { adapter, authority, identity } = fixture();
		const firstDelivery: Array<Record<string, unknown>> = [];
		const releaseFirst = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => firstDelivery.push(event as Record<string, unknown>),
		});
		await adapter.runTurn({
			operationId: "run-recovery-1",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () =>
				({ finishReason: "completed", text: "done" }) as AgentResult,
		});
		expect(firstDelivery).toHaveLength(2);
		const first = firstDelivery[0] as {
			streamId: string;
			sessionSequence: number;
		};
		releaseFirst();

		const resumedDelivery: Array<Record<string, unknown>> = [];
		const releaseResumed = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			cursor: {
				streamId: first.streamId,
				sessionSequence: first.sessionSequence,
			},
			emit: (event) => resumedDelivery.push(event as Record<string, unknown>),
		});
		expect(resumedDelivery).toEqual([firstDelivery[1]]);

		await adapter.runTurn({
			operationId: "run-recovery-2",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () =>
				({ finishReason: "completed", text: "done" }) as AgentResult,
		});
		expect(resumedDelivery.map((event) => event.sessionSequence)).toEqual([
			2, 3, 4,
		]);
		releaseResumed();
		adapter.dispose();
	});

	it("acknowledges a quiet resident session at sequence zero", () => {
		const { adapter, authority, identity } = fixture();
		const ready = vi.fn();
		const release = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: vi.fn(),
			ready,
		});
		expect(ready).toHaveBeenCalledOnce();
		expect(ready).toHaveBeenCalledWith({
			streamId: expect.stringMatching(/^runtime_stream_/),
			sessionSequence: 0,
		});
		release();
		adapter.dispose();
	});

	it("catches up events emitted reentrantly during replay before readiness", async () => {
		const { adapter, authority, emit, identity } = fixture();
		const initial: Array<Record<string, unknown>> = [];
		const releaseInitial = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => initial.push(event as Record<string, unknown>),
		});
		await adapter.runTurn({
			operationId: "run-reentrant-replay",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () =>
				({ finishReason: "completed", text: "done" }) as AgentResult,
		});
		releaseInitial();
		const first = initial[0] as { streamId: string; sessionSequence: number };
		const replayed: Array<Record<string, unknown>> = [];
		const ready = vi.fn();
		let emittedReentrantly = false;
		const release = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			cursor: {
				streamId: first.streamId,
				sessionSequence: first.sessionSequence,
			},
			emit: (event) => {
				replayed.push(event as Record<string, unknown>);
				if (emittedReentrantly) return;
				emittedReentrantly = true;
				emit({
					type: "pending_prompts",
					payload: { sessionId: "session-1", prompts: [] },
				});
			},
			ready,
		});
		expect(replayed.map((event) => event.sessionSequence)).toEqual([2, 3]);
		expect(ready).toHaveBeenCalledWith({
			streamId: first.streamId,
			sessionSequence: 3,
		});
		release();
		adapter.dispose();
	});

	it("keeps journaled runtime events deeply immutable across replay", async () => {
		const { adapter, authority, identity } = fixture();
		const delivered: Array<Record<string, unknown>> = [];
		let baseline: { streamId: string; sessionSequence: number } | undefined;
		const releaseInitial = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => delivered.push(event as Record<string, unknown>),
			ready: (cursor) => {
				baseline = cursor;
			},
		});
		await adapter.runTurn({
			operationId: "run-immutable-replay",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () =>
				({ finishReason: "completed", text: "done" }) as AgentResult,
		});
		releaseInitial();
		expect(Object.isFrozen(delivered[0])).toBe(true);
		expect(Object.isFrozen(delivered[0]?.payload)).toBe(true);
		expect(
			Reflect.set(delivered[0]?.payload as object, "operationId", "mutated"),
		).toBe(false);
		const replayed: Array<Record<string, unknown>> = [];
		const releaseReplay = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			cursor: baseline,
			emit: (event) => replayed.push(event as Record<string, unknown>),
		});
		expect(replayed).toEqual(delivered);
		expect(JSON.stringify(replayed)).not.toContain("mutated");
		releaseReplay();
		adapter.dispose();
	});

	it("changes stream epoch after unregistering and recreating a resident session", () => {
		const { adapter, authority, capabilityManifest, identity } = fixture();
		let firstCursor: { streamId: string; sessionSequence: number } | undefined;
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: vi.fn(),
			ready: (cursor) => {
				firstCursor = cursor;
			},
		})();
		adapter.unregisterSession("session-1");
		adapter.registerSession(
			"session-1",
			identity,
			authority.signal(identity),
			1,
			capabilityManifest,
		);
		let secondCursor: { streamId: string; sessionSequence: number } | undefined;
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: vi.fn(),
			ready: (cursor) => {
				secondCursor = cursor;
			},
		})();
		expect(secondCursor?.sessionSequence).toBe(0);
		expect(secondCursor?.streamId).not.toBe(firstCursor?.streamId);
		expect(() =>
			adapter.subscribe({
				identity,
				signal: authority.signal(identity),
				sessionId: "session-1",
				cursor: firstCursor,
				emit: vi.fn(),
			}),
		).toThrow("not available");
		adapter.dispose();
	});

	it("journals an orphaned run terminal for replay after durable reclaim", async () => {
		const ownerConnection = new AbortController();
		const { adapter, authority, identity } = fixture({
			connectionSignal: ownerConnection.signal,
		});
		const initial: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: ownerConnection.signal,
			sessionId: "session-1",
			emit: (event) => initial.push(event as Record<string, unknown>),
		});
		let finish: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-orphaned-terminal",
			sessionId: "session-1",
			identity,
			signal: ownerConnection.signal,
			run: () =>
				new Promise<AgentResult>((resolve) => {
					finish = resolve;
				}),
		});
		expect(initial).toHaveLength(1);
		const cursor = initial[0] as { streamId: string; sessionSequence: number };
		ownerConnection.abort(new Error("connection closed"));
		finish?.({ finishReason: "completed", text: "done" } as AgentResult);
		await running;

		const nextIdentity = authority.consume({
			credential: authority.issue({
				principalId: "owner-runtime-adapter",
				workspaceKey: resolve("/tmp/managed-runtime-adapter"),
			}).credential,
			transport: "websocket",
		});
		const nextConnection = new AbortController();
		await adapter.transitionSessionOwner({
			operationId: "reclaim-orphaned-terminal",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
			identity: nextIdentity,
			signal: nextConnection.signal,
		});
		const replayed: Array<Record<string, unknown>> = [];
		const release = adapter.subscribe({
			identity: nextIdentity,
			signal: nextConnection.signal,
			sessionId: "session-1",
			cursor: {
				streamId: cursor.streamId,
				sessionSequence: cursor.sessionSequence,
			},
			emit: (event) => replayed.push(event as Record<string, unknown>),
		});
		expect(replayed).toHaveLength(1);
		expect(replayed[0]?.payload).toEqual({
			kind: "run.aborted",
			runId: "run-orphaned-terminal",
		});
		release();
		adapter.dispose();
	});

	it("rejects an evicted or foreign recovery cursor", async () => {
		const { adapter, authority, identity } = fixture({
			recoveryJournal: {
				maxSessionEvents: 1,
				maxSessionBytes: 1_000_000,
				maxEvents: 2,
				maxBytes: 2_000_000,
			},
		});
		const events: Array<Record<string, unknown>> = [];
		const release = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		await adapter.runTurn({
			operationId: "run-recovery-evicted-1",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () =>
				({ finishReason: "completed", text: "done" }) as AgentResult,
		});
		await adapter.runTurn({
			operationId: "run-recovery-evicted-2",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () =>
				({ finishReason: "completed", text: "done" }) as AgentResult,
		});
		release();
		const first = events[0] as { streamId: string; sessionSequence: number };
		for (const cursor of [
			{
				streamId: first.streamId,
				sessionSequence: first.sessionSequence,
			},
			{ streamId: "runtime-stream-foreign", sessionSequence: 4 },
		]) {
			expect(() =>
				adapter.subscribe({
					identity,
					signal: authority.signal(identity),
					sessionId: "session-1",
					cursor,
					emit: vi.fn(),
				}),
			).toThrow("not available");
		}
		adapter.dispose();
	});

	it("rejects an abort for a stale run generation", async () => {
		const { adapter, authority, identity } = fixture();
		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.abort",
				payload: {
					operationId: "abort-stale",
					sessionId: "session-1",
					runId: "old-run",
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });
		adapter.dispose();
	});

	it("rejects reads for sessions not admitted by managed lifecycle", async () => {
		const { adapter, authority, identity } = fixture();
		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.messages.list",
				payload: { sessionId: "unrelated-legacy-session" },
			}),
		).rejects.toMatchObject({ code: "session_not_found" });
		adapter.dispose();
	});

	it("routes approvals only to and from the connection that owns the run", async () => {
		const { adapter, authority, identity } = fixture();
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		let finish: ((result: AgentResult | undefined) => void) | undefined;
		let approval:
			| Promise<
					Awaited<ReturnType<typeof adapter.capabilities.requestToolApproval>>
			  >
			| undefined;
		const running = adapter.runTurn({
			operationId: "run-approval",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () => {
				approval = adapter.capabilities.requestToolApproval({
					sessionId: "session-1",
					agentId: "agent-1",
					conversationId: "conversation-private",
					iteration: 1,
					toolCallId: "tool-call-approval",
					toolName: "write_file",
					input: { path: "/tmp/private", apiKey: "secret" },
					policy: { autoApprove: false },
				});
				return new Promise<AgentResult | undefined>((resolve) => {
					finish = resolve;
				});
			},
		});
		const requestEvent = events.find(
			(event) =>
				(event.payload as { kind?: string } | undefined)?.kind ===
				"approval.requested",
		);
		const requestPayload = requestEvent?.payload as
			| { approvalId?: string }
			| undefined;
		expect(requestPayload?.approvalId).toBeTruthy();
		expect(JSON.stringify(requestEvent)).not.toContain("/tmp/private");
		expect(JSON.stringify(requestEvent)).not.toContain("apiKey");

		const otherIdentity = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.invoke({
				identity: otherIdentity,
				signal: authority.signal(otherIdentity),
				command: "chat_runtime.approval.respond",
				payload: {
					operationId: "approval-wrong-connection",
					sessionId: "session-1",
					runId: "run-approval",
					approvalId: requestPayload?.approvalId,
					decision: "approve",
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(
			await adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.approval.respond",
				payload: {
					operationId: "approval-correct",
					sessionId: "session-1",
					runId: "run-approval",
					approvalId: requestPayload?.approvalId,
					decision: "approve",
				},
			}),
		).toMatchObject({ decision: "approve" });
		await expect(approval).resolves.toEqual({ approved: true });
		finish?.({ finishReason: "completed", text: "done" } as AgentResult);
		await running;
		authority.release(otherIdentity);
		adapter.dispose();
	});

	it("routes an exact profile-granted ask-question callback once", async () => {
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
		});
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		let answer: string | undefined;
		const running = adapter.runTurn({
			operationId: "run-question",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () => {
				answer = await askQuestion("Which path?", ["Use A", "Use B"], {
					sessionId: "session-1",
					runId: "run-question",
					agentId: "agent-1",
					iteration: 1,
					metadata: { workspacePath: "/private/workspace" },
				});
				return { finishReason: "completed", text: answer } as AgentResult;
			},
		});
		await vi.waitFor(() =>
			expect(
				events.some(
					(event) =>
						(event.payload as { kind?: string } | undefined)?.kind ===
						"capability.requested",
				),
			).toBe(true),
		);
		const requestEvent = events.find(
			(event) =>
				(event.payload as { kind?: string } | undefined)?.kind ===
				"capability.requested",
		);
		const request = requestEvent?.payload as
			| { requestId?: string; capability?: string }
			| undefined;
		expect(request).toMatchObject({
			capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
		});
		expect(JSON.stringify(requestEvent)).not.toContain("/private/workspace");
		const otherIdentity = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.invoke({
				identity: otherIdentity,
				signal: authority.signal(otherIdentity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-wrong-connection",
					sessionId: "session-1",
					runId: "run-question",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use A" },
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });

		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-wrong-run",
					sessionId: "session-1",
					runId: "run-question-stale",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use A" },
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });

		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-wrong-capability",
					sessionId: "session-1",
					runId: "run-question",
					requestId: request?.requestId,
					capability: "tool_executor.other",
					result: { answer: "Use A" },
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });

		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-invalid-result",
					sessionId: "session-1",
					runId: "run-question",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use A", workspacePath: "/private" },
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });

		expect(
			await adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-correct",
					sessionId: "session-1",
					runId: "run-question",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use A" },
				},
			}),
		).toMatchObject({ accepted: true, requestId: request?.requestId });
		await running;
		expect(answer).toBe("Use A");

		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-duplicate",
					sessionId: "session-1",
					runId: "run-question",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use B" },
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });
		authority.release(otherIdentity);
		adapter.dispose();
	});

	it("rejects a response after authoritative expiry before its timer runs", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
			capabilityTimeoutMs: 1_000,
		});
		try {
			const events: Array<Record<string, unknown>> = [];
			adapter.subscribe({
				identity,
				signal: authority.signal(identity),
				sessionId: "session-1",
				emit: (event) => events.push(event as Record<string, unknown>),
			});
			const askQuestion =
				adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
			if (!askQuestion) throw new Error("missing ask-question capability");
			let callback: Promise<string> | undefined;
			let finish: ((result: AgentResult) => void) | undefined;
			const running = adapter.runTurn({
				operationId: "run-question-expiry",
				sessionId: "session-1",
				identity,
				signal: authority.signal(identity),
				run: () => {
					callback = askQuestion("Continue?", ["Yes", "No"], {
						sessionId: "session-1",
						runId: "run-question-expiry",
						agentId: "agent-1",
						iteration: 1,
					});
					return new Promise<AgentResult>((resolve) => {
						finish = resolve;
					});
				},
			});
			const request = events.find(
				(event) =>
					(event.payload as { kind?: string } | undefined)?.kind ===
					"capability.requested",
			)?.payload as { requestId?: string } | undefined;
			const callbackFailure = expect(callback).rejects.toThrow(
				"Managed runtime capability failed.",
			);

			vi.setSystemTime(new Date("2026-08-16T12:00:01.001Z"));
			await expect(
				adapter.invoke({
					identity,
					signal: authority.signal(identity),
					command: "chat_runtime.capability.respond",
					payload: {
						operationId: "question-expired",
						sessionId: "session-1",
						runId: "run-question-expiry",
						requestId: request?.requestId,
						capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
						result: { answer: "Yes" },
					},
				}),
			).rejects.toMatchObject({ code: "invalid_input" });
			await callbackFailure;
			expect(
				events.filter(
					(event) =>
						(event.payload as { kind?: string } | undefined)?.kind ===
						"capability.cancelled",
				),
			).toHaveLength(1);
			finish?.({ finishReason: "completed", text: "done" } as AgentResult);
			await running;
		} finally {
			adapter.dispose();
			vi.useRealTimers();
		}
	});

	it("cancels a pending callback before accepting an abort-racing response", async () => {
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
		});
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		let callback: Promise<string> | undefined;
		let finish: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-question-abort",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () => {
				callback = askQuestion("Continue?", ["Yes", "No"], {
					sessionId: "session-1",
					runId: "run-question-abort",
					agentId: "agent-1",
					iteration: 1,
				});
				return new Promise<AgentResult>((resolve) => {
					finish = resolve;
				});
			},
		});
		const request = events.find(
			(event) =>
				(event.payload as { kind?: string } | undefined)?.kind ===
				"capability.requested",
		)?.payload as { requestId?: string } | undefined;
		const callbackFailure = expect(callback).rejects.toThrow(
			"Managed runtime capability failed.",
		);

		expect(
			await adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.abort",
				payload: {
					operationId: "abort-question",
					sessionId: "session-1",
					runId: "run-question-abort",
				},
			}),
		).toMatchObject({ accepted: true });
		await callbackFailure;
		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-after-abort",
					sessionId: "session-1",
					runId: "run-question-abort",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Yes" },
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });
		expect(
			events.filter(
				(event) =>
					(event.payload as { kind?: string } | undefined)?.kind ===
					"capability.cancelled",
			),
		).toHaveLength(1);
		finish?.({ finishReason: "aborted", text: "" } as AgentResult);
		await running;
		adapter.dispose();
	});

	it("cancels a pending callback immediately when resident writer authority is lost", async () => {
		const managedAuthority = new AbortController();
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
			managedAuthoritySignal: managedAuthority.signal,
		});
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		let callback: Promise<string> | undefined;
		let finishRun: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-question-fence-loss",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () => {
				callback = askQuestion("Continue?", ["Yes", "No"], {
					sessionId: "session-1",
					runId: "run-question-fence-loss",
					agentId: "agent-1",
					iteration: 1,
				});
				return new Promise<AgentResult>((resolve) => {
					finishRun = resolve;
				});
			},
		});
		const request = events.find(
			(event) =>
				(event.payload as { kind?: string } | undefined)?.kind ===
				"capability.requested",
		)?.payload as { requestId?: string } | undefined;
		const callbackFailure = expect(callback).rejects.toThrow(
			"Managed runtime capability failed.",
		);

		managedAuthority.abort(new Error("writer fence lost"));
		await callbackFailure;
		expect(
			events.some(
				(event) =>
					(event.payload as { kind?: string } | undefined)?.kind ===
					"capability.cancelled",
			),
		).toBe(true);
		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "question-after-fence-loss",
					sessionId: "session-1",
					runId: "run-question-fence-loss",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Yes" },
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		finishRun?.({
			finishReason: "completed",
			text: "late success",
		} as AgentResult);
		await running;
		expect(
			events.some(
				(event) =>
					(event.payload as { kind?: string } | undefined)?.kind ===
					"run.aborted",
			),
		).toBe(true);
		adapter.dispose();
	});

	it("cancels a pending callback before durable owner rekey can retry", async () => {
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
		});
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		adapter.registerSession(
			"session-1",
			identity,
			oldOwner.signal,
			1,
			capabilityManifest,
		);
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		let callback: Promise<string> | undefined;
		let finish: ((result: AgentResult) => void) | undefined;
		const runSignal = new AbortController();
		const running = adapter.runTurn({
			operationId: "run-question-rekey",
			sessionId: "session-1",
			identity,
			signal: runSignal.signal,
			run: () => {
				callback = askQuestion("Continue?", ["Yes", "No"], {
					sessionId: "session-1",
					runId: "run-question-rekey",
					agentId: "agent-1",
					iteration: 1,
				});
				return new Promise<AgentResult>((resolve) => {
					finish = resolve;
				});
			},
		});
		const callbackFailure = expect(callback).rejects.toThrow(
			"Managed runtime capability failed.",
		);
		const request = events.find(
			(event) =>
				(event.payload as { kind?: string } | undefined)?.kind ===
				"capability.requested",
		)?.payload as { requestId?: string } | undefined;
		oldOwner.abort();
		await expect(
			adapter.transitionSessionOwner({
				operationId: "rekey-after-question",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
				identity: replacement,
				signal: authority.signal(replacement),
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		await callbackFailure;
		finish?.({ finishReason: "aborted", text: "" } as AgentResult);
		await running;

		expect(
			await adapter.transitionSessionOwner({
				operationId: "rekey-after-question-retry",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
				identity: replacement,
				signal: authority.signal(replacement),
			}),
		).toMatchObject({ writerGeneration: 2 });
		const releaseReplacement = adapter.subscribe({
			identity: replacement,
			signal: authority.signal(replacement),
			sessionId: "session-1",
			emit: vi.fn(),
		});
		await expect(
			adapter.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "late-question-after-rekey",
					sessionId: "session-1",
					runId: "run-question-rekey",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Yes" },
				},
			}),
		).rejects.toMatchObject({ code: "invalid_input" });
		releaseReplacement();
		adapter.dispose();
		authority.release(replacement);
	});

	it("cancels a pending callback when the managed runtime is disposed", async () => {
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
		});
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		let callback: Promise<string> | undefined;
		let finish: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-question-dispose",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () => {
				callback = askQuestion("Continue?", ["Yes", "No"], {
					sessionId: "session-1",
					runId: "run-question-dispose",
					agentId: "agent-1",
					iteration: 1,
				});
				return new Promise<AgentResult>((resolve) => {
					finish = resolve;
				});
			},
		});
		const callbackFailure = expect(callback).rejects.toThrow(
			"Managed runtime capability failed.",
		);
		const request = events.find(
			(event) =>
				(event.payload as { kind?: string } | undefined)?.kind ===
				"capability.requested",
		)?.payload as { requestId?: string } | undefined;

		adapter.dispose();
		await callbackFailure;
		await expect(
			adapter.invoke({
				identity,
				signal: authority.signal(identity),
				command: "chat_runtime.capability.respond",
				payload: {
					operationId: "late-question-after-dispose",
					sessionId: "session-1",
					runId: "run-question-dispose",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Yes" },
				},
			}),
		).rejects.toMatchObject({ code: "session_not_found" });
		finish?.({ finishReason: "aborted", text: "" } as AgentResult);
		await running;
	});

	it("refuses callback use when the resident session manifest did not grant it", async () => {
		const { adapter, authority, identity } = fixture();
		const askQuestion = adapter.capabilitiesFor({
			callbacks: [HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY],
		}).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");

		await adapter.runTurn({
			operationId: "run-ungranted-question",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () => {
				await expect(
					askQuestion("Which path?", ["A", "B"], {
						sessionId: "session-1",
						runId: "run-ungranted-question",
						agentId: "agent-1",
						iteration: 1,
					}),
				).rejects.toThrow("Managed runtime capability failed.");
				return { finishReason: "completed", text: "denied" } as AgentResult;
			},
		});
		adapter.dispose();
	});

	it("expires an unresolved callback and emits a fixed cancellation", async () => {
		const { adapter, authority, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
			capabilityTimeoutMs: 10,
		});
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		let callback: Promise<string> | undefined;
		let finish: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-question-timeout",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () => {
				callback = askQuestion("Continue?", ["Yes", "No"], {
					sessionId: "session-1",
					runId: "run-question-timeout",
					agentId: "agent-1",
					iteration: 1,
				});
				return new Promise<AgentResult>((resolve) => {
					finish = resolve;
				});
			},
		});

		await expect(callback).rejects.toThrow(
			"Managed runtime capability failed.",
		);
		expect(
			events.some(
				(event) =>
					(event.payload as { kind?: string; reason?: string } | undefined)
						?.kind === "capability.cancelled" &&
					(event.payload as { reason?: string }).reason ===
						"managed capability timed out",
			),
		).toBe(true);
		finish?.({ finishReason: "completed", text: "done" } as AgentResult);
		await running;
		adapter.dispose();
	});

	it("binds every runtime command and subscription to the session-owning connection", async () => {
		const { adapter, authority, identity } = fixture();
		const otherIdentity = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.invoke({
				identity: otherIdentity,
				signal: authority.signal(otherIdentity),
				command: "chat_runtime.messages.list",
				payload: { sessionId: "session-1" },
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(() =>
			adapter.subscribe({
				identity: otherIdentity,
				signal: authority.signal(otherIdentity),
				sessionId: "session-1",
				emit: vi.fn(),
			}),
		).toThrow("another connection");
		authority.release(otherIdentity);
		adapter.dispose();
	});

	it("classifies only audience-authorized continuity without disclosing resident authority", async () => {
		const fresh = fixture({ registerSession: false });
		await expect(
			fresh.adapter.invoke({
				identity: fresh.identity,
				signal: fresh.authority.signal(fresh.identity),
				command: "chat_runtime.session.continuity",
				payload: { sessionId: "session-1" },
			}),
		).resolves.toEqual({ sessionId: "session-1", state: "not_resident" });
		await expect(
			fresh.adapter.invoke({
				identity: fresh.identity,
				signal: fresh.authority.signal(fresh.identity),
				command: "chat_runtime.session.continuity",
				payload: { sessionId: "session-unknown" },
			}),
		).rejects.toMatchObject({ code: "session_not_found" });

		const owner = new AbortController();
		await fresh.adapter.registerSession(
			"session-1",
			fresh.identity,
			owner.signal,
			1,
		);
		const replacement = fresh.authority.consume({
			credential: fresh.authority.issue({
				principalId: fresh.identity.principalId,
				tenantId: fresh.identity.tenantId,
				workspaceKey: fresh.identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			fresh.adapter.invoke({
				identity: replacement,
				signal: fresh.authority.signal(replacement),
				command: "chat_runtime.session.continuity",
				payload: { sessionId: "session-1" },
			}),
		).resolves.toEqual({ sessionId: "session-1", state: "owned_elsewhere" });

		owner.abort();
		const orphaned = await fresh.adapter.invoke({
			identity: replacement,
			signal: fresh.authority.signal(replacement),
			command: "chat_runtime.session.continuity",
			payload: { sessionId: "session-1" },
		});
		expect(orphaned).toEqual({
			sessionId: "session-1",
			state: "orphaned",
			writerGeneration: 1,
			runtimeBaseline: {
				streamId: expect.stringMatching(/^runtime_stream_/),
				sessionSequence: 0,
			},
		});

		const foreignAudience = Object.freeze({
			...replacement,
			connectionId: "foreign-audience-connection",
			policy: Object.freeze({
				...replacement.policy,
				audienceId: "aud_foreign_v1",
			}),
		});
		expect(() =>
			fresh.adapter.lookupSessionContinuity({
				sessionId: "session-1",
				identity: foreignAudience,
			}),
		).toThrow("does not match the Core authority scope");
		fresh.authority.release(replacement);
		fresh.adapter.dispose();
	});

	it("rejects a stale continuity generation after an intervening reclaim", async () => {
		const { adapter, authority, identity, rekeyManagedSessionAuthority } =
			fixture();
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		await adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		oldOwner.abort();
		const issueReplacement = () =>
			authority.consume({
				credential: authority.issue({
					principalId: identity.principalId,
					tenantId: identity.tenantId,
					workspaceKey: identity.workspaceKey,
				}).credential,
				transport: "websocket",
			});
		const staleCaller = issueReplacement();
		const winner = issueReplacement();
		const continuity = (await adapter.invoke({
			identity: staleCaller,
			signal: authority.signal(staleCaller),
			command: "chat_runtime.session.continuity",
			payload: { sessionId: "session-1" },
		})) as { writerGeneration: number };

		await expect(
			adapter.invoke({
				identity: winner,
				signal: authority.signal(winner),
				command: "chat_runtime.session.reclaim",
				payload: {
					operationId: "intervening-reclaim",
					sessionId: "session-1",
					expectedWriterGeneration: continuity.writerGeneration,
				},
			}),
		).resolves.toMatchObject({ writerGeneration: 2, ownerTransferred: true });
		authority.release(winner);

		await expect(
			adapter.invoke({
				identity: staleCaller,
				signal: authority.signal(staleCaller),
				command: "chat_runtime.session.reclaim",
				payload: {
					operationId: "stale-continuity-reclaim",
					sessionId: "session-1",
					expectedWriterGeneration: continuity.writerGeneration,
				},
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(1);
		authority.release(staleCaller);
		adapter.dispose();
	});

	it("treats a managed-daemon restart as nonresident and starts a new runtime epoch", async () => {
		const original = fixture();
		let oldCursor: { streamId: string; sessionSequence: number } | undefined;
		original.adapter.subscribe({
			identity: original.identity,
			signal: original.authority.signal(original.identity),
			sessionId: "session-1",
			emit: vi.fn(),
			ready: (cursor) => {
				oldCursor = cursor;
			},
		})();
		original.adapter.dispose();

		const restarted = fixture({ registerSession: false });
		await expect(
			restarted.adapter.invoke({
				identity: restarted.identity,
				signal: restarted.authority.signal(restarted.identity),
				command: "chat_runtime.session.continuity",
				payload: { sessionId: "session-1" },
			}),
		).resolves.toEqual({ sessionId: "session-1", state: "not_resident" });
		await restarted.adapter.registerSession(
			"session-1",
			restarted.identity,
			restarted.authority.signal(restarted.identity),
			2,
		);
		expect(() =>
			restarted.adapter.subscribe({
				identity: restarted.identity,
				signal: restarted.authority.signal(restarted.identity),
				sessionId: "session-1",
				cursor: oldCursor,
				emit: vi.fn(),
			}),
		).toThrow("recovery");
		let newCursor: { streamId: string; sessionSequence: number } | undefined;
		restarted.adapter.subscribe({
			identity: restarted.identity,
			signal: restarted.authority.signal(restarted.identity),
			sessionId: "session-1",
			emit: vi.fn(),
			ready: (cursor) => {
				newCursor = cursor;
			},
		})();
		expect(newCursor?.streamId).not.toBe(oldCursor?.streamId);
		expect(newCursor?.sessionSequence).toBe(0);
		restarted.adapter.dispose();
	});

	it("hydrates an exact orphan reclaim before exposing ready or accepting turns", async () => {
		const { adapter, authority, core, identity } = fixture();
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		await adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		oldOwner.abort();
		const continuity = (await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.continuity",
			payload: { sessionId: "session-1" },
		})) as {
			state: "orphaned";
			writerGeneration: number;
			runtimeBaseline: { streamId: string; sessionSequence: number };
		};
		const reclaim = (await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.reclaim",
			payload: {
				operationId: "hydrate-reclaim",
				sessionId: "session-1",
				expectedWriterGeneration: continuity.writerGeneration,
			},
		})) as { writerGeneration: number };
		const hydration = await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.hydrate",
			payload: {
				sessionId: "session-1",
				expectedWriterGeneration: reclaim.writerGeneration,
				baseline: continuity.runtimeBaseline,
			},
		});
		expect(hydration).toMatchObject({
			sessionId: "session-1",
			chatId: "chat-1",
			writerGeneration: 2,
			profileAuthority: {
				profileId: "managed-test-profile",
				authorityClassId: identity.policy.authorityClassId,
				policyEpoch: identity.policy.policyEpoch,
				allowedModes: ["act", "plan"],
			},
			requestedBaseline: continuity.runtimeBaseline,
			replayAvailable: true,
			messages: [
				{ role: "user", text: "inspect this" },
				{ role: "tool", tool: { toolName: "read_file" } },
			],
			pendingPrompts: [{ promptId: "prompt-1", prompt: "queued" }],
			checkpoints: [{ createdAt: 1, runCount: 1, kind: "stash" }],
		});
		const serialized = JSON.stringify(hydration);
		expect(serialized).not.toContain("/tmp/private");
		expect(serialized).not.toContain("refs/cline/private");
		expect(serialized).not.toContain("apiKey");
		expect(serialized).not.toContain("connectionPolicyDigest");
		expect(serialized).not.toContain("executionPolicyDigest");

		await expect(
			adapter.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.messages.list",
				payload: { sessionId: "session-1" },
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		await expect(
			adapter.runTurn({
				operationId: "turn-before-ready",
				sessionId: "session-1",
				identity: replacement,
				signal: authority.signal(replacement),
				run: async () =>
					({
						finishReason: "completed",
						text: "should not run",
					}) as AgentResult,
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(core.readMessages).toHaveBeenCalledTimes(1);

		const ready = vi.fn();
		const release = adapter.subscribe({
			identity: replacement,
			signal: authority.signal(replacement),
			sessionId: "session-1",
			cursor: continuity.runtimeBaseline,
			emit: vi.fn(),
			ready,
		});
		expect(ready).toHaveBeenCalledOnce();
		await expect(
			adapter.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.messages.list",
				payload: { sessionId: "session-1" },
			}),
		).resolves.toMatchObject({ sessionId: "session-1" });
		release();
		authority.release(replacement);
		adapter.dispose();
	});

	it("reports hydration replay loss for an evicted pre-reclaim baseline", async () => {
		const oldOwner = new AbortController();
		const { adapter, authority, identity } = fixture({
			connectionSignal: oldOwner.signal,
			recoveryJournal: { maxSessionEvents: 2 },
		});
		let staleBaseline:
			| { streamId: string; sessionSequence: number }
			| undefined;
		const releaseInitial = adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: vi.fn(),
			ready: (cursor) => {
				staleBaseline = cursor;
			},
		});
		for (const operationId of ["evict-baseline-1", "evict-baseline-2"]) {
			await adapter.runTurn({
				operationId,
				sessionId: "session-1",
				identity,
				signal: authority.signal(identity),
				run: async () =>
					({ finishReason: "completed", text: "done" }) as AgentResult,
			});
		}
		releaseInitial();
		oldOwner.abort();
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		const continuity = (await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.continuity",
			payload: { sessionId: "session-1" },
		})) as { writerGeneration: number };
		const reclaim = (await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.reclaim",
			payload: {
				operationId: "stale-baseline-reclaim",
				sessionId: "session-1",
				expectedWriterGeneration: continuity.writerGeneration,
			},
		})) as { writerGeneration: number };
		const hydration = await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.hydrate",
			payload: {
				sessionId: "session-1",
				expectedWriterGeneration: reclaim.writerGeneration,
				baseline: staleBaseline,
			},
		});
		expect(hydration).toMatchObject({
			replayAvailable: false,
			requestedBaseline: staleBaseline,
		});
		authority.release(replacement);
		adapter.dispose();
	});

	it("durably transitions one disconnected session owner and replays the receipt", async () => {
		const { adapter, authority, identity, rekeyManagedSessionAuthority } =
			fixture();
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.transitionSessionOwner({
				operationId: "owner-transition-1",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
				identity: replacement,
				signal: authority.signal(replacement),
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(rekeyManagedSessionAuthority).not.toHaveBeenCalled();

		oldOwner.abort();
		const transitioned = await adapter.transitionSessionOwner({
			operationId: "owner-transition-1",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
			identity: replacement,
			signal: authority.signal(replacement),
		});
		const replayed = await adapter.transitionSessionOwner({
			operationId: "owner-transition-1",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
			identity: replacement,
			signal: authority.signal(replacement),
		});

		expect(transitioned).toMatchObject({
			sessionId: "session-1",
			writerGeneration: 2,
			ownerTransferred: true,
		});
		expect(replayed).toEqual(transitioned);
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(1);
		expect(() => adapter.assertSessionOwner("session-1", identity)).toThrow();
		expect(() =>
			adapter.assertSessionOwner("session-1", replacement),
		).not.toThrow();
		const releaseReplacement = adapter.subscribe({
			identity: replacement,
			signal: authority.signal(replacement),
			sessionId: "session-1",
			emit: vi.fn(),
		});
		await expect(
			adapter.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.messages.list",
				payload: { sessionId: "session-1" },
			}),
		).resolves.toMatchObject({ sessionId: "session-1" });
		releaseReplacement();
		authority.release(replacement);
		adapter.dispose();
	});

	it("dispatches the strict token-free resident reclaim command", async () => {
		const { adapter, authority, identity, rekeyManagedSessionAuthority } =
			fixture();
		const oldOwner = new AbortController();
		oldOwner.abort();
		adapter.unregisterSession("session-1");
		adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});

		const result = await adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.reclaim",
			payload: {
				operationId: "strict-reclaim",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
			},
		});

		expect(result).toMatchObject({
			sessionId: "session-1",
			leaseRevision: 2,
			writerGeneration: 2,
			ownerTransferred: true,
		});
		expect(JSON.stringify(result)).not.toContain("leaseToken");
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(1);
		authority.release(replacement);
		adapter.dispose();
	});

	it("orphan-fences an exact reclaim cancelled before or after its durable commit", async () => {
		const { adapter, authority, identity, rekeyManagedSessionAuthority } =
			fixture();
		const oldOwner = new AbortController();
		oldOwner.abort();
		adapter.unregisterSession("session-1");
		adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		let announceRekey: (() => void) | undefined;
		const rekeyStarted = new Promise<void>((resolve) => {
			announceRekey = resolve;
		});
		rekeyManagedSessionAuthority.mockImplementationOnce(
			(input) =>
				new Promise((_resolve, reject) => {
					announceRekey?.();
					input.signal?.addEventListener(
						"abort",
						() => reject(input.signal?.reason ?? new Error("cancelled")),
						{ once: true },
					);
				}),
		);
		const reclaimPayload = {
			operationId: "reclaim-cancel-in-flight",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
		};
		const reclaim = adapter.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_runtime.session.reclaim",
			payload: reclaimPayload,
		});
		await rekeyStarted;
		const foreign = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.invoke({
				identity: foreign,
				signal: authority.signal(foreign),
				command: "chat_runtime.session.reclaim.cancel",
				payload: reclaimPayload,
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });

		await expect(
			adapter.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.session.reclaim.cancel",
				payload: reclaimPayload,
			}),
		).resolves.toMatchObject({
			writerGeneration: 1,
			cancellationAccepted: true,
		});
		await expect(reclaim).rejects.toBeDefined();
		expect(() => adapter.assertSessionOwner("session-1", replacement)).toThrow(
			"no live connection owner",
		);

		const successor = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		const committedPayload = {
			operationId: "reclaim-cancel-after-commit",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
		};
		await expect(
			adapter.invoke({
				identity: successor,
				signal: authority.signal(successor),
				command: "chat_runtime.session.reclaim",
				payload: committedPayload,
			}),
		).resolves.toMatchObject({
			writerGeneration: 2,
			ownerTransferred: true,
		});
		await expect(
			adapter.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.session.reclaim.cancel",
				payload: committedPayload,
			}),
		).rejects.toMatchObject({ code: "invocation_replay_conflict" });
		await expect(
			adapter.invoke({
				identity: successor,
				signal: authority.signal(successor),
				command: "chat_runtime.session.reclaim.cancel",
				payload: committedPayload,
			}),
		).resolves.toMatchObject({
			writerGeneration: 2,
			cancellationAccepted: true,
		});
		expect(() => adapter.assertSessionOwner("session-1", successor)).toThrow(
			"no live connection owner",
		);
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(2);
		authority.release(foreign);
		authority.release(replacement);
		authority.release(successor);
		adapter.dispose();
	});

	it("retains exact cancellation authority after the bounded receipt is evicted", async () => {
		const {
			adapter,
			authority,
			capabilityManifest,
			identity,
			rekeyManagedSessionAuthority,
		} = fixture({ ownerTransitionReceiptLimit: 1 });
		const firstOldOwner = new AbortController();
		firstOldOwner.abort();
		adapter.unregisterSession("session-1");
		adapter.registerSession(
			"session-1",
			identity,
			firstOldOwner.signal,
			1,
			capabilityManifest,
		);
		const firstReplacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		const firstPayload = {
			operationId: "reclaim-before-receipt-eviction",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
		};
		await expect(
			adapter.invoke({
				identity: firstReplacement,
				signal: authority.signal(firstReplacement),
				command: "chat_runtime.session.reclaim",
				payload: firstPayload,
			}),
		).resolves.toMatchObject({ writerGeneration: 2, ownerTransferred: true });

		const secondOldOwner = new AbortController();
		secondOldOwner.abort();
		adapter.registerSession(
			"session-2",
			identity,
			secondOldOwner.signal,
			1,
			capabilityManifest,
		);
		const secondReplacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.invoke({
				identity: secondReplacement,
				signal: authority.signal(secondReplacement),
				command: "chat_runtime.session.reclaim",
				payload: {
					operationId: "reclaim-causing-receipt-eviction",
					sessionId: "session-2",
					expectedWriterGeneration: 1,
				},
			}),
		).resolves.toMatchObject({ writerGeneration: 2, ownerTransferred: true });

		await expect(
			adapter.invoke({
				identity: firstReplacement,
				signal: authority.signal(firstReplacement),
				command: "chat_runtime.session.reclaim.cancel",
				payload: firstPayload,
			}),
		).resolves.toMatchObject({
			writerGeneration: 2,
			cancellationAccepted: true,
		});
		expect(() =>
			adapter.assertSessionOwner("session-1", firstReplacement),
		).toThrow("no live connection owner");
		expect(() =>
			adapter.assertSessionOwner("session-2", secondReplacement),
		).not.toThrow();
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(2);

		authority.release(firstReplacement);
		authority.release(secondReplacement);
		adapter.dispose();
	});

	it("orphan-fences a rekeyed session when the incoming owner disconnects", async () => {
		const { adapter, authority, identity, rekeyManagedSessionAuthority } =
			fixture();
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		oldOwner.abort();
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		const replacementSignal = new AbortController();
		let finishRekey: (() => void) | undefined;
		let announceRekey: (() => void) | undefined;
		const rekeyStarted = new Promise<void>((resolve) => {
			announceRekey = resolve;
		});
		const rekeyGate = new Promise<void>((resolve) => {
			finishRekey = resolve;
		});
		rekeyManagedSessionAuthority.mockImplementationOnce(async (input) => {
			announceRekey?.();
			await rekeyGate;
			return {
				sessionId: input.sessionId,
				leaseRevision: 2,
				writerGeneration: 2,
				leaseExpiresAt: "2026-08-15T12:02:00.000Z",
			};
		});
		const transition = adapter.transitionSessionOwner({
			operationId: "owner-transition-orphaned",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
			identity: replacement,
			signal: replacementSignal.signal,
		});
		await rekeyStarted;
		replacementSignal.abort();
		finishRekey?.();

		await expect(transition).rejects.toMatchObject({ code: "lease_conflict" });
		expect(() => adapter.assertSessionOwner("session-1", replacement)).toThrow(
			"no live connection owner",
		);

		const successor = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		await expect(
			adapter.transitionSessionOwner({
				operationId: "owner-transition-orphaned",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
				identity: successor,
				signal: authority.signal(successor),
			}),
		).resolves.toMatchObject({
			writerGeneration: 2,
			ownerTransferred: false,
		});
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(1);
		await expect(
			adapter.transitionSessionOwner({
				operationId: "owner-transition-from-orphan",
				sessionId: "session-1",
				expectedWriterGeneration: 2,
				identity: successor,
				signal: authority.signal(successor),
			}),
		).resolves.toMatchObject({
			writerGeneration: 3,
			ownerTransferred: true,
		});
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(2);
		expect(() =>
			adapter.assertSessionOwner("session-1", successor),
		).not.toThrow();
		authority.release(replacement);
		authority.release(successor);
		adapter.dispose();
	});

	it("coalesces identical owner transitions and fences lifecycle admission until commit", async () => {
		const { adapter, authority, identity, rekeyManagedSessionAuthority } =
			fixture();
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		oldOwner.abort();
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		let finishRekey: (() => void) | undefined;
		let announceRekey: (() => void) | undefined;
		const rekeyStarted = new Promise<void>((resolve) => {
			announceRekey = resolve;
		});
		const rekeyGate = new Promise<void>((resolve) => {
			finishRekey = resolve;
		});
		rekeyManagedSessionAuthority.mockImplementationOnce(async (input) => {
			announceRekey?.();
			await rekeyGate;
			return {
				sessionId: input.sessionId,
				leaseRevision: 2,
				writerGeneration: 2,
				leaseExpiresAt: "2026-08-15T12:02:00.000Z",
			};
		});
		const transitionInput = {
			operationId: "owner-transition-coalesced",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
			identity: replacement,
			signal: authority.signal(replacement),
		};
		const first = adapter.transitionSessionOwner(transitionInput);
		await rekeyStarted;
		const replay = adapter.transitionSessionOwner(transitionInput);
		await expect(
			adapter.transitionSessionOwner({
				...transitionInput,
				operationId: "owner-transition-conflict",
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(() => adapter.assertSessionOwner("session-1", identity)).toThrow(
			"transition is active",
		);
		expect(() => adapter.assertSessionOwner("session-1", replacement)).toThrow(
			"transition is active",
		);
		finishRekey?.();

		await expect(first).resolves.toMatchObject({ writerGeneration: 2 });
		await expect(replay).resolves.toMatchObject({ writerGeneration: 2 });
		expect(rekeyManagedSessionAuthority).toHaveBeenCalledTimes(1);
		authority.release(replacement);
		adapter.dispose();
	});

	it("aborts an orphaned active run and requires reclaim to retry after settlement", async () => {
		const {
			abort,
			adapter,
			authority,
			identity,
			rekeyManagedSessionAuthority,
		} = fixture();
		const oldOwner = new AbortController();
		adapter.unregisterSession("session-1");
		adapter.registerSession("session-1", identity, oldOwner.signal, 1);
		let finishRun: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "orphaned-run",
			sessionId: "session-1",
			identity,
			signal: oldOwner.signal,
			run: () =>
				new Promise<AgentResult>((resolve) => {
					finishRun = resolve;
				}),
		});
		oldOwner.abort();
		const replacement = authority.consume({
			credential: authority.issue({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
			}).credential,
			transport: "websocket",
		});
		const transitionInput = {
			operationId: "owner-transition-after-run",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
			identity: replacement,
			signal: authority.signal(replacement),
		};

		await expect(
			adapter.transitionSessionOwner(transitionInput),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(abort).toHaveBeenCalledWith(
			"session-1",
			"managed connection disconnected or was revoked",
		);
		expect(rekeyManagedSessionAuthority).not.toHaveBeenCalled();
		finishRun?.({ finishReason: "aborted", text: "" } as AgentResult);
		await running;
		await expect(
			adapter.transitionSessionOwner(transitionInput),
		).resolves.toMatchObject({ writerGeneration: 2 });
		authority.release(replacement);
		adapter.dispose();
	});

	it("suppresses events for sessions outside the managed registry", () => {
		const { adapter, authority, emit, identity } = fixture();
		const events: unknown[] = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			emit: (event) => events.push(event),
		});
		emit({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "legacy-session",
				id: "legacy-prompt",
				prompt: "private legacy prompt",
				delivery: "queue",
				attachmentCount: 0,
			},
		});
		expect(events).toEqual([]);
		adapter.dispose();
	});

	it("rejects detached events and approvals from an earlier run generation", async () => {
		vi.useFakeTimers();
		const { adapter, authority, emit, identity } = fixture();
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		let staleApproval:
			| Promise<
					Awaited<ReturnType<typeof adapter.capabilities.requestToolApproval>>
			  >
			| undefined;
		await adapter.runTurn({
			operationId: "run-old",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: async () => {
				setTimeout(() => {
					emit({
						type: "agent_event",
						payload: {
							sessionId: "session-1",
							event: {
								type: "content_start",
								contentType: "text",
								text: "stale text",
							},
						},
					});
					staleApproval = adapter.capabilities.requestToolApproval({
						sessionId: "session-1",
						agentId: "agent-1",
						conversationId: "conversation-1",
						iteration: 1,
						toolCallId: "stale-tool",
						toolName: "write_file",
						input: {},
						policy: { autoApprove: false },
					});
				}, 10);
				return { finishReason: "completed", text: "old" } as AgentResult;
			},
		});
		let finishNew: ((result: AgentResult) => void) | undefined;
		const newRun = adapter.runTurn({
			operationId: "run-new",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () =>
				new Promise<AgentResult>((resolve) => {
					finishNew = resolve;
				}),
		});
		await vi.advanceTimersByTimeAsync(10);
		await expect(staleApproval).resolves.toMatchObject({ approved: false });
		expect(JSON.stringify(events)).not.toContain("stale text");
		expect(JSON.stringify(events)).not.toContain("stale-tool");
		finishNew?.({ finishReason: "completed", text: "new" } as AgentResult);
		await newRun;
		adapter.dispose();
		vi.useRealTimers();
	});

	it("fences and aborts an active run when its connection signal closes", async () => {
		const { abort, adapter, capabilityManifest, identity } = fixture({
			grantAskQuestion: true,
		});
		const connection = new AbortController();
		let finish: ((result: AgentResult) => void) | undefined;
		let callback: Promise<string> | undefined;
		const askQuestion =
			adapter.capabilitiesFor(capabilityManifest).toolExecutors?.askQuestion;
		if (!askQuestion) throw new Error("missing ask-question capability");
		const running = adapter.runTurn({
			operationId: "run-disconnect",
			sessionId: "session-1",
			identity,
			signal: connection.signal,
			run: () => {
				callback = askQuestion("Continue?", ["Yes", "No"], {
					sessionId: "session-1",
					runId: "run-disconnect",
					agentId: "agent-1",
					iteration: 1,
				});
				return new Promise<AgentResult>((resolve) => {
					finish = resolve;
				});
			},
		});
		connection.abort();
		await vi.waitFor(() =>
			expect(abort).toHaveBeenCalledWith(
				"session-1",
				"managed connection disconnected or was revoked",
			),
		);
		await expect(callback).rejects.toThrow(
			"Managed runtime capability failed.",
		);
		await expect(
			adapter.capabilities.requestToolApproval({
				sessionId: "session-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 1,
				toolCallId: "late-tool",
				toolName: "write_file",
				input: {},
				policy: { autoApprove: false },
			}),
		).resolves.toMatchObject({ approved: false });
		finish?.({ finishReason: "aborted", text: "" } as AgentResult);
		await running;
		adapter.dispose();
	});

	it("projects fixed safe failures instead of provider or filesystem errors", async () => {
		const { adapter, authority, emit, identity } = fixture();
		const events: unknown[] = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event),
		});
		await expect(
			adapter.runTurn({
				operationId: "run-error",
				sessionId: "session-1",
				identity,
				signal: authority.signal(identity),
				run: async () => {
					emit({
						type: "agent_event",
						payload: {
							sessionId: "session-1",
							event: {
								type: "content_end",
								contentType: "tool",
								toolCallId: "tool-1",
								toolName: "read_file",
								error: "ENOENT /Users/private/provider-key",
							},
						},
					});
					throw new Error("provider https://secret.example token=private");
				},
			}),
		).rejects.toThrow();
		const serialized = JSON.stringify(events);
		expect(serialized).not.toContain("/Users/private");
		expect(serialized).not.toContain("secret.example");
		expect(serialized).toContain("Tool execution failed.");
		expect(serialized).toContain("Managed run failed.");
		adapter.dispose();
	});

	it("emits bounded heartbeats only while the owning run is active", async () => {
		vi.useFakeTimers();
		const { adapter, authority, identity } = fixture();
		const events: Array<Record<string, unknown>> = [];
		adapter.subscribe({
			identity,
			signal: authority.signal(identity),
			sessionId: "session-1",
			emit: (event) => events.push(event as Record<string, unknown>),
		});
		let finish: ((result: AgentResult) => void) | undefined;
		const running = adapter.runTurn({
			operationId: "run-heartbeat",
			sessionId: "session-1",
			identity,
			signal: authority.signal(identity),
			run: () =>
				new Promise<AgentResult>((resolve) => {
					finish = resolve;
				}),
		});
		await vi.advanceTimersByTimeAsync(15_000);
		expect(
			events.filter(
				(event) =>
					(event.payload as { kind?: string }).kind === "run.heartbeat",
			),
		).toHaveLength(1);
		finish?.({ finishReason: "completed", text: "done" } as AgentResult);
		await running;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(
			events.filter(
				(event) =>
					(event.payload as { kind?: string }).kind === "run.heartbeat",
			),
		).toHaveLength(1);
		adapter.dispose();
		vi.useRealTimers();
	});
});
