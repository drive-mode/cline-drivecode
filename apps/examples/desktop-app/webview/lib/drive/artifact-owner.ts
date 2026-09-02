/**
 * Who produced an artifact, and what colour their name wears.
 *
 * The directory records `ownerParticipantId` only. The seated roster (when
 * the room is live) gives the display name and the durable agent ref; stored
 * appearance profiles give the ink; `@cline/drive`'s resolver turns the ink
 * into a contrast-clamped colour. A component never picks a colour itself —
 * the resolver is the one place the clamp lives.
 */

import { type DriveInkTheme, resolveInk } from "@cline/drive";
import {
	type AgentProfile,
	agentProfileId,
	type Participant,
} from "@cline/shared";

const HUMAN_PREFIXES = ["drive:human", "human:", "you"] as const;

function findParticipant(
	ownerId: string,
	participants: readonly Participant[],
): Participant | undefined {
	return participants.find((participant) => participant.id === ownerId);
}

/** Humans keep the chrome colours; only agents carry an identity ink. */
export function isHumanOwner(
	ownerId: string,
	participants: readonly Participant[] = [],
): boolean {
	const seated = findParticipant(ownerId, participants);
	if (seated) {
		return seated.kind === "human";
	}
	const lower = ownerId.toLowerCase();
	return HUMAN_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Display name for an owner: the seated participant's name when the room
 * knows them, otherwise a readable form of the id (`agent:riley` → "Riley",
 * `drive:partner` → "Cline", `drive:human` → "You").
 */
export function artifactOwnerLabel(
	ownerId: string,
	participants: readonly Participant[] = [],
): string {
	const seated = findParticipant(ownerId, participants);
	if (seated) {
		return seated.displayName;
	}
	const lower = ownerId.toLowerCase();
	if (lower === "drive:partner") {
		return "Cline";
	}
	if (lower === "drive:human") {
		return "You";
	}
	const separator = Math.max(
		ownerId.lastIndexOf(":"),
		ownerId.lastIndexOf("/"),
	);
	const tail = separator >= 0 ? ownerId.slice(separator + 1) : ownerId;
	const cleaned = tail.replace(/[-_.]+/g, " ").trim();
	if (!cleaned) {
		return ownerId;
	}
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Durable key the owner's appearance is stored under. `participant.ref` is
 * authoritative when the seat recorded one; otherwise the id stands in —
 * still stable per agent, which is all the default hash needs.
 */
export function artifactOwnerProfileId(
	ownerId: string,
	participants: readonly Participant[] = [],
): string {
	const seated = findParticipant(ownerId, participants);
	if (seated?.kind === "agent" && seated.ref) {
		return agentProfileId(seated.ref);
	}
	return ownerId;
}

/**
 * Resolved CSS colour for the owner's name, or undefined for a human (the
 * caller leaves its class alone). Stored ink wins; otherwise the resolver's
 * per-agent default keeps two unconfigured agents distinguishable.
 */
export function artifactOwnerInk(input: {
	ownerId: string;
	participants?: readonly Participant[];
	profiles?: readonly AgentProfile[];
	theme: DriveInkTheme;
}): string | undefined {
	const participants = input.participants ?? [];
	if (isHumanOwner(input.ownerId, participants)) {
		return undefined;
	}
	const profileId = artifactOwnerProfileId(input.ownerId, participants);
	const profile = input.profiles?.find((entry) => entry.id === profileId);
	return resolveInk({
		ink: profile?.nameInk ?? null,
		channel: "name",
		profileId,
		theme: input.theme,
	}).color;
}

/** Initials for an owner avatar — one or two letters, never empty. */
export function artifactOwnerInitials(label: string): string {
	const words = label
		.split(/\s+/)
		.map((word) => word.trim())
		.filter(Boolean);
	if (words.length === 0) {
		return "?";
	}
	if (words.length === 1) {
		return words[0].slice(0, 2).toUpperCase();
	}
	return `${words[0].charAt(0)}${words[words.length - 1].charAt(0)}`.toUpperCase();
}
