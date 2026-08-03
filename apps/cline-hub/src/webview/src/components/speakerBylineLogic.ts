import type { Participant } from "@cline/shared";

/**
 * Resolve the byline shown above a feed message.
 *
 * Returns null whenever the speaker is unknown, and the caller must then
 * render no byline element at all — not an empty one, not a placeholder.
 *
 * `speakerId` names the agent the turn was **addressed to**, which is as far
 * as the room data goes today: seating creates no runtime (`call_seat` commits
 * room metadata only, and one Cline runtime sits behind the feed), and nothing
 * routes the addressed agent's persona into it. So most messages land here
 * with no id at all. Defaulting those to the partner — or to "Cline", which is
 * usually right — would be a guess that reads as a working feature, so it is
 * not done here.
 *
 * An id that no longer matches a seated participant also returns null: the
 * raw id is not a name, and printing `drive:partner` is not attribution.
 *
 * Participants are the live roster, not the roster as of the message. A
 * rename, or a room switch, restyles past bylines — acceptable while the
 * roster is per-call, and the thing to revisit when the feed spans rooms.
 */
export function resolveSpeakerByline(
	speakerId: string | undefined,
	participants: readonly Participant[] | undefined,
): string | null {
	return (
		resolveSpeakerParticipant(speakerId, participants)?.displayName.trim() ??
		null
	);
}

/**
 * The seated participant a message is attributed to, or null.
 *
 * Same resolution as {@link resolveSpeakerByline}, returning the participant so
 * the avatar and the name come from one lookup and cannot disagree — an avatar
 * beside a name belonging to someone else is a worse lie than no avatar. A
 * participant whose display name is blank resolves to null here too: the row it
 * would produce has nothing to attribute.
 */
export function resolveSpeakerParticipant(
	speakerId: string | undefined,
	participants: readonly Participant[] | undefined,
): Participant | null {
	const id = speakerId?.trim();
	if (!id || !participants?.length) {
		return null;
	}
	const participant = participants.find((candidate) => candidate.id === id);
	return participant?.displayName.trim() ? participant : null;
}

/**
 * Inline style carrying a resolved ink, or undefined.
 *
 * Undefined rather than `{}` so an unstyled element keeps whatever the theme
 * gives it: writing `color: undefined` on the byline would still beat the
 * `text-muted-foreground` class in some React versions.
 */
export function inkStyle(
	color: string | undefined,
): { color: string } | undefined {
	return color ? { color } : undefined;
}
