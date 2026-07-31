// Bridges Cline's file-based hook scripts into the SDK's runtime hooks.
//
// Runtime hooks use typed in-process lifecycle callbacks (AgentRuntimeHooks):
//   TaskStart        -> beforeRun (new session)
//   TaskResume       -> beforeRun when isResume option is true (product path).
//                      CLINE_HOOK_AGENT_RESUME=1 is CLI/test parity only —
//                      the extension host must not set that env; pass isResume.
//   UserPromptSubmit -> beforeRun with the latest submitted user message
//   PreToolUse       -> beforeTool
//   PostToolUse      -> afterTool
//   TaskComplete     -> afterRun when completed
//   TaskCancel       -> afterRun when aborted
//
// Coverage matrix (SDK-7.1 / BL-7.*):
//   Wired:     TaskStart, TaskResume, UserPromptSubmit, PreToolUse, PostToolUse,
//              TaskComplete, TaskCancel
//   Policy:    TaskError → Notification (event=task_error) when
//              PRODUCT_VSCODE_TASK_ERROR_AS_NOTIFICATION (BL-7.3)
//   Policy:    SessionShutdown → Notification (event=session_shutdown) from
//              sdk-session-lifecycle when PRODUCT_VSCODE_SESSION_SHUTDOWN_AS_NOTIFICATION (BL-7.4)
//   Host-side: PreCompact — sdk-compaction-coordinator (BL-7.1)
//   Host-side: Notification — host-notification-hook.ts (BL-7.2)

import { PRODUCT_VSCODE_TASK_ERROR_AS_NOTIFICATION } from "@cline/core"
import type {
	AgentAfterToolContext,
	AgentBeforeToolContext,
	AgentHooks,
	AgentRunLifecycleContext,
	AgentStopControl,
} from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { HookFactory } from "@/core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import type { StateManager } from "@/core/storage/StateManager"
import { emitHostNotificationHook } from "./host-notification-hook"

export type HookMessageEmitter = (message: ClineMessage) => void

export interface BuildAgentHooksOptions {
	/**
	 * When true, beforeRun fires TaskResume instead of TaskStart.
	 * Product path: pass this from resume / mid-task rebuild builders.
	 * Do not set process-wide `CLINE_HOOK_AGENT_RESUME` from the extension host
	 * (that env is CLI/test parity only).
	 */
	isResume?: boolean
}

function toStringRecord(input: unknown): Record<string, string> {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		return {}
	}
	const result: Record<string, string> = {}
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		result[key] = typeof value === "string" ? value : JSON.stringify(value)
	}
	return result
}

function mapStopControl(hookOutput: { cancel?: boolean; errorMessage?: string }): AgentStopControl | undefined {
	if (!hookOutput.cancel) {
		return undefined
	}
	return {
		stop: true,
		reason: hookOutput.errorMessage || undefined,
	}
}

function taskIdFromSnapshot(snapshot: AgentRunLifecycleContext["snapshot"]): string {
	return snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId
}

function textFromMessageContent(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("")
}

function latestUserPrompt(ctx: AgentRunLifecycleContext): string {
	for (let index = ctx.snapshot.messages.length - 1; index >= 0; index -= 1) {
		const message = ctx.snapshot.messages[index]
		if (message?.role === "user") {
			return textFromMessageContent(message.content)
		}
	}
	return ""
}

function shouldRunTaskResume(options?: BuildAgentHooksOptions): boolean {
	// Prefer explicit isResume (product path). Env fallback is CLI/test parity
	// only — the extension host must not set CLINE_HOOK_AGENT_RESUME; mid-task
	// rebuild coordinators pass isResume (BL-7.9 / BL-7.10).
	return options?.isResume === true || process.env.CLINE_HOOK_AGENT_RESUME === "1"
}

function buildHookStatusMessage(opts: {
	hookName: string
	status: "running" | "completed" | "failed" | "cancelled"
	toolName?: string
	ts?: number
}): ClineMessage {
	return {
		ts: opts.ts ?? Date.now(),
		type: "say",
		say: "hook_status",
		text: JSON.stringify({
			hookName: opts.hookName,
			...(opts.toolName && { toolName: opts.toolName }),
			status: opts.status,
		}),
		partial: false,
	}
}

