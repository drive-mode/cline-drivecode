import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { clineSourceAliases } from "../../sdk/vitest-cline-aliases.js";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: rootDir,
	resolve: {
		alias: [
			{
				find: /^@\/(.+)$/,
				replacement: resolve(rootDir, "src/webview/src/$1"),
			},
			{
				find: /^@cline\/core$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/index.ts"),
			},
			{
				find: /^@cline\/core\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/$1"),
			},
			{
				find: /^@cline\/shared$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/index.ts"),
			},
			{
				find: /^@cline\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/$1"),
			},
			{
				find: /^@cline\/drive$/,
				replacement: resolve(rootDir, "../../sdk/packages/drive/src/index.ts"),
			},
			{
				find: /^@cline\/drive\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/drive/src/$1"),
			},
			// Generated last so the hand-written entries above still win.
			// Covers @cline/* subpaths this list missed, e.g. @cline/llms.
			...clineSourceAliases(),
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
