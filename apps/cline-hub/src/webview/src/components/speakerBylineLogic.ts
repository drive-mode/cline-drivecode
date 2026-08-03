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
	const id = speakerId?.trim();
	if (!id || !participants?.length) {
		return null;
	}
	const displayName = participants
		.find((participant) => participant.id === id)
		?.displayName?.trim();
	return displayName ? displayName : null;
}
