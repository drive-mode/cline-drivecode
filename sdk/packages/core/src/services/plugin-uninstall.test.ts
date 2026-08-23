import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readGlobalSettings, writeGlobalSettings } from "./global-settings";
import { uninstallPlugin } from "./plugin-uninstall";

describe("plugin uninstall service", () => {
	let root = "";
	let home = "";
	let originalHome: string | undefined;
	let originalClineDir: string | undefined;
	let originalClineDataDir: string | undefined;
	let originalGlobalSettingsPath: string | undefined;
	let originalMcpSettingsPath: string | undefined;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "core-plugin-uninstall-"));
		home = join(root, "home");
		originalHome = process.env.HOME;
		originalClineDir = process.env.CLINE_DIR;
		originalClineDataDir = process.env.CLINE_DATA_DIR;
		originalGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
		originalMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		process.env.HOME = home;
		process.env.CLINE_DIR = join(home, ".cline");
		process.env.CLINE_DATA_DIR = join(home, ".cline", "data");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = join(
			home,
			".cline",
			"data",
			"settings",
			"global-settings.json",
		);
		setHomeDir(home);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR;
		} else {
			process.env.CLINE_DIR = originalClineDir;
		}
		if (originalClineDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalClineDataDir;
		}
		if (originalGlobalSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
		}
		if (originalMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalMcpSettingsPath;
		}
		rmSync(root, { recursive: true, force: true });
	});

	async function writeReceiptBinding(
		workspace: string,
		installPath: string,
	): Promise<void> {
		const transactionId = "a".repeat(64);
		const installedContentSha256 = "b".repeat(64);
		const installRelativePath = relative(workspace, installPath).replaceAll(
			"\\",
			"/",
		);
		const attestation = {
			schemaVersion: 1,
			transactionId,
			status: "committed",
			installRelativePath,
			entryRelativePaths: [`${installRelativePath}/package/index.ts`],
			installedContentSha256,
			installTreeAlgorithm: "cline-install-tree-v1",
			pluginApiVersion: "1",
			hostVersion: "uninstall-test",
			verification: {},
		};
		const attestationBytes = `${JSON.stringify(attestation, null, 2)}\n`;
		const attestationSha256 = createHash("sha256")
			.update(attestationBytes)
			.digest("hex");
		const attestationRelativePath = `.qh2/attestations/${transactionId}-${attestationSha256}.json`;
		await mkdir(join(workspace, ".qh2", "attestations"), { recursive: true });
		await writeFile(
			join(workspace, attestationRelativePath),
			attestationBytes,
			"utf8",
		);
		await writeFile(
			join(workspace, ".qh2", "adr-planner.lock"),
			[
				"schema_version=3",
				"source_kind=local-development",
				"source=local-checkout",
				"ref=unversioned",
				"subdir=.",
				`package_manifest_sha256=${"c".repeat(64)}`,
				"source_dirty=true",
				`package_content_sha256=${transactionId}`,
				`install_transaction_id=${transactionId}`,
				`install_attestation_path=${attestationRelativePath}`,
				`install_attestation_sha256=${attestationSha256}`,
				`installed_content_sha256=${installedContentSha256}`,
				"plugin_api_version=1",
				"host_version=uninstall-test",
				"",
			].join("\n"),
			"utf8",
		);
	}

	it("uninstalls an installed package plugin by package name", async () => {
		const installPath = join(
			home,
			".cline",
			"plugins",
			"_installed",
			"local",
			"bundled-skills-demo-123456789abc",
		);
		const entryPath = join(installPath, "package", "index.ts");
		await mkdir(join(installPath, "package"), { recursive: true });
		await writeFile(
			join(installPath, "package.json"),
			JSON.stringify(
				{
					name: "cline-installed-plugin-test",
					cline: {
						plugins: [{ paths: ["./package/index.ts"] }],
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			join(installPath, "package", "package.json"),
			JSON.stringify({ name: "cline-internal-bundled-skills-demo" }, null, 2),
			"utf8",
		);
		await writeFile(
			entryPath,
			"export default { name: 'demo', manifest: { capabilities: ['skills'] } };",
			"utf8",
		);
		writeGlobalSettings({
			disabledPlugins: [entryPath, "/tmp/other-plugin.ts"],
		});

		const result = await uninstallPlugin({
			name: "cline-internal-bundled-skills-demo",
			workspaceRoot: root,
		});

		expect(result.installPath).toBe(installPath);
		expect(existsSync(installPath)).toBe(false);
		expect(readGlobalSettings()).toEqual({
			autoUpdateEnabled: true,
			disabledPlugins: ["/tmp/other-plugin.ts"],
			telemetryOptOut: false,
		});
	});

	it("uninstalls a direct plugin file by path", async () => {
		const pluginPath = join(home, ".cline", "plugins", "direct-plugin.ts");
		await mkdir(join(home, ".cline", "plugins"), { recursive: true });
		await writeFile(
			pluginPath,
			"export default { name: 'direct', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const result = await uninstallPlugin({
			path: pluginPath,
			workspaceRoot: root,
		});

		expect(result.installPath).toBe(pluginPath);
		expect(existsSync(pluginPath)).toBe(false);
	});

	it("refuses to orphan a receipt-bound project ADR Planner install", async () => {
		const workspace = join(root, "workspace");
		const installPath = join(
			workspace,
			".cline",
			"plugins",
			"_installed",
			"local",
			"adr-planner-package-123456789abc",
		);
		await mkdir(join(installPath, "package"), { recursive: true });
		await writeFile(
			join(installPath, "package.json"),
			JSON.stringify({
				name: "cline-installed-plugin",
				cline: { plugins: [{ paths: ["./package/index.ts"] }] },
			}),
			"utf8",
		);
		await writeFile(
			join(installPath, "package", "package.json"),
			JSON.stringify({ name: "@cline/adr-planner" }),
			"utf8",
		);
		await writeFile(
			join(installPath, "package", "index.ts"),
			"export default { name: 'adr-planner', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		await writeReceiptBinding(workspace, installPath);

		await expect(
			uninstallPlugin({ path: installPath, cwd: workspace }),
		).rejects.toThrow(/receipt-bound/);
		await expect(
			uninstallPlugin({ path: installPath, workspaceRoot: workspace }),
		).rejects.toThrow(/receipt-bound/);
		const uninstallChild = fileURLToPath(
			new URL("./test-fixtures/plugin-uninstall-child.ts", import.meta.url),
		);
		const defaultCwdResult = spawnSync(
			"bun",
			[
				"--conditions=development",
				uninstallChild,
				workspace,
				installPath,
				"default-cwd",
			],
			{ cwd: workspace, encoding: "utf8", timeout: 20_000 },
		);
		expect(defaultCwdResult.status).not.toBe(0);
		expect(defaultCwdResult.stderr).toMatch(/receipt-bound/);
		const receiptPath = join(workspace, ".qh2", "adr-planner.lock");
		const validReceipt = await readFile(receiptPath, "utf8");
		for (const mismatch of [
			["plugin_api_version=1", "plugin_api_version=2"],
			["host_version=uninstall-test", "host_version=other-host"],
		] as const) {
			await writeFile(
				receiptPath,
				validReceipt.replace(mismatch[0], mismatch[1]),
				"utf8",
			);
			await expect(
				uninstallPlugin({ path: installPath, cwd: workspace }),
			).rejects.toThrow(/receipt evidence is invalid/);
		}
		await writeFile(receiptPath, validReceipt, "utf8");
		expect(existsSync(installPath)).toBe(true);
		expect(existsSync(join(workspace, ".qh2", "adr-planner.lock"))).toBe(true);
	});

	it.skipIf(process.platform === "win32")(
		"keeps plugin files when MCP settings cleanup fails",
		async () => {
			const pluginPath = join(home, ".cline", "plugins", "mcp-plugin.ts");
			const settingsPath = join(root, "cline_mcp_settings.json");
			process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
			await mkdir(join(home, ".cline", "plugins"), { recursive: true });
			await writeFile(
				pluginPath,
				"export default { name: 'mcp-plugin', manifest: { capabilities: ['mcp'] } };",
				"utf8",
			);
			await writeFile(
				settingsPath,
				JSON.stringify(
					{
						mcpServers: {
							smoke: {
								transport: {
									type: "stdio",
									command: process.execPath,
									args: ["-e", "process.exit(0)"],
								},
								metadata: {
									source: "plugin",
									pluginName: "mcp-plugin",
									pluginPath,
								},
							},
						},
					},
					null,
					2,
				),
				"utf8",
			);
			chmodSync(settingsPath, 0o444);

			try {
				await expect(
					uninstallPlugin({ path: pluginPath, workspaceRoot: root }),
				).rejects.toThrow();
			} finally {
				chmodSync(settingsPath, 0o644);
			}

			expect(existsSync(pluginPath)).toBe(true);
		},
	);

	// chmod-based deletion failure cannot be simulated on Windows, where read-only
	// directory permissions do not prevent removing files inside them.
	it.skipIf(process.platform === "win32")(
		"keeps disabled plugin settings if file deletion fails",
		async () => {
			const pluginRoot = join(home, ".cline", "plugins");
			const pluginPath = join(pluginRoot, "locked-plugin.ts");
			await mkdir(pluginRoot, { recursive: true });
			await writeFile(
				pluginPath,
				"export default { name: 'locked', manifest: { capabilities: ['tools'] } };",
				"utf8",
			);
			writeGlobalSettings({ disabledPlugins: [pluginPath] });
			chmodSync(pluginRoot, 0o555);

			try {
				await expect(
					uninstallPlugin({ path: pluginPath, workspaceRoot: root }),
				).rejects.toThrow();
				expect(existsSync(pluginPath)).toBe(true);
				expect(readGlobalSettings()).toEqual({
					autoUpdateEnabled: true,
					disabledPlugins: [pluginPath],
					telemetryOptOut: false,
				});
			} finally {
				chmodSync(pluginRoot, 0o755);
			}
		},
	);

	it("reports unmatched names clearly", async () => {
		await expect(
			uninstallPlugin({ name: "missing-plugin", workspaceRoot: root }),
		).rejects.toThrow(/No plugin found matching "missing-plugin"/);
	});
});
