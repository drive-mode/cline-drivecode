import { describe, expect, it } from "bun:test";
import {
	analyzeRepositoryMetadata,
	canonicalJson,
	profileProject,
	repositoryEvidenceId,
} from "../src/core";
import type { EvidenceRef } from "../src/schema";

function repositoryEvidence(): EvidenceRef[] {
	return analyzeRepositoryMetadata([
		{
			path: "package.json",
			kind: "package_json",
			digest: `sha256:${"a".repeat(64)}`,
			content: JSON.stringify({
				bin: "cli.js",
				exports: "./index.js",
				dependencies: { react: "1", express: "1" },
			}),
		},
		{ path: "LICENSE", kind: "presence" },
	]).evidence;
}

describe("project profiler", () => {
	it("maps direct signals and leaves dependency implications unsupported", () => {
		const result = profileProject({ evidence: repositoryEvidence() });

		expect(result.profile.productSurface).toEqual(["cli", "library"]);
		expect(result.profile.runtimeTopology).toEqual(["unknown"]);
		expect(result.profile.lifecycleChange).toEqual(["unknown"]);
		expect(result.profile.dataTrust).toEqual(["unknown"]);
		expect(result.profile.scaleReliability).toEqual(["unknown"]);
		expect(result.profile.deliveryGovernance).toEqual(["unknown"]);
		expect(result.profile.unknowns).toEqual([
			"dimension:lifecycle_change",
			"dimension:data_trust",
			"dimension:runtime_topology",
			"dimension:scale_reliability",
			"dimension:delivery_governance",
		]);
		expect(result.unsupportedInferences).toHaveLength(4);
		expect(
			result.unsupportedInferences.some((entry) =>
				entry.claim.includes("does not prove open-source"),
			),
		).toBe(true);
		expect(
			result.unsupportedInferences.some((entry) =>
				entry.claim.includes("does not prove this runtime"),
			),
		).toBe(true);
	});

	it("rejects forged repository evidence and repository-backed assertions", () => {
		const authenticId = repositoryEvidenceId("package.json", "surface.cli");
		const forgedVariants: EvidenceRef[] = [
			{
				id: "repo-forged",
				sourceType: "repository",
				source: "package.json",
				locator: "/structural-metadata",
				digest: `sha256:${"a".repeat(64)}`,
				claim: "repository.signal:surface.cli",
			},
			{
				id: authenticId,
				sourceType: "repository",
				source: "other/package.json",
				locator: "/structural-metadata",
				digest: `sha256:${"a".repeat(64)}`,
				claim: "repository.signal:surface.cli",
			},
			{
				id: authenticId,
				sourceType: "repository",
				source: "package.json",
				locator: "/structural-metadata",
				claim: "repository.signal:surface.cli",
			},
		];
		for (const evidence of forgedVariants) {
			const result = profileProject({ evidence: [evidence] });
			expect(result.profile.productSurface).toEqual(["unknown"]);
			expect(result.diagnostics[0]?.code).toBe(
				"profile.invalid_repository_evidence",
			);
		}

		const repository = repositoryEvidence()[0];
		if (!repository) throw new Error("expected repository evidence");
		const result = profileProject({
			evidence: [repository],
			assertions: [
				{
					id: "repo-backed-health",
					dimension: "data_trust",
					value: "health",
					evidenceRefs: [repository.id],
					rationale: "Repository evidence has no human authority.",
				},
			],
		});
		expect(result.profile.dataTrust).toEqual(["unknown"]);
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"profile.invalid_assertion_authority",
		);
	});

	it("merges typed, evidence-backed assertions", () => {
		const evidence: EvidenceRef = {
			id: "brief-health-data",
			sourceType: "brief",
			source: "user brief",
			claim: "The application handles patient health records.",
		};
		const result = profileProject({
			evidence: [evidence],
			assertions: [
				{
					id: "health-data",
					dimension: "data_trust",
					value: "health",
					evidenceRefs: [evidence.id],
					rationale: "The brief explicitly identifies health records.",
				},
			],
		});

		expect(result.profile.dataTrust).toEqual(["health"]);
		expect(result.profile.evidenceRefs).toEqual([evidence.id]);
		expect(result.diagnostics).toEqual([]);
	});

	it("rejects missing assertion evidence and conflicting unknowns", () => {
		const evidence: EvidenceRef = {
			id: "brief-web",
			sourceType: "brief",
			source: "brief",
			claim: "The product is a web application.",
		};
		const result = profileProject({
			evidence: [evidence],
			assertions: [
				{
					id: "web-known",
					dimension: "product_surface",
					value: "web",
					evidenceRefs: [evidence.id],
					rationale: "Explicit brief statement.",
				},
				{
					id: "web-unknown",
					dimension: "product_surface",
					value: "unknown",
					evidenceRefs: [evidence.id],
					rationale: "Conflicting assertion for the test.",
				},
				{
					id: "missing-proof",
					dimension: "delivery_governance",
					value: "public_launch",
					evidenceRefs: ["missing-evidence"],
					rationale: "This must not be accepted.",
				},
			],
		});

		expect(result.profile.productSurface).toEqual(["unknown"]);
		expect(result.profile.deliveryGovernance).toEqual(["unknown"]);
		expect(result.diagnostics.map((entry) => entry.code)).toEqual([
			"profile.conflicting_unknown",
			"profile.missing_assertion_evidence",
		]);
	});

	it("deduplicates identical records and excludes conflicting ids independent of order", () => {
		const first: EvidenceRef = {
			id: "brief-surface",
			sourceType: "brief",
			source: "brief",
			claim: "A web product.",
		};
		const second = { ...first, claim: "A CLI product." };
		const assertion = {
			id: "surface-assertion",
			dimension: "product_surface" as const,
			value: "web" as const,
			evidenceRefs: [first.id],
			rationale: "Explicit brief.",
		};

		const identical = profileProject({
			evidence: [first, first],
			assertions: [assertion, assertion],
		});
		expect(identical.profile.productSurface).toEqual(["web"]);
		expect(identical.diagnostics).toEqual([]);

		const permutations = [
			{ evidence: [first, second], assertions: [assertion] },
			{ evidence: [second, first], assertions: [assertion] },
		];
		const outputs = permutations.map((request) =>
			canonicalJson(profileProject(request)),
		);
		expect(outputs[0]).toBe(outputs[1]);
		const conflicting = profileProject(permutations[0]);
		expect(conflicting.profile.productSurface).toEqual(["unknown"]);
		expect(conflicting.diagnostics.map((entry) => entry.code)).toEqual([
			"profile.conflicting_evidence",
			"profile.missing_assertion_evidence",
		]);
	});

	it("excludes conflicting assertion ids independent of arrival order", () => {
		const evidence: EvidenceRef = {
			id: "brief-surface-conflict",
			sourceType: "brief",
			source: "brief",
			claim: "Surface remains disputed.",
		};
		const web = {
			id: "same-assertion",
			dimension: "product_surface" as const,
			value: "web" as const,
			evidenceRefs: [evidence.id],
			rationale: "Web interpretation.",
		};
		const api = {
			...web,
			value: "api" as const,
			rationale: "API interpretation.",
		};
		const forward = profileProject({
			evidence: [evidence],
			assertions: [web, api],
		});
		const reversed = profileProject({
			evidence: [evidence],
			assertions: [api, web],
		});
		expect(canonicalJson(forward)).toBe(canonicalJson(reversed));
		expect(forward.profile.productSurface).toEqual(["unknown"]);
		expect(forward.diagnostics[0]?.code).toBe("profile.conflicting_assertion");
	});

	it("fails closed on invalid profile requests", () => {
		const result = profileProject({ evidence: [], assertions: [{}] });
		expect(result.profile.productSurface).toEqual(["unknown"]);
		expect(result.diagnostics[0]?.severity).toBe("error");
	});

	it("is byte stable across ten profiles", () => {
		const request = { evidence: repositoryEvidence() };
		const baseline = canonicalJson(profileProject(request));
		for (let index = 0; index < 10; index += 1) {
			expect(canonicalJson(profileProject(request))).toBe(baseline);
		}
	});
});
