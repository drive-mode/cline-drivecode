/**
 * Repo changelog: git history → Status Hub publish inputs (pure).
 *
 * The Status Hub changelog is only as interesting as what has been published
 * into it, and a fresh hub has published nothing. This module turns the repo's
 * own commit history into publishable status updates so the changelog opens
 * with real work rather than an empty feed.
 *
 * Pure by construction: no filesystem, no git process, no clock. A caller reads
 * `git log` (see `scripts/drive/seed-repo-changelog.ts`) and hands the records
 * here; everything below is a deterministic function of its input, so the tag
 * derivation that gives the changelog its filters is unit-testable on its own.
 */

import type { StatusPublishInput } from "@cline/shared";

/** One `git log` record, narrowed to the fields the changelog needs. */
export type RepoCommitRecord = {
	/** Full commit sha. */
	hash: string;
	/** Author date, ISO-8601 or anything `Date` can parse. */
	date: string;
	/** Subject line (first line of the commit message). */
	message: string;
	/** Remaining commit message lines, when any. */
	body?: string;
	/** Commit author's display name. */
	authorName?: string;
};

/** What a Conventional Commits subject line decomposes into. */
export type ConventionalCommit = {
	/** `feat`, `fix`, `docs`, … Absent when the subject is not conventional. */
	type?: string;
	/** Scope segments, split on `,` and `/`: `feat(drive,hub)` → two scopes. */
	scopes: string[];
	/** `feat(x)!:` or a `BREAKING CHANGE:` body trailer. */
	breaking: boolean;
	/** Subject with the `type(scope):` prefix removed. */
	description: string;
	/** A `Merge pull request #12` / `Merge branch …` commit. */
	merge: boolean;
	/** A `Revert "…"` commit. */
	revert: boolean;
	/** Pull request number from a trailing `(#123)`, when present. */
	pullRequest?: number;
};

export type BuildRepoChangelogOptions = {
	/** Subject prefix for every entry. Defaults to `repo`. */
	subjectPrefix?: string;
	/** `source` recorded on every entry. Defaults to `git`. */
	source?: string;
	/** Cap on how many entries come back. Defaults to every record given. */
	limit?: number;
};

/** The committed snapshot shape read back by the hub seeder. */
export type RepoChangelogSnapshot = {
	kind: "repo_changelog";
	/** ISO instant the snapshot was generated. */
	generatedAt: string;
	/** `owner/repo` of the origin remote, when the seeding checkout had one. */
	repository?: string;
	/** Branch the snapshot was taken from, when known. */
	branch?: string;
	/**
	 * Publish order: oldest commit first.
	 *
	 * The store assigns `seq` on insert and the changelog reads newest `seq`
	 * first, so seeding in commit order is what makes the seeded feed read in
	 * commit order. Newest-first entries would invert the whole changelog.
	 */
	entries: StatusPublishInput[];
};

export const REPO_CHANGELOG_SNAPSHOT_KIND = "repo_changelog" as const;

/** Where the committed snapshot lives, relative to the repo root. */
export const REPO_CHANGELOG_SNAPSHOT_PATH =
	"docs/drivecode/assets/changelog/repo-changelog.json";

const DEFAULT_SUBJECT_PREFIX = "repo";
const DEFAULT_SOURCE = "git";
const SHORT_SHA_LENGTH = 7;
const HEADLINE_MAX = 300;
const DETAIL_MAX = 10_000;
/**
 * Commit bodies in this repo run long, and the changelog snapshot is a
 * committed artifact — an uncapped body makes the file grow without making the
 * feed any more readable.
 */
const DETAIL_BODY_MAX = 1_200;

/**
 * `type(scope)!: description`.
 *
 * Deliberately strict about the type token — letters only — so that a subject
 * such as `Fix AskSage custom API URL being ignored (#12843)` is treated as a
 * plain subject rather than as a `fix` whose scope is the rest of the sentence.
 */
