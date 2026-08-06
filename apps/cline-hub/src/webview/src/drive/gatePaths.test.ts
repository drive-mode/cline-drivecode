import { describe, expect, it } from "vitest";
import { blastRadiusPaths, pathFromToolInput } from "./gatePaths";

describe("pathFromToolInput", () => {
	it("reads common path keys", () => {
		expect(pathFromToolInput({ path: "src/auth.ts" })).toBe("src/auth.ts");
		expect(pathFromToolInput({ file_path: "a/b.ts" })).toBe("a/b.ts");
	});

	it("reads apply-patch headers", () => {
		expect(
			pathFromToolInput("*** Update File: apps/hub/foo.ts\n@@"),
		).toBe("apps/hub/foo.ts");
	});
});

describe("blastRadiusPaths", () => {
	it("returns basename chips", () => {
		expect(blastRadiusPaths({ path: "src/auth.ts" })).toEqual(["auth.ts"]);
		expect(blastRadiusPaths({})).toEqual([]);
	});
});
