import { describe, expect, it } from "vitest";
import {
	buildRecruitNeed,
	rankRecruitCandidates,
	recruitNeedIsPrivate,
	type RecruitCandidate,
} from "./scoreNeed.js";

const candidates: RecruitCandidate[] = [
	{
		slug: "security-reviewer",
		displayName: "Security Reviewer",
		labels: ["security", "auth", "review"],
		domains: ["auth"],
		suggestedPackIds: ["security-crew"],
	},
	{
		slug: "pair-partner",
		displayName: "Adam",
		labels: ["pair", "general"],
		domains: [],
	},
	{
		slug: "test-fixer",
		displayName: "Test Fixer",
		labels: ["tests", "parser"],
		domains: ["qa"],
	},
];

describe("buildRecruitNeed", () => {
	it("tokenizes title + failure into capabilities without storing the note", () => {
		const need = buildRecruitNeed({
			taskId: "t1",
			planId: "p1",
			title: "Fix auth parser",
			failureNote: "security tests red",
		});
		expect(need.taskId).toBe("t1");
		expect(need.title).toBe("Fix auth parser");
		expect(need.capabilities).toEqual(
			expect.arrayContaining(["fix", "auth", "parser", "security", "tests", "red"]),
		);
		expect(JSON.stringify(need)).not.toContain("security tests red");
	});
});

describe("rankRecruitCandidates", () => {
	it("ranks security agent above pair for auth/security need", () => {
		const need = buildRecruitNeed({
			taskId: "t1",
			planId: "p1",
			title: "Review auth change",
			failureNote: "security check failed",
		});
		const ranked = rankRecruitCandidates(need, candidates, { limit: 3 });
		expect(ranked[0]?.slug).toBe("security-reviewer");
		expect(ranked[0]?.reasons.some((reason) => reason.startsWith("label:"))).toBe(
			true,
		);
		expect(ranked[0]?.suggestedPackIds).toEqual(["security-crew"]);
	});

	it("falls back to stable slug order when need is empty", () => {
		const need = buildRecruitNeed({
			taskId: "t1",
			planId: null,
			title: "t1",
		});
		const ranked = rankRecruitCandidates(need, candidates);
		expect(ranked.map((entry) => entry.slug)).toEqual([
			"pair-partner",
			"security-reviewer",
			"test-fixer",
		]);
	});
});

describe("recruitNeedIsPrivate", () => {
	it("accepts structured need", () => {
		expect(
			recruitNeedIsPrivate(
				buildRecruitNeed({ taskId: "t1", planId: null, title: "Fix" }),
			),
		).toBe(true);
	});

	it("rejects utterance keys", () => {
		expect(recruitNeedIsPrivate({ taskId: "t1", utterance: "hi" })).toBe(
			false,
		);
	});
});
