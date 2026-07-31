/**
 * Session plugin path + extensionContext.workspace helpers for product hosts.
 *
 * Core local bootstrap already discovers plugins when the "plugins" config
 * extension is enabled. Hosts should still pass `pluginPaths` and
 * `extensionContext.workspace` so hub/remote starts and plugin setup() get a
 * consistent workspace (D3).
 *
 * @see docs/sdk/architecture/integration-build.mdx
 */

import { basename } from "node:path";
import type { ExtensionContext } from "@cline/shared";
import {
	resolveAgentPluginPaths,
	resolveAndLoadAgentPlugins,
	type ResolveAndLoadAgentPluginsOptions,
	type ResolveAgentPluginPathsOptions,
} from "../extensions/plugin/plugin-config-loader";

export interface ResolveSessionPluginPathsInput
	extends ResolveAgentPluginPathsOptions {
	/** Alias for workspacePath when hosts use workspaceRoot naming. */
	workspaceRoot?: string;
}

export interface SessionExtensionWorkspaceInput {
	cwd: string;
	workspaceRoot?: string;
	workspaceName?: string;
	ide?: string;
	platform?: string;
}

/**
 * Discover installed/configured plugin module paths (respects disabled plugins).
 */
export function resolveSessionPluginPaths(
	input: ResolveSessionPluginPathsInput = {},
): string[] {
	const cwd = input.cwd?.trim() || process.cwd();
	const workspacePath =
		input.workspacePath?.trim() ||
		input.workspaceRoot?.trim() ||
		cwd;
	return resolveAgentPluginPaths({
		cwd,
		workspacePath,
		pluginPaths: input.pluginPaths,
	});
}

/**
 * Build the `extensionContext.workspace` fragment plugins expect in setup().
 */
export function buildSessionExtensionWorkspace(
	input: SessionExtensionWorkspaceInput,
): NonNullable<ExtensionContext["workspace"]> {
	const cwd = input.cwd.trim() || process.cwd();
	const rootPath = input.workspaceRoot?.trim() || cwd;
	return {
		rootPath,
		cwd,
		workspaceName: input.workspaceName?.trim() || basename(rootPath),
		ide: input.ide,
		platform: input.platform ?? process.platform,
	};
}

export interface ResolveSessionPluginLoadInput
	extends ResolveAndLoadAgentPluginsOptions {
	workspaceRoot?: string;
}

/**
 * Resolve plugin paths and load extensions for session config injection.
 * Safe to call when no plugins are installed (returns empty arrays).
 */
export async function resolveSessionPluginLoad(
	input: ResolveSessionPluginLoadInput = {},
): Promise<{
	pluginPaths: string[];
	extensions: Awaited<
		ReturnType<typeof resolveAndLoadAgentPlugins>
	>["extensions"];
	shutdown?: () => Promise<void>;
	failures: Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>["failures"];
	warnings: Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>["warnings"];
}> {
	const cwd = input.cwd?.trim() || process.cwd();
	const workspacePath =
		input.workspacePath?.trim() ||
		input.workspaceRoot?.trim() ||
		cwd;
	return resolveAndLoadAgentPlugins({
		...input,
		cwd,
		workspacePath,
	});
}
