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
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
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

function copyTree(
	from: string,
	toSubdir: string,
	rewrite: boolean,
	explicit?: string[],
): number {
	const files = explicit ?? listTsFiles(from);
	for (const file of files) {
		const outFile = join(outRoot, "src", toSubdir, relative(from, file));
		mkdirSync(dirname(outFile), { recursive: true });
		const source = readFileSync(file, "utf8");
		writeFileSync(
			outFile,
			rewrite ? rewriteSharedImports(source, outFile) : source,
		);
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
				files: ["dist", "src"],
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
					module: "ESNext",
					moduleResolution: "bundler",
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

	console.log(
		`${PACKAGE_NAME} bundle written to ${relative(repoRoot, outRoot)}`,
	);
	console.log(`  protocol modules: ${protocolCount}`);
	console.log(`  kernel modules:   ${kernelCount}`);
	console.log(
		`  surface:          ${SURFACE.protocol.length + SURFACE.kernel.length} exports`,
	);
	console.log(`  runtime deps:     zod ${zod}`);
}

main();
