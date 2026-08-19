import type { DriveRun, Receipt } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	assertCompletionReceipt,
	CompletionReceiptError,
} from "./completionReceipt.js";

const boundRun = {
	id: "run_auth_retry_v1",
	driveTaskId: "auth-retry-race",
	title: "Fix auth retry race",
	status: "awaiting_verification",
	spec: {
		revision: 1,
		maxParallel: 1,
		gates: [],
		waves: [],
		workItems: [],
	},
} as DriveRun;

const acceptedReceipt = {
	id: "rcpt_1",
	driveTaskId: "auth-retry-race",
	driveRunId: "run_auth_retry_v1",
	evidenceRefs: ["pr:123", "tests:green"],
	decision: "accepted",
	decidedBy: "human:harrison",
	createdAt: "2026-08-02T12:00:00.000Z",
} as Receipt;

describe("assertCompletionReceipt", () => {
	it("no-ops when no DriveRun is bound", () => {
		expect(() =>
			assertCompletionReceipt({ taskId: "auth-retry-race" }),
		).not.toThrow();
	});

	it("passes with an accepted receipt and evidence", () => {
		expect(() =>
			assertCompletionReceipt({
				taskId: "auth-retry-race",
				boundRun,
				receipt: acceptedReceipt,
			}),
		).not.toThrow();
	});

	it("fails closed when receipt is missing", () => {
		expect(() =>
			assertCompletionReceipt({
				taskId: "auth-retry-race",
				boundRun,
			}),
		).toThrow(CompletionReceiptError);
		try {
			assertCompletionReceipt({
				taskId: "auth-retry-race",
				boundRun,
			});
		} catch (error) {
			expect(error).toBeInstanceOf(CompletionReceiptError);
			expect((error as CompletionReceiptError).code).toBe("receipt_required");
		}
	});

	it("rejects pending receipts", () => {
		expect(() =>
			assertCompletionReceipt({
				taskId: "auth-retry-race",
				boundRun,
				receipt: { ...acceptedReceipt, decision: "pending" },
			}),
		).toThrow(/not accepted/);
	});

	it("rejects empty evidence", () => {
		expect(() =>
			assertCompletionReceipt({
				taskId: "auth-retry-race",
				boundRun,
				receipt: { ...acceptedReceipt, evidenceRefs: [] },
			}),
		).toThrow(/no verifier evidence/);
	});
});
