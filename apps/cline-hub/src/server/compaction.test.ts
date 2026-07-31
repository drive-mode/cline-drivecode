import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	readCompactionModeGlobally: vi.fn(),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		readCompactionModeGlobally: mocks.readCompactionModeGlobally,
	};
});

describe("buildHubCompactionConfig (SDK-6.2)", () => {
	it("defaults to enabled when mode is unset (CLI-ish)", async () => {
		const { buildHubCompactionConfig } = await import("./compaction");
		expect(buildHubCompactionConfig(undefined)).toEqual({ enabled: true });
	});

	it("maps off / basic / agentic modes", async () => {
		const { buildHubCompactionConfig } = await import("./compaction");
		expect(buildHubCompactionConfig("off")).toEqual({ enabled: false });
		expect(buildHubCompactionConfig("basic")).toEqual({
			enabled: true,
			strategy: "basic",
		});
		expect(buildHubCompactionConfig("agentic")).toEqual({
			enabled: true,
			strategy: "agentic",
		});
	});
});

describe("resolveHubSessionCompaction (SDK-6.2)", () => {
	beforeEach(() => {
		mocks.readCompactionModeGlobally.mockReset();
	});

	it("uses the global mode when persisted", async () => {
		mocks.readCompactionModeGlobally.mockReturnValue("basic");
		const { resolveHubSessionCompaction } = await import("./compaction");
		expect(resolveHubSessionCompaction()).toEqual({
			enabled: true,
			strategy: "basic",
		});
	});

	it("falls back to enabled when no global mode is set", async () => {
		mocks.readCompactionModeGlobally.mockReturnValue(undefined);
		const { resolveHubSessionCompaction } = await import("./compaction");
		expect(resolveHubSessionCompaction()).toEqual({ enabled: true });
	});
});
