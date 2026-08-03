/**
 * Resolve `.driveagent/<slug>/` home directories (DRV-DRIVEAGENT-HOME / ADR-0001).
 *
 * First-match-by-slug: workspace tier, then optional user tier under `~/.driveagent/`.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DRIVEAGENT_DIRECTORY_NAME = ".driveagent";
export const DRIVEAGENT_AGENT_YAML = "agent.yaml";
export const DRIVEAGENT_PERMISSIONS_YAML = "permissions.yaml";
export const DRIVEAGENT_ENV_YAML = "env.yaml";

export type DriveagentHomeTier = "workspace" | "user";

export type ResolvedDriveagentHomeDir = {
	readonly path: string;
	readonly tier: DriveagentHomeTier;
};

export function resolveWorkspaceDriveagentHomeDir(
	workspaceRoot: string,
	slug: string,
): string {
	return join(workspaceRoot, DRIVEAGENT_DIRECTORY_NAME, slug);
}

export function resolveUserDriveagentHomeDir(
	slug: string,
	homeDir: string = homedir(),
): string {
	return join(homeDir, DRIVEAGENT_DIRECTORY_NAME, slug);
}

function hasAgentYaml(homeDir: string): boolean {
	return existsSync(join(homeDir, DRIVEAGENT_AGENT_YAML));
}

/**
 * Resolve an on-disk Driveagent home directory for `slug`.
 * Returns null when neither workspace nor user tier has `agent.yaml`.
 */
export function resolveDriveagentHomeDir(input: {
	workspaceRoot: string;
	slug: string;
	/** Override for tests; defaults to `os.homedir()`. */
	userHomeDir?: string;
}): ResolvedDriveagentHomeDir | null {
	const workspacePath = resolveWorkspaceDriveagentHomeDir(
		input.workspaceRoot,
		input.slug,
	);
	if (hasAgentYaml(workspacePath)) {
		return { path: workspacePath, tier: "workspace" };
	}

	const userPath = resolveUserDriveagentHomeDir(
		input.slug,
		input.userHomeDir ?? homedir(),
	);
	if (hasAgentYaml(userPath)) {
		return { path: userPath, tier: "user" };
	}

	return null;
}

/** Slugs are the directory name, and the loader only accepts this shape. */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

function readSlugsIn(parentDir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(parentDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		// A workspace with no `.driveagent/` is the normal case, not an error.
		return [];
	}
	return entries.filter(
		(name) => SLUG_PATTERN.test(name) && hasAgentYaml(join(parentDir, name)),
	);
}

/**
 * Every Driveagent home reachable from this workspace, workspace tier first.
 *
 * Mirrors {@link resolveDriveagentHomeDir}'s first-match-by-slug rule: a slug
 * present in both tiers is listed once, as `workspace`, because that is the one
 * a read would actually open. Directories without an `agent.yaml` are skipped —
 * a folder is not a home, and listing one would produce a profile page that
 * cannot load.
 */
export function listDriveagentHomeDirs(input: {
	workspaceRoot: string;
	/** Override for tests; defaults to `os.homedir()`. */
	userHomeDir?: string;
}): Array<ResolvedDriveagentHomeDir & { slug: string }> {
	const workspaceParent = join(input.workspaceRoot, DRIVEAGENT_DIRECTORY_NAME);
	const userParent = join(
		input.userHomeDir ?? homedir(),
		DRIVEAGENT_DIRECTORY_NAME,
	);
	const seen = new Set<string>();
	const homes: Array<ResolvedDriveagentHomeDir & { slug: string }> = [];

	for (const slug of readSlugsIn(workspaceParent)) {
		seen.add(slug);
		homes.push({
			slug,
			path: join(workspaceParent, slug),
			tier: "workspace",
		});
	}
	for (const slug of readSlugsIn(userParent)) {
		if (seen.has(slug)) {
			continue;
		}
		seen.add(slug);
		homes.push({ slug, path: join(userParent, slug), tier: "user" });
	}
	return homes.sort((a, b) => a.slug.localeCompare(b.slug));
}
