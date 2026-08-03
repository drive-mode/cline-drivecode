import { describe, expect, it } from "vitest";
import {
	buildRepoChangelog,
	isRepoChangelogSnapshot,
	parseConventionalCommit,
	type RepoCommitRecord,
	repoChangelogTags,
	repoChangelogTagVocabulary,
	toRepoChangelogEntry,
} from "./repoChangelog.js";

function commit(overrides: Partial<RepoCommitRecord> = {}): RepoCommitRecord {
	return {
		hash: "85e065fb9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f",
		date: "2026-07-30T10:11:12.000Z",
		message: "fix(drive): point the arch template at the Spotlight frame",
		authorName: "Harrison Halperin",
		...overrides,
	};
}

describe("parseConventionalCommit", () => {
	it("splits type, scope, and description", () => {
		const parsed = parseConventionalCommit("feat(hub): add a status board");
		expect(parsed.type).toBe("feat");
		expect(parsed.scopes).toEqual(["hub"]);
		expect(parsed.description).toBe("add a status board");
		expect(parsed.breaking).toBe(false);
	});

	it("splits multi-scope commits on comma and slash", () => {
		expect(parseConventionalCommit("feat(drive,hub): x").scopes).toEqual([
			"drive",
			"hub",
		]);
		expect(parseConventionalCommit("fix(sdk/core): x").scopes).toEqual([
			"sdk",
			"core",
		]);
	});

	it("reads the bang breaking marker", () => {
		expect(parseConventionalCommit("feat(api)!: drop v1").breaking).toBe(true);
	});

	it("reads a BREAKING CHANGE body trailer", () => {
		const parsed = parseConventionalCommit(
			"refactor(core): rework the store",
			"BREAKING CHANGE: the on-disk format moved",
		);
		expect(parsed.breaking).toBe(true);
	});

	it("keeps a non-conventional subject whole", () => {
		const parsed = parseConventionalCommit(
			"Fix AskSage custom API URL being ignored at inference time (#12843)",
		);
		expect(parsed.type).toBeUndefined();
		expect(parsed.scopes).toEqual([]);
		expect(parsed.description).toBe(
			"Fix AskSage custom API URL being ignored at inference time (#12843)",
		);
	});

	it("flags revert commits", () => {
		const parsed = parseConventionalCommit(
			'Revert "fix(cli): don\'t crash when no opener exists (#12782)" (#12799)',
		);
		expect(parsed.revert).toBe(true);
		expect(parsed.merge).toBe(false);
		expect(parsed.pullRequest).toBe(12799);
	});

	it("flags merge commits", () => {
		const parsed = parseConventionalCommit(
			"Merge pull request #113 from hhalperin/chore/sync-upstream",
		);
		expect(parsed.merge).toBe(true);
		expect(parsed.type).toBeUndefined();
	});

	it("reads a trailing pull request number", () => {
		expect(parseConventionalCommit("feat(hub): rail (#115)").pullRequest).toBe(
			115,
		);
		expect(
			parseConventionalCommit("feat(hub): rail").pullRequest,
		).toBeUndefined();
	});

	it("keeps type and scope when the description is empty", () => {
		const parsed = parseConventionalCommit("fix(hub):  ");
		expect(parsed.type).toBe("fix");
		expect(parsed.scopes).toEqual(["hub"]);
		// Nothing left to show, so the raw line stands in for the headline.
		expect(parsed.description).toBe("fix(hub):");
		expect(repoChangelogTags(parsed)).toEqual(["fix", "hub"]);
	});

	it("normalizes scope casing and separators", () => {
		expect(parseConventionalCommit("Feat(Hub Webview): x").scopes).toEqual([
			"hub-webview",
		]);
	});
});

describe("repoChangelogTags", () => {
	it("emits type then scopes", () => {
		expect(
			repoChangelogTags(parseConventionalCommit("feat(drive,hub): x")),
		).toEqual(["feat", "drive", "hub"]);
	});

	it("adds breaking and merge markers", () => {
		expect(repoChangelogTags(parseConventionalCommit("feat(api)!: x"))).toEqual(
			["feat", "api", "breaking"],
		);
		expect(
			repoChangelogTags(parseConventionalCommit("Merge branch 'main'")),
		).toEqual(["merge"]);
		expect(
			repoChangelogTags(parseConventionalCommit('Revert "feat(x): y"')),
		).toEqual(["revert"]);
	});

	it("does not repeat a tag that is both type and scope", () => {
		expect(repoChangelogTags(parseConventionalCommit("feat(feat): x"))).toEqual(
			["feat"],
		);
	});

	it("returns no tags for a plain subject", () => {
		expect(
			repoChangelogTags(parseConventionalCommit("tidy up the docs")),
		).toEqual([]);
	});
});

