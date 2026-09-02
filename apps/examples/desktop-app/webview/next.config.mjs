import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.join(__dirname, "../../../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "export",
	devIndicators: false,
	outputFileTracingRoot: workspaceRoot,
	turbopack: {
		root: workspaceRoot,
		// The webview tsconfig maps `@cline/*` at package *source* so `tsc` sees
		// live types, but the drive kernel's source uses `.js`-suffixed ESM
		// imports that Turbopack does not remap to `.ts`. Bundle the built
		// packages instead — the same `browser`-condition entries the hub's
		// Vite build consumes. Run `bun run build:sdk` after editing them.
		resolveAlias: {
			"@cline/drive": "../../../../sdk/packages/drive/dist/index.js",
			"@cline/shared": "../../../../sdk/packages/shared/dist/index.browser.js",
			// The kernel bundle's inlined `yaml` calls `createRequire` for
			// `process`/`buffer`; see the shim for why that is safe here.
			"node:module": { browser: "./lib/shims/node-module.ts" },
		},
	},
	// Dev-only: Next blocks HMR/font/dev-resource requests from origins that
	// don't match the dev server's own hostname. Both loopback spellings are
	// legitimate ways to reach a local or port-forwarded dev server.
	allowedDevOrigins: ["localhost", "127.0.0.1"],
	reactStrictMode: true,
	typescript: {
		ignoreBuildErrors: true,
	},
	images: {
		unoptimized: true,
	},
};

export default nextConfig;
