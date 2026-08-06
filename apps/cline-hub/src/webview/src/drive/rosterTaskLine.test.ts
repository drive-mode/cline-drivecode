import { describe, expect, it } from "vitest";
import { rosterParticipantTaskLine } from "./rosterTaskLine";
import {
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	EMPTY_BANK_SNAPSHOT,
	type DriveUiState,
} from "./types";

function driveWithNow(nowTitle: string | null): DriveUiState {
	return {
		...DEFAULT_DRIVE_UI,
		active: true,
		roomId: "default",
		partnerName: "Coder",
		subMode: "agent",
		bankSnapshot: {
			...EMPTY_BANK_SNAPSHOT,
			nowTaskId: nowTitle ? "t1" : null,
			nowTitle,
		},
	};
}

describe("rosterParticipantTaskLine", () => {
	it("returns nowTitle for working agents", () => {
		const drive = driveWithNow("Gate JWT refresh");
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Coder",
				role: "partner",
				status: "working",
				seatSources: [],
			}),
		).toBe("Gate JWT refresh");
	});

	it("returns null for humans and idle agents", () => {
		const drive = driveWithNow("Gate JWT refresh");
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_HUMAN,
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			}),
		).toBeNull();
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Coder",
				role: "partner",
				status: "idle",
				seatSources: [],
			}),
		).toBeNull();
	});

	it("returns null when bank has no title", () => {
		const drive = driveWithNow(null);
		expect(
			rosterParticipantTaskLine(drive, {
				id: DRIVE_PARTICIPANT_PARTNER,
				kind: "agent",
				displayName: "Coder",
				role: "partner",
				status: "working",
				seatSources: [],
			}),
		).toBeNull();
	});
});
