/**
 * Rooms page card projection — the "Stop ≠ lose" line, in words.
 *
 * The hub sends a structural directory entry per room (ADR-0013 lane 1).
 * This turns one into the card the page paints: a status a human recognises
 * and a meta line naming what actually survived the stop. It claims nothing
 * the entry does not carry — no "handoff saved" unless the entry says so.
 */

import type { DriveRoomDirectoryEntry, DriveRoomStatus } from "@cline/drive";
import type { DriveSubMode } from "@cline/shared";

const SUB_MODES: readonly DriveSubMode[] = ["plan", "act", "ask", "debug"];

export type RoomCardAction = "open" | "start";

export type RoomCardModel = {
	readonly roomId: string;
	readonly status: DriveRoomStatus;
	/** Rail-friendly status word. `ended` reads "Stopped" — it is resumable. */
	readonly statusLabel: string;
	/** Who is seated, or what was kept. Never conversation text. */
	readonly meta: string;
	readonly primaryAction: RoomCardAction;
	/** Stopping only applies to a room that is still holding a session. */
	readonly canStop: boolean;
};

const STATUS_LABELS: Record<DriveRoomStatus, string> = {
	live: "Live",
	paused: "Paused",
	ended: "Stopped",
};

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

/** Minutes-since, matching the Status Hub's vocabulary. */
export function roomRelativeTime(iso: string, now = Date.now()): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) {
		return "";
	}
	const deltaSec = Math.round((now - then) / 1000);
	if (deltaSec < 60) {
		return "just now";
	}
	if (deltaSec < 3600) {
		return `${Math.floor(deltaSec / 60)}m ago`;
	}
	if (deltaSec < 86400) {
		return `${Math.floor(deltaSec / 3600)}h ago`;
	}
	return `${Math.floor(deltaSec / 86400)}d ago`;
}

function liveMeta(entry: DriveRoomDirectoryEntry, now: number): string {
	const seated =
		entry.participantNames.length > 0
			? entry.participantNames.join(" + ")
			: "Drive active";
	const since = roomRelativeTime(entry.createdAt, now);
	return since ? `${seated} · started ${since}` : seated;
}

/** What a stopped room kept: its configuration, and its stage history. */
function keptMeta(entry: DriveRoomDirectoryEntry): string {
	const parts = [`${entry.subMode} mode kept`];
	if (entry.cardCount > 0) {
		parts.push(`${plural(entry.cardCount, "card", "cards")} of history`);
	}
	return parts.join(" · ");
}

export function roomCardModel(
	entry: DriveRoomDirectoryEntry,
	now = Date.now(),
): RoomCardModel {
	const live = entry.status === "live";
	return {
		roomId: entry.roomId,
		status: entry.status,
		statusLabel: STATUS_LABELS[entry.status],
		meta: live ? liveMeta(entry, now) : keptMeta(entry),
		primaryAction: live ? "open" : "start",
		canStop: live,
	};
}

/**
 * The entry a room becomes once the hub confirms `call_end` closed it: the
 * roster is cleared and the room reads Stopped, while its configuration and
 * stage history — the things Start brings back — are left untouched.
 *
 * Applied locally so a confirmed stop survives a failed re-list. It mirrors
 * what `control.end` does to the snapshot, so the next successful list agrees.
 */
export function endedRoomEntry(
	entry: DriveRoomDirectoryEntry,
): DriveRoomDirectoryEntry {
	if (entry.status === "ended") {
		return entry;
	}
	return { ...entry, status: "ended", participantNames: [] };
}

/**
 * Reject anything that is not the structural entry shape. Unknown fields are
 * dropped rather than passed through, so a future hub cannot widen what the
 * page holds in state without this file agreeing.
 */
export function roomDirectoryEntryFromUnknown(
	value: unknown,
): DriveRoomDirectoryEntry | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.roomId !== "string" || !raw.roomId.trim()) {
		return null;
	}
	if (
		raw.status !== "live" &&
		raw.status !== "paused" &&
		raw.status !== "ended"
	) {
		return null;
	}
	const subMode = SUB_MODES.find((mode) => mode === raw.subMode);
	if (!subMode) {
		return null;
	}
	const names = Array.isArray(raw.participantNames)
		? raw.participantNames.filter(
				(name): name is string => typeof name === "string",
			)
		: [];
	return {
		roomId: raw.roomId,
		status: raw.status,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
		subMode,
		addressMode: typeof raw.addressMode === "string" ? raw.addressMode : "",
		participantNames: names,
		cardCount: typeof raw.cardCount === "number" ? raw.cardCount : 0,
		eventCount: typeof raw.eventCount === "number" ? raw.eventCount : 0,
	};
}
