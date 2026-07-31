import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_CONFIG } from "./constants";
import { normalizeRuntimeConfig } from "./helpers";

describe("normalizeRuntimeConfig", () => {
	it("does not force spawn/teams off (D1 defers to sidecar defaults)", () => {
		const normalized = normalizeRuntimeConfig({
			...DEFAULT_CHAT_CONFIG,
			workspaceRoot: "/tmp/proj",
			cwd: "/tmp/proj",
		});
		expect(normalized.enableSpawn).toBeUndefined();
		expect(normalized.enableTeams).toBeUndefined();
	});

	it("preserves explicit spawn/teams overrides", () => {
		const normalized = normalizeRuntimeConfig({
			...DEFAULT_CHAT_CONFIG,
			workspaceRoot: "/tmp/proj",
			enableSpawn: true,
			enableTeams: false,
		});
		expect(normalized.enableSpawn).toBe(true);
		expect(normalized.enableTeams).toBe(false);
	});
});
