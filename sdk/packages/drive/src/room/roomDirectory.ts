/**
 * Room directory projection — the Rooms surface over ADR-0013 lane 1.
 *
 * A room's durability comes from the event log alone: `commit()` appends
 * before folding, so replaying a room's records reproduces its configuration
 * (subMode, addressSet) and its history (stage cards) after the process that
 * wrote them is gone. This module folds those records into the small,
 * structural summary the Rooms page lists — never the conversation text.
 *
 * Privacy (DRV-PRIVACY): entries carry counts, ids, display names and
 * timestamps. Narration, messages and captions are deliberately absent, so a
 * directory entry can be held in UI state without becoming a transcript.
 */

import type { DriveEvent, DriveSubMode, RoomSnapshot } from "@cline/shared";
import { createEmptyRoomSnapshot, reduceRoom } from "../reduceRoom.js";

/**
 * - `live` — someone is still seated.
 * - `ended` — the log tail is a `control.end`: stopped on purpose, handoff
 *   assembled. Resumable — `control.join` reopens it.
 * - `paused` — drained (everyone left) or interrupted, never explicitly
 *   ended. Also resumable.
 */
export type DriveRoomStatus = "live" | "paused" | "ended";

export type DriveRoomDirectoryEntry = {
	readonly roomId: string;
	readonly status: DriveRoomStatus;
	readonly createdAt: string;
	/** Timestamp of the newest record; equals createdAt for a one-event room. */
	readonly updatedAt: string;
	/** Surviving configuration — the half of the gate that is not history. */
	readonly subMode: DriveSubMode;
	readonly addressMode: string;
	readonly participantNames: readonly string[];
	/** Surviving history — folded work cards on the stage. */
	readonly cardCount: number;
	readonly eventCount: number;
};

/**
 * The roster is the only honest liveness signal. `driveActive` is not: only
 * `control.end` clears it, so a room everyone merely *left* keeps the flag
 * set and would read live forever.
 */
function statusOf(
	snapshot: RoomSnapshot,
	endedAtTail: boolean,
): DriveRoomStatus {
	if (snapshot.participants.length > 0) {
		return "live";
	}
	return endedAtTail ? "ended" : "paused";
}

/**
 * Fold a room's durable records into a directory entry.
 *
 * `liveSnapshot` wins for roster/config when the hub still holds the room in
 * memory: retention trimming can drop the join records that seated a
 * participant, and the resident snapshot is the newer truth.
 */
export function projectRoomDirectoryEntry(input: {
	roomId: string;
	events: readonly DriveEvent[];
	liveSnapshot?: RoomSnapshot;
}): DriveRoomDirectoryEntry {
	const first = input.events[0];
	const last = input.events[input.events.length - 1];
	const createdAt =
		input.liveSnapshot?.createdAt ?? first?.at ?? new Date(0).toISOString();

	let folded = createEmptyRoomSnapshot({ roomId: input.roomId, createdAt });
	let endedAtTail = false;
	for (const event of input.events) {
		folded = reduceRoom(folded, event);
		if (event.type === "control.end") {
			endedAtTail = true;
		} else if (event.type === "control.join") {
			endedAtTail = false;
		}
	}

	const snapshot = input.liveSnapshot ?? folded;
	return {
		roomId: input.roomId,
		status: statusOf(snapshot, endedAtTail),
		createdAt,
		updatedAt: last?.at ?? createdAt,
		subMode: snapshot.subMode,
		addressMode: snapshot.addressSet.mode,
		participantNames: snapshot.participants.map((p) => p.displayName),
		cardCount: snapshot.stage.cards.length,
		eventCount: input.events.length,
	};
}

const STATUS_ORDER: Record<DriveRoomStatus, number> = {
	live: 0,
	paused: 1,
	ended: 2,
};

/** Live rooms first, then most recently touched — attention before recency. */
export function sortRoomDirectory(
	entries: readonly DriveRoomDirectoryEntry[],
): DriveRoomDirectoryEntry[] {
	return [...entries].sort((a, b) => {
		const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
		if (byStatus !== 0) {
			return byStatus;
		}
		const byRecency = b.updatedAt.localeCompare(a.updatedAt);
		return byRecency !== 0 ? byRecency : a.roomId.localeCompare(b.roomId);
	});
}
