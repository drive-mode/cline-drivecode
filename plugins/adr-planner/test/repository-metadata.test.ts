import { describe, expect, it } from "bun:test";
import { analyzeRepositoryMetadata, canonicalJson } from "../src/core";

describe("repository metadata analyzer", () => {
	it("emits only controlled signals from package structure", () => {
		const result = analyzeRepositoryMetadata([
			{
				path: "package.json",
				kind: "package_json",
				digest: `sha256:${"a".repeat(64)}`,
				content: JSON.stringify({
					name: "private-package-canary",
					bin: { privateCliName: "secret-cli-path" },
					exports: { ".": "./private-source-canary.ts" },
					workspaces: ["apps/private-workspace-canary"],
					scripts: { deploy: "secret-script-canary" },
					dependencies: {
						react: "private-version-canary",
						express: "private-server-version-canary",
						"private-dependency-canary": "1.0.0",
					},
				}),
			},
		]);

		expect(result.evidence.map((entry) => entry.claim)).toEqual([
			"repository.signal:candidate.runtime.server",
			"repository.signal:candidate.surface.api",
			"repository.signal:candidate.surface.web",
			"repository.signal:context.ecosystem.node",
			"repository.signal:context.monorepo",
			"repository.signal:surface.cli",
			"repository.signal:surface.library",
		]);
		expect(
			result.evidence.every((entry) => entry.source === "package.json"),
		).toBe(true);
		const serialized = JSON.stringify(result);
		for (const canary of [
			"private-package-canary",
			"privateCliName",
			"secret-cli-path",
			"private-source-canary",
			"private-workspace-canary",
			"secret-script-canary",
			"private-version-canary",
			"private-server-version-canary",
			"private-dependency-canary",
		]) {
			expect(serialized).not.toContain(canary);
		}
	});

	it("ignores empty or malformed structural fields", () => {
		const result = analyzeRepositoryMetadata([
			{
				path: "package.json",
				kind: "package_json",
				content: JSON.stringify({
					bin: null,
					exports: false,
					workspaces: 0,
					dependencies: { react: null, express: "" },
					optionalDependencies: [],
					peerDependencies: { commander: false },
				}),
			},
		]);
		expect(result.evidence.map((entry) => entry.claim)).toEqual([
			"repository.signal:context.ecosystem.node",
		]);
	});

	it("deduplicates identical candidates and excludes conflicting paths", () => {
		const identical = {
			path: "package.json",
			kind: "package_json" as const,
			content: '{"bin":"cli.js"}',
		};
		const deduplicated = analyzeRepositoryMetadata([identical, identical]);
		expect(deduplicated.evidence).toHaveLength(2);
		expect(deduplicated.diagnostics).toEqual([]);

		const conflicting = analyzeRepositoryMetadata([
			identical,
			{ ...identical, content: '{"exports":"./index.js"}' },
		]);
		expect(conflicting.evidence).toEqual([]);
		expect(conflicting.diagnostics[0]?.code).toBe(
			"evidence.conflicting_candidate",
		);
	});

	it("derives presence-only context without reading content", () => {
		const result = analyzeRepositoryMetadata([
			{ path: ".github/workflows/ci.yml", kind: "presence" },
			{ path: "Dockerfile", kind: "presence" },
			{ path: "LICENSE", kind: "presence" },
			{ path: "wrangler.toml", kind: "presence" },
		]);

		expect(result.evidence.map((entry) => entry.claim)).toEqual([
			"repository.signal:context.ci_present",
			"repository.signal:context.container",
			"repository.signal:context.license_candidate",
			"repository.signal:context.deployment_descriptor",
			"repository.signal:runtime.static_edge",
			"repository.signal:runtime.third_party_hosted",
		]);
	});

	it("reports malformed manifests without returning their content", () => {
		const result = analyzeRepositoryMetadata([
			{
				path: "package.json",
				kind: "package_json",
				content: "{ malformed-secret-canary",
			},
		]);
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"evidence.invalid_package_manifest",
		);
		expect(JSON.stringify(result)).not.toContain("malformed-secret-canary");
	});

	it("does not classify product or runtime from development-only dependencies", () => {
		const result = analyzeRepositoryMetadata([
			{
				path: "package.json",
				kind: "package_json",
				content: JSON.stringify({
					devDependencies: { react: "1", express: "1" },
				}),
			},
		]);
		expect(result.evidence.map((entry) => entry.claim)).toEqual([
			"repository.signal:context.ecosystem.node",
		]);
	});

	it("is byte stable across ten analyses", () => {
		const candidates = [
			{ path: "package.json", kind: "package_json" as const, content: "{}" },
			{ path: "Dockerfile", kind: "presence" as const },
		];
		const baseline = canonicalJson(analyzeRepositoryMetadata(candidates));
		for (let index = 0; index < 10; index += 1) {
			expect(canonicalJson(analyzeRepositoryMetadata(candidates))).toBe(
				baseline,
			);
		}
	});

	it("uses locale-independent code-unit ordering for case and Unicode paths", () => {
		const paths = [
			"á/package.json",
			"á/package.json",
			"apps/package.json",
			"Apps/package.json",
		];
		const candidates = paths.map((path) => ({
			path,
			kind: "package_json" as const,
			content: '{"bin":"cli.js"}',
		}));
		const forward = analyzeRepositoryMetadata(candidates);
		const reversed = analyzeRepositoryMetadata([...candidates].reverse());
		expect(canonicalJson(forward)).toBe(canonicalJson(reversed));
		expect([...new Set(forward.evidence.map((entry) => entry.source))]).toEqual(
			[
				"Apps/package.json",
				"apps/package.json",
				"á/package.json",
				"á/package.json",
			],
		);
	});
});
