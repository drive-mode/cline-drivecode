import {
	CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE,
	type HubCommandName,
	type HubEventEnvelope,
	type HubReplyEnvelope,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { HubChatLifecycleClientTransport } from "./chat-lifecycle-client";
import type { HubChatRuntimeClientTransport } from "./chat-runtime-client";
import {
	MANAGED_HUB_CHAT_REQUIRED_CAPABILITIES,
	ManagedHubChatClient,
	ManagedHubChatClientError,
	type ManagedHubChatProjectionSnapshot,
	type ManagedHubChatRuntimeEvent,
	type ManagedHubChatTransport,
	type ManagedHubWorkspaceCapabilityProvider,
} from "./managed-chat-client";

const PROJECTION_CHAT = {
	chatId: "chat-history",
	catalogState: "active",
	headSessionId: "session-history",
	title: "History chat",
	titleSource: "owner",
	sourceKind: "interactive",
	createdAt: "2026-08-15T10:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	revision: 1,
	sessionCount: 1,
	bindingCount: 0,
	sessions: [
		{
			chatId: "chat-history",
			sessionId: "session-history",
			relationKind: "root",
			ordinal: 0,
			attachedAt: "2026-08-15T10:00:00.000Z",
			executionStatus: "idle",
		},
	],
	bindings: [],
} as const;

const LIFECYCLE_CHAT = {
	chatId: "chat-1",
	catalogState: "active",
	headSessionId: "session-1",
	title: "Managed chat",
	titleSource: "owner",
	sourceKind: "interactive",
	createdAt: "2026-08-15T10:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	revision: 1,
	sessions: [
		{
			chatId: "chat-1",
			sessionId: "session-1",
			relationKind: "root",
			ordinal: 0,
			attachedAt: "2026-08-15T10:00:00.000Z",
			executionStatus: "idle",
		},
	],
	bindings: [],
} as const;

const PROFILE_AUTHORITY = {
	profileId: "profile-managed-default",
	profileRevision: 1,
	authorityClassId: "cline.chat.authority.interactive-owner.v1",
	policyEpoch: 0,
	allowedModes: ["act", "plan", "yolo"] as const,
};

type LifecycleSubscriptionOptions = NonNullable<
	Parameters<HubChatLifecycleClientTransport["subscribe"]>[1]
>;
type RuntimeSubscriptionOptions = NonNullable<
	Parameters<HubChatRuntimeClientTransport["subscribe"]>[1]
>;

interface FakeSubscription {
	readonly listener: (event: HubEventEnvelope) => void;
	readonly options: unknown;
	readonly kind: "lifecycle" | "runtime" | "other";
	readonly sessionId?: string;
	active: boolean;
}

interface FakeCommandCall {
	readonly command: HubCommandName;
	readonly payload?: Record<string, unknown>;
	readonly requiredConnectionGeneration?: number;
}

class FakeManagedHubTransport implements ManagedHubChatTransport {
	readonly commands: FakeCommandCall[] = [];
	readonly subscriptions: FakeSubscription[] = [];
	connected = false;
	connectionGeneration = 0;
	disposeCount = 0;
	autoLifecycleReady = true;
	autoRuntimeReady = true;
	continuityState: "not_resident" | "owned_elsewhere" | "orphaned" =
		"not_resident";
	continuityWriterGeneration = 1;
	continuityBaseline = {
		streamId: "stream-session-1",
		sessionSequence: 0,
	};
	hydrationReplayAvailable = true;
	nextCommandFailure: Error | undefined;
	nextReclaimFailure: Error | undefined;
	nextCommandGate: Promise<void> | undefined;
	disposeGate: Promise<void> | undefined;
	disposeFailure: Error | undefined;
	synchronousDisposeFailure: Error | undefined;
	onCommand: ((command: HubCommandName) => void) | undefined;
	readonly #provider: ManagedHubWorkspaceCapabilityProvider;

	constructor(provider: ManagedHubWorkspaceCapabilityProvider) {
		this.#provider = provider;
	}

	async connect(): Promise<void> {
		if (this.connected) return;
		await this.#provider.getFreshCapability({
			hubUrl: "ws://127.0.0.1:4321/hub",
			clientId: "managed-test-client",
		});
		this.connected = true;
		this.connectionGeneration += 1;
	}

	isConnected(): boolean {
		return this.connected;
	}

	getRegisteredConnectionGeneration(): number | undefined {
		return this.connected ? this.connectionGeneration : undefined;
	}

	async command(
		command: HubCommandName,
		payload?: Record<string, unknown>,
		_sessionId?: string,
		options?: {
			timeoutMs?: number | null;
			requiredConnectionGeneration?: number;
		},
	): Promise<HubReplyEnvelope> {
		if (
			options?.requiredConnectionGeneration !== undefined &&
			options.requiredConnectionGeneration !== this.connectionGeneration
		) {
			throw Object.assign(new Error("connection changed"), {
				code: "hub_connection_changed",
			});
		}
		this.commands.push({
			command,
			payload,
			requiredConnectionGeneration: options?.requiredConnectionGeneration,
		});
		this.onCommand?.(command);
		if (this.nextCommandGate) {
			const gate = this.nextCommandGate;
			this.nextCommandGate = undefined;
			await gate;
		}
		if (this.nextCommandFailure) {
			const failure = this.nextCommandFailure;
			this.nextCommandFailure = undefined;
			throw failure;
		}
		if (command === "chat_runtime.session.reclaim" && this.nextReclaimFailure) {
			const failure = this.nextReclaimFailure;
			this.nextReclaimFailure = undefined;
			throw failure;
		}
		return successReply(this.result(command, payload));
	}

	subscribe(
		listener: (event: HubEventEnvelope) => void,
		options?: unknown,
	): () => void {
		const record = (options ?? {}) as {
			sessionId?: string;
			lifecycleCursor?: () => { afterSequence: number };
			runtimeCursor?: () =>
				| { streamId: string; sessionSequence: number }
				| undefined;
		};
		const kind = record.lifecycleCursor
			? "lifecycle"
			: record.runtimeCursor
				? "runtime"
				: "other";
		const subscription: FakeSubscription = {
			listener,
			options,
			kind,
			sessionId: record.sessionId,
			active: true,
		};
		this.subscriptions.push(subscription);
		if (kind === "lifecycle" && this.autoLifecycleReady) {
			queueMicrotask(() => this.readyLifecycle(subscription));
		}
		if (kind === "runtime" && this.autoRuntimeReady) {
			queueMicrotask(() => this.readyRuntime(subscription));
		}
		return () => {
			subscription.active = false;
		};
	}

	readyLifecycle(subscription = this.latest("lifecycle")): void {
		if (!subscription?.active) return;
		const options = subscription.options as LifecycleSubscriptionOptions;
		const afterSequence = options.lifecycleCursor?.().afterSequence ?? 0;
		options.onStatus?.({
			status: "ready",
			lifecycleReady: {
				version: "v1",
				stream: "chat.changed",
				afterSequence,
				throughSequence: afterSequence,
			},
		});
	}

	rejectLifecycle(errorCode: string): void {
		const subscription = this.latest("lifecycle");
		if (!subscription?.active) return;
		const options = subscription.options as LifecycleSubscriptionOptions;
		options.onStatus?.({ status: "rejected", errorCode });
	}

	readyRuntime(subscription = this.latest("runtime")): void {
		if (!subscription?.active) return;
		const options = subscription.options as RuntimeSubscriptionOptions;
		const cursor = options.runtimeCursor?.() ?? {
			streamId: `stream-${subscription.sessionId ?? "unknown"}`,
			sessionSequence: 0,
		};
		options.onStatus?.({ status: "ready", runtimeCursor: cursor });
	}

	emitLifecycle(event: HubEventEnvelope): void {
		this.latest("lifecycle")?.listener(event);
	}

	emitRuntime(sessionId: string, event: HubEventEnvelope): void {
		[...this.subscriptions]
			.reverse()
			.find(
				(subscription) =>
					subscription.active &&
					subscription.kind === "runtime" &&
					subscription.sessionId === sessionId,
			)
			?.listener(event);
	}

	latest(kind: FakeSubscription["kind"]): FakeSubscription | undefined {
		return [...this.subscriptions]
			.reverse()
			.find(
				(subscription) => subscription.active && subscription.kind === kind,
			);
	}

	dispose(): Promise<void> {
		this.disposeCount += 1;
		if (this.synchronousDisposeFailure) {
			throw this.synchronousDisposeFailure;
		}
		return this.finishDispose();
	}

	private async finishDispose(): Promise<void> {
		await this.disposeGate;
		this.connected = false;
		for (const subscription of this.subscriptions) subscription.active = false;
		if (this.disposeFailure) throw this.disposeFailure;
	}

	private result(
		command: HubCommandName,
		payload: Record<string, unknown> | undefined,
	): unknown {
		switch (command) {
			case "chat_projection.list":
				return {
					snapshotId: "snapshot-1",
					snapshotSequence: 10,
					chats: [PROJECTION_CHAT],
					hasMore: false,
				};
			case "chat_projection.get":
				return {
					snapshotId: "snapshot-get",
					snapshotSequence: 10,
					chat:
						payload?.chatId === PROJECTION_CHAT.chatId ? PROJECTION_CHAT : null,
				};
			case "chat_lifecycle.start_root":
			case "chat_lifecycle.start_related":
			case "chat_lifecycle.resume":
			case "chat_lifecycle.recover_lost_lease":
				return {
					sessionId: String(payload?.sessionId),
					chatId: String(payload?.chatId ?? "chat-1"),
					leaseRevision: 1,
					writerGeneration: 1,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
					profileAuthority: PROFILE_AUTHORITY,
				};
			case "chat_lifecycle.restore_checkpoint":
				return {
					sessionId: String(payload?.sessionId),
					chatId: String(payload?.chatId),
					leaseRevision: 1,
					writerGeneration: 1,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
					profileAuthority: PROFILE_AUTHORITY,
					checkpoint: { createdAt: 1, runCount: 1 },
					restoredMessageCount: 1,
				};
			case "chat_lifecycle.rename":
			case "chat_lifecycle.archive":
			case "chat_lifecycle.activate":
				return {
					...LIFECYCLE_CHAT,
					chatId: String(payload?.chatId),
					title:
						command === "chat_lifecycle.rename"
							? String(payload?.title)
							: LIFECYCLE_CHAT.title,
				};
			case "chat_lifecycle.run_turn":
				return { turn: null };
			case "chat_lifecycle.stop":
				return { stopped: true };
			case "chat_lifecycle.reset":
			case "chat_lifecycle.binding.get":
				return null;
			case "chat_runtime.session.continuity":
				return this.continuityState === "orphaned"
					? {
							sessionId: String(payload?.sessionId),
							state: "orphaned",
							writerGeneration: this.continuityWriterGeneration,
							runtimeBaseline: this.continuityBaseline,
						}
					: {
							sessionId: String(payload?.sessionId),
							state: this.continuityState,
						};
			case "chat_runtime.session.reclaim": {
				const writerGeneration = Number(payload?.expectedWriterGeneration) + 1;
				return {
					sessionId: String(payload?.sessionId),
					leaseRevision: writerGeneration,
					writerGeneration,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
					ownerTransferred: true,
				};
			}
			case "chat_runtime.session.reclaim.cancel":
				return {
					operationId: String(payload?.operationId),
					sessionId: String(payload?.sessionId),
					writerGeneration: Number(payload?.expectedWriterGeneration) + 1,
					cancellationAccepted: true,
				};
			case "chat_runtime.session.hydrate":
				return {
					sessionId: String(payload?.sessionId),
					chatId: "chat-1",
					writerGeneration: Number(payload?.expectedWriterGeneration),
					profileAuthority: PROFILE_AUTHORITY,
					requestedBaseline: payload?.baseline,
					runtimeBaseline: payload?.baseline,
					replayAvailable: this.hydrationReplayAvailable,
					messages: [
						{
							messageId: "message-1",
							sequence: 1,
							role: "user",
							text: "sanitized history",
							attachments: [],
						},
					],
					messagesTruncated: false,
					pendingPrompts: [],
					pendingPromptsTruncated: false,
					checkpoints: [],
					checkpointsTruncated: false,
					compaction: null,
				};
			case "chat_runtime.approval.respond":
				return {
					sessionId: String(payload?.sessionId),
					operationId: String(payload?.operationId),
					runId: String(payload?.runId),
					approvalId: String(payload?.approvalId),
					decision: payload?.decision,
				};
			case "chat_runtime.capability.respond":
				return {
					sessionId: String(payload?.sessionId),
					operationId: String(payload?.operationId),
					runId: String(payload?.runId),
					requestId: String(payload?.requestId),
					accepted: true,
				};
			case "chat_runtime.pending_prompts.list":
				return {
					sessionId: String(payload?.sessionId),
					prompts: [],
					hasMore: false,
				};
			case "chat_runtime.pending_prompts.update": {
				const prompt = {
					promptId: String(payload?.promptId),
					prompt: String(payload?.prompt ?? "queued prompt"),
					delivery: payload?.delivery ?? "queue",
					attachments: [],
				};
				return {
					sessionId: String(payload?.sessionId),
					prompts: [prompt],
					prompt,
					updated: true,
					hasMore: false,
				};
			}
			case "chat_runtime.pending_prompts.remove":
				return {
					sessionId: String(payload?.sessionId),
					prompts: [],
					removed: true,
					hasMore: false,
				};
			default:
				throw new Error(`Unexpected fake command: ${command}`);
		}
	}
}

