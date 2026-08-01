import { describe, expect, it } from "vitest";
import { isDriveViewHostMessage } from "./drive-view-messages";

const validSummary = {
	total: 1,
	byState: { blocked: 1 },
	byAgent: [{ agentId: "a1" }],
	lastUpdatedAt: null,
};

describe("isDriveViewHostMessage", () => {
	it("validates summary results", () => {
		expect(
			isDriveViewHostMessage({
				type: "status_summary_result",
				requestId: "drive-summary",
				summary: validSummary,
			}),
		).toBe(true);
		expect(
			isDriveViewHostMessage({
				type: "status_summary_result",
				summary: { byState: "boom" },
			}),
		).toBe(false);
	});

	it("passes status_updated through without payload requirements", () => {
		expect(isDriveViewHostMessage({ type: "status_updated" })).toBe(true);
	});

	it("validates call_error fields", () => {
		expect(
			isDriveViewHostMessage({
				type: "call_error",
				command: "call_get_room",
				text: "room_not_found:default",
				code: "room_not_found",
			}),
		).toBe(true);
		expect(isDriveViewHostMessage({ type: "call_error" })).toBe(true);
		expect(isDriveViewHostMessage({ type: "call_error", code: 42 })).toBe(
			false,
		);
	});

	it("keeps room preview payloads shallow but typed", () => {
		expect(
			isDriveViewHostMessage({
				type: "room_snapshot",
				roomId: "default",
				snapshot: { roomId: "default", driveActive: true },
			}),
		).toBe(true);
		expect(isDriveViewHostMessage({ type: "drive_event" })).toBe(true);
		expect(
			isDriveViewHostMessage({ type: "room_snapshot", snapshot: "boom" }),
		).toBe(false);
		expect(isDriveViewHostMessage({ type: "drive_event", roomId: 7 })).toBe(
			false,
		);
	});

	it("validates room_not_found notifications", () => {
		expect(
			isDriveViewHostMessage({ type: "room_not_found", roomId: "default" }),
		).toBe(true);
		expect(isDriveViewHostMessage({ type: "room_not_found", roomId: 7 })).toBe(
			false,
		);
	});

	it("rejects unrelated message types", () => {
		expect(isDriveViewHostMessage({ type: "hub_state" })).toBe(false);
	});
});
