/**
 * Source aliases for `@cline/*` in test runs.
 *
 * Every package publishes only `dist/*` through its `exports` map, so a test
 * that imports a sibling by package name needs the SDK built first. That made
 * `build:sdk` — 24.6s cold, 94% of it `tsc` declaration emit — a prerequisite of
 * every test job, on work no test actually consumes.
 *
 * These aliases point the same specifiers at source instead, so test jobs skip
 * the build entirely. `apps/cli`, `apps/cline-hub` and `apps/drivecode-demo`
 * already did this by hand; this derives the same mapping from each package's
 * own `exports` map, so a new subpath is covered without editing a list here.
 *
 * Replacements are deliberately extensionless: Vite resolves `.ts`, `.tsx` and
 * `/index.*`, which a literal path could not do for `@cline/ui`'s `.tsx`
 * components and `@cline/shared`'s `index.browser.ts` alike.
 *
 * The source root is PROBED rather than assumed. Most packages compile `src/`
 * into `dist/`, but `@cline/ui` keeps `components/` at the package root, so
 * rewriting `./dist/components/index.js` to `src/components/index` would point
 * at nothing. An alias that resolves to a missing file is worse than no alias,
 * because it wins over the `exports` map and breaks a package that would
 * otherwise have loaded from `dist`.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type ExportTarget = string | Record<string, unknown> | undefined;

const packagesDir = resolve(import.meta.dirname, "packages");

/** Source roots to probe, in order. `""` covers `@cline/ui`'s root layout. */
const SOURCE_ROOTS = ["src", ""] as const;
/** Suffixes Vite would resolve for an extensionless specifier. */
const SOURCE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"] as const;

/**
 * `./dist/hub/daemon/entry.js` -> `<pkg>/src/hub/daemon/entry`, but only when a
 * real source file backs it. Returns null when nothing matches, leaving the
 * package's own `exports` map to resolve as it did before.
 */
function distToSource(pkgRoot: string, target: string): string | null {
	if (!target.startsWith("./dist/")) {
		// Assets such as `./components.css` ship from the package root and
		// resolve without help. Aliasing them would break them.
		return null;
	}
	const rest = target.replace(/^\.\/dist\//, "").replace(/\.js$/, "");
	for (const root of SOURCE_ROOTS) {
		const base = join(pkgRoot, root, rest);
		if (SOURCE_SUFFIXES.some((suffix) => existsSync(base + suffix))) {
			return base;
		}
	}
	return null;
}

function resolveTarget(value: ExportTarget): string | null {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return null;
	for (const key of ["import", "default", "browser"]) {
		const candidate = value[key];
		if (typeof candidate === "string") return candidate;
	}
	return null;
}

export function clineSourceAliases(): { find: RegExp; replacement: string }[] {
	const aliases: { find: RegExp; replacement: string }[] = [];

	for (const dir of readdirSync(packagesDir)) {
		const pkgRoot = join(packagesDir, dir);
		let manifest: { name?: string; exports?: Record<string, ExportTarget> };
		try {
			manifest = JSON.parse(
				readFileSync(join(pkgRoot, "package.json"), "utf8"),
			);
		} catch {
			continue;
		}
		const name = manifest.name;
		if (!name?.startsWith("@cline/")) continue;

		for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
			const source = distToSource(pkgRoot, resolveTarget(value) ?? "");
			if (!source) continue;
			const specifier = subpath === "." ? name : `${name}/${subpath.slice(2)}`;
			aliases.push({
				find: new RegExp(
					`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
				),
				// Already absolute — distToSource resolves against pkgRoot.
				replacement: source,
			});
		}
	}

	/**
	 * Longest specifier first: `@cline/core/hub/daemon-entry` must win over
	 * `@cline/core/hub`, and Vite takes the first alias whose pattern matches.
	 */
	return aliases.sort((a, b) => b.find.source.length - a.find.source.length);
}
