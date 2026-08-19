import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildAcpSessionFeatures,
	buildAcpSessionPluginInjection,
} from "./acpAgent";

describe("buildAcpSessionPluginInjection (SDK-4.1)", () => {
	it("returns empty pluginPaths and workspace for an empty cwd", () => {
		const root = mkdtempSync(join(tmpdir(), "acp-plugin-empty-"));
		mkdirSync(join(root, ".cline", "plugins"), { recursive: true });

		const injected = buildAcpSessionPluginInjection(root, root);

		expect(injected.pluginPaths).toEqual([]);
		expect(injected.workspace).toMatchObject({
			rootPath: root,
			cwd: root,
			ide: "Terminal Shell",
		});
	});

	it("discovers a fixture plugin under .cline/plugins/", () => {
		const root = mkdtempSync(join(tmpdir(), "acp-plugin-"));
		const pluginDir = join(root, ".cline", "plugins", "demo");
		mkdirSync(pluginDir, { recursive: true });
		writeFileSync(
			join(pluginDir, "index.ts"),
			`export default { name: "demo", setup() {} }\n`,
			"utf8",
		);
		writeFileSync(
			join(pluginDir, "package.json"),
			JSON.stringify({
				name: "demo-plugin",
				type: "module",
				cline: {
					plugins: [{ paths: ["./index.ts"], capabilities: ["hooks"] }],
				},
			}),
			"utf8",
		);

		const injected = buildAcpSessionPluginInjection(root, root);

		expect(injected.pluginPaths.some((p) => p.endsWith("index.ts"))).toBe(true);
		expect(injected.workspace.rootPath).toBe(root);
	});
});

describe("buildAcpSessionFeatures (BL-5.7)", () => {
	it("applies PRODUCT_DEFAULT_MAX_ITERATIONS for ACP host", async () => {
		const { PRODUCT_DEFAULT_MAX_ITERATIONS } = await import("@cline/core");
		const features = buildAcpSessionFeatures();
		expect(features.maxIterations).toBe(PRODUCT_DEFAULT_MAX_ITERATIONS);
		expect(features.enableSpawnAgent).toBe(true);
		// ACP special-case: spawn on, teams off (product-session-defaults).
		expect(features.enableAgentTeams).toBe(false);
	});
});
