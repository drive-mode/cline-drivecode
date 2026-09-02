/**
 * Rooms directory card projection — the "Stop ≠ lose" line, in words.
 *
 * Ported from the hub webview's `rooms/roomCardModel.ts`. The hub sends a
 * structural directory entry per room (ADR-0013 lane 1); this turns one into
 * the card the page paints and adds the filter / sort / search the desktop
 * directory offers. It claims nothing the entry does not carry — no
 * "handoff saved" unless the entry says so, no conversation text ever.
 */

import {
	type DriveRoomDirectoryEntry,
	type DriveRoomStatus,
	sortRoomDirectory,
} from "@cline/drive";
import { driveSubModeLabel } from "./room-preview";

export type RoomCardAction = "open" | "start";

export type RoomsFilter = "all" | DriveRoomStatus;

export type RoomsSort = "recent" | "status" | "name";

export type RoomsLayout = "grid" | "list";

export const ROOMS_FILTERS: readonly RoomsFilter[] = [
	"all",
	"live",
	"paused",
	"ended",
];

export const ROOMS_SORTS: readonly RoomsSort[] = ["recent", "status", "name"];

export const ROOM_STATUS_LABELS: Record<DriveRoomStatus, string> = {
	live: "Live",
	paused: "Paused",
	ended: "Stopped",
};

export const ROOMS_FILTER_LABELS: Record<RoomsFilter, string> = {
	all: "All",
	live: "Live",
	paused: "Paused",
	ended: "Stopped",
};

export const ROOMS_SORT_LABELS: Record<RoomsSort, string> = {
	recent: "Most recent",
	status: "Live first",
	name: "Name",
};

export type RoomCardModel = {
	readonly roomId: string;
	readonly status: DriveRoomStatus;
	/** Rail-friendly status word. `ended` reads "Stopped" — it is resumable. */
	readonly statusLabel: string;
	readonly subModeLabel: string;
	readonly addressLabel: string;
	readonly participantNames: readonly string[];
	/** "You + Cline + Riley", or what a stopped room kept. Never conversation text. */
	readonly meta: string;
	readonly cardCount: number;
	readonly eventCount: number;
	readonly updatedAt: string;
	readonly updatedLabel: string;
	readonly createdAt: string;
	readonly createdLabel: string;
	readonly primaryAction: RoomCardAction;
	readonly primaryLabel: string;
	/** Stopping only applies to a room that is still holding a session. */
	readonly canStop: boolean;
	/** The room the Drive view is currently bound to. */
	readonly isCurrent: boolean;
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

/** Address mode as the directory carries it (a bare string, may be empty). */
export function roomAddressLabel(addressMode: string): string {
	switch (addressMode) {
		case "everyone":
			return "Everyone";
		case "agents":
			return "Agents";
		case "pack":
			return "Pack";
		default:
			return addressMode ? addressMode : "—";
	}
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
	const parts = [`${driveSubModeLabel(entry.subMode)} mode kept`];
	if (entry.cardCount > 0) {
		parts.push(`${plural(entry.cardCount, "card", "cards")} of history`);
	}
	return parts.join(" · ");
}

export type RoomCardModelOptions = {
	now?: number;
	currentRoomId?: string | null;
};

export function roomCardModel(
	entry: DriveRoomDirectoryEntry,
	options: RoomCardModelOptions = {},
): RoomCardModel {
	const now = options.now ?? Date.now();
	const live = entry.status === "live";
	const isCurrent = options.currentRoomId === entry.roomId;
	return {
		roomId: entry.roomId,
		status: entry.status,
		statusLabel: ROOM_STATUS_LABELS[entry.status],
		subModeLabel: driveSubModeLabel(entry.subMode),
		addressLabel: roomAddressLabel(entry.addressMode),
		participantNames: entry.participantNames,
		meta: live ? liveMeta(entry, now) : keptMeta(entry),
		cardCount: entry.cardCount,
		eventCount: entry.eventCount,
		updatedAt: entry.updatedAt,
		updatedLabel: roomRelativeTime(entry.updatedAt, now),
		createdAt: entry.createdAt,
		createdLabel: roomRelativeTime(entry.createdAt, now),
		primaryAction: live ? "open" : "start",
		primaryLabel: live ? (isCurrent ? "Continue" : "Open") : "Start",
		canStop: live,
		isCurrent,
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
 * Overlay locally confirmed stops on the hub's list. An override is only
 * applied while the hub still reports the room as not ended; once the list
 * agrees the override is redundant and the caller may drop it.
 */
export function applyEndedOverrides(
	entries: readonly DriveRoomDirectoryEntry[],
	endedRoomIds: ReadonlySet<string>,
): DriveRoomDirectoryEntry[] {
	return entries.map((entry) =>
		endedRoomIds.has(entry.roomId) ? endedRoomEntry(entry) : entry,
	);
}

export function isRoomsFilter(value: unknown): value is RoomsFilter {
	return (
		typeof value === "string" &&
		(ROOMS_FILTERS as readonly string[]).includes(value)
	);
}

export function isRoomsSort(value: unknown): value is RoomsSort {
	return (
		typeof value === "string" &&
		(ROOMS_SORTS as readonly string[]).includes(value)
	);
}

export function countRoomsByStatus(
	entries: readonly DriveRoomDirectoryEntry[],
): Record<RoomsFilter, number> {
	const counts: Record<RoomsFilter, number> = {
		all: entries.length,
		live: 0,
		paused: 0,
		ended: 0,
	};
	for (const entry of entries) {
		counts[entry.status] += 1;
	}
	return counts;
}

export function filterRoomEntries(
	entries: readonly DriveRoomDirectoryEntry[],
	filter: RoomsFilter,
): DriveRoomDirectoryEntry[] {
	if (filter === "all") {
		return [...entries];
	}
	return entries.filter((entry) => entry.status === filter);
}

/** Case-insensitive match on room id, participant names and sub-mode. */
export function searchRoomEntries(
	entries: readonly DriveRoomDirectoryEntry[],
	query: string,
): DriveRoomDirectoryEntry[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return [...entries];
	}
	return entries.filter((entry) => {
		const haystack = [
			entry.roomId,
			entry.subMode,
			driveSubModeLabel(entry.subMode),
			entry.addressMode,
			...entry.participantNames,
		]
			.join(" ")
			.toLowerCase();
		return haystack.includes(normalized);
	});
}

export function sortRoomEntries(
	entries: readonly DriveRoomDirectoryEntry[],
	sort: RoomsSort,
): DriveRoomDirectoryEntry[] {
	switch (sort) {
		case "status":
			return sortRoomDirectory(entries);
		case "recent":
			return [...entries].sort((a, b) => {
				const byRecency = b.updatedAt.localeCompare(a.updatedAt);
				return byRecency !== 0 ? byRecency : a.roomId.localeCompare(b.roomId);
			});
		case "name":
			return [...entries].sort((a, b) => a.roomId.localeCompare(b.roomId));
		default: {
			const _exhaustive: never = sort;
			return _exhaustive;
		}
	}
}

export type RoomsDirectoryQuery = {
	filter: RoomsFilter;
	sort: RoomsSort;
	search: string;
};

/** Filter → search → sort, in that order; the page renders the result. */
export function queryRoomEntries(
	entries: readonly DriveRoomDirectoryEntry[],
	query: RoomsDirectoryQuery,
): DriveRoomDirectoryEntry[] {
	return sortRoomEntries(
		searchRoomEntries(filterRoomEntries(entries, query.filter), query.search),
		query.sort,
	);
}
