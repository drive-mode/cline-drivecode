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
try {
	execFileSync(
		"bun",
		[join(repoRoot, "sdk/scripts/build-drive-kernel-bundle.ts")],
		{
			cwd: repoRoot,
			stdio: "pipe",
		},
	);
} catch (error) {
	// The generator enforces the closure's own invariants (undeclared imports,
	// unresolvable specifiers, a failing compile). Surface what it said rather
	// than a stack trace pointing at this line.
	//
	// BOTH streams, deliberately: the generator compiles with `tsc`, which
	// writes its diagnostics to STDOUT. Printing only stderr reduced a real
	// compile failure — the thing this guard exists to catch — to a spawn stack
	// carrying no diagnostics at all.
	const spawned = error as { stdout?: Buffer; stderr?: Buffer };
	const streams = [spawned.stdout, spawned.stderr]
		.map((buffer) => buffer?.toString().trim())
		.filter((text): text is string => Boolean(text))
		.join("\n");
	fail(`generator failed —\n${streams || String(error)}`);
}

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
) as {
	name: string;
	version: string;
	main?: string;
	types?: string;
	exports?: Record<string, Record<string, string>>;
	dependencies: Record<string, string>;
};

/**
 * The distribution owns its version (`sdk/drive-kernel.version.json`) rather
 * than inheriting `@cline/drive`'s. That inheritance was a footgun: SDK
 * releases rewrite every `sdk/packages/*` version at once, so a kernel change
 * between releases regenerated at a version already on the registry and the
 * publish workflow skipped it — succeeding while shipping nothing. Assert the
 * wiring here so re-pointing `version` at any other manifest fails on the PR.
 */
const declaredVersion = (
	JSON.parse(
		readFileSync(join(repoRoot, "sdk/drive-kernel.version.json"), "utf8"),
	) as { version?: unknown }
).version;
if (typeof declaredVersion !== "string") {
	fail("sdk/drive-kernel.version.json carries no `version` string");
}
if (manifest.version !== declaredVersion) {
	fail(
		`emitted version ${manifest.version} does not match sdk/drive-kernel.version.json (${declaredVersion}). ` +
			"The generator must read that file — do not inherit a version from another package.",
	);
}

/**
 * Every entrypoint the manifest advertises must exist. Bun resolves the `src`
 * condition, so a missing `dist` leaves the package working for the one
 * consumer it is not aimed at while Node and TypeScript — the consumers it
 * exists for — get a missing entrypoint.
 */
const entryPoints = [
	manifest.main,
	manifest.types,
	...Object.values(manifest.exports?.["."] ?? {}),
].filter((p): p is string => typeof p === "string");

const absentEntries = [...new Set(entryPoints)].filter(
	(p) => !existsSync(join(bundleRoot, p)),
);
if (absentEntries.length > 0) {
	fail(
		`manifest advertises entrypoints the build did not emit: ${absentEntries.join(", ")}. ` +
			"Run the generator, which compiles `dist` — do not hand-edit the manifest.",
	);
}

/**
 * Load the COMPILED output the way an outside consumer would. Typechecking
 * proves the sources are sound; only an actual Node `import` proves the
 * emitted JavaScript resolves, which is where extensionless specifiers from
 * the bundler-built monorepo would surface.
 */
const built = (await import(join(bundleRoot, "dist/index.js"))) as Record<
	string,
	unknown
>;
const unloadable = declared.filter(
	(symbol) =>
		!source.includes(`\ttype ${symbol},`) && built[symbol] === undefined,
);
if (unloadable.length > 0) {
	fail(
		`compiled dist does not export: ${unloadable.join(", ")}. ` +
			"The distribution is not loadable as packaged.",
	);
}

const deps = Object.keys(manifest.dependencies);
if (deps.length !== 1 || deps[0] !== "zod") {
	fail(
		`expected zod as the only runtime dependency, found: ${deps.join(", ") || "none"}. ` +
			"A new runtime dependency makes the distribution harder to adopt — " +
			"keep it out of the kernel closure.",
	);
}

// The undeclared-dependency scan runs inside the generator, which this script
// re-invokes above — it must fail before `tsc`, whose module-not-found errors
// bury the cause.

if (manifest.name.startsWith("@cline/")) {
	fail("distribution must not publish under the upstream @cline/* scope");
}

console.log(
	`drive-kernel bundle OK — v${manifest.version}, ${declared.length} declared exports, ` +
		`compiled dist loads under Node, runtime deps: ${deps.join(", ")}`,
);
