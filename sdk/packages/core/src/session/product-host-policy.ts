/**
 * Flip-friendly product defaults for SDK integration backlog decisions.
 *
 * Change a constant here (or override via env where noted) — hosts should
 * read through the helpers below instead of hardcoding policy.
 *
 * @see docs/sdk/architecture/integration-backlog.mdx
 * @see docs/sdk/architecture/integration-build.mdx
 */

/** Env used by CLI / Hub / Desktop / VS Code for opt-in USD session abort. */
export const PRODUCT_MAX_SESSION_COST_ENV = "CLINE_MAX_SESSION_COST";

/**
 * BL-4.4 — keep D3: hosts pass `pluginPaths` + workspace (not workspace-only).
 * Flip to true only if product trusts bootstrap discovery alone.
 */
export const PRODUCT_HOST_WORKSPACE_ONLY_PLUGIN_INJECTION = false;

/**
 * BL-6.2 — Hub Chat host AgentHooks (CLI-style). Default off = Desktop parity;
 * file hooks still run on the hub daemon. Enable with env or flip constant.
 */
export const PRODUCT_HUB_HOST_AGENT_HOOKS_DEFAULT = false;
export const PRODUCT_HUB_HOST_AGENT_HOOKS_ENV = "CLINE_HUB_HOST_AGENT_HOOKS";

/**
 * BL-6.4 — Hub Chat vs daemon analytics identity.
 * Soft split used to be platform-only with shared `cline_type: "hub"`.
 * Default hard-splits Hub Chat so dashboards can filter without platform parsing.
 * Flip `PRODUCT_HUB_CHAT_CLINE_TYPE` back to `"hub"` to restore the old series.
 */
export const PRODUCT_HUB_CHAT_CLINE_TYPE = "hub-chat" as const;
export const PRODUCT_HUB_DAEMON_CLINE_TYPE = "hub" as const;
export const PRODUCT_HUB_CHAT_PLATFORM = "Cline Hub" as const;
export const PRODUCT_HUB_DAEMON_PLATFORM = "cline-hub-daemon" as const;

/**
 * BL-6.8 — When the user toggles telemetry opt-out, recreate Hub Chat telemetry
 * and restart the hub attach so the live `ClineCore` picks up the new handle.
 * Flip to false to only apply on the next cold attach.
 */
export const PRODUCT_HUB_RECREATE_TELEMETRY_ON_OPT_OUT = true;

/**
 * BL-7.1 — Host PreCompact before VS Code compaction.
 * Cancel from the hook aborts compaction when `PRODUCT_PRECOMPACT_CANCEL_ABORTS`.
 */
export const PRODUCT_VSCODE_PRECOMPACT_HOOKS = true;
export const PRODUCT_PRECOMPACT_CANCEL_ABORTS = true;

/**
 * BL-7.2 — Host Notification hooks at approval / long-running / OS sites.
 */
export const PRODUCT_VSCODE_NOTIFICATION_HOOKS = true;

/**
 * BL-7.3 / BL-7.4 — Until VS Code HookFactory gains TaskError / SessionShutdown
 * proto kinds, emit Notification hooks with these event names (Core parity intent).
 * Flip both to false to restore SDK-7.1 wontfix silence.
 */
export const PRODUCT_VSCODE_TASK_ERROR_AS_NOTIFICATION = true;
export const PRODUCT_VSCODE_SESSION_SHUTDOWN_AS_NOTIFICATION = true;

/**
 * BL-8.1 — Legacy VS Code otel-config prefers shared env reader for CLINE_OTEL_* /
 * OTEL_* when this is true (BUILD_CONSTANTS still win when set).
 */
export const PRODUCT_VSCODE_LEGACY_OTEL_USE_SHARED_ENV = true;

export function isEnvFlagEnabled(
	envName: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const raw = env[envName]?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

/** Hub host AgentHooks: constant default, overridable by env. */
export function resolveHubHostAgentHooksEnabled(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env[PRODUCT_HUB_HOST_AGENT_HOOKS_ENV] !== undefined) {
		return isEnvFlagEnabled(PRODUCT_HUB_HOST_AGENT_HOOKS_ENV, env);
	}
	return PRODUCT_HUB_HOST_AGENT_HOOKS_DEFAULT;
}

/** Opt-in USD budget from {@link PRODUCT_MAX_SESSION_COST_ENV}. */
export function readProductMaxSessionCostUsd(
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	const raw = env[PRODUCT_MAX_SESSION_COST_ENV]?.trim();
	if (!raw) {
		return undefined;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}
