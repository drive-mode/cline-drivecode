import { readStoredValue, writeStoredValue } from "./safe-storage";

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
	return parseDriveFeedCollapsedStorage(
		readStoredValue(DRIVE_FEED_COLLAPSED_STORAGE_KEY),
	);
}

export function readDriveFeedCollapsed(roomId: string): boolean {
	return readStorage()[roomId] ?? false;
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
