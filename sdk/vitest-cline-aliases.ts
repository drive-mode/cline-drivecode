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
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type ExportTarget = string | Record<string, unknown> | undefined;

const packagesDir = resolve(import.meta.dirname, "packages");

/** `./dist/hub/daemon/entry.js` -> `src/hub/daemon/entry` (no extension). */
function distToSource(target: string): string | null {
	if (!target.startsWith("./dist/")) {
		// Assets such as `./components.css` ship from the package root and
		// resolve without help. Aliasing them would break them.
		return null;
	}
	return target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, "");
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
			const source = distToSource(resolveTarget(value) ?? "");
			if (!source) continue;
			const specifier = subpath === "." ? name : `${name}/${subpath.slice(2)}`;
			aliases.push({
				find: new RegExp(
					`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
				),
				replacement: join(pkgRoot, source),
			});
		}
	}

	/**
	 * Longest specifier first: `@cline/core/hub/daemon-entry` must win over
	 * `@cline/core/hub`, and Vite takes the first alias whose pattern matches.
	 */
	return aliases.sort((a, b) => b.find.source.length - a.find.source.length);
}
