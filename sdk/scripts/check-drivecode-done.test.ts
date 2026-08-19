import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ADJECTIVE_TO_STATUS,
	checkDrivecodeDone,
	parseClaimsRegistry,
} from "./check-drivecode-done.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const liveNest = join(repoRoot, "docs", "drivecode");
const liveRegistry = join(
	liveNest,
	"plans",
	"cline-drivemode",
	"delivery",
	"claims-registry.yaml",
);

const tempRoots: string[] = [];

afterEach(async () => {
	while (tempRoots.length > 0) {
		const root = tempRoots.pop();
		if (root) await rm(root, { recursive: true, force: true });
	}
});

async function makeTempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "drivecode-done-"));
	tempRoots.push(root);
	return root;
}

describe("parseClaimsRegistry", () => {
	test("rejects non-array claims", () => {
		const { registry, issues } = parseClaimsRegistry({ claims: "nope" });
		expect(registry).toBeNull();
		expect(issues.length).toBeGreaterThan(0);
	});

	test("accepts minimal claim", () => {
		const { registry, issues } = parseClaimsRegistry({
			claims: [{ id: "drv-x", status: "scaffold", acs: [] }],
		});
		expect(issues).toEqual([]);
		expect(registry?.claims).toHaveLength(1);
	});

	test("accepts a complete acyclic project map", () => {
		const { registry, issues } = parseClaimsRegistry({
			claims: [
				{
					id: "drv-foundation",
					status: "active_partial",
					displayId: "GP0",
					lane: "now",
					dependsOn: [],
					owner: "Platform",
					systems: ["data", "software"],
					acceptance: "Contract fixtures pass.",
				},
				{
					id: "drv-client",
					status: "planned",
					displayId: "GP1",
					lane: "next",
					dependsOn: ["drv-foundation"],
					owner: "Client",
					systems: ["people", "hardware", "networks"],
					acceptance: "Client reconnects.",
				},
			],
		});
		expect(issues).toEqual([]);
		expect(registry?.claims[1]?.dependsOn).toEqual(["drv-foundation"]);
	});

	test("rejects partial metadata, cycles, and backward lane dependencies", () => {
		const { issues } = parseClaimsRegistry({
			claims: [
				{
					id: "drv-partial",
					status: "planned",
					displayId: "GP2",
				},
				{
					id: "drv-now",
					status: "planned",
					displayId: "GP0",
					lane: "now",
					dependsOn: ["drv-next"],
					owner: "Now",
					systems: ["software"],
					acceptance: "Now passes.",
				},
				{
					id: "drv-next",
					status: "planned",
					displayId: "GP1",
					lane: "next",
					dependsOn: ["drv-now"],
					owner: "Next",
					systems: ["software"],
					acceptance: "Next passes.",
				},
			],
		});
		expect(
			issues.some((issue) => issue.message.includes("must provide displayId")),
		).toBe(true);
		expect(
			issues.some((issue) =>
				issue.message.includes("cannot depend on later lane"),
			),
		).toBe(true);
		expect(
			issues.some((issue) => issue.message.includes("dependency cycle")),
		).toBe(true);
	});
});

describe("ADJECTIVE_TO_STATUS", () => {
	test("maps Landed and Shipped to verified_shipped", () => {
		expect(ADJECTIVE_TO_STATUS.Landed).toBe("verified_shipped");
		expect(ADJECTIVE_TO_STATUS.Shipped).toBe("verified_shipped");
		expect(ADJECTIVE_TO_STATUS.Partial).toBe("active_partial");
	});
});

describe("checkDrivecodeDone", () => {
	test("live nest and registry pass", async () => {
		const issues = await checkDrivecodeDone({
			nestPath: liveNest,
			registryPath: liveRegistry,
			repoRoot,
		});
		expect(issues).toEqual([]);
	});

	test("bare Shipped without claim fails", async () => {
		const root = await makeTempRoot();
		const nest = join(root, "docs", "drivecode");
		await mkdir(join(nest, "plans", "cline-drivemode"), { recursive: true });
		const registryPath = join(root, "claims-registry.yaml");
		await writeFile(
			registryPath,
			`claims:\n  - id: drv-x\n    status: verified_shipped\n    acs:\n      - id: ac-1\n        evidence:\n          - kind: test\n            path: sdk/scripts/check-drivecode-done.ts\n            command: bun test\n`,
		);
		await writeFile(join(nest, "HANDOFF.md"), "| Item | **Shipped** |\n");
		await writeFile(
			join(nest, "plans", "cline-drivemode", "README.md"),
			"# ok\n",
		);

		const issues = await checkDrivecodeDone({
			nestPath: nest,
			registryPath,
			repoRoot,
			reportPrefix: "fixture",
		});
		expect(issues.some((i) => i.message.includes("bare **Shipped**"))).toBe(
			true,
		);
	});

	test("claim status mismatch fails", async () => {
		const root = await makeTempRoot();
		const nest = join(root, "docs", "drivecode");
		await mkdir(join(nest, "plans", "cline-drivemode"), { recursive: true });
		const registryPath = join(root, "claims-registry.yaml");
		await writeFile(
			registryPath,
			`claims:\n  - id: drv-x\n    status: active_partial\n    acs: []\n`,
		);
		await writeFile(
			join(nest, "HANDOFF.md"),
			"| Item | **Shipped** (claim:drv-x) |\n",
		);
		await writeFile(
			join(nest, "plans", "cline-drivemode", "README.md"),
			"# ok\n",
		);

		const issues = await checkDrivecodeDone({
			nestPath: nest,
			registryPath,
			repoRoot,
			reportPrefix: "fixture",
		});
		expect(issues.some((i) => i.message.includes("active_partial"))).toBe(true);
	});

	test("verified_shipped without evidence fails", async () => {
		const root = await makeTempRoot();
		const nest = join(root, "docs", "drivecode");
		await mkdir(join(nest, "plans", "cline-drivemode"), { recursive: true });
		const registryPath = join(root, "claims-registry.yaml");
		await writeFile(
			registryPath,
			`claims:\n  - id: drv-x\n    status: verified_shipped\n    acs: []\n`,
		);
		await writeFile(join(nest, "HANDOFF.md"), "# ok\n");
		await writeFile(
			join(nest, "plans", "cline-drivemode", "README.md"),
			"# ok\n",
		);

		const issues = await checkDrivecodeDone({
			nestPath: nest,
			registryPath,
			repoRoot,
			reportPrefix: "fixture",
		});
		expect(issues.some((i) => i.message.includes("no evidence entries"))).toBe(
			true,
		);
	});

	test("valid citation passes", async () => {
		const root = await makeTempRoot();
		const nest = join(root, "docs", "drivecode");
		await mkdir(join(nest, "plans", "cline-drivemode"), { recursive: true });
		const registryPath = join(root, "claims-registry.yaml");
		await writeFile(
			registryPath,
			`claims:\n  - id: drv-x\n    status: active_partial\n    acs: []\n`,
		);
		await writeFile(
			join(nest, "HANDOFF.md"),
			"| Item | **Partial** (claim:drv-x) |\n",
		);
		await writeFile(
			join(nest, "plans", "cline-drivemode", "README.md"),
			"| Scope |\n| **Partial** (claim:drv-x) |\n",
		);

		const issues = await checkDrivecodeDone({
			nestPath: nest,
			registryPath,
			repoRoot,
			reportPrefix: "fixture",
		});
		expect(issues).toEqual([]);
	});
});
