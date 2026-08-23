import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClineCoreStartInput } from "./cline-core/types";
import type {
	StartSessionInput,
	StartSessionResult,
} from "./runtime/host/runtime-host";

const { createRuntimeHostMock, getCatalogManagedCompositionMock } = vi.hoisted(
	() => ({
		createRuntimeHostMock: vi.fn(),
		getCatalogManagedCompositionMock: vi.fn(),
	}),
);

vi.mock("./runtime/host/host", () => ({
	createRuntimeHost: createRuntimeHostMock,
	getCatalogManagedLocalRuntimeComposition: getCatalogManagedCompositionMock,
}));

import type { AgentResult } from "@cline/shared";
import { ClineCore } from "./ClineCore";
import { NoOpFeatureFlagsProvider } from "./services/feature-flags";

function createStartInput(): ClineCoreStartInput {
	return {
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test",
			cwd: "/tmp/workspace",
			workspaceRoot: "/tmp/workspace",
			systemPrompt: "You are concise.",
			mode: "act",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		prompt: "hello",
		interactive: false,
	};
}

function createStartResult(sessionId: string): StartSessionResult {
	return {
		sessionId,
		manifest: {} as StartSessionResult["manifest"],
		manifestPath: `/tmp/${sessionId}.json`,
		messagesPath: `/tmp/${sessionId}.messages.json`,
	};
}

function createAgentResult(text: string): AgentResult {
	const now = new Date("2026-04-24T10:00:00.000Z");
	return {
		text,
		usage: {
			inputTokens: 1,
			outputTokens: 1,
		},
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed",
		model: {
			id: "test-model",
			provider: "test-provider",
		},
		startedAt: now,
		endedAt: now,
		durationMs: 1,
	};
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
	}).trim();
}