describe("toRepoChangelogEntry", () => {
	it("builds a done entry keyed by short sha", () => {
		const entry = toRepoChangelogEntry(commit());
		expect(entry).not.toBeNull();
		expect(entry?.subject).toBe("repo/85e065f");
		expect(entry?.state).toBe("done");
		expect(entry?.source).toBe("git");
		expect(entry?.priority).toBe("normal");
		expect(entry?.headline).toBe(
			"point the arch template at the Spotlight frame",
		);
		expect(entry?.tags).toEqual(["fix", "drive"]);
	});

	it("attributes the commit author", () => {
		const entry = toRepoChangelogEntry(commit());
		expect(entry?.agentName).toBe("Harrison Halperin");
		expect(entry?.agentId).toBe("git:harrison-halperin");
	});

	it("keeps the display name but drops an unslugifiable agent id", () => {
		// Otherwise every non-Latin author collapses into one `git:` bucket in
		// the status summary.
		const entry = toRepoChangelogEntry(commit({ authorName: "日本語" }));
		expect(entry?.agentName).toBe("日本語");
		expect(entry?.agentId).toBeUndefined();
	});

	it("records commit provenance in metadata", () => {
		const entry = toRepoChangelogEntry(
			commit({ message: "feat(hub-webview): show-backlog rail (#115)" }),
		);
		expect(entry?.metadata).toMatchObject({
			shortSha: "85e065f",
			commitType: "feat",
			commitScopes: ["hub-webview"],
			pullRequest: 115,
			committedAt: "2026-07-30T10:11:12.000Z",
			author: "Harrison Halperin",
		});
	});

	it("puts the body above a provenance block in detail", () => {
		const entry = toRepoChangelogEntry(commit({ body: "Why it matters." }));
		expect(entry?.detail).toContain("Why it matters.");
		expect(entry?.detail).toContain(
			"commit 85e065fb9c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f",
		);
		expect(entry?.detail).toContain("author Harrison Halperin");
	});

	it("still produces provenance detail when the body is empty", () => {
		expect(toRepoChangelogEntry(commit())?.detail).toContain("commit ");
	});

	it("caps a long body so the committed snapshot stays lean", () => {
		const entry = toRepoChangelogEntry(commit({ body: "b".repeat(5000) }));
		expect(entry?.detail?.length).toBeLessThan(1500);
		// The provenance block survives the cap.
		expect(entry?.detail).toContain("author Harrison Halperin");
	});

	it("omits committedAt for an unparseable date", () => {
		const entry = toRepoChangelogEntry(commit({ date: "not a date" }));
		expect(entry?.metadata).not.toHaveProperty("committedAt");
		expect(entry?.detail).not.toContain("date ");
	});

	it("truncates an overlong headline to the schema ceiling", () => {
		const entry = toRepoChangelogEntry(
			commit({ message: `feat(x): ${"a".repeat(500)}` }),
		);
		expect(entry?.headline?.length).toBe(300);
	});

	it("does not split a surrogate pair when truncating", () => {
		// The 300th UTF-16 unit lands mid-emoji; a lone surrogate would be
		// written into the committed JSON as a bare \udXXX.
		const entry = toRepoChangelogEntry(
			commit({ message: `feat(x): ${"a".repeat(290)}${"🚀".repeat(20)}` }),
		);
		const headline = entry?.headline ?? "";
		expect(headline.length).toBeLessThanOrEqual(300);
		expect(headline).toBe(JSON.parse(JSON.stringify(headline)));
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(headline)).toBe(false);
	});

	it("returns null for a record with no sha or no subject", () => {
		expect(toRepoChangelogEntry(commit({ hash: "" }))).toBeNull();
		expect(toRepoChangelogEntry(commit({ message: "   " }))).toBeNull();
	});

	it("honours subject prefix and source overrides", () => {
		const entry = toRepoChangelogEntry(commit(), {
			subjectPrefix: "history",
			source: "seed",
		});
		expect(entry?.subject).toBe("history/85e065f");
		expect(entry?.source).toBe("seed");
	});

	it("is pure: the same record always yields the same entry", () => {
		expect(toRepoChangelogEntry(commit())).toEqual(
			toRepoChangelogEntry(commit()),
		);
	});
});

describe("buildRepoChangelog", () => {
	const records = [
		commit({ hash: "aaaaaaa1", message: "feat(drive): one" }),
		commit({ hash: "bbbbbbb2", message: "fix(hub): two" }),
		commit({ hash: "ccccccc3", message: "docs(sdk): three" }),
	];

	it("maps every usable record in order", () => {
		const entries = buildRepoChangelog(records);
		expect(entries.map((entry) => entry.subject)).toEqual([
			"repo/aaaaaaa",
			"repo/bbbbbbb",
			"repo/ccccccc",
		]);
	});

	it("caps at the limit", () => {
		expect(buildRepoChangelog(records, { limit: 2 })).toHaveLength(2);
	});

	it("drops duplicate shas so a subject is never superseded by itself", () => {
		const entries = buildRepoChangelog([
			records[0] as RepoCommitRecord,
			records[0] as RepoCommitRecord,
		]);
		expect(entries).toHaveLength(1);
	});

	it("skips unusable records without shifting the rest", () => {
		const entries = buildRepoChangelog([
			commit({ hash: "" }),
			records[1] as RepoCommitRecord,
		]);
		expect(entries.map((entry) => entry.subject)).toEqual(["repo/bbbbbbb"]);
	});

	it("gives every entry a non-empty tag list for conventional history", () => {
		for (const entry of buildRepoChangelog(records)) {
			expect(entry.tags?.length).toBeGreaterThan(0);
		}
	});
});

describe("repoChangelogTagVocabulary", () => {
	it("returns the sorted distinct tags", () => {
		const entries = buildRepoChangelog([
			commit({ hash: "aaaaaaa1", message: "feat(drive): one" }),
			commit({ hash: "bbbbbbb2", message: "fix(drive): two" }),
		]);
		expect(repoChangelogTagVocabulary(entries)).toEqual([
			"drive",
			"feat",
			"fix",
		]);
	});
});

describe("isRepoChangelogSnapshot", () => {
	it("accepts a well-formed snapshot", () => {
		expect(
			isRepoChangelogSnapshot({
				kind: "repo_changelog",
				generatedAt: "2026-07-30T10:11:12.000Z",
				entries: [],
			}),
		).toBe(true);
	});

	it("rejects anything else", () => {
		expect(isRepoChangelogSnapshot(null)).toBe(false);
		expect(isRepoChangelogSnapshot({ kind: "other", entries: [] })).toBe(false);
		expect(
			isRepoChangelogSnapshot({ kind: "repo_changelog", generatedAt: "x" }),
		).toBe(false);
	});
});
