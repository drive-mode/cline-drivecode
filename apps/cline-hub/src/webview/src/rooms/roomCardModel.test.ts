import type { DriveRoomDirectoryEntry } from "@cline/drive";
import { describe, expect, it } from "vitest";
import {
	endedRoomEntry,
	roomCardModel,
	roomDirectoryEntryFromUnknown,
	roomRelativeTime,
} from "./roomCardModel";

const NOW = Date.parse("2026-07-31T17:00:00.000Z");

function entry(
	over: Partial<DriveRoomDirectoryEntry> = {},
): DriveRoomDirectoryEntry {
	return {
		roomId: "demo-polish",
		status: "live",
		createdAt: "2026-07-31T16:58:00.000Z",
		updatedAt: "2026-07-31T16:59:00.000Z",
		subMode: "act",
		addressMode: "everyone",
		participantNames: ["You", "Cline"],
		cardCount: 2,
		eventCount: 7,
		...over,
	};
}

describe("roomCardModel", () => {
	it("names who is seated in a live room", () => {
		const card = roomCardModel(entry(), NOW);
		expect(card.statusLabel).toBe("Live");
		expect(card.meta).toBe("You + Cline · started 2m ago");
		expect(card.primaryAction).toBe("open");
		expect(card.canStop).toBe(true);
	});

	it("names what a stopped room kept, and offers Start", () => {
		const card = roomCardModel(
			entry({ status: "ended", participantNames: [] }),
			NOW,
		);
		expect(card.statusLabel).toBe("Stopped");
		expect(card.meta).toBe("act mode kept · 2 cards of history");
		expect(card.primaryAction).toBe("start");
		expect(card.canStop).toBe(false);
	});

	it("still says config was kept when there is no history yet", () => {
		const card = roomCardModel(
			entry({ status: "paused", participantNames: [], cardCount: 0 }),
			NOW,
		);
		expect(card.statusLabel).toBe("Paused");
		expect(card.meta).toBe("act mode kept");
	});

	it("singularises a one-card history", () => {
		const card = roomCardModel(
			entry({ status: "ended", participantNames: [], cardCount: 1 }),
			NOW,
		);
		expect(card.meta).toBe("act mode kept · 1 card of history");
	});

	it("falls back when a live entry names nobody", () => {
		const card = roomCardModel(entry({ participantNames: [] }), NOW);
		expect(card.meta).toBe("Drive active · started 2m ago");
	});
});

describe("endedRoomEntry", () => {
	/**
	 * A stop that succeeds and a re-list that fails are separate facts. The
	 * card must stop claiming Live even if the refresh never lands.
	 */
	it("clears the roster and stops offering Stop", () => {
		const card = roomCardModel(endedRoomEntry(entry()), NOW);
		expect(card.statusLabel).toBe("Stopped");
		expect(card.canStop).toBe(false);
		expect(card.primaryAction).toBe("start");
	});

	it("keeps the configuration and history Start brings back", () => {
		const ended = endedRoomEntry(entry());
		expect(ended.subMode).toBe("act");
		expect(ended.cardCount).toBe(2);
		expect(ended.addressMode).toBe("everyone");
		expect(ended.createdAt).toBe(entry().createdAt);
		expect(roomCardModel(ended, NOW).meta).toBe(
			"act mode kept · 2 cards of history",
		);
	});

	it("leaves an already-ended room untouched", () => {
		const already = entry({ status: "ended", participantNames: [] });
		expect(endedRoomEntry(already)).toBe(already);
	});
});

describe("roomRelativeTime", () => {
	it("scales from seconds to days and rejects junk", () => {
		expect(roomRelativeTime("2026-07-31T16:59:40.000Z", NOW)).toBe("just now");
		expect(roomRelativeTime("2026-07-31T16:30:00.000Z", NOW)).toBe("30m ago");
		expect(roomRelativeTime("2026-07-31T12:00:00.000Z", NOW)).toBe("5h ago");
		expect(roomRelativeTime("2026-07-28T17:00:00.000Z", NOW)).toBe("3d ago");
		expect(roomRelativeTime("not-a-date", NOW)).toBe("");
	});
});

describe("roomDirectoryEntryFromUnknown", () => {
	it("accepts a well-formed entry and drops unknown fields", () => {
		const parsed = roomDirectoryEntryFromUnknown({
			...entry(),
			narration: "the agent said something out loud",
		});
		expect(parsed).toEqual(entry());
		expect(parsed && "narration" in parsed).toBe(false);
	});

	it("rejects malformed entries", () => {
		expect(roomDirectoryEntryFromUnknown(null)).toBeNull();
		expect(roomDirectoryEntryFromUnknown("demo-polish")).toBeNull();
		expect(
			roomDirectoryEntryFromUnknown({ ...entry(), roomId: "" }),
		).toBeNull();
		expect(
			roomDirectoryEntryFromUnknown({ ...entry(), status: "archived" }),
		).toBeNull();
		expect(
			roomDirectoryEntryFromUnknown({ ...entry(), subMode: "vibes" }),
		).toBeNull();
	});

	it("defaults missing scalars instead of trusting them", () => {
		const parsed = roomDirectoryEntryFromUnknown({
			roomId: "voice-clips",
			status: "paused",
			subMode: "plan",
		});
		expect(parsed).toEqual({
			roomId: "voice-clips",
			status: "paused",
			createdAt: "",
			updatedAt: "",
			subMode: "plan",
			addressMode: "",
			participantNames: [],
			cardCount: 0,
			eventCount: 0,
		});
	});
});
