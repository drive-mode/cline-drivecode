import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSessionStartInput } from "./sessions";

function makeFixturePluginRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "hub-session-plugin-"));
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
	return root;
}

describe("buildSessionStartInput plugin injection (SDK-4.2)", () => {
	it("sets pluginPaths: [] and workspace when no plugins are installed", () => {
		const root = mkdtempSync(join(tmpdir(), "hub-session-empty-"));
		mkdirSync(join(root, ".cline", "plugins"), { recursive: true });

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		expect(input.config.pluginPaths).toEqual([]);
		expect(input.config.extensionContext?.workspace).toMatchObject({
			rootPath: root,
			cwd: root,
			ide: "Cline Hub",
		});
	});

	it("populates pluginPaths when a fixture plugin exists under .cline/plugins/", () => {
		const root = makeFixturePluginRoot();

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		expect(
			input.config.pluginPaths?.some((p) => p.endsWith("index.ts")),
		).toBe(true);
		expect(input.config.extensionContext?.workspace?.rootPath).toBe(root);
	});
});
