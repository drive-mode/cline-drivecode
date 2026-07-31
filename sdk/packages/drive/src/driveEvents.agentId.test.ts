import { describe, expect, it } from "vitest";
import { createDriveTaskBoundEvent, createDriveTaskCompletedEvent } from "./driveEvents.js";

describe("bank event agent attribution", () => {
	it("includes optional agentId on bound/completed", () => {
		const bound = createDriveTaskBoundEvent({
			roomId: "r1",
			taskId: "t1",
			planId: "p1",
			agentId: "security-reviewer",
		});
		expect(bound.type).toBe("drive_task_bound");
		if (bound.type === "drive_task_bound") {
			expect(bound.agentId).toBe("security-reviewer");
		}
		const completed = createDriveTaskCompletedEvent({
			roomId: "r1",
			taskId: "t1",
			agentId: "security-reviewer",
		});
		expect(completed.type).toBe("drive_task_completed");
		if (completed.type === "drive_task_completed") {
			expect(completed.agentId).toBe("security-reviewer");
		}
	});

	it("omits agentId when unset", () => {
		const completed = createDriveTaskCompletedEvent({
			roomId: "r1",
			taskId: "t1",
		});
		if (completed.type === "drive_task_completed") {
			expect(completed.agentId).toBeUndefined();
		}
	});
});
