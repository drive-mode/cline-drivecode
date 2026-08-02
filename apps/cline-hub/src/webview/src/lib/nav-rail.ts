import { readStoredValue, writeStoredValue } from "./safe-storage";

export const HUB_NAV_RAIL_STORAGE_KEY = "cline-hub-nav-rail";

/** Unwritten / unrecognized values keep the rail expanded. */
export function parseNavRailCollapsed(stored: string | null): boolean {
	return stored === "collapsed";
}

export function readStoredNavRailCollapsed(): boolean {
	return parseNavRailCollapsed(readStoredValue(HUB_NAV_RAIL_STORAGE_KEY));
}

export function setStoredNavRailCollapsed(collapsed: boolean): void {
	writeStoredValue(
		HUB_NAV_RAIL_STORAGE_KEY,
		collapsed ? "collapsed" : "expanded",
	);
}
