import {
	type AgentExtensionCommand,
	type AgentExtensionCommandResult,
	type BasicLogger,
	createContributionRegistry,
	resolveAndLoadAgentPlugins,
	resolvePluginInstallationId,
	SqliteExtensionStateStore,
} from "@cline/core";
import type { AgentTool, Message } from "@cline/shared";
import {
	type ChatCommandDefinition,
	type ChatCommandHost,
	chatCommandHost,
} from "./chat-commands";

export interface PluginSlashCommand {
	name: string;
	description?: string;
}

export interface WorkspaceChatCommandHostResult {
	host: ChatCommandHost;
	// Plugin-registered commands surfaced as slash commands for TUI autocomplete.
	pluginSlashCommands: PluginSlashCommand[];
	shutdown?: () => Promise<void>;
}

function normalizeCommandName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) {
		return trimmed;
	}
	return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function createPluginCommandDefinition(
	command: AgentExtensionCommand,
	stateStore: SqliteExtensionStateStore,
): ChatCommandDefinition | undefined {
	if (typeof command.handler !== "function") {
		return undefined;
	}
	const normalizedName = normalizeCommandName(command.name);
	if (!normalizedName) {
		return undefined;
	}
	return {
		names: [normalizedName.toLowerCase()],
		run: async ({ args }, context) => {
			const invocation =
				context.invocation?.task.sessionId && command.extensionId
					? {
							...context.invocation,
							extensionState: stateStore.snapshot({
								workspaceRoot: context.invocation.workspaceRoot,
								sessionId: context.invocation.task.sessionId,
								extensionId: command.extensionId,
							}),
						}
					: context.invocation;
			const result = await command.handler?.(args.join(" "), invocation);
			if (
				result &&
				typeof result === "object" &&
				result.stateMutation !== undefined
			) {
				try {
					if (!command.extensionId || !invocation) {
						throw new TypeError("missing host command authority");
					}
					stateStore.applyMutation({
						extensionId: command.extensionId,
						invocation,
						mutation: result.stateMutation,
						expectedRevision: invocation.extensionState?.revision ?? -1,
					});
				} catch {
					await context.reply(
						"Extension state update rejected: attributable human session context is required.",
					);
					return;
				}
			}
			const { reply, submitPrompt } = normalizeCommandResult(result);
			if (reply) {
				await context.reply(reply);
			}
			if (submitPrompt) {
				await context.submitPrompt?.(submitPrompt);
			}
		},
	};
}

function normalizeCommandResult(
	result: AgentExtensionCommandResult | undefined,
): { reply?: string; submitPrompt?: string } {
	if (typeof result === "string") {
		const reply = result.trim();
		return reply ? { reply } : {};
	}
	if (!result || typeof result !== "object") {
		return {};
	}
	const reply =
		typeof result.reply === "string" && result.reply.trim()
			? result.reply.trim()
			: undefined;
	const submitPrompt =
		typeof result.submitPrompt === "string" && result.submitPrompt.trim()
			? result.submitPrompt.trim()
			: undefined;
	return {
		...(reply ? { reply } : {}),
		...(submitPrompt ? { submitPrompt } : {}),
	};
}

export async function createWorkspaceChatCommandHost(input: {
	cwd: string;
	workspaceRoot?: string;
	logger?: BasicLogger;
	/** Test/embedding override. The command host owns and closes the default. */
	extensionStateStore?: SqliteExtensionStateStore;
}): Promise<WorkspaceChatCommandHostResult> {
	const workspaceRoot = input.workspaceRoot?.trim() || input.cwd;
	let loaded: Awaited<ReturnType<typeof resolveAndLoadAgentPlugins>>;
	try {
		loaded = await resolveAndLoadAgentPlugins({
			cwd: input.cwd,
			workspacePath: workspaceRoot,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.logger?.log(
			`plugin command loading failed; continuing without plugin commands (${message})`,
		);
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}
	if (!loaded.extensions.length) {
		await loaded.shutdown?.().catch(() => {
			// Best effort cleanup when no command-capable plugins were loaded.
		});
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}

	const registry = createContributionRegistry<
		(typeof loaded.extensions)[number],
		AgentTool,
		Message[]
	>({
		extensions: loaded.extensions,
		resolveExtensionId: (extension) => {
			const pluginPath = (extension as { __clinePluginPath?: string })
				.__clinePluginPath;
			if (!pluginPath) {
				throw new TypeError(
					"plugin command is missing host installation identity",
				);
			}
			return resolvePluginInstallationId(pluginPath, extension.name);
		},
	});
	try {
		await registry.initialize();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		input.logger?.log(
			`plugin command registry initialization failed; continuing without plugin commands (${message})`,
		);
		await loaded.shutdown?.().catch(() => {
			// Best effort cleanup after failed command discovery.
		});
		return { host: chatCommandHost, pluginSlashCommands: [] };
	}

	const host = chatCommandHost.clone();
	const stateStore =
		input.extensionStateStore ?? new SqliteExtensionStateStore();
	const pluginSlashCommands: PluginSlashCommand[] = [];
	for (const command of registry.getRegistrySnapshot().commands) {
		const definition = createPluginCommandDefinition(command, stateStore);
		if (definition) {
			host.register("command", definition);
			// Use the same normalized+lowercased name so TUI autocomplete matches the handler key.
			const normalizedName = definition.names[0]; // already lowercased, slash-prefixed
			pluginSlashCommands.push({
				name: normalizedName.startsWith("/")
					? normalizedName.slice(1)
					: normalizedName,
				description: command.description,
			});
		}
	}
	return {
		host,
		pluginSlashCommands,
		shutdown: async () => {
			await loaded.shutdown?.();
			if (!input.extensionStateStore) stateStore.close();
		},
	};
}
