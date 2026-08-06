import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DRIVE_POWER_CHROME_STORAGE_KEY,
	parseDrivePowerChrome,
	readDrivePowerChrome,
	subscribeDrivePowerChrome,
	writeDrivePowerChrome,
} from "./drive-power-chrome";

function stubLocalStorage(seed?: string) {
	const store = new Map<string, string>();
	if (seed !== undefined) {
		store.set(DRIVE_POWER_CHROME_STORAGE_KEY, seed);
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

describe("parseDrivePowerChrome", () => {
	it("defaults off", () => {
		expect(parseDrivePowerChrome(null)).toBe(false);
		expect(parseDrivePowerChrome("")).toBe(false);
		expect(parseDrivePowerChrome("{")).toBe(false);
	});

	it("accepts 1/true and JSON true", () => {
		expect(parseDrivePowerChrome("1")).toBe(true);
		expect(parseDrivePowerChrome("true")).toBe(true);
		expect(parseDrivePowerChrome("true")).toBe(true);
		expect(parseDrivePowerChrome(JSON.stringify(true))).toBe(true);
	});

	it("accepts explicit off", () => {
		expect(parseDrivePowerChrome("0")).toBe(false);
		expect(parseDrivePowerChrome("false")).toBe(false);
		expect(parseDrivePowerChrome(JSON.stringify(false))).toBe(false);
	});
});

describe("read/writeDrivePowerChrome", () => {
	it("round-trips through storage", () => {
		const store = stubLocalStorage();
		expect(readDrivePowerChrome()).toBe(false);
		writeDrivePowerChrome(true);
		expect(store.get(DRIVE_POWER_CHROME_STORAGE_KEY)).toBe("1");
		expect(readDrivePowerChrome()).toBe(true);
		writeDrivePowerChrome(false);
		expect(readDrivePowerChrome()).toBe(false);
	});

	it("notifies subscribers on write", () => {
		stubLocalStorage();
		const seen: boolean[] = [];
		const stop = subscribeDrivePowerChrome((enabled) => {
			seen.push(enabled);
		});
		writeDrivePowerChrome(true);
		writeDrivePowerChrome(false);
		stop();
		writeDrivePowerChrome(true);
		expect(seen).toEqual([true, false]);
	});
});