const CONVENTIONAL_SUBJECT = /^([a-z][a-z]*)(?:\(([^)]*)\))?(!)?:\s*(.*)$/i;
const MERGE_SUBJECT = /^merge\b/i;
const REVERT_SUBJECT = /^revert\b/i;
const PULL_REQUEST_SUFFIX = /\(#(\d+)\)\s*$/;
const BREAKING_TRAILER = /^BREAKING[ -]CHANGE:/m;

function normalizeTag(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Split a conventional-commit subject into its parts. Never throws. */
export function parseConventionalCommit(
	subject: string,
	body?: string,
): ConventionalCommit {
	const trimmed = subject.trim();
	const merge = MERGE_SUBJECT.test(trimmed);
	const revert = REVERT_SUBJECT.test(trimmed);
	const breakingTrailer = body != null && BREAKING_TRAILER.test(body);
	const pullRequest = readPullRequestNumber(trimmed);

	const match = CONVENTIONAL_SUBJECT.exec(trimmed);
	if (!match) {
		return {
			scopes: [],
			breaking: breakingTrailer,
			description: trimmed,
			merge,
			revert,
			...(pullRequest != null ? { pullRequest } : {}),
		};
	}

	const [, rawType, rawScope, bang, rawDescription] = match;
	const description = rawDescription?.trim() ?? "";
	const scopes = (rawScope ?? "")
		.split(/[,/]/)
		.map(normalizeTag)
		.filter((scope) => scope.length > 0);

	return {
		type: normalizeTag(rawType ?? "") || undefined,
		scopes,
		breaking: bang === "!" || breakingTrailer,
		// A subject of exactly `chore:` leaves nothing to show; keep the raw
		// line rather than publishing an empty headline.
		description: description || trimmed,
		merge,
		revert,
		...(pullRequest != null ? { pullRequest } : {}),
	};
}

function readPullRequestNumber(subject: string): number | undefined {
	const match = PULL_REQUEST_SUFFIX.exec(subject);
	if (!match?.[1]) {
		return undefined;
	}
	const parsed = Number.parseInt(match[1], 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Tags for one commit: its conventional type, then each scope, then the
 * structural markers. Order is stable and duplicates are dropped so that
 * `feat(feat)` does not produce the same tag twice.
 */
export function repoChangelogTags(commit: ConventionalCommit): string[] {
	const tags: string[] = [];
	const push = (tag: string) => {
		if (tag && !tags.includes(tag)) {
			tags.push(tag);
		}
	};

	if (commit.type) {
		push(commit.type);
	}
	for (const scope of commit.scopes) {
		push(scope);
	}
	if (commit.breaking) {
		push("breaking");
	}
	if (commit.merge) {
		push("merge");
	}
	if (commit.revert) {
		push("revert");
	}
	return tags;
}

function shortSha(hash: string): string {
	return hash.trim().toLowerCase().slice(0, SHORT_SHA_LENGTH);
}

function toIsoDate(value: string): string | undefined {
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function truncate(value: string, max: number): string {
	if (value.length <= max) {
		return value;
	}
	let cut = value.slice(0, max - 1);
	// Never leave a lone high surrogate behind: the snapshot is JSON on disk,
	// and a split emoji serializes as a bare `\udXXX`.
	const last = cut.charCodeAt(cut.length - 1);
	if (last >= 0xd800 && last <= 0xdbff) {
		cut = cut.slice(0, -1);
	}
	return `${cut}…`;
}

function buildDetail(
	record: RepoCommitRecord,
	commit: ConventionalCommit,
	committedAt: string | undefined,
): string | undefined {
	const provenance = [
		`commit ${record.hash.trim()}`,
		record.authorName?.trim()
			? `author ${record.authorName.trim()}`
			: undefined,
		committedAt ? `date ${committedAt}` : undefined,
		commit.pullRequest != null
			? `pull request #${commit.pullRequest}`
			: undefined,
	].filter((line): line is string => line != null);

	const body = record.body?.trim();
	const detail = body
		? `${truncate(body, DETAIL_BODY_MAX)}\n\n${provenance.join("\n")}`
		: provenance.join("\n");
	return truncate(detail, DETAIL_MAX);
}

/**
 * Turn one commit into a publish input, or null when the record is unusable
 * (no sha, or an empty subject line — neither can produce a valid update).
 */
export function toRepoChangelogEntry(
	record: RepoCommitRecord,
	options: BuildRepoChangelogOptions = {},
): StatusPublishInput | null {
	const sha = shortSha(record.hash ?? "");
	const subjectLine = record.message?.trim() ?? "";
	if (sha.length === 0 || subjectLine.length === 0) {
		return null;
	}

	const commit = parseConventionalCommit(subjectLine, record.body);
	const committedAt = toIsoDate(record.date ?? "");
	const prefix = options.subjectPrefix ?? DEFAULT_SUBJECT_PREFIX;
	const authorName = record.authorName?.trim();
	// A name with no ASCII alphanumerics normalizes to the empty string, which
	// would collapse every such author into one `git:` bucket in the summary.
	const authorSlug = authorName ? normalizeTag(authorName) : "";

	return {
		subject: `${prefix}/${sha}`,
		state: "done",
		headline: truncate(commit.description, HEADLINE_MAX),
		detail: buildDetail(record, commit, committedAt),
		priority: "normal",
		source: options.source ?? DEFAULT_SOURCE,
		tags: repoChangelogTags(commit),
		...(authorSlug ? { agentId: `git:${authorSlug}` } : {}),
		...(authorName ? { agentName: authorName } : {}),
		metadata: {
			sha: record.hash.trim(),
			shortSha: sha,
			subjectLine,
			...(commit.type ? { commitType: commit.type } : {}),
			...(commit.scopes.length > 0 ? { commitScopes: commit.scopes } : {}),
			...(commit.breaking ? { breaking: true } : {}),
			...(commit.merge ? { merge: true } : {}),
			...(commit.revert ? { revert: true } : {}),
			...(commit.pullRequest != null
				? { pullRequest: commit.pullRequest }
				: {}),
			...(committedAt ? { committedAt } : {}),
			...(authorName ? { author: authorName } : {}),
		},
	};
}

/**
 * Build the changelog from newest-first git records.
 *
 * Duplicate shas collapse to the first occurrence: publishing the same subject
 * twice would supersede the earlier row and silently halve the feed.
 */
export function buildRepoChangelog(
	records: readonly RepoCommitRecord[],
	options: BuildRepoChangelogOptions = {},
): StatusPublishInput[] {
	const entries: StatusPublishInput[] = [];
	const seen = new Set<string>();
	const limit = options.limit ?? records.length;

	for (const record of records) {
		if (entries.length >= limit) {
			break;
		}
		const entry = toRepoChangelogEntry(record, options);
		if (!entry || seen.has(entry.subject)) {
			continue;
		}
		seen.add(entry.subject);
		entries.push(entry);
	}
	return entries;
}

/** Every distinct tag in a changelog, sorted — the filter vocabulary. */
export function repoChangelogTagVocabulary(
	entries: readonly StatusPublishInput[],
): string[] {
	const tags = new Set<string>();
	for (const entry of entries) {
		for (const tag of entry.tags ?? []) {
			tags.add(tag);
		}
	}
	return [...tags].sort();
}

/** Structural check for a snapshot read back from disk. */
export function isRepoChangelogSnapshot(
	value: unknown,
): value is RepoChangelogSnapshot {
	if (value == null || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.kind === REPO_CHANGELOG_SNAPSHOT_KIND &&
		typeof record.generatedAt === "string" &&
		Array.isArray(record.entries)
	);
}
