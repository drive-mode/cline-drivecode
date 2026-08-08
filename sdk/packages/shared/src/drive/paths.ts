import { join } from "node:path";

export const DRIVE_DIRECTORY_NAME = "drive";
export const DRIVE_PROVIDERS_DIRECTORY_NAME = "providers";
export const DRIVE_FACETS_FILE_NAME = "facets.v1.json";
export const DRIVE_REGISTRY_FILE_NAME = "registry.v1.json";
export const DRIVE_PROVIDER_MANIFEST_FILE_NAME = "manifest.json";

export function resolveDriveDir(clineRoot: string): string {
	return join(clineRoot, DRIVE_DIRECTORY_NAME);
}

/** `<workspace>/.cline/drive` or `~/.cline/drive` when given that parent. */
export function resolveDriveConfigDir(configParent: string): string {
	return join(configParent, ".cline", DRIVE_DIRECTORY_NAME);
}

export function resolveDriveFacetsPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), DRIVE_FACETS_FILE_NAME);
}

export function resolveDriveRegistryPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), DRIVE_REGISTRY_FILE_NAME);
}

export const DRIVE_ROOMS_DIRECTORY_NAME = "rooms";
export const DRIVE_ROOM_EVENTS_FILE_NAME = "events.jsonl";
export const DRIVE_ROOM_META_FILE_NAME = "meta.json";
/** Fold checkpoint so retention trim cannot orphan live roster (ADR-0029). */
export const DRIVE_ROOM_CHECKPOINT_FILE_NAME = "checkpoint.json";

export function resolveDriveRoomsDir(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), DRIVE_ROOMS_DIRECTORY_NAME);
}

export function resolveDriveRoomDir(
	configParent: string,
	roomId: string,
): string {
	return join(resolveDriveRoomsDir(configParent), roomId);
}

export function resolveDriveRoomEventsPath(
	configParent: string,
	roomId: string,
): string {
	return join(
		resolveDriveRoomDir(configParent, roomId),
		DRIVE_ROOM_EVENTS_FILE_NAME,
	);
}

export function resolveDriveRoomMetaPath(
	configParent: string,
	roomId: string,
): string {
	return join(
		resolveDriveRoomDir(configParent, roomId),
		DRIVE_ROOM_META_FILE_NAME,
	);
}

export function resolveDriveRoomCheckpointPath(
	configParent: string,
	roomId: string,
): string {
	return join(
		resolveDriveRoomDir(configParent, roomId),
		DRIVE_ROOM_CHECKPOINT_FILE_NAME,
	);
}

export function resolveDriveProvidersDir(configParent: string): string {
	return join(
		resolveDriveConfigDir(configParent),
		DRIVE_PROVIDERS_DIRECTORY_NAME,
	);
}

export function resolveDriveProviderManifestPath(
	configParent: string,
	providerId: string,
): string {
	return join(
		resolveDriveProvidersDir(configParent),
		providerId,
		DRIVE_PROVIDER_MANIFEST_FILE_NAME,
	);
}
