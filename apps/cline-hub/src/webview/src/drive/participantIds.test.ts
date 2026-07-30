import { describe, expect, it } from "vitest";
import {
	isDriveHumanId,
	isDrivePartnerId,
	toggleDriveSpotlightId,
} from "./participantIds";
import { DRIVE_PARTICIPANT_HUMAN, DRIVE_PARTICIPANT_PARTNER } from "./types";

describe("participantIds", () => {
	it("accepts canonical and legacy human ids", () => {
		expect(isDriveHumanId(DRIVE_PARTICIPANT_HUMAN)).toBe(true);
		expect(isDriveHumanId("human")).toBe(true);
		expect(isDriveHumanId("you")).toBe(true);
		expect(isDriveHumanId("human:guest")).toBe(false);
		expect(isDriveHumanId(DRIVE_PARTICIPANT_PARTNER)).toBe(false);
	});

	it("toggles spotlight between human and partner", () => {
		expect(toggleDriveSpotlightId(DRIVE_PARTICIPANT_PARTNER)).toBe(
			DRIVE_PARTICIPANT_HUMAN,
		);
		expect(toggleDriveSpotlightId("partner")).toBe(DRIVE_PARTICIPANT_HUMAN);
		expect(toggleDriveSpotlightId(DRIVE_PARTICIPANT_HUMAN)).toBe(
			DRIVE_PARTICIPANT_PARTNER,
		);
	});

	it("detects partner ids", () => {
		expect(isDrivePartnerId("drive:partner")).toBe(true);
		expect(isDrivePartnerId("partner")).toBe(true);
	});
});
