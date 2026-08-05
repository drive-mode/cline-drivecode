import { readStoredValue, writeStoredValue } from "./safe-storage";

export const DRIVE_FEED_COLLAPSED_STORAGE_KEY = "cline.drive.feed-collapsed.v1";

/** Matches hub `max-[720px]` shell — phone / narrow call IA. */
export const NARROW_CALL_MAX_WIDTH_PX = 720;

/** roomId → folded. Per room so folding one call does not fold the others. */
export type DriveFeedCollapsedStorage = Record<string, boolean>;

export function parseDriveFeedCollapsedStorage(
	raw: string | null,
): DriveFeedCollapsedStorage {
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				([key, value]) => key.trim().length > 0 && typeof value === "boolean",
			),
		) as DriveFeedCollapsedStorage;
	} catch {
		return {};
	}
}

function readStorage(): DriveFeedCollapsedStorage {
	return parseDriveFeedCollapsedStorage(
		readStoredValue(DRIVE_FEED_COLLAPSED_STORAGE_KEY),
	);
}

/** Narrow viewports start folded so Spotlight owns the first paint (collapsible IA). */
export function prefersCollapsedFeedByDefault(viewportWidthPx: number): boolean {
	return viewportWidthPx <= NARROW_CALL_MAX_WIDTH_PX;
}

/**
 * Stored fold wins. Unset rooms default open on desktop and collapsed on phone
 * so the collapsible rail does not steal the stage on first join.
 */
export function resolveFeedCollapsed(
	roomId: string,
	viewportWidthPx: number,
): boolean {
	const stored = readStorage()[roomId];
	if (typeof stored === "boolean") {
		return stored;
	}
	return prefersCollapsedFeedByDefault(viewportWidthPx);
}

/** Desktop-oriented read — unset rooms expand. Prefer {@link resolveFeedCollapsed} with a viewport. */
export function readDriveFeedCollapsed(roomId: string): boolean {
	return resolveFeedCollapsed(roomId, Number.POSITIVE_INFINITY);
}

export function writeDriveFeedCollapsed(
	roomId: string,
	collapsed: boolean,
): void {
	writeStoredValue(
		DRIVE_FEED_COLLAPSED_STORAGE_KEY,
		JSON.stringify({ ...readStorage(), [roomId]: collapsed }),
	);
}
