/**
 * Stable Drive participant / room ids, mirrored from the hub webview
 * (`apps/cline-hub/src/webview/src/drive/types.ts` + `participantIds.ts`).
 */

/** Stable Chat Drive room id (matches the hub's driveCommand default). */
export const DRIVE_DEFAULT_ROOM_ID = "default";

/** Stable ids until the hub roster provides real participant UUIDs. */
export const DRIVE_PARTICIPANT_HUMAN = "drive:human";
export const DRIVE_PARTICIPANT_PARTNER = "drive:partner";

export function isDriveHumanId(id: string | null | undefined): boolean {
	// Canonical `drive:human` plus hub join legacy aliases (`human`, `you`).
	return id === DRIVE_PARTICIPANT_HUMAN || id === "human" || id === "you";
}

export function isDrivePartnerId(id: string | null | undefined): boolean {
	return id === DRIVE_PARTICIPANT_PARTNER || id === "partner";
}
