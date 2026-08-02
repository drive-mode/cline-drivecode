import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HUB_NAV_RAIL_STORAGE_KEY,
	parseNavRailCollapsed,
	readStoredNavRailCollapsed,
	setStoredNavRailCollapsed,
} from "./nav-rail";

function stubWindowStorage(seed?: string) {
	const store = new Map<string, string>();
	if (seed !== undefined) {
		store.set(HUB_NAV_RAIL_STORAGE_KEY, seed);
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

describe("nav-rail", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("only treats the collapsed marker as collapsed", () => {
		expect(parseNavRailCollapsed("collapsed")).toBe(true);
		expect(parseNavRailCollapsed("expanded")).toBe(false);
		expect(parseNavRailCollapsed(null)).toBe(false);
		expect(parseNavRailCollapsed("true")).toBe(false);
	});

	it("round-trips both states through storage", () => {
		const store = stubWindowStorage();
		expect(readStoredNavRailCollapsed()).toBe(false);

		setStoredNavRailCollapsed(true);
		expect(store.get(HUB_NAV_RAIL_STORAGE_KEY)).toBe("collapsed");
		expect(readStoredNavRailCollapsed()).toBe(true);

		setStoredNavRailCollapsed(false);
		expect(store.get(HUB_NAV_RAIL_STORAGE_KEY)).toBe("expanded");
		expect(readStoredNavRailCollapsed()).toBe(false);
	});

	it("survives a reload with a collapsed rail already stored", () => {
		stubWindowStorage("collapsed");
		expect(readStoredNavRailCollapsed()).toBe(true);
	});
});
