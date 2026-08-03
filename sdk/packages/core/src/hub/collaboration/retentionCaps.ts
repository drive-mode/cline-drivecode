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
