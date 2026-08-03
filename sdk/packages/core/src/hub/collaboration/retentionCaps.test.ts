import { describe, expect, it } from "vitest";
import {
	DEBUG_BANK_EVENT_LOG_MAX_RECORDS,
	DEBUG_ROOM_EVENT_LOG_MAX_RECORDS,
	DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
} from "./logRetention";
import {
	resolveBankEventLogMaxRecords,
	resolveRoomEventLogMaxRecords,
} from "./retentionCaps";

describe("retentionCaps", () => {
	it("uses defaults when facets unset", () => {
		expect(resolveRoomEventLogMaxRecords()).toBe(
			DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
		);
		expect(resolveBankEventLogMaxRecords()).toBe(
			DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
		);
	});

	it("raises caps when privacy.debugRetention is on", () => {
		expect(resolveRoomEventLogMaxRecords({ debugRetention: true })).toBe(
			DEBUG_ROOM_EVENT_LOG_MAX_RECORDS,
		);
		expect(resolveBankEventLogMaxRecords({ debugRetention: true })).toBe(
			DEBUG_BANK_EVENT_LOG_MAX_RECORDS,
		);
	});

	it("honours durable retention overrides when debug is off", () => {
		expect(
			resolveRoomEventLogMaxRecords({ retentionRoomMax: 100 }),
		).toBe(100);
		expect(
			resolveBankEventLogMaxRecords({ retentionBankMax: 200 }),
		).toBe(200);
	});
});
