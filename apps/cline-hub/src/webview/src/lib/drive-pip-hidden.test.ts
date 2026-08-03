import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DRIVE_PIP_HIDDEN_STORAGE_KEY,
	parseDrivePipHiddenStorage,
	readDrivePipHidden,
	writeDrivePipHidden,
} from "./drive-pip-hidden";

function stubLocalStorage(seed?: string) {
	const store = new Map<string, string>();
	if (seed !== undefined) {
		store.set(DRIVE_PIP_HIDDEN_STORAGE_KEY, seed);
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

describe("parseDrivePipHiddenStorage", () => {
	it("keeps only boolean entries under non-empty keys", () => {
		expect(
			parseDrivePipHiddenStorage(
				JSON.stringify({ default: true, other: "yes", "": true, room: false }),
			),
		).toEqual({ default: true, room: false });
	});

	it("falls back to empty for missing or malformed state", () => {
		expect(parseDrivePipHiddenStorage(null)).toEqual({});
		expect(parseDrivePipHiddenStorage("not json")).toEqual({});
		expect(parseDrivePipHiddenStorage("[1,2]")).toEqual({});
	});
});

describe("drive pip hidden persistence", () => {
	it("defaults to shown for an unseen room", () => {
		stubLocalStorage();
		// The companion has to appear on its own for a call the user has never
		// minimised — an opt-in default would ship PiP invisible.
		expect(readDrivePipHidden("default")).toBe(false);
	});

	it("round-trips the preference per room without disturbing the others", () => {
		const store = stubLocalStorage(JSON.stringify({ other: true }));
		writeDrivePipHidden("default", true);
		expect(readDrivePipHidden("default")).toBe(true);
		expect(readDrivePipHidden("other")).toBe(true);

		writeDrivePipHidden("default", false);
		expect(readDrivePipHidden("default")).toBe(false);
		expect(readDrivePipHidden("other")).toBe(true);
		expect(store.get(DRIVE_PIP_HIDDEN_STORAGE_KEY)).toBe(
			JSON.stringify({ other: true, default: false }),
		);
	});

	it("does not share a key with the feed fold", async () => {
		// Both are per-room booleans through safe-storage; one shared key would
		// make minimising the companion fold the feed too.
		const { DRIVE_FEED_COLLAPSED_STORAGE_KEY } = await import(
			"./drive-feed-collapsed"
		);
		expect(DRIVE_PIP_HIDDEN_STORAGE_KEY).not.toBe(
			DRIVE_FEED_COLLAPSED_STORAGE_KEY,
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
		expect(readDrivePipHidden("default")).toBe(false);
		expect(() => writeDrivePipHidden("default", true)).not.toThrow();
	});
});
