import type { AgentPlugin } from "@cline/sdk";
import { createPlannerCommands } from "./commands";
import { createPlannerTools } from "./tools";

const adrPlannerPlugin: AgentPlugin = {
	name: "adr-planner",
	manifest: {
		capabilities: ["commands", "tools"],
	},
	setup(api, context) {
		for (const command of createPlannerCommands()) {
			api.registerCommand(command);
		}
		for (const tool of createPlannerTools({
			workspaceRoot: context.workspaceInfo?.rootPath,
		})) {
			api.registerTool(tool);
		}
	},
};

export default adrPlannerPlugin;
export * from "./adapters";
export * from "./catalog";
export { createPlannerCommands } from "./commands";
export * from "./core";
export * from "./schema";
export { createPlannerTools, type PlannerToolOptions } from "./tools";
