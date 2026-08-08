import { describe, expect, it } from "vitest";
import {
	APP_STRIP_CONTROLS,
	consumeLeaveKeepRunningNote,
	INTERRUPT_HARD_CANCEL_HINT,
	LEAVE_KEEP_RUNNING_LINE,
	LEAVE_STRIP_LABEL,
	muteRestoreAfterHold,
	PREVIEW_CHIP_LABEL,
	shouldShowPreviewChip,
	writeLeaveKeepRunningNote,
} from "./driveAppCallChrome";

function memoryStorage() {
	const mem = new Map<string, string>();
	return {
		getItem: (k: string) => mem.get(k) ?? null,
		setItem: (k: string, v: string) => {
			mem.set(k, v);
		},
		removeItem: (k: string) => {
			mem.delete(k);
		},
	};
}

describe("driveAppCallChrome", () => {
	it("keeps the one-hand strip to four controls", () => {
		expect([...APP_STRIP_CONTROLS]).toEqual([
			"mic",
			"hand",
			"captions",
			"leave",
		]);
	});

	it("restores mute only when hold temporarily unmuted", () => {
		expect(muteRestoreAfterHold({ unmutedByHold: true })).toBe("mute");
		expect(muteRestoreAfterHold({ unmutedByHold: false })).toBe("noop");
	});

	it("uses Leave not End copy", () => {
		expect(LEAVE_STRIP_LABEL).toBe("Leave");
		expect(LEAVE_KEEP_RUNNING_LINE.toLowerCase()).toContain("keeps running");
		expect(LEAVE_STRIP_LABEL.toLowerCase()).not.toContain("end");
	});

	it("consumes the leave keep-running note once", () => {
		const storage = memoryStorage();
		writeLeaveKeepRunningNote(storage);
		expect(consumeLeaveKeepRunningNote(storage)).toBe(LEAVE_KEEP_RUNNING_LINE);
		expect(consumeLeaveKeepRunningNote(storage)).toBeNull();
	});

	it("shows Preview chip for demo / unconfigured paths", () => {
		expect(PREVIEW_CHIP_LABEL).toBe("Preview · demo call");
		expect(shouldShowPreviewChip({ unconfigured: true })).toBe(true);
		expect(shouldShowPreviewChip({ demoQuery: true })).toBe(true);
		expect(shouldShowPreviewChip({ demoRoom: true })).toBe(true);
		expect(shouldShowPreviewChip({})).toBe(false);
	});

	it("keeps raise-hand hard-cancel teaching", () => {
		expect(INTERRUPT_HARD_CANCEL_HINT.toLowerCase()).toContain("cancel");
	});
});
