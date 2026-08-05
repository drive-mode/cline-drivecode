/**
 * Resolve JSONL retention max from privacy facets (DRV-PRIVACY §2.5).
 * debugRetention raises caps; durable privacy.retention may override base.
 */

import {
	DEBUG_ARTIFACT_EVENT_LOG_MAX_RECORDS,
	DEBUG_BANK_EVENT_LOG_MAX_RECORDS,
	DEBUG_ROOM_EVENT_LOG_MAX_RECORDS,
	DEFAULT_ARTIFACT_EVENT_LOG_MAX_RECORDS,
	DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
} from "./logRetention";

export type RetentionFacetValues = {
	debugRetention?: boolean;
	/** Optional durable base max for room events (when privacy.retention set). */
	retentionRoomMax?: number;
	retentionBankMax?: number;
};

/**
 * A retention cap is a record *count*, so only a positive integer is a usable
 * one. The previous guard was `> 0` followed by `Math.floor`, which mapped
 * every value in `(0, 1)` to `0` — and `trimJsonlFileToMaxRecords` treats `0`
 * as "write an empty file". A `retentionRoomMax` of `0.5` therefore destroyed
 * the entire room log on the very next append, silently and permanently.
 *
 * Anything that is not a usable count falls back to the default. Clamping to
 * `1` would be the other option and is nearly as destructive — nobody who
 * writes `0.5` means "keep one record", so the safe reading of an
 * uninterpretable cap is that no cap was set.
 */
function resolveRecordCap(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const floored = Math.floor(value);
	return floored >= 1 ? floored : fallback;
}

export function resolveRoomEventLogMaxRecords(
	facets: RetentionFacetValues = {},
): number {
	if (facets.debugRetention) {
		return DEBUG_ROOM_EVENT_LOG_MAX_RECORDS;
	}
	return resolveRecordCap(
		facets.retentionRoomMax,
		DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
	);
}

export function resolveBankEventLogMaxRecords(
	facets: RetentionFacetValues = {},
): number {
	if (facets.debugRetention) {
		return DEBUG_BANK_EVENT_LOG_MAX_RECORDS;
	}
	return resolveRecordCap(
		facets.retentionBankMax,
		DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
	);
}

/**
 * Artifact corpus cap. Unlike room and bank there is no durable per-workspace
 * override facet — the corpus is already denominated in artifacts rather than
 * mixed events, so `debugRetention` is the only knob that has a reason to move
 * it. Callers with an explicit cap (tests) bypass this entirely.
 */
export function resolveArtifactEventLogMaxRecords(
	facets: RetentionFacetValues = {},
): number {
	return facets.debugRetention
		? DEBUG_ARTIFACT_EVENT_LOG_MAX_RECORDS
		: DEFAULT_ARTIFACT_EVENT_LOG_MAX_RECORDS;
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
