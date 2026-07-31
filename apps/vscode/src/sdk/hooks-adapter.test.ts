import type { AgentRunLifecycleContext } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildAgentHooks } from "./hooks-adapter"

const mocks = vi.hoisted(() => {
	const run = vi.fn(async () => ({ cancel: false }))
	const hasHook = vi.fn(async (_name: string) => true)
	const create = vi.fn(async (_name: string) => ({ run }))
	return {
		run,
		hasHook,
		create,
		getHooksEnabledSafe: vi.fn((_value: unknown) => true),
		getGlobalSettingsKey: vi.fn(() => true),
	}
})

vi.mock("@/core/hooks/hook-factory", () => ({
	HookFactory: class {
		hasHook = mocks.hasHook
		create = mocks.create
	},
}))

vi.mock("@/core/hooks/hooks-utils", () => ({
	getHooksEnabledSafe: mocks.getHooksEnabledSafe,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn() },
}))

function makeStateManager() {
	return {
		getGlobalSettingsKey: mocks.getGlobalSettingsKey,
	} as never
}

function makeLifecycleCtx(overrides?: Partial<AgentRunLifecycleContext["snapshot"]>): AgentRunLifecycleContext {
	return {
		snapshot: {
			agentId: "agent-1",
			conversationId: "task-1",
			runId: "run-1",
			status: "running",
			iteration: 0,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "continue the work" }],
				},
			],
			pendingToolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0 },
			...overrides,
		},
	}
}

describe("buildAgentHooks", () => {
	beforeEach(() => {
		mocks.run.mockClear()
		mocks.hasHook.mockClear()
		mocks.create.mockClear()
		mocks.getHooksEnabledSafe.mockClear()
		mocks.getGlobalSettingsKey.mockClear()
		mocks.hasHook.mockResolvedValue(true)
		mocks.run.mockResolvedValue({ cancel: false })
		delete process.env.CLINE_HOOK_AGENT_RESUME
	})

	afterEach(() => {
		delete process.env.CLINE_HOOK_AGENT_RESUME
	})

	it("fires TaskStart then UserPromptSubmit on beforeRun for a new session", async () => {
		const hooks = buildAgentHooks(makeStateManager())
		await hooks.beforeRun?.(makeLifecycleCtx())

		expect(mocks.create).toHaveBeenCalledWith("TaskStart")
		expect(mocks.create).toHaveBeenCalledWith("UserPromptSubmit")
		expect(mocks.create).not.toHaveBeenCalledWith("TaskResume")
		expect(mocks.run).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				taskStart: expect.objectContaining({
					taskMetadata: expect.objectContaining({ initialTask: "continue the work" }),
				}),
			}),
		)
	})

	it("fires TaskResume instead of TaskStart when isResume is set", async () => {
		const emit = vi.fn()
		const hooks = buildAgentHooks(makeStateManager(), emit, { isResume: true })
		const ctx = makeLifecycleCtx({
			messages: [
				{ role: "user", content: [{ type: "text", text: "old" }] },
				{ role: "assistant", content: [{ type: "text", text: "ok" }] },
				{ role: "user", content: [{ type: "text", text: "resume me" }] },
			],
		})

		await hooks.beforeRun?.(ctx)

		expect(mocks.create).toHaveBeenCalledWith("TaskResume")
		expect(mocks.create).not.toHaveBeenCalledWith("TaskStart")
		expect(mocks.create).toHaveBeenCalledWith("UserPromptSubmit")
		expect(mocks.run).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				taskResume: expect.objectContaining({
					taskMetadata: expect.objectContaining({ taskId: "task-1", initialTask: "resume me" }),
					previousState: expect.objectContaining({ messageCount: "3" }),
				}),
			}),
		)
		expect(emit).toHaveBeenCalledWith(
			expect.objectContaining({
				say: "hook_status",
				text: expect.stringContaining('"hookName":"TaskResume"'),
			}),
		)
	})

	it("fires TaskResume when CLINE_HOOK_AGENT_RESUME=1 (CLI env parity)", async () => {
		process.env.CLINE_HOOK_AGENT_RESUME = "1"
		const hooks = buildAgentHooks(makeStateManager())
		await hooks.beforeRun?.(makeLifecycleCtx())

		expect(mocks.create).toHaveBeenCalledWith("TaskResume")
		expect(mocks.create).not.toHaveBeenCalledWith("TaskStart")
	})

	it("maps afterRun completed/aborted and skips failed (TaskError wontfix)", async () => {
		const hooks = buildAgentHooks(makeStateManager())

		await hooks.afterRun?.({
			...makeLifecycleCtx(),
			result: {
				agentId: "agent-1",
				runId: "run-1",
				status: "completed",
				iterations: 1,
				outputText: "done",
				messages: [],
				usage: { inputTokens: 0, outputTokens: 0 },
			},
		})
		expect(mocks.create).toHaveBeenCalledWith("TaskComplete")

		mocks.create.mockClear()
		await hooks.afterRun?.({
			...makeLifecycleCtx(),
			result: {
				agentId: "agent-1",
				runId: "run-1",
				status: "aborted",
				iterations: 1,
				outputText: "",
				messages: [],
				usage: { inputTokens: 0, outputTokens: 0 },
			},
		})
		expect(mocks.create).toHaveBeenCalledWith("TaskCancel")

		mocks.create.mockClear()
		await hooks.afterRun?.({
			...makeLifecycleCtx(),
			result: {
				agentId: "agent-1",
				runId: "run-1",
				status: "failed",
				iterations: 1,
				outputText: "",
				messages: [],
				usage: { inputTokens: 0, outputTokens: 0 },
				error: new Error("boom"),
			},
		})
		expect(mocks.create).not.toHaveBeenCalled()
	})

	it("skips TaskResume when the hook file is absent", async () => {
		mocks.hasHook.mockImplementation(async (name: string) => name !== "TaskResume")
		const hooks = buildAgentHooks(makeStateManager(), undefined, { isResume: true })
		await hooks.beforeRun?.(makeLifecycleCtx())

		expect(mocks.create).not.toHaveBeenCalledWith("TaskResume")
		expect(mocks.create).toHaveBeenCalledWith("UserPromptSubmit")
	})

	it("fires PreToolUse / PostToolUse on beforeTool / afterTool (existing hook regression)", async () => {
		const hooks = buildAgentHooks(makeStateManager())
		const snapshot = makeLifecycleCtx().snapshot
		const toolCall = { toolCallId: "tc-1", toolName: "read_file" }

		await hooks.beforeTool?.({
			snapshot,
			toolCall,
			input: { path: "README.md" },
		} as never)

		expect(mocks.create).toHaveBeenCalledWith("PreToolUse")
		expect(mocks.run).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				preToolUse: expect.objectContaining({
					toolName: "read_file",
					parameters: expect.objectContaining({ path: "README.md" }),
				}),
			}),
		)

		mocks.create.mockClear()
		mocks.run.mockClear()

		await hooks.afterTool?.({
			snapshot,
			toolCall,
			input: { path: "README.md" },
			result: { output: "ok", isError: false },
			durationMs: 12,
		} as never)

		expect(mocks.create).toHaveBeenCalledWith("PostToolUse")
		expect(mocks.run).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				postToolUse: expect.objectContaining({
					toolName: "read_file",
					result: "ok",
					success: true,
					executionTimeMs: 12,
				}),
			}),
		)
	})
})
