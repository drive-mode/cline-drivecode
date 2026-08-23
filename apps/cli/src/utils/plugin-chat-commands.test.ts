import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createContributionRegistry,
	resolveAndLoadAgentPlugins,
	resolvePluginInstallationId,
	SqliteExtensionStateStore,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceChatCommandHost } from "./plugin-chat-commands";

describe("plugin chat commands", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("bridges plugin extension commands onto the chat command host", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-commands-"));
		tempRoots.push(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "echo.js"),
			[
				"export default {",
				"  name: 'echo-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'echo',",
				"      description: 'Echo input',",
				"      handler: async (input) => 'echo:' + input",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);

		const { host, pluginSlashCommands, shutdown } =
			await createWorkspaceChatCommandHost({
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			});
		const reply = vi.fn(async () => undefined);

		// Filter to only our test plugin to ignore any discovered system plugins
		const testCommands = pluginSlashCommands.filter(
			(cmd) => cmd.name === "echo",
		);
		expect(testCommands).toEqual([{ name: "echo", description: "Echo input" }]);

		const handled = await host.handle("/echo hello plugin", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			}),
			setState: async () => undefined,
			reply,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith("echo:hello plugin");
		await shutdown?.();
	});

	it("bridges plugin command submit prompts onto the chat command context", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-commands-"));
		tempRoots.push(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		await writeFile(
			join(pluginsDir, "submit.js"),
			[
				"export default {",
				"  name: 'submit-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'goal',",
				"      description: 'Set a goal and submit it',",
				"      handler: async (input) => ({",
				"        reply: 'goal:' + input,",
				"        submitPrompt: input",
				"      })",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);

		const { host, shutdown } = await createWorkspaceChatCommandHost({
			cwd: tempRoot,
			workspaceRoot: tempRoot,
		});
		const reply = vi.fn(async () => undefined);
		const submitPrompt = vi.fn(async () => undefined);

		const handled = await host.handle("/goal fix tests", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			}),
			setState: async () => undefined,
			reply,
			submitPrompt,
		});

		expect(handled).toBe(true);
		expect(reply).toHaveBeenCalledWith("goal:fix tests");
		expect(submitPrompt).toHaveBeenCalledWith("fix tests");
		await shutdown?.();
	});

	it("applies plugin mutation requests with host invocation provenance", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-state-"));
		tempRoots.push(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const statePluginPath = join(pluginsDir, "state.js");
		await writeFile(
			statePluginPath,
			[
				"export default {",
				"  name: 'state-plugin',",
				"  manifest: { capabilities: ['commands'] },",
				"  setup(api) {",
				"    api.registerCommand({",
				"      name: 'state-set',",
				"      handler: async (input, context) => ({",
				"        reply: context?.task?.sessionId + ':' + context?.actor?.kind,",
				"        stateMutation: { operation: 'replace', key: 'facts', value: { enabled: input === 'on' } }",
				"      })",
				"    });",
				"  },",
				"};",
			].join("\n"),
		);
		const stateStore = new SqliteExtensionStateStore({ dataDir: tempRoot });
		const { host, shutdown } = await createWorkspaceChatCommandHost({
			cwd: tempRoot,
			workspaceRoot: tempRoot,
			extensionStateStore: stateStore,
		});
		const reply = vi.fn(async () => undefined);

		expect(
			await host.handle("/state-set on", {
				enabled: true,
				invocation: {
					invocationId: "invoke-1",
					invokedAt: "2026-08-14T00:00:00.000Z",
					workspaceRoot: tempRoot,
					task: { sessionId: "session-1" },
					actor: { kind: "human", id: "human-1" },
					source: { kind: "interactive" },
				},
				getState: async () => ({
					enableTools: false,
					autoApproveTools: false,
					cwd: tempRoot,
					workspaceRoot: tempRoot,
				}),
				setState: async () => undefined,
				reply,
			}),
		).toBe(true);
		expect(reply).toHaveBeenCalledWith("session-1:human");
		expect(
			stateStore.snapshot({
				workspaceRoot: tempRoot,
				sessionId: "session-1",
				extensionId: resolvePluginInstallationId(
					statePluginPath,
					"state-plugin",
				),
			}).entries.facts,
		).toMatchObject({
			value: { enabled: true },
			provenance: { actorKind: "human", actorId: "human-1" },
		});
		await shutdown?.();
		stateStore.close();
	});

	it("rejects mutation requests without authoritative invocation context", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-state-"));
		tempRoots.push(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const statePluginPath = join(pluginsDir, "state.js");
		await writeFile(
			statePluginPath,
			"export default { name: 'state-plugin', manifest: { capabilities: ['commands'] }, setup(api) { api.registerCommand({ name: 'state-set', handler: () => ({ stateMutation: { operation: 'replace', key: 'facts', value: { forged: true } } }) }); } };",
		);
		const stateStore = new SqliteExtensionStateStore({ dataDir: tempRoot });
		const { host, shutdown } = await createWorkspaceChatCommandHost({
			cwd: tempRoot,
			workspaceRoot: tempRoot,
			extensionStateStore: stateStore,
		});
		const reply = vi.fn(async () => undefined);
		await host.handle("/state-set", {
			enabled: true,
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			}),
			setState: async () => undefined,
			reply,
		});

		expect(reply).toHaveBeenCalledWith(
			"Extension state update rejected: attributable human session context is required.",
		);
		expect(
			stateStore.snapshot({
				workspaceRoot: tempRoot,
				sessionId: "session-1",
				extensionId: resolvePluginInstallationId(
					statePluginPath,
					"state-plugin",
				),
			}).entries,
		).toEqual({});
		await shutdown?.();
		stateStore.close();
	});

	it("shares state across real separate command and tool loads while isolating sessions", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-plugin-lifecycle-"));
		tempRoots.push(tempRoot);
		const pluginsDir = join(tempRoot, ".cline", "plugins");
		await mkdir(pluginsDir, { recursive: true });
		const pluginPath = join(pluginsDir, "lifecycle.js");
		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'lifecycle-plugin',",
				"  manifest: { capabilities: ['commands', 'tools'] },",
				"  setup(api) {",
				"    api.registerCommand({ name: 'state-set', handler: () => ({ stateMutation: { operation: 'replace', key: 'facts', value: { trusted: true } } }) });",
				"    api.registerTool({ name: 'state-read', description: 'read state', inputSchema: { type: 'object' }, execute: (_input, context) => ({ sessionId: context.sessionId, state: context.extensionState }) });",
				"  }",
				"};",
			].join("\n"),
		);
		const commandStore = new SqliteExtensionStateStore({ dataDir: tempRoot });
		const runtimeStore = new SqliteExtensionStateStore({ dataDir: tempRoot });
		const { host, shutdown: commandShutdown } =
			await createWorkspaceChatCommandHost({
				cwd: tempRoot,
				workspaceRoot: tempRoot,
				extensionStateStore: commandStore,
			});
		const reply = vi.fn(async () => undefined);
		await host.handle("/state-set", {
			enabled: true,
			invocation: {
				invocationId: "invoke-lifecycle",
				invokedAt: "2026-08-14T00:00:00.000Z",
				workspaceRoot: tempRoot,
				task: { sessionId: "session-1" },
				actor: { kind: "human" },
				source: { kind: "interactive" },
			},
			getState: async () => ({
				enableTools: false,
				autoApproveTools: false,
				cwd: tempRoot,
				workspaceRoot: tempRoot,
			}),
			setState: async () => undefined,
			reply,
		});

		const loadRuntime = async (sessionId: string) => {
			const loaded = await resolveAndLoadAgentPlugins({
				pluginPaths: [pluginPath],
				cwd: tempRoot,
				workspacePath: tempRoot,
				workspaceInfo: { rootPath: tempRoot },
				session: { sessionId },
				resolveExtensionState: ({
					workspaceRoot,
					sessionId: scopedSessionId,
					extensionId,
				}) =>
					runtimeStore.snapshot({
						workspaceRoot,
						sessionId: scopedSessionId,
						extensionId,
					}),
			});
			const registry = createContributionRegistry<
				(typeof loaded.extensions)[number],
				AgentTool,
				Message[]
			>({ extensions: loaded.extensions });
			await registry.initialize();
			return { loaded, tool: registry.getRegistrySnapshot().tools[0] };
		};

		const resumed = await loadRuntime("session-1");
		const resumedResult = (await resumed.tool?.execute(
			{},
			{
				agentId: "agent-1",
				iteration: 1,
				sessionId: "forged-session",
				extensionState: {
					workspaceRoot: "/forged",
					sessionId: "forged-session",
					extensionId: "forged-plugin",
					revision: 99,
					entries: {},
				},
			},
		)) as {
			sessionId?: unknown;
			state?: { revision?: unknown; entries?: unknown };
		};
		expect(resumedResult).toMatchObject({
			sessionId: "session-1",
			state: { revision: 1, entries: { facts: { value: { trusted: true } } } },
		});

		const forked = await loadRuntime("session-2");
		const forkedResult = (await forked.tool?.execute(
			{},
			{ agentId: "agent-2", iteration: 1 },
		)) as {
			sessionId?: unknown;
			state?: { revision?: unknown; entries?: unknown };
		};
		expect(forkedResult).toMatchObject({
			sessionId: "session-2",
			state: { revision: 0, entries: {} },
		});

		await resumed.loaded.shutdown?.();
		await forked.loaded.shutdown?.();
		await commandShutdown?.();
		commandStore.close();
		runtimeStore.close();
	});
});
