import { describe, expect, it } from "vitest";
import {
	STATUS_SESSION_FIXTURES,
	buildStatusSessionChips,
	buildStatusSessionRow,
	statusSessionRowFromUnknown,
	statusSessionRowIsPrivate,
} from "./statusSessions.js";

describe("buildStatusSessionRow", () => {
	it("renders clean drain with S2 + S3", () => {
		const row = buildStatusSessionRow(STATUS_SESSION_FIXTURES.clean);
		expect(row.chips).toEqual([
			{ id: "S2", label: "2 done" },
			{ id: "S3", label: "drained" },
		]);
		expect(row.callSessionId).toBe("sess-clean");
		expect(row.roomId).toBe("room-1");
	});

	it("renders churny progress with S2 only", () => {
		expect(buildStatusSessionChips(STATUS_SESSION_FIXTURES.churny)).toEqual([
			{ id: "S2", label: "1 done" },
		]);
	});

	it("renders continue with S2 + E1", () => {
		expect(buildStatusSessionRow(STATUS_SESSION_FIXTURES.continue).chips).toEqual(
			[
				{ id: "S2", label: "1 done" },
				{ id: "E1", label: "continued" },
			],
		);
	});

	it("renders stickiness without accomplishment chips", () => {
		const row = buildStatusSessionRow(STATUS_SESSION_FIXTURES.stickiness);
		expect(row.chips).toEqual([]);
		expect(row.failureStickyCount).toBe(2);
	});
});

describe("statusSessions privacy", () => {
	it("accepts counts-only rows", () => {
		expect(
			statusSessionRowIsPrivate(
				buildStatusSessionRow(STATUS_SESSION_FIXTURES.clean),
			),
		).toBe(true);
	});

	it("rejects utterance keys", () => {
		expect(
			statusSessionRowIsPrivate({
				callSessionId: "s1",
				utterance: "nope",
			}),
		).toBe(false);
	});

	it("coerces unknown rollup JSON without forbidden fields", () => {
		const row = statusSessionRowFromUnknown({
			callSessionId: "s1",
			tasksCompleted: 3,
			planCleanDrain: true,
			postSuccessPlanContinue: true,
			completedTaskIds: ["a", "b", "c"],
			utterance: "ignored-at-coerce",
		});
		expect(row?.chips.map((c) => c.id)).toEqual(["S2", "S3", "E1"]);
		expect(statusSessionRowIsPrivate(row)).toBe(true);
		expect(statusSessionRowFromUnknown(null)).toBeNull();
	});
});