function successReply(result: unknown): HubReplyEnvelope {
	return { version: "v1", ok: true, payload: { result } };
}

function capabilityMetadata() {
	return {
		protocolVersion: "v1",
		capabilities: [...MANAGED_HUB_CHAT_REQUIRED_CAPABILITIES],
	};
}

function harness(
	options: {
		maxResidentSessions?: number;
		projectionPageSize?: number;
		autoLifecycleReady?: boolean;
		autoRuntimeReady?: boolean;
		onProjectionChange?: (
			snapshot: ManagedHubChatProjectionSnapshot,
		) => void | Promise<void>;
		onError?: (error: ManagedHubChatClientError) => void | Promise<void>;
		initialCommandFailure?: Error;
		disposeFailure?: Error;
	} = {},
) {
	const capability = vi.fn(async () => ({ credential: "x".repeat(43) }));
	const provider = {
		getFreshCapability: capability,
	} satisfies ManagedHubWorkspaceCapabilityProvider;
	let transport: FakeManagedHubTransport | undefined;
	const transportFactory = vi.fn(
		(input: {
			workspaceCapabilityProvider: ManagedHubWorkspaceCapabilityProvider;
		}) => {
			transport = new FakeManagedHubTransport(
				input.workspaceCapabilityProvider,
			);
			transport.autoLifecycleReady = options.autoLifecycleReady ?? true;
			transport.autoRuntimeReady = options.autoRuntimeReady ?? true;
			transport.nextCommandFailure = options.initialCommandFailure;
			transport.disposeFailure = options.disposeFailure;
			return transport;
		},
	);
	return {
		capability,
		provider,
		transportFactory,
		get transport() {
			if (!transport) throw new Error("transport was not created");
			return transport;
		},
		create: () =>
			ManagedHubChatClient.create({
				capabilityProbe: capabilityMetadata,
				workspaceCapabilityProvider: provider,
				transportFactory,
				maxResidentSessions: options.maxResidentSessions,
				projectionPageSize: options.projectionPageSize,
				readinessTimeoutMs: 1_000,
				onProjectionChange: options.onProjectionChange,
				onError: options.onError,
			}),
	};
}

