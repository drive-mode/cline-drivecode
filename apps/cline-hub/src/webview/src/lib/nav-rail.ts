export const HUB_NAV_RAIL_STORAGE_KEY = "cline-hub-nav-rail";

/** Unwritten / unrecognized values keep the rail expanded. */
export function parseNavRailCollapsed(stored: string | null): boolean {
	return stored === "collapsed";
}

export function readStoredNavRailCollapsed(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return parseNavRailCollapsed(
		window.localStorage.getItem(HUB_NAV_RAIL_STORAGE_KEY),
	);
}

export function setStoredNavRailCollapsed(collapsed: boolean): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(
		HUB_NAV_RAIL_STORAGE_KEY,
		collapsed ? "collapsed" : "expanded",
	);
}
