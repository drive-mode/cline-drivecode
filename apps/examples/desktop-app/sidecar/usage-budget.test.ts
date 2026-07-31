import { describe, expect, it, vi } from "vitest";
import {
	createDesktopUsageBudgetAbortHandler,
	readDesktopMaxSessionCostUsd,
} from "./usage-budget";

describe("readDesktopMaxSessionCostUsd", () => {
	it("returns undefined when unset or invalid", () => {
		expect(readDesktopMaxSessionCostUsd({})).toBeUndefined();
		expect(
			readDesktopMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "" }),
		).toBeUndefined();
		expect(
			readDesktopMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "0" }),
		).toBeUndefined();
		expect(
			readDesktopMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "nope" }),
		).toBeUndefined();
	});

	it("parses a positive USD budget", () => {
		expect(
			readDesktopMaxSessionCostUsd({ CLINE_MAX_SESSION_COST: "1.25" }),
		).toBe(1.25);
	});
});

describe("createDesktopUsageBudgetAbortHandler", () => {
	it("returns undefined when no budget is configured", () => {
		expect(
			createDesktopUsageBudgetAbortHandler({
				maxCostUsd: undefined,
				abort: () => {},
			}),
		).toBeUndefined();
	});

	it("aborts when usage exceeds the configured budget", () => {
		const abort = vi.fn();
		const handler = createDesktopUsageBudgetAbortHandler({
			maxCostUsd: 1,
			abort,
		});
		expect(handler).toBeDefined();
		handler?.({ type: "usage", totalCost: 1.5 });
		expect(abort).toHaveBeenCalledTimes(1);
	});
});
