import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
	loadGlobalRuntimeConfig,
	loadRuntimeConfig,
	pickBestInstalledAgentIdFromDetected,
	saveRuntimeConfig,
	updateRuntimeConfig,
} from "../../../src/config/runtime-config";
import { createTempDir } from "../../utilities/temp-dir";

// Settings live in `settings.yaml` for fresh installs and in a legacy
// `config.json` where one already exists. These helpers resolve whichever is in
// play so the assertions below describe behaviour ("settings were persisted")
// rather than a filename. The YAML parser reads JSON too, since YAML is a
// superset of it, so one reader covers both.
const SETTINGS_DIR_SEGMENTS = [".cline", "kanban"] as const;

/** The existing settings file, or null when none has been written yet. */
function findSettingsFile(root: string): string | null {
	for (const filename of ["settings.yaml", "config.json"]) {
		const candidate = join(root, ...SETTINGS_DIR_SEGMENTS, filename);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

/**
 * The path settings *would* use, mirroring `resolveSettingsPathInDir` in
 * production: an existing file if there is one, otherwise the YAML path a write
 * would create.
 *
 * This is deliberately distinct from `findSettingsFile`. `globalConfigPath` is
 * always populated, including before anything has been persisted, so comparing
 * it against a helper that returns null on a fresh home fails only where no
 * config gets written — which is CI, where no agent binaries are installed and
 * so auto-selection never persists anything. That is exactly how this was missed
 * locally.
 */
function settingsPathFor(root: string): string {
	return findSettingsFile(root) ?? join(root, ...SETTINGS_DIR_SEGMENTS, "settings.yaml");
}

function settingsFileExists(root: string): boolean {
	return findSettingsFile(root) !== null;
}

function readSettings<T>(root: string): T {
	const path = findSettingsFile(root);
	if (!path) {
		throw new Error(`No settings file under ${root}`);
	}
	return parseYaml(readFileSync(path, "utf8")) as T;
}

function withTemporaryEnv<T>(
	input: {
		home: string;
		pathPrefix?: string;
		replacePath?: boolean;
	},
	run: () => Promise<T>,
): Promise<T> {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousPath = process.env.PATH;
	process.env.HOME = input.home;
	process.env.USERPROFILE = input.home;
	if (input.pathPrefix) {
		process.env.PATH = input.replacePath
			? input.pathPrefix
			: previousPath
				? `${input.pathPrefix}${delimiter}${previousPath}`
				: input.pathPrefix;
	}
	return run().finally(() => {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		if (input.pathPrefix) {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	});
}

function writeFakeCommand(binDir: string, command: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		const scriptPath = join(binDir, `${command}.cmd`);
		writeFileSync(scriptPath, "@echo off\r\nexit /b 0\r\n", "utf8");
		return;
	}
	const scriptPath = join(binDir, command);
	writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(scriptPath, 0o755);
}

describe.sequential("runtime-config auto agent selection", () => {
	it("selects agents using the configured priority order", () => {
		expect(pickBestInstalledAgentIdFromDetected(["codex", "opencode", "gemini"])).toBe("codex");
		expect(pickBestInstalledAgentIdFromDetected(["opencode", "droid", "gemini"])).toBe("droid");
		expect(pickBestInstalledAgentIdFromDetected(["kiro-cli", "gemini"])).toBe("kiro");
		expect(pickBestInstalledAgentIdFromDetected(["droid", "gemini", "cline"])).toBe("droid");
		expect(pickBestInstalledAgentIdFromDetected(["gemini", "cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["claude", "codex", "cline"])).toBe("claude");
		expect(pickBestInstalledAgentIdFromDetected(["claude", "droid"])).toBe("claude");
		expect(pickBestInstalledAgentIdFromDetected(["cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected([])).toBeNull();
	});

	it("auto-selects and persists when unset", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-");

		try {
			writeFakeCommand(tempBin, "opencode");
			writeFakeCommand(tempBin, "codex");
			writeFakeCommand(tempBin, "gemini");

			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				const isolatedPath = `${tempBin}${delimiter}/usr/bin${delimiter}/bin`;
				await withTemporaryEnv({ home: tempHome, pathPrefix: isolatedPath, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("codex");
					const persisted = readSettings(tempHome) as {
						selectedAgentId?: string;
						agentAutonomousModeEnabled?: boolean;
						readyForReviewNotificationsEnabled?: boolean;
						commitPromptTemplate?: string;
						openPrPromptTemplate?: string;
					};
					expect(persisted.selectedAgentId).toBe("codex");
					expect(persisted.agentAutonomousModeEnabled).toBeUndefined();
					expect(persisted.readyForReviewNotificationsEnabled).toBeUndefined();
					expect(persisted.commitPromptTemplate).toBeUndefined();
					expect(persisted.openPrPromptTemplate).toBeUndefined();

					const reloadedState = await loadRuntimeConfig(tempProject);
					expect(reloadedState.selectedAgentId).toBe("codex");
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not write config when no supported CLI is detected", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-default-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-default-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-default-");

		try {
			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("cline");
					expect(settingsFileExists(tempHome)).toBe(false);
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("treats the home directory as global-only config scope", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-home-scope-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadRuntimeConfig(tempHome);
				expect(state.globalConfigPath).toBe(settingsPathFor(tempHome));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);

				const updated = await updateRuntimeConfig(tempHome, {
					selectedAgentId: "codex",
				});
				expect(updated.selectedAgentId).toBe("codex");
				expect(updated.projectConfigPath).toBeNull();

				const globalPayload = readSettings(tempHome) as {
					selectedAgentId?: string;
					shortcuts?: unknown;
				};
				expect(globalPayload.selectedAgentId).toBe("codex");
				expect(globalPayload.shortcuts).toBeUndefined();
			});
		} finally {
			cleanupHome();
		}
	});

	it("loads global runtime config without a project scope", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-global-only-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadGlobalRuntimeConfig();
				expect(state.globalConfigPath).toBe(settingsPathFor(tempHome));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);
			});
		} finally {
			cleanupHome();
		}
	});

	it("normalizes unsupported configured agents to the default launch agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-set-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-set-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-set-");

		try {
			writeFakeCommand(tempBin, "claude");
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, ".cline", "kanban");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						selectedAgentId: "gemini",
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("cline");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not auto-select when global config file already exists without selected agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-existing-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-existing-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-existing-");

		try {
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, ".cline", "kanban");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						readyForReviewNotificationsEnabled: true,
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("cline");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("save omits default keys when they were not previously set", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-omit-defaults-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-omit-defaults-",
		);

		try {
			const runtimeConfigDir = join(tempHome, ".cline", "kanban");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(join(runtimeConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
					agentAutonomousModeEnabled: true,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
				});

				const globalPayload = readSettings(tempHome) as {
					selectedAgentId?: string;
					agentAutonomousModeEnabled?: boolean;
					readyForReviewNotificationsEnabled?: boolean;
					commitPromptTemplate?: string;
					openPrPromptTemplate?: string;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.agentAutonomousModeEnabled).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
				expect(globalPayload.commitPromptTemplate).toBeUndefined();
				expect(globalPayload.openPrPromptTemplate).toBeUndefined();
				expect(settingsFileExists(tempProject)).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("removes an existing empty project config file when no shortcuts are saved", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-cleanup-empty-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-cleanup-empty-",
		);

		try {
			const runtimeProjectConfigDir = join(tempProject, ".cline", "kanban");
			mkdirSync(runtimeProjectConfigDir, { recursive: true });
			writeFileSync(join(runtimeProjectConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
					agentAutonomousModeEnabled: true,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
				});

				expect(settingsFileExists(tempProject)).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("removes the project config file when the last shortcut is deleted", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-remove-last-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-remove-last-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
					agentAutonomousModeEnabled: true,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [{ label: "Ship", command: "npm run ship", icon: "rocket" }],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
				});
				expect(settingsFileExists(tempProject)).toBe(true);

				await updateRuntimeConfig(tempProject, {
					shortcuts: [],
				});

				expect(settingsFileExists(tempProject)).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("updateRuntimeConfig supports partial updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-partial-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-partial-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await loadRuntimeConfig(tempProject);

				const updated = await updateRuntimeConfig(tempProject, {
					selectedAgentId: "codex",
				});
				expect(updated.selectedAgentId).toBe("codex");

				const globalPayload = readSettings(tempHome) as {
					selectedAgentId?: string;
					selectedShortcutLabel?: string;
					agentAutonomousModeEnabled?: boolean;
					readyForReviewNotificationsEnabled?: boolean;
				};
				expect(globalPayload.selectedAgentId).toBe("codex");
				expect(globalPayload.selectedShortcutLabel).toBeUndefined();
				expect(globalPayload.agentAutonomousModeEnabled).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists autonomous mode when disabled", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-autonomous-disabled-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-autonomous-disabled-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const updated = await updateRuntimeConfig(tempProject, {
					agentAutonomousModeEnabled: false,
				});
				expect(updated.agentAutonomousModeEnabled).toBe(false);

				const globalPayload = readSettings(tempHome) as {
					agentAutonomousModeEnabled?: boolean;
				};
				expect(globalPayload.agentAutonomousModeEnabled).toBe(false);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("preserves concurrent config updates across processes", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-concurrent-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-concurrent-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await loadRuntimeConfig(tempProject);

				const [selectedAgentState, autonomousModeState] = await Promise.all([
					updateRuntimeConfig(tempProject, {
						selectedAgentId: "codex",
					}),
					updateRuntimeConfig(tempProject, {
						agentAutonomousModeEnabled: false,
					}),
				]);

				expect(selectedAgentState.selectedAgentId).toBe("codex");
				expect(autonomousModeState.agentAutonomousModeEnabled).toBe(false);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.selectedAgentId).toBe("codex");
				expect(reloaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});
});

describe("settings file format", () => {
	it("writes settings.yaml on a fresh install", async () => {
		const { path: tempHome, cleanup } = createTempDir("kanban-home-settings-fresh-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await updateRuntimeConfig(tempHome, { selectedAgentId: "codex" });

				const written = findSettingsFile(tempHome);
				expect(written).toBe(join(tempHome, ".cline", "kanban", "settings.yaml"));
				expect(existsSync(join(tempHome, ".cline", "kanban", "config.json"))).toBe(false);

				// Readable as YAML, not just as JSON that happens to parse.
				const raw = readFileSync(written as string, "utf8");
				expect(raw.startsWith("{")).toBe(false);
				expect(raw).toContain("selectedAgentId: codex");
			});
		} finally {
			cleanup();
		}
	});

	// An installation that already has config.json must keep using it. Silently
	// rewriting a user's file into another format on first save would be a
	// surprising thing for an app to do to a file the user may be tracking in git.
	it("keeps writing json when a legacy config.json already exists", async () => {
		const { path: tempHome, cleanup } = createTempDir("kanban-home-settings-legacy-");

		try {
			const configDir = join(tempHome, ".cline", "kanban");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "config.json"), JSON.stringify({ selectedAgentId: "claude" }), "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const loaded = await loadRuntimeConfig(tempHome);
				expect(loaded.selectedAgentId).toBe("claude");

				await updateRuntimeConfig(tempHome, { selectedAgentId: "codex" });

				expect(existsSync(join(configDir, "settings.yaml"))).toBe(false);
				const raw = readFileSync(join(configDir, "config.json"), "utf8");
				expect(JSON.parse(raw).selectedAgentId).toBe("codex");
			});
		} finally {
			cleanup();
		}
	});

	it("reads a hand-written yaml file, comments and all", async () => {
		const { path: tempHome, cleanup } = createTempDir("kanban-home-settings-handwritten-");

		try {
			const configDir = join(tempHome, ".cline", "kanban");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(
				join(configDir, "settings.yaml"),
				"# turned this off while pairing\nagentAutonomousModeEnabled: false\nselectedAgentId: codex\n",
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome }, async () => {
				const loaded = await loadRuntimeConfig(tempHome);
				expect(loaded.selectedAgentId).toBe("codex");
				expect(loaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanup();
		}
	});

	// A settings file the user broke while hand-editing must not stop the runtime
	// from starting. Falling back to defaults is recoverable; refusing to boot is not.
	it("falls back to defaults when the yaml is malformed", async () => {
		const { path: tempHome, cleanup } = createTempDir("kanban-home-settings-malformed-");

		try {
			const configDir = join(tempHome, ".cline", "kanban");
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "settings.yaml"), "{ this: is: not: valid", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const loaded = await loadRuntimeConfig(tempHome);
				expect(loaded.agentAutonomousModeEnabled).toBe(true);
			});
		} finally {
			cleanup();
		}
	});
});
