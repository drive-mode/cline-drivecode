import { describe, expect, it } from "vitest";
import { foldUsageIntoSpend, formatCallSpend, hasCallSpend } from "./callSpend";

describe("foldUsageIntoSpend", () => {
	it("stays null when usage is empty", () => {
		expect(foldUsageIntoSpend(null, undefined)).toBeNull();
		expect(foldUsageIntoSpend(null, {})).toBeNull();
	});

	it("accumulates cost and tokens", () => {
		const first = foldUsageIntoSpend(null, {
			totalCost: 0.12,
			inputTokens: 100,
			outputTokens: 50,
		});
		expect(first).toEqual({
			totalCost: 0.12,
			inputTokens: 100,
			outputTokens: 50,
		});
		const second = foldUsageIntoSpend(first, {
			totalCost: 0.08,
			inputTokens: 20,
			outputTokens: 10,
		});
		expect(second).toEqual({
			totalCost: 0.2,
			inputTokens: 120,
			outputTokens: 60,
		});
	});
});

describe("formatCallSpend", () => {
	it("formats cost with compact tokens", () => {
		expect(
			formatCallSpend({
				totalCost: 1.42,
				inputTokens: 10000,
				outputTokens: 8000,
			}),
		).toMatch(/\$1\.42/);
		expect(
			formatCallSpend({
				totalCost: 0,
				inputTokens: 500,
				outputTokens: 0,
			}),
		).toBe("500 tok");
	});
});

describe("hasCallSpend", () => {
	it("is false for null/zero", () => {
		expect(hasCallSpend(null)).toBe(false);
		expect(
			hasCallSpend({ totalCost: 0, inputTokens: 0, outputTokens: 0 }),
		).toBe(false);
	});
});
