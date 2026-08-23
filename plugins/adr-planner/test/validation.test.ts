import { describe, expect, it } from "bun:test";
import {
	createArtifactEnvelope,
	validateArtifact,
	validateConcernGraph,
	validateConcernRouting,
} from "../src/core";
import { concern } from "./fixtures";

const producer = {
	name: "@cline/adr-planner",
	version: "0.0.0",
	commit: "abcdef1",
};

describe("artifact validation", () => {
	it("accepts a valid concern inventory and emits normalized bytes", () => {
		const artifact = createArtifactEnvelope({
			artifactKind: "concern_inventory",
			runId: "run-1",
			generatedAt: "2026-08-14T12:00:00.000Z",
			producer,
			policyVersion: "m1.0",
			payload: { concerns: [concern()] },
		});

		const result = validateArtifact(artifact);
		expect(result.valid).toBe(true);
		expect(result.diagnostics).toEqual([]);
		expect(result.normalized?.endsWith("\n")).toBe(true);
	});

	it("detects payload tampering through the digest", () => {
		const artifact = createArtifactEnvelope({
			artifactKind: "concern_inventory",
			runId: "run-1",
			generatedAt: "2026-08-14T12:00:00.000Z",
			producer,
			policyVersion: "m1.0",
			payload: { concerns: [concern()] },
		});
		artifact.payload = { concerns: [] };

		const result = validateArtifact(artifact);
		expect(result.valid).toBe(false);
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"artifact.digest_mismatch",
		);
	});

	it("rejects invalid enum values without repairing them", () => {
		const invalid = createArtifactEnvelope({
			artifactKind: "concern_inventory",
			runId: "run-1",
			generatedAt: "2026-08-14T12:00:00.000Z",
			producer,
			policyVersion: "m1.0",
			payload: {
				concerns: [{ ...concern(), resolution: "requirement" }],
			},
		});

		const result = validateArtifact(invalid);
		expect(result.valid).toBe(false);
		expect(result.normalized).toBeUndefined();
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"artifact.payload_schema",
		);
	});

	it("fails artifacts that carry producer error diagnostics", () => {
		const artifact = createArtifactEnvelope({
			artifactKind: "concern_inventory",
			runId: "run-1",
			generatedAt: "2026-08-14T12:00:00.000Z",
			producer,
			policyVersion: "m1.0",
			payload: { concerns: [concern()] },
		});
		artifact.diagnostics.push({
			code: "producer.unsupported_inference",
			severity: "error",
			message: "A critical inference remains unsupported",
			concernIds: [],
		});

		const result = validateArtifact(artifact);
		expect(result.valid).toBe(false);
		expect(result.normalized).toBeUndefined();
		expect(result.diagnostics.map((entry) => entry.code)).toContain(
			"producer.unsupported_inference",
		);
	});
});

describe("concern graph and routing", () => {
	it("detects dangling prerequisites and cycles", () => {
		const dangling = validateConcernGraph([
			concern({ id: "one", prerequisites: ["missing"] }),
		]);
		expect(dangling.map((entry) => entry.code)).toContain(
			"graph.dangling_prerequisite",
		);

		const cycle = validateConcernGraph([
			concern({ id: "one", prerequisites: ["two"] }),
			concern({ id: "two", prerequisites: ["one"] }),
		]);
		expect(cycle.map((entry) => entry.code)).toContain("graph.cycle");
	});

	it("requires ADR significance reasons", () => {
		const diagnostics = validateConcernRouting([
			concern({ significanceReasons: [] }),
		]);
		expect(diagnostics.map((entry) => entry.code)).toContain(
			"routing.adr_without_significance",
		);
	});

	it("requires coherent not-applicable classifications", () => {
		const diagnostics = validateConcernRouting([
			concern({ applicability: "not_applicable" }),
		]);
		expect(diagnostics.map((entry) => entry.code)).toContain(
			"routing.incoherent_not_applicable",
		);
	});
});
