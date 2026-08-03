import { describe, expect, it } from "vitest";
import {
	isStatusSummaryPayload,
	isStatusUpdatePayload,
	isStatusViewHostMessage,
	statusTagCountsOf,
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

	it("accepts a status_page carrying facet counts", () => {
		expect(
			isStatusViewHostMessage({
				type: "status_page",
				requestId: "req-1",
				updates: [validUpdate],
				nextCursor: null,
				hasMore: false,
				total: 51,
				tagFacets: [
					{ tag: "fix", count: 51 },
					{ tag: "feat", count: 36 },
				],
			}),
		).toBe(true);
	});

	it("still accepts a status_page whose facet counts are junk", () => {
		// The chips are decoration beside the rows. Rejecting the frame would
		// throw away a good page of updates — and because the view only clears
		// `loading` on a frame it accepts, leave the list empty and spinning.
		expect(
			isStatusViewHostMessage({
				type: "status_page",
				requestId: "req-1",
				updates: [validUpdate],
				tagFacets: [{ tag: "fix" }, "nonsense"],
				total: "51",
			}),
		).toBe(true);
	});

	it("drops only the malformed facet counts", () => {
		expect(
			statusTagCountsOf([
				{ tag: "fix", count: 51 },
				{ tag: "fix" },
				{ tag: "", count: 3 },
				{ tag: "feat", count: Number.NaN },
				"nonsense",
				null,
				{ tag: "feat", count: 36 },
			]),
		).toEqual([
			{ tag: "fix", count: 51 },
			{ tag: "feat", count: 36 },
		]);
	});

	it("reports absent facet counts as absent, not as an empty chip row", () => {
		// `undefined` leaves the previous counts standing; `[]` would blank them.
		expect(statusTagCountsOf(undefined)).toBeUndefined();
		expect(statusTagCountsOf("nope")).toBeUndefined();
		expect(statusTagCountsOf([])).toEqual([]);
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
