import type { DriveTaskDraft } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyAppendTasksToPlan,
	type BankOp,
	buildBankOpsForDrafts,
} from "./bankOps.js";

const draft = (title: string, body = ""): DriveTaskDraft => ({ title, body });

describe("buildBankOpsForDrafts", () => {
	it("emits one createTask per draft then a single append", () => {
		const ops = buildBankOpsForDrafts({
			planId: "plan-1",
			drafts: [draft("Wire the gate", "expiry + denial"), draft("Add a test")],
			taskIds: ["t-1", "t-2"],
		});

		expect(ops).toEqual([
			{
				type: "createTask",
				id: "t-1",
				title: "Wire the gate",
				body: "expiry + denial",
			},
			{ type: "createTask", id: "t-2", title: "Add a test", body: "" },
			{ type: "appendTasksToPlan", planId: "plan-1", taskIds: ["t-1", "t-2"] },
		]);
	});

	it("is deterministic — same input, same ops", () => {
		const input = {
			planId: "plan-1",
			drafts: [draft("One"), draft("Two")],
			taskIds: ["t-1", "t-2"],
		};
		expect(buildBankOpsForDrafts(input)).toEqual(buildBankOpsForDrafts(input));
	});

	it("returns no ops for no drafts", () => {
		expect(
			buildBankOpsForDrafts({ planId: "plan-1", drafts: [], taskIds: [] }),
		).toEqual([]);
	});

	it("preserves draft order in the append", () => {
		const ops = buildBankOpsForDrafts({
			planId: "p",
			drafts: [draft("first"), draft("second"), draft("third")],
			taskIds: ["c", "a", "b"],
		});
		const append = ops.at(-1) as Extract<BankOp, { type: "appendTasksToPlan" }>;
		expect(append.taskIds).toEqual(["c", "a", "b"]);
	});

	it("rejects a draft/id length mismatch", () => {
		expect(() =>
			buildBankOpsForDrafts({
				planId: "p",
				drafts: [draft("One")],
				taskIds: ["t-1", "t-2"],
			}),
		).toThrow(/same length/);
	});

	it("rejects duplicate task ids", () => {
		expect(() =>
			buildBankOpsForDrafts({
				planId: "p",
				drafts: [draft("One"), draft("Two")],
				taskIds: ["t-1", "t-1"],
			}),
		).toThrow(/duplicates id/);
	});

	it("rejects a blank task id", () => {
		expect(() =>
			buildBankOpsForDrafts({
				planId: "p",
				drafts: [draft("One")],
				taskIds: ["  "],
			}),
		).toThrow(/non-empty string/);
	});

	it("rejects a blank planId", () => {
		expect(() =>
			buildBankOpsForDrafts({
				planId: "",
				drafts: [draft("One")],
				taskIds: ["t-1"],
			}),
		).toThrow(/planId/);
	});

	it("rejects a blank draft title", () => {
		expect(() =>
			buildBankOpsForDrafts({
				planId: "p",
				drafts: [draft("   ")],
				taskIds: ["t-1"],
			}),
		).toThrow(/non-empty title/);
	});

	it("rejects a draft carrying session prose under an extra key", () => {
		const smuggled = {
			title: "Fix the thing",
			body: "from the call",
			transcript: "user: it broke again",
		} as unknown as DriveTaskDraft;

		expect(() =>
			buildBankOpsForDrafts({
				planId: "p",
				drafts: [smuggled],
				taskIds: ["t-1"],
			}),
		).toThrow(/unexpected key "transcript"/);
	});

	it("rejects a draft that pre-assigns bank identity", () => {
		const withId = {
			title: "Fix the thing",
			body: "",
			id: "t-99",
		} as unknown as DriveTaskDraft;

		expect(() =>
			buildBankOpsForDrafts({
				planId: "p",
				drafts: [withId],
				taskIds: ["t-1"],
			}),
		).toThrow(/unexpected key "id"/);
	});
});

describe("applyAppendTasksToPlan", () => {
	it("appends after the current order", () => {
		expect(
			applyAppendTasksToPlan(["a", "b"], {
				type: "appendTasksToPlan",
				planId: "p",
				taskIds: ["c", "d"],
			}),
		).toEqual(["a", "b", "c", "d"]);
	});

	it("does not duplicate ids already in the plan", () => {
		expect(
			applyAppendTasksToPlan(["a", "b"], {
				type: "appendTasksToPlan",
				planId: "p",
				taskIds: ["b", "c"],
			}),
		).toEqual(["a", "b", "c"]);
	});

	it("does not mutate the input order", () => {
		const current = ["a"];
		applyAppendTasksToPlan(current, {
			type: "appendTasksToPlan",
			planId: "p",
			taskIds: ["b"],
		});
		expect(current).toEqual(["a"]);
	});
});
