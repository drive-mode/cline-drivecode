import { afterEach, describe, expect, it, vi } from "vitest";
import {
	readDriveFeedCollapsed,
	writeDriveFeedCollapsed,
} from "./drive-feed-collapsed";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "./model-selection";
import {
	readStoredNavRailCollapsed,
	setStoredNavRailCollapsed,
} from "./nav-rail";
import { readStoredValue, writeStoredValue } from "./safe-storage";
// setStoredHubTheme is not exercised here: it also writes to `document`, which
// this node-env suite has no DOM for. Its storage write goes through the same
// guarded helper covered above.
import { readStoredHubTheme } from "./theme";

/**
 * A store that throws on access, the way a browser behaves when storage is
 * blocked by policy or private mode — it does not hand back null.
 */
function stubBlockedStorage() {
	vi.stubGlobal("window", {
		get localStorage(): Storage {
			throw new DOMException("access denied", "SecurityError");
		},
	});
}

/** A store that exists but rejects every operation (quota, or a locked profile). */
function stubThrowingStorage() {
	vi.stubGlobal("window", {
		localStorage: {
			getItem: () => {
				throw new DOMException("access denied", "SecurityError");
			},
			setItem: () => {
				throw new DOMException("quota exceeded", "QuotaExceededError");
			},
		},
	});
}

describe("safe-storage", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reports nothing stored when the store itself is blocked", () => {
		stubBlockedStorage();
		expect(readStoredValue("any-key")).toBeNull();
		expect(() => writeStoredValue("any-key", "v")).not.toThrow();
	});

	it("swallows a throwing get and set", () => {
		stubThrowingStorage();
		expect(readStoredValue("any-key")).toBeNull();
		expect(() => writeStoredValue("any-key", "v")).not.toThrow();
	});

	it("reports nothing stored outside a browser", () => {
		vi.stubGlobal("window", undefined);
		expect(readStoredValue("any-key")).toBeNull();
		expect(() => writeStoredValue("any-key", "v")).not.toThrow();
	});
});

describe("webview preferences under blocked storage", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// The regression this guards: an unguarded read during boot threw, React
	// unmounted, and a self-hosted tester got a blank page with no error.
	it("falls back to defaults instead of throwing", () => {
		stubBlockedStorage();

		expect(readStoredHubTheme()).toBeNull();
		expect(readStoredNavRailCollapsed()).toBe(false);
		expect(readDriveFeedCollapsed("room-1")).toBe(false);
		expect(readModelSelectionStorageFromWindow()).toEqual({
			lastProvider: "",
			lastModelByProvider: {},
		});
	});

	it("drops writes instead of throwing", () => {
		stubThrowingStorage();

		expect(() => setStoredNavRailCollapsed(true)).not.toThrow();
		expect(() => writeDriveFeedCollapsed("room-1", true)).not.toThrow();
		expect(() =>
			writeModelSelectionStorageToWindow({
				lastProvider: "anthropic",
				lastModelByProvider: {},
			}),
		).not.toThrow();
	});
});
