import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ASSET_BUCKETS,
	checkDrivecodeStructure,
	DESIGN_DIRS,
	FORBIDDEN_PATHS,
	NEST_ROOT_DIRS,
	NEST_ROOT_FILES,
	PRODUCT_ROLE_DIRS,
	REQUIRED_DIRS,
	REQUIRED_FILES,
} from "./check-drivecode-structure.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const liveNest = join(repoRoot, "docs", "drivecode");

const tempRoots: string[] = [];

afterEach(async () => {
	while (tempRoots.length > 0) {
		const root = tempRoots.pop();
		if (root) await rm(root, { recursive: true, force: true });
	}
});

async function makeTempNest(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "drivecode-structure-"));
	tempRoots.push(root);
	return root;
}

async function touch(path: string, contents = "# fixture\n"): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, contents);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Minimal valid nest satisfying required dirs/files and naming rules. */
async function seedValidNest(nest: string): Promise<void> {
	for (const dir of REQUIRED_DIRS) {
		await mkdir(join(nest, dir), { recursive: true });
	}

	for (const file of NEST_ROOT_FILES) {
		await touch(join(nest, file));
	}

	await touch(join(nest, "plans", "README.md"));
	await touch(join(nest, "plans", "cline-drivemode", "README.md"));
	await touch(join(nest, "plans", "drivecode-sdk", "README.md"));
	await touch(join(nest, "plans", "drivecode-sdk", "decisions.tsv"), "id\n");
	await touch(join(nest, "design", "README.md"));
	await touch(join(nest, "meta", "glossary.md"));
	await touch(join(nest, "plans", "cline-drivemode", "initiatives", "README.md"));
	await touch(
		join(nest, "plans", "cline-drivemode", "features", "DRV-KERNEL.md"),
	);
	await touch(
		join(nest, "plans", "cline-drivemode", "ard", "ARD-0000-status-board.md"),
	);
	await touch(
		join(
			nest,
			"plans",
			"cline-drivemode",
			"initiatives",
			"example-track",
			"README.md",
		),
	);

	for (const file of REQUIRED_FILES) {
		await touch(join(nest, file));
	}
}

describe("checkDrivecodeStructure", () => {
	test("live docs/drivecode nest passes", async () => {
		const issues = await checkDrivecodeStructure({ nestPath: liveNest });
		expect(issues).toEqual([]);
	});

	test("minimal valid fixture passes", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(issues).toEqual([]);
	});

	test("missing nest reports a single missing-directory issue", async () => {
		const issues = await checkDrivecodeStructure({
			nestPath: join(tmpdir(), "does-not-exist-drivecode-nest"),
			reportPrefix: "fixture",
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toBe("fixture");
		expect(issues[0]?.message).toContain("missing");
	});

	test("rejects loose markdown at product-plan root", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await touch(join(nest, "plans", "cline-drivemode", "00-vision.md"));

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(
			issues.some(
				(i) =>
					i.path === "fixture/plans/cline-drivemode/00-vision.md" &&
					i.message.includes("no loose markdown"),
			),
		).toBe(true);
	});

	test("rejects loose files in assets/", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await touch(join(nest, "assets", "drive-tab.png"), "png");

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(
			issues.some(
				(i) =>
					i.path === "fixture/assets/drive-tab.png" &&
					i.message.includes("no loose files in assets"),
			),
		).toBe(true);
	});

	test("rejects revived legacy paths", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await mkdir(join(nest, "design", "drive-wireframes"), { recursive: true });
		await mkdir(join(nest, "reviews"), { recursive: true });

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		const paths = new Set(issues.map((i) => i.path));
		expect(paths.has("fixture/design/drive-wireframes")).toBe(true);
		expect(paths.has("fixture/reviews")).toBe(true);
	});

	test("rejects initiative without README.md", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await mkdir(
			join(nest, "plans", "cline-drivemode", "initiatives", "orphan-track"),
			{ recursive: true },
		);
		await touch(
			join(
				nest,
				"plans",
				"cline-drivemode",
				"initiatives",
				"orphan-track",
				"overview.md",
			),
		);

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(
			issues.some(
				(i) =>
					i.path ===
						"fixture/plans/cline-drivemode/initiatives/orphan-track" &&
					i.message.includes("README.md"),
			),
		).toBe(true);
	});

	test("rejects bad DRV and ARD filenames", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await touch(
			join(nest, "plans", "cline-drivemode", "features", "kernel.md"),
		);
		await touch(
			join(nest, "plans", "cline-drivemode", "ard", "ARD-1-bad.md"),
		);

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(issues.some((i) => i.path.endsWith("features/kernel.md"))).toBe(
			true,
		);
		expect(issues.some((i) => i.path.endsWith("ard/ARD-1-bad.md"))).toBe(true);
	});

	test("rejects unknown nest-root siblings", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await mkdir(join(nest, "scratch"), { recursive: true });
		await touch(join(nest, "architecture.md"));

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(issues.some((i) => i.path === "fixture/scratch")).toBe(true);
		expect(issues.some((i) => i.path === "fixture/architecture.md")).toBe(
			true,
		);
	});

	test("rejects harness loose numbered docs at track root", async () => {
		const nest = await makeTempNest();
		await seedValidNest(nest);
		await touch(join(nest, "plans", "drivecode-sdk", "02-architecture.md"));

		const issues = await checkDrivecodeStructure({
			nestPath: nest,
			reportPrefix: "fixture",
		});
		expect(
			issues.some(
				(i) =>
					i.path === "fixture/plans/drivecode-sdk/02-architecture.md" &&
					i.message.includes("foundation/ or delivery/"),
			),
		).toBe(true);
	});
});

