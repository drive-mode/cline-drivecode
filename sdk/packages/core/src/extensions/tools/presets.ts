/**
 * AgentTool Presets
 *
 * Pre-configured tool combinations for common use cases.
 */

import type { AgentMode, AgentTool, ToolPolicy } from "@cline/shared";
import { ALL_DEFAULT_TOOL_NAMES } from "./constants";
import { createDefaultTools } from "./definitions";
import type { CreateDefaultToolsOptions, DefaultToolsConfig } from "./types";

export interface ToolPresetConfig extends DefaultToolsConfig {
	enableSpawnAgent?: boolean;
	enableAgentTeams?: boolean;
}

/**
 * Preset configurations for common use cases
 */
export const ToolPresets = {
	/**
	 * Act mode (full development tools)
	 * Good for coding assistants and task automation
	 */
	act: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableApplyPatch: false,
		enableEditor: true,
		enableSkills: true,
		enableAskQuestion: true,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Plan mode (no file mutation; shell stays available for inspection)
	 * Good for analysis and documentation agents.
	 *
	 * `enableBash` is deliberately true. `run_commands` is essential for
	 * read-only investigation -- `git log`, `git diff`, version probes -- and
	 * no other tool covers those. The mitigation for plan-mode mutations is
	 * prompting plus mode-switch notices, not tool removal; see
	 * `PLAN_MODE_INSTRUCTIONS` in `@cline/shared` (`prompt/cline.ts`), which
	 * tells the model the tool is inspection-only here, and the product
	 * decision pinned in `prompt/cline.test.ts`.
	 *
	 * Capping a delegated child's shell authority is a per-delegation
	 * `ToolPolicy` concern, not a change to this preset.
	 */
	plan: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: true,
		enableAskQuestion: true,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Search-focused tools (read_files + search_codebase)
	 * Good for code exploration and analysis agents
	 */
	search: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: false,
		enableWebFetch: false,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: false,
		enableAskQuestion: false,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	},

	/**
	 * Minimal tools for focused tasks
	 */
	minimal: {
		enableReadFiles: false,
		enableSearch: false,
		enableBash: true,
		enableWebFetch: false,
		enableApplyPatch: false,
		enableEditor: false,
		enableSkills: false,
		enableAskQuestion: false,
		enableSubmitAndExit: false,
		enableSpawnAgent: true,
		enableAgentTeams: false,
	},

	/**
	 * YOLO mode (automation-focused tools + no approval required)
	 * Good for trusted local automation workflows.
	 */
	yolo: {
		enableReadFiles: true,
		enableSearch: false,
		enableBash: true,
		enableWebFetch: false,
		enableApplyPatch: false,
		enableEditor: true,
		enableSkills: false,
		enableAskQuestion: false,
		enableSubmitAndExit: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	},
} as const satisfies Record<string, ToolPresetConfig>;

/**
 * Type for preset names
 */
export type ToolPresetName = keyof typeof ToolPresets;

export function resolveToolPresetName(options: {
	mode?: AgentMode;
}): ToolPresetName {
	if (options.mode === "plan") {
		return "plan";
	}
	if (options.mode === "yolo") {
		return "yolo";
	}
	return "act";
}

/**
 * AgentTool policy preset names
 */
export type ToolPolicyPresetName = "default" | "yolo";

/**
 * Build tool policies for a preset.
 * `yolo` guarantees tool policies are enabled and auto-approved.
 */
export function createToolPoliciesWithPreset(
	presetName: ToolPolicyPresetName,
): Record<string, ToolPolicy> {
	if (presetName !== "yolo") {
		return {};
	}

	const yoloPolicy: ToolPolicy = {
		enabled: true,
		autoApprove: true,
	};

	const policies: Record<string, ToolPolicy> = {
		"*": yoloPolicy,
	};

	for (const toolName of ALL_DEFAULT_TOOL_NAMES) {
		policies[toolName] = yoloPolicy;
	}

	return policies;
}

/**
 * Create default tools using a preset configuration
 *
 * @example
 * ```typescript
 * const tools = createDefaultToolsWithPreset("plan", {
 *   executors: {
 *     readFile: async ({ path }) => fs.readFile(path, "utf-8"),
 *     search: async (query, cwd) => searchFiles(query, cwd),
 *     webFetch: async (url, prompt) => fetchAndAnalyze(url, prompt),
 *   },
 *   cwd: "/path/to/project",
 * })
 * ```
 */
export function createDefaultToolsWithPreset(
	presetName: ToolPresetName,
	options: Omit<CreateDefaultToolsOptions, keyof DefaultToolsConfig> &
		Partial<DefaultToolsConfig>,
): AgentTool[] {
	const preset = ToolPresets[presetName];
	const {
		enableSpawnAgent: _enableSpawnAgent,
		enableAgentTeams: _enableAgentTeams,
		...toolConfig
	} = preset;
	return createDefaultTools({
		...toolConfig,
		...options,
	});
}
