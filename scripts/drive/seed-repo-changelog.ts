#!/usr/bin/env bun

/**
 * Write the committed repo changelog snapshot from local git history.
 *
 * Reads this checkout with `simple-git` and writes
 * `docs/drivecode/assets/changelog/repo-changelog.json`, which the hub seeds
 * into the Status Hub on start. Local git rather than the GitHub API on
 * purpose: the demo canvas ships no `connect-src`, the hub is local-only by
 * design, and a committed snapshot works offline with no rate limit or token.
 *
 * Usage:
 *   bun scripts/drive/seed-repo-changelog.ts [--limit 150] [--out <path>]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import simpleGit from "simple-git";
import {
	buildRepoChangelog,
	REPO_CHANGELOG_SNAPSHOT_KIND,
	REPO_CHANGELOG_SNAPSHOT_PATH,
	type RepoChangelogSnapshot,
	type RepoCommitRecord,
	repoChangelogTagVocabulary,
} from "../../sdk/packages/drive/src/changelog/repoChangelog.ts";

const DEFAULT_LIMIT = 150;
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

type GitLogFields = {
	hash: string;
	date: string;
	message: string;
	body: string;
	authorName: string;
};

type Args = {
	limit: number;
	out: string;
};

function parseArgs(argv: readonly string[]): Args {
	let limit = DEFAULT_LIMIT;
	let out = join(REPO_ROOT, REPO_CHANGELOG_SNAPSHOT_PATH);

	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (flag === "--limit" && value) {
			const parsed = Number.parseInt(value, 10);
			if (!Number.isSafeInteger(parsed) || parsed <= 0) {
				throw new Error(`--limit expects a positive integer, got ${value}`);
			}
			limit = parsed;
			i += 1;
		} else if (flag === "--out" && value) {
			out = isAbsolute(value) ? value : resolve(process.cwd(), value);
			i += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"Usage: bun scripts/drive/seed-repo-changelog.ts [--limit N] [--out PATH]",
			);
			process.exit(0);
		} else {
			throw new Error(`Unrecognized argument: ${flag}`);
		}
	}

	return { limit, out };
}

/** `git@host:owner/repo.git` / `https://host/owner/repo.git` → `owner/repo`. */
function shortRepositoryName(url: string | undefined): string | undefined {
	if (!url) {
		return undefined;
	}
	const match = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
	return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : undefined;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const git = simpleGit(REPO_ROOT);

	// Committer date (`%cI`), not simple-git's default author date: `git log`
	// orders by committer date, so an author date would put a rebased commit
	// out of order against the `seq` the store hands out on seed.
	const log = await git.log<GitLogFields>({
		maxCount: args.limit,
		format: {
			hash: "%H",
			date: "%cI",
			message: "%s",
			body: "%b",
			authorName: "%an",
		},
	});

	const records: RepoCommitRecord[] = log.all.map((entry) => ({
		hash: entry.hash,
		date: entry.date,
		message: entry.message,
		body: entry.body,
		authorName: entry.authorName,
	}));

	// `git log` is newest-first; the snapshot is stored in publish order so the
	// store's monotonic `seq` ends up matching commit order.
	const entries = buildRepoChangelog(records, { limit: args.limit }).reverse();

	const [remotes, branch] = await Promise.all([
		git.getRemotes(true).catch(() => []),
		git.revparse(["--abbrev-ref", "HEAD"]).catch(() => undefined),
	]);
	const origin =
		remotes.find((remote) => remote.name === "origin") ?? remotes[0];
	const repository = shortRepositoryName(origin?.refs?.fetch);

	const snapshot: RepoChangelogSnapshot = {
		kind: REPO_CHANGELOG_SNAPSHOT_KIND,
		generatedAt: new Date().toISOString(),
		...(repository ? { repository } : {}),
		...(branch?.trim() ? { branch: branch.trim() } : {}),
		entries,
	};

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(
		args.out,
		`${JSON.stringify(snapshot, null, "\t")}\n`,
		"utf8",
	);

	const vocabulary = repoChangelogTagVocabulary(entries);
	const untagged = entries.filter((entry) => (entry.tags ?? []).length === 0);
	console.log(`Wrote ${entries.length} changelog entries to ${args.out}`);
	console.log(`Tags (${vocabulary.length}): ${vocabulary.join(", ")}`);
	console.log(`Untagged entries: ${untagged.length}`);
}

await main();
