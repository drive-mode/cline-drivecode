import { afterEach, describe, expect, it, vi } from "vitest"
import { createVsCodeUsageBudgetAbortHandler, readVsCodeMaxSessionCostUsd } from "./usage-budget"

describe("readVsCodeMaxSessionCostUsd", () => {
	afterEach(() => {
		delete process.env.CLINE_MAX_SESSION_COST
	})

	it("prefers maxSessionCostUsd setting over env", () => {
		process.env.CLINE_MAX_SESSION_COST = "12.5"
		const stateManager = {
			getGlobalSettingsKey: (key: string) => (key === "maxSessionCostUsd" ? 3.25 : undefined),
		}
		expect(readVsCodeMaxSessionCostUsd(stateManager as never)).toBe(3.25)
	})

	it("falls back to CLINE_MAX_SESSION_COST when setting unset", () => {
		process.env.CLINE_MAX_SESSION_COST = "12.5"
		const stateManager = {
			getGlobalSettingsKey: () => undefined,
		}
		expect(readVsCodeMaxSessionCostUsd(stateManager as never)).toBe(12.5)
	})

	it("returns undefined when neither setting nor env is valid", () => {
		process.env.CLINE_MAX_SESSION_COST = "0"
		expect(readVsCodeMaxSessionCostUsd()).toBeUndefined()
	})
})

describe("createVsCodeUsageBudgetAbortHandler", () => {
	it("returns undefined when maxCostUsd is unset", () => {
		expect(
			createVsCodeUsageBudgetAbortHandler({
				maxCostUsd: undefined,
				abort: vi.fn(),
			}),
		).toBeUndefined()
	})

	it("aborts when usage exceeds maxCostUsd", () => {
		const abort = vi.fn()
		const handler = createVsCodeUsageBudgetAbortHandler({
			maxCostUsd: 1,
			abort,
		})
		expect(handler).toBeDefined()
		handler?.({ type: "usage", totalCost: 1.5 })
		expect(abort).toHaveBeenCalledTimes(1)
	})
})
