import { describe, expect, it } from "vitest";
import {
	isStatusSummaryPayload,
	isStatusUpdatePayload,
	isStatusViewHostMessage,
} from "./status-view-messages";

const validSummary = {
	total: 3,
	byState: { blocked: 1, running: 2 },
	byAgent: [{ agentId: "a1", total: 2, blocked: 1, running: 1 }],
	lastUpdatedAt: null,
};

const validUpdate = {
	updateId: "u1",
	subject: "checkout-flow",
	state: "running",
	agentId: "a1",
	headline: "Refactoring cart",
};

describe("isStatusSummaryPayload", () => {
	it("accepts a valid summary", () => {
		expect(isStatusSummaryPayload(validSummary)).toBe(true);
		expect(
			isStatusSummaryPayload({ ...validSummary, lastUpdatedAt: "2026-08-01" }),
		).toBe(true);
	});

	it("rejects malformed aggregates", () => {
		expect(isStatusSummaryPayload({ ...validSummary, total: "3" })).toBe(false);
		expect(
			isStatusSummaryPayload({ ...validSummary, byState: { blocked: "1" } }),
		).toBe(false);
		expect(
			isStatusSummaryPayload({ ...validSummary, byAgent: [{ total: 2 }] }),
		).toBe(false);
		expect(isStatusSummaryPayload("boom")).toBe(false);
	});
});

describe("isStatusUpdatePayload", () => {
	it("accepts a valid update and rejects missing key fields", () => {
		expect(isStatusUpdatePayload(validUpdate)).toBe(true);
		expect(isStatusUpdatePayload({ ...validUpdate, updateId: 1 })).toBe(false);
		expect(isStatusUpdatePayload({ ...validUpdate, subject: undefined })).toBe(
			false,
		);
		expect(isStatusUpdatePayload({ ...validUpdate, state: null })).toBe(false);
		expect(isStatusUpdatePayload({ ...validUpdate, agentId: 7 })).toBe(false);
	});
});

describe("isStatusViewHostMessage", () => {
	it("accepts a valid status_page", () => {
		expect(
			isStatusViewHostMessage({
				type: "status_page",
				requestId: "req-1",
				updates: [validUpdate],
				nextCursor: 42,
				hasMore: true,
			}),
		).toBe(true);
		expect(
			isStatusViewHostMessage({
				type: "status_page",
				requestId: "req-1",
				updates: [],
				nextCursor: null,
			}),
		).toBe(true);
	});

	it("rejects status_page with a missing requestId or bad rows", () => {
		expect(
			isStatusViewHostMessage({ type: "status_page", updates: [validUpdate] }),
		).toBe(false);
		expect(
			isStatusViewHostMessage({
				type: "status_page",
				requestId: "req-1",
				updates: [{ updateId: "u1" }],
			}),
		).toBe(false);
		expect(
			isStatusViewHostMessage({
				type: "status_page",
				requestId: "req-1",
				updates: [validUpdate],
				nextCursor: "42",
			}),
		).toBe(false);
	});

	it("validates summary results", () => {
		expect(
			isStatusViewHostMessage({
				type: "status_summary_result",
				requestId: "req-1",
				summary: validSummary,
			}),
		).toBe(true);
		expect(
			isStatusViewHostMessage({ type: "status_summary_result", summary: {} }),
		).toBe(false);
	});

	it("passes payload-free notifications through", () => {
		expect(
			isStatusViewHostMessage({ type: "status_tasks_snapshot_result" }),
		).toBe(true);
		expect(isStatusViewHostMessage({ type: "team_progress" })).toBe(true);
	});

	it("validates status_error and status_updated", () => {
		expect(
			isStatusViewHostMessage({
				type: "status_error",
				requestId: "req-1",
				text: "boom",
			}),
		).toBe(true);
		expect(
			isStatusViewHostMessage({ type: "status_error", requestId: "req-1" }),
		).toBe(false);
		expect(
			isStatusViewHostMessage({ type: "status_updated", update: validUpdate }),
		).toBe(true);
		expect(
			isStatusViewHostMessage({ type: "status_updated", update: "boom" }),
		).toBe(false);
	});

	it("rejects unrelated message types", () => {
		expect(isStatusViewHostMessage({ type: "hub_state" })).toBe(false);
	});
});
