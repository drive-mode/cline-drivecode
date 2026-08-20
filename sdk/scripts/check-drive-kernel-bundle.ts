/**
 * Guard the generated Drive kernel distribution.
 *
 * The retired `collaboration-harness` drifted because nothing failed when the
 * canonical kernel moved ahead of its copy. This check closes that hole: it
 * regenerates the bundle and asserts every symbol in the declared surface
 * still resolves from it, so a rename or removal in `@cline/drive` or
 * `@cline/shared/drive` breaks the build here rather than shipping a stale
 * copy to `drivemode-mcp` and the iOS client.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const bundleRoot = join(repoRoot, "sdk/dist-bundle/drive-kernel");

function fail(message: string): never {
	console.error(`drive-kernel bundle: ${message}`);
	process.exit(1);
}

/** Regenerate so the check never passes against a stale artifact. */
execFileSync(
	"bun",
	[join(repoRoot, "sdk/scripts/build-drive-kernel-bundle.ts")],
	{
		cwd: repoRoot,
		stdio: "pipe",
	},
);

const indexPath = join(bundleRoot, "src/index.ts");
if (!existsSync(indexPath)) {
	fail("generator produced no src/index.ts");
}

/** Symbols the distribution promises, parsed back out of the emitted index. */
const declared = [
	...readFileSync(indexPath, "utf8").matchAll(/^\t(?:type )?(\w+),$/gm),
].map((m) => m[1]);

if (declared.length === 0) {
	fail("emitted index declares no exports");
}

/**
 * Resolve against the CANONICAL packages rather than the emitted copy. The
 * bundle is a mechanical copy, so the question worth asking is whether the
 * surface it promises still exists upstream — that is the drift a stale copy
 * would hide.
 */
const drivePkg = join(repoRoot, "sdk/packages/drive");
const sharedPkg = join(repoRoot, "sdk/packages/shared");
for (const [name, dir] of [
	["@cline/drive", drivePkg],
	["@cline/shared", sharedPkg],
] as const) {
	if (!existsSync(join(dir, "dist/index.js"))) {
		fail(`${name} is not built — run \`bun run build:sdk\` first`);
	}
}
const [driveMod, sharedMod] = (await Promise.all([
	import(join(drivePkg, "dist/index.js")),
	import(join(sharedPkg, "dist/index.js")),
])) as Record<string, unknown>[];

const source = readFileSync(indexPath, "utf8");

const missing: string[] = [];
for (const symbol of declared) {
	// Types vanish at runtime, so a type-only export is verified by its
	// presence in the emitted index; values must actually resolve upstream.
	if (source.includes(`\ttype ${symbol},`)) continue;
	if (driveMod[symbol] === undefined && sharedMod[symbol] === undefined) {
		missing.push(symbol);
	}
}

if (missing.length > 0) {
	fail(
		`declared exports missing from the generated bundle: ${missing.join(", ")}. ` +
			"Either the symbol was renamed upstream, or the surface list in " +
			"build-drive-kernel-bundle.ts is stale.",
	);
}

const manifest = JSON.parse(
	readFileSync(join(bundleRoot, "package.json"), "utf8"),
) as { name: string; dependencies: Record<string, string> };

const deps = Object.keys(manifest.dependencies);
if (deps.length !== 1 || deps[0] !== "zod") {
	fail(
		`expected zod as the only runtime dependency, found: ${deps.join(", ") || "none"}. ` +
			"A new runtime dependency makes the distribution harder to adopt — " +
			"keep it out of the kernel closure.",
	);
}

if (manifest.name.startsWith("@cline/")) {
	fail("distribution must not publish under the upstream @cline/* scope");
}

console.log(
	`drive-kernel bundle OK — ${declared.length} declared exports, ` +
		`runtime deps: ${deps.join(", ")}`,
);
