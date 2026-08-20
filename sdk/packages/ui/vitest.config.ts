import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { clineSourceAliases } from "../../vitest-cline-aliases.js";

export default defineConfig({
	// Resolve @cline/* to source so tests need no `build:sdk`.
	resolve: { alias: clineSourceAliases() },
	root: fileURLToPath(new URL(".", import.meta.url)),
	test: {
		environment: "node",
		include: ["tests/**/*.test.{ts,tsx}"],
	},
});
