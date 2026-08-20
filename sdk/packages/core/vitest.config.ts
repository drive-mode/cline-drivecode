import { defineConfig } from "vitest/config";
import { clineSourceAliases } from "../../vitest-cline-aliases.js";

export default defineConfig({
	// Resolve @cline/* to source so tests need no `build:sdk`.
	resolve: { alias: clineSourceAliases() },
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
		// Process, Git, and SQLite integration coverage shares this suite with
		// pure unit tests. Windows hosted runners regularly exceed Vitest's 5s
		// default while starting those processes, so retain a bounded but realistic
		// budget and reduce Windows CI contention.
		testTimeout: 10_000,
		hookTimeout: 15_000,
		pool: "forks",
		...(process.env.CI && process.platform === "win32"
			? { maxWorkers: 2 }
			: {}),
	},
});
