/**
 * Optional usage-budget abort helpers (D4 / SDK-5.2).
 *
 * Encodes the cost-control pattern from the public going-to-production guide
 * as a small reusable API. Hosts may call these from session event
 * subscriptions; wiring is opt-in (no host applies a USD budget by default).
 *
 * @see docs/sdk/guides/going-to-production.mdx — Cost Control
 * @see docs/sdk/architecture/integration-build.mdx — Phase 5
 */

/** USD-per-million-token pricing used when `totalCost` is absent. */
export type UsageBudgetPricing = {
	inputPerMillion: number;
	outputPerMillion: number;
};

/**
 * Minimal usage shape accepted by budget helpers.
 * Supports runtime `AgentUsage` and legacy host `usage` event totals.
 */
export type UsageForBudget = {
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	/** Legacy accumulated totals (host-facing `usage` events). */
	totalInputTokens?: number;
	totalOutputTokens?: number;
};

export type EvaluateUsageBudgetInput = {
	/** Abort when estimated/reported session cost exceeds this USD amount. */
	maxCostUsd: number;
	/** Used only when usage has no `totalCost`. */
	pricing?: UsageBudgetPricing;
	/** Abort reason string passed to the host abort callback. */
	reason?: string;
};

export type UsageBudgetAbortDecision =
	| { abort: false; cost?: number }
	| { abort: true; cost: number; reason: string };

/** Prefix for the evaluateUsageBudget default abort reason (before the USD amount). */
export const DEFAULT_USAGE_BUDGET_ABORT_REASON = "Cost limit exceeded";

function asNonNegativeNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return value;
}

/**
 * Resolve a USD cost from usage. Prefers provider-reported `totalCost`;
 * otherwise estimates from token counts × pricing when pricing is provided.
 */
export function estimateUsageCost(
	usage: UsageForBudget,
	pricing?: UsageBudgetPricing,
): number | undefined {
	const reported = asNonNegativeNumber(usage.totalCost);
	if (reported !== undefined) {
		return reported;
	}
	if (!pricing) {
		return undefined;
	}
	const input =
		asNonNegativeNumber(usage.inputTokens) ??
		asNonNegativeNumber(usage.totalInputTokens) ??
		0;
	const output =
		asNonNegativeNumber(usage.outputTokens) ??
		asNonNegativeNumber(usage.totalOutputTokens) ??
		0;
	return (
		(input / 1_000_000) * pricing.inputPerMillion +
		(output / 1_000_000) * pricing.outputPerMillion
	);
}

/**
 * Pure check: whether current usage exceeds `maxCostUsd`.
 */
export function shouldAbortForUsageBudget(
	usage: UsageForBudget,
	maxCostUsd: number,
	pricing?: UsageBudgetPricing,
): boolean {
	return evaluateUsageBudget(usage, { maxCostUsd, pricing }).abort;
}

/**
 * Evaluate whether a host should abort for a usage budget.
 */
export function evaluateUsageBudget(
	usage: UsageForBudget,
	options: EvaluateUsageBudgetInput,
): UsageBudgetAbortDecision {
	if (
		typeof options.maxCostUsd !== "number" ||
		!Number.isFinite(options.maxCostUsd) ||
		options.maxCostUsd <= 0
	) {
		return { abort: false };
	}
	const cost = estimateUsageCost(usage, options.pricing);
	if (cost === undefined) {
		return { abort: false };
	}
	if (cost > options.maxCostUsd) {
		return {
			abort: true,
			cost,
			reason:
				options.reason?.trim() ||
				`${DEFAULT_USAGE_BUDGET_ABORT_REASON} ($${options.maxCostUsd.toFixed(2)})`,
		};
	}
	return { abort: false, cost };
}

/**
 * Extract usage from runtime `usage-updated` or legacy host `usage` events.
 * Returns undefined for unrelated events.
 */
export function usageFromSessionEvent(event: unknown): UsageForBudget | undefined {
	if (!event || typeof event !== "object") {
		return undefined;
	}
	const record = event as Record<string, unknown>;
	if (record.type === "usage-updated") {
		const usage = record.usage;
		if (!usage || typeof usage !== "object") {
			return undefined;
		}
		const u = usage as Record<string, unknown>;
		return {
			inputTokens: asNonNegativeNumber(u.inputTokens),
			outputTokens: asNonNegativeNumber(u.outputTokens),
			totalCost: asNonNegativeNumber(u.totalCost),
		};
	}
	if (record.type === "usage") {
		return {
			inputTokens: asNonNegativeNumber(record.inputTokens),
			outputTokens: asNonNegativeNumber(record.outputTokens),
			totalInputTokens: asNonNegativeNumber(record.totalInputTokens),
			totalOutputTokens: asNonNegativeNumber(record.totalOutputTokens),
			totalCost: asNonNegativeNumber(record.totalCost),
		};
	}
	return undefined;
}

export type CreateUsageBudgetAbortHandlerOptions = EvaluateUsageBudgetInput & {
	/** Called once when the budget is exceeded. */
	abort: (reason: string) => void;
};

/**
 * Thin subscribe helper: inspects usage events and aborts when over budget.
 * Safe to pass any event; non-usage events are ignored.
 */
export function createUsageBudgetAbortHandler(
	options: CreateUsageBudgetAbortHandlerOptions,
): (event: unknown) => void {
	let aborted = false;
	return (event: unknown) => {
		if (aborted) {
			return;
		}
		const usage = usageFromSessionEvent(event);
		if (!usage) {
			return;
		}
		const decision = evaluateUsageBudget(usage, options);
		if (!decision.abort) {
			return;
		}
		aborted = true;
		options.abort(decision.reason);
	};
}
