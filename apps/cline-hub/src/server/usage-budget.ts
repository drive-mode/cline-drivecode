import {
	createUsageBudgetAbortHandler,
	readProductMaxSessionCostUsd,
} from "@cline/core";

/**
 * Opt-in USD session budget via product policy env (BL-5.1).
 * When unset / invalid, usage-budget abort is disabled.
 */
export function readHubMaxSessionCostUsd(
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	return readProductMaxSessionCostUsd(env);
}

/**
 * Build an optional usage-budget abort listener for Hub agent events.
 * Returns undefined when no budget is configured.
 */
export function createHubUsageBudgetAbortHandler(options: {
	maxCostUsd: number | undefined;
	abort: (reason: string) => void;
}): ((event: unknown) => void) | undefined {
	if (options.maxCostUsd === undefined) {
		return undefined;
	}
	return createUsageBudgetAbortHandler({
		maxCostUsd: options.maxCostUsd,
		abort: options.abort,
	});
}
