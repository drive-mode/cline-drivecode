/**
 * The `ref` a `call_seat` frame may honestly carry (DRV-AGENT-PROFILE).
 *
 * The hub records `ref` verbatim into an append-only join event, which is why
 * `AgentParticipantSchema` leaves it optional "forever": a wrong ref is a
 * durable false claim about who was in the room, and absent is the honest
 * reading. So this only ever answers from evidence — a slug the hub listed as a
 * real `.driveagent/<slug>/` home, or the one participant id that has only ever
 * meant the builtin pair partner. Everything else gets null and the frame ships
 * without a ref, exactly as before.
 */

import type { RecruitCandidate } from "@cline/drive";
import type { AgentRef } from "@cline/shared";
import type { DriveagentHomeListing } from "./driveagentHomeTypes";
import { DRIVE_PARTICIPANT_PARTNER } from "./types";

/** The builtin ref id Cline is seated under. */
export const CLINE_BUILTIN_REF_ID = "pair_partner";

const DRIVEAGENT_SLUG = /^[a-z0-9-]+$/;

export function resolveSeatRef(
	slug: string,
	knownHomeSlugs: ReadonlySet<string>,
): AgentRef | null {
	const trimmed = slug.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed === DRIVE_PARTICIPANT_PARTNER || trimmed === "pair-partner") {
		// `drive:partner` is the hub's own id for the builtin partner, and the
		// picker offers it under the `pair-partner` label. Both name the builtin
		// — a workspace home of the same slug is handled below and wins, because
		// a workspace-authored agent is not the builtin one.
		if (trimmed === "pair-partner" && knownHomeSlugs.has("pair-partner")) {
			return { kind: "driveagent", slug: "pair-partner" };
		}
		return { kind: "builtin", id: CLINE_BUILTIN_REF_ID };
	}
	if (DRIVEAGENT_SLUG.test(trimmed) && knownHomeSlugs.has(trimmed)) {
		return { kind: "driveagent", slug: trimmed };
	}
	return null;
}

/**
 * Recruit candidates for the workspace's real Driveagent homes.
 *
 * These are the entries whose seat can carry a ref, so they are what make the
 * identity spine reachable from the UI at all. Labels come from the home's own
 * slug, name and skills — no utterance text, per DRV-RECRUIT.
 */
export function homeRecruitCandidates(
	homes: readonly DriveagentHomeListing[],
): RecruitCandidate[] {
	return homes.map((home) => ({
		slug: home.slug,
		displayName: home.displayName?.trim() || home.slug,
		labels: [home.slug, ...(home.displayName ? [home.displayName] : [])],
		domains: home.skills ?? [],
	}));
}
