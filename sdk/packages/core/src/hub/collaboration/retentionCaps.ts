/**
 * Resolve JSONL retention max from privacy facets (DRV-PRIVACY §2.5).
 * debugRetention raises caps; durable privacy.retention may override base.
 */

import {
	DEBUG_BANK_EVENT_LOG_MAX_RECORDS,
	DEBUG_ROOM_EVENT_LOG_MAX_RECORDS,
	DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
} from "./logRetention";

export type RetentionFacetValues = {
	debugRetention?: boolean;
	/** Optional durable base max for room events (when privacy.retention set). */
	retentionRoomMax?: number;
	retentionBankMax?: number;
};

export function resolveRoomEventLogMaxRecords(
	facets: RetentionFacetValues = {},
): number {
	if (facets.debugRetention) {
		return DEBUG_ROOM_EVENT_LOG_MAX_RECORDS;
	}
	if (
		typeof facets.retentionRoomMax === "number" &&
		facets.retentionRoomMax > 0
	) {
		return Math.floor(facets.retentionRoomMax);
	}
	return DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS;
}

export function resolveBankEventLogMaxRecords(
	facets: RetentionFacetValues = {},
): number {
	if (facets.debugRetention) {
		return DEBUG_BANK_EVENT_LOG_MAX_RECORDS;
	}
	if (
		typeof facets.retentionBankMax === "number" &&
		facets.retentionBankMax > 0
	) {
		return Math.floor(facets.retentionBankMax);
	}
	return DEFAULT_BANK_EVENT_LOG_MAX_RECORDS;
}

/**
 * Live retention facets by workspace config parent (hub-process memory
 * only — never written to disk, never phone-home). `privacy.debugRetention`
 * is session-scoped (DRV-PRIVACY): it must not survive a hub restart, so a
 * durable store would be the wrong shape even if one already existed.
 *
 * This is the missing link between the append/trim path and the facet
 * catalog in `@cline/drive`: nothing durably persists these values, but the
 * room/bank JSONL append paths resolve `maxRecords` through them on every
 * write (see `eventLog.ts` / `bankEventLog.ts`), so a live toggle takes
 * effect on the very next append.
 */
const liveRetentionFacetsByConfigParent = new Map<
	string,
	RetentionFacetValues
>();

/** Set the live retention facets for a workspace. Pass `{}` to clear. */
export function setLiveRetentionFacets(
	configParent: string,
	facets: RetentionFacetValues,
): void {
	liveRetentionFacetsByConfigParent.set(configParent, facets);
}

/** Current live retention facets for a workspace (empty when never set). */
export function getLiveRetentionFacets(
	configParent: string,
): RetentionFacetValues {
	return liveRetentionFacetsByConfigParent.get(configParent) ?? {};
}

/** Test helper: clear all live retention facets across every workspace. */
export function resetLiveRetentionFacetsForTests(): void {
	liveRetentionFacetsByConfigParent.clear();
}
