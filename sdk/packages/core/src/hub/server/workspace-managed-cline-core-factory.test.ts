import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AgentResult,
	type HubChatProjectionChat,
	type HubEventEnvelope,
	type HubProtocolMetadata,
	parseHubChatLifecycleReconciledWireEvent,
	parseHubChatLifecycleWireEvent,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type {
	CatalogAudienceChatSource,
	CatalogLifecycleEvent,
	CatalogLifecycleEventSource,
} from "../../chat-catalog/chat-catalog-event-source";
import { HubChatCatalogConfirmationBroker } from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import { SqliteChatCatalogService } from "../../chat-catalog/sqlite-chat-catalog-service";
import type {
	ClineCoreChatLifecycleApi,
	ClineCoreChatLifecycleStartResult,
	ClineCoreOptions,
} from "../../cline-core/types";
import type { RuntimeCapabilities } from "../../runtime/capabilities";
import { SessionSource } from "../../types/common";
import {
	ManagedHubChatClient,
	type ManagedHubChatTransport,
	NodeHubClient,
} from "../client";
import {
	createHubDaemonChatProfileResolver,
	HUB_DAEMON_CHAT_PROFILE_IDS,
	HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
} from "../daemon/chat-management-profiles";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import type { HubWorkspaceCatalogConfirmationRequest } from "./hub-server-options";
import { startHubWebSocketServer } from "./hub-websocket-server";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import { createHubWorkspaceManagedClineCoreFactory } from "./workspace-managed-cline-core-factory";
import type { ManagedRuntimeCoreHandle } from "./workspace-managed-runtime-adapter";
import { HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY } from "./workspace-managed-runtime-capabilities";

const WORKSPACE = resolve("/tmp/managed-cline-core-workspace");
const BINDING = {
	bindingId: "binding-1",
	transport: "slack",
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
	workspaceKey: WORKSPACE,
	catalogState: "archived" as const,
	headSessionId: "session-1",
	sourceKind: "hub",
	createdAt: "2026-08-15T11:00:00.000Z",
	lastActivityAt: "2026-08-15T12:00:00.000Z",
	archivedAt: "2026-08-15T12:00:00.000Z",
	revision: 2,
	sessions: [],
	bindings: [BINDING],
};
const TURN = {
	text: "sanitized final text",
	usage: {
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 2,
		cacheWriteTokens: 1,
		totalCost: 0.01,
	},
	messages: [{ role: "user", content: "private transcript" }],
	toolCalls: [{ id: "private-tool-call" }],
	iterations: 1,
	finishReason: "completed",
	model: { id: "model-1", provider: "provider-1" },
	startedAt: new Date("2026-08-15T12:00:00.000Z"),
	endedAt: new Date("2026-08-15T12:00:01.000Z"),
	durationMs: 1000,
} as unknown as AgentResult;
const START = {
	startResult: {
		sessionId: "session-1",
		manifestPath: "/private/session.json",
		messagesPath: "/private/messages.json",
		leaseToken: "private-token",
	},
	turnResult: TURN,
	chatId: "chat-1",
	leaseRevision: 1,
	writerGeneration: 1,
	leaseExpiresAt: "2026-08-15T12:01:00.000Z",
} as unknown as ClineCoreChatLifecycleStartResult;

function lifecycleApi(): ClineCoreChatLifecycleApi {
	return {
		startRoot: vi.fn(async () => START),
		startRelated: vi.fn(async () => START),
		restoreCheckpoint: vi.fn(async () => ({
			...START,
			messages: [{ role: "user", content: "private restored message" }],
			checkpoint: {
				ref: "private-ref",
				createdAt: 1,
				runCount: 2,
				kind: "stash",
			},
		})) as never,
		resume: vi.fn(async () => START),
		recoverLostLease: vi.fn(async () => START),
		runTurn: vi.fn(async () => TURN),
		getBinding: vi.fn(async () => BINDING),
		bind: vi.fn(async () => BINDING),
		reset: vi.fn(async () => undefined),
		archive: vi.fn(async () => CHAT),
		activate: vi.fn(async () => CHAT),
		rename: vi.fn(async () => CHAT),
		purge: vi.fn(async () => ({
			chatId: "chat-1",
			sessionIds: ["session-1"],
			applied: true,
		})),
		stop: vi.fn(async () => {}),
	};
}

function eventSourceFixture() {
	let sequence = 0;
	const events: CatalogLifecycleEvent[] = [];
	const append = (
		input: Partial<CatalogLifecycleEvent> &
			Pick<
				CatalogLifecycleEvent,
				"eventType" | "aggregateKind" | "aggregateId"
			>,
	) => {
		sequence += 1;
		events.push(
			Object.freeze({
				...input,
				sequence,
				eventId: `catalog-event-${sequence}`,
				chatId: "chat-1",
				eventType: input.eventType,
				aggregateKind: input.aggregateKind,
				aggregateId: input.aggregateId,
				previousRevision: input.previousRevision ?? 0,
				resultingRevision: input.resultingRevision ?? 1,
				occurredAt: "2026-08-15T12:00:00.000Z",
				relatedSessionIds: input.relatedSessionIds ?? ["session-1"],
			}),
		);
	};
	const source: CatalogLifecycleEventSource = {
		currentSequence: () => sequence,
		listAfter: ({ afterSequence, limit = 256 }) => {
			const selected = events
				.filter((event) => event.sequence > afterSequence)
				.slice(0, limit);
			const throughSequence =
				selected.at(-1)?.sequence ?? Math.max(afterSequence, sequence);
			return {
				throughSequence:
					selected.length === limit
						? throughSequence
						: Math.max(sequence, throughSequence),
				events: selected,
				hasMore: events.some((event) => event.sequence > throughSequence),
			};
		},
	};
	return { source, append };
}

function inertEventSource(): CatalogLifecycleEventSource {
	return eventSourceFixture().source;
}

function audienceProjectionSourceFixture() {
	const projected: HubChatProjectionChat = {
		chatId: "chat-1",
		catalogState: "archived",
		headSessionId: "session-1",
		sourceKind: "hub",
		createdAt: "2026-08-15T11:00:00.000Z",
		lastActivityAt: "2026-08-15T12:00:00.000Z",
		archivedAt: "2026-08-15T12:00:00.000Z",
		revision: 4,
		sessionCount: 1,
		bindingCount: 0,
		sessions: [
			{
				chatId: "chat-1",
				sessionId: "session-1",
				relationKind: "root",
				ordinal: 0,
				attachedAt: "2026-08-15T11:00:00.000Z",
				executionStatus: "idle",
			},
		],
		bindings: [],
	};
	let catalogState: "active" | "archived" = "archived";
	const chat = () => ({ ...projected, catalogState });
	const getSessionProjection = vi.fn(
		({ sessionId }: { sessionId: string }) => ({
			snapshotSequence: 7,
			chat: sessionId === "session-1" ? chat() : null,
		}),
	);
	const source: CatalogAudienceChatSource = {
		currentSequence: () => 7,
		listAfter: ({ afterSequence }) => ({
			throughSequence: afterSequence,
			events: [],
			hasMore: false,
		}),
		createProjectionSnapshot: () => ({
			snapshotSequence: 7,
			chats: [chat()],
		}),
		getProjection: () => ({
			snapshotSequence: 7,
			chat: chat(),
		}),
		getSessionProjection,
	};
	return {
		source,
		getSessionProjection,
		setCatalogState: (next: "active" | "archived") => {
			catalogState = next;
		},
	};
}

function runtimeHandle(): ManagedRuntimeCoreHandle {
	return {
		abort: vi.fn(async () => {}),
		rekeyManagedSessionAuthority: vi.fn(async (input) => ({
			sessionId: input.sessionId,
			leaseRevision: input.expectedWriterGeneration + 1,
			writerGeneration: input.expectedWriterGeneration + 1,
			leaseExpiresAt: "2026-08-15T12:02:00.000Z",
		})),
		verifyManagedSessionAuthority: vi.fn(async (sessionId) => ({
			sessionId,
			leaseRevision: 1,
			writerGeneration: 1,
			leaseExpiresAt: "2026-08-15T12:01:00.000Z",
		})),
		pendingPrompts: {
			list: vi.fn(async () => []),
			update: vi.fn(async ({ sessionId }) => ({ sessionId, prompts: [] })),
			delete: vi.fn(async ({ sessionId }) => ({ sessionId, prompts: [] })),
		},
		getAccumulatedUsage: vi.fn(async () => undefined),
		readMessages: vi.fn(async () => []),
		get: vi.fn(async () => undefined),
		readSessionCompactionState: vi.fn(async () => undefined),
		subscribe: vi.fn(() => () => {}),
	};
}

function fakeHubSessionHost() {
	return {
		subscribe: vi.fn(() => () => {}),
		dispose: vi.fn(),
	} as never;
}

function identityFixture() {
	const authority = new HubWorkspaceCapabilityAuthority();
	const identity = authority.consume({
		credential: authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE,
		}).credential,
		transport: "websocket",
	});
	return { authority, identity };
}

type ManagedConfirmationMutationFence = {
	readonly signal: AbortSignal;
	assertActive(): void;
};

