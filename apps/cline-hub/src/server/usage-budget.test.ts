import { describe, expect, it, vi } from "vitest";
import {
	createHubUsageBudgetAbortHandler,
	readHubMaxSessionCostUsd,
} from "./usage-budget";

describe("readHubMaxSessionCostUsd", () => {
	it("returns undefined when unset or invalid", () => {
		expect(readHubMaxSessionCostUsd({})).toBeUndefined();
		expect(
			readHubMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "" }),
		).toBeUndefined();
		expect(
			readHubMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "0" }),
		).toBeUndefined();
		expect(
			readHubMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "nope" }),
		).toBeUndefined();
	});

	it("parses a positive USD budget", () => {
		expect(readHubMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "1.25" })).toBe(
			1.25,
		);
	});
});

describe("createHubUsageBudgetAbortHandler", () => {
	it("returns undefined when no budget is configured", () => {
		expect(
			createHubUsageBudgetAbortHandler({
				maxCostUsd: undefined,
				abort: () => {},
			}),
		).toBeUndefined();
	});

	it("aborts when usage exceeds the configured budget", () => {
		const abort = vi.fn();
		const handler = createHubUsageBudgetAbortHandler({
			maxCostUsd: 1,
			abort,
		});
		expect(handler).toBeDefined();
		handler?.({ type: "usage", totalCost: 1.5 });
		expect(abort).toHaveBeenCalledTimes(1);
	});
});
