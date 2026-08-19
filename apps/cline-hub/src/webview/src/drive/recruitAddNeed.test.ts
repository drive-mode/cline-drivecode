import { describe, expect, it } from "vitest";
import {
	buildRecruitNeedFromFreeText,
	collectRecruitCandidates,
	RECRUIT_FIXTURE_CANDIDATES,
	rankRecruitFromFreeText,
} from "./recruitAddNeed";

describe("recruitAddNeed", () => {
	it("builds a structured need from free text without utterance keys", () => {
		const need = buildRecruitNeedFromFreeText("security auth review");
		expect(need.taskId).toBe("recruit-add");
		expect(need.title).toBe("security auth review");
		expect(need.capabilities.length).toBeGreaterThan(0);
		expect(Object.keys(need)).not.toContain("utterance");
	});

	it("ranks security fixture above unrelated when need mentions security", () => {
		const { ranked } = rankRecruitFromFreeText(
			"security auth",
			RECRUIT_FIXTURE_CANDIDATES,
			{ limit: 5 },
		);
		expect(ranked[0]?.slug).toBe("security-reviewer");
		expect(ranked[0]?.score).toBeGreaterThan(0);
	});

	it("merges seated agents ahead of fixtures on slug collision", () => {
		const candidates = collectRecruitCandidates([
			{
				id: "security-reviewer",
				displayName: "Seated Security",
				role: "specialist",
				kind: "agent",
			},
		]);
		const seated = candidates.find((c) => c.slug === "security-reviewer");
		expect(seated?.displayName).toBe("Seated Security");
		expect(candidates.some((c) => c.slug === "test-fixer")).toBe(true);
	});
});
