/**
 * Generate the standalone Drive kernel distribution.
 *
 * `@cline/drive` is the canonical kernel, but it lives in this monorepo and
 * type-imports `@cline/shared`, so an outside consumer cannot depend on it
 * directly. This script emits a self-contained package — the Drive protocol
 * schemas plus the room kernel — whose only runtime dependency is `zod`.
 *
 * The output is GENERATED. Nothing here is hand-edited: a divergence between
 * this bundle and the canonical kernel is a bug in the generator, not a patch
 * target. `check-drive-kernel-bundle.ts` asserts the declared surface still
 * resolves, so a rename in `@cline/drive` fails the build rather than silently
 * shipping a stale copy — which is precisely how the retired
 * `collaboration-harness` drifted behind.
 */

import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const sharedDrive = join(repoRoot, "sdk/packages/shared/src/drive");
const driveSrc = join(repoRoot, "sdk/packages/drive/src");
const outRoot = join(repoRoot, "sdk/dist-bundle/drive-kernel");

/** Package name. The `@cline/*` scope belongs to upstream, not to us. */
const PACKAGE_NAME = "@drive-mode/drive-kernel";

/**
 * Kernel entry modules. The distribution carries the transitive closure of
 * these and nothing else, so it is an API rather than a mirror of the internal
 * tree — `home/` (the only module needing `yaml`) and the Status changelog
 * helper fall out naturally instead of being excluded by name.
 */
const KERNEL_ENTRIES = [
	"reduceRoom.ts",
	"narrationPolicy.ts",
	"interruptPolicy.ts",
];

/**
 * The published surface, declared once. Everything else is generated, so this
 * list is the only thing a human reviews when the distribution changes.
 */
const SURFACE = {
	protocol: [
		"type AddressSet",
		"type AgentRuntimeBadge",
		"AgentRuntimeBadgeSchema",
		"type AgentTitleGrant",
		"AgentTitleGrantSchema",
		"type DriveEvent",
		"DriveEventSchema",
		"type DriveLogEnvelope",
		"DriveLogEnvelopeSchema",
		"type DriveSubMode",
		"type Participant",
		"parseDriveLogEnvelope",
		"type RoomSnapshot",
		"type StageSharer",
	],
	kernel: [
		"allowNarrationByRate",
		"classifyInterrupt",
		"createEmptyRoomSnapshot",
		"isTitleGrantActive",
		"narrate",
		"projectRoster",
		"projectStage",
		"reduceRoom",
	],
} as const;

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...listTsFiles(full));
			continue;
		}
		if (!entry.endsWith(".ts")) continue;
		if (entry.endsWith(".test.ts")) continue;
		out.push(full);
	}
	return out;
}

/**
 * Transitive closure of relative imports from the kernel entry modules.
 * `@cline/shared` imports are not followed — they resolve to the copied
 * protocol tree, which is included whole.
 */
function kernelClosure(): string[] {
	const seen = new Set<string>();
	const queue = KERNEL_ENTRIES.map((e) => join(driveSrc, e));
	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || seen.has(file)) continue;
		seen.add(file);
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(/from\s+"(\.[^"]*)"/g)) {
			const spec = match[1].replace(/\.js$/, "");
			const base = resolve(dirname(file), spec);
			const candidates = [`${base}.ts`, join(base, "index.ts")];
			for (const candidate of candidates) {
				try {
					if (statSync(candidate).isFile()) {
						queue.push(candidate);
						break;
					}
				} catch {
					// not this candidate
				}
			}
		}
	}
	return [...seen].sort();
}

/**
 * Rewrite `@cline/shared` to the copied protocol tree. Depth-aware: a kernel
 * file nested two directories down needs `../../protocol/index.js`.
 */
function rewriteSharedImports(source: string, outFile: string): string {
	const fromDir = dirname(outFile);
	const target = join(outRoot, "src/protocol/index.js");
	let rel = relative(fromDir, target).split("\\").join("/");
	if (!rel.startsWith(".")) rel = `./${rel}`;
	return source.replaceAll('"@cline/shared"', `"${rel}"`);
}

/**
 * Give every relative specifier an explicit `.js` extension.
 *
 * The monorepo compiles through a bundler, so its sources import
 * extensionless (`from "./room"`). Node's ESM resolver does no extension
 * search, so copying those verbatim yields a `dist` that typechecks and still
 * throws ERR_MODULE_NOT_FOUND on `import` — the distribution would be loadable
 * only under Bun, which is the one consumer it is not for. Specifiers are
 * resolved against the SOURCE tree, which is complete, so a directory import
 * becomes `/index.js`.
 */
