import { readStoredValue, writeStoredValue } from "./safe-storage";

export const DRIVE_PIP_HIDDEN_STORAGE_KEY = "cline.drive.pip.v1";

/**
 * roomId → hidden. Per room so minimising one call's companion does not
 * minimise the next call's.
 *
 * This is chrome preference only: DRV-PIP requires hide ≠ leave, so nothing
 * here ever reaches the hub and a hidden PiP still means a live call.
 */
export type DrivePipHiddenStorage = Record<string, boolean>;

export function parseDrivePipHiddenStorage(
	raw: string | null,
): DrivePipHiddenStorage {
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
		) as DrivePipHiddenStorage;
	} catch {
		return {};
	}
}

function readStorage(): DrivePipHiddenStorage {
	return parseDrivePipHiddenStorage(
		readStoredValue(DRIVE_PIP_HIDDEN_STORAGE_KEY),
	);
}

export function readDrivePipHidden(roomId: string): boolean {
	return readStorage()[roomId] ?? false;
}

export function writeDrivePipHidden(roomId: string, hidden: boolean): void {
	writeStoredValue(
		DRIVE_PIP_HIDDEN_STORAGE_KEY,
		JSON.stringify({ ...readStorage(), [roomId]: hidden }),
	);
}
