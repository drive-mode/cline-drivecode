/**
 * Browser stand-in for `node:module`.
 *
 * The built `@cline/drive` kernel is a node-target bundle whose inlined
 * `yaml` dependency asks `createRequire(import.meta.url)` for `process` and
 * `buffer` — lazily, only when YAML is actually parsed, which the webview
 * never does. Turbopack refuses any node builtin in a browser chunk, so this
 * module is aliased in `next.config.mjs` (browser condition only) and hands
 * back the two globals; anything else fails loudly rather than silently.
 */

type BrowserRequire = (id: string) => unknown;

export function createRequire(_from: string | URL): BrowserRequire {
	return (id: string): unknown => {
		switch (id) {
			case "process":
				return (globalThis as { process?: unknown }).process ?? { env: {} };
			case "buffer":
				return { Buffer: (globalThis as { Buffer?: unknown }).Buffer };
			default:
				throw new Error(`require("${id}") is not available in the webview.`);
		}
	};
}
