#!/usr/bin/env bun
/**
 * Enforce the docs/drivecode/ directory skeleton (see STRUCTURE.md).
 *
 * Fails when agents drop docs in the wrong place: loose files under product
 * plans, flat assets, revived legacy paths, or unknown nest-root siblings.
 *
 * Usage:
 *   bun sdk/scripts/check-drivecode-structure.ts
 *   bun run check:drivecode-docs
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type StructureIssue = { path: string; message: string };

export type CheckDrivecodeStructureOptions = {
	/** Absolute path to docs/drivecode (or a fixture that mirrors it). */
	nestPath: string;
	/**
	 * Prefix used in reported paths. Defaults to `docs/drivecode` so messages
	 * match the live nest; tests can pass `fixture` for clarity.
	 */
	reportPrefix?: string;
};

/** Required directories that must exist after migration. */
export const REQUIRED_DIRS = [
	"reference",
	"plans",
	"plans/cline-drivemode",
	"plans/cline-drivemode/foundation",
	"plans/cline-drivemode/research",
	"plans/cline-drivemode/leadership",
	"plans/cline-drivemode/delivery",
	"plans/cline-drivemode/decisions",
	"plans/cline-drivemode/adr",
	"plans/cline-drivemode/prd",
	"plans/cline-drivemode/features",
	"plans/cline-drivemode/initiatives",
	"plans/cline-drivemode/schemas",
	"plans/cline-drivemode/examples",
	"plans/cline-drivemode/ops",
	"plans/cline-drivemode/archive",
	"plans/drivecode-sdk",
	"plans/drivecode-sdk/foundation",
	"plans/drivecode-sdk/delivery",
	"design",
	"design/brand",
	"design/wireframes",
	"design/canvases",
	"assets",
	"assets/logos",
	"assets/hub",
	"assets/tui",
	"assets/demos",
	"meta",
	"meta/reviews",
] as const;

/** Nest root may only contain these files and directories. */
export const NEST_ROOT_FILES = new Set([
	"README.md",
	"AGENTS.md",
	"HANDOFF.md",
	"CI.md",
	"STRUCTURE.md",
]);
export const NEST_ROOT_DIRS = new Set([
	"reference",
	"plans",
	"design",
	"assets",
	"meta",
]);

/** Product plan track root: README + role folders only. */
export const PRODUCT_ROLE_DIRS = new Set([
	"foundation",
	"research",
	"leadership",
	"delivery",
	"decisions",
	"adr",
	"prd",
	"features",
	"initiatives",
	"schemas",
	"examples",
	"ops",
	"archive",
]);

export const HARNESS_ROOT_FILES = new Set(["README.md", "decisions.tsv"]);
export const HARNESS_ROOT_DIRS = new Set(["foundation", "delivery"]);

/**
 * Asset buckets. All but one hold images or fonts; `changelog` is the
 * exception — it holds the generated repo-history snapshot
 * (`repo-changelog.json`, written by `scripts/drive/seed-repo-changelog.ts`)
 * that the hub seeds the Status Hub changelog from.
 */
export const ASSET_BUCKETS = new Set([
	"logos",
	"hub",
	"tui",
	"demos",
	"fonts",
	"changelog",
]);
export const DESIGN_DIRS = new Set(["brand", "wireframes", "canvases"]);

/** Legacy paths that must stay gone. */
export const FORBIDDEN_PATHS = [
	"design/drive-wireframes",
	"reviews",
	"plans/cline-drivemode/show-backlog-director",
	"plans/cline-drivemode/task-bank-drive-loop",
	"plans/cline-drivemode/share-and-router",
	"plans/cline-drivemode/share-screen-canvas",
] as const;