describe("ClineCore", () => {
	beforeEach(() => {
		createRuntimeHostMock.mockReset();
		getCatalogManagedCompositionMock.mockReset();
		getCatalogManagedCompositionMock.mockReturnValue(undefined);
	});

	it("compares a checkpoint to the current workspace through the public SDK API", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-core-compare-"));
		let core: ClineCore | undefined;
		try {
			git(dir, ["init", "-b", "main"]);
			git(dir, ["config", "user.email", "test@example.com"]);
			git(dir, ["config", "user.name", "Test User"]);
			writeFileSync(join(dir, "tracked.txt"), "before\n", "utf8");
			git(dir, ["add", "."]);
			git(dir, ["commit", "-m", "initial"]);
			const checkpointRef = git(dir, ["rev-parse", "HEAD"]);
			writeFileSync(join(dir, "tracked.txt"), "after\n", "utf8");

			const host = {
				runtimeAddress: undefined,
				startSession: vi.fn(),
				runTurn: vi.fn(),
				restoreSession: vi.fn(),
				getAccumulatedUsage: vi.fn(),
				abort: vi.fn(),
				stopSession: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn(async () => ({
					sessionId: "session-1",
					cwd: dir,
					workspaceRoot: dir,
					metadata: {
						checkpoint: {
							history: [
								{
									ref: checkpointRef,
									runCount: 1,
									createdAt: 1,
									kind: "commit",
								},
							],
						},
					},
				})),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				readSessionMessages: vi.fn(),
				dispatchHookEvent: vi.fn(),
				subscribe: vi.fn(() => () => {}),
				updateSessionModel: vi.fn(),
			};
			createRuntimeHostMock.mockResolvedValue(host);

			core = await ClineCore.create();
			const result = await core.compareCheckpoint({
				sessionId: "session-1",
				checkpointRunCount: 1,
			});

			expect(host.getSession).toHaveBeenCalledWith("session-1");
			expect(result.checkpoint.ref).toBe(checkpointRef);
			expect(result.diffs).toEqual([
				{
					filePath: join(dir, "tracked.txt"),
					leftContent: "before\n",
					rightContent: "after\n",
				},
			]);
		} finally {
			await core?.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("applies start-session bootstraps before delegating to the host", async () => {
		const listeners: Array<
			(event: { type: string; payload: { sessionId: string } }) => void
		> = [];
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (input: StartSessionInput) => {
				expect(input.config.systemPrompt).toBe("Bootstrapped prompt");
				expect(input.localRuntime?.extensions).toEqual([
					expect.objectContaining({ name: "enterprise" }),
				]);
				return createStartResult("session-1");
			}),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn((listener) => {
				listeners.push(listener);
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const applyToStartSessionInput = vi.fn(
			async (input: ClineCoreStartInput) => ({
				...input,
				config: {
					...input.config,
					systemPrompt: "Bootstrapped prompt",
					extensions: [
						{
							name: "enterprise",
							manifest: { capabilities: [] },
							setup: vi.fn(),
						},
					],
				},
			}),
		);

		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput,
				dispose,
			}),
		});

		await core.start(createStartInput());

		expect(applyToStartSessionInput).toHaveBeenCalledTimes(1);
		expect(host.startSession).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(listeners).toHaveLength(1);
	});

	it("exposes only the sanitized managed lifecycle and preserves start bootstraps", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => ({ sessionId: "managed-root" })),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		const managedResult = {
			startResult: createStartResult("managed-root"),
			chatId: "managed-chat",
			leaseRevision: 1,
			leaseExpiresAt: "2026-08-14T10:01:00.000Z",
		};
		const managedRelatedResult = {
			...managedResult,
			startResult: createStartResult("managed-related"),
		};
		const managedRestoreResult = {
			...managedResult,
			startResult: createStartResult("managed-restored"),
			checkpoint: { ref: "checkpoint-1", createdAt: 1, runCount: 1 },
			messages: [{ role: "user" as const, content: "restore me" }],
		};
		const managedRecoveryResult = {
			...managedResult,
			startResult: createStartResult("managed-recovered"),
			leaseRevision: 3,
		};
		const managedBinding = {
			bindingId: "binding-1",
			transport: "telegram",
			instanceId: "bot-1",
			channelId: "",
			threadId: "thread-1",
			participantScope: "",
			bound: true,
			chatId: "managed-chat",
			sessionId: "managed-related",
			revision: 1,
			updatedAt: "2026-08-14T10:00:00.000Z",
		};
		const managedAuthority = new AbortController();
		const runtime = {
			startRoot: vi.fn(async () => managedResult),
			startRelated: vi.fn(async () => managedRelatedResult),
			restoreCheckpoint: vi.fn(async () => managedRestoreResult),
			recoverLostLease: vi.fn(async () => managedRecoveryResult),
			resume: vi.fn(),
			runTurn: vi.fn(async () => createAgentResult("managed turn")),
			getBinding: vi.fn(async () => managedBinding),
			bind: vi.fn(async () => managedBinding),
			reset: vi.fn(async () => ({
				...managedBinding,
				bound: false,
				revision: 2,
			})),
			archive: vi.fn(async () => ({
				chatId: "managed-chat",
				catalogState: "archived",
				revision: 2,
				sessions: [{ sessionId: "managed-root" }],
				bindings: [],
			})),
			activate: vi.fn(async () => ({
				chatId: "managed-chat",
				catalogState: "active",
				revision: 3,
				sessions: [{ sessionId: "managed-root" }],
				bindings: [],
			})),
			rename: vi.fn(async () => ({
				chatId: "managed-chat",
				catalogState: "active",
				title: "Research queue",
				titleSource: "manual",
				revision: 4,
				sessions: [{ sessionId: "managed-root" }],
				bindings: [],
			})),
			purge: vi.fn(async () => ({
				chatId: "managed-chat",
				sessionIds: ["managed-root"],
				applied: true,
			})),
			stop: vi.fn(async () => undefined),
			manages: vi.fn((sessionId: string) => sessionId === "managed-root"),
			residentAuthoritySignal: vi.fn(() => managedAuthority.signal),
			dispose: vi.fn(async () => undefined),
		};
		const disposeComposition = vi.fn();
		createRuntimeHostMock.mockResolvedValue(host);
		getCatalogManagedCompositionMock.mockReturnValue({
			runtime,
			workspaceRoot: "/tmp/workspace",
			dispose: disposeComposition,
		});
		const disposeBootstrap = vi.fn();
		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput: (input) => ({
					...input,
					config: { ...input.config, systemPrompt: "managed bootstrap" },
				}),
				dispose: disposeBootstrap,
			}),
		});

		expect(core.chatLifecycle).toBeDefined();
		await expect(core.start(createStartInput())).rejects.toThrow(
			"core.chatLifecycle",
		);
		const result = await core.chatLifecycle.startRoot({
			operationId: "managed-root-operation",
			sessionId: "managed-root",
			startInput: createStartInput(),
		});

		expect(runtime.startRoot).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "managed-root-operation",
				startInput: expect.objectContaining({
					config: expect.objectContaining({
						systemPrompt: "managed bootstrap",
					}),
				}),
			}),
		);
		expect(result).toEqual(managedResult);
		expect(JSON.stringify(result)).not.toContain("leaseToken");
		expect(core.managedSessionAuthoritySignal("managed-root")).toBe(
			managedAuthority.signal,
		);
		expect(runtime.residentAuthoritySignal).toHaveBeenCalledWith(
			"managed-root",
		);
		await expect(
			core.chatLifecycle.startRelated({
				operationId: "managed-related-operation",
				sessionId: "managed-related",
				chatId: "managed-chat",
				parentSessionId: "managed-root",
				relationKind: "recovery",
				expectedRevision: 1,
				startInput: createStartInput(),
			}),
		).resolves.toEqual(managedRelatedResult);
		expect(runtime.startRelated).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "managed-related-operation",
				relationKind: "recovery",
				expectedRevision: 1,
				startInput: expect.objectContaining({
					config: expect.objectContaining({
						sessionId: "managed-related",
						systemPrompt: "managed bootstrap",
					}),
				}),
			}),
		);
		await expect(
			core.chatLifecycle.restoreCheckpoint({
				operationId: "managed-restore-operation",
				sessionId: "managed-restored",
				chatId: "managed-restored-chat",
				parentSessionId: "managed-root",
				checkpointRunCount: 1,
				restore: { workspace: false },
				startInput: createStartInput(),
			}),
		).resolves.toEqual(managedRestoreResult);
		expect(runtime.restoreCheckpoint).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "managed-restore-operation",
				chatId: "managed-restored-chat",
				parentSessionId: "managed-root",
				checkpointRunCount: 1,
				restore: { workspace: false },
				startInput: expect.objectContaining({
					config: expect.objectContaining({
						sessionId: "managed-restored",
						systemPrompt: "managed bootstrap",
					}),
				}),
			}),
		);
		await expect(
			core.chatLifecycle.recoverLostLease({
				operationId: "managed-recover-operation",
				sessionId: "managed-recovered",
				startInput: createStartInput(),
			}),
		).resolves.toEqual(managedRecoveryResult);
		expect(runtime.recoverLostLease).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "managed-recover-operation",
				startInput: expect.objectContaining({
					config: expect.objectContaining({
						sessionId: "managed-recovered",
						systemPrompt: "managed bootstrap",
					}),
				}),
			}),
		);
		const bindingTarget = {
			bindingId: "binding-1",
			transport: "telegram",
			instanceId: "bot-1",
			threadId: "thread-1",
			expectedBindingRevision: 0,
		};
		await expect(
			core.chatLifecycle.bind({
				operationId: "managed-bind-operation",
				sessionId: "managed-related",
				target: bindingTarget,
			}),
		).resolves.toEqual(managedBinding);
		await expect(
			core.chatLifecycle.getBinding({
				transport: "telegram",
				instanceId: "bot-1",
				threadId: "thread-1",
			}),
		).resolves.toEqual(managedBinding);
		await expect(
			core.chatLifecycle.reset({
				operationId: "managed-reset-operation",
				sessionId: "managed-related",
				binding: { ...bindingTarget, expectedBindingRevision: 1 },
			}),
		).resolves.toMatchObject({ bound: false, revision: 2 });
		expect(runtime.reset).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: "managed-reset-operation",
				sessionId: "managed-related",
			}),
		);
		await expect(
			core.chatLifecycle.archive({
				operationId: "managed-archive-operation",
				chatId: "managed-chat",
				expectedRevision: 1,
				stopRunning: true,
				clearBindings: true,
			}),
		).resolves.toMatchObject({ catalogState: "archived", revision: 2 });
		expect(runtime.archive).toHaveBeenCalledWith({
			operationId: "managed-archive-operation",
			chatId: "managed-chat",
			expectedRevision: 1,
			stopRunning: true,
			clearBindings: true,
		});
		await expect(
			core.chatLifecycle.activate({
				operationId: "managed-activate-operation",
				chatId: "managed-chat",
				expectedRevision: 2,
			}),
		).resolves.toMatchObject({ catalogState: "active", revision: 3 });
		await expect(
			core.chatLifecycle.rename({
				operationId: "managed-rename-operation",
				chatId: "managed-chat",
				title: "Research queue",
				expectedRevision: 3,
			}),
		).resolves.toMatchObject({
			title: "Research queue",
			titleSource: "manual",
			revision: 4,
		});
		expect(runtime.rename).toHaveBeenCalledWith({
			operationId: "managed-rename-operation",
			chatId: "managed-chat",
			title: "Research queue",
			expectedRevision: 3,
		});
		await expect(
			core.chatLifecycle.purge({
				operationId: "managed-purge-operation",
				chatId: "managed-chat",
				expectedRevision: 4,
			}),
		).resolves.toEqual({
			chatId: "managed-chat",
			sessionIds: ["managed-root"],
			applied: true,
		});
		await expect(
			core.send({ sessionId: "managed-root", prompt: "bypass" }),
		).rejects.toThrow("core.chatLifecycle.runTurn");
		await expect(
			core.chatLifecycle.runTurn({
				operationId: "managed-turn-operation",
				sessionId: "managed-root",
				prompt: "continue",
			}),
		).resolves.toMatchObject({ text: "managed turn" });
		expect(runtime.runTurn).toHaveBeenCalledWith({
			operationId: "managed-turn-operation",
			sessionId: "managed-root",
			prompt: "continue",
		});
		await expect(core.stop("managed-root")).rejects.toThrow(
			"core.chatLifecycle.stop",
		);
		await expect(
			core.restore({
				sessionId: "managed-root",
				checkpointRunCount: 1,
			}),
		).rejects.toThrow("restore checkpoints through core.chatLifecycle");
		await core.chatLifecycle.stop({
			operationId: "managed-stop-operation",
			sessionId: "managed-root",
		});
		await core.chatLifecycle.stop({
			operationId: "managed-restored-stop-operation",
			sessionId: "managed-restored",
		});
		await core.chatLifecycle.stop({
			operationId: "managed-recovered-stop-operation",
			sessionId: "managed-recovered",
		});
		expect(runtime.stop).toHaveBeenCalledWith(
			"managed-root",
			"managed-stop-operation",
		);
		expect(disposeBootstrap).toHaveBeenCalledTimes(4);

		await core.dispose("managed-core-dispose");
		expect(runtime.dispose).toHaveBeenCalledWith("managed-core-dispose");
		expect(host.dispose).toHaveBeenCalledWith("managed-core-dispose");
		expect(disposeComposition).toHaveBeenCalledTimes(1);
	});

	it("preserves an omitted workspace until the execution host resolves it", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (_input: StartSessionInput) =>
				createStartResult("session-pathless"),
			),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);
		const core = await ClineCore.create();

		await core.start({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "test",
				systemPrompt: "You are concise.",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(host.startSession).toHaveBeenCalledTimes(1);
		const forwarded = host.startSession.mock.calls[0]?.[0];
		expect(forwarded?.config).not.toHaveProperty("cwd");
		expect(forwarded?.config).not.toHaveProperty("workspaceRoot");
	});

	it("disposes active session bootstraps when the session ends", async () => {
		let listener:
			| ((event: { type: string; payload: { sessionId: string } }) => void)
			| undefined;
		const host = {
			runtimeAddress: "127.0.0.1:5317",
			startSession: vi.fn(async () => createStartResult("session-2")),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => ({ sessionId: "session-2" })),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn((nextListener) => {
				listener = nextListener;
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput: (input) => input,
				dispose,
			}),
		});
		expect(core.runtimeAddress).toBe("127.0.0.1:5317");

		await core.start(createStartInput());
		expect(dispose).not.toHaveBeenCalled();

		listener?.({ type: "ended", payload: { sessionId: "session-2" } });
		await Promise.resolve();

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("emits session.started telemetry when a new session is started", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("session-telemetry")),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const telemetry = {
			capture: vi.fn(),
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		};

		const core = await ClineCore.create({
			backendMode: "local",
			clientName: "unit-test-client",
			telemetry: telemetry as never,
		});
		await core.start(createStartInput());

		expect(telemetry.capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "session.started",
				properties: expect.objectContaining({
					sessionId: "session-telemetry",
					source: "core",
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
					clientName: "unit-test-client",
				}),
			}),
		);
	});

	it("merges instance and per-start runtime capabilities", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (_input: StartSessionInput) =>
				createStartResult("session-capabilities"),
			),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);
		const askQuestion = vi.fn(async () => "yes");
		const submit = vi.fn(async () => "submitted");
		const requestToolApproval = vi.fn(async () => ({ approved: true }));

		const core = await ClineCore.create({
			capabilities: {
				toolExecutors: { askQuestion },
				requestToolApproval,
			},
		});

		await core.start({
			...createStartInput(),
			capabilities: {
				toolExecutors: { submit },
			},
		});

		const startInput = vi.mocked(host.startSession).mock.calls.at(-1)?.[0] as
			| StartSessionInput
			| undefined;
		expect(startInput).toBeDefined();
		if (!startInput) throw new Error("Expected host.startSession to be called");
		expect(startInput.capabilities?.toolExecutors).toMatchObject({
			askQuestion,
			submit,
		});
		expect(startInput.capabilities?.requestToolApproval).toBe(
			requestToolApproval,
		);
	});

	it("normalizes config extension context into local runtime before delegating to the host", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (_input: StartSessionInput) =>
				createStartResult("session-extension-context"),
			),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const onTeamRestored = vi.fn();
		const clientContext = {
			name: "VSCode Extension",
			version: "3.27.0",
			platform: "Visual Studio Code",
			platformVersion: "1.102.3",
			isMultiRoot: true,
		};
		const core = await ClineCore.create();

		await core.start({
			...createStartInput(),
			config: {
				...createStartInput().config,
				extensionContext: {
					client: clientContext,
				},
			},
			localRuntime: {
				onTeamRestored,
			},
		});

		const startInput = vi.mocked(host.startSession).mock.calls.at(-1)?.[0] as
			| StartSessionInput
			| undefined;
		expect(startInput).toBeDefined();
		if (!startInput) throw new Error("Expected host.startSession to be called");
		expect(startInput.config).not.toHaveProperty("extensionContext");
		expect(startInput.localRuntime?.extensionContext?.client).toEqual(
			clientContext,
		);
		expect(startInput.localRuntime?.onTeamRestored).toBe(onTeamRestored);
	});

	it("prefers the per-session telemetry service over the ClineCore one", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("session-override")),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const coreTelemetry = {
			capture: vi.fn(),
			setDistinctId: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
		};
		const sessionTelemetry = {
			capture: vi.fn(),
			setDistinctId: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
		};

		const core = await ClineCore.create({
			backendMode: "local",
			telemetry: coreTelemetry as never,
		});
		const input = createStartInput();
		input.config.telemetry = sessionTelemetry as never;
		await core.start(input);

		expect(sessionTelemetry.capture).toHaveBeenCalledWith(
			expect.objectContaining({ event: "session.started" }),
		);
		expect(coreTelemetry.capture).not.toHaveBeenCalled();
	});

	it("uses a no-op feature flags provider by default", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();

		expect(core.featureFlags.getProvider()).toBeInstanceOf(
			NoOpFeatureFlagsProvider,
		);
		await core.dispose();
		expect(host.dispose).toHaveBeenCalledTimes(1);
	});

	it("hydrates list rows through the core API", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(async () => [
				{
					sessionId: "session-3",
					source: "cli",
					pid: 1,
					startedAt: "2026-04-21T02:17:46.169Z",
					status: "completed",
					interactive: false,
					provider: "",
					model: "",
					cwd: "/tmp/workspace",
					workspaceRoot: "/tmp/workspace",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					prompt: "hello",
					metadata: {},
					updatedAt: "2026-04-21T02:17:46.169Z",
				},
			]),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(async () => [
				{
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					modelInfo: {
						provider: "cline",
						id: "anthropic/claude-sonnet-4.6",
					},
					metrics: {
						cost: 0.02,
					},
				},
			]),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const [row] = await core.list(10);

		expect(host.listSessions).toHaveBeenCalledWith(20);
		expect(host.readSessionMessages).toHaveBeenCalledWith("session-3");
		expect(row).toMatchObject({
			sessionId: "session-3",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: {
				title: "hello",
				totalCost: 0.02,
			},
		});
	});

	it("can list sessions without hydrating message history", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			listSessions: vi.fn(async () => [
				{
					sessionId: "session-lightweight",
					source: "core",
					pid: 1,
					startedAt: "2026-04-21T02:17:46.169Z",
					status: "completed",
					interactive: false,
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/tmp/workspace",
					workspaceRoot: "/tmp/workspace",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					isSubagent: false,
					metadata: { title: "stored title" },
					updatedAt: "2026-04-21T02:17:46.169Z",
				},
			]),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const [row] = await core.list(10, { hydrate: false });

		// Hydration and default root-session filtering are consumed by
		// ClineCore/listSessionHistory; the host list contract only receives the
		// numeric scan limit.
		expect(host.listSessions.mock.calls).toEqual([[20]]);
		expect(host.readSessionMessages).not.toHaveBeenCalled();
		expect(row).toMatchObject({
			sessionId: "session-lightweight",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: { title: "stored title" },
		});
	});

	it("exposes event automation through ClineCore instead of CronService", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-core-automation-"));
		const cronDir = join(root, ".cline", "cron");
		const reportsDir = join(cronDir, "reports");
		const dbPath = join(root, ".cline", "data", "db", "cron.db");
		mkdirSync(join(cronDir, "events"), { recursive: true });
		writeFileSync(
			join(cronDir, "events", "local.event.md"),
			`---
id: local-test
title: Local Test
workspaceRoot: ${root}
event: local.manual_test
filters:
  topic: cron-feature-2
---
Summarize the local event.
`,
			"utf8",
		);

		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("automation-session")),
			runTurn: vi.fn(async () => createAgentResult("automation complete")),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		try {
			const core = await ClineCore.create({
				automation: {
					cronDir,
					reportsDir,
					dbPath,
					autoStart: false,
					pollIntervalMs: 10_000,
				},
			});
			await core.automation.reconcileNow();
			const result = core.automation.ingestEvent({
				eventId: "evt_local_1",
				eventType: "local.manual_test",
				source: "local",
				subject: "manual smoke test",
				occurredAt: "2026-04-24T10:00:00.000Z",
				attributes: { topic: "cron-feature-2" },
			});

			expect(result.matchedSpecIds).toHaveLength(1);
			expect(result.queuedRuns).toHaveLength(1);

			await core.automation.start();
			await core.automation.stop();
			await core.dispose();

			expect(host.startSession).toHaveBeenCalledTimes(1);
			expect(host.runTurn).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "automation-session",
					prompt: expect.stringContaining("Trigger event:"),
				}),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("delegates restore to the runtime host", async () => {
		const restoreResult = {
			sessionId: "restored-session",
			startResult: createStartResult("restored-session"),
			messages: [
				{ role: "user" as const, content: "first" },
				{ role: "assistant" as const, content: "first response" },
				{ role: "user" as const, content: "second" },
			],
			checkpoint: {
				ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				createdAt: 2,
				runCount: 2,
				kind: "commit" as const,
			},
		};
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("restored-session")),
			runTurn: vi.fn(),
			restoreSession: vi.fn(async () => restoreResult),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const result = await core.restore({
			sessionId: "source-session",
			checkpointRunCount: 2,
			restore: {
				messages: true,
				workspace: false,
				omitCheckpointMessageFromSession: true,
			},
			start: createStartInput(),
		});

		expect(host.restoreSession).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "source-session",
				checkpointRunCount: 2,
				restore: {
					messages: true,
					workspace: false,
					omitCheckpointMessageFromSession: true,
				},
				start: expect.objectContaining({
					config: expect.objectContaining({
						providerId: "anthropic",
						modelId: "claude-sonnet-4-6",
					}),
				}),
			}),
		);
		expect(result.messages).toEqual(restoreResult.messages);
		expect(result.sessionId).toBe("restored-session");
	});
});
