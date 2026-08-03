/**
 * The unit under test is per-agent-ness: before this, one global
 * `partnerNameInk` painted every seated agent the same colour, so "the roster
 * renders inks" was true and useless. Every assertion here compares two agents.
 */

import { DRIVE_DARK_INK_THEME, DRIVE_LIGHT_INK_THEME } from "@cline/drive";
import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	DRIVE_SCREEN_INK_THEME,
	driveParticipantProfileId,
	resolveParticipantNameInk,
	resolveSpotlightSharerInk,
} from "./agentInk";
import { applyAgentNameInk, DEFAULT_DRIVE_UI } from "./types";

function agent(overrides: Partial<Participant> & { id: string }): Participant {
	return {
		kind: "agent",
		displayName: "Agent",
		role: "specialist",
		status: "idle",
		seatSources: [],
		...overrides,
	} as Participant;
}

const nova = agent({
	id: "seat_1",
	displayName: "Nova",
	ref: { kind: "driveagent", slug: "nova" },
});
const reviewer = agent({
	id: "seat_2",
	displayName: "Reviewer",
	ref: { kind: "driveagent", slug: "reviewer" },
});
const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
};

describe("profile id", () => {
	it("keys off the durable ref when the seat recorded one", () => {
		expect(driveParticipantProfileId(nova)).toBe("driveagent.nova");
	});

	it("falls back to the participant id for a seat with no ref", () => {
		expect(driveParticipantProfileId(agent({ id: "drive:partner" }))).toBe(
			"drive:partner",
		);
	});
});

describe("per-agent name ink", () => {
	it("gives two agents with different stored inks different colours", () => {
		let drive = applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 3);
		drive = applyAgentNameInk(drive, "driveagent.reviewer", 1);

		const novaInk = resolveParticipantNameInk({
			drive,
			participant: nova,
			theme: DRIVE_LIGHT_INK_THEME,
		});
		const reviewerInk = resolveParticipantNameInk({
			drive,
			participant: reviewer,
			theme: DRIVE_LIGHT_INK_THEME,
		});

		expect(novaInk).toBeDefined();
		expect(reviewerInk).toBeDefined();
		expect(novaInk).not.toBe(reviewerInk);
	});

	it("does not leak one agent's ink onto another", () => {
		// The regression the old global field guaranteed: setting one agent's
		// ink used to change every other agent's byline too.
		const before = resolveParticipantNameInk({
			drive: DEFAULT_DRIVE_UI,
			participant: reviewer,
			theme: DRIVE_LIGHT_INK_THEME,
		});
		const after = resolveParticipantNameInk({
			drive: applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 3),
			participant: reviewer,
			theme: DRIVE_LIGHT_INK_THEME,
		});
		expect(after).toBe(before);
	});

	it("gives an ink-less agent the same colour on every render", () => {
		const render = () =>
			resolveParticipantNameInk({
				drive: DEFAULT_DRIVE_UI,
				participant: nova,
				theme: DRIVE_LIGHT_INK_THEME,
			});
		const first = render();
		expect(first).toBeDefined();
		for (let n = 0; n < 20; n += 1) {
			expect(render()).toBe(first);
		}
	});

	it("gives two ink-less agents different colours", () => {
		const theme = DRIVE_LIGHT_INK_THEME;
		const drive = DEFAULT_DRIVE_UI;
		expect(
			resolveParticipantNameInk({ drive, participant: nova, theme }),
		).not.toBe(
			resolveParticipantNameInk({ drive, participant: reviewer, theme }),
		);
	});

	it("repaints the same agent when the theme flips", () => {
		const drive = applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 3);
		expect(
			resolveParticipantNameInk({
				drive,
				participant: nova,
				theme: DRIVE_LIGHT_INK_THEME,
			}),
		).not.toBe(
			resolveParticipantNameInk({
				drive,
				participant: nova,
				theme: DRIVE_DARK_INK_THEME,
			}),
		);
	});

	it("leaves humans to the room's chrome colours", () => {
		expect(
			resolveParticipantNameInk({
				drive: DEFAULT_DRIVE_UI,
				participant: human,
				theme: DRIVE_LIGHT_INK_THEME,
			}),
		).toBeUndefined();
	});

	it("never returns a raw hex — the resolver owns the colour space", () => {
		const drive = applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 5);
		const ink = resolveParticipantNameInk({
			drive,
			participant: nova,
			theme: DRIVE_DARK_INK_THEME,
		});
		expect(ink).toMatch(/^oklch\(/);
	});
});

describe("spotlight sharer ink", () => {
	it("matches the roster byline for the same agent", () => {
		const drive = applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 4);
		const participants = [human, nova];
		expect(
			resolveSpotlightSharerInk(drive, DRIVE_SCREEN_INK_THEME, participants),
		).toBe(
			resolveParticipantNameInk({
				drive,
				participant: nova,
				theme: DRIVE_SCREEN_INK_THEME,
			}),
		);
	});

	it("follows the spotlight holder, not whichever agent sorts first", () => {
		// With one agent these coincide, which is why a single-agent fixture
		// cannot catch this; the feature exists for the multi-agent case.
		const drive = {
			...applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 4),
			spotlightParticipantId: reviewer.id,
		};
		const participants = [human, nova, reviewer];

		expect(
			resolveSpotlightSharerInk(drive, DRIVE_SCREEN_INK_THEME, participants),
		).toBe(
			resolveParticipantNameInk({
				drive,
				participant: reviewer,
				theme: DRIVE_SCREEN_INK_THEME,
			}),
		);
		expect(
			resolveSpotlightSharerInk(drive, DRIVE_SCREEN_INK_THEME, participants),
		).not.toBe(
			resolveParticipantNameInk({
				drive,
				participant: nova,
				theme: DRIVE_SCREEN_INK_THEME,
			}),
		);
	});

	it("falls back to the partner when the spotlight id names no agent", () => {
		const drive = {
			...DEFAULT_DRIVE_UI,
			spotlightParticipantId: "drive:human",
		};
		const partner = agent({
			id: "seat_partner",
			displayName: "Cline",
			role: "partner",
			ref: { kind: "driveagent", slug: "pair-partner" },
		});
		expect(
			resolveSpotlightSharerInk(drive, DRIVE_SCREEN_INK_THEME, [
				human,
				reviewer,
				partner,
			]),
		).toBe(
			resolveParticipantNameInk({
				drive,
				participant: partner,
				theme: DRIVE_SCREEN_INK_THEME,
			}),
		);
	});

	it("is undefined when no agent is seated", () => {
		expect(
			resolveSpotlightSharerInk(DEFAULT_DRIVE_UI, DRIVE_SCREEN_INK_THEME, [
				human,
			]),
		).toBeUndefined();
	});
});