/** Key files that must exist after the migration (spot-check the move map). */
export const REQUIRED_FILES = [
	"README.md",
	"AGENTS.md",
	"HANDOFF.md",
	"CI.md",
	"STRUCTURE.md",
	"reference/architecture.md",
	"reference/native-vs-drivecode.md",
	"reference/skills-inventory.md",
	"plans/cline-drivemode/foundation/00-vision.md",
	"plans/cline-drivemode/foundation/01-architecture.md",
	"plans/cline-drivemode/delivery/TASK-GRAPH.md",
	"plans/cline-drivemode/delivery/AGENT-RUNBOOK.md",
	"plans/cline-drivemode/initiatives/README.md",
	"plans/drivecode-sdk/foundation/02-architecture.md",
	"plans/drivecode-sdk/delivery/07-agent-handoff.md",
	"design/brand/CLINE-BRAND-TOKENS.md",
	"design/wireframes/DRIVE-TAB.md",
	"design/canvases/overview-canvas.html",
	"meta/glossary.md",
] as const;

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function list(dir: string): Promise<{ name: string; isDir: boolean }[]> {
	if (!(await exists(dir))) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((e) => e.name !== ".DS_Store")
		.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
}

/**
 * Validate a docs/drivecode nest (live or fixture). Returns issues; does not
 * exit. Empty array means the skeleton is valid.
 */
