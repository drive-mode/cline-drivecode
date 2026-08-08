import { describe, expect, it } from "vitest";
import {
	parseBankSnapshot,
	parseDrivePlan,
	parseDriveTask,
	parseDriveTaskDraft,
} from "./bank";

describe("DriveTaskSchema", () => {
	it("parses a valid task", () => {
		const task = parseDriveTask({
			id: "t1",
			title: "Fix parser",
			body: "Acceptance: green tests",
			status: "open",
		});
		expect(task.id).toBe("t1");
		expect(task.status).toBe("open");
	});

	it("rejects unknown fields", () => {
		expect(() =>
			parseDriveTask({
				id: "t1",
				title: "x",
				body: "",
				status: "open",
				extra: true,
			}),
		).toThrow();
	});

	it("rejects invalid status", () => {
		expect(() =>
			parseDriveTask({
				id: "t1",
				title: "x",
				body: "",
				status: "pending",
			}),
		).toThrow();
	});
});

describe("DriveTaskDraftSchema", () => {
	it("parses a title + body draft", () => {
		const draft = parseDriveTaskDraft({
			title: "Wire the gate",
			body: "Acceptance: expiry and denial both observable",
		});
		expect(draft.title).toBe("Wire the gate");
	});

	it("accepts an empty body", () => {
		expect(parseDriveTaskDraft({ title: "Stub", body: "" }).body).toBe("");
	});

	it("rejects a blank title", () => {
		expect(() => parseDriveTaskDraft({ title: "", body: "x" })).toThrow();
	});

	it("rejects commit-time identity on a draft", () => {
		expect(() =>
			parseDriveTaskDraft({ title: "x", body: "", id: "t1" }),
		).toThrow();
		expect(() =>
			parseDriveTaskDraft({ title: "x", body: "", status: "open" }),
		).toThrow();
	});

	it("rejects session prose smuggled under an extra key", () => {
		expect(() =>
			parseDriveTaskDraft({
				title: "Fix the thing",
				body: "from the call",
				transcript: "user: it broke again",
			}),
		).toThrow();
	});
});

describe("DrivePlanSchema", () => {
	it("parses a refs-only plan", () => {
		const plan = parseDrivePlan({
			id: "p1",
			title: "Ship bank",
			taskIds: ["t1", "t2"],
			status: "active",
		});
		expect(plan.taskIds).toEqual(["t1", "t2"]);
	});

	it("rejects missing taskIds", () => {
		expect(() =>
			parseDrivePlan({
				id: "p1",
				title: "Ship bank",
				status: "active",
			}),
		).toThrow();
	});
});

describe("BankSnapshotSchema", () => {
	it("parses a cursor snapshot", () => {
		const snap = parseBankSnapshot({
			activePlanId: "p1",
			openTaskIds: ["t1", "t2"],
			nowTaskId: "t1",
			nextTaskId: "t2",
			nowTitle: "One",
			nextTitle: "Two",
		});
		expect(snap.nowTaskId).toBe("t1");
	});

	it("accepts optional nowLastFailure", () => {
		const snap = parseBankSnapshot({
			activePlanId: "p1",
			openTaskIds: ["t1"],
			nowTaskId: "t1",
			nextTaskId: null,
			nowTitle: "One",
			nextTitle: null,
			nowLastFailure: "tests red",
		});
		expect(snap.nowLastFailure).toBe("tests red");
	});
});
