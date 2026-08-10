// Preflight for Kanban's dev entry points inside the monorepo.
//
// Kanban used to be a standalone npm project: `npm ci` here was enough, and
// `@cline/*` arrived prebuilt from the registry. As `apps/kanban` neither is
// true — installs come from the workspace root via bun, and `@cline/core` is a
// symlink to `sdk/packages/core`, whose entry point is `dist/index.js` that
// nothing builds on its own.
//
// Both failures are silent and confusing at the point they bite: a missing
// install shows up as a module-not-found for a first-party package, and an
// unbuilt SDK shows up as a module-not-found for a package that is plainly
// present on disk. This turns them into one sentence naming the command to run.

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KANBAN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(KANBAN_ROOT, "..", "..");

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Returns a human-readable problem, or null when the workspace is usable.
 *
 * Deliberately checks the workspace symlink rather than a lockfile marker: bun
 * never writes `node_modules/.package-lock.json`, so the old npm-era check
 * reported "not installed" on a perfectly good install.
 */
export async function findWorkspaceProblem() {
	if (!(await exists(join(KANBAN_ROOT, "node_modules", "@cline", "core")))) {
		return [
			"Kanban's dependencies are not installed.",
			"",
			"  Run this from the repository root:",
			"      bun install",
		].join("\n");
	}

	if (
		!(await exists(
			join(REPO_ROOT, "sdk", "packages", "core", "dist", "index.js"),
		))
	) {
		return [
			"@cline/core resolves to sdk/packages/core in this workspace, and it has not been built.",
			"",
			"  Run this from the repository root:",
			"      bun run build:sdk",
		].join("\n");
	}

	return null;
}

export async function ensureWorkspaceReady() {
	const problem = await findWorkspaceProblem();
	if (problem) {
		console.error(`\n${problem}\n`);
		process.exit(1);
	}
}

// Usable directly as a `predev` hook as well as imported by dev-full.mjs.
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await ensureWorkspaceReady();
}
