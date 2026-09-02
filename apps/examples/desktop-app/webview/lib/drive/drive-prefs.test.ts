import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_DRIVE_PREFS,
	DRIVE_PREFS_STORAGE_KEY,
	mergeDrivePrefs,
	parseDrivePrefs,
	readDrivePrefs,
	resetDrivePrefsCache,
	subscribeDrivePrefs,
	writeDrivePrefs,
} from "./drive-prefs";

type FakeWindow = { localStorage: Storage };

function installFakeStorage(
	options: { throwing?: boolean } = {},
): Map<string, string> {
	const store = new Map<string, string>();
	const storage: Storage = {
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		getItem: (key) => {
			if (options.throwing) {
				throw new Error("SecurityError");
			}
			return store.get(key) ?? null;
		},
		key: (index) => [...store.keys()][index] ?? null,
		removeItem: (key) => {
			store.delete(key);
		},
		setItem: (key, value) => {
			if (options.throwing) {
				throw new Error("SecurityError");
			}
			store.set(key, value);
		},
	};
	const fakeWindow: FakeWindow & {
		addEventListener: () => void;
		removeEventListener: () => void;
	} = {
		localStorage: storage,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	};
	Object.assign(globalThis, { window: fakeWindow });
	return store;
}

beforeEach(() => {
	resetDrivePrefsCache();
});

afterEach(() => {
	resetDrivePrefsCache();
	Reflect.deleteProperty(globalThis, "window");
});

describe("drive prefs", () => {
	it("is SSR-safe: reads defaults and drops writes without a window", () => {
		expect(readDrivePrefs()).toEqual(DEFAULT_DRIVE_PREFS);
		expect(writeDrivePrefs({ feedCollapsed: true }).feedCollapsed).toBe(true);
	});

	it("parses tolerant input and clamps the volume", () => {
		expect(parseDrivePrefs(null)).toEqual(DEFAULT_DRIVE_PREFS);
		expect(parseDrivePrefs("not json")).toEqual(DEFAULT_DRIVE_PREFS);
		expect(
			parseDrivePrefs(
				JSON.stringify({
					stageLayout: "bogus",
					pipCorner: "top-left",
					voice: { outputVolume: 4, captions: false },
					demoOptIn: "yes",
				}),
			),
		).toEqual({
			...DEFAULT_DRIVE_PREFS,
			pipCorner: "top-left",
			voice: { outputVolume: 1, captions: false, speakerDeviceId: null },
		});
	});

	it("round-trips through localStorage and notifies subscribers", () => {
		const store = installFakeStorage();
		let notified = 0;
		const unsubscribe = subscribeDrivePrefs(() => {
			notified += 1;
		});

		const written = writeDrivePrefs({
			reduceMotion: true,
			voice: { captions: false },
		});
		expect(written.reduceMotion).toBe(true);
		expect(written.voice).toEqual({
			outputVolume: 0.8,
			captions: false,
			speakerDeviceId: null,
		});
		expect(
			JSON.parse(store.get(DRIVE_PREFS_STORAGE_KEY) ?? "{}"),
		).toMatchObject({
			reduceMotion: true,
		});
		expect(notified).toBe(1);

		resetDrivePrefsCache();
		expect(readDrivePrefs()).toEqual(written);
		expect(readDrivePrefs()).toBe(readDrivePrefs());
		unsubscribe();
	});

	it("keeps working in memory when storage throws", () => {
		installFakeStorage({ throwing: true });
		expect(readDrivePrefs()).toEqual(DEFAULT_DRIVE_PREFS);
		expect(writeDrivePrefs({ demoOptIn: true }).demoOptIn).toBe(true);
	});

	it("parses the Status Hub lens and falls back to the board", () => {
		expect(
			parseDrivePrefs(JSON.stringify({ statusLens: "dependency-map" }))
				.statusLens,
		).toBe("dependency-map");
		expect(
			parseDrivePrefs(JSON.stringify({ statusLens: "timeline" })).statusLens,
		).toBe("board");
		expect(
			mergeDrivePrefs(DEFAULT_DRIVE_PREFS, { statusLens: "changelog" })
				.statusLens,
		).toBe("changelog");
	});

	it("keeps the speaker device id local and nullable", () => {
		expect(DEFAULT_DRIVE_PREFS.voice.speakerDeviceId).toBeNull();
		expect(
			parseDrivePrefs(JSON.stringify({ voice: { speakerDeviceId: "" } })).voice
				.speakerDeviceId,
		).toBeNull();
		expect(
			parseDrivePrefs(JSON.stringify({ voice: { speakerDeviceId: 42 } })).voice
				.speakerDeviceId,
		).toBeNull();
		const chosen = mergeDrivePrefs(DEFAULT_DRIVE_PREFS, {
			voice: { speakerDeviceId: "out-7f3a" },
		});
		expect(chosen.voice).toEqual({
			outputVolume: 0.8,
			captions: true,
			speakerDeviceId: "out-7f3a",
		});
		expect(
			mergeDrivePrefs(chosen, { voice: { speakerDeviceId: null } }).voice
				.speakerDeviceId,
		).toBeNull();
	});

	it("merges functional patches", () => {
		expect(
			mergeDrivePrefs(DEFAULT_DRIVE_PREFS, (previous) => ({
				feedCollapsed: !previous.feedCollapsed,
			})).feedCollapsed,
		).toBe(true);
	});
});

describe("drive prefs when storage rejects writes", () => {
	it("keeps the in-memory patch for the session after a blocked write", () => {
		const store = installFakeStorage();
		const storage = (globalThis as unknown as { window: FakeWindow }).window
			.localStorage;
		storage.setItem = () => {
			throw new Error("QuotaExceededError");
		};
		expect(writeDrivePrefs({ demoOptIn: true }).demoOptIn).toBe(true);
		expect(readDrivePrefs().demoOptIn).toBe(true);
		expect(store.has(DRIVE_PREFS_STORAGE_KEY)).toBe(false);
	});
});
