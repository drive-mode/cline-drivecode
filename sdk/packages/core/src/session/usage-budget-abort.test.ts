import { describe, expect, it, vi } from "vitest";
import {
	createUsageBudgetAbortHandler,
	estimateUsageCost,
	evaluateUsageBudget,
	shouldAbortForUsageBudget,
	usageFromSessionEvent,
} from "./usage-budget-abort";

const pricing = { inputPerMillion: 3, outputPerMillion: 15 };

describe("estimateUsageCost", () => {
	it("prefers reported totalCost over pricing estimate", () => {
		expect(
			estimateUsageCost(
				{ inputTokens: 1_000_000, outputTokens: 1_000_000, totalCost: 0.42 },
				pricing,
			),
		).toBe(0.42);
	});

	it("estimates from tokens × pricing when totalCost is absent", () => {
		expect(
			estimateUsageCost({ inputTokens: 1_000_000, outputTokens: 100_000 }, pricing),
		).toBe(3 + 1.5);
	});

	it("uses legacy total* token fields when present", () => {
		expect(
			estimateUsageCost(
				{ totalInputTokens: 2_000_000, totalOutputTokens: 0 },
				pricing,
			),
		).toBe(6);
	});

	it("returns undefined without totalCost or pricing", () => {
		expect(
			estimateUsageCost({ inputTokens: 100, outputTokens: 100 }),
		).toBeUndefined();
	});
});

describe("evaluateUsageBudget / shouldAbortForUsageBudget", () => {
	it("does not abort when cost is at or under the budget", () => {
		expect(
			evaluateUsageBudget(
				{ totalCost: 1 },
				{ maxCostUsd: 1 },
			),
		).toEqual({ abort: false, cost: 1 });
		expect(shouldAbortForUsageBudget({ totalCost: 0.99 }, 1)).toBe(false);
	});

	it("aborts when cost exceeds the budget", () => {
		expect(
			evaluateUsageBudget(
				{ totalCost: 1.01 },
				{ maxCostUsd: 1 },
			),
		).toEqual({
			abort: true,
			cost: 1.01,
			reason: "Cost limit exceeded ($1.00)",
		});
		expect(shouldAbortForUsageBudget({ totalCost: 2 }, 1)).toBe(true);
	});

	it("uses custom abort reason when provided", () => {
		expect(
			evaluateUsageBudget(
				{ totalCost: 5 },
				{ maxCostUsd: 1, reason: "Budget exceeded" },
			).reason,
		).toBe("Budget exceeded");
	});

	it("ignores non-positive budgets", () => {
		expect(
			evaluateUsageBudget({ totalCost: 10 }, { maxCostUsd: 0 }),
		).toEqual({ abort: false });
		expect(
			evaluateUsageBudget({ totalCost: 10 }, { maxCostUsd: Number.NaN }),
		).toEqual({ abort: false });
	});

	it("does not abort when cost cannot be resolved", () => {
		expect(
			evaluateUsageBudget(
				{ inputTokens: 1_000_000 },
				{ maxCostUsd: 0.01 },
			),
		).toEqual({ abort: false });
	});

	it("estimates with pricing when totalCost is missing", () => {
		expect(
			shouldAbortForUsageBudget(
				{ inputTokens: 1_000_000, outputTokens: 0 },
				2,
				pricing,
			),
		).toBe(true);
	});
});

describe("usageFromSessionEvent", () => {
	it("reads usage-updated (runtime) events", () => {
		expect(
			usageFromSessionEvent({
				type: "usage-updated",
				usage: {
					inputTokens: 10,
					outputTokens: 20,
					totalCost: 0.05,
				},
			}),
		).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			totalCost: 0.05,
		});
	});

	it("reads legacy host usage events", () => {
		expect(
			usageFromSessionEvent({
				type: "usage",
				inputTokens: 1,
				outputTokens: 2,
				totalInputTokens: 100,
				totalOutputTokens: 50,
				totalCost: 0.1,
			}),
		).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			totalInputTokens: 100,
			totalOutputTokens: 50,
			totalCost: 0.1,
		});
	});

	it("returns undefined for unrelated events", () => {
		expect(usageFromSessionEvent({ type: "done" })).toBeUndefined();
		expect(usageFromSessionEvent(null)).toBeUndefined();
	});
});

describe("createUsageBudgetAbortHandler", () => {
	it("aborts once when a usage event exceeds the budget", () => {
		const abort = vi.fn();
		const handler = createUsageBudgetAbortHandler({
			maxCostUsd: 1,
			abort,
		});

		handler({ type: "iteration_start" });
		handler({ type: "usage", totalCost: 0.5 });
		expect(abort).not.toHaveBeenCalled();

		handler({ type: "usage", totalCost: 1.5 });
		handler({ type: "usage", totalCost: 2 });
		expect(abort).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledWith("Cost limit exceeded ($1.00)");
	});

	it("handles usage-updated events", () => {
		const abort = vi.fn();
		const handler = createUsageBudgetAbortHandler({
			maxCostUsd: 0.5,
			abort,
			reason: "stop",
		});
		handler({
			type: "usage-updated",
			usage: { inputTokens: 0, outputTokens: 0, totalCost: 0.9 },
		});
		expect(abort).toHaveBeenCalledWith("stop");
	});
});
