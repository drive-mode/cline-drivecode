import { afterEach, describe, expect, it } from "vitest";
import {
	DEBUG_BANK_EVENT_LOG_MAX_RECORDS,
	DEBUG_ROOM_EVENT_LOG_MAX_RECORDS,
	DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
} from "./logRetention";
import {
	getLiveRetentionFacets,
	resetLiveRetentionFacetsForTests,
	resolveBankEventLogMaxRecords,
	resolveRoomEventLogMaxRecords,
	setLiveRetentionFacets,
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

describe("live retention facets (hub-memory, never persisted)", () => {
	afterEach(() => {
		resetLiveRetentionFacetsForTests();
	});

	it("defaults to empty facets for a workspace that was never set", () => {
		expect(getLiveRetentionFacets("/ws/never-set")).toEqual({});
	});

	it("round-trips through set/get and resolves raised caps once on", () => {
		setLiveRetentionFacets("/ws/a", { debugRetention: true });
		expect(getLiveRetentionFacets("/ws/a")).toEqual({ debugRetention: true });
		expect(
			resolveRoomEventLogMaxRecords(getLiveRetentionFacets("/ws/a")),
		).toBe(DEBUG_ROOM_EVENT_LOG_MAX_RECORDS);
		expect(
			resolveBankEventLogMaxRecords(getLiveRetentionFacets("/ws/a")),
		).toBe(DEBUG_BANK_EVENT_LOG_MAX_RECORDS);
	});

	it("is scoped per workspace — setting one configParent leaves others at default", () => {
		setLiveRetentionFacets("/ws/a", { debugRetention: true });
		expect(getLiveRetentionFacets("/ws/b")).toEqual({});
		expect(
			resolveRoomEventLogMaxRecords(getLiveRetentionFacets("/ws/b")),
		).toBe(DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS);
	});

	it("clears back to defaults when set with an empty object", () => {
		setLiveRetentionFacets("/ws/a", { debugRetention: true });
		setLiveRetentionFacets("/ws/a", {});
		expect(getLiveRetentionFacets("/ws/a")).toEqual({});
		expect(
			resolveRoomEventLogMaxRecords(getLiveRetentionFacets("/ws/a")),
		).toBe(DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS);
	});
});
