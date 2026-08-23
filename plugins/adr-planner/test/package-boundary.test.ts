import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");

function listFiles(root: string, relative = ""): string[] {
	const current = join(root, relative);
	return readdirSync(current)
		.flatMap((entry) => {
			const child = join(relative, entry);
			return statSync(join(root, child)).isDirectory()
				? listFiles(root, child)
				: [child];
		})
		.sort();
}

describe("package boundary", () => {
	it("remains private until registry authority is accepted", () => {
		const manifest = JSON.parse(
			readFileSync(join(packageRoot, "package.json"), "utf8"),
		) as {
			private?: boolean;
			files?: string[];
			cline?: { plugins?: Array<{ capabilities?: string[] }> };
			dependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
		};
		expect(manifest.private).toBe(true);
		expect(manifest.files).toEqual([
			"src",
			"skills",
			"README.md",
			"package.json",
		]);
		expect(manifest.cline?.plugins?.[0]?.capabilities).toEqual([
			"commands",
			"tools",
		]);
		for (const [name, version] of Object.entries({
			...manifest.dependencies,
			...manifest.optionalDependencies,
		})) {
			expect(version, `${name} must be an exact runtime dependency`).toMatch(
				/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
			);
		}
	});

	it("contains no benchmark gold, reviews, or held-out fixtures", () => {
		const files = listFiles(packageRoot).map((path) => path.toLowerCase());
		for (const forbidden of [
			"baseline/",
			"reviews/",
			"held-out",
			"held_out",
			"gold/",
		]) {
			expect(files.some((path) => path.includes(forbidden))).toBe(false);
		}
	});
});
