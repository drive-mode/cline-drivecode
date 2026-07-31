import { describe, expect, it } from "vitest";
import { planAddTreatment } from "../drive/agencyChrome";
import { moveTask, removeTask } from "./planEditorLogic";

describe("PlanEditor helpers", () => {
	it("reorders tasks", () => {
		expect(moveTask(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
		expect(moveTask(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
		expect(moveTask(["a", "b"], "a", "up")).toEqual(["a", "b"]);
	});

	it("removes a task ref", () => {
		expect(removeTask(["a", "b", "c"], "b")).toEqual(["a", "c"]);
	});
});

describe("PlanEditor recovery vs collaborative add", () => {
	it("uses fix-up copy when now has lastFailure", () => {
		const recovery = planAddTreatment(true);
		expect(recovery.tone).toBe("recovery");
		expect(recovery.addLabel).toBe("Add fix-up");
		expect(recovery.hint).toContain("fix-up");
		expect(JSON.stringify(recovery).toLowerCase()).not.toContain("churn");
	});

	it("uses collaborative add when no failure", () => {
		const collaborative = planAddTreatment(false);
		expect(collaborative.tone).toBe("collaborative");
		expect(collaborative.addLabel).toBe("Add task");
		expect(collaborative.hint).toBeNull();
	});
});