export async function checkDrivecodeStructure(
	options: CheckDrivecodeStructureOptions,
): Promise<StructureIssue[]> {
	const nest = options.nestPath;
	const prefix = options.reportPrefix ?? "docs/drivecode";
	const issues: StructureIssue[] = [];

	const fail = (relPath: string, message: string): void => {
		issues.push({ path: relPath, message });
	};

	const report = (rel: string): string =>
		rel.length === 0 ? prefix : `${prefix}/${rel}`;

	if (!(await exists(nest))) {
		fail(prefix, "nest directory is missing");
		return issues;
	}

	for (const dir of REQUIRED_DIRS) {
		if (!(await exists(join(nest, dir)))) {
			fail(report(dir), "required directory missing");
		}
	}

	for (const file of REQUIRED_FILES) {
		if (!(await exists(join(nest, file)))) {
			fail(report(file), "required file missing after migration");
		}
	}

	for (const dir of FORBIDDEN_PATHS) {
		if (await exists(join(nest, dir))) {
			fail(
				report(dir),
				"legacy path must not exist — see STRUCTURE.md placement matrix",
			);
		}
	}

	for (const entry of await list(nest)) {
		const rel = report(entry.name);
		if (entry.isDir) {
			if (!NEST_ROOT_DIRS.has(entry.name)) {
				fail(
					rel,
					`unknown nest-root directory (allowed: ${[...NEST_ROOT_DIRS].join(", ")})`,
				);
			}
		} else if (!NEST_ROOT_FILES.has(entry.name)) {
			fail(
				rel,
				`loose file at nest root — put reference pages in reference/, process docs are limited to ${[...NEST_ROOT_FILES].join(", ")}`,
			);
		}
	}

	for (const entry of await list(join(nest, "plans"))) {
		const rel = report(`plans/${entry.name}`);
		if (entry.isDir) {
			if (entry.name !== "cline-drivemode" && entry.name !== "drivecode-sdk") {
				fail(rel, "plans/ only hosts cline-drivemode/ and drivecode-sdk/");
			}
		} else if (entry.name !== "README.md") {
			fail(rel, "plans/ root only allows README.md");
		}
	}

	for (const entry of await list(join(nest, "plans", "cline-drivemode"))) {
		const rel = report(`plans/cline-drivemode/${entry.name}`);
		if (entry.isDir) {
			if (!PRODUCT_ROLE_DIRS.has(entry.name)) {
				fail(
					rel,
					"unknown product-plan role directory — multi-file tracks go under initiatives/<slug>/",
				);
			}
		} else if (entry.name !== "README.md") {
			fail(
				rel,
				"no loose markdown at product-plan root — use foundation/, research/, leadership/, delivery/, ops/, archive/, or initiatives/",
			);
		}
	}

	for (const entry of await list(join(nest, "plans", "drivecode-sdk"))) {
		const rel = report(`plans/drivecode-sdk/${entry.name}`);
		if (entry.isDir) {
			if (!HARNESS_ROOT_DIRS.has(entry.name)) {
				fail(
					rel,
					`unknown harness directory (allowed: ${[...HARNESS_ROOT_DIRS].join(", ")})`,
				);
			}
		} else if (!HARNESS_ROOT_FILES.has(entry.name)) {
			fail(
				rel,
				"loose file at harness root — numbered series live in foundation/ or delivery/",
			);
		}
	}

	for (const entry of await list(join(nest, "assets"))) {
		const rel = report(`assets/${entry.name}`);
		if (!entry.isDir) {
			fail(rel, "no loose files in assets/ — use logos/, hub/, tui/, demos/, or fonts/");
			continue;
		}
		if (!ASSET_BUCKETS.has(entry.name)) {
			fail(rel, `unknown asset bucket (allowed: ${[...ASSET_BUCKETS].join(", ")})`);
		}
	}

	for (const entry of await list(join(nest, "design"))) {
		const rel = report(`design/${entry.name}`);
		if (entry.isDir) {
			if (!DESIGN_DIRS.has(entry.name)) {
				fail(
					rel,
					`unknown design directory (allowed: ${[...DESIGN_DIRS].join(", ")})`,
				);
			}
		} else if (entry.name !== "README.md") {
			fail(rel, "loose design file — use brand/, wireframes/, or canvases/");
		}
	}

	for (const entry of await list(join(nest, "meta"))) {
		const rel = report(`meta/${entry.name}`);
		if (entry.isDir) {
			if (entry.name !== "reviews") {
				fail(rel, "unknown meta directory (allowed: reviews/)");
			}
		} else if (entry.name !== "glossary.md" && entry.name !== "README.md") {
			fail(rel, "meta root only allows glossary.md (and optional README.md)");
		}
	}

	for (const entry of await list(
		join(nest, "plans", "cline-drivemode", "features"),
	)) {
		if (entry.isDir) {
			fail(
				report(`plans/cline-drivemode/features/${entry.name}`),
				"features/ holds DRV-*.md one-pagers only — multi-file plans go in initiatives/",
			);
			continue;
		}
		if (entry.name === "README.md") continue;
		if (!/^DRV-[A-Z0-9-]+\.md$/.test(entry.name)) {
			fail(
				report(`plans/cline-drivemode/features/${entry.name}`),
				"feature files must match DRV-*.md",
			);
		}
	}

	for (const entry of await list(join(nest, "plans", "cline-drivemode", "adr"))) {
		if (entry.isDir) {
			fail(
				report(`plans/cline-drivemode/adr/${entry.name}`),
				"adr/ holds ADR-*.md files only",
			);
			continue;
		}
		if (entry.name === "README.md") continue;
		if (!/^ADR-\d{4}-[a-z0-9-]+\.md$/.test(entry.name)) {
			fail(
				report(`plans/cline-drivemode/adr/${entry.name}`),
				"ADR files must match ADR-NNNN-slug.md",
			);
		}
	}

	for (const entry of await list(
		join(nest, "plans", "cline-drivemode", "initiatives"),
	)) {
		if (!entry.isDir) {
			if (entry.name !== "README.md") {
				fail(
					report(`plans/cline-drivemode/initiatives/${entry.name}`),
					"initiatives/ root only allows README.md and slug directories",
				);
			}
			continue;
		}
		const readme = join(
			nest,
			"plans",
			"cline-drivemode",
			"initiatives",
			entry.name,
			"README.md",
		);
		if (!(await exists(readme))) {
			fail(
				report(`plans/cline-drivemode/initiatives/${entry.name}`),
				"each initiative must have a README.md (purpose, DRV links, status)",
			);
		}
	}

	return issues;
}

async function main(): Promise<void> {
	const repoRoot = resolve(import.meta.dirname, "..", "..");
	const nest = join(repoRoot, "docs", "drivecode");
	const issues = await checkDrivecodeStructure({ nestPath: nest });

	if (issues.length === 0) {
		console.log("docs/drivecode structure OK");
		return;
	}

	console.error(
		`docs/drivecode structure check failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n`,
	);
	for (const issue of issues) {
		console.error(`  ${issue.path}`);
		console.error(`    ${issue.message}\n`);
	}
	console.error(
		"See docs/drivecode/STRUCTURE.md placement matrix and docs/drivecode/AGENTS.md.",
	);
	process.exit(1);
}

if (import.meta.main) {
	await main();
}
