import { describe, expect, it } from "vitest";
import {
	EMPTY_HUB_MANAGED_RUNTIME_CAPABILITY_MANIFEST,
	HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
	normalizeHubManagedRuntimeCapabilityManifest,
	parseHubManagedRuntimeCapabilityRequest,
	parseHubManagedRuntimeCapabilityResult,
} from "./workspace-managed-runtime-capabilities";

describe("workspace managed runtime capability manifest", () => {
	it("normalizes a closed, immutable callback grant", () => {
		const normalized = normalizeHubManagedRuntimeCapabilityManifest({
			callbacks: [HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY],
		});

		expect(normalized).toEqual({
			callbacks: [HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY],
		});
		expect(Object.isFrozen(normalized)).toBe(true);
		expect(Object.isFrozen(normalized.callbacks)).toBe(true);
		expect(normalizeHubManagedRuntimeCapabilityManifest(undefined)).toBe(
			EMPTY_HUB_MANAGED_RUNTIME_CAPABILITY_MANIFEST,
		);
	});

	it("rejects unknown, duplicate, and extended callback authority", () => {
		for (const manifest of [
			{ callbacks: ["tool_executor.bash"] },
			{
				callbacks: [
					HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
				],
			},
			{
				callbacks: [HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY],
				arbitraryHandler: true,
			},
		]) {
			expect(() =>
				normalizeHubManagedRuntimeCapabilityManifest(manifest),
			).toThrow(expect.objectContaining({ code: "unsupported_capability" }));
		}
	});

	it("uses exact bounded schemas for ask-question requests and results", () => {
		expect(
			parseHubManagedRuntimeCapabilityRequest(
				HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
				{ question: "Which path?", options: ["A", "B"] },
			),
		).toEqual({ question: "Which path?", options: ["A", "B"] });
		expect(
			parseHubManagedRuntimeCapabilityResult(
				HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
				{ answer: "A" },
			),
		).toBe("A");

		for (const input of [
			{ question: "Which path?", options: ["only one"] },
			{ question: "Which path?", options: ["A", "B"], path: "/private" },
			{ question: "x".repeat(16 * 1024 + 1), options: ["A", "B"] },
		]) {
			expect(() =>
				parseHubManagedRuntimeCapabilityRequest(
					HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
					input,
				),
			).toThrow(expect.objectContaining({ code: "invalid_input" }));
		}
		expect(() =>
			parseHubManagedRuntimeCapabilityResult(
				HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
				{ answer: "A", unexpected: true },
			),
		).toThrow(expect.objectContaining({ code: "invalid_input" }));
	});
});
