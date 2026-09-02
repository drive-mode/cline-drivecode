import type { DriveRoomDirectoryEntry } from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	applyEndedOverrides,
	countRoomsByStatus,
	endedRoomEntry,
	filterRoomEntries,
	isRoomsFilter,
	isRoomsSort,
	queryRoomEntries,
	roomAddressLabel,
	roomCardModel,
	roomRelativeTime,
	searchRoomEntries,
	sortRoomEntries,
} from "./room-card-model";

const NOW = Date.parse("2026-09-01T10:00:00.000Z");
const HOUR = 3_600_000;

function entry(
	overrides: Partial<DriveRoomDirectoryEntry> & { roomId: string },
): DriveRoomDirectoryEntry {
	return {
		status: "ended",
		createdAt: new Date(NOW - 5 * HOUR).toISOString(),
		updatedAt: new Date(NOW - 4 * HOUR).toISOString(),
		subMode: "plan",
		addressMode: "everyone",
		participantNames: [],
		cardCount: 0,
		eventCount: 0,
		...overrides,
	};
}

const LIVE = entry({
	roomId: "router-fix",
	status: "live",
	createdAt: new Date(NOW - 25 * 60_000).toISOString(),
	updatedAt: new Date(NOW - 30_000).toISOString(),
	subMode: "act",
	participantNames: ["You", "Cline", "Riley"],
	cardCount: 4,
	eventCount: 27,
});

const PAUSED = entry({
	roomId: "auth-migration",
	status: "paused",
	updatedAt: new Date(NOW - 3 * HOUR).toISOString(),
	addressMode: "agents",
	cardCount: 2,
	eventCount: 31,
});

const STOPPED = entry({
	roomId: "docs-refresh",
	status: "ended",
	updatedAt: new Date(NOW - 25 * HOUR).toISOString(),
	subMode: "debug",
	cardCount: 3,
	eventCount: 58,
});

describe("roomCardModel", () => {
	it("describes a live room by who is seated and offers Open + Stop", () => {
		const card = roomCardModel(LIVE, { now: NOW });
		expect(card.statusLabel).toBe("Live");
		expect(card.meta).toBe("You + Cline + Riley · started 25m ago");
		expect(card.primaryAction).toBe("open");
		expect(card.primaryLabel).toBe("Open");
		expect(card.canStop).toBe(true);
		expect(card.subModeLabel).toBe("Agent");
		expect(card.addressLabel).toBe("Everyone");
		expect(card.updatedLabel).toBe("just now");
		expect(card.isCurrent).toBe(false);
	});

	it("reads Continue for the room the view is bound to", () => {
		const card = roomCardModel(LIVE, { now: NOW, currentRoomId: "router-fix" });
		expect(card.isCurrent).toBe(true);
		expect(card.primaryLabel).toBe("Continue");
	});

	it("describes a stopped room by what it kept and offers Start", () => {
		const card = roomCardModel(STOPPED, { now: NOW });
		expect(card.statusLabel).toBe("Stopped");
		expect(card.meta).toBe("Debug mode kept · 3 cards of history");
		expect(card.primaryAction).toBe("start");
		expect(card.primaryLabel).toBe("Start");
		expect(card.canStop).toBe(false);
		expect(card.updatedLabel).toBe("1d ago");
	});

	it("says a live room with an empty roster is Drive active, and 1 card singular", () => {
		const card = roomCardModel(
			entry({
				roomId: "quiet",
				status: "live",
				createdAt: new Date(NOW - 2 * HOUR).toISOString(),
			}),
			{ now: NOW },
		);
		expect(card.meta).toBe("Drive active · started 2h ago");
		expect(
			roomCardModel(entry({ roomId: "one", cardCount: 1 }), { now: NOW }).meta,
		).toBe("Plan mode kept · 1 card of history");
	});

	it("labels the directory's bare address mode", () => {
		expect(roomAddressLabel("everyone")).toBe("Everyone");
		expect(roomAddressLabel("agents")).toBe("Agents");
		expect(roomAddressLabel("pack")).toBe("Pack");
		expect(roomAddressLabel("")).toBe("—");
		expect(roomAddressLabel("custom")).toBe("custom");
	});
});

