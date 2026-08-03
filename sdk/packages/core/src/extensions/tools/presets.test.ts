import { describe, expect, it } from "vitest";
import {
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	ToolPresets,
} from "./presets";

describe("default tool presets", () => {
	it("explicitly configures ask_question across presets", () => {
		expect(ToolPresets.search.enableAskQuestion).toBe(false);
		expect(ToolPresets.act.enableAskQuestion).toBe(true);
		expect(ToolPresets.plan.enableAskQuestion).toBe(true);
		expect(ToolPresets.minimal.enableAskQuestion).toBe(false);
		expect(ToolPresets.yolo.enableAskQuestion).toBe(false);
	});

	it("disables spawn and team tools by default in yolo mode", () => {
		expect(ToolPresets.act.enableSpawnAgent).toBe(true);
		expect(ToolPresets.act.enableAgentTeams).toBe(true);
		expect(ToolPresets.yolo.enableSpawnAgent).toBe(false);
		expect(ToolPresets.yolo.enableAgentTeams).toBe(false);
		expect(ToolPresets.yolo.enableSubmitAndExit).toBe(true);
	});

	it("disables search and web fetch in yolo mode", () => {
		expect(ToolPresets.yolo.enableSearch).toBe(false);
		expect(ToolPresets.yolo.enableWebFetch).toBe(false);
	});

	it("keeps run_commands in plan mode while withholding file mutation", () => {
		// Explicit product decision, pinned here because nothing else pins it at
		// the preset level: run_commands stays available in plan mode for
		// read-only investigation (git log / git diff / version probes have no
		// alternative tool). PLAN_MODE_INSTRUCTIONS tells the model it is
		// inspection-only, and prompt/cline.test.ts pins that half. Removing the
		// tool here would ship a prompt describing a tool the model lacks.
		expect(ToolPresets.plan.enableBash).toBe(true);
		expect(ToolPresets.plan.enableEditor).toBe(false);
		expect(ToolPresets.plan.enableApplyPatch).toBe(false);
	});

	it("plan preset yields the inspection tools and no mutation tools", () => {
		const tools = createDefaultToolsWithPreset("plan", {
			executors: {
				readFile: async () => "ok",
				search: async () => "ok",
				bash: async () => "ok",
				webFetch: async () => "ok",
				applyPatch: async () => "ok",
				editor: async () => "ok",
			},
		});

		const names = tools.map((tool) => tool.name);
		expect(names).toContain("run_commands");
		expect(names).toContain("read_files");
		expect(names).not.toContain("editor");
		expect(names).not.toContain("apply_patch");
	});

	it("yolo preset excludes ask_question even when its executor exists", () => {
		const tools = createDefaultToolsWithPreset("yolo", {
			executors: {
				readFile: async () => "ok",
				search: async () => "ok",
				bash: async () => "ok",
				webFetch: async () => "ok",
				applyPatch: async () => "ok",
				editor: async () => "ok",
				skills: async () => "ok",
				askQuestion: async () => "ok",
			},
		});

		expect(tools.map((tool) => tool.name)).toEqual([
			"read_files",
			"run_commands",
			"editor",
		]);
	});
});

describe("tool policy presets", () => {
	it("returns empty policies for default", () => {
		expect(createToolPoliciesWithPreset("default")).toEqual({});
	});

	it("yolo preset enables and auto-approves all tools", () => {
		const policies = createToolPoliciesWithPreset("yolo");
		expect(policies["*"]).toEqual({
			enabled: true,
			autoApprove: true,
		});
		expect(policies.ask_question).toEqual({
			enabled: true,
			autoApprove: true,
		});
		expect(policies.skills).toEqual({
			enabled: true,
			autoApprove: true,
		});
	});
});
