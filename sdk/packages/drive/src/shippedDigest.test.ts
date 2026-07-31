import { describe, expect, it } from "vitest";
import type { SessionRollup } from "./sessionRollup.js";
import {
	assertShippedDigestPrivate,
	buildShippedDigest,
	findForbiddenShippedDigestKey,
	formatShippedDigestJson,
	formatShippedDigestMarkdown,
	shippedDigestIsPrivate,
} from "./shippedDigest.js";

const cleanRollup: SessionRollup = {
	callSessionId: "sess-1",
	roomId: "room-a",
	durationMs: 120_000,
	tasksCompleted: 2,
	completedTaskIds: ["t-parse", "t-tests"],
	planCleanDrain: true,
	postSuccessPlanContinue: false,
	intentRefresh: false,
	tasksPerSessionMinute: 1,
	midPlanAddCount: 0,
	failureStickyCount: 0,
};

const continueRollup: SessionRollup = {
	callSessionId: "sess-2",
	roomId: "room-a",
	durationMs: 60_000,
	tasksCompleted: 1,
	completedTaskIds: ["t-next"],
	planCleanDrain: false,
	postSuccessPlanContinue: true,
	intentRefresh: true,
	tasksPerSessionMinute: 1,
	midPlanAddCount: 1,
	failureStickyCount: 0,
};

describe("buildShippedDigest", () => {
	it("aggregates rollup counts and task ids", () => {
		const digest = buildShippedDigest({
			rollups: [cleanRollup, continueRollup],
			taskTitles: { "t-parse": "Fix parser", "t-tests": "Rerun tests" },
			now: () => new Date("2026-07-31T00:00:00.000Z"),
		});
		expect(digest.kind).toBe("shipped_digest");
		expect(digest.sessionCount).toBe(2);
		expect(digest.tasksCompletedTotal).toBe(3);
		expect(digest.cleanDrainCount).toBe(1);
		expect(digest.continueCount).toBe(1);
		expect(digest.sessions[0]?.completedTasks).toEqual([
			{ taskId: "t-parse", title: "Fix parser" },
			{ taskId: "t-tests", title: "Rerun tests" },
		]);
		expect(digest.sessions[1]?.completedTasks).toEqual([
			{ taskId: "t-next" },
		]);
	});

	it("formats a readable Markdown digest", () => {
		const digest = buildShippedDigest({
			rollups: [cleanRollup],
			taskTitles: { "t-parse": "Fix parser", "t-tests": "Rerun tests" },
			now: () => new Date("2026-07-31T00:00:00.000Z"),
		});
		const md = formatShippedDigestMarkdown(digest);
		expect(md).toContain("# What Drive shipped");
		expect(md).toContain("Fix parser");
		expect(md).toContain("S3 clean-drain");
		expect(md).toContain("sess-1");
		expect(md.toLowerCase()).not.toMatch(/utterance|transcript|audio/);
	});

	it("formats JSON without forbidden keys", () => {
		const digest = buildShippedDigest({
			rollups: [cleanRollup],
			now: () => new Date("2026-07-31T00:00:00.000Z"),
		});
		const json = formatShippedDigestJson(digest);
		expect(JSON.parse(json).kind).toBe("shipped_digest");
		expect(json.toLowerCase()).not.toMatch(/utterance|transcript|audio/);
	});
});

describe("shippedDigest privacy", () => {
	it("accepts a clean digest", () => {
		const digest = buildShippedDigest({ rollups: [cleanRollup] });
		expect(shippedDigestIsPrivate(digest)).toBe(true);
		expect(() => assertShippedDigestPrivate(digest)).not.toThrow();
	});

	it("rejects utterance / transcript / audio keys deeply", () => {
		expect(
			findForbiddenShippedDigestKey({
				kind: "shipped_digest",
				sessions: [{ callSessionId: "s", utterance: "hi" }],
			}),
		).toBe("sessions.0.utterance");
		expect(
			shippedDigestIsPrivate({
				kind: "shipped_digest",
				fullTranscript: "nope",
			}),
		).toBe(false);
		expect(
			assertShippedDigestPrivate as (d: unknown) => void,
		).toBeTypeOf("function");
		expect(() =>
			assertShippedDigestPrivate({
				kind: "shipped_digest",
				generatedAt: "x",
				sessionCount: 0,
				tasksCompletedTotal: 0,
				cleanDrainCount: 0,
				continueCount: 0,
				sessions: [],
				audio: "wav",
			} as never),
		).toThrow(/forbidden key/);
	});
});