function addJsExtensions(source: string, srcFile: string): string {
	return source.replace(
		/(from\s+")(\.[^"]*)(")/g,
		(whole: string, prefix: string, spec: string, suffix: string) => {
			if (spec.endsWith(".js")) {
				return whole;
			}
			const base = resolve(dirname(srcFile), spec);
			if (existsSync(`${base}.ts`)) {
				return `${prefix}${spec}.js${suffix}`;
			}
			if (existsSync(join(base, "index.ts"))) {
				return `${prefix}${spec}/index.js${suffix}`;
			}
			throw new Error(
				`cannot resolve "${spec}" from ${relative(repoRoot, srcFile)} — ` +
					"the kernel closure is incomplete or the source moved",
			);
		},
	);
}

function copyTree(
	from: string,
	toSubdir: string,
	rewriteShared: boolean,
	explicit?: string[],
): number {
	const files = explicit ?? listTsFiles(from);
	for (const file of files) {
		const outFile = join(outRoot, "src", toSubdir, relative(from, file));
		mkdirSync(dirname(outFile), { recursive: true });
		let source = readFileSync(file, "utf8");
		if (rewriteShared) {
			// Runs first: it emits `../protocol/index.js`, already extended.
			source = rewriteSharedImports(source, outFile);
		}
		writeFileSync(outFile, addJsExtensions(source, file));
	}
	return files.length;
}

function renderIndex(): string {
	const protocol = SURFACE.protocol.map((s) => `\t${s},`).join("\n");
	const kernel = SURFACE.kernel.map((s) => `\t${s},`).join("\n");
	return `/**
 * ${PACKAGE_NAME} — generated distribution of the Drive room kernel.
 *
 * GENERATED FILE. Do not edit. Regenerate with:
 *   bun sdk/scripts/build-drive-kernel-bundle.ts
 *
 * Source of truth: @cline/drive and @cline/shared/drive in
 * drive-mode/cline-drivecode. Edit there, then regenerate.
 */

export {
${protocol}
} from "./protocol/index.js";
export {
${kernel}
} from "./kernel/index.js";
`;
}

/** A kernel barrel limited to the distribution's surface. */
function renderKernelIndex(): string {
	return `/** GENERATED. Kernel surface for ${PACKAGE_NAME}. */

export { classifyInterrupt } from "./interruptPolicy.js";
export { allowNarrationByRate, narrate } from "./narrationPolicy.js";
export {
	createEmptyRoomSnapshot,
	isTitleGrantActive,
	projectRoster,
	projectStage,
	reduceRoom,
} from "./reduceRoom.js";
`;
}

/**
 * Refuse to emit a bundle whose closure reaches a package we do not declare.
 *
 * The manifest's dependency list is written by this script, so checking it
 * against itself proves nothing — the question is what the copied sources
 * actually import. Runs before `tsc`, whose module-not-found errors would
 * bury the cause under the rest of the type graph collapsing.
 */
function assertDeclaredDepsOnly(): void {
	const imported = new Set<string>();
	for (const file of listTsFiles(join(outRoot, "src"))) {
		for (const match of readFileSync(file, "utf8").matchAll(
			/from\s+"([^."][^"]*)"/g,
		)) {
			imported.add(match[1]);
		}
	}
	const undeclared = [...imported].filter(
		(spec) => spec !== "zod" && !spec.startsWith("node:"),
	);
	if (undeclared.length > 0) {
		throw new Error(
			`kernel closure imports undeclared packages: ${undeclared.join(", ")}. ` +
				"Either drop the module from the closure or declare the dependency — " +
				"a second runtime dependency makes the distribution harder to adopt.",
		);
	}
}

