import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-0025 E1 — "grep with an opinion."
 *
 * Finding 2 / initiative L1: every delegation path that can spawn a child must
 * thread parent toolPolicies + requestToolApproval onto a refusal path
 * (intersectToolPolicies / AgentRuntime.requestToolApproval). This test fails
 * when those call sites drop the fields again.
 */
const coreSrc = join(import.meta.dirname, "..");

function read(rel: string): string {
	return readFileSync(join(coreSrc, rel), "utf8");
}

describe("ADR-0025 enforcement consumers (delegation authority)", () => {
	it("createSessionSpawnTool forwards parent policies and approval", () => {
		const source = read("runtime/host/local/spawn-tool.ts");
		expect(source).toMatch(/getParentToolPolicies:\s*\(\)\s*=>\s*parentAuthority/);
		expect(source).toMatch(
			/requestToolApproval:\s*parentAuthority\?\.requestToolApproval/,
		);
		expect(source).toMatch(
			/resolveToolPolicy\(tool\.name,\s*parentPolicies\)\.enabled\s*!==\s*false/,
		);
	});

	it("local host passes SpawnParentAuthority into createSessionSpawnTool", () => {
		const source = read("runtime/host/local-runtime-host.ts");
		expect(source).toMatch(/createSessionSpawnTool\(/);
		expect(source).toMatch(/getToolPolicies:\s*\(\)\s*=>\s*bootstrap\.toolPolicies/);
		expect(source).toMatch(
			/requestToolApproval:\s*bootstrap\.requestToolApproval/,
		);
	});

	it("spawnTeamTeammate passes parentAuthority into buildDelegatedAgentConfig", () => {
		const source = read("extensions/tools/team/team-tools.ts");
		expect(source).toMatch(
			/parentToolPolicies:\s*options\.parentAuthority\?\.toolPolicies/,
		);
		expect(source).toMatch(
			/requestToolApproval:\s*options\.parentAuthority\?\.requestToolApproval/,
		);
	});

	it("runtime-builder boots teams with parentAuthority on the refusal path", () => {
		const source = read("runtime/orchestration/runtime-builder.ts");
		expect(source).toMatch(/parentAuthority:\s*\{/);
		expect(source).toMatch(/toolPolicies:\s*effectiveToolPolicies/);
		expect(source).toMatch(
			/requestToolApproval:\s*input\.requestToolApproval/,
		);
	});

	it("buildDelegatedAgentConfig intersects parent policies (refusal funnel)", () => {
		const source = read("extensions/tools/team/delegated-agent.ts");
		expect(source).toMatch(
			/toolPolicies:\s*intersectToolPolicies\(\s*options\.parentToolPolicies,\s*options\.toolPolicies,\s*\)/,
		);
		expect(source).toMatch(
			/requestToolApproval:\s*options\.requestToolApproval/,
		);
	});
});
