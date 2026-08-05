/**
 * Pure directory load for `/agents` — kept out of the React module so node-env
 * tests do not pull `@/` UI imports.
 */

import type { AgentRef, InkRef } from "@cline/shared";
import { agentProfileId } from "@cline/shared";
import { requestDriveAgentProfiles } from "./requestDriveAgentProfiles";
import {
	type DriveagentHomeListing,
	requestDriveagentHomeList,
} from "./requestDriveagentHome";

export type DirectoryEntry = {
	profileId: string;
	ref: AgentRef;
	displayName: string;
	description?: string;
	tier?: "workspace" | "user";
	skills?: string[];
	nameInk: InkRef | null;
};

function titleCase(slug: string): string {
	return slug
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}

/**
 * Fold the two durable sources into one list.
 *
 * Homes come first because a home is the richer record; a durably-styled agent
 * with no home is still listed, since someone deliberately gave it a colour and
 * it would be strange for the page that stores that to pretend it does not
 * exist.
 */
export function buildDirectoryEntries(
	homes: readonly DriveagentHomeListing[],
	profiles: readonly {
		id: string;
		ref: AgentRef;
		displayName?: string;
		nameInk: InkRef;
	}[],
): DirectoryEntry[] {
	const byId = new Map<string, DirectoryEntry>();
	for (const home of homes) {
		const ref: AgentRef = { kind: "driveagent", slug: home.slug };
		const id = agentProfileId(ref);
		byId.set(id, {
			profileId: id,
			ref,
			displayName: home.displayName?.trim() || titleCase(home.slug),
			...(home.description ? { description: home.description } : {}),
			tier: home.tier,
			...(home.skills?.length ? { skills: home.skills } : {}),
			nameInk: null,
		});
	}
	for (const profile of profiles) {
		const existing = byId.get(profile.id);
		if (existing) {
			existing.nameInk = profile.nameInk;
			if (profile.displayName?.trim()) {
				existing.displayName = profile.displayName.trim();
			}
			continue;
		}
		byId.set(profile.id, {
			profileId: profile.id,
			ref: profile.ref,
			displayName:
				profile.displayName?.trim() ||
				titleCase(
					profile.ref.kind === "driveagent" ? profile.ref.slug : profile.ref.id,
				),
			nameInk: profile.nameInk,
		});
	}
	return [...byId.values()].sort((a, b) =>
		a.displayName.localeCompare(b.displayName),
	);
}

/**
 * Load homes + appearance profiles without silently substituting an empty
 * directory for a hub timeout (ux-quality phase 0 / defaults-delivery A3).
 * Partial success still renders what arrived and announces the failed half.
 */
export async function loadDirectorySources(root: string): Promise<{
	entries: DirectoryEntry[];
	error: string | null;
}> {
	const [homesResult, profilesResult] = await Promise.allSettled([
		requestDriveagentHomeList(root),
		requestDriveAgentProfiles(root),
	]);
	const homes =
		homesResult.status === "fulfilled"
			? homesResult.value
			: ([] as DriveagentHomeListing[]);
	const profiles =
		profilesResult.status === "fulfilled" ? profilesResult.value : [];

	if (
		homesResult.status === "rejected" &&
		profilesResult.status === "rejected"
	) {
		const cause = homesResult.reason;
		return {
			entries: [],
			error: cause instanceof Error ? cause.message : String(cause),
		};
	}

	const notices: string[] = [];
	if (homesResult.status === "rejected") {
		notices.push(
			homesResult.reason instanceof Error
				? homesResult.reason.message
				: String(homesResult.reason),
		);
	}
	if (profilesResult.status === "rejected") {
		notices.push(
			profilesResult.reason instanceof Error
				? profilesResult.reason.message
				: String(profilesResult.reason),
		);
	}

	return {
		entries: buildDirectoryEntries(homes, profiles),
		error: notices.length > 0 ? notices.join(" · ") : null,
	};
}
