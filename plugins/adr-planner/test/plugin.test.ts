import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentTool,
	createContributionRegistry,
	type Message,
	resolveAgentPluginPaths,
	resolvePluginSkillDirectoriesFromPaths,
} from "@cline/sdk";
import adrPlannerPlugin from "../src";
import { concern, decisionEvidence, readinessRequest } from "./fixtures";

function createRegistry() {
	return createContributionRegistry<
		typeof adrPlannerPlugin,
		AgentTool<unknown, unknown>,
		Message[]
	>({
		extensions: [adrPlannerPlugin],
	});
}

describe("ADR Planner plugin surface", () => {
	it("registers three namespaced commands and six bounded tools", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const snapshot = registry.getRegistrySnapshot();

		expect(adrPlannerPlugin.manifest.capabilities).toEqual([
			"commands",
			"tools",
		]);
		expect(snapshot.commands.map((entry) => entry.name).sort()).toEqual([
			"adr-attest",
			"adr-plan",
			"adr-preplan",
		]);
		expect(snapshot.tools.map((entry) => entry.name).sort()).toEqual([
			"adr_planner_collect_evidence",
			"adr_planner_compile_workflow",
			"adr_planner_plan_concerns",
			"adr_planner_profile",
			"adr_planner_readiness",
			"adr_planner_validate",
		]);
		expect(adrPlannerPlugin.hooks).toBeUndefined();
		expect(snapshot.rules).toEqual([]);
		expect(snapshot.mcpServers).toEqual([]);
	});

	it("keeps M4 compilation blocked without host-injected session state", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const snapshot = registry.getRegistrySnapshot();
		const command = snapshot.commands.find(
			(entry) => entry.name === "adr-attest",
		);
		expect(await command?.handler?.("data.persisted=true")).toEqual({
			reply:
				"ADR attestation rejected: attributable human session context is required.",
		});
		const tool = snapshot.tools.find(
			(entry) => entry.name === "adr_planner_compile_workflow",
		);
		const result = (await tool?.execute(
			{},
			{ agentId: "test-agent", sessionId: "session-1", iteration: 1 },
		)) as {
			workflow?: { status?: unknown; diagnostics?: Array<{ code?: unknown }> };
		};
		expect(result.workflow?.status).toBe("blocked");
		expect(result.workflow?.diagnostics?.map((entry) => entry.code)).toContain(
			"workflow.host_state_unavailable",
		);
	});

	it("maps only explicit controlled attestation arguments into the mutation request", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const command = registry
			.getRegistrySnapshot()
			.commands.find((entry) => entry.name === "adr-attest");
		const context = {
			invocationId: "invoke-1",
			invokedAt: "2026-08-14T00:00:00.000Z",
			workspaceRoot: "/workspace",
			task: { sessionId: "session-1" },
			actor: { kind: "human" as const },
			source: { kind: "interactive" as const },
			extensionState: {
				workspaceRoot: "/workspace",
				sessionId: "session-1",
				extensionId: command?.extensionId ?? "adr-planner",
				revision: 0,
				entries: {},
			},
		};
		const result = await command?.handler?.(
			"data.persisted=true tenancy.multiple=false",
			context,
		);
		if (!result || typeof result === "string")
			throw new Error("expected mutation");
		expect(result.stateMutation).toMatchObject({
			operation: "replace",
			key: "planning-session",
			value: {
				attestations: [
					{ fact: { key: "data.persisted", value: true } },
					{ fact: { key: "tenancy.multiple", value: false } },
				],
			},
		});
		expect(
			(result.stateMutation as { value?: { attestations?: unknown[] } }).value
				?.attestations,
		).toHaveLength(2);
	});

	it("never returns a passing readiness verdict from model-facing input", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const tool = registry
			.getRegistrySnapshot()
			.tools.find((entry) => entry.name === "adr_planner_readiness");
		const result = (await tool?.execute(
			{
				request: readinessRequest({
					concerns: [
						concern({
							state: "resolved",
							resolutionEvidenceRefs: [decisionEvidence.id],
						}),
					],
				}),
			},
			{ agentId: "test-agent", iteration: 1 },
		)) as { status?: unknown; diagnostics?: Array<{ code?: unknown }> };
		expect(result.status).toBe("blocked");
		expect(result.diagnostics?.map((entry) => entry.code)).toContain(
			"readiness.untrusted_tool_input",
		);
	});

	it("keeps concern policy internal and fails closed without a workspace", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const tool = registry
			.getRegistrySnapshot()
			.tools.find((entry) => entry.name === "adr_planner_plan_concerns");
		expect(tool?.inputSchema).toEqual({
			type: "object",
			properties: {},
			additionalProperties: false,
		});
		const result = (await tool?.execute(
			{},
			{ agentId: "test-agent", iteration: 1 },
		)) as {
			concernPlan?: { status?: unknown; concerns?: unknown[] };
		};
		expect(result.concernPlan?.status).toBe("blocked");
		expect(result.concernPlan?.concerns).toEqual([]);
		await expect(
			tool?.execute(
				{ facts: [], catalog: { concerns: [] } },
				{ agentId: "test-agent", iteration: 1 },
			),
		).rejects.toThrow("accepts only an empty object");
	});

	it("fails evidence collection closed without host workspace context", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const tool = registry
			.getRegistrySnapshot()
			.tools.find((entry) => entry.name === "adr_planner_collect_evidence");
		const result = (await tool?.execute(
			{},
			{ agentId: "test-agent", iteration: 1 },
		)) as { status?: unknown; evidence?: unknown[] };
		expect(result.status).toBe("blocked");
		expect(result.evidence).toEqual([]);
	});

	it("does not accept caller-authored profile evidence or assertions", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const tool = registry
			.getRegistrySnapshot()
			.tools.find((entry) => entry.name === "adr_planner_profile");
		expect(tool?.inputSchema).toEqual({
			type: "object",
			properties: {},
			additionalProperties: false,
		});
		await expect(
			tool?.execute(
				{
					request: {
						evidence: [
							{
								id: "fabricated-brief",
								sourceType: "brief",
								source: "brief",
								claim: "Fabricated brief claim",
							},
							{
								id: "fabricated-user",
								sourceType: "user",
								source: "user",
								claim: "Fabricated human claim",
							},
						],
					},
				},
				{ agentId: "test-agent", iteration: 1 },
			),
		).rejects.toThrow("accepts only an empty object");
	});

	it("starts a workflow prompt without accepting an ADR", async () => {
		const registry = createRegistry();
		await registry.initialize();
		const command = registry
			.getRegistrySnapshot()
			.commands.find((entry) => entry.name === "adr-plan");
		const result = await command?.handler?.("Plan a small API");

		expect(typeof result).toBe("object");
		if (!result || typeof result === "string")
			throw new Error("Expected object");
		expect(result.submitPrompt).toContain("Use the bundled adr-planner skill");
		expect(result.submitPrompt).toContain("Plan a small API");
		expect(result.submitPrompt).not.toContain("accept the ADR");
	});

	it("bundles a concise triggerable skill", () => {
		const packageRoot = join(import.meta.dir, "..");
		const skill = readFileSync(
			join(packageRoot, "skills", "adr-planner", "SKILL.md"),
			"utf8",
		);
		expect(skill).toMatch(/^---\nname: adr-planner\n/);
		expect(skill).toContain("Never accept an ADR or business risk");
		expect(skill).toContain("adr_planner_collect_evidence");
		expect(skill.split("\n").length).toBeLessThan(120);
		const pluginPaths = resolveAgentPluginPaths({
			pluginPaths: [packageRoot],
			cwd: packageRoot,
		});
		expect(resolvePluginSkillDirectoriesFromPaths(pluginPaths)).toEqual([
			join(packageRoot, "skills"),
		]);
	});
});