describe("migration invariants on live nest", () => {
	test("legacy paths are gone", async () => {
		for (const rel of FORBIDDEN_PATHS) {
			expect(await pathExists(join(liveNest, rel))).toBe(false);
		}
	});

	test("required role directories and moved files exist", async () => {
		for (const dir of REQUIRED_DIRS) {
			expect(await pathExists(join(liveNest, dir))).toBe(true);
		}
		for (const file of REQUIRED_FILES) {
			expect(await pathExists(join(liveNest, file))).toBe(true);
		}
	});

	test("assets only use known buckets", async () => {
		const entries = (
			await readdir(join(liveNest, "assets"), {
				withFileTypes: true,
			})
		).filter((e) => e.name !== ".DS_Store");
		for (const entry of entries) {
			expect(entry.isDirectory()).toBe(true);
			expect(ASSET_BUCKETS.has(entry.name)).toBe(true);
		}
	});

	test("design only uses brand/wireframes/canvases", async () => {
		const entries = (
			await readdir(join(liveNest, "design"), {
				withFileTypes: true,
			})
		).filter((e) => e.name !== ".DS_Store");
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				expect(entry.name).toBe("README.md");
				continue;
			}
			expect(DESIGN_DIRS.has(entry.name)).toBe(true);
		}
	});

	test("product plan root is README + role dirs only", async () => {
		const entries = (
			await readdir(join(liveNest, "plans", "cline-drivemode"), {
				withFileTypes: true,
			})
		).filter((e) => e.name !== ".DS_Store");
		for (const entry of entries) {
			if (entry.isDirectory()) {
				expect(PRODUCT_ROLE_DIRS.has(entry.name)).toBe(true);
			} else {
				expect(entry.name).toBe("README.md");
			}
		}
	});

	test("nest root front doors exist and STRUCTURE is authoritative", async () => {
		for (const file of NEST_ROOT_FILES) {
			expect(await pathExists(join(liveNest, file))).toBe(true);
		}
		for (const dir of NEST_ROOT_DIRS) {
			expect(await pathExists(join(liveNest, dir))).toBe(true);
		}
		const structure = await Bun.file(join(liveNest, "STRUCTURE.md")).text();
		expect(structure).toContain("Live layout");
		expect(structure).toContain("check:drivecode-docs");
		const agents = await Bun.file(join(liveNest, "AGENTS.md")).text();
		expect(agents).toContain("check:drivecode-docs");
		expect(agents).toContain("initiatives/<slug>/");
	});

	test("CLI wrapper exits 0 on live nest", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", "sdk/scripts/check-drivecode-structure.ts"],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(code).toBe(0);
		expect(stdout).toContain("structure OK");
		expect(stderr).toBe("");
	});
});