export function buildAgentHooks(
	stateManager: StateManager,
	emitHookMessage?: HookMessageEmitter,
	options?: BuildAgentHooksOptions,
): AgentHooks {
	const hooksEnabled = () => getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))

	return {
		async beforeRun(ctx: AgentRunLifecycleContext): Promise<AgentStopControl | undefined> {
			const startOrResumeControl = shouldRunTaskResume(options)
				? await runTaskResume(ctx, hooksEnabled, emitHookMessage)
				: await runTaskStart(ctx, hooksEnabled, emitHookMessage)
			if (startOrResumeControl) {
				return startOrResumeControl
			}
			return runUserPromptSubmit(ctx, hooksEnabled, emitHookMessage)
		},

		async beforeTool(ctx: AgentBeforeToolContext): Promise<{ stop?: boolean; reason?: string } | undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const factory = new HookFactory()
				if (!(await factory.hasHook("PreToolUse"))) {
					return undefined
				}

				const toolName = ctx.toolCall.toolName
				const runningMsg = buildHookStatusMessage({ hookName: "PreToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				const runner = await factory.create("PreToolUse")
				const result = await runner.run({
					taskId: taskIdFromSnapshot(ctx.snapshot),
					preToolUse: {
						toolName,
						parameters: toStringRecord(ctx.input),
					},
				})

				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PreToolUse",
						toolName,
						status: result.cancel ? "cancelled" : "completed",
						ts: runningTs,
					}),
				)
				return mapStopControl(result)
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PreToolUse",
						toolName: ctx.toolCall.toolName,
						status: "failed",
						ts: runningTs,
					}),
				)
				Logger.error("[HooksAdapter] beforeTool hook failed:", error)
				return undefined
			}
		},

		async afterTool(ctx: AgentAfterToolContext): Promise<undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const factory = new HookFactory()
				if (!(await factory.hasHook("PostToolUse"))) {
					return undefined
				}

				const toolName = ctx.toolCall.toolName
				const runningMsg = buildHookStatusMessage({ hookName: "PostToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				const runner = await factory.create("PostToolUse")
				const result = await runner.run({
					taskId: taskIdFromSnapshot(ctx.snapshot),
					postToolUse: {
						toolName,
						parameters: toStringRecord(ctx.input),
						result: String(ctx.result.output ?? ""),
						success: !ctx.result.isError,
						executionTimeMs: ctx.durationMs,
					},
				})

				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PostToolUse",
						toolName,
						status: result.cancel ? "cancelled" : "completed",
						ts: runningTs,
					}),
				)
				return undefined
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PostToolUse",
						toolName: ctx.toolCall.toolName,
						status: "failed",
						ts: runningTs,
					}),
				)
				Logger.error("[HooksAdapter] afterTool hook failed:", error)
				return undefined
			}
		},

		async afterRun(ctx): Promise<void> {
			let hookName: "TaskComplete" | "TaskCancel" | undefined
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return
				}

				if (ctx.result.status === "failed") {
					// No TaskError HookFactory kind — emit Notification instead (BL-7.3).
					if (PRODUCT_VSCODE_TASK_ERROR_AS_NOTIFICATION) {
						const error = ctx.result.error
						const message =
							error instanceof Error
								? error.message
								: typeof error === "string"
									? error
									: error != null
										? String(error)
										: ctx.result.outputText || "Task failed"
						await emitHostNotificationHook({
							event: "task_error",
							severity: "error",
							message,
							source: "vscode",
							sourceType: "task",
							sourceId: taskIdFromSnapshot(ctx.snapshot),
						})
					}
					return
				}

				hookName =
					ctx.result.status === "completed"
						? "TaskComplete"
						: ctx.result.status === "aborted"
							? "TaskCancel"
							: undefined
				if (!hookName) {
					return
				}

				const factory = new HookFactory()
				if (!(await factory.hasHook(hookName))) {
					return
				}

				const taskId = taskIdFromSnapshot(ctx.snapshot)
				const runningMsg = buildHookStatusMessage({ hookName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				if (hookName === "TaskComplete") {
					const runner = await factory.create("TaskComplete")
					await runner.run({
						taskId,
						taskComplete: {
							taskMetadata: {
								taskId,
								ulid: "",
								initialTask: "",
								result: ctx.result.outputText,
							},
						},
					})
				} else {
					const runner = await factory.create("TaskCancel")
					await runner.run({
						taskId,
						taskCancel: {
							taskMetadata: {
								taskId,
								ulid: "",
								initialTask: "",
								completionStatus: "cancelled",
							},
						},
					})
				}

				emitHookMessage?.(buildHookStatusMessage({ hookName, status: "completed", ts: runningTs }))
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({ hookName: hookName ?? "TaskComplete", status: "failed", ts: runningTs }),
				)
				Logger.error("[HooksAdapter] afterRun hook failed:", error)
			}
		},
	}
}

async function runTaskStart(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = new HookFactory()
		if (!(await factory.hasHook("TaskStart"))) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "TaskStart", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const taskId = taskIdFromSnapshot(ctx.snapshot)
		const runner = await factory.create("TaskStart")
		const result = await runner.run({
			taskId,
			taskStart: {
				taskMetadata: {
					taskId,
					ulid: "",
					initialTask: latestUserPrompt(ctx),
				},
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "TaskStart",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskStart", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (TaskStart) hook failed:", error)
		return undefined
	}
}

async function runTaskResume(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = new HookFactory()
		if (!(await factory.hasHook("TaskResume"))) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "TaskResume", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const taskId = taskIdFromSnapshot(ctx.snapshot)
		const messageCount = String(ctx.snapshot.messages.length)
		const runner = await factory.create("TaskResume")
		const result = await runner.run({
			taskId,
			taskResume: {
				taskMetadata: {
					taskId,
					ulid: "",
					initialTask: latestUserPrompt(ctx),
				},
				previousState: {
					messageCount,
				},
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "TaskResume",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskResume", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (TaskResume) hook failed:", error)
		return undefined
	}
}

async function runUserPromptSubmit(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const factory = new HookFactory()
		if (!(await factory.hasHook("UserPromptSubmit"))) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const runner = await factory.create("UserPromptSubmit")
		const result = await runner.run({
			taskId: taskIdFromSnapshot(ctx.snapshot),
			userPromptSubmit: {
				prompt: latestUserPrompt(ctx),
				attachments: [],
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "UserPromptSubmit",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (UserPromptSubmit) hook failed:", error)
		return undefined
	}
}