/** Locate an installed package. Bun hoists unevenly across the workspace. */
function findModule(spec: string): string {
	const candidates = [
		join(repoRoot, "node_modules", spec),
		join(repoRoot, "sdk/node_modules", spec),
		join(repoRoot, "sdk/packages/shared/node_modules", spec),
		join(repoRoot, "sdk/packages/drive/node_modules", spec),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error(`cannot locate ${spec} — run \`bun install\` first`);
}

/**
 * Compile the distribution.
 *
 * `main`, `types` and the `import`/`default` conditions all point at `dist/`,
 * so shipping without it leaves a manifest promising entrypoints that are not
 * there: only Bun's `src` condition resolves, and every Node or TypeScript
 * consumer — the ones this package exists for — gets a missing entrypoint.
 * Building here means the generator cannot emit that manifest without also
 * making it true.
 */
function buildBundle(): void {
	// `@types/node` would resolve by walking up to the repo root, but zod sits
	// under `@cline/shared`, off that path. Link both so the tsconfig we ship
	// is the same one we compile with, rather than a build-only variant.
	const modules = join(outRoot, "node_modules");
	mkdirSync(join(modules, "@types"), { recursive: true });
	symlinkSync(findModule("zod"), join(modules, "zod"), "dir");
	symlinkSync(findModule("@types/node"), join(modules, "@types/node"), "dir");

	execFileSync(
		join(repoRoot, "node_modules/.bin/tsc"),
		["-p", "tsconfig.json"],
		{ cwd: outRoot, stdio: "inherit" },
	);
}

function sourceCommit(): string {
	try {
		return execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repoRoot,
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
}

function main(): void {
	rmSync(outRoot, { recursive: true, force: true });
	mkdirSync(join(outRoot, "src"), { recursive: true });

	const protocolCount = copyTree(sharedDrive, "protocol", false);
	const kernelCount = copyTree(driveSrc, "kernel", true, kernelClosure());

	writeFileSync(join(outRoot, "src/index.ts"), renderIndex());
	writeFileSync(join(outRoot, "src/kernel/index.ts"), renderKernelIndex());

	assertDeclaredDepsOnly();

	const driveManifest = JSON.parse(
		readFileSync(join(repoRoot, "sdk/packages/drive/package.json"), "utf8"),
	) as { version: string; dependencies?: Record<string, string> };
	const sharedManifest = JSON.parse(
		readFileSync(join(repoRoot, "sdk/packages/shared/package.json"), "utf8"),
	) as { dependencies?: Record<string, string> };
	const zod = sharedManifest.dependencies?.zod;
	if (!zod) {
		throw new Error(
			"@cline/shared no longer declares zod — bundle deps are stale",
		);
	}

	writeFileSync(
		join(outRoot, "package.json"),
		`${JSON.stringify(
			{
				name: PACKAGE_NAME,
				version: driveManifest.version,
				description:
					"Generated distribution of the Drive room kernel and protocol schemas.",
				license: "Apache-2.0",
				// Links the registry entry back to the generator on GitHub
				// Packages, so a published copy carries its provenance rather
				// than standing alone the way the retired harness did.
				repository: {
					type: "git",
					url: "git+https://github.com/drive-mode/cline-drivecode.git",
					directory: "sdk/dist-bundle/drive-kernel",
				},
				publishConfig: { registry: "https://npm.pkg.github.com" },
				type: "module",
				types: "./dist/index.d.ts",
				main: "./dist/index.js",
				exports: {
					".": {
						bun: "./src/index.ts",
						types: "./dist/index.d.ts",
						import: "./dist/index.js",
						default: "./dist/index.js",
					},
				},
				// `tsconfig.json` ships so `build` is runnable from the tarball.
				files: ["dist", "src", "tsconfig.json"],
				scripts: { build: "tsc -p tsconfig.json" },
				dependencies: { zod },
				/**
				 * `protocol/paths.ts` uses the `node:path` builtin, so the
				 * distribution targets Node/Bun rather than the browser. Declared
				 * rather than hidden — a consumer should know before adopting it.
				 */
				devDependencies: { "@types/node": "^22.0.0", typescript: "^5.6.0" },
				engines: { node: ">=22" },
				driveKernel: {
					generated: true,
					sourceRepo: "drive-mode/cline-drivecode",
					sourceCommit: sourceCommit(),
				},
			},
			null,
			"\t",
		)}\n`,
	);

	writeFileSync(
		join(outRoot, "README.md"),
		`# ${PACKAGE_NAME}

**Generated — do not edit.** This package is emitted from
[\`drive-mode/cline-drivecode\`](https://github.com/drive-mode/cline-drivecode)
by \`sdk/scripts/build-drive-kernel-bundle.ts\`.

It carries the Drive protocol schemas and the room kernel — \`reduceRoom\` and its
projections, narration and interrupt policy — with \`zod\` as its only runtime
dependency, so a consumer can adopt the room contract without depending on the
Cline monorepo.

Fix bugs in \`@cline/drive\` or \`@cline/shared/drive\` upstream and regenerate.
A patch applied here is lost on the next build, and a copy that diverges from
the canonical kernel is exactly the failure this package replaced.

Source commit: \`${sourceCommit()}\`
`,
	);

	writeFileSync(
		join(outRoot, "tsconfig.json"),
		`${JSON.stringify(
			{
				compilerOptions: {
					target: "ES2022",
					/**
					 * NodeNext, not bundler: it makes tsc reject any relative
					 * import without an extension, so the emitted `dist` is
					 * checked to be Node-loadable at build time instead of
					 * failing at a consumer's first `import`.
					 */
					module: "NodeNext",
					moduleResolution: "NodeNext",
					strict: true,
					declaration: true,
					outDir: "dist",
					skipLibCheck: true,
					types: ["node"],
				},
				include: ["src/**/*.ts"],
			},
			null,
			"\t",
		)}\n`,
	);

	cpSync(join(repoRoot, "LICENSE"), join(outRoot, "LICENSE"));

	buildBundle();

	console.log(
		`${PACKAGE_NAME} bundle written to ${relative(repoRoot, outRoot)}`,
	);
	console.log(`  protocol modules: ${protocolCount}`);
	console.log(`  kernel modules:   ${kernelCount}`);
	console.log(
		`  surface:          ${SURFACE.protocol.length + SURFACE.kernel.length} exports`,
	);
	console.log(`  runtime deps:     zod ${zod}`);
	console.log("  compiled:         dist/ (js + d.ts)");
}

main();
