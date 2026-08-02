export const DRIVE_FEED_COLLAPSED_STORAGE_KEY = "cline.drive.feed-collapsed.v1";

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
	if (typeof window === "undefined") {
		return {};
	}
	try {
		return parseDriveFeedCollapsedStorage(
			window.localStorage.getItem(DRIVE_FEED_COLLAPSED_STORAGE_KEY),
		);
	} catch {
		// Webview persistence is best-effort.
		return {};
	}
}

export function readDriveFeedCollapsed(roomId: string): boolean {
	return readStorage()[roomId] ?? false;
}

export function writeDriveFeedCollapsed(
	roomId: string,
	collapsed: boolean,
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			DRIVE_FEED_COLLAPSED_STORAGE_KEY,
			JSON.stringify({ ...readStorage(), [roomId]: collapsed }),
		);
	} catch {
		// Webview persistence is best-effort.
	}
}
