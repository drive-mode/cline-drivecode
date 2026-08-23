import {
	installPlugin,
	type PluginInstallOptions,
	type PluginInstallResult,
	type PluginMcpOAuthCandidate,
	type PluginUninstallOptions,
	recoverPluginInstallTransactions,
	uninstallPlugin,
} from "@cline/core";

export type {
	PluginInstallOptions,
	PluginInstallResult,
	PluginInstallVerificationExpectations,
	PluginInstallVerificationResult,
	PluginMcpOAuthCandidate,
} from "@cline/core";
export {
	collectPluginMcpOAuthCandidates,
	installPlugin,
	isOfficialPluginSlug,
	parsePluginSource,
} from "@cline/core";

export interface PluginInstallMcpOAuthOptions {
	interactive?: boolean;
	selectCandidates?: (
		candidates: PluginMcpOAuthCandidate[],
	) => Promise<PluginMcpOAuthCandidate[]>;
	authorize?: (candidate: PluginMcpOAuthCandidate) => Promise<void>;
}

export interface PluginInstallIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

type PluginInstallCommandOptions = Omit<PluginInstallOptions, "transaction"> & {
	json?: boolean;
	io?: PluginInstallIo;
	mcpOAuth?: PluginInstallMcpOAuthOptions;
	transactionReceiptPath?: string;
	receiptIntentPath?: string;
	hostVersion?: string;
};

function serializePluginInstallResult(
	result: PluginInstallResult,
): Omit<PluginInstallResult, "mcpOAuthCandidates"> {
	return {
		source: result.source,
		installPath: result.installPath,
		entryPaths: result.entryPaths,
		mcpSyncFailures: result.mcpSyncFailures,
		...(result.verification ? { verification: result.verification } : {}),
		...(result.transaction ? { transaction: result.transaction } : {}),
	};
}

function isInteractivePluginInstall(
	options: PluginInstallCommandOptions,
): boolean {
	return (
		options.mcpOAuth?.interactive ??
		(process.stdin.isTTY && process.stdout.isTTY)
	);
}

async function selectMcpOAuthCandidatesWithClack(
	candidates: PluginMcpOAuthCandidate[],
): Promise<PluginMcpOAuthCandidate[]> {
	const p = await import("@clack/prompts");
	const action = await p.select({
		message: "Authorize plugin MCP servers now?",
		options: [
			{
				value: "all",
				label: "Authorize all",
				hint: "open browser authorization for each server",
			},
			{
				value: "choose",
				label: "Choose servers",
				hint: "select which servers to authorize",
			},
			{
				value: "skip",
				label: "Skip",
			},
		],
	});
	if (p.isCancel(action) || action === "skip") {
		return [];
	}
	if (action === "all") {
		return candidates;
	}

	const selectedNames = await p.multiselect({
		message: "Select MCP servers to authorize",
		options: candidates.map((candidate) => ({
			value: candidate.name,
			label: candidate.name,
			hint: `${candidate.transportType} [${candidate.pluginName}]`,
		})),
		required: false,
	});
	if (p.isCancel(selectedNames) || !Array.isArray(selectedNames)) {
		return [];
	}
	const selected = new Set(selectedNames);
	return candidates.filter((candidate) => selected.has(candidate.name));
}

async function authorizeMcpOAuthCandidate(
	candidate: PluginMcpOAuthCandidate,
): Promise<void> {
	const { authorizeMcpServerOAuthWithBrowser } = await import(
		"../wizards/mcp/oauth"
	);
	await authorizeMcpServerOAuthWithBrowser(candidate.name, {
		throwOnError: true,
	});
}

async function runPluginMcpOAuthFollowup(
	candidates: PluginMcpOAuthCandidate[],
	options: PluginInstallCommandOptions,
): Promise<void> {
	if (candidates.length === 0) {
		return;
	}

	if (!isInteractivePluginInstall(options)) {
		options.io?.writeln("Plugin MCP servers may require OAuth authorization:");
		for (const candidate of candidates) {
			options.io?.writeln(
				`  ${candidate.name} (${candidate.transportType}, plugin: ${candidate.pluginName})`,
			);
		}
		options.io?.writeln(
			'Run "cline mcp" and choose "Authorize OAuth" to authorize them.',
		);
		return;
	}

	const selected =
		options.mcpOAuth?.selectCandidates !== undefined
			? await options.mcpOAuth.selectCandidates(candidates)
			: await selectMcpOAuthCandidatesWithClack(candidates);
	const authorize = options.mcpOAuth?.authorize ?? authorizeMcpOAuthCandidate;
	for (const candidate of selected) {
		try {
			await authorize(candidate);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			options.io?.writeErr(
				`Warning: failed to authorize MCP server ${candidate.name}: ${message}. Run "cline mcp" and choose "Authorize OAuth" to retry.`,
			);
		}
	}
}

export async function runPluginInstallCommand(
	options: PluginInstallCommandOptions,
): Promise<number> {
	try {
		const {
			transactionReceiptPath,
			receiptIntentPath,
			hostVersion,
			json: _json,
			io: _io,
			mcpOAuth: _mcpOAuth,
			...installOptions
		} = options;
		if (
			(transactionReceiptPath === undefined) !==
			(receiptIntentPath === undefined)
		) {
			throw new Error(
				"Transactional install requires both --transaction-receipt and --receipt-intent",
			);
		}
		const result = await installPlugin({
			...installOptions,
			...(transactionReceiptPath && receiptIntentPath
				? {
						transaction: {
							receiptPath: transactionReceiptPath,
							receiptIntentPath,
							hostVersion,
						},
					}
				: {}),
		});
		if (options.json) {
			process.stdout.write(
				JSON.stringify(serializePluginInstallResult(result)),
			);
			return 0;
		}
		options.io?.writeln(`Installed plugin from ${result.source}`);
		options.io?.writeln(`  Path: ${result.installPath}`);
		for (const failure of result.mcpSyncFailures) {
			options.io?.writeErr(
				`Warning: failed to sync plugin MCP servers for ${failure.pluginName ?? failure.pluginPath}: ${failure.message}`,
			);
		}
		await runPluginMcpOAuthFollowup(result.mcpOAuthCandidates, options);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}

export async function runPluginTransactionRecoverCommand(options: {
	cwd: string;
	json?: boolean;
	io?: PluginInstallIo;
}): Promise<number> {
	try {
		const results = recoverPluginInstallTransactions(options.cwd);
		if (options.json) {
			process.stdout.write(JSON.stringify({ results }));
		} else if (results.length === 0) {
			options.io?.writeln("No plugin install transactions require recovery.");
		} else {
			for (const result of results) {
				options.io?.writeln(`${result.transactionId}: ${result.action}`);
			}
		}
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}

export async function runPluginUninstallCommand(
	options: PluginUninstallOptions & { json?: boolean; io?: PluginInstallIo },
): Promise<number> {
	try {
		const result = await uninstallPlugin(options);
		if (options.json) {
			process.stdout.write(JSON.stringify(result));
			return 0;
		}
		options.io?.writeln(`Uninstalled plugin ${result.name}`);
		options.io?.writeln(`  Removed: ${result.installPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
