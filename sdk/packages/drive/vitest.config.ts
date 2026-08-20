import { defineConfig } from "vitest/config";
import { clineSourceAliases } from "../../vitest-cline-aliases.js";

export default defineConfig({
	// Resolve @cline/* to source so tests need no `build:sdk`.
	resolve: { alias: clineSourceAliases() },
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
