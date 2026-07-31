import { describe, expect, it } from "vitest";
import {
	DRIVE_BANK_EVENT_SCHEMA_VERSION,
	parseBankDriveEvent,
} from "./bankEvents";

describe("bankEvents", () => {
	it("parses drive_task_failed", () => {
		const event = parseBankDriveEvent({
			schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
			id: "f1",
			at: "2026-07-31T01:00:00.000Z",
			roomId: "room-1",
			callSessionId: "cs-1",
			type: "drive_task_failed",
			taskId: "t1",
		});
		expect(event.type).toBe("drive_task_failed");
		if (event.type === "drive_task_failed") {
			expect(event.taskId).toBe("t1");
			expect(event.callSessionId).toBe("cs-1");
		}
	});

	it("rejects note on drive_task_failed (counts/ids only)", () => {
		expect(() =>
			parseBankDriveEvent({
				schemaVersion: DRIVE_BANK_EVENT_SCHEMA_VERSION,
				id: "f1",
				at: "2026-07-31T01:00:00.000Z",
				roomId: "room-1",
				type: "drive_task_failed",
				taskId: "t1",
				note: "tests red",
			}),
		).toThrow();
	});
});