async function physicalManagedConfirmationHarness(options: {
	confirmCatalogMutation(
		request: HubWorkspaceCatalogConfirmationRequest,
	): boolean | Promise<boolean>;
	confirmationPromptTimeoutMs?: number;
	afterApproval?: (
		fence: ManagedConfirmationMutationFence,
	) => void | Promise<void>;
}) {
	const workspaceRoot = mkdtempSync(
		join(tmpdir(), "managed-confirmation-fault-"),
	);
	const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
	const api = lifecycleApi();
	let coreOptions: ClineCoreOptions | undefined;
	let mutationCount = 0;
	let settleArchive: () => void = () => undefined;
	const archiveSettled = new Promise<void>((resolve) => {
		settleArchive = resolve;
	});
	vi.mocked(api.archive).mockImplementation(async () => {
		try {
			const confirmed = await coreOptions?.chatLifecycle?.confirm?.({
				confirmation: "archive",
				aggregateKind: "chat",
				aggregateId: "chat-1",
				expectedRevision: 1,
			});
			if (!confirmed) throw new Error("catalog confirmation declined");
			const fence = coreOptions?.chatLifecycle?.mutationFence?.();
			if (!fence) throw new Error("missing managed mutation fence");
			await options.afterApproval?.(fence);
			fence.assertActive();
			mutationCount += 1;
			return { ...CHAT, workspaceKey: canonicalWorkspaceRoot };
		} finally {
			settleArchive();
		}
	});
	const factory = createHubWorkspaceManagedClineCoreFactory({
		profiles: {
			resolveStartProfile: async () => ({
				config: {
					providerId: "anthropic",
					modelId: "claude-test",
					systemPrompt: "trusted",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				interactive: true,
				profileRevision: 1,
				allowedModes: ["act"] as const,
			}),
			resolveBindingProfile: async () => undefined,
		},
		createCore: async (input) => {
			coreOptions = input;
			return {
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				dispose: vi.fn(async () => {}),
			};
		},
	});
	let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
	let client: NodeHubClient | undefined;
	try {
		server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: {
				ownerId: "managed-confirmation-fault-owner",
				discoveryPath: join(workspaceRoot, "hub-discovery.json"),
			},
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeHubSessionHost(),
			chatCatalog: {
				port: {} as never,
				confirmationBroker: new HubChatCatalogConfirmationBroker(),
				authorize: vi.fn() as never,
			},
			workspaceAuthority: {
				trustedWorkspaceKeys: [canonicalWorkspaceRoot],
				connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
				defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				confirmCatalogMutation: options.confirmCatalogMutation,
				...(options.confirmationPromptTimeoutMs === undefined
					? {}
					: {
							confirmationPromptTimeoutMs: options.confirmationPromptTimeoutMs,
						}),
			},
			workspaceManagedCoreFactory: factory,
			managedChatLifecycleEnabled: true,
		});
		const control = server.workspaceAuthority;
		if (!control) throw new Error("missing workspace authority control");
		const registration = control.list()[0];
		if (!registration) throw new Error("missing workspace registration");
		client = new NodeHubClient({
			url: server.url,
			clientId: `managed-confirmation-fault-client-${Date.now()}`,
			clientType: "test",
			workspaceRoot: canonicalWorkspaceRoot,
			workspaceCapabilityProvider: {
				getFreshCapability: () =>
					control.issue({ workspaceId: registration.workspaceId }),
			},
		});
		await client.connect();
		return {
			server,
			client,
			control,
			registration,
			archiveSettled,
			mutationCount: () => mutationCount,
			archive: (operationId: string) =>
				client?.command("chat_lifecycle.archive", {
					operationId,
					chatId: "chat-1",
					expectedRevision: 1,
				}) ?? Promise.reject(new Error("managed client is unavailable")),
			cleanup: async () => {
				await client?.dispose();
				await server?.close();
				rmSync(workspaceRoot, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await client?.dispose();
		await server?.close();
		rmSync(workspaceRoot, { recursive: true, force: true });
		throw error;
	}
}

describe("workspace managed ClineCore factory", () => {
	it("resolves opaque profiles, sanitizes results, and emits pathless events", async () => {
		const api = lifecycleApi();
		const catalogEvents = eventSourceFixture();
		(api.startRoot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			catalogEvents.append({
				eventType: "chat.created",
				aggregateKind: "chat",
				aggregateId: "chat-1",
			});
			return START;
		});
		let coreOptions: ClineCoreOptions | undefined;
		const resolveStartProfile = vi.fn(async () => ({
			config: {
				providerId: "anthropic",
				modelId: "claude-test",
				apiKey: "private-api-key",
				systemPrompt: "trusted system prompt",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			interactive: true,
			profileRevision: 1,
			allowedModes: ["act", "plan", "yolo"] as const,
		}));
		const resolveBindingProfile = vi.fn(async ({ requested }) => ({
			transport: "slack",
			instanceId: requested.instanceId,
			channelId: requested.channelId,
			threadId: requested.threadId,
			participantScope: requested.participantScope,
		}));
		const confirm = vi.fn(async () => true);
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: { resolveStartProfile, resolveBindingProfile },
			createCore: async (options) => {
				coreOptions = options;
				(api.archive as ReturnType<typeof vi.fn>).mockImplementation(
					async () => {
						const approved = await coreOptions?.chatLifecycle?.confirm?.({
							confirmation: "archive",
							aggregateKind: "chat",
							aggregateId: "chat-1",
							expectedRevision: 1,
						});
						expect(approved).toBe(true);
						return CHAT;
					},
				);
				return {
					chatLifecycle: api,
					chatLifecycleEventSource: catalogEvents.source,
					dispose: vi.fn(async () => {}),
				};
			},
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const events: HubEventEnvelope[] = [];
		const release = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: (event) => events.push(event as HubEventEnvelope),
		});
		const result = await managed.lifecycleWire?.invoke({
			identity,
			signal: controller.signal,
			command: "chat_lifecycle.start_root",
			resolvedCwd: resolve(WORKSPACE, "packages/core"),
			payload: {
				operationId: "operation-1",
				sessionId: "session-1",
				start: {
					profileId: "trusted-default",
					mode: "plan",
				},
			},
		});

		expect(coreOptions).toMatchObject({
			backendMode: "local",
			chatLifecycle: {
				workspaceRoot: WORKSPACE,
				principalId: "owner-1",
			},
		});
		expect(api.startRoot).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "operation-1",
				sessionId: "session-1",
				startInput: expect.objectContaining({
					sessionMetadata: expect.objectContaining({
						__clineManagedProfileAuthorityV1: {
							profileId: "trusted-default",
							profileRevision: 1,
							authorityClassId: identity.policy.authorityClassId,
							policyEpoch: identity.policy.policyEpoch,
							connectionPolicyDigest: expect.any(String),
							executionPolicyDigest: expect.any(String),
							interactive: true,
							allowedModes: ["act", "plan", "yolo"],
						},
					}),
					config: expect.objectContaining({
						sessionId: "session-1",
						cwd: resolve(WORKSPACE, "packages/core"),
						workspaceRoot: WORKSPACE,
						mode: "plan",
					}),
				}),
			}),
		);
		expect(
			vi.mocked(api.startRoot).mock.calls[0]?.[0].startInput,
		).not.toHaveProperty("prompt");
		expect(resolveStartProfile).toHaveBeenCalledWith(
			expect.objectContaining({
				profileId: "trusted-default",
				requested: {
					mode: "plan",
				},
			}),
		);
		const serialized = JSON.stringify(result);
		expect(result).toMatchObject({
			profileAuthority: {
				profileId: "trusted-default",
				profileRevision: 1,
				authorityClassId: identity.policy.authorityClassId,
				policyEpoch: identity.policy.policyEpoch,
				allowedModes: ["act", "plan", "yolo"],
			},
		});
		expect(result).not.toHaveProperty(
			"profileAuthority.connectionPolicyDigest",
		);
		expect(result).not.toHaveProperty("profileAuthority.executionPolicyDigest");
		expect(serialized).not.toContain("private-token");
		expect(serialized).not.toContain("manifestPath");
		expect(serialized).not.toContain("messagesPath");
		expect(serialized).not.toContain("private transcript");
		expect(serialized).not.toContain("private-tool-call");
		expect(serialized).not.toContain("private-api-key");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			eventId: "catalog-event-1",
			payload: { eventType: "chat.created" },
		});
		expect(JSON.stringify(events)).not.toContain("chat_lifecycle.start_root");
		expect(JSON.stringify(events)).not.toContain(WORKSPACE);

		await managed.lifecycleWire?.invoke({
			identity,
			signal: controller.signal,
			command: "chat_lifecycle.archive",
			confirm,
			payload: {
				operationId: "archive-1",
				chatId: "chat-1",
				expectedRevision: 1,
			},
		});
		expect(confirm).toHaveBeenCalledWith({
			confirmation: "archive",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			expectedRevision: 1,
		});
		expect(JSON.stringify(events)).not.toContain("workspaceKey");
		release?.();
	});

	it("resolves archived resume confirmation from the audience-bound session projection", async () => {
		const { source, getSessionProjection, setCatalogState } =
			audienceProjectionSourceFixture();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
				}),
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: lifecycleApi(),
				chatLifecycleEventSource: undefined,
				chatAudienceSource: source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const lifecycle = managed.lifecycleWire;
		if (!lifecycle?.resolveConfirmationTarget) {
			throw new Error("missing confirmation target resolver");
		}
		const invocation = {
			identity,
			signal: controller.signal,
			command: "chat_lifecycle.resume" as const,
			payload: {
				operationId: "resume-projection-target",
				sessionId: "session-1",
				start: { profileId: "profile-1" },
			},
		};

		await expect(
			lifecycle.resolveConfirmationTarget(invocation),
		).resolves.toEqual({
			confirmation: "activate",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			expectedRevision: 4,
		});
		expect(getSessionProjection).toHaveBeenCalledWith({
			sessionId: "session-1",
		});
		setCatalogState("active");
		await expect(
			lifecycle.resolveConfirmationTarget(invocation),
		).resolves.toBeUndefined();
		await managed.dispose("confirmation_projection_test_complete");
	});

	it("uses one connection owner gate for resident runtime and lifecycle operations", async () => {
		const api = lifecycleApi();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 2,
					allowedModes: ["act"] as const,
					runtimeCapabilityManifest: {
						callbacks: ["tool_executor.askQuestion"] as const,
					},
				}),
				resolveBindingProfile: async () => ({ transport: "slack" }),
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				runtime: runtimeHandle(),
				dispose: vi.fn(async () => {}),
			}),
		});
		const authority = new HubWorkspaceCapabilityAuthority();
		const issueIdentity = () =>
			authority.consume({
				credential: authority.issue({
					principalId: "owner-1",
					workspaceKey: WORKSPACE,
				}).credential,
				transport: "websocket",
			});
		const owner = issueIdentity();
		const replacement = issueIdentity();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: owner.principalId,
			tenantId: owner.tenantId,
			workspaceKey: owner.workspaceKey,
			workspaceEpoch: owner.workspaceEpoch,
			authorityClassId: owner.policy.authorityClassId,
			audienceId: owner.policy.audienceId,
			policyEpoch: owner.policy.policyEpoch,
			signal: controller.signal,
		});
		const lifecycle = managed.lifecycleWire;
		if (!lifecycle) throw new Error("missing lifecycle wire");
		const invoke = (
			identity: typeof owner,
			command: Parameters<typeof lifecycle.invoke>[0]["command"],
			payload: Record<string, unknown>,
		) =>
			lifecycle.invoke({
				identity,
				signal: authority.signal(identity),
				command,
				payload,
			});
		await invoke(owner, "chat_lifecycle.start_root", {
			operationId: "owner-start",
			sessionId: "session-1",
			start: { profileId: "profile-1" },
		});
		const admittedStartInput = (api.startRoot as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0]?.startInput;
		expect(admittedStartInput?.capabilities).toMatchObject({
			requestToolApproval: expect.any(Function),
			toolExecutors: { askQuestion: expect.any(Function) },
		});
		await invoke(owner, "chat_lifecycle.bind", {
			operationId: "owner-bind",
			sessionId: "session-1",
			target: {
				profileId: "binding-1",
				bindingId: "binding-1",
				expectedBindingRevision: 1,
			},
		});

		for (const [command, payload] of [
			[
				"chat_lifecycle.bind",
				{
					operationId: "foreign-bind",
					sessionId: "session-1",
					target: {
						profileId: "binding-1",
						bindingId: "binding-1",
						expectedBindingRevision: 1,
					},
				},
			],
			[
				"chat_lifecycle.reset",
				{ operationId: "foreign-reset", sessionId: "session-1" },
			],
			[
				"chat_lifecycle.stop",
				{ operationId: "foreign-stop", sessionId: "session-1" },
			],
			[
				"chat_lifecycle.resume",
				{
					operationId: "foreign-resume",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				},
			],
			[
				"chat_lifecycle.start_related",
				{
					operationId: "foreign-related",
					sessionId: "session-2",
					chatId: "chat-2",
					parentSessionId: "session-1",
					relationKind: "fork",
					start: { profileId: "profile-1" },
				},
			],
			[
				"chat_lifecycle.restore_checkpoint",
				{
					operationId: "foreign-restore",
					sessionId: "session-3",
					chatId: "chat-3",
					parentSessionId: "session-1",
					checkpointRunCount: 1,
					start: { profileId: "profile-1" },
				},
			],
		] as const) {
			await expect(invoke(replacement, command, payload)).rejects.toMatchObject(
				{
					code: "unsupported_capability",
				},
			);
		}

		await expect(
			invoke(owner, "chat_lifecycle.archive", {
				operationId: "unsafe-stop-archive",
				chatId: "chat-1",
				expectedRevision: 1,
				stopRunning: true,
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(api.bind).toHaveBeenCalledTimes(1);
		expect(api.reset).not.toHaveBeenCalled();
		expect(api.stop).not.toHaveBeenCalled();
		expect(api.resume).not.toHaveBeenCalled();
		expect(api.startRelated).not.toHaveBeenCalled();
		expect(api.restoreCheckpoint).not.toHaveBeenCalled();
		expect(api.archive).not.toHaveBeenCalled();
		await managed.dispose("owner_gate_test_complete");
	});

	it("routes managed approval and decline through the owner responder over a physical workspace WebSocket", async () => {
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "managed-catalog-confirmation-"),
		);
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let client: NodeHubClient | undefined;
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const api = lifecycleApi();
			let coreOptions: ClineCoreOptions | undefined;
			let confirmationMode: "approve" | "decline" | "pending" = "approve";
			let mutationCount = 0;
			const promptSignals: AbortSignal[] = [];
			const pendingConfirmationResolvers: Array<(confirmed: boolean) => void> =
				[];
			vi.mocked(api.archive).mockImplementation(async () => {
				const confirmed = await coreOptions?.chatLifecycle?.confirm?.({
					confirmation: "archive",
					aggregateKind: "chat",
					aggregateId: "chat-1",
					expectedRevision: 1,
				});
				if (!confirmed) throw new Error("catalog confirmation declined");
				mutationCount += 1;
				return { ...CHAT, workspaceKey: canonicalWorkspaceRoot };
			});
			const confirmCatalogMutation = vi.fn(
				(request: HubWorkspaceCatalogConfirmationRequest) => {
					promptSignals.push(request.signal);
					if (confirmationMode === "pending") {
						return new Promise<boolean>((resolve) => {
							pendingConfirmationResolvers.push(resolve);
						});
					}
					return confirmationMode === "approve";
				},
			);
			const factory = createHubWorkspaceManagedClineCoreFactory({
				profiles: {
					resolveStartProfile: async () => ({
						config: {
							providerId: "anthropic",
							modelId: "claude-test",
							systemPrompt: "trusted",
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
						interactive: true,
						profileRevision: 1,
						allowedModes: ["act"] as const,
					}),
					resolveBindingProfile: async () => undefined,
				},
				createCore: async (options) => {
					coreOptions = options;
					return {
						chatLifecycle: api,
						chatLifecycleEventSource: inertEventSource(),
						dispose: vi.fn(async () => {}),
					};
				},
			});
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "managed-catalog-confirmation-owner",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeHubSessionHost(),
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
					confirmCatalogMutation,
				},
				workspaceManagedCoreFactory: factory,
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			if (!control) throw new Error("missing workspace authority control");
			const registration = control.list()[0];
			if (!registration) throw new Error("missing workspace registration");
			client = new NodeHubClient({
				url: server.url,
				clientId: "managed-catalog-confirmation-client",
				clientType: "test",
				workspaceRoot: canonicalWorkspaceRoot,
				workspaceCapabilityProvider: {
					getFreshCapability: () =>
						control.issue({ workspaceId: registration.workspaceId }),
				},
			});
			await client.connect();

			expect(
				await client.command("chat_lifecycle.archive", {
					operationId: "physical-archive-approved",
					chatId: "chat-1",
					expectedRevision: 1,
				}),
			).toMatchObject({ ok: true, payload: { result: { chatId: "chat-1" } } });
			expect(mutationCount).toBe(1);
			expect(confirmCatalogMutation).toHaveBeenLastCalledWith({
				target: {
					confirmation: "archive",
					aggregateKind: "chat",
					aggregateId: "chat-1",
					expectedRevision: 1,
				},
				signal: expect.any(AbortSignal),
			});
			expect(promptSignals.at(-1)?.aborted).toBe(true);
			expect(
				JSON.stringify(confirmCatalogMutation.mock.calls.at(-1)?.[0]),
			).not.toContain(canonicalWorkspaceRoot);
			expect(
				JSON.stringify(confirmCatalogMutation.mock.calls.at(-1)?.[0]),
			).not.toContain("physical-archive-approved");

			confirmationMode = "decline";
			await expect(
				client.command("chat_lifecycle.archive", {
					operationId: "physical-archive-declined",
					chatId: "chat-1",
					expectedRevision: 1,
				}),
			).rejects.toMatchObject({ code: "chat_lifecycle_failed" });
			expect(mutationCount).toBe(1);
			expect(confirmCatalogMutation).toHaveBeenCalledTimes(2);
			expect(promptSignals.at(-1)?.aborted).toBe(true);

			confirmationMode = "pending";
			const managedPending = client.command("chat_lifecycle.archive", {
				operationId: "physical-archive-bounded",
				chatId: "chat-1",
				expectedRevision: 1,
			});
			await vi.waitFor(() =>
				expect(confirmCatalogMutation).toHaveBeenCalledTimes(3),
			);
			const connection = control.listConnections()[0];
			if (!connection) throw new Error("missing active workspace connection");
			const directPending = Array.from({ length: 7 }, (_, index) =>
				control.requestCatalogConfirmation({
					connectionId: connection.connectionId,
					target: {
						confirmation: "purge",
						invocationId: `physical-direct-bounded-${index}`,
						aggregateKind: "chat",
						aggregateId: `chat-direct-bounded-${index}`,
						expectedRevision: 1,
					},
				}),
			);
			await vi.waitFor(() =>
				expect(confirmCatalogMutation).toHaveBeenCalledTimes(10),
			);
			await expect(
				control.requestCatalogConfirmation({
					connectionId: connection.connectionId,
					target: {
						confirmation: "purge",
						invocationId: "physical-direct-over-limit",
						aggregateKind: "chat",
						aggregateId: "chat-direct-over-limit",
						expectedRevision: 1,
					},
				}),
			).rejects.toThrow("confirmation limit was reached");
			for (const resolveConfirmation of pendingConfirmationResolvers) {
				resolveConfirmation(true);
			}
			await expect(managedPending).resolves.toMatchObject({ ok: true });
			await expect(Promise.all(directPending)).resolves.toHaveLength(7);
			expect(mutationCount).toBe(2);
			expect(promptSignals.slice(-8).every((signal) => signal.aborted)).toBe(
				true,
			);
		} finally {
			await client?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("binds archived resume confirmation to its authoritative projection over a physical workspace WebSocket", async () => {
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "managed-archived-resume-confirmation-"),
		);
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let client: NodeHubClient | undefined;
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const api = lifecycleApi();
			const { source, getSessionProjection } =
				audienceProjectionSourceFixture();
			let coreOptions: ClineCoreOptions | undefined;
			vi.mocked(api.resume).mockImplementation(async () => {
				const approved = await coreOptions?.chatLifecycle?.confirm?.({
					confirmation: "activate",
					aggregateKind: "chat",
					aggregateId: "chat-1",
					expectedRevision: 4,
				});
				if (!approved) throw new Error("catalog confirmation declined");
				return START;
			});
			let promptSignal: AbortSignal | undefined;
			const confirmCatalogMutation = vi.fn(
				async (request: HubWorkspaceCatalogConfirmationRequest) => {
					promptSignal = request.signal;
					return true;
				},
			);
			const factory = createHubWorkspaceManagedClineCoreFactory({
				profiles: {
					resolveStartProfile: async () => ({
						config: {
							providerId: "anthropic",
							modelId: "claude-test",
							systemPrompt: "trusted",
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
						interactive: true,
						profileRevision: 1,
						allowedModes: ["act"] as const,
					}),
					resolveBindingProfile: async () => undefined,
				},
				createCore: async (options) => {
					coreOptions = options;
					return {
						chatLifecycle: api,
						chatLifecycleEventSource: undefined,
						chatAudienceSource: source,
						dispose: vi.fn(async () => {}),
					};
				},
			});
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "managed-archived-resume-confirmation-owner",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeHubSessionHost(),
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
					confirmCatalogMutation,
				},
				workspaceManagedCoreFactory: factory,
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			if (!control) throw new Error("missing workspace authority control");
			const registration = control.list()[0];
			if (!registration) throw new Error("missing workspace registration");
			client = new NodeHubClient({
				url: server.url,
				clientId: "managed-archived-resume-confirmation-client",
				clientType: "test",
				workspaceRoot: canonicalWorkspaceRoot,
				workspaceCapabilityProvider: {
					getFreshCapability: () =>
						control.issue({ workspaceId: registration.workspaceId }),
				},
			});
			await client.connect();

			expect(
				await client.command("chat_lifecycle.resume", {
					operationId: "physical-archived-resume",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				}),
			).toMatchObject({
				ok: true,
				payload: { result: { chatId: "chat-1" } },
			});
			expect(getSessionProjection).toHaveBeenCalledWith({
				sessionId: "session-1",
			});
			expect(confirmCatalogMutation).toHaveBeenCalledOnce();
			expect(confirmCatalogMutation).toHaveBeenCalledWith({
				target: {
					confirmation: "activate",
					aggregateKind: "chat",
					aggregateId: "chat-1",
					expectedRevision: 4,
				},
				signal: expect.any(AbortSignal),
			});
			expect(promptSignal?.aborted).toBe(true);
			expect(
				JSON.stringify(confirmCatalogMutation.mock.calls[0]?.[0]),
			).not.toContain(canonicalWorkspaceRoot);
			expect(
				JSON.stringify(confirmCatalogMutation.mock.calls[0]?.[0]),
			).not.toContain("physical-archived-resume");
		} finally {
			await client?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("times out a physical managed confirmation before mutation", async () => {
		let promptSignal: AbortSignal | undefined;
		const harness = await physicalManagedConfirmationHarness({
			confirmationPromptTimeoutMs: 5,
			confirmCatalogMutation: (request) => {
				promptSignal = request.signal;
				return new Promise<boolean>(() => {});
			},
		});
		try {
			await expect(
				harness.archive("physical-managed-confirm-timeout"),
			).rejects.toMatchObject({ code: "chat_lifecycle_failed" });
			await harness.archiveSettled;
			expect(promptSignal?.aborted).toBe(true);
			expect(harness.mutationCount()).toBe(0);
		} finally {
			await harness.cleanup();
		}
	});

	it.each(["disconnect", "epoch revoke", "unregister", "shutdown"] as const)(
		"rejects late approval after physical managed %s during the prompt",
		async (terminationKind) => {
			let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
			let promptSignal: AbortSignal | undefined;
			const confirmCatalogMutation = vi.fn(
				(request: HubWorkspaceCatalogConfirmationRequest) => {
					promptSignal = request.signal;
					return new Promise<boolean>((resolve) => {
						resolveConfirmation = resolve;
					});
				},
			);
			const harness = await physicalManagedConfirmationHarness({
				confirmCatalogMutation,
			});
			try {
				const outcome = harness
					.archive(
						`physical-managed-${terminationKind.replace(" ", "-")}-pending`,
					)
					.then(
						() => undefined,
						(error: unknown) => error,
					);
				await vi.waitFor(() =>
					expect(confirmCatalogMutation).toHaveBeenCalledOnce(),
				);

				let termination: Promise<void>;
				switch (terminationKind) {
					case "disconnect":
						termination = harness.client.dispose();
						break;
					case "epoch revoke":
						termination = harness.control.revoke(
							harness.registration.workspaceId,
						);
						break;
					case "unregister":
						termination = harness.control.unregister(
							harness.registration.workspaceId,
						);
						break;
					case "shutdown":
						termination = harness.server.close();
						break;
				}
				await vi.waitFor(() => expect(promptSignal?.aborted).toBe(true));
				resolveConfirmation?.(true);
				await harness.archiveSettled;
				await termination;
				expect(await outcome).toBeInstanceOf(Error);
				expect(harness.mutationCount()).toBe(0);
			} finally {
				await harness.cleanup();
			}
		},
	);

	it.each(["disconnect", "epoch revoke"] as const)(
		"keeps physical managed %s in the final mutation fence after approval",
		async (terminationKind) => {
			let reachApproval: () => void = () => undefined;
			const approvalReached = new Promise<void>((resolve) => {
				reachApproval = resolve;
			});
			let releaseCatalogEntry: () => void = () => undefined;
			const catalogEntryReleased = new Promise<void>((resolve) => {
				releaseCatalogEntry = resolve;
			});
			let mutationSignal: AbortSignal | undefined;
			const harness = await physicalManagedConfirmationHarness({
				confirmCatalogMutation: async () => true,
				afterApproval: async (fence) => {
					mutationSignal = fence.signal;
					reachApproval();
					await catalogEntryReleased;
				},
			});
			try {
				const outcome = harness
					.archive(
						`physical-managed-${terminationKind.replace(" ", "-")}-fence`,
					)
					.then(
						() => undefined,
						(error: unknown) => error,
					);
				await approvalReached;
				const termination =
					terminationKind === "disconnect"
						? harness.client.dispose()
						: Promise.all([
								harness.control.revoke(harness.registration.workspaceId),
								harness.client.dispose(),
							]).then(() => undefined);
				await vi.waitFor(() => expect(mutationSignal?.aborted).toBe(true));
				releaseCatalogEntry();
				await harness.archiveSettled;
				await termination;
				expect(await outcome).toBeInstanceOf(Error);
				expect(harness.mutationCount()).toBe(0);
			} finally {
				releaseCatalogEntry();
				await harness.cleanup();
			}
		},
	);

	it("round-trips the production interactive callback through one physical workspace WebSocket", async () => {
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "managed-callback-profile-"),
		);
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let client: NodeHubClient | undefined;
		let release: (() => void) | undefined;
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const api = lifecycleApi();
			let askQuestion:
				| NonNullable<
						NonNullable<RuntimeCapabilities["toolExecutors"]>["askQuestion"]
				  >
				| undefined;
			vi.mocked(api.startRoot).mockImplementation(async (input) => {
				askQuestion = input.startInput.capabilities?.toolExecutors?.askQuestion;
				return START;
			});
			vi.mocked(api.runTurn).mockImplementation(async (input) => {
				if (!askQuestion) throw new Error("missing ask-question executor");
				const answer = await askQuestion(
					"Which production path?",
					["Use A", "Use B"],
					{
						sessionId: input.sessionId,
						runId: input.operationId,
						agentId: "agent-1",
						iteration: 1,
						metadata: { workspacePath: workspaceRoot },
					},
				);
				return { ...TURN, text: answer } as AgentResult;
			});
			const profiles = createHubDaemonChatProfileResolver({
				workspaceRoot,
				resolveModelConfig: async () => ({
					providerId: "anthropic",
					modelId: "claude-test",
					apiKey: "private-api-key",
				}),
				resolveSystemPrompt: async () => "trusted system prompt",
			});
			const factory = createHubWorkspaceManagedClineCoreFactory({
				profiles,
				createCore: async () => ({
					chatLifecycle: api,
					chatLifecycleEventSource: inertEventSource(),
					runtime: runtimeHandle(),
					dispose: vi.fn(async () => {}),
				}),
			});
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "production-callback-owner",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeHubSessionHost(),
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				},
				workspaceManagedCoreFactory: factory,
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			if (!control) throw new Error("missing workspace authority control");
			const registration = control.list()[0];
			if (!registration) throw new Error("missing workspace registration");
			const clientId = "production-callback-client";
			client = new NodeHubClient({
				url: server.url,
				clientId,
				clientType: "test",
				workspaceRoot: canonicalWorkspaceRoot,
				workspaceCapabilityProvider: {
					getFreshCapability: () =>
						control.issue({ workspaceId: registration.workspaceId }),
				},
			});
			await client.connect();
			expect(
				await client.command("chat_lifecycle.start_root", {
					operationId: "production-start",
					sessionId: "session-1",
					start: { profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE },
				}),
			).toMatchObject({ ok: true });
			expect(askQuestion).toBeTypeOf("function");

			const events: HubEventEnvelope[] = [];
			release = client.subscribe((event) => events.push(event), {
				sessionId: "session-1",
			});
			const running = client.command("chat_lifecycle.run_turn", {
				operationId: "production-turn",
				sessionId: "session-1",
				prompt: "Ask the owner",
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
			const request = events.find(
				(event) => event.payload?.kind === "capability.requested",
			)?.payload as
				| { requestId?: string; capability?: string; request?: unknown }
				| undefined;
			expect(request).toMatchObject({
				capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
				request: {
					question: "Which production path?",
					options: ["Use A", "Use B"],
				},
			});
			expect(JSON.stringify(request)).not.toContain(workspaceRoot);
			expect(
				await client.command("chat_runtime.capability.respond", {
					operationId: "production-answer",
					sessionId: "session-1",
					runId: "production-turn",
					requestId: request?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use A" },
				}),
			).toMatchObject({
				ok: true,
				payload: { result: { accepted: true } },
			});
			await expect(running).resolves.toMatchObject({
				ok: true,
				payload: {
					result: { turn: { text: "Use A", finishReason: "completed" } },
				},
			});

			const stoppingRun = client.command("chat_lifecycle.run_turn", {
				operationId: "production-stop-turn",
				sessionId: "session-1",
				prompt: "Wait for the owner",
			});
			await vi.waitFor(() =>
				expect(
					events.some(
						(event) =>
							event.payload?.kind === "capability.requested" &&
							event.payload.runId === "production-stop-turn",
					),
				).toBe(true),
			);
			const stoppingRequest = events.find(
				(event) =>
					event.payload?.kind === "capability.requested" &&
					event.payload.runId === "production-stop-turn",
			)?.payload as { requestId?: string } | undefined;
			expect(
				await client.command("chat_lifecycle.stop", {
					operationId: "production-stop",
					sessionId: "session-1",
				}),
			).toMatchObject({ ok: true, payload: { result: { stopped: true } } });
			await expect(stoppingRun).rejects.toMatchObject({
				code: "chat_lifecycle_failed",
			});
			expect(
				events.some(
					(event) =>
						event.payload?.kind === "capability.cancelled" &&
						event.payload.runId === "production-stop-turn",
				),
			).toBe(true);
			await expect(
				client.command("chat_runtime.capability.respond", {
					operationId: "production-late-stop-answer",
					sessionId: "session-1",
					runId: "production-stop-turn",
					requestId: stoppingRequest?.requestId,
					capability: HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					result: { answer: "Use B" },
				}),
			).rejects.toMatchObject({ code: "session_not_found" });
		} finally {
			release?.();
			await client?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("reconciles a lost committed reclaim reply over a second physical socket before exposing ready", async () => {
		const workspaceRoot = mkdtempSync(
			join(tmpdir(), "managed-fresh-reattach-"),
		);
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let originalClient: ManagedHubChatClient | undefined;
		let freshClient: ManagedHubChatClient | undefined;
		const freshReclaimAttempts: Array<{
			payload: unknown;
			requiredConnectionGeneration: number | undefined;
		}> = [];
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			const api = lifecycleApi();
			let sessionKnown = false;
			vi.mocked(api.startRoot).mockImplementation(async () => {
				sessionKnown = true;
				return START;
			});
			const projectedChat: HubChatProjectionChat = {
				chatId: "chat-1",
				catalogState: "active",
				headSessionId: "session-1",
				title: "Physical reattach",
				titleSource: "owner",
				sourceKind: "hub",
				createdAt: "2026-08-15T11:00:00.000Z",
				lastActivityAt: "2026-08-15T12:00:00.000Z",
				revision: 1,
				sessionCount: 1,
				bindingCount: 0,
				sessions: [
					{
						chatId: "chat-1",
						sessionId: "session-1",
						relationKind: "root",
						ordinal: 0,
						attachedAt: "2026-08-15T11:00:00.000Z",
						executionStatus: "idle",
					},
				],
				bindings: [],
			};
			const audienceSource: CatalogAudienceChatSource = {
				currentSequence: () => 0,
				listAfter: ({ afterSequence }) => ({
					throughSequence: afterSequence,
					events: [],
					hasMore: false,
				}),
				createProjectionSnapshot: () => ({
					snapshotSequence: 0,
					chats: sessionKnown ? [projectedChat] : [],
				}),
				getProjection: ({ chatId }) => ({
					snapshotSequence: 0,
					chat: sessionKnown && chatId === "chat-1" ? projectedChat : null,
				}),
				getSessionProjection: ({ sessionId }) => ({
					snapshotSequence: 0,
					chat:
						sessionKnown && sessionId === "session-1" ? projectedChat : null,
				}),
			};
			let runtimeListener: ((event: never) => void) | undefined;
			const runtime = runtimeHandle();
			const rekeyManagedSessionAuthority = runtime.rekeyManagedSessionAuthority;
			if (!rekeyManagedSessionAuthority) {
				throw new Error("missing managed-session rekey fixture");
			}
			vi.mocked(runtime.subscribe).mockImplementation((listener) => {
				runtimeListener = listener as (event: never) => void;
				return () => {
					runtimeListener = undefined;
				};
			});
			vi.mocked(rekeyManagedSessionAuthority).mockImplementation(
				async (input) => {
					runtimeListener?.({
						type: "pending_prompts",
						payload: { sessionId: input.sessionId, prompts: [] },
					} as never);
					return {
						sessionId: input.sessionId,
						leaseRevision: input.expectedWriterGeneration + 1,
						writerGeneration: input.expectedWriterGeneration + 1,
						leaseExpiresAt: "2026-08-15T12:02:00.000Z",
					};
				},
			);
			vi.mocked(runtime.get).mockResolvedValue({
				sessionId: "session-1",
				metadata: {
					__clineManagedProfileAuthorityV1: {
						profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
						profileRevision: 1,
						authorityClassId:
							HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY.authorityClassId,
						policyEpoch: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY.policyEpoch,
						connectionPolicyDigest: "a".repeat(64),
						executionPolicyDigest: "b".repeat(64),
						interactive: true,
						allowedModes: ["act"],
					},
				},
			} as never);
			const factory = createHubWorkspaceManagedClineCoreFactory({
				profiles: {
					resolveStartProfile: async () => ({
						config: {
							providerId: "anthropic",
							modelId: "claude-test",
							systemPrompt: "trusted",
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
						interactive: true,
						profileRevision: 1,
						allowedModes: ["act"] as const,
					}),
					resolveBindingProfile: async () => undefined,
				},
				createCore: async () => ({
					chatLifecycle: api,
					chatLifecycleEventSource: undefined,
					chatAudienceSource: audienceSource,
					runtime,
					dispose: vi.fn(async () => {}),
				}),
			});
			server = await startHubWebSocketServer({
				host: "127.0.0.1",
				port: 0,
				owner: {
					ownerId: "physical-reattach-owner",
					discoveryPath: join(workspaceRoot, "hub-discovery.json"),
				},
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
				scheduleOptions: { dbPath: ":memory:" },
				sessionHost: fakeHubSessionHost(),
				chatCatalog: {
					port: {} as never,
					confirmationBroker: new HubChatCatalogConfirmationBroker(),
					authorize: vi.fn() as never,
				},
				workspaceAuthority: {
					trustedWorkspaceKeys: [canonicalWorkspaceRoot],
					connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
					defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				},
				workspaceManagedCoreFactory: factory,
				managedChatLifecycleEnabled: true,
			});
			const control = server.workspaceAuthority;
			if (!control) throw new Error("missing workspace authority control");
			const registration = control.list()[0];
			if (!registration) throw new Error("missing workspace registration");
			const provider = {
				getFreshCapability: () =>
					control.issue({ workspaceId: registration.workspaceId }),
			};
			const versionUrl = new URL(server.url);
			versionUrl.protocol = "http:";
			versionUrl.pathname = "/version";
			versionUrl.search = "";
			const capabilityProbe = async (): Promise<HubProtocolMetadata> =>
				(await (await fetch(versionUrl)).json()) as HubProtocolMetadata;
			const createManagedClient = (
				clientId: string,
				loseFirstReclaimReply = false,
			) =>
				ManagedHubChatClient.create({
					capabilityProbe,
					workspaceCapabilityProvider: provider,
					transportFactory: ({ workspaceCapabilityProvider }) => {
						const transport = new NodeHubClient({
							url: server?.url ?? "",
							clientId,
							clientType: "test",
							workspaceRoot: canonicalWorkspaceRoot,
							workspaceCapabilityProvider,
						});
						if (!loseFirstReclaimReply) return transport;
						let replyLost = false;
						return new Proxy(transport, {
							get(target, property, receiver) {
								if (property === "command") {
									return async (
										...args: Parameters<NodeHubClient["command"]>
									) => {
										if (args[0] === "chat_runtime.session.reclaim") {
											freshReclaimAttempts.push({
												payload: structuredClone(args[1]),
												requiredConnectionGeneration:
													args[3]?.requiredConnectionGeneration,
											});
											const reply = await target.command(...args);
											if (!replyLost) {
												replyLost = true;
												throw Object.assign(
													new Error("committed reclaim reply lost"),
													{ code: "hub_connection_closed" },
												);
											}
											return reply;
										}
										return await target.command(...args);
									};
								}
								const value = Reflect.get(target, property, receiver);
								return typeof value === "function" ? value.bind(target) : value;
							},
						}) as ManagedHubChatTransport;
					},
					readinessTimeoutMs: 2_000,
				});

			originalClient = await createManagedClient("physical-original-client");
			const originalSession = await originalClient.startRoot({
				operationId: "physical-original-start",
				sessionId: "session-1",
				chatId: "chat-1",
				start: { profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE },
			});
			expect(originalSession.getSnapshot().state).toBe("ready");
			await originalClient.dispose();
			originalClient = undefined;

			freshClient = await createManagedClient("physical-fresh-client", true);
			const reattached = await freshClient.reattach({
				operationId: "physical-nonresident-resume",
				sessionId: "session-1",
				start: { profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE },
			});
			expect(reattached.getSnapshot()).toMatchObject({
				state: "ready",
				hydration: { replayAvailable: true },
				controller: {
					writerGeneration: 2,
					cursor: { sessionSequence: 1 },
				},
			});
			expect(runtime.rekeyManagedSessionAuthority).toHaveBeenCalledOnce();
			expect(freshReclaimAttempts).toHaveLength(2);
			expect(freshReclaimAttempts[0]).toEqual(freshReclaimAttempts[1]);
			expect(api.resume).not.toHaveBeenCalled();
			await expect(
				reattached.runTurn({
					operationId: "physical-turn-after-reattach",
					prompt: "continue",
				}),
			).resolves.toMatchObject({
				turn: { text: "sanitized final text", finishReason: "completed" },
			});
		} finally {
			await freshClient?.dispose();
			await originalClient?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("uses ordinary resume with a new runtime stream after an actual Hub server restart", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "managed-hub-restart-"));
		let server: Awaited<ReturnType<typeof startHubWebSocketServer>> | undefined;
		let firstClient: ManagedHubChatClient | undefined;
		let secondClient: ManagedHubChatClient | undefined;
		let secondTransport: NodeHubClient | undefined;
		try {
			const canonicalWorkspaceRoot = realpathSync(workspaceRoot);
			let sessionKnown = false;
			const projectedChat: HubChatProjectionChat = {
				chatId: "chat-1",
				catalogState: "active",
				headSessionId: "session-1",
				title: "Restart continuity",
				titleSource: "owner",
				sourceKind: "hub",
				createdAt: "2026-08-15T11:00:00.000Z",
				lastActivityAt: "2026-08-15T12:00:00.000Z",
				revision: 1,
				sessionCount: 1,
				bindingCount: 0,
				sessions: [
					{
						chatId: "chat-1",
						sessionId: "session-1",
						relationKind: "root",
						ordinal: 0,
						attachedAt: "2026-08-15T11:00:00.000Z",
						executionStatus: "idle",
					},
				],
				bindings: [],
			};
			const audienceSource: CatalogAudienceChatSource = {
				currentSequence: () => 0,
				listAfter: ({ afterSequence }) => ({
					throughSequence: afterSequence,
					events: [],
					hasMore: false,
				}),
				createProjectionSnapshot: () => ({
					snapshotSequence: 0,
					chats: sessionKnown ? [projectedChat] : [],
				}),
				getProjection: ({ chatId }) => ({
					snapshotSequence: 0,
					chat: sessionKnown && chatId === "chat-1" ? projectedChat : null,
				}),
				getSessionProjection: ({ sessionId }) => ({
					snapshotSequence: 0,
					chat:
						sessionKnown && sessionId === "session-1" ? projectedChat : null,
				}),
			};
			const startServer = async (
				ownerId: string,
				api: ClineCoreChatLifecycleApi,
				runtime: ManagedRuntimeCoreHandle,
			) => {
				const factory = createHubWorkspaceManagedClineCoreFactory({
					profiles: {
						resolveStartProfile: async () => ({
							config: {
								providerId: "anthropic",
								modelId: "claude-test",
								systemPrompt: "trusted",
								enableTools: true,
								enableSpawnAgent: false,
								enableAgentTeams: false,
							},
							interactive: true,
							profileRevision: 1,
							allowedModes: ["act"] as const,
						}),
						resolveBindingProfile: async () => undefined,
					},
					createCore: async () => ({
						chatLifecycle: api,
						chatLifecycleEventSource: undefined,
						chatAudienceSource: audienceSource,
						runtime,
						dispose: vi.fn(async () => {}),
					}),
				});
				return await startHubWebSocketServer({
					host: "127.0.0.1",
					port: 0,
					owner: {
						ownerId,
						discoveryPath: join(workspaceRoot, "hub-discovery.json"),
					},
					runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
					scheduleOptions: { dbPath: ":memory:" },
					sessionHost: fakeHubSessionHost(),
					chatCatalog: {
						port: {} as never,
						confirmationBroker: new HubChatCatalogConfirmationBroker(),
						authorize: vi.fn() as never,
					},
					workspaceAuthority: {
						trustedWorkspaceKeys: [canonicalWorkspaceRoot],
						connectionPolicies: [HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY],
						defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
					},
					workspaceManagedCoreFactory: factory,
					managedChatLifecycleEnabled: true,
				});
			};
			const createClient = async (
				activeServer: Awaited<ReturnType<typeof startHubWebSocketServer>>,
				clientId: string,
				onTransport?: (transport: NodeHubClient) => void,
			) => {
				const control = activeServer.workspaceAuthority;
				if (!control) throw new Error("missing workspace authority control");
				const registration = control.list()[0];
				if (!registration) throw new Error("missing workspace registration");
				const versionUrl = new URL(activeServer.url);
				versionUrl.protocol = "http:";
				versionUrl.pathname = "/version";
				versionUrl.search = "";
				return await ManagedHubChatClient.create({
					capabilityProbe: async () =>
						(await (await fetch(versionUrl)).json()) as HubProtocolMetadata,
					workspaceCapabilityProvider: {
						getFreshCapability: () =>
							control.issue({ workspaceId: registration.workspaceId }),
					},
					transportFactory: ({ workspaceCapabilityProvider }) => {
						const transport = new NodeHubClient({
							url: activeServer.url,
							clientId,
							clientType: "test",
							workspaceRoot: canonicalWorkspaceRoot,
							workspaceCapabilityProvider,
						});
						onTransport?.(transport);
						return transport;
					},
					readinessTimeoutMs: 2_000,
				});
			};

			const firstApi = lifecycleApi();
			vi.mocked(firstApi.startRoot).mockImplementation(async () => {
				sessionKnown = true;
				return START;
			});
			server = await startServer(
				"physical-restart-owner",
				firstApi,
				runtimeHandle(),
			);
			firstClient = await createClient(server, "physical-before-restart");
			const firstSession = await firstClient.startRoot({
				operationId: "physical-before-restart-start",
				sessionId: "session-1",
				chatId: "chat-1",
				start: { profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE },
			});
			const oldCursor = firstSession.getSnapshot().controller.cursor;
			if (!oldCursor) throw new Error("missing pre-restart runtime cursor");

			await server.close();
			server = undefined;
			await firstClient.dispose();
			firstClient = undefined;

			const secondApi = lifecycleApi();
			const secondRuntime = runtimeHandle();
			server = await startServer(
				"physical-restart-owner",
				secondApi,
				secondRuntime,
			);
			secondClient = await createClient(
				server,
				"physical-after-restart",
				(transport) => {
					secondTransport = transport;
				},
			);
			const resumed = await secondClient.reattach({
				operationId: "physical-after-restart-resume",
				sessionId: "session-1",
				start: { profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE },
			});
			const newCursor = resumed.getSnapshot().controller.cursor;
			if (!newCursor || !secondTransport) {
				throw new Error("missing post-restart runtime cursor or transport");
			}
			expect(resumed.hydration).toBeUndefined();
			expect(secondApi.resume).toHaveBeenCalledOnce();
			expect(secondRuntime.rekeyManagedSessionAuthority).not.toHaveBeenCalled();
			expect(newCursor.streamId).not.toBe(oldCursor.streamId);

			let rejectedStatus:
				| { status: "ready" | "rejected"; errorCode?: string }
				| undefined;
			const release = secondTransport.subscribe(() => {}, {
				sessionId: "session-1",
				fenced: true,
				requiredConnectionGeneration:
					secondTransport.getRegisteredConnectionGeneration(),
				runtimeCursor: () => oldCursor,
				onStatus: (status) => {
					rejectedStatus = status;
				},
			});
			await vi.waitFor(() =>
				expect(rejectedStatus).toMatchObject({
					status: "rejected",
					errorCode: "subscription_rejected",
				}),
			);
			release();
		} finally {
			await secondClient?.dispose();
			await firstClient?.dispose();
			await server?.close();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	it("orphan-registers a successful start when its connection closes before reply", async () => {
		const api = lifecycleApi();
		const startSignal = new AbortController();
		(api.startRoot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			startSignal.abort();
			return START;
		});
		const runtime = runtimeHandle();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
				}),
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				runtime,
				dispose: vi.fn(async () => {}),
			}),
		});
		const authority = new HubWorkspaceCapabilityAuthority();
		const issueIdentity = () =>
			authority.consume({
				credential: authority.issue({
					principalId: "owner-1",
					workspaceKey: WORKSPACE,
				}).credential,
				transport: "websocket",
			});
		const owner = issueIdentity();
		const replacement = issueIdentity();
		const scopeSignal = new AbortController();
		const managed = await factory.create({
			principalId: owner.principalId,
			tenantId: owner.tenantId,
			workspaceKey: owner.workspaceKey,
			workspaceEpoch: owner.workspaceEpoch,
			authorityClassId: owner.policy.authorityClassId,
			audienceId: owner.policy.audienceId,
			policyEpoch: owner.policy.policyEpoch,
			signal: scopeSignal.signal,
		});
		const lifecycle = managed.lifecycleWire;
		const runtimeWire = managed.runtimeWire;
		if (!lifecycle || !runtimeWire)
			throw new Error("managed wires unavailable");

		await expect(
			lifecycle.invoke({
				identity: owner,
				signal: startSignal.signal,
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "orphaned-start",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				},
			}),
		).rejects.toThrow();
		await expect(
			runtimeWire.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_runtime.session.reclaim",
				payload: {
					operationId: "reclaim-orphaned-start",
					sessionId: "session-1",
					expectedWriterGeneration: 1,
				},
			}),
		).resolves.toMatchObject({
			sessionId: "session-1",
			writerGeneration: 2,
		});
		expect(runtime.rekeyManagedSessionAuthority).toHaveBeenCalledTimes(1);
		await managed.dispose("orphaned_start_test_complete");
	});

	it("replays a lost admission reply onto a fresh connection with current writer authority", async () => {
		const api = lifecycleApi();
		const firstConnection = new AbortController();
		let startCalls = 0;
		(api.startRoot as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			startCalls += 1;
			if (startCalls === 1) firstConnection.abort(new Error("reply lost"));
			return START;
		});
		const runtime = runtimeHandle();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
				}),
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				runtime,
				dispose: vi.fn(async () => {}),
			}),
		});
		const authority = new HubWorkspaceCapabilityAuthority();
		const issueIdentity = () =>
			authority.consume({
				credential: authority.issue({
					principalId: "owner-1",
					workspaceKey: WORKSPACE,
				}).credential,
				transport: "websocket",
			});
		const original = issueIdentity();
		const replacement = issueIdentity();
		const scopeSignal = new AbortController();
		const managed = await factory.create({
			principalId: original.principalId,
			tenantId: original.tenantId,
			workspaceKey: original.workspaceKey,
			workspaceEpoch: original.workspaceEpoch,
			authorityClassId: original.policy.authorityClassId,
			audienceId: original.policy.audienceId,
			policyEpoch: original.policy.policyEpoch,
			signal: scopeSignal.signal,
		});
		const lifecycle = managed.lifecycleWire;
		const runtimeEvents = managed.runtimeEventWire;
		if (!lifecycle || !runtimeEvents)
			throw new Error("managed wires unavailable");
		const intent = {
			operationId: "lost-admission-reply",
			sessionId: "session-1",
			start: { profileId: "profile-1" },
		};

		await expect(
			lifecycle.invoke({
				identity: original,
				signal: firstConnection.signal,
				command: "chat_lifecycle.start_root",
				payload: intent,
			}),
		).rejects.toThrow();
		const replayed = await lifecycle.invoke({
			identity: replacement,
			signal: authority.signal(replacement),
			command: "chat_lifecycle.start_root",
			payload: intent,
		});
		expect(replayed).toMatchObject({
			sessionId: "session-1",
			leaseRevision: 2,
			writerGeneration: 2,
			leaseExpiresAt: "2026-08-15T12:02:00.000Z",
		});
		expect(api.startRoot).toHaveBeenCalledTimes(2);
		expect(runtime.rekeyManagedSessionAuthority).toHaveBeenCalledOnce();
		expect(runtime.rekeyManagedSessionAuthority).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "session-1",
				expectedWriterGeneration: 1,
			}),
		);

		const ready = vi.fn();
		const release = runtimeEvents.subscribe({
			identity: replacement,
			signal: authority.signal(replacement),
			sessionId: "session-1",
			emit: vi.fn(),
			ready,
		});
		expect(ready).toHaveBeenCalledOnce();
		await expect(
			lifecycle.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_lifecycle.run_turn",
				payload: {
					operationId: "turn-after-admission-replay",
					sessionId: "session-1",
					prompt: "continue",
				},
			}),
		).resolves.toMatchObject({ turn: { text: "sanitized final text" } });
		release();
		await managed.dispose("lost_admission_reply_test_complete");
	});

	it("applies exact never-ready admission replay to every derived and restart command", async () => {
		const scenarios = [
			{
				command: "chat_lifecycle.start_related" as const,
				method: "startRelated" as const,
				payload: {
					operationId: "lost-related-reply",
					sessionId: "session-1",
					chatId: "chat-1",
					parentSessionId: "parent-session",
					relationKind: "fork",
					start: { profileId: "profile-1" },
				},
			},
			{
				command: "chat_lifecycle.restore_checkpoint" as const,
				method: "restoreCheckpoint" as const,
				payload: {
					operationId: "lost-restore-reply",
					sessionId: "session-1",
					chatId: "chat-1",
					parentSessionId: "parent-session",
					checkpointRunCount: 1,
					start: { profileId: "profile-1" },
				},
			},
			{
				command: "chat_lifecycle.resume" as const,
				method: "resume" as const,
				payload: {
					operationId: "lost-resume-reply",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				},
			},
			{
				command: "chat_lifecycle.recover_lost_lease" as const,
				method: "recoverLostLease" as const,
				payload: {
					operationId: "lost-recovery-reply",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				},
			},
		];
		for (const scenario of scenarios) {
			const api = lifecycleApi();
			const firstConnection = new AbortController();
			let calls = 0;
			const durableResult =
				scenario.command === "chat_lifecycle.restore_checkpoint"
					? {
							...START,
							messages: [],
							checkpoint: { createdAt: 1, runCount: 1, kind: "stash" },
						}
					: START;
			(api[scenario.method] as ReturnType<typeof vi.fn>).mockImplementation(
				async () => {
					calls += 1;
					if (calls === 1) {
						firstConnection.abort(new Error("admission reply lost"));
					}
					return durableResult;
				},
			);
			const runtime = runtimeHandle();
			const factory = createHubWorkspaceManagedClineCoreFactory({
				profiles: {
					resolveStartProfile: async () => ({
						config: {
							providerId: "anthropic",
							modelId: "claude-test",
							systemPrompt: "trusted",
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
						interactive: true,
						profileRevision: 1,
						allowedModes: ["act"] as const,
					}),
					resolveBindingProfile: async () => undefined,
				},
				createCore: async () => ({
					chatLifecycle: api,
					chatLifecycleEventSource: inertEventSource(),
					runtime,
					dispose: vi.fn(async () => {}),
				}),
			});
			const authority = new HubWorkspaceCapabilityAuthority();
			const issueIdentity = () =>
				authority.consume({
					credential: authority.issue({
						principalId: "owner-1",
						workspaceKey: WORKSPACE,
					}).credential,
					transport: "websocket",
				});
			const original = issueIdentity();
			const replacement = issueIdentity();
			const scopeSignal = new AbortController();
			const managed = await factory.create({
				principalId: original.principalId,
				tenantId: original.tenantId,
				workspaceKey: original.workspaceKey,
				workspaceEpoch: original.workspaceEpoch,
				authorityClassId: original.policy.authorityClassId,
				audienceId: original.policy.audienceId,
				policyEpoch: original.policy.policyEpoch,
				signal: scopeSignal.signal,
			});
			const lifecycle = managed.lifecycleWire;
			if (!lifecycle) throw new Error("missing lifecycle wire");
			await expect(
				lifecycle.invoke({
					identity: original,
					signal: firstConnection.signal,
					command: scenario.command,
					payload: scenario.payload,
				}),
			).rejects.toThrow();
			await expect(
				lifecycle.invoke({
					identity: replacement,
					signal: authority.signal(replacement),
					command: scenario.command,
					payload: scenario.payload,
				}),
			).resolves.toMatchObject({
				sessionId: "session-1",
				leaseRevision: 2,
				writerGeneration: 2,
			});
			expect(api[scenario.method]).toHaveBeenCalledTimes(2);
			expect(runtime.rekeyManagedSessionAuthority).toHaveBeenCalledOnce();
			await managed.dispose(`lost_${scenario.method}_reply_test_complete`);
		}
	});

	it("refuses cursorless admission reclaim after the original handle became ready", async () => {
		const api = lifecycleApi();
		const runtime = runtimeHandle();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
				}),
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				runtime,
				dispose: vi.fn(async () => {}),
			}),
		});
		const authority = new HubWorkspaceCapabilityAuthority();
		const issueIdentity = () =>
			authority.consume({
				credential: authority.issue({
					principalId: "owner-1",
					workspaceKey: WORKSPACE,
				}).credential,
				transport: "websocket",
			});
		const original = issueIdentity();
		const replacement = issueIdentity();
		const originalConnection = new AbortController();
		const scopeSignal = new AbortController();
		const managed = await factory.create({
			principalId: original.principalId,
			tenantId: original.tenantId,
			workspaceKey: original.workspaceKey,
			workspaceEpoch: original.workspaceEpoch,
			authorityClassId: original.policy.authorityClassId,
			audienceId: original.policy.audienceId,
			policyEpoch: original.policy.policyEpoch,
			signal: scopeSignal.signal,
		});
		const lifecycle = managed.lifecycleWire;
		const runtimeEvents = managed.runtimeEventWire;
		if (!lifecycle || !runtimeEvents)
			throw new Error("managed wires unavailable");
		const intent = {
			operationId: "ready-admission",
			sessionId: "session-1",
			start: { profileId: "profile-1" },
		};
		await lifecycle.invoke({
			identity: original,
			signal: originalConnection.signal,
			command: "chat_lifecycle.start_root",
			payload: intent,
		});
		const release = runtimeEvents.subscribe({
			identity: original,
			signal: originalConnection.signal,
			sessionId: "session-1",
			emit: vi.fn(),
			ready: vi.fn(),
		});
		originalConnection.abort(new Error("connection closed"));

		await expect(
			lifecycle.invoke({
				identity: replacement,
				signal: authority.signal(replacement),
				command: "chat_lifecycle.start_root",
				payload: intent,
			}),
		).rejects.toMatchObject({ code: "lease_conflict" });
		expect(api.startRoot).toHaveBeenCalledTimes(2);
		expect(runtime.rekeyManagedSessionAuthority).not.toHaveBeenCalled();
		release();
		await managed.dispose("ready_admission_replay_test_complete");
	});

	it("reserves runtime journal capacity before a durable start", async () => {
		const api = lifecycleApi();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
				}),
				resolveBindingProfile: async () => undefined,
			},
			runtimeRecoveryJournal: { maxSessions: 1 },
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				runtime: runtimeHandle(),
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const start = (operationId: string, sessionId: string) =>
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.start_root",
				payload: {
					operationId,
					sessionId,
					start: { profileId: "profile-1" },
				},
			});

		await expect(start("start-capacity-1", "session-1")).resolves.toBeDefined();
		await expect(start("start-capacity-2", "session-2")).rejects.toThrow(
			"metadata bound",
		);
		expect(api.startRoot).toHaveBeenCalledOnce();
		await managed.dispose("capacity_test_complete");
	});

	it("projects exact ordered SQLite events through the default ClineCore factory", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "managed-core-events-"));
		const { identity } = identityFixture();
		const seed = new SqliteChatCatalogService({ dataDir });
		seed.admitRootSession({
			chatId: "chat-real-events",
			audienceId: identity.policy.audienceId,
			sessionId: "session-real-events",
			source: SessionSource.CLI,
			pid: process.pid,
			startedAt: "2026-08-15T11:00:00.000Z",
			interactive: true,
			provider: "test-provider",
			model: "test-model",
			cwd: WORKSPACE,
			workspaceRoot: WORKSPACE,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			metadata: { operationId: "seed-real-events" },
			provenance: {
				invocationId: "seed-real-events",
				occurredAt: "2026-08-15T11:00:00.000Z",
				actor: { kind: "human", id: "owner-1" },
				source: { kind: "interactive", transport: "test" },
			},
		});
		seed.close();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			dataDirForScope: () => dataDir,
		});
		const controller = new AbortController();
		let managed: Awaited<ReturnType<typeof factory.create>> | undefined;
		try {
			managed = await factory.create({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
				workspaceEpoch: identity.workspaceEpoch,
				authorityClassId: identity.policy.authorityClassId,
				audienceId: identity.policy.audienceId,
				policyEpoch: identity.policy.policyEpoch,
				signal: controller.signal,
			});
			const events: HubEventEnvelope[] = [];
			const release = managed.eventWire?.subscribe({
				identity,
				signal: controller.signal,
				emit: (event) => events.push(parseHubChatLifecycleWireEvent(event)),
			});
			await managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.rename",
				payload: {
					operationId: "rename-real-events",
					chatId: "chat-real-events",
					expectedRevision: 1,
					title: "Authoritative event source",
				},
			});
			const probe = new SqliteChatCatalogService({ dataDir });
			const persisted = probe.listEvents("chat-real-events").at(-1);
			probe.close();
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				eventId: persisted?.eventId,
				payload: {
					eventType: "chat.renamed",
					aggregateKind: "chat",
					aggregateId: "chat-real-events",
					previousRevision: 1,
					resultingRevision: 2,
					chat: null,
				},
			});
			expect(JSON.stringify(events)).not.toContain("seed-real-events");
			expect(JSON.stringify(events)).not.toContain(WORKSPACE);
			release?.();
		} finally {
			await managed?.dispose("real_event_source_test_complete");
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	it("filters SQLite projection and exact replay by audience while advancing hidden gaps", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "managed-core-audience-"));
		const { identity } = identityFixture();
		const seed = new SqliteChatCatalogService({ dataDir });
		const admit = (chatId: string, audienceId: string, minute: number) =>
			seed.admitRootSession({
				chatId,
				audienceId,
				sessionId: `session-${chatId}`,
				source: SessionSource.CLI,
				pid: process.pid,
				startedAt: `2026-08-15T11:${String(minute).padStart(2, "0")}:00.000Z`,
				interactive: true,
				provider: "test-provider",
				model: "test-model",
				cwd: WORKSPACE,
				workspaceRoot: WORKSPACE,
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				metadata: { operationId: `seed-${chatId}` },
				provenance: {
					invocationId: `seed-${chatId}`,
					occurredAt: `2026-08-15T11:${String(minute).padStart(2, "0")}:00.000Z`,
					actor: { kind: "human", id: "owner-1" },
					source: { kind: "interactive", transport: "test" },
				},
			});
		admit("chat-foreign-before", "aud_foreign_connector_v1", 1);
		admit("chat-owned", identity.policy.audienceId, 2);
		admit("chat-foreign-after", "aud_foreign_worker_v1", 3);
		const catalogHead = seed.currentEventSequence();
		seed.close();

		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			dataDirForScope: () => dataDir,
		});
		const controller = new AbortController();
		let managed: Awaited<ReturnType<typeof factory.create>> | undefined;
		try {
			managed = await factory.create({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
				workspaceEpoch: identity.workspaceEpoch,
				authorityClassId: identity.policy.authorityClassId,
				audienceId: identity.policy.audienceId,
				policyEpoch: identity.policy.policyEpoch,
				signal: controller.signal,
			});
			const list = await managed.projectionWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_projection.list",
				payload: { catalogState: "all", limit: 10 },
			});
			expect(list).toMatchObject({
				snapshotSequence: catalogHead,
				chats: [{ chatId: "chat-owned" }],
				hasMore: false,
			});
			const foreign = await managed.projectionWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_projection.get",
				payload: { chatId: "chat-foreign-before" },
			});
			expect(foreign).toMatchObject({
				snapshotSequence: catalogHead,
				chat: null,
			});

			const order: string[] = [];
			const events: ReturnType<
				typeof parseHubChatLifecycleReconciledWireEvent
			>[] = [];
			const ready = vi.fn((throughSequence: number) => {
				order.push(`ready:${throughSequence}`);
			});
			const release = managed.eventWire?.subscribe({
				identity,
				signal: controller.signal,
				afterSequence: 0,
				emit: (event) => {
					const parsed = parseHubChatLifecycleReconciledWireEvent(event);
					events.push(parsed);
					order.push(`event:${parsed.catalogSequence}`);
				},
				ready,
			});
			expect(events.map((event) => event.catalogSequence)).toEqual([3, 4]);
			expect(events.map((event) => event.previousDeliveredSequence)).toEqual([
				0, 3,
			]);
			expect(
				events.every(
					(event) =>
						event.payload.chatId === "chat-owned" &&
						event.payload.chat?.chatId === "chat-owned",
				),
			).toBe(true);
			expect(order).toEqual(["event:3", "event:4", `ready:${catalogHead}`]);
			expect(ready).toHaveBeenCalledWith(catalogHead);
			expect(JSON.stringify({ list, foreign, events })).not.toContain(
				"chat-foreign-after",
			);
			release?.();

			const rejectedReady = vi.fn();
			expect(() =>
				managed?.eventWire?.subscribe({
					identity,
					signal: controller.signal,
					afterSequence: 0,
					emit: () => {
						throw new Error("downstream refused replay");
					},
					ready: rejectedReady,
				}),
			).toThrow("lifecycle replay delivery was not admitted");
			expect(rejectedReady).not.toHaveBeenCalled();
			expect(() =>
				managed?.eventWire?.subscribe({
					identity,
					signal: controller.signal,
					afterSequence: catalogHead + 1,
					emit: () => {},
					ready: vi.fn(),
				}),
			).toThrow("cursor is ahead");
		} finally {
			await managed?.dispose("audience_projection_test_complete");
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	it("pins projection continuation to one connection, query, and immutable snapshot cut", async () => {
		const projection = (
			chatId: string,
			title: string,
			minute: number,
		): HubChatProjectionChat => ({
			chatId,
			catalogState: "active",
			headSessionId: `session-${chatId}`,
			title,
			titleSource: "owner",
			sourceKind: "interactive",
			createdAt: "2026-08-15T11:00:00.000Z",
			lastActivityAt: `2026-08-15T12:${String(minute).padStart(2, "0")}:00.000Z`,
			revision: 1,
			sessionCount: 1,
			bindingCount: 0,
			sessions: [
				{
					chatId,
					sessionId: `session-${chatId}`,
					relationKind: "root",
					ordinal: 0,
					attachedAt: "2026-08-15T11:00:00.000Z",
					executionStatus: "idle",
				},
			],
			bindings: [],
		});
		let sequence = 9;
		let chats = [
			projection("chat-a", "A at cut", 3),
			projection("chat-b", "B at cut", 2),
			projection("chat-c", "C at cut", 1),
		];
		const source: CatalogAudienceChatSource = {
			currentSequence: () => sequence,
			listAfter: ({ afterSequence }) => ({
				throughSequence: Math.max(afterSequence, sequence),
				events: [],
				hasMore: false,
			}),
			createProjectionSnapshot: ({ catalogState = "all", maxChats }) => ({
				snapshotSequence: sequence,
				chats: chats
					.filter(
						(chat) =>
							catalogState === "all" || chat.catalogState === catalogState,
					)
					.slice(0, maxChats),
			}),
			getProjection: ({ chatId }) => ({
				snapshotSequence: sequence,
				chat: chats.find((chat) => chat.chatId === chatId) ?? null,
			}),
			getSessionProjection: ({ sessionId }) => ({
				snapshotSequence: sequence,
				chat:
					chats.find((chat) =>
						chat.sessions.some((session) => session.sessionId === sessionId),
					) ?? null,
			}),
		};
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: lifecycleApi(),
				chatLifecycleEventSource: undefined,
				chatAudienceSource: source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { authority, identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		try {
			const first = (await managed.projectionWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_projection.list",
				payload: { catalogState: "all", limit: 2 },
			})) as {
				snapshotId: string;
				snapshotSequence: number;
				chats: HubChatProjectionChat[];
				nextCursor: string;
				hasMore: boolean;
			};
			expect(first.chats.map((chat) => chat.chatId)).toEqual([
				"chat-a",
				"chat-b",
			]);
			expect(first).toMatchObject({ snapshotSequence: 9, hasMore: true });

			sequence = 10;
			chats = [
				projection("chat-new", "New after cut", 4),
				projection("chat-c", "C changed after cut", 1),
			];
			const current = await managed.projectionWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_projection.get",
				payload: { chatId: "chat-c" },
			});
			expect(current).toMatchObject({
				snapshotSequence: 10,
				chat: { title: "C changed after cut" },
			});

			const second = await managed.projectionWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_projection.list",
				payload: {
					catalogState: "all",
					limit: 2,
					snapshotId: first.snapshotId,
					cursor: first.nextCursor,
				},
			});
			expect(second).toMatchObject({
				snapshotId: first.snapshotId,
				snapshotSequence: 9,
				chats: [{ chatId: "chat-c", title: "C at cut" }],
				hasMore: false,
			});
			await expect(
				managed.projectionWire?.invoke({
					identity,
					signal: controller.signal,
					command: "chat_projection.list",
					payload: {
						catalogState: "all",
						limit: 3,
						snapshotId: first.snapshotId,
						cursor: first.nextCursor,
					},
				}),
			).rejects.toThrow("continuation is unavailable");

			const replacement = authority.consume({
				credential: authority.issue({
					principalId: identity.principalId,
					workspaceKey: identity.workspaceKey,
				}).credential,
				transport: "websocket",
			});
			await expect(
				managed.projectionWire?.invoke({
					identity: replacement,
					signal: controller.signal,
					command: "chat_projection.list",
					payload: {
						catalogState: "all",
						limit: 2,
						snapshotId: first.snapshotId,
						cursor: first.nextCursor,
					},
				}),
			).rejects.toThrow("continuation is unavailable");
		} finally {
			await managed.dispose("projection_snapshot_test_complete");
		}
	});

	it("resolves binding profiles and rejects unknown profiles before Core calls", async () => {
		const api = lifecycleApi();
		const resolveBindingProfile = vi.fn(async ({ requested }) =>
			requested.channelId === "allowed-channel"
				? {
						transport: "slack",
						instanceId: "trusted-instance",
						channelId: requested.channelId,
						threadId: requested.threadId,
						participantScope: "trusted-participant",
					}
				: undefined,
		);
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.binding.get",
				payload: {
					profileId: "slack-binding",
					channelId: "denied-channel",
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(api.getBinding).not.toHaveBeenCalled();

		await managed.lifecycleWire?.invoke({
			identity,
			signal: controller.signal,
			command: "chat_lifecycle.bind",
			payload: {
				operationId: "bind-1",
				sessionId: "session-1",
				target: {
					profileId: "slack-binding",
					channelId: "allowed-channel",
					threadId: "thread-1",
					bindingId: "binding-1",
					expectedBindingRevision: 0,
				},
			},
		});
		expect(api.bind).toHaveBeenCalledWith({
			operationId: "bind-1",
			sessionId: "session-1",
			target: {
				transport: "slack",
				instanceId: "trusted-instance",
				channelId: "allowed-channel",
				threadId: "thread-1",
				participantScope: "trusted-participant",
				bindingId: "binding-1",
				expectedBindingRevision: 0,
			},
		});
	});

	it("rejects resolver-supplied session and path authority before Core calls", async () => {
		const api = lifecycleApi();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted system prompt",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
						sessionId: "forged-session",
						cwd: "/tmp/forged-cwd",
						workspaceRoot: "/tmp/forged-workspace",
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
				}),
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});

		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-forged-profile",
					sessionId: "session-1",
					start: { profileId: "forged-profile" },
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(api.startRoot).not.toHaveBeenCalled();
		await managed.dispose("test_complete");
	});

	it("rejects unknown profile callback authority before Core calls", async () => {
		const api = lifecycleApi();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						systemPrompt: "trusted system prompt",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act"] as const,
					runtimeCapabilityManifest: {
						callbacks: ["tool_executor.bash"],
					} as never,
				}),
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				runtime: runtimeHandle(),
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});

		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-forged-callback",
					sessionId: "session-1",
					start: { profileId: "forged-profile" },
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(api.startRoot).not.toHaveBeenCalled();
		await managed.dispose("test_complete");
	});

	it("dispatches and validates every managed lifecycle v1 command", async () => {
		const api = lifecycleApi();
		let materializedFilePath: string | undefined;
		(api.runTurn as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: {
				userFiles?: string[];
				userImages?: string[];
				attachments?: unknown;
			}) => {
				materializedFilePath = input.userFiles?.[0];
				expect(materializedFilePath).toBeTruthy();
				expect(await readFile(materializedFilePath ?? "", "utf8")).toBe(
					"inline contents",
				);
				expect(input.userImages).toEqual(["data:image/png;base64,aGVsbG8="]);
				expect(input.attachments).toBeUndefined();
				return TURN;
			},
		);
		const catalogEvents = eventSourceFixture();
		(api.bind as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			catalogEvents.append({
				eventType: "chat.bound",
				aggregateKind: "binding",
				aggregateId: "binding-1",
			});
			return BINDING;
		});
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => ({
					config: {
						providerId: "anthropic",
						modelId: "claude-test",
						apiKey: "private-api-key",
						systemPrompt: "trusted system prompt",
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
					interactive: true,
					profileRevision: 1,
					allowedModes: ["act", "plan"] as const,
				}),
				resolveBindingProfile: async () => ({
					transport: "slack",
					instanceId: "instance-1",
					channelId: "channel-1",
					threadId: "thread-1",
					participantScope: "participant-1",
				}),
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: catalogEvents.source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const lifecycle = managed.lifecycleWire;
		expect(lifecycle).toBeDefined();
		if (!lifecycle) throw new Error("missing lifecycle wire");
		const events: HubEventEnvelope[] = [];
		const release = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: (event) => events.push(parseHubChatLifecycleWireEvent(event)),
		});
		const invoke = async (
			command: Parameters<typeof lifecycle.invoke>[0]["command"],
			payload: Record<string, unknown>,
		) =>
			await lifecycle.invoke({
				identity,
				signal: controller.signal,
				command,
				payload,
			});
		const start = { profileId: "profile-1" };
		await invoke("chat_lifecycle.start_root", {
			operationId: "root-1",
			sessionId: "session-1",
			start,
		});
		await invoke("chat_lifecycle.start_related", {
			operationId: "related-1",
			sessionId: "session-2",
			chatId: "chat-1",
			parentSessionId: "session-1",
			relationKind: "config_restart",
			expectedRevision: 2,
			start,
		});
		await invoke("chat_lifecycle.restore_checkpoint", {
			operationId: "restore-1",
			sessionId: "session-3",
			chatId: "chat-1",
			parentSessionId: "session-1",
			checkpointRunCount: 2,
			start,
		});
		await invoke("chat_lifecycle.resume", {
			operationId: "resume-1",
			sessionId: "session-1",
			expectedLeaseRevision: 1,
			start,
		});
		await invoke("chat_lifecycle.recover_lost_lease", {
			operationId: "recover-1",
			sessionId: "session-1",
			start,
		});
		await invoke("chat_lifecycle.run_turn", {
			operationId: "turn-1",
			sessionId: "session-1",
			prompt: "continue",
			attachments: {
				images: [{ mediaType: "image/png", dataBase64: "aGVsbG8=" }],
				files: [{ name: "notes.txt", content: "inline contents" }],
			},
		});
		expect(materializedFilePath).toBeTruthy();
		await expect(access(materializedFilePath ?? "")).rejects.toThrow();
		const binding = {
			profileId: "binding-1",
			channelId: "channel-1",
		};
		await invoke("chat_lifecycle.binding.get", binding);
		await invoke("chat_lifecycle.bind", {
			operationId: "bind-1",
			sessionId: "session-1",
			target: {
				...binding,
				bindingId: "binding-1",
				expectedBindingRevision: 1,
			},
		});
		await invoke("chat_lifecycle.reset", {
			operationId: "reset-1",
			sessionId: "session-1",
		});
		await invoke("chat_lifecycle.archive", {
			operationId: "archive-1",
			chatId: "chat-1",
			expectedRevision: 1,
		});
		await invoke("chat_lifecycle.activate", {
			operationId: "activate-1",
			chatId: "chat-1",
			expectedRevision: 2,
		});
		await invoke("chat_lifecycle.rename", {
			operationId: "rename-1",
			chatId: "chat-1",
			expectedRevision: 2,
			title: "Renamed",
		});
		await invoke("chat_lifecycle.purge", {
			operationId: "purge-1",
			chatId: "chat-1",
			expectedRevision: 2,
		});
		await invoke("chat_lifecycle.stop", {
			operationId: "stop-1",
			sessionId: "session-1",
		});

		for (const method of [
			api.startRoot,
			api.startRelated,
			api.restoreCheckpoint,
			api.resume,
			api.recoverLostLease,
			api.runTurn,
			api.getBinding,
			api.bind,
			api.reset,
			api.archive,
			api.activate,
			api.rename,
			api.purge,
			api.stop,
		]) {
			expect(method).toHaveBeenCalledOnce();
		}
		expect(api.startRelated).toHaveBeenCalledWith(
			expect.objectContaining({
				relationKind: "config_restart",
				expectedRevision: 2,
			}),
		);
		expect(events.length).toBeGreaterThan(0);
		expect(
			events.some(
				(event) =>
					(event.payload as { eventType?: string }).eventType ===
					"chat_lifecycle.binding.get",
			),
		).toBe(false);
		expect(
			events.some((event) => {
				const payload = event.payload as {
					eventType?: string;
					aggregateKind?: string;
				};
				return (
					payload.eventType === "chat.bound" &&
					payload.aggregateKind === "binding"
				);
			}),
		).toBe(true);
		release?.();
	});

	it("gives each subscriber a live cut and filters by event-time membership", async () => {
		const api = lifecycleApi();
		const catalogEvents = eventSourceFixture();
		catalogEvents.append({
			eventType: "chat.created",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			relatedSessionIds: ["session-1"],
		});
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			eventPollIntervalMs: 60_000,
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: catalogEvents.source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const first: HubEventEnvelope[] = [];
		const second: HubEventEnvelope[] = [];
		const unrelated: HubEventEnvelope[] = [];
		const releaseFirst = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			sessionId: "session-1",
			emit: (event) => first.push(parseHubChatLifecycleWireEvent(event)),
		});
		catalogEvents.append({
			eventType: "chat.renamed",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			previousRevision: 1,
			resultingRevision: 2,
			relatedSessionIds: ["session-1", "session-2"],
		});
		const releaseSecond = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			sessionId: "session-2",
			emit: (event) => second.push(parseHubChatLifecycleWireEvent(event)),
		});
		const releaseUnrelated = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			sessionId: "session-3",
			emit: (event) => unrelated.push(parseHubChatLifecycleWireEvent(event)),
		});
		catalogEvents.append({
			eventType: "chat.archived",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			previousRevision: 2,
			resultingRevision: 3,
			relatedSessionIds: ["session-1", "session-2"],
		});
		await managed.lifecycleWire?.invoke({
			identity,
			signal: controller.signal,
			command: "chat_lifecycle.stop",
			payload: { operationId: "drain-live-cut", sessionId: "session-1" },
		});

		expect(first).toHaveLength(2);
		expect(first[0]).toMatchObject({
			sessionId: "session-1",
			payload: { eventType: "chat.renamed" },
		});
		// The rename committed before the second listener's live cut, but both
		// relevant sessions receive the later archive.
		expect(second).toHaveLength(1);
		expect(second[0]).toMatchObject({
			sessionId: "session-2",
			payload: { eventType: "chat.archived" },
		});
		expect(unrelated).toEqual([]);
		releaseFirst?.();
		releaseSecond?.();
		releaseUnrelated?.();
		await managed.dispose("live_cut_test_complete");
	});

	it("polls background catalog events once and isolates a throwing listener", async () => {
		const catalogEvents = eventSourceFixture();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			eventPollIntervalMs: 5,
			createCore: async () => ({
				chatLifecycle: lifecycleApi(),
				chatLifecycleEventSource: catalogEvents.source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: () => {
				throw new Error("listener failed");
			},
		});
		const events: HubEventEnvelope[] = [];
		managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: (event) => events.push(parseHubChatLifecycleWireEvent(event)),
		});
		catalogEvents.append({
			eventType: "session.lease_renewed",
			aggregateKind: "lease",
			aggregateId: "session-1",
			relatedSessionIds: ["session-1"],
		});
		await vi.waitFor(() => expect(events).toHaveLength(1));
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
		expect(events).toHaveLength(1);
		expect(events[0]).not.toHaveProperty("sessionId");
		controller.abort(new Error("subscription closed"));
		catalogEvents.append({
			eventType: "session.lease_renewed",
			aggregateKind: "lease",
			aggregateId: "session-1",
		});
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
		expect(events).toHaveLength(1);
		await managed.dispose("background_poll_test_complete");
	});

	it("does not turn a committed command into failure when event reading fails", async () => {
		const api = lifecycleApi();
		let mutated = false;
		(api.rename as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			mutated = true;
			return CHAT;
		});
		const report = vi.fn();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			eventPollIntervalMs: 60_000,
			onEventSourceError: report,
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: {
					currentSequence: () => 0,
					listAfter: () => {
						throw new Error("private sqlite read detail");
					},
				},
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const release = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: () => {},
		});
		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.rename",
				payload: {
					operationId: "rename-with-event-read-failure",
					chatId: "chat-1",
					expectedRevision: 1,
					title: "Committed despite notification failure",
				},
			}),
		).resolves.toMatchObject({ chatId: "chat-1", revision: 2 });
		expect(mutated).toBe(true);
		expect(report).toHaveBeenCalledOnce();
		expect(JSON.stringify(report.mock.calls)).not.toContain(
			"private sqlite read detail",
		);
		release?.();
		await managed.dispose("event_read_failure_test_complete");
	});

	it("disables and reports a poisoned event source without failing commands", async () => {
		const catalogEvents = eventSourceFixture();
		const report = vi.fn();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			eventPollIntervalMs: 60_000,
			onEventSourceError: report,
			createCore: async () => ({
				chatLifecycle: lifecycleApi(),
				chatLifecycleEventSource: catalogEvents.source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: () => {},
		});
		catalogEvents.append({
			eventType: "chat.unknown_future_event" as never,
			aggregateKind: "chat",
			aggregateId: "chat-1",
		});
		const invokeStop = () =>
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.stop",
				payload: { operationId: "stop-after-poison", sessionId: "session-1" },
			});
		await expect(invokeStop()).resolves.toEqual({ stopped: true });
		expect(report).toHaveBeenCalledOnce();
		await expect(invokeStop()).resolves.toEqual({ stopped: true });
		expect(report).toHaveBeenCalledOnce();
		expect(() =>
			managed.eventWire?.subscribe({
				identity,
				signal: controller.signal,
				emit: () => {},
			}),
		).toThrow("event source is unhealthy");
		await managed.dispose("poisoned_event_source_test_complete");
	});

	it("does not acknowledge malformed allowed-type authoritative metadata", async () => {
		const catalogEvents = eventSourceFixture();
		const report = vi.fn();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			eventPollIntervalMs: 60_000,
			onEventSourceError: report,
			createCore: async () => ({
				chatLifecycle: lifecycleApi(),
				chatLifecycleEventSource: catalogEvents.source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const events: HubEventEnvelope[] = [];
		managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			sessionId: "session-unrelated",
			emit: (event) => events.push(parseHubChatLifecycleWireEvent(event)),
		});
		catalogEvents.append({
			eventType: "chat.renamed",
			aggregateKind: "chat",
			aggregateId: "",
		});
		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.stop",
				payload: {
					operationId: "stop-after-malformed-event",
					sessionId: "session-1",
				},
			}),
		).resolves.toEqual({ stopped: true });
		expect(events).toEqual([]);
		expect(report).toHaveBeenCalledOnce();
		expect(() =>
			managed.eventWire?.subscribe({
				identity,
				signal: controller.signal,
				emit: () => {},
			}),
		).toThrow("event source is unhealthy");
		await managed.dispose("malformed_event_source_test_complete");
	});

	it("stops a snapshotted batch immediately when its listener unsubscribes", async () => {
		const catalogEvents = eventSourceFixture();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			eventPollIntervalMs: 60_000,
			createCore: async () => ({
				chatLifecycle: lifecycleApi(),
				chatLifecycleEventSource: catalogEvents.source,
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const events: HubEventEnvelope[] = [];
		let release: (() => void) | undefined;
		release = managed.eventWire?.subscribe({
			identity,
			signal: controller.signal,
			emit: (event) => {
				events.push(parseHubChatLifecycleWireEvent(event));
				release?.();
			},
		});
		catalogEvents.append({
			eventType: "chat.renamed",
			aggregateKind: "chat",
			aggregateId: "chat-1",
		});
		catalogEvents.append({
			eventType: "chat.archived",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			previousRevision: 1,
			resultingRevision: 2,
		});
		await managed.lifecycleWire?.invoke({
			identity,
			signal: controller.signal,
			command: "chat_lifecycle.stop",
			payload: { operationId: "stop-after-release", sessionId: "session-1" },
		});
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			payload: { eventType: "chat.renamed" },
		});
		await managed.dispose("mid_batch_release_test_complete");
	});

	it("fails closed and disposes a managed Core without an authoritative event source", async () => {
		const dispose = vi.fn(async () => {});
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () =>
				({ chatLifecycle: lifecycleApi(), dispose }) as never,
		});
		const { identity } = identityFixture();
		await expect(
			factory.create({
				principalId: identity.principalId,
				tenantId: identity.tenantId,
				workspaceKey: identity.workspaceKey,
				workspaceEpoch: identity.workspaceEpoch,
				authorityClassId: identity.policy.authorityClassId,
				audienceId: identity.policy.audienceId,
				policyEpoch: identity.policy.policyEpoch,
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(dispose).toHaveBeenCalledWith("catalog_event_source_unavailable");
	});

	it("fails closed when the workspace factory signal is already revoked", async () => {
		const createCore = vi.fn();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			createCore,
		});
		const controller = new AbortController();
		controller.abort(new Error("revoked"));
		await expect(
			factory.create({
				principalId: "owner-1",
				tenantId: "local",
				workspaceKey: WORKSPACE,
				workspaceEpoch: 1,
				authorityClassId: "deny-all",
				audienceId: "aud_deny_all_v1",
				policyEpoch: 0,
				signal: controller.signal,
			}),
		).rejects.toThrow("revoked");
		expect(createCore).not.toHaveBeenCalled();
	});

	it("rejects invocation identities outside the factory authority scope", async () => {
		const api = lifecycleApi();
		const resolveStartProfile = vi.fn(async () => undefined);
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile,
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => ({
				chatLifecycle: api,
				chatLifecycleEventSource: inertEventSource(),
				dispose: vi.fn(async () => {}),
			}),
		});
		const { identity } = identityFixture();
		const controller = new AbortController();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		const forgedIdentity = Object.freeze({
			...identity,
			workspaceKey: resolve(WORKSPACE, "other"),
		});
		await expect(
			managed.lifecycleWire?.invoke({
				identity: forgedIdentity,
				signal: controller.signal,
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-1",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				},
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		expect(resolveStartProfile).not.toHaveBeenCalled();
		expect(api.startRoot).not.toHaveBeenCalled();
	});

	it("provides a final mutation fence bound to the active invocation", async () => {
		const api = lifecycleApi();
		const controller = new AbortController();
		const revoked = new Error("revoked before authoritative commit");
		let coreOptions: ClineCoreOptions | undefined;
		let mutated = false;
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			createCore: async (options) => {
				coreOptions = options;
				(api.rename as ReturnType<typeof vi.fn>).mockImplementation(
					async () => {
						const fence = coreOptions?.chatLifecycle?.mutationFence?.();
						expect(fence).toBeDefined();
						controller.abort(revoked);
						fence?.assertActive();
						mutated = true;
						return CHAT;
					},
				);
				return {
					chatLifecycle: api,
					chatLifecycleEventSource: inertEventSource(),
					dispose: vi.fn(async () => {}),
				};
			},
		});
		const { identity } = identityFixture();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.rename",
				payload: {
					operationId: "rename-fenced",
					chatId: "chat-1",
					expectedRevision: 1,
					title: "must not commit",
				},
			}),
		).rejects.toBe(revoked);
		expect(api.rename).toHaveBeenCalledOnce();
		expect(mutated).toBe(false);
	});

	it("permits trusted lease cleanup only after Core retirement begins", async () => {
		const api = lifecycleApi();
		const controller = new AbortController();
		const revoked = new Error("workspace retired");
		let coreOptions: ClineCoreOptions | undefined;
		let cleanupFencePassed = false;
		let releaseDisposal: (() => void) | undefined;
		const requireFence = () => {
			const fence = coreOptions?.chatLifecycle?.mutationFence?.();
			if (!fence) throw new Error("missing mutation fence");
			return fence;
		};
		let retirementFence: ReturnType<typeof requireFence> | undefined;
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			createCore: async (options) => {
				coreOptions = options;
				return {
					chatLifecycle: api,
					chatLifecycleEventSource: inertEventSource(),
					dispose: async () => {
						retirementFence = requireFence();
						retirementFence.assertActive();
						cleanupFencePassed = true;
						await new Promise<void>((resolve) => {
							releaseDisposal = resolve;
						});
					},
				} as never;
			},
		});
		const { identity } = identityFixture();
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		controller.abort(revoked);
		expect(() => requireFence().assertActive()).toThrow(revoked);
		const disposal = managed.dispose("workspace_revoked");
		await vi.waitFor(() => expect(cleanupFencePassed).toBe(true));
		expect(() => requireFence().assertActive()).toThrow(revoked);
		releaseDisposal?.();
		await disposal;
		expect(cleanupFencePassed).toBe(true);
		expect(retirementFence?.signal.aborted).toBe(true);
		expect(() => retirementFence?.signal.throwIfAborted()).toThrow(
			"managed Core retirement completed",
		);
	});

	it("preserves ownership of a Core created concurrently with revocation", async () => {
		const dispose = vi.fn(async () => {});
		const controller = new AbortController();
		const revoked = new Error("revoked during create");
		const { identity } = identityFixture();
		const factory = createHubWorkspaceManagedClineCoreFactory({
			profiles: {
				resolveStartProfile: async () => undefined,
				resolveBindingProfile: async () => undefined,
			},
			createCore: async () => {
				controller.abort(revoked);
				return {
					chatLifecycle: lifecycleApi(),
					chatLifecycleEventSource: inertEventSource(),
					dispose,
				};
			},
		});
		const managed = await factory.create({
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceKey: identity.workspaceKey,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			audienceId: identity.policy.audienceId,
			policyEpoch: identity.policy.policyEpoch,
			signal: controller.signal,
		});
		expect(dispose).not.toHaveBeenCalled();
		await expect(
			managed.lifecycleWire?.invoke({
				identity,
				signal: controller.signal,
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-1",
					sessionId: "session-1",
					start: { profileId: "profile-1" },
				},
			}),
		).rejects.toBe(revoked);
		await managed.dispose("test_cleanup");
		expect(dispose).toHaveBeenCalledWith("test_cleanup");
	});
});
