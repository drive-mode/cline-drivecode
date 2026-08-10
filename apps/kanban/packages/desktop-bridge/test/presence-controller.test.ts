import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	formatPresenceSummary,
	PresenceController,
	type PresenceView,
} from "../src/presence/presence-controller.js";

let view: {
	setBadgeCount: Mock<(count: number) => void>;
	requestAttention: Mock<() => void>;
	setSummary: Mock<(summary: string) => void>;
};
let controller: PresenceController;

beforeEach(() => {
	view = {
		setBadgeCount: vi.fn(),
		requestAttention: vi.fn(),
		setSummary: vi.fn(),
	};
	controller = new PresenceController(view satisfies PresenceView);
});

describe("formatPresenceSummary", () => {
	it.each([
		[{ running: 0, readyForReview: 0 }, "No active tasks"],
		[{ running: 3, readyForReview: 0 }, "3 running"],
		[{ running: 0, readyForReview: 2 }, "2 ready for review"],
		[{ running: 3, readyForReview: 2 }, "3 running, 2 ready for review"],
	])("summarises %j as %j", (counts, expected) => {
		expect(formatPresenceSummary(counts)).toBe(expected);
	});
});

describe("badge", () => {
	it("counts only what needs a human", () => {
		// Including running tasks would leave a permanent number on the dock
		// for a user with agents always in flight, training them to ignore it.
		controller.update({ running: 7, readyForReview: 2 });

		expect(view.setBadgeCount).toHaveBeenCalledExactlyOnceWith(2);
	});

	it("clears to zero when nothing is waiting", () => {
		controller.update({ running: 4, readyForReview: 0 });

		expect(view.setBadgeCount).toHaveBeenCalledExactlyOnceWith(0);
	});

	it.each([
		[-3, 0],
		[2.7, 2],
		[Number.NaN, 0],
		[Number.POSITIVE_INFINITY, 0],
	])("sanitises a reported count of %j to %j", (reported, expected) => {
		controller.update({ running: 0, readyForReview: reported });

		expect(view.setBadgeCount).toHaveBeenCalledExactlyOnceWith(expected);
	});
});

describe("attention", () => {
	it("fires when a task becomes ready", () => {
		controller.update({ running: 1, readyForReview: 1 });

		expect(view.requestAttention).toHaveBeenCalledOnce();
	});

	it("does not fire again while the count holds steady", () => {
		// Re-bouncing on every refresh while a task sits unreviewed would make
		// the dock unusable.
		controller.update({ running: 1, readyForReview: 1 });
		controller.update({ running: 2, readyForReview: 1 });
		controller.update({ running: 0, readyForReview: 1 });

		expect(view.requestAttention).toHaveBeenCalledOnce();
	});

	it("does not fire when the count drops", () => {
		controller.update({ running: 0, readyForReview: 3 });
		view.requestAttention.mockClear();

		controller.update({ running: 0, readyForReview: 1 });

		expect(view.requestAttention).not.toHaveBeenCalled();
	});

	it("fires again on a further increase", () => {
		controller.update({ running: 0, readyForReview: 1 });
		view.requestAttention.mockClear();

		controller.update({ running: 0, readyForReview: 2 });

		expect(view.requestAttention).toHaveBeenCalledOnce();
	});

	it("does not fire for running tasks alone", () => {
		controller.update({ running: 5, readyForReview: 0 });

		expect(view.requestAttention).not.toHaveBeenCalled();
	});
});

describe("summary", () => {
	it("pushes a summary on every update", () => {
		controller.update({ running: 2, readyForReview: 1 });

		expect(view.setSummary).toHaveBeenCalledExactlyOnceWith(
			"2 running, 1 ready for review",
		);
	});
});

describe("hasWorkInFlight", () => {
	it("is false before any update", () => {
		expect(controller.hasWorkInFlight()).toBe(false);
	});

	it("is true while agents are running", () => {
		controller.update({ running: 1, readyForReview: 0 });

		expect(controller.hasWorkInFlight()).toBe(true);
	});

	it("is false when only reviews are pending", () => {
		// A task waiting on a human is not interrupted by quitting, so it must
		// not trigger the quit warning — that would cry wolf on every quit.
		controller.update({ running: 0, readyForReview: 4 });

		expect(controller.hasWorkInFlight()).toBe(false);
	});

	it("clears once the running tasks finish", () => {
		controller.update({ running: 3, readyForReview: 0 });
		controller.update({ running: 0, readyForReview: 3 });

		expect(controller.hasWorkInFlight()).toBe(false);
	});
});