describe("roomRelativeTime", () => {
	it("buckets seconds, minutes, hours and days", () => {
		expect(roomRelativeTime(new Date(NOW - 10_000).toISOString(), NOW)).toBe(
			"just now",
		);
		expect(
			roomRelativeTime(new Date(NOW - 5 * 60_000).toISOString(), NOW),
		).toBe("5m ago");
		expect(roomRelativeTime(new Date(NOW - 3 * HOUR).toISOString(), NOW)).toBe(
			"3h ago",
		);
		expect(roomRelativeTime(new Date(NOW - 49 * HOUR).toISOString(), NOW)).toBe(
			"2d ago",
		);
		expect(roomRelativeTime("garbage", NOW)).toBe("");
	});
});

describe("ended overrides", () => {
	it("clears the roster and reads Stopped without touching configuration", () => {
		const ended = endedRoomEntry(LIVE);
		expect(ended.status).toBe("ended");
		expect(ended.participantNames).toEqual([]);
		expect(ended.subMode).toBe(LIVE.subMode);
		expect(ended.cardCount).toBe(LIVE.cardCount);
		expect(endedRoomEntry(STOPPED)).toBe(STOPPED);
	});

	it("overlays confirmed stops on the hub's list", () => {
		const entries = applyEndedOverrides(
			[LIVE, PAUSED, STOPPED],
			new Set(["router-fix"]),
		);
		expect(entries.map((e) => e.status)).toEqual(["ended", "paused", "ended"]);
		expect(entries[1]).toBe(PAUSED);
	});
});

describe("directory query", () => {
	const ALL = [STOPPED, LIVE, PAUSED];

	it("counts rooms by status", () => {
		expect(countRoomsByStatus(ALL)).toEqual({
			all: 3,
			live: 1,
			paused: 1,
			ended: 1,
		});
	});

	it("filters by status and keeps everything for all", () => {
		expect(filterRoomEntries(ALL, "all")).toHaveLength(3);
		expect(filterRoomEntries(ALL, "live").map((e) => e.roomId)).toEqual([
			"router-fix",
		]);
		expect(filterRoomEntries(ALL, "ended").map((e) => e.roomId)).toEqual([
			"docs-refresh",
		]);
	});

	it("searches id, participant names and sub-mode label", () => {
		expect(searchRoomEntries(ALL, "riley").map((e) => e.roomId)).toEqual([
			"router-fix",
		]);
		expect(searchRoomEntries(ALL, "DEBUG").map((e) => e.roomId)).toEqual([
			"docs-refresh",
		]);
		expect(searchRoomEntries(ALL, "  ").length).toBe(3);
		expect(searchRoomEntries(ALL, "nothing")).toEqual([]);
	});

	it("sorts by recency, live-first status, and name", () => {
		expect(sortRoomEntries(ALL, "recent").map((e) => e.roomId)).toEqual([
			"router-fix",
			"auth-migration",
			"docs-refresh",
		]);
		expect(sortRoomEntries(ALL, "status").map((e) => e.roomId)).toEqual([
			"router-fix",
			"auth-migration",
			"docs-refresh",
		]);
		expect(sortRoomEntries(ALL, "name").map((e) => e.roomId)).toEqual([
			"auth-migration",
			"docs-refresh",
			"router-fix",
		]);
		expect(sortRoomEntries(ALL, "name")).not.toBe(ALL);
	});

	it("composes filter, search and sort", () => {
		expect(
			queryRoomEntries(ALL, { filter: "all", sort: "name", search: "o" }).map(
				(e) => e.roomId,
			),
		).toEqual(["auth-migration", "docs-refresh", "router-fix"]);
		expect(
			queryRoomEntries(ALL, { filter: "all", sort: "name", search: "r" }).map(
				(e) => e.roomId,
			),
		).toEqual(["auth-migration", "docs-refresh", "router-fix"]);
		expect(
			queryRoomEntries(ALL, {
				filter: "paused",
				sort: "recent",
				search: "",
			}).map((e) => e.roomId),
		).toEqual(["auth-migration"]);
	});

	it("guards filter and sort values from storage or the query string", () => {
		expect(isRoomsFilter("live")).toBe(true);
		expect(isRoomsFilter("archived")).toBe(false);
		expect(isRoomsSort("name")).toBe(true);
		expect(isRoomsSort(3)).toBe(false);
	});
});
