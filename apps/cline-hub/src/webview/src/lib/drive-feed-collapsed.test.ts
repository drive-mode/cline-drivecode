import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DRIVE_FEED_COLLAPSED_STORAGE_KEY,
	parseDriveFeedCollapsedStorage,
	readDriveFeedCollapsed,
	writeDriveFeedCollapsed,
} from "./drive-feed-collapsed";

function stubLocalStorage(seed?: string) {
	const store = new Map<string, string>();
	if (seed !== undefined) {
		store.set(DRIVE_FEED_COLLAPSED_STORAGE_KEY, seed);
	}
	vi.stubGlobal("window", {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
		},
	});
	return store;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("parseDriveFeedCollapsedStorage", () => {
	it("keeps only boolean entries under non-empty keys", () => {
		expect(
			parseDriveFeedCollapsedStorage(
				JSON.stringify({ default: true, other: "yes", "": true, room: false }),
			),
		).toEqual({ default: true, room: false });
	});

	it("falls back to empty for missing or malformed state", () => {
		expect(parseDriveFeedCollapsedStorage(null)).toEqual({});
		expect(parseDriveFeedCollapsedStorage("not json")).toEqual({});
		expect(parseDriveFeedCollapsedStorage("[1,2]")).toEqual({});
	});
});

describe("drive feed collapsed persistence", () => {
	it("defaults to expanded for an unseen room", () => {
		stubLocalStorage();
		expect(readDriveFeedCollapsed("default")).toBe(false);
	});

	it("round-trips the fold per room without disturbing the others", () => {
		const store = stubLocalStorage(JSON.stringify({ other: true }));
		writeDriveFeedCollapsed("default", true);
		expect(readDriveFeedCollapsed("default")).toBe(true);
		expect(readDriveFeedCollapsed("other")).toBe(true);

		writeDriveFeedCollapsed("default", false);
		expect(readDriveFeedCollapsed("default")).toBe(false);
		expect(readDriveFeedCollapsed("other")).toBe(true);
		expect(store.get(DRIVE_FEED_COLLAPSED_STORAGE_KEY)).toBe(
			JSON.stringify({ other: true, default: false }),
		);
	});

	it("survives storage that throws", () => {
		vi.stubGlobal("window", {
			localStorage: {
				getItem: () => {
					throw new Error("blocked");
				},
				setItem: () => {
					throw new Error("blocked");
				},
			},
		});
		expect(readDriveFeedCollapsed("default")).toBe(false);
		expect(() => writeDriveFeedCollapsed("default", true)).not.toThrow();
	});
});
