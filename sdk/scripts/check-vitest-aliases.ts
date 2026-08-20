/**
 * Assert the generated `@cline/*` test aliases still cover every package.
 *
 * Two failure modes, and the second is the one that bites. A Vite alias
 * outranks the package `exports` map, so an alias pointing at a missing file
 * stops the package resolving even when `dist` is built. The generator avoids
 * that by probing the filesystem — but its fallback is to emit NOTHING, which
 * silently returns a package to needing `build:sdk` and shows up only as a slow
 * job much later.
 *
 * So this checks coverage, not just validity: every `@cline/*` package that
 * publishes a main entry from `dist/` must get an alias for it. `@cline/ui`
 * keeps its source in `components/` rather than `src/`, which is exactly the
 * layout difference that made the first version of the generator wrong.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { clineSourceAliases } from "../vitest-cline-aliases.js";

/** Suffixes Vite resolves for an extensionless specifier. */
const SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

const packagesDir = resolve(import.meta.dirname, "../packages");
const aliases = clineSourceAliases();

function fail(message: string): never {
	console.error(`vitest aliases: ${message}`);
	process.exit(1);
}

if (aliases.length === 0) {
	fail("none generated — the exports maps or package layout moved");
}

/** 1. Nothing may point at a file that does not exist. */
const missing = aliases
	.filter(
		({ replacement }) => !SUFFIXES.some((s) => existsSync(replacement + s)),
	)
	.map(({ replacement }) => replacement);
if (missing.length > 0) {
	fail(
		`alias(es) point at missing source:\n${missing.map((m) => `  ${m}`).join("\n")}`,
	);
}

/** 2. Every package publishing a `dist/` main entry must be covered. */
const uncovered: string[] = [];
for (const dir of readdirSync(packagesDir)) {
	let manifest: { name?: string; exports?: Record<string, unknown> };
	try {
		manifest = JSON.parse(
			readFileSync(join(packagesDir, dir, "package.json"), "utf8"),
		);
	} catch {
		continue;
	}
	const name = manifest.name;
	if (!name?.startsWith("@cline/")) continue;

	const main = manifest.exports?.["."];
	const target =
		typeof main === "string"
			? main
			: ((main as Record<string, string> | undefined)?.import ??
				(main as Record<string, string> | undefined)?.default);
	if (!target?.startsWith("./dist/")) continue;

	if (!aliases.some(({ find }) => find.test(name))) {
		uncovered.push(name);
	}
}

if (uncovered.length > 0) {
	fail(
		`no source alias generated for: ${uncovered.join(", ")}. ` +
			"The package's source layout probably moved — add its root to " +
			"SOURCE_ROOTS in sdk/vitest-cline-aliases.ts, or these tests silently " +
			"go back to requiring `build:sdk`.",
	);
}

console.log(
	`vitest aliases OK — ${aliases.length} resolve to source, every package covered`,
);
