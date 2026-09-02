import { describe, expect, it } from "vitest";
import { absoluteTimeLabel, relativeTimeLabel } from "./relative-time";

const NOW = Date.parse("2026-09-02T12:00:00.000Z");

describe("relativeTimeLabel", () => {
	it("buckets by minute, hour and day", () => {
		expect(relativeTimeLabel("2026-09-02T11:59:40.000Z", NOW)).toBe("just now");
		expect(relativeTimeLabel("2026-09-02T11:52:00.000Z", NOW)).toBe("8m ago");
		expect(relativeTimeLabel("2026-09-02T09:30:00.000Z", NOW)).toBe("2h ago");
		expect(relativeTimeLabel("2026-08-30T12:00:00.000Z", NOW)).toBe("3d ago");
	});

	it("is empty for missing or unparseable input", () => {
		expect(relativeTimeLabel(null, NOW)).toBe("");
		expect(relativeTimeLabel("", NOW)).toBe("");
		expect(relativeTimeLabel("not a date", NOW)).toBe("");
	});
});

describe("absoluteTimeLabel", () => {
	it("formats parseable timestamps and passes the rest through", () => {
		expect(absoluteTimeLabel("2026-09-02T12:00:00.000Z", "en-US")).toMatch(
			/2026/,
		);
		expect(absoluteTimeLabel("garbage")).toBe("garbage");
		expect(absoluteTimeLabel(undefined)).toBe("—");
	});
});
