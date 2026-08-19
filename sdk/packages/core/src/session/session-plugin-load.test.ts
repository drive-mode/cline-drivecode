import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildSessionExtensionWorkspace,
	buildSessionPluginInjection,
	resolveSessionPluginLoad,
	resolveSessionPluginPaths,
} from "./session-plugin-load";

const tempDirs: string[] = [];

afterEach(async () => {
	// Best-effort cleanup is fine for unit temps.
	tempDirs.length = 0;
});

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

describe("buildSessionExtensionWorkspace", () => {
	it("fills rootPath/cwd/workspaceName and defaults platform", () => {
		expect(
			buildSessionExtensionWorkspace({
				cwd: "/tmp/proj/subdir",
				workspaceRoot: "/tmp/proj",
				ide: "Terminal Shell",
			}),
		).toEqual({
			rootPath: "/tmp/proj",
			cwd: "/tmp/proj/subdir",
			workspaceName: "proj",
			ide: "Terminal Shell",
			platform: process.platform,
		});
	});

	it("falls back workspaceRoot to cwd", () => {
		expect(buildSessionExtensionWorkspace({ cwd: "/tmp/only" })).toMatchObject({
			rootPath: "/tmp/only",
			cwd: "/tmp/only",
			workspaceName: "only",
		});
	});

	it("forwards optional mode for VS Code-style workspace fields (BL-4.3)", () => {
		expect(
			buildSessionExtensionWorkspace({
				cwd: "/tmp/proj",
				workspaceRoot: "/tmp/proj",
				ide: "VS Code",
				mode: "plan",
			}),
		).toMatchObject({
			mode: "plan",
			ide: "VS Code",
		});
	});
});

describe("resolveSessionPluginPaths", () => {
	it("returns empty when no plugins are installed", async () => {
		const root = await makeTempDir("cline-plugin-paths-");
		await mkdir(join(root, ".cline", "plugins"), { recursive: true });
		expect(
			resolveSessionPluginPaths({
				cwd: root,
				workspaceRoot: root,
			}),
		).toEqual([]);
	});

	it("discovers a workspace plugin module", async () => {
		const root = await makeTempDir("cline-plugin-mod-");
		const pluginDir = join(root, ".cline", "plugins", "demo");
		await mkdir(pluginDir, { recursive: true });
		const entry = join(pluginDir, "index.ts");
		await writeFile(
			entry,
			`export default { name: "demo", setup() {} }\n`,
			"utf8",
		);
		await writeFile(
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
		const paths = resolveSessionPluginPaths({
			cwd: root,
			workspaceRoot: root,
		});
		expect(paths.some((p) => p.endsWith("index.ts"))).toBe(true);
	});
});

describe("resolveSessionPluginLoad", () => {
	it("returns empty extensions when nothing is installed", async () => {
		const root = await makeTempDir("cline-plugin-load-");
		await mkdir(join(root, ".cline", "plugins"), { recursive: true });
		const loaded = await resolveSessionPluginLoad({
			cwd: root,
			workspaceRoot: root,
			mode: "in_process",
		});
		expect(loaded.pluginPaths).toEqual([]);
		expect(loaded.extensions).toEqual([]);
		expect(loaded.failures).toEqual([]);
	});

	it("loads a fixture plugin successfully (BL-4.8)", async () => {
		const root = await makeTempDir("cline-plugin-load-ok-");
		const entry = join(root, "demo-plugin.js");
		await writeFile(
			entry,
			"export default { name: 'demo', manifest: { capabilities: ['hooks'] }, setup() {} };\n",
			"utf8",
		);
		const loaded = await resolveSessionPluginLoad({
			cwd: root,
			workspaceRoot: root,
			mode: "in_process",
			pluginPaths: [entry],
		});
		expect(loaded.pluginPaths).toContain(entry);
		expect(loaded.extensions.some((ext) => ext.name === "demo")).toBe(true);
		expect(loaded.failures).toEqual([]);
	});
});

describe("buildSessionPluginInjection", () => {
	it("returns empty pluginPaths and a workspace fragment for an empty cwd", async () => {
		const root = await makeTempDir("cline-plugin-inject-empty-");
		await mkdir(join(root, ".cline", "plugins"), { recursive: true });
		const injected = buildSessionPluginInjection({
			cwd: root,
			workspaceRoot: root,
			ide: "Terminal Shell",
		});
		expect(injected.pluginPaths).toEqual([]);
		expect(injected.workspace).toEqual({
			rootPath: root,
			cwd: root,
			workspaceName: expect.any(String),
			ide: "Terminal Shell",
			platform: process.platform,
		});
	});

	it("discovers fixture plugins and sets workspace", async () => {
		const root = await makeTempDir("cline-plugin-inject-");
		const pluginDir = join(root, ".cline", "plugins", "demo");
		await mkdir(pluginDir, { recursive: true });
		await writeFile(
			join(pluginDir, "index.ts"),
			`export default { name: "demo", setup() {} }\n`,
			"utf8",
		);
		await writeFile(
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
		const injected = buildSessionPluginInjection({
			cwd: root,
			workspaceRoot: root,
			ide: "VS Code",
			workspaceName: "fixture",
		});
		expect(injected.pluginPaths.some((p) => p.endsWith("index.ts"))).toBe(true);
		expect(injected.workspace).toMatchObject({
			rootPath: root,
			cwd: root,
			workspaceName: "fixture",
			ide: "VS Code",
		});
	});

	it("passes through explicit pluginPaths overrides (BL-4.7)", async () => {
		const root = await makeTempDir("cline-plugin-override-");
		const entry = join(root, "explicit-plugin.js");
		await writeFile(
			entry,
			"export default { name: 'explicit', setup() {} }\n",
			"utf8",
		);
		const injected = buildSessionPluginInjection({
			cwd: root,
			workspaceRoot: root,
			pluginPaths: [entry],
			ide: "Terminal Shell",
		});
		expect(injected.pluginPaths).toContain(entry);
	});

	it("omits plugins disabled in global settings (BL-4.6)", async () => {
		const { setHomeDir } = await import("@cline/shared/storage");
		const root = await makeTempDir("cline-plugin-disabled-");
		const previousHome = process.env.HOME;
		const previousSettings = process.env.CLINE_GLOBAL_SETTINGS_PATH;
		try {
			process.env.HOME = root;
			setHomeDir(root);
			const enabledPlugin = join(root, "enabled.js");
			const disabledPlugin = join(root, "disabled.js");
			const settingsPath = join(root, "global-settings.json");
			process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
			await writeFile(enabledPlugin, "export default {}", "utf8");
			await writeFile(disabledPlugin, "export default {}", "utf8");
			await writeFile(
				settingsPath,
				JSON.stringify({ disabledPlugins: [disabledPlugin] }, null, 2),
				"utf8",
			);

			const injected = buildSessionPluginInjection({
				cwd: root,
				workspaceRoot: root,
				pluginPaths: [enabledPlugin, disabledPlugin],
			});
			expect(injected.pluginPaths).toEqual([enabledPlugin]);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
			if (previousSettings === undefined) {
				delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
			} else {
				process.env.CLINE_GLOBAL_SETTINGS_PATH = previousSettings;
			}
		}
	});
});