describe("ManagedHubChatClient", () => {
	it("fails capability preflight before capability issuance or transport creation", async () => {
		const capability = vi.fn(async () => ({ credential: "x".repeat(43) }));
		const transportFactory = vi.fn();
		await expect(
			ManagedHubChatClient.create({
				capabilityProbe: () => ({
					protocolVersion: "v1",
					capabilities: ["chat_lifecycle.v1", "chat_runtime.v1"],
				}),
				workspaceCapabilityProvider: { getFreshCapability: capability },
				transportFactory,
			}),
		).rejects.toEqual(expect.objectContaining({ code: "missing_capability" }));
		expect(transportFactory).not.toHaveBeenCalled();
		expect(capability).not.toHaveBeenCalled();
	});

	it("sanitizes an unavailable public capability probe before authority use", async () => {
		const capability = vi.fn(async () => ({ credential: "x".repeat(43) }));
		const transportFactory = vi.fn();
		await expect(
			ManagedHubChatClient.create({
				capabilityProbe: () => undefined,
				workspaceCapabilityProvider: { getFreshCapability: capability },
				transportFactory,
			}),
		).rejects.toEqual(expect.objectContaining({ code: "incompatible_hub" }));
		expect(transportFactory).not.toHaveBeenCalled();
		expect(capability).not.toHaveBeenCalled();
	});

	it("rejects daemon-token and authority-selector configuration fields", async () => {
		for (const forbidden of [
			{ authToken: "daemon-secret" },
			{ authorityClassId: "interactive" },
			{ audienceId: "caller-selected" },
		]) {
			const options = {
				capabilityProbe: capabilityMetadata,
				workspaceCapabilityProvider: {
					getFreshCapability: async () => ({ credential: "x".repeat(43) }),
				},
				transportFactory: vi.fn(),
				...forbidden,
			};
			await expect(
				ManagedHubChatClient.create(
					options as Parameters<typeof ManagedHubChatClient.create>[0],
				),
			).rejects.toBeInstanceOf(ManagedHubChatClientError);
			expect(options.transportFactory).not.toHaveBeenCalled();
		}
	});

	it("hydrates and reconciles projection before becoming ready", async () => {
		const test = harness();
		const client = await test.create();
		expect(test.transportFactory).toHaveBeenCalledOnce();
		expect(test.capability).toHaveBeenCalledOnce();
		expect(client.getSnapshot()).toMatchObject({
			state: "ready",
			residentSessionIds: [],
			projection: {
				snapshotId: "snapshot-1",
				snapshotSequence: 10,
				checkpoint: 10,
			},
		});
		expect(test.transport.commands[0]).toMatchObject({
			command: "chat_projection.list",
			requiredConnectionGeneration: 1,
		});
		expect(
			test.transport.commands.some((entry) =>
				entry.command.startsWith("chat_catalog."),
			),
		).toBe(false);
		await client.dispose();
		expect(test.transport.disposeCount).toBe(1);
	});

	it("keeps the reconciled projection bounded and activity ordered", async () => {
		const test = harness({ projectionPageSize: 1 });
		const client = await test.create();
		const newer = projectionChat("chat-newer", "2026-08-15T14:00:00.000Z");
		test.transport.emitLifecycle(lifecycleEvent(11, 10, newer));
		expect(
			client.getProjectionSnapshot().chats.map((chat) => chat.chatId),
		).toEqual(["chat-newer"]);

		const older = projectionChat("chat-older", "2026-08-15T09:00:00.000Z");
		test.transport.emitLifecycle(lifecycleEvent(12, 11, older));
		expect(client.getProjectionSnapshot()).toMatchObject({
			checkpoint: 12,
			chats: [{ chatId: "chat-newer" }],
		});
		await client.dispose();
	});

	it("publishes a lifecycle projection only after its checkpoint commits", async () => {
		const observed: ManagedHubChatProjectionSnapshot[] = [];
		const test = harness({
			onProjectionChange: (snapshot) => {
				observed.push(snapshot);
			},
		});
		const client = await test.create();
		expect(observed.at(-1)).toMatchObject({ checkpoint: 10 });

		const newer = projectionChat("chat-newer", "2026-08-15T14:00:00.000Z");
		test.transport.emitLifecycle(lifecycleEvent(11, 10, newer));

		expect(observed.at(-1)).toMatchObject({
			checkpoint: 11,
			chats: expect.arrayContaining([
				expect.objectContaining({ chatId: "chat-newer" }),
			]),
		});
		expect(
			observed
				.filter((snapshot) =>
					snapshot.chats.some((chat) => chat.chatId === "chat-newer"),
				)
				.map((snapshot) => snapshot.checkpoint),
		).toEqual([11]);
		await client.dispose();
	});

	it("makes concurrent disposal share one completion barrier", async () => {
		const test = harness();
		const client = await test.create();
		let releaseDispose = (): void => {};
		test.transport.disposeGate = new Promise<void>((resolve) => {
			releaseDispose = resolve;
		});
		const first = client.dispose();
		let secondSettled = false;
		const second = client.dispose().finally(() => {
			secondSettled = true;
		});
		await Promise.resolve();
		expect(secondSettled).toBe(false);
		releaseDispose();
		await Promise.all([first, second]);
		expect(test.transport.disposeCount).toBe(1);
	});

	it("preserves initialization failure when cleanup also rejects", async () => {
		const test = harness({
			initialCommandFailure: new Error("private projection failure"),
			disposeFailure: new Error("private cleanup failure"),
		});
		await expect(test.create()).rejects.toEqual(
			expect.objectContaining({
				code: "initialization_failed",
				message: "Managed chat client initialization failed closed.",
			}),
		);
		expect(test.transport.disposeCount).toBe(1);
	});

	it("withholds handles until independent controllers are ready and disposes locally", async () => {
		const test = harness({ autoRuntimeReady: false });
		const client = await test.create();
		let firstSettled = false;
		const firstPromise = client
			.startRoot({
				operationId: "start-1",
				sessionId: "session-1",
				chatId: "chat-1",
				start: { profileId: "interactive-default" },
			})
			.finally(() => {
				firstSettled = true;
			});
		await vi.waitFor(() =>
			expect(
				test.transport.subscriptions.filter(
					(subscription) => subscription.kind === "runtime",
				),
			).toHaveLength(1),
		);
		expect(firstSettled).toBe(false);
		expect(client.getSnapshot().residentSessionIds).toEqual([]);
		test.transport.readyRuntime();
		const first = await firstPromise;
		expect(first.getSnapshot()).toMatchObject({
			state: "ready",
			profileAuthority: PROFILE_AUTHORITY,
		});
		expect(first.profileAuthority).toEqual(PROFILE_AUTHORITY);
		expect(Object.isFrozen(first.profileAuthority)).toBe(true);
		expect(Object.isFrozen(first.profileAuthority.allowedModes)).toBe(true);

		const secondPromise = client.startRoot({
			operationId: "start-2",
			sessionId: "session-2",
			chatId: "chat-2",
			start: { profileId: "interactive-default" },
		});
		await vi.waitFor(() =>
			expect(
				test.transport.subscriptions.filter(
					(subscription) => subscription.kind === "runtime",
				),
			).toHaveLength(2),
		);
		test.transport.readyRuntime();
		const second = await secondPromise;
		first.dispose();
		expect(first.getSnapshot().state).toBe("disposed");
		expect(second.getSnapshot().state).toBe("ready");
		expect(test.transport.connected).toBe(true);
		await vi.waitFor(() =>
			expect(client.getSnapshot().residentSessionIds).toEqual(["session-2"]),
		);
		await client.dispose();
	});

	it("uses ordinary resume after a daemon restart reports the session nonresident", async () => {
		const test = harness();
		const client = await test.create();
		test.transport.continuityState = "not_resident";
		const session = await client.reattach({
			operationId: "reattach-nonresident",
			sessionId: "session-1",
			start: { profileId: "interactive-default" },
		});

		expect(
			test.transport.commands
				.filter(
					(entry) =>
						entry.command === "chat_runtime.session.continuity" ||
						entry.command === "chat_lifecycle.resume",
				)
				.map((entry) => entry.command),
		).toEqual(["chat_runtime.session.continuity", "chat_lifecycle.resume"]);
		expect(session.getSnapshot()).toMatchObject({
			state: "ready",
			sessionId: "session-1",
			controller: { cursor: { sessionSequence: 0 } },
		});
		expect(session.hydration).toBeUndefined();
		const runtimeSubscription = test.transport.latest("runtime");
		if (!runtimeSubscription) {
			throw new Error("missing runtime subscription");
		}
		expect(
			(
				runtimeSubscription.options as RuntimeSubscriptionOptions
			).runtimeCursor?.(),
		).toEqual({ streamId: "stream-session-1", sessionSequence: 0 });
		await client.dispose();
	});

	it("returns non-enumerating busy and never reclaims a live resident owner", async () => {
		const test = harness();
		const client = await test.create();
		test.transport.continuityState = "owned_elsewhere";
		await expect(
			client.reattach({
				operationId: "reattach-busy",
				sessionId: "session-1",
				start: { profileId: "interactive-default" },
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: "session_busy",
				message: "Managed session is active on another connection.",
			}),
		);
		expect(
			test.transport.commands.filter((entry) =>
				entry.command.startsWith("chat_runtime.session."),
			),
		).toEqual([
			expect.objectContaining({
				command: "chat_runtime.session.continuity",
			}),
		]);
		expect(client.getSnapshot().residentSessionIds).toEqual([]);
		await client.dispose();
	});

	it("rejects stale client authority fields before asking for continuity", async () => {
		const test = harness();
		const client = await test.create();
		const staleInput = {
			operationId: "reattach-stale-cache",
			sessionId: "session-1",
			start: { profileId: "interactive-default" },
			writerGeneration: 99,
			runtimeCursor: {
				streamId: "client-cache-stream",
				sessionSequence: 99,
			},
		} as unknown as Parameters<typeof client.reattach>[0];

		await expect(client.reattach(staleInput)).rejects.toThrow();
		expect(
			test.transport.commands.some(
				(entry) => entry.command === "chat_runtime.session.continuity",
			),
		).toBe(false);
		await client.dispose();
	});

	it("reclaims, hydrates, replays, and only then exposes a fresh-process handle", async () => {
		const test = harness({ autoRuntimeReady: false });
		const client = await test.create();
		test.transport.continuityState = "orphaned";
		let settled = false;
		const reattaching = client
			.reattach({
				operationId: "reattach-orphan",
				sessionId: "session-1",
				start: { profileId: "interactive-default" },
			})
			.finally(() => {
				settled = true;
			});
		await vi.waitFor(() =>
			expect(test.transport.latest("runtime")).toBeDefined(),
		);
		expect(settled).toBe(false);
		expect(client.getSnapshot().residentSessionIds).toEqual([]);
		expect(
			test.transport.commands
				.filter((entry) => entry.command.startsWith("chat_runtime.session."))
				.map((entry) => entry.command),
		).toEqual([
			"chat_runtime.session.continuity",
			"chat_runtime.session.reclaim",
			"chat_runtime.session.hydrate",
		]);
		const runtimeSubscription = test.transport.latest("runtime");
		if (!runtimeSubscription) {
			throw new Error("missing runtime subscription");
		}
		expect(
			(
				runtimeSubscription.options as RuntimeSubscriptionOptions
			).runtimeCursor?.(),
		).toEqual(test.transport.continuityBaseline);

		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(1, {
				kind: "approval.requested",
				runId: "run-during-reclaim",
				approvalId: "approval-during-reclaim",
				toolCallId: "tool-call-during-reclaim",
				toolName: "bash",
				policy: "owner",
				expiresAt: "2026-08-17T12:05:00.000Z",
			}),
		);
		expect(settled).toBe(false);
		test.transport.readyRuntime();
		const session = await reattaching;
		expect(session.getSnapshot()).toMatchObject({
			state: "ready",
			leaseRevision: 2,
			controller: {
				writerGeneration: 2,
				cursor: { streamId: "stream-session-1", sessionSequence: 1 },
			},
			hydration: {
				replayAvailable: true,
				messages: [{ text: "sanitized history" }],
			},
		});
		expect(session.hydration).toMatchObject({
			sessionId: "session-1",
			writerGeneration: 2,
		});
		expect(Object.isFrozen(session.hydration)).toBe(true);
		expect(Object.isFrozen(session.hydration?.messages)).toBe(true);
		expect(
			test.transport.commands.some(
				(entry) => entry.command === "chat_lifecycle.resume",
			),
		).toBe(false);
		expect(client.getSnapshot().residentSessionIds).toEqual(["session-1"]);
		const replayed: ManagedHubChatRuntimeEvent[] = [];
		const unsubscribe = session.subscribeRuntimeEvents((event) => {
			replayed.push(event);
		});
		await vi.waitFor(() => expect(replayed).toHaveLength(1));
		expect(replayed[0]?.payload).toMatchObject({
			kind: "approval.requested",
			runId: "run-during-reclaim",
			approvalId: "approval-during-reclaim",
		});
		await expect(
			session.respondToApproval({
				operationId: "respond-to-replayed-approval",
				runId: "run-during-reclaim",
				approvalId: "approval-during-reclaim",
				decision: "approve",
			}),
		).resolves.toMatchObject({
			sessionId: "session-1",
			runId: "run-during-reclaim",
			approvalId: "approval-during-reclaim",
		});
		unsubscribe();
		await client.dispose();
	});

	it("fails reattach admission when pre-handle replay exceeds its bound", async () => {
		const observerErrors: ManagedHubChatClientError[] = [];
		const test = harness({
			autoRuntimeReady: false,
			onError: (error) => {
				observerErrors.push(error);
			},
		});
		const client = await test.create();
		test.transport.continuityState = "orphaned";
		const reattaching = client.reattach({
			operationId: "reattach-overflow",
			sessionId: "session-1",
			start: { profileId: "interactive-default" },
		});
		const rejection = expect(reattaching).rejects.toMatchObject({
			code: "observer_overflow",
			message: "Managed initial runtime event delivery overflowed.",
		});
		await vi.waitFor(() =>
			expect(test.transport.latest("runtime")).toBeDefined(),
		);
		for (
			let sequence = 1;
			sequence <= CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE + 1;
			sequence += 1
		) {
			test.transport.emitRuntime(
				"session-1",
				runtimeEvent(sequence, {
					kind: "assistant.delta",
					runId: "run-replay-overflow",
					text: `replay ${sequence}`,
				}),
			);
		}
		test.transport.readyRuntime();
		await rejection;
		expect(observerErrors).toEqual([
			expect.objectContaining({
				code: "observer_overflow",
				message: "Managed runtime event observer capacity was exceeded.",
			}),
		]);
		expect(client.getSnapshot().residentSessionIds).toEqual([]);
		await client.dispose();
	});

	it("fails new admission when initial observer replay exceeds its bound", async () => {
		const observerErrors: ManagedHubChatClientError[] = [];
		const test = harness({
			autoRuntimeReady: false,
			onError: (error) => {
				observerErrors.push(error);
			},
		});
		const client = await test.create();
		const starting = client.startRoot({
			operationId: "start-initial-overflow",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const rejection = expect(starting).rejects.toMatchObject({
			code: "observer_overflow",
			message: "Managed initial runtime event delivery overflowed.",
		});
		await vi.waitFor(() =>
			expect(test.transport.latest("runtime")).toBeDefined(),
		);
		for (
			let sequence = 1;
			sequence <= CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE + 1;
			sequence += 1
		) {
			test.transport.emitRuntime(
				"session-1",
				runtimeEvent(sequence, {
					kind: "assistant.delta",
					runId: "run-initial-overflow",
					text: `initial ${sequence}`,
				}),
			);
		}
		test.transport.readyRuntime();
		await rejection;
		expect(observerErrors).toEqual([
			expect.objectContaining({ code: "observer_overflow" }),
		]);
		expect(client.getSnapshot().residentSessionIds).toEqual([]);
		await client.dispose();
	});

	it("retries the exact fresh reclaim after an unknown reply outcome", async () => {
		const test = harness();
		const client = await test.create();
		test.transport.continuityState = "orphaned";
		test.transport.nextReclaimFailure = Object.assign(
			new Error("reclaim reply timed out"),
			{ code: "hub_command_timeout" },
		);

		const session = await client.reattach({
			operationId: "reattach-lost-reclaim-reply",
			sessionId: "session-1",
			start: { profileId: "interactive-default" },
		});
		const reclaims = test.transport.commands.filter(
			(entry) => entry.command === "chat_runtime.session.reclaim",
		);
		expect(reclaims).toHaveLength(2);
		expect(reclaims[0]?.payload).toEqual(reclaims[1]?.payload);
		expect(reclaims[0]?.requiredConnectionGeneration).toBe(
			reclaims[1]?.requiredConnectionGeneration,
		);
		expect(
			test.transport.commands
				.filter((entry) => entry.command.startsWith("chat_runtime.session."))
				.map((entry) => entry.command),
		).toEqual([
			"chat_runtime.session.continuity",
			"chat_runtime.session.reclaim",
			"chat_runtime.session.reclaim",
			"chat_runtime.session.hydrate",
		]);
		expect(session.getSnapshot()).toMatchObject({
			state: "ready",
			controller: { writerGeneration: 2 },
			hydration: { replayAvailable: true },
		});
		await client.dispose();
	});

	it("fails closed and cancels transferred authority when hydration replay was evicted", async () => {
		const test = harness();
		const client = await test.create();
		test.transport.continuityState = "orphaned";
		test.transport.hydrationReplayAvailable = false;
		await expect(
			client.reattach({
				operationId: "reattach-evicted",
				sessionId: "session-1",
				start: { profileId: "interactive-default" },
			}),
		).rejects.toEqual(expect.objectContaining({ code: "reattach_failed" }));
		expect(
			test.transport.commands
				.filter((entry) => entry.command.startsWith("chat_runtime.session."))
				.map((entry) => entry.command),
		).toEqual([
			"chat_runtime.session.continuity",
			"chat_runtime.session.reclaim",
			"chat_runtime.session.hydrate",
			"chat_runtime.session.reclaim.cancel",
		]);
		expect(test.transport.latest("runtime")).toBeUndefined();
		expect(client.getSnapshot().residentSessionIds).toEqual([]);
		await client.dispose();
	});

	it("retains an admission operation lease until runtime readiness", async () => {
		const test = harness({ autoRuntimeReady: false });
		const client = await test.create();
		const first = client.startRoot({
			operationId: "start-single-flight",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		await vi.waitFor(() =>
			expect(test.transport.latest("runtime")).toBeDefined(),
		);
		expect(client.getSnapshot().pendingOperations).toEqual([
			expect.objectContaining({
				operationId: "start-single-flight",
				command: "chat_lifecycle.start_root",
			}),
		]);

		await expect(
			client.startRoot({
				operationId: "start-single-flight",
				sessionId: "session-2",
				chatId: "chat-2",
				start: { profileId: "interactive-default" },
			}),
		).rejects.toEqual(expect.objectContaining({ code: "operation_conflict" }));
		expect(
			test.transport.commands.filter(
				(entry) => entry.command === "chat_lifecycle.start_root",
			),
		).toHaveLength(1);

		test.transport.readyRuntime();
		await expect(first).resolves.toMatchObject({ sessionId: "session-1" });
		expect(client.getSnapshot().pendingOperations).toEqual([]);
		await client.dispose();
	});

	it("waits for a pre-controller admission before disposal completes", async () => {
		const test = harness();
		const client = await test.create();
		let releaseCommand = (): void => {};
		test.transport.nextCommandGate = new Promise<void>((resolve) => {
			releaseCommand = resolve;
		});
		const admission = client.startRoot({
			operationId: "start-dispose-before-controller",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const admissionRejected = expect(admission).rejects.toEqual(
			expect.objectContaining({ code: "disposed" }),
		);
		await vi.waitFor(() =>
			expect(
				test.transport.commands.filter(
					(entry) => entry.command === "chat_lifecycle.start_root",
				),
			).toHaveLength(1),
		);

		let disposeSettled = false;
		const disposing = client.dispose().then(() => {
			disposeSettled = true;
		});
		await vi.waitFor(() => expect(test.transport.disposeCount).toBe(1));
		expect(disposeSettled).toBe(false);

		releaseCommand();
		await admissionRejected;
		await disposing;
		expect(client.getSnapshot()).toMatchObject({
			state: "disposed",
			residentSessionIds: [],
			pendingOperations: [],
		});
		expect(test.transport.latest("runtime")).toBeUndefined();
	});

	it("registers an admission before reentrant disposal captures work", async () => {
		const test = harness();
		const client = await test.create();
		let releaseCommand = (): void => {};
		test.transport.nextCommandGate = new Promise<void>((resolve) => {
			releaseCommand = resolve;
		});
		let reentrantDisposal: Promise<void> | undefined;
		test.transport.onCommand = (command) => {
			if (command === "chat_lifecycle.start_root" && !reentrantDisposal) {
				reentrantDisposal = client.dispose();
			}
		};

		const admission = client.startRoot({
			operationId: "start-reentrant-dispose",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const admissionRejected = expect(admission).rejects.toEqual(
			expect.objectContaining({ code: "disposed" }),
		);
		if (!reentrantDisposal) throw new Error("disposal was not reentered");
		let disposeSettled = false;
		const disposing = reentrantDisposal.finally(() => {
			disposeSettled = true;
		});
		await vi.waitFor(() => expect(test.transport.disposeCount).toBe(1));
		expect(disposeSettled).toBe(false);

		releaseCommand();
		await admissionRejected;
		await disposing;
		expect(client.getSnapshot()).toMatchObject({
			state: "disposed",
			residentSessionIds: [],
			pendingOperations: [],
		});
	});

	it("drains admission state even when transport disposal throws synchronously", async () => {
		const test = harness();
		const client = await test.create();
		let releaseCommand = (): void => {};
		test.transport.nextCommandGate = new Promise<void>((resolve) => {
			releaseCommand = resolve;
		});
		test.transport.synchronousDisposeFailure = new Error(
			"synchronous transport cleanup failed",
		);
		const admission = client.startRoot({
			operationId: "start-sync-dispose-failure",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const admissionRejected = expect(admission).rejects.toEqual(
			expect.objectContaining({ code: "disposed" }),
		);
		await vi.waitFor(() =>
			expect(
				test.transport.commands.filter(
					(entry) => entry.command === "chat_lifecycle.start_root",
				),
			).toHaveLength(1),
		);

		let disposeSettled = false;
		const disposing = client.dispose().finally(() => {
			disposeSettled = true;
		});
		const disposalRejected = expect(disposing).rejects.toThrow(
			"synchronous transport cleanup failed",
		);
		await vi.waitFor(() => expect(test.transport.disposeCount).toBe(1));
		expect(disposeSettled).toBe(false);

		releaseCommand();
		await admissionRejected;
		await disposalRejected;
		expect(client.getSnapshot()).toMatchObject({
			state: "disposed",
			residentSessionIds: [],
			pendingOperations: [],
		});
	});

	it("cancels and drains a runtime-starting admission during disposal", async () => {
		const test = harness({ autoRuntimeReady: false });
		const client = await test.create();
		const admission = client.startRoot({
			operationId: "start-dispose-runtime",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const admissionRejected = expect(admission).rejects.toEqual(
			expect.objectContaining({ code: "cancelled" }),
		);
		await vi.waitFor(() =>
			expect(test.transport.latest("runtime")).toBeDefined(),
		);
		const runtimeSubscription = test.transport.latest("runtime");

		await client.dispose();
		await admissionRejected;
		expect(runtimeSubscription?.active).toBe(false);
		expect(client.getSnapshot()).toMatchObject({
			state: "disposed",
			residentSessionIds: [],
			pendingOperations: [],
		});
		expect(test.transport.disposeCount).toBe(1);
	});

	it("bounds residents without evicting an active session", async () => {
		const test = harness({ maxResidentSessions: 1 });
		const client = await test.create();
		const first = await client.startRoot({
			operationId: "start-1",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		await expect(
			client.startRoot({
				operationId: "start-2",
				sessionId: "session-2",
				chatId: "chat-2",
				start: { profileId: "interactive-default" },
			}),
		).rejects.toEqual(expect.objectContaining({ code: "capacity_exhausted" }));
		expect(first.getSnapshot().state).toBe("ready");
		await client.dispose();
	});

	it("retains an unknown operation intent and rejects changed reuse", async () => {
		const test = harness();
		const client = await test.create();
		test.transport.nextCommandFailure = Object.assign(
			new Error("reply unknown"),
			{ code: "hub_connection_closed" },
		);
		await expect(
			client.renameChat({
				operationId: "rename-1",
				chatId: "chat-1",
				expectedRevision: 1,
				title: "New title",
			}),
		).rejects.toThrow("reply unknown");
		expect(client.getSnapshot().pendingOperations).toEqual([
			expect.objectContaining({
				operationId: "rename-1",
				command: "chat_lifecycle.rename",
			}),
		]);
		await expect(
			client.renameChat({
				operationId: "rename-1",
				chatId: "chat-1",
				expectedRevision: 1,
				title: "Changed intent",
			}),
		).rejects.toEqual(expect.objectContaining({ code: "operation_conflict" }));
		await expect(
			client.renameChat({
				operationId: "rename-1",
				chatId: "chat-1",
				expectedRevision: 1,
				title: "New title",
			}),
		).resolves.toMatchObject({ title: "New title" });
		expect(client.getSnapshot().pendingOperations).toEqual([]);
		await client.dispose();
	});

	it("serializes one operation intent across an uncertain concurrent attempt", async () => {
		const test = harness();
		const client = await test.create();
		let releaseCommand = (): void => {};
		test.transport.nextCommandGate = new Promise<void>((resolve) => {
			releaseCommand = resolve;
		});
		test.transport.nextCommandFailure = Object.assign(
			new Error("reply unknown"),
			{ code: "hub_connection_closed" },
		);
		const first = client.renameChat({
			operationId: "rename-single-flight",
			chatId: "chat-1",
			expectedRevision: 1,
			title: "Single flight",
		});
		await vi.waitFor(() =>
			expect(
				test.transport.commands.filter(
					(command) => command.command === "chat_lifecycle.rename",
				),
			).toHaveLength(1),
		);
		await expect(
			client.renameChat({
				operationId: "rename-single-flight",
				chatId: "chat-1",
				expectedRevision: 1,
				title: "Single flight",
			}),
		).rejects.toEqual(expect.objectContaining({ code: "operation_conflict" }));
		releaseCommand();
		await expect(first).rejects.toThrow("reply unknown");
		expect(client.getSnapshot().pendingOperations).toHaveLength(1);
		await expect(
			client.renameChat({
				operationId: "rename-single-flight",
				chatId: "chat-1",
				expectedRevision: 1,
				title: "Single flight",
			}),
		).resolves.toMatchObject({ title: "Single flight" });
		expect(client.getSnapshot().pendingOperations).toEqual([]);
		await client.dispose();
	});

	it("bounds retained transport-unknown operation intents", async () => {
		const test = harness();
		const client = await test.create();
		for (let index = 0; index < 256; index += 1) {
			test.transport.nextCommandFailure = Object.assign(
				new Error("reply unknown"),
				{ code: "hub_connection_closed" },
			);
			await expect(
				client.renameChat({
					operationId: `unknown-${index}`,
					chatId: "chat-1",
					expectedRevision: 1,
					title: `Title ${index}`,
				}),
			).rejects.toThrow("reply unknown");
		}
		expect(client.getSnapshot().pendingOperations).toHaveLength(256);
		await expect(
			client.renameChat({
				operationId: "unknown-overflow",
				chatId: "chat-1",
				expectedRevision: 1,
				title: "Overflow",
			}),
		).rejects.toEqual(expect.objectContaining({ code: "capacity_exhausted" }));
		await client.dispose();
	});

	it("delivers frozen runtime events after internal correlation", async () => {
		const observerErrors: ManagedHubChatClientError[] = [];
		const test = harness({
			onError: (error) => {
				observerErrors.push(error);
			},
		});
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-observer",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const observed: ManagedHubChatRuntimeEvent[] = [];
		const responses: Promise<unknown>[] = [];
		const unsubscribe = session.subscribeRuntimeEvents((event) => {
			observed.push(event);
			if (event.payload.kind !== "approval.requested") return;
			const response = session.respondToApproval({
				operationId: "observer-approval-response",
				runId: event.payload.runId,
				approvalId: event.payload.approvalId,
				decision: "approve",
			});
			responses.push(response);
			return response.then(() => undefined);
		});
		const sourceEvent = runtimeEvent(1, {
			kind: "approval.requested",
			runId: "run-observer",
			approvalId: "approval-observer",
			toolCallId: "tool-call-observer",
			toolName: "bash",
			policy: "owner",
			expiresAt: "2026-08-17T12:05:00.000Z",
		});
		test.transport.emitRuntime("session-1", sourceEvent);

		await vi.waitFor(() => expect(responses).toHaveLength(1));
		const response = responses[0];
		if (!response) throw new Error("missing observer response");
		await response;
		const event = observed[0];
		if (!event) throw new Error("missing observed runtime event");
		expect(Object.isFrozen(sourceEvent)).toBe(false);
		expect(Object.isFrozen(event)).toBe(true);
		expect(Object.isFrozen(event.payload)).toBe(true);
		expect(event).not.toBe(sourceEvent);
		expect(observerErrors).toEqual([]);
		expect(
			test.transport.commands.filter(
				(command) => command.command === "chat_runtime.approval.respond",
			),
		).toEqual([
			expect.objectContaining({
				payload: expect.objectContaining({
					sessionId: "session-1",
					runId: "run-observer",
					approvalId: "approval-observer",
				}),
			}),
		]);
		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(2, {
				kind: "capability.requested",
				runId: "run-observer",
				requestId: "capability-observer",
				capability: "tool_executor.askQuestion",
				request: {
					question: "Choose",
					options: ["first", "second"],
					nested: { safe: true },
				},
				expiresAt: "2026-08-17T12:05:00.000Z",
			}),
		);
		await vi.waitFor(() => expect(observed).toHaveLength(2));
		const capabilityEvent = observed[1];
		if (capabilityEvent?.payload.kind !== "capability.requested") {
			throw new Error("missing observed capability request");
		}
		expect(Object.isFrozen(capabilityEvent.payload.request)).toBe(true);
		expect(
			Object.isFrozen(capabilityEvent.payload.request.options as unknown[]),
		).toBe(true);
		expect(
			Object.isFrozen(
				capabilityEvent.payload.request.nested as Record<string, unknown>,
			),
		).toBe(true);
		unsubscribe();
		unsubscribe();
		await client.dispose();
	});

	it("contains slow and throwing observers and retires them before disposal", async () => {
		const observerErrors: ManagedHubChatClientError[] = [];
		const test = harness({
			onError: (error) => {
				observerErrors.push(error);
			},
		});
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-observer-containment",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		let releaseSlow = (): void => {};
		let slowCalls = 0;
		const slow = vi.fn(() => {
			slowCalls += 1;
			return slowCalls === 1
				? new Promise<void>((resolve) => {
						releaseSlow = resolve;
					})
				: Promise.resolve();
		});
		const throwing = vi.fn(() => {
			throw new Error("private observer detail");
		});
		const delivered = vi.fn();
		const releaseSlowObserver = session.subscribeRuntimeEvents(slow);
		const releaseThrowingObserver = session.subscribeRuntimeEvents(throwing);
		const releaseDeliveredObserver = session.subscribeRuntimeEvents(delivered);

		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(1, {
				kind: "assistant.delta",
				runId: "run-observer",
				text: "safe delta",
			}),
		);
		await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(observerErrors).toHaveLength(1));
		expect(slow).toHaveBeenCalledOnce();
		expect(throwing).toHaveBeenCalledOnce();
		expect(observerErrors[0]).toMatchObject({
			code: "observer_failed",
			message: "Managed runtime event observer failed.",
		});
		expect(observerErrors[0]?.message).not.toContain("private");

		releaseThrowingObserver();
		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(2, {
				kind: "assistant.delta",
				runId: "run-observer",
				text: "second safe delta",
			}),
		);
		await vi.waitFor(() => expect(delivered).toHaveBeenCalledTimes(2));
		expect(slow).toHaveBeenCalledOnce();
		releaseSlow();
		await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(2));

		releaseSlowObserver();
		releaseDeliveredObserver();
		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(3, {
				kind: "assistant.delta",
				runId: "run-observer",
				text: "ignored after release",
			}),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(delivered).toHaveBeenCalledTimes(2);
		expect(observerErrors).toHaveLength(1);

		const retiredSubscription = test.transport.latest("runtime");
		await session.disposeAsync();
		retiredSubscription?.listener(
			runtimeEvent(4, {
				kind: "assistant.delta",
				runId: "run-observer",
				text: "ignored after disposal",
			}),
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(delivered).toHaveBeenCalledTimes(2);
		expect(() => session.subscribeRuntimeEvents(() => {})).toThrow(
			expect.objectContaining({ code: "disposed" }),
		);
		await client.dispose();
	});

	it("retires a stalled observer when its bounded queue overflows", async () => {
		const observerErrors: ManagedHubChatClientError[] = [];
		const test = harness({
			onError: (error) => {
				observerErrors.push(error);
			},
		});
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-observer-overflow",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		let releaseStalled = (): void => {};
		const stalled = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseStalled = resolve;
				}),
		);
		const unsubscribe = session.subscribeRuntimeEvents(stalled);
		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(1, {
				kind: "assistant.delta",
				runId: "run-observer-overflow",
				text: "in flight",
			}),
		);
		await vi.waitFor(() => expect(stalled).toHaveBeenCalledOnce());
		for (
			let sequence = 2;
			sequence <= CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE + 2;
			sequence += 1
		) {
			test.transport.emitRuntime(
				"session-1",
				runtimeEvent(sequence, {
					kind: "assistant.delta",
					runId: "run-observer-overflow",
					text: `queued ${sequence}`,
				}),
			);
		}
		await vi.waitFor(() => expect(observerErrors).toHaveLength(1));
		expect(observerErrors[0]).toMatchObject({
			code: "observer_overflow",
			message: "Managed runtime event observer capacity was exceeded.",
		});
		expect(stalled).toHaveBeenCalledOnce();
		releaseStalled();
		await Promise.resolve();
		await Promise.resolve();
		expect(stalled).toHaveBeenCalledOnce();
		unsubscribe();
		await client.dispose();
	});

	it("contains rejected asynchronous error observers", async () => {
		const reported = vi.fn(async () => {
			throw new Error("private asynchronous error observer detail");
		});
		const test = harness({ onError: reported });
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-async-error-observer",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const delivered = vi.fn();
		session.subscribeRuntimeEvents(() => {
			throw new Error("private runtime observer detail");
		});
		session.subscribeRuntimeEvents(delivered);
		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(1, {
				kind: "assistant.delta",
				runId: "run-async-error-observer",
				text: "safe delivery",
			}),
		);
		await vi.waitFor(() => expect(reported).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
		await Promise.resolve();
		await Promise.resolve();
		await client.dispose();
	});

	it("bounds independent runtime observer registrations", async () => {
		const test = harness();
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-observer-capacity",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		const releases = Array.from({ length: 32 }, () =>
			session.subscribeRuntimeEvents(() => {}),
		);
		expect(() => session.subscribeRuntimeEvents(() => {})).toThrow(
			expect.objectContaining({ code: "capacity_exhausted" }),
		);
		releases[0]?.();
		const releaseReplacement = session.subscribeRuntimeEvents(() => {});
		releaseReplacement();
		for (const release of releases) release();
		await client.dispose();
	});

	it("exposes strict pending-prompt update and removal on the session handle", async () => {
		const test = harness();
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-pending-prompts",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});

		await expect(session.listPendingPrompts()).resolves.toMatchObject({
			sessionId: "session-1",
			prompts: [],
		});
		await expect(
			session.updatePendingPrompt({
				operationId: "pending-update",
				promptId: "prompt-1",
				prompt: "updated prompt",
				delivery: "steer",
			}),
		).resolves.toMatchObject({
			sessionId: "session-1",
			updated: true,
			prompt: {
				promptId: "prompt-1",
				prompt: "updated prompt",
				delivery: "steer",
			},
		});
		await expect(
			session.removePendingPrompt({
				operationId: "pending-remove",
				promptId: "prompt-1",
			}),
		).resolves.toMatchObject({
			sessionId: "session-1",
			removed: true,
		});
		expect(
			test.transport.commands
				.filter((command) =>
					command.command.startsWith("chat_runtime.pending_prompts."),
				)
				.map((command) => ({
					command: command.command,
					payload: command.payload,
				})),
		).toEqual([
			{
				command: "chat_runtime.pending_prompts.list",
				payload: { sessionId: "session-1" },
			},
			{
				command: "chat_runtime.pending_prompts.update",
				payload: {
					operationId: "pending-update",
					sessionId: "session-1",
					promptId: "prompt-1",
					prompt: "updated prompt",
					delivery: "steer",
				},
			},
			{
				command: "chat_runtime.pending_prompts.remove",
				payload: {
					operationId: "pending-remove",
					sessionId: "session-1",
					promptId: "prompt-1",
				},
			},
		]);
		await client.dispose();
	});

	it("enforces exact one-shot approval and capability correlation", async () => {
		const test = harness();
		const client = await test.create();
		const session = await client.startRoot({
			operationId: "start-1",
			sessionId: "session-1",
			chatId: "chat-1",
			start: { profileId: "interactive-default" },
		});
		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(1, {
				kind: "approval.requested",
				runId: "run-1",
				approvalId: "approval-1",
				toolCallId: "tool-call-1",
				toolName: "bash",
				policy: "owner",
				expiresAt: "2026-08-17T12:05:00.000Z",
			}),
		);
		await expect(
			session.respondToApproval({
				operationId: "approval-response-1",
				runId: "run-1",
				approvalId: "approval-1",
				decision: "approve",
			}),
		).resolves.toMatchObject({ approvalId: "approval-1" });
		await expect(
			session.respondToApproval({
				operationId: "approval-response-2",
				runId: "run-1",
				approvalId: "approval-1",
				decision: "deny",
			}),
		).rejects.toEqual(expect.objectContaining({ code: "correlation_error" }));

		test.transport.emitRuntime(
			"session-1",
			runtimeEvent(2, {
				kind: "capability.requested",
				runId: "run-1",
				requestId: "capability-1",
				capability: "tool_executor.bash",
				request: { command: "safe" },
				expiresAt: "2026-08-17T12:05:00.000Z",
			}),
		);
		await expect(
			session.respondToCapability({
				operationId: "capability-response-1",
				runId: "run-1",
				requestId: "capability-1",
				capability: "tool_executor.bash",
				result: { ok: true },
			}),
		).resolves.toMatchObject({ requestId: "capability-1" });
		expect(
			test.transport.commands.filter(
				(command) =>
					command.command === "chat_runtime.approval.respond" ||
					command.command === "chat_runtime.capability.respond",
			),
		).toEqual([
			expect.objectContaining({
				command: "chat_runtime.approval.respond",
				requiredConnectionGeneration: 1,
			}),
			expect.objectContaining({
				command: "chat_runtime.capability.respond",
				requiredConnectionGeneration: 1,
			}),
		]);
		await client.dispose();
	});

	it("fails closed and disposes partial construction when replay is rejected", async () => {
		const test = harness({ autoLifecycleReady: false });
		const creating = test.create();
		await vi.waitFor(() =>
			expect(test.transport.latest("lifecycle")).toBeDefined(),
		);
		test.transport.rejectLifecycle("lifecycle_replay_unavailable");
		await expect(creating).rejects.toEqual(
			expect.objectContaining({ code: "initialization_failed" }),
		);
		expect(test.transport.disposeCount).toBe(1);
		expect(
			test.transport.subscriptions.every(
				(subscription) => !subscription.active,
			),
		).toBe(true);
	});
});

function runtimeEvent(
	sequence: number,
	payload: Record<string, unknown>,
): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.runtime",
		eventId: `runtime-event-${sequence}`,
		streamId: "stream-session-1",
		sessionId: "session-1",
		timestamp: sequence,
		processSequence: sequence,
		sessionSequence: sequence,
		payload,
	} as unknown as HubEventEnvelope;
}

function projectionChat(chatId: string, lastActivityAt: string) {
	const sessionId = `session-${chatId}`;
	return {
		...PROJECTION_CHAT,
		chatId,
		headSessionId: sessionId,
		lastActivityAt,
		sessions: [
			{
				...PROJECTION_CHAT.sessions[0],
				chatId,
				sessionId,
			},
		],
	};
}

function lifecycleEvent(
	catalogSequence: number,
	previousDeliveredSequence: number,
	chat: ReturnType<typeof projectionChat>,
): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.changed",
		eventId: `lifecycle-${catalogSequence}`,
		timestamp: catalogSequence,
		catalogSequence,
		previousDeliveredSequence,
		payload: {
			chatId: chat.chatId,
			eventType: "chat.activity_recorded",
			aggregateKind: "chat",
			aggregateId: chat.chatId,
			previousRevision: 1,
			resultingRevision: 2,
			occurredAt: chat.lastActivityAt,
			chat,
		},
	} as unknown as HubEventEnvelope;
}
