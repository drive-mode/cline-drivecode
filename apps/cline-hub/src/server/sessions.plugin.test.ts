import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionStartInput } from "./sessions";

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

function makeFixturePluginRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "hub-session-plugin-"));
	const pluginDir = join(root, ".cline", "plugins", "demo");
	mkdirSync(pluginDir, { recursive: true });
	writeFileSync(
		join(pluginDir, "index.ts"),
		`export default { name: "demo", setup() {} }\n`,
		"utf8",
	);
	writeFileSync(
		join(pluginDir, "package.json"),
		JSON.stringify({
			name: "demo-plugin",
			type: "module",
			cline: {
				plugins: [{ paths: ["./index.ts"], capabilities: ["hooks"] }],
			},
		}),
		"utf8",
	);
	return root;
}

describe("buildSessionStartInput plugin injection (SDK-4.2)", () => {
	beforeEach(() => {
		mocks.readCompactionModeGlobally.mockReset();
		mocks.readCompactionModeGlobally.mockReturnValue(undefined);
	});

	it("sets pluginPaths: [] and workspace when no plugins are installed", () => {
		const root = mkdtempSync(join(tmpdir(), "hub-session-empty-"));
		mkdirSync(join(root, ".cline", "plugins"), { recursive: true });

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		expect(input.config.pluginPaths).toEqual([]);
		expect(input.config.extensionContext?.workspace).toMatchObject({
			rootPath: root,
			cwd: root,
			ide: "Cline Hub",
		});
	});

	it("applies PRODUCT_DEFAULT_MAX_ITERATIONS when options.maxIterations is unset (SDK-5.1)", async () => {
		const { PRODUCT_DEFAULT_MAX_ITERATIONS } = await import("@cline/core");
		const root = mkdtempSync(join(tmpdir(), "hub-session-budget-"));

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		expect(input.config.maxIterations).toBe(PRODUCT_DEFAULT_MAX_ITERATIONS);
		expect(input.sessionMetadata?.maxIterations).toBe(
			PRODUCT_DEFAULT_MAX_ITERATIONS,
		);
	});

	it("lets explicit options.maxIterations override the product default (SDK-5.1)", () => {
		const root = mkdtempSync(join(tmpdir(), "hub-session-budget-override-"));

		const input = buildSessionStartInput(
			{
				workspaceRoot: root,
				cwd: root,
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
			},
			{ maxIterations: 12 },
		);

		expect(input.config.maxIterations).toBe(12);
	});

	it("populates pluginPaths when a fixture plugin exists under .cline/plugins/", () => {
		const root = makeFixturePluginRoot();

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		expect(
			input.config.pluginPaths?.some((p) => p.endsWith("index.ts")),
		).toBe(true);
		expect(input.config.extensionContext?.workspace?.rootPath).toBe(root);
	});

	it("includes compaction on session start config (SDK-6.2)", () => {
		const root = mkdtempSync(join(tmpdir(), "hub-session-compaction-"));

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		// Default when global mode unset: CLI-ish { enabled: true }.
		expect(input.config.compaction).toEqual({ enabled: true });
	});

	it("honors global compaction mode on session start (SDK-6.2)", () => {
		mocks.readCompactionModeGlobally.mockReturnValue("off");
		const root = mkdtempSync(join(tmpdir(), "hub-session-compaction-off-"));

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		expect(input.config.compaction).toEqual({ enabled: false });
	});

	it("omits host AgentHooks — file hooks via Core bootstrap (SDK-6.3)", () => {
		const root = mkdtempSync(join(tmpdir(), "hub-session-hooks-"));

		const input = buildSessionStartInput({
			workspaceRoot: root,
			cwd: root,
			providerId: "anthropic",
			modelId: "claude-sonnet-4-5",
		});

		// Desktop parity: no host AgentHooks on session config. File-based
		// hooks under .clinerules/hooks are loaded by Core local-runtime-bootstrap
		// on the hub daemon for hub-backed sessions.
		expect(input.config.hooks).toBeUndefined();
	});
});
