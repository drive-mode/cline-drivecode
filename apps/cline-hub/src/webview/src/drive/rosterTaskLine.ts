/** Task line for roster rows — bank NOW title when an agent is working. */

import type { Participant } from "@cline/shared";
import type { DriveUiState } from "./types";

/**
 * One-line “what are they doing” for power roster density.
 * Humans and idle agents return null (status label is enough).
 */
export function rosterParticipantTaskLine(
	drive: DriveUiState,
	participant: Participant,
): string | null {
	if (participant.kind !== "agent") {
		return null;
	}
	if (participant.status !== "working" && participant.status !== "speaking") {
		return null;
	}
	const title = drive.bankSnapshot.nowTitle?.trim();
	return title && title.length > 0 ? title : null;
}
