/**
 * Drive power chrome preference — denser cockpit for phone-only pilots.
 * @see docs/drivecode/plans/cline-drivemode/initiatives/mobile-consumer/POWER-USERS.md
 */

import { readStoredValue, writeStoredValue } from "./safe-storage";

export const DRIVE_POWER_CHROME_STORAGE_KEY = "cline.drive.power-chrome.v1";

export function parseDrivePowerChrome(raw: string | null): boolean {
	if (raw === "1" || raw === "true") {
		return true;
	}
	if (raw === "0" || raw === "false") {
		return false;
	}
	if (!raw) {
		return false;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed === true;
	} catch {
		return false;
	}
}

export function readDrivePowerChrome(): boolean {
	return parseDrivePowerChrome(readStoredValue(DRIVE_POWER_CHROME_STORAGE_KEY));
}

/** Module listeners so sheet + roster mounts stay in sync after a toggle. */
const powerChromeListeners = new Set<(enabled: boolean) => void>();

export function subscribeDrivePowerChrome(
	listener: (enabled: boolean) => void,
): () => void {
	powerChromeListeners.add(listener);
	return () => {
		powerChromeListeners.delete(listener);
	};
}

export function writeDrivePowerChrome(enabled: boolean): void {
	writeStoredValue(DRIVE_POWER_CHROME_STORAGE_KEY, enabled ? "1" : "0");
	for (const listener of powerChromeListeners) {
		listener(enabled);
	}
}
