import { describe, expect, it, vi } from "vitest";
import {
	createCliUsageBudgetAbortHandler,
	readCliMaxSessionCostUsd,
} from "./usage-budget";

describe("readCliMaxSessionCostUsd", () => {
	it("returns undefined when unset or invalid", () => {
		expect(readCliMaxSessionCostUsd({})).toBeUndefined();
		expect(
			readCliMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "" }),
		).toBeUndefined();
		expect(
			readCliMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "0" }),
		).toBeUndefined();
		expect(
			readCliMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "nope" }),
		).toBeUndefined();
	});

	it("parses a positive USD budget", () => {
		expect(readCliMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "1.25" })).toBe(
			1.25,
		);
	});
});

describe("createCliUsageBudgetAbortHandler", () => {
	it("returns undefined when no budget is configured", () => {
		expect(
			createCliUsageBudgetAbortHandler({
				maxCostUsd: undefined,
				abort: () => {},
			}),
		).toBeUndefined();
	});

	it("aborts when usage exceeds the configured budget", () => {
		const abort = vi.fn();
		const handler = createCliUsageBudgetAbortHandler({
			maxCostUsd: 1,
			abort,
		});
		expect(handler).toBeDefined();
		handler?.({ type: "usage", totalCost: 1.5 });
		expect(abort).toHaveBeenCalledTimes(1);
	});
});
