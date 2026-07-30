import { describe, expect, it } from "vitest";
import {
	PRODUCT_DEFAULT_MAX_ITERATIONS,
	resolveProductSessionFeatures,
} from "./product-session-defaults";

describe("resolveProductSessionFeatures", () => {
	it("uses D1 product defaults when no special-case is set", () => {
		expect(resolveProductSessionFeatures()).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
		expect(resolveProductSessionFeatures({ host: "cli" })).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
		expect(resolveProductSessionFeatures({ host: "hub" })).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
		expect(resolveProductSessionFeatures({ host: "desktop" })).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
		expect(resolveProductSessionFeatures({ host: "vscode" })).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
	});

	it("disables spawn and teams in yolo mode", () => {
		expect(resolveProductSessionFeatures({ yolo: true })).toEqual({
			enableSpawnAgent: false,
			enableAgentTeams: false,
		});
		expect(
			resolveProductSessionFeatures({ yolo: true, host: "cli" }),
		).toEqual({
			enableSpawnAgent: false,
			enableAgentTeams: false,
		});
	});

	it("uses ACP special-case: spawn on, teams off", () => {
		expect(resolveProductSessionFeatures({ host: "acp" })).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: false,
		});
	});

	it("lets explicit overrides win over yolo and host defaults", () => {
		expect(
			resolveProductSessionFeatures({
				yolo: true,
				enableSpawnAgent: true,
				enableAgentTeams: true,
			}),
		).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
		expect(
			resolveProductSessionFeatures({
				host: "acp",
				enableAgentTeams: true,
			}),
		).toEqual({
			enableSpawnAgent: true,
			enableAgentTeams: true,
		});
		expect(
			resolveProductSessionFeatures({
				host: "cli",
				enableSpawnAgent: false,
			}),
		).toEqual({
			enableSpawnAgent: false,
			enableAgentTeams: true,
		});
	});

	it("omits maxIterations unless opted in or explicitly set", () => {
		expect(resolveProductSessionFeatures().maxIterations).toBeUndefined();
		expect(
			resolveProductSessionFeatures({
				applyDefaultMaxIterations: true,
			}).maxIterations,
		).toBe(PRODUCT_DEFAULT_MAX_ITERATIONS);
		expect(
			resolveProductSessionFeatures({
				maxIterations: 12,
				applyDefaultMaxIterations: true,
			}).maxIterations,
		).toBe(12);
		expect(
			resolveProductSessionFeatures({ maxIterations: 0 }).maxIterations,
		).toBeUndefined();
		expect(
			resolveProductSessionFeatures({ maxIterations: 3.9 }).maxIterations,
		).toBe(3);
	});
});
