import { describe, expect, it } from "vitest";
import { createMemoryBankFs } from "./bankFs.js";
import { buildBankOpsForDrafts } from "./bankOps.js";
import { taskPath } from "./bankPaths.js";
import { type BankStore, createBankStore } from "./bankStore.js";
import { commitBankOps } from "./commitBankOps.js";

const ROOT = "/ws";

async function seedPlan(
	options: { activate?: boolean } = {},
): Promise<{ store: BankStore; fs: ReturnType<typeof createMemoryBankFs> }> {
	const fs = createMemoryBankFs();
	const store = createBankStore(fs, ROOT);
	await store.createTask({ id: "t1", title: "One", body: "a" });
	await store.createPlan({
		id: "p1",
		title: "Plan",
		taskIds: ["t1"],
		activate: options.activate ?? true,
	});
	return { store, fs };
}

describe("commitBankOps", () => {
	it("creates the drafted tasks and appends them to the plan", async () => {
		const { store } = await seedPlan();
		const ops = buildBankOpsForDrafts({
			planId: "p1",
			drafts: [
				{ title: "Two", body: "do two" },
				{ title: "Three", body: "do three" },
			],
			taskIds: ["t2", "t3"],
		});

		const snapshot = await commitBankOps(store, ops);

		expect((await store.getPlan("p1"))?.taskIds).toEqual(["t1", "t2", "t3"]);
		expect(await store.getTask("t2")).toMatchObject({
			id: "t2",
			title: "Two",
			status: "open",
		});
		expect(snapshot.openTaskIds).toEqual(["t1", "t2", "t3"]);
		expect(snapshot.nowTaskId).toBe("t1");
		expect(snapshot.nextTaskId).toBe("t2");
	});

	it("round-trips the whole propose path from drafts to cursor", async () => {
		const fs = createMemoryBankFs();
		const store = createBankStore(fs, ROOT);
		await store.createTask({ id: "t1", title: "One", body: "" });
		await store.createTask({ id: "t2", title: "Two", body: "" });
		await store.createPlan({ id: "p1", title: "Plan", taskIds: ["t1", "t2"] });
		await store.completeTask("t1");

		const snapshot = await commitBankOps(
			store,
			buildBankOpsForDrafts({
				planId: "p1",
				drafts: [{ title: "Next up", body: "" }],
				taskIds: ["t3"],
			}),
		);

		expect(snapshot.nowTaskId).toBe("t2");
		expect(snapshot.nextTaskId).toBe("t3");
		expect(snapshot.nextTitle).toBe("Next up");
	});

	it("refuses to extend a plan that auto-closed on its last completion", async () => {
		// `completeTask` archives the plan once openTaskIds is empty (bankStore),
		// so the propose window shuts with the final task. A proposer must draft
		// before the last completion, or open a new plan.
		const { store, fs } = await seedPlan();
		await store.completeTask("t1");
		expect((await store.getPlan("p1"))?.status).toBe("closed");

		const ops = buildBankOpsForDrafts({
			planId: "p1",
			drafts: [{ title: "Too late", body: "" }],
			taskIds: ["t2"],
		});

		await expect(commitBankOps(store, ops)).rejects.toThrow(/closed/);
		expect(await fs.exists(taskPath(ROOT, "t2"))).toBe(false);
	});

	it("reports the current snapshot for an empty batch", async () => {
		const { store } = await seedPlan();
		const snapshot = await commitBankOps(store, []);
		expect(snapshot.nowTaskId).toBe("t1");
	});

	it("throws on a missing plan without writing any task", async () => {
		const { store, fs } = await seedPlan();
		const ops = buildBankOpsForDrafts({
			planId: "nope",
			drafts: [{ title: "Two", body: "" }],
			taskIds: ["t2"],
		});

		await expect(commitBankOps(store, ops)).rejects.toThrow(/plan not found/);
		expect(await fs.exists(taskPath(ROOT, "t2"))).toBe(false);
	});

	it("throws on a closed plan without writing any task", async () => {
		const { store, fs } = await seedPlan();
		await store.closeAndArchivePlan("p1");
		const ops = buildBankOpsForDrafts({
			planId: "p1",
			drafts: [{ title: "Two", body: "" }],
			taskIds: ["t2"],
		});

		await expect(commitBankOps(store, ops)).rejects.toThrow(/closed/);
		expect(await fs.exists(taskPath(ROOT, "t2"))).toBe(false);
	});

	it("propagates a duplicate task id from the store", async () => {
		const { store } = await seedPlan();
		const ops = buildBankOpsForDrafts({
			planId: "p1",
			drafts: [{ title: "Clash", body: "" }],
			taskIds: ["t1"],
		});

		await expect(commitBankOps(store, ops)).rejects.toThrow(
			/Task already exists/,
		);
	});

	it("appends to a draft plan without moving the cursor", async () => {
		const { store } = await seedPlan({ activate: false });

		const snapshot = await commitBankOps(
			store,
			buildBankOpsForDrafts({
				planId: "p1",
				drafts: [{ title: "Two", body: "" }],
				taskIds: ["t2"],
			}),
		);

		expect((await store.getPlan("p1"))?.taskIds).toEqual(["t1", "t2"]);
		// deriveBankSnapshot only reads an `active` plan — a draft has no cursor.
		expect(snapshot.activePlanId).toBeNull();
		expect(snapshot.nowTaskId).toBeNull();
	});

	it("does not duplicate a task id already in the plan", async () => {
		const { store } = await seedPlan();
		await store.createTask({ id: "t2", title: "Two", body: "" });
		await store.editPlanTaskIds("p1", ["t1", "t2"]);

		await commitBankOps(store, [
			{ type: "appendTasksToPlan", planId: "p1", taskIds: ["t2", "t3"] },
		]);

		expect((await store.getPlan("p1"))?.taskIds).toEqual(["t1", "t2", "t3"]);
	});

	it("emits bank events for the committed tasks", async () => {
		const fs = createMemoryBankFs();
		const kinds: string[] = [];
		const store = createBankStore(fs, ROOT, {
			onBankEvent: (event) => kinds.push(event.type),
		});
		await store.createTask({ id: "t1", title: "One", body: "" });
		await store.createPlan({ id: "p1", title: "Plan", taskIds: ["t1"] });
		kinds.length = 0;

		await commitBankOps(
			store,
			buildBankOpsForDrafts({
				planId: "p1",
				drafts: [{ title: "Two", body: "" }],
				taskIds: ["t2"],
			}),
		);

		expect(kinds).toContain("drive_task_opened");
		expect(kinds).toContain("drive_plan_step");
	});
});
