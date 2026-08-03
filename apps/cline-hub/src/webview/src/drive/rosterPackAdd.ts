/**
 * Roster pack add planning (DRV-ROSTER-PACK).
 * expandRosterPack proposes; UI fail-closes on seatCap before hub seats.
 */

import {
	expandRosterPack,
	type SeatProposal,
} from "@cline/drive";
import type {
	AgentProfile,
	PermissionPreset,
	RosterPack,
} from "@cline/shared";

const ink = { kind: "token" as const, token: "foreground" as const };

/** Fixture packs when no live catalog is wired. */
export const FIXTURE_ROSTER_PACKS: readonly RosterPack[] = [
	{
		id: "pair",
		slug: "pair",
		displayName: "Pair",
		description: "Single specialist seat",
		members: [{ profileId: "security-reviewer", role: "specialist" }],
		addressable: true,
	},
	{
		id: "security-crew",
		slug: "security-crew",
		displayName: "Cybersecurity",
		description: "Security + test crew (needs multi-agent seatCap)",
		members: [
			{ profileId: "security-reviewer", role: "specialist" },
			{ profileId: "test-fixer", role: "specialist" },
		],
		addressable: true,
	},
	{
		id: "review",
		slug: "review",
		displayName: "Review",
		description: "Code review specialist",
		members: [{ profileId: "test-fixer", role: "specialist" }],
		addressable: true,
	},
];

export function stubProfilesForPack(
	pack: RosterPack,
): Map<string, AgentProfile> {
	const profiles = new Map<string, AgentProfile>();
	for (const member of pack.members) {
		const id = member.profileId;
		profiles.set(id, {
			id,
			ref: { kind: "builtin", id },
			displayName:
				member.override?.displayName?.trim() ||
				id
					.split("-")
					.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
					.join(" "),
			nameInk: ink,
			bodyInk: ink,
		});
	}
	return profiles;
}

export type PlanRosterPackAddOk = {
	ok: true;
	proposals: SeatProposal[];
	missing: string[];
};

export type PlanRosterPackAddBlocked = {
	ok: false;
	reason: "seat_cap";
	message: string;
	missing: string[];
	memberCount: number;
	seatCap: number;
};

export type PlanRosterPackAddResult =
	| PlanRosterPackAddOk
	| PlanRosterPackAddBlocked;

/**
 * Fail-closed when the pack needs more seats than seatCap (team opt off).
 * Single-member packs under seatCap 1 succeed.
 */
export function planRosterPackAdd(input: {
	pack: RosterPack;
	profiles?: ReadonlyMap<string, AgentProfile>;
	parentPreset?: PermissionPreset;
	seatCap: number;
}): PlanRosterPackAddResult {
	const seatCap = Math.max(0, Math.floor(input.seatCap));
	const profiles = input.profiles ?? stubProfilesForPack(input.pack);
	const memberCount = input.pack.members.length;
	if (memberCount > seatCap) {
		return {
			ok: false,
			reason: "seat_cap",
			message: `Pack has ${memberCount} members but seatCap is ${seatCap}. Enable multi-agent (team opt) or pick a smaller pack.`,
			missing: [],
			memberCount,
			seatCap,
		};
	}
	const expanded = expandRosterPack({
		pack: input.pack,
		profiles,
		parentPreset: input.parentPreset ?? "standard",
		seatCap,
	});
	if (expanded.truncated) {
		return {
			ok: false,
			reason: "seat_cap",
			message: `Pack would truncate under seatCap ${seatCap}. Enable multi-agent (team opt) or pick a smaller pack.`,
			missing: expanded.missing,
			memberCount,
			seatCap,
		};
	}
	return {
		ok: true,
		proposals: expanded.proposals,
		missing: expanded.missing,
	};
}

export function lookupFixtureRosterPack(
	packIdOrSlug: string,
	packs: readonly RosterPack[] = FIXTURE_ROSTER_PACKS,
): RosterPack | null {
	const key = packIdOrSlug.trim();
	if (!key) {
		return null;
	}
	return (
		packs.find((pack) => pack.id === key || pack.slug === key) ?? null
	);
}
