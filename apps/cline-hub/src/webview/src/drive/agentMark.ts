/**
 * Which mark an agent wears (DRV-AGENT-PROFILE).
 *
 * The Cline bot head is Cline's mark, not "the agent icon". Before this, the
 * shared screen gated it on a boolean — `stageSharer === "agent"` — so a
 * seated reviewer, a docs agent, anything at all, presented under Cline's face.
 * Identity is the gate now: only the builtin pair partner gets the mark, and
 * every other agent gets its own initial.
 */

import { assertNeverAgentRef, type Participant } from "@cline/shared";
import { DRIVE_PARTICIPANT_PARTNER } from "./types";

/** The builtin ref id Cline is seated under (`drive.defaults.pairAgent`). */
export const CLINE_BUILTIN_REF_ID = "pair_partner";

export type AgentAvatarKind = "cline-mark" | "initial";

/**
 * True only for the builtin pair partner.
 *
 * A `driveagent` home named `pair-partner` is deliberately *not* Cline: it is a
 * workspace-authored agent that happens to share a slug, with its own prompt
 * and its own permissions. Wearing Cline's mark would be a claim about who is
 * answering.
 */
export function isClineParticipant(participant: Participant): boolean {
	if (participant.kind !== "agent") {
		return false;
	}
	const ref = participant.ref;
	if (ref) {
		switch (ref.kind) {
			case "builtin":
				return ref.id === CLINE_BUILTIN_REF_ID;
			case "driveagent":
			case "configured":
				return false;
			default:
				return assertNeverAgentRef(ref);
		}
	}
	// Seats written before `ref` existed carry no identity at all. The one
	// pre-ref seat whose identity is not in doubt is the hub's own partner id,
	// which only ever named the builtin partner. Role alone is not enough —
	// any Driveagent can be seated as `partner`.
	return participant.id === DRIVE_PARTICIPANT_PARTNER;
}

export function agentAvatarKind(participant: Participant): AgentAvatarKind {
	return isClineParticipant(participant) ? "cline-mark" : "initial";
}

/**
 * The letter a non-Cline participant wears.
 *
 * Falls back to the participant id so a blank display name renders *something*
 * stable rather than an empty circle, and to `?` when even that is empty.
 */
export function agentAvatarInitial(participant: Participant): string {
	const source = participant.displayName.trim() || participant.id.trim() || "?";
	return source.slice(0, 1).toUpperCase();
}
