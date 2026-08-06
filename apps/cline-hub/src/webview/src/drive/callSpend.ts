/**
 * Call-session spend accumulator (PU4).
 * Only folds measured usage — never invents $ from tokens alone.
 */

export type CallSpendSnapshot = {
	readonly totalCost: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
};

export type UsageLike = {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly totalCost?: number;
};

function finiteOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Returns null when usage carries nothing measurable. */
export function foldUsageIntoSpend(
	prev: CallSpendSnapshot | null,
	usage: UsageLike | null | undefined,
): CallSpendSnapshot | null {
	if (!usage) {
		return prev;
	}
	const cost = finiteOrZero(usage.totalCost);
	const input = finiteOrZero(usage.inputTokens);
	const output = finiteOrZero(usage.outputTokens);
	if (cost <= 0 && input <= 0 && output <= 0) {
		return prev;
	}
	const base = prev ?? { totalCost: 0, inputTokens: 0, outputTokens: 0 };
	return {
		totalCost: base.totalCost + cost,
		inputTokens: base.inputTokens + input,
		outputTokens: base.outputTokens + output,
	};
}

export function formatCallSpend(spend: CallSpendSnapshot): string {
	const tokens = spend.inputTokens + spend.outputTokens;
	const tokenLabel =
		tokens >= 1000
			? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
			: String(tokens);
	if (spend.totalCost > 0) {
		const cost = new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: spend.totalCost < 0.01 ? 4 : 2,
			maximumFractionDigits: spend.totalCost < 0.01 ? 4 : 2,
		}).format(spend.totalCost);
		return tokens > 0 ? `${cost} · ${tokenLabel}` : cost;
	}
	return tokens > 0 ? `${tokenLabel} tok` : "";
}

export function hasCallSpend(spend: CallSpendSnapshot | null): boolean {
	return Boolean(spend && (spend.totalCost > 0 || spend.inputTokens + spend.outputTokens > 0));
}
