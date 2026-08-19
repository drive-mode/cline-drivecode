#!/usr/bin/env bun

/**
 * Guard the small set of versioned configuration sources used by local tooling
 * and CI. Product/security policy deliberately does not belong here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const failures: string[] = [];

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

function fail(message: string): void {
	failures.push(message);
}

const rootPackage = readJson("package.json");
const engines = rootPackage.engines as Record<string, unknown> | undefined;
const bunVersion = engines?.bun;
if (typeof bunVersion !== "string" || bunVersion.length === 0) {
	fail("package.json engines.bun must be a non-empty version");
} else if (rootPackage.packageManager !== `bun@${bunVersion}`) {
	fail(`package.json packageManager must match engines.bun (${bunVersion})`);
}

const workflowDir = resolve(repoRoot, ".github", "workflows");
const workflowPaths = readdirSync(workflowDir)
	.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
	.map((name) => join(workflowDir, name));
const setupActionPath = resolve(
	repoRoot,
	".github",
	"actions",
	"setup-bun-workspace",
	"action.yml",
);

for (const path of [...workflowPaths, setupActionPath]) {
	const source = readFileSync(path, "utf8");
	const relativePath = path.slice(repoRoot.length + 1);
	if (/\bbun-version\s*:/.test(source)) {
		fail(
			`${relativePath} contains a copied bun-version value; use bun-version-file`,
		);
	}

	const lines = source.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		if (!lines[index]?.includes("uses: oven-sh/setup-bun@v2")) continue;
		const setupBlock = lines.slice(index, index + 7).join("\n");
		if (!setupBlock.includes("bun-version-file:")) {
			fail(`${relativePath}:${index + 1} must resolve Bun from a version file`);
		}
	}
}

const vscodeRuntime = readJson("apps/vscode/test-runtime.config.json");
const versionOrChannel = /^(?:stable|insiders|\d+\.\d+\.\d+)$/;
if (
	typeof vscodeRuntime.unitTestVersion !== "string" ||
	!versionOrChannel.test(vscodeRuntime.unitTestVersion)
) {
	fail(
		"test-runtime.config.json unitTestVersion must be a channel or x.y.z version",
	);
}
if (
	typeof vscodeRuntime.debugHarnessVersion !== "string" ||
	!versionOrChannel.test(vscodeRuntime.debugHarnessVersion)
) {
	fail(
		"test-runtime.config.json debugHarnessVersion must be a channel or x.y.z version",
	);
}
if (
	vscodeRuntime.e2eChannel !== "stable" &&
	vscodeRuntime.e2eChannel !== "insiders"
) {
	fail('test-runtime.config.json e2eChannel must be "stable" or "insiders"');
}

const vscodeConsumers = new Map([
	["apps/vscode/.vscode-test.mjs", "runtimeConfig.unitTestVersion"],
	["apps/vscode/src/test/e2e/utils/build.mjs", "runtimeConfig.e2eChannel"],
	["apps/vscode/src/test/e2e/utils/helpers.ts", "runtimeConfig.e2eChannel"],
	["apps/vscode/scripts/interactive-playwright.ts", "runtimeConfig.e2eChannel"],
	[
		"apps/vscode/src/dev/debug-harness/server.ts",
		"runtimeConfig.debugHarnessVersion",
	],
]);
for (const [path, selector] of vscodeConsumers) {
	if (!readFileSync(resolve(repoRoot, path), "utf8").includes(selector)) {
		fail(`${path} must read ${selector} from test-runtime.config.json`);
	}
}

for (const path of [
	".github/workflows/ext-vscode-test.yml",
	".github/workflows/ext-vscode-test-e2e.yml",
]) {
	if (
		!readFileSync(resolve(repoRoot, path), "utf8").includes(
			"apps/vscode/test-runtime.config.json",
		)
	) {
		fail(`${path} must track test-runtime.config.json`);
	}
}

if (failures.length > 0) {
	console.error("Runtime configuration validation failed:");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(
	`Runtime configuration valid (Bun ${bunVersion}; VS Code unit ${vscodeRuntime.unitTestVersion}; E2E ${vscodeRuntime.e2eChannel}).`,
);
