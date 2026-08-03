/**
 * Which roster packs name an agent (DRV-AGENT-PROFILE, display only).
 *
 * Scope, stated once so the UI can repeat it: a pack is a *list*. Adding one
 * seats its members' room metadata via `call_add_roster_pack` and nothing more
 * — no member gets a runtime of its own, because there is exactly one Cline
 * runtime behind the feed. Nothing in the tree writes a `{kind:"spawn"}` seat
 * source, so "the team spawns itself" is not a thing this can show.
 */

import type { AgentRef, RosterPack } from "@cline/shared";

export type AgentTeam = {
	id: string;
	displayName: string;
	description?: string;
	/** Every member's profile id, in pack order — this agent included. */
	memberProfileIds: string[];
};

/**
 * True when a pack member names this profile.
 *
 * Tolerant of two spellings because the shipped pack fixtures predate the
 * flattened id convention: `RosterPack.members[].profileId` is documented as an
 * `AgentProfile.id` (`builtin.test-fixer`), but the in-tree catalog writes the
 * bare ref id (`test-fixer`). Matching both keeps existing packs findable
 * without silently rewriting anyone's catalog.
 */
export function packMemberMatchesProfile(
	memberProfileId: string,
	profileId: string,
	ref: AgentRef | null,
): boolean {
	if (memberProfileId === profileId) {
		return true;
	}
	if (!ref) {
		return false;
	}
	const bare = ref.kind === "driveagent" ? ref.slug : ref.id;
	return memberProfileId === bare;
}

export function teamsForProfile(
	profileId: string,
	ref: AgentRef | null,
	packs: readonly RosterPack[],
): AgentTeam[] {
	const teams: AgentTeam[] = [];
	for (const pack of packs) {
		const member = pack.members.some((entry) =>
			packMemberMatchesProfile(entry.profileId, profileId, ref),
		);
		if (!member) {
			continue;
		}
		teams.push({
			id: pack.id,
			displayName: pack.displayName,
			...(pack.description ? { description: pack.description } : {}),
			memberProfileIds: pack.members.map((entry) => entry.profileId),
		});
	}
	return teams;
}

/** The `.driveagent/<slug>/` home a ref names, or null when it has none. */
export function homeSlugForRef(ref: AgentRef | null): string | null {
	return ref?.kind === "driveagent" ? ref.slug : null;
}
