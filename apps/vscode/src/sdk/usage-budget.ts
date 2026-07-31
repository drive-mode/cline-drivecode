import { createUsageBudgetAbortHandler, readProductMaxSessionCostUsd } from "@cline/core"
import type { StateManager } from "@/core/storage/StateManager"

/**
 * Resolve the VS Code USD session budget (BL-5.3).
 * User setting `maxSessionCostUsd` wins over `CLINE_MAX_SESSION_COST` env.
 */
export function readVsCodeMaxSessionCostUsd(
	stateManager?: Pick<StateManager, "getGlobalSettingsKey">,
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	const configured = stateManager?.getGlobalSettingsKey("maxSessionCostUsd")
	if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
		return configured
	}
	return readProductMaxSessionCostUsd(env)
}

/**
 * Build an optional usage-budget abort listener for VS Code agent events.
 * Returns undefined when no budget is configured.
 */
export function createVsCodeUsageBudgetAbortHandler(options: {
	maxCostUsd: number | undefined
	abort: (reason: string) => void
}): ((event: unknown) => void) | undefined {
	if (options.maxCostUsd === undefined) {
		return undefined
	}
	return createUsageBudgetAbortHandler({
		maxCostUsd: options.maxCostUsd,
		abort: options.abort,
	})
}
