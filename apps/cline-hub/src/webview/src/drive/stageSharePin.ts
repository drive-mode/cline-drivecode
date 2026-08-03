/**
 * The one `call_set_stage` post (DRV-PARTICIPANT-SHEET, DRV-CALL-STRIP).
 *
 * Share pin is reachable from two places — the roster sheet and the call
 * strip — and they must be the same op, not two payloads that happen to
 * agree today. The payload builder is pure so a `.ts` test can pin its shape,
 * and so `driveCallOps` can re-export it without dragging `postToHost` (and
 * with it the DOM) into the hub-side suites. Callers post the result.
 */

import type { StagePin } from "@cline/shared";
import { DRIVE_DEFAULT_ROOM_ID } from "./types";

export type StageSharer = {
	kind: "human" | "agent";
	participantId: string;
};

export type SetStageInput = {
	roomId: string | null;
	sharer: StageSharer | null;
	/** Omit to leave the current pin alone; `null` clears it. */
	pin?: StagePin | null;
};

export function buildSetStageMessage(input: SetStageInput) {
	return {
		type: "call_set_stage" as const,
		roomId: input.roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
		sharer: input.sharer,
		pin: input.pin === undefined ? undefined : input.pin,
	};
}
