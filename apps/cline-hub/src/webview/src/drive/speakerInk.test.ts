/**
 * Feed inks (DRV-AGENT-PROFILE / #183).
 *
 * `bodyInk` shipped in the durable facet but coloured nothing. These pin the
 * two properties that make it real: the byline and the message body resolve
 * *independently*, and an unattributed message stays uncoloured — tinting it
 * would attribute it by colour right after the byline declined to attribute it
 * by name.
 */

import { DRIVE_LIGHT_INK_THEME, driveInkTheme } from "@cline/drive";
import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	inkStyle,
	resolveSpeakerByline,
	resolveSpeakerParticipant,
} from "../components/speakerBylineLogic";
import { buildSpeakerInkMap } from "./agentInk";
import { applyAgentInk, DEFAULT_DRIVE_UI } from "./types";

function agent(id: string, displayName: string, slug: string): Participant {
	return {
		id,
		kind: "agent",
		displayName,
		role: "specialist",
		status: "idle",
		ref: { kind: "driveagent", slug },
		seatSources: [],
	} as Participant;
}

const NOVA = agent("nova", "Nova", "nova");
const RILEY = agent("riley", "Riley", "riley");
const YOU: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
};

describe("buildSpeakerInkMap", () => {
	it("resolves name and body independently for one agent", () => {
		const drive = applyAgentInk(DEFAULT_DRIVE_UI, "driveagent.nova", {
			nameInk: { kind: "palette", index: 3 },
			bodyInk: { kind: "palette", index: 6 },
		});
		const inks = buildSpeakerInkMap(drive, [NOVA], DRIVE_LIGHT_INK_THEME);
		expect(inks.nova?.name).toBeTruthy();
		expect(inks.nova?.body).toBeTruthy();
		expect(inks.nova?.name).not.toBe(inks.nova?.body);
	});

	it("keeps two agents' colours apart", () => {
		const drive = applyAgentInk(
			applyAgentInk(DEFAULT_DRIVE_UI, "driveagent.nova", {
				nameInk: { kind: "palette", index: 1 },
			}),
			"driveagent.riley",
			{ nameInk: { kind: "palette", index: 4 } },
		);
		const inks = buildSpeakerInkMap(
			drive,
			[NOVA, RILEY],
			DRIVE_LIGHT_INK_THEME,
		);
		expect(inks.nova?.name).not.toBe(inks.riley?.name);
	});

	it("gives humans no ink at all", () => {
		const inks = buildSpeakerInkMap(
			DEFAULT_DRIVE_UI,
			[YOU, NOVA],
			DRIVE_LIGHT_INK_THEME,
		);
		expect(inks["drive:human"]).toBeUndefined();
		expect(inks.nova).toBeDefined();
	});

	it("keys by participant id, which is what speakerId carries", () => {
		const inks = buildSpeakerInkMap(
			DEFAULT_DRIVE_UI,
			[NOVA],
			DRIVE_LIGHT_INK_THEME,
		);
		expect(Object.keys(inks)).toEqual(["nova"]);
	});

	it("re-resolves per theme rather than storing a colour", () => {
		const drive = applyAgentInk(DEFAULT_DRIVE_UI, "driveagent.nova", {
			nameInk: { kind: "palette", index: 3 },
		});
		const light = buildSpeakerInkMap(drive, [NOVA], driveInkTheme("light"));
		const dark = buildSpeakerInkMap(drive, [NOVA], driveInkTheme("dark"));
		expect(light.nova?.name).not.toBe(dark.nova?.name);
	});
});

describe("resolveSpeakerParticipant", () => {
	it("returns the participant the byline names", () => {
		expect(resolveSpeakerParticipant("nova", [NOVA, RILEY])).toBe(NOVA);
		expect(resolveSpeakerByline("nova", [NOVA, RILEY])).toBe("Nova");
	});

	it("is null whenever the byline is null, so no lone avatar renders", () => {
		// The two must agree exactly: an avatar with no name is attribution
		// without a subject.
		for (const id of [undefined, "", "  ", "ghost"]) {
			expect(resolveSpeakerParticipant(id, [NOVA])).toBeNull();
			expect(resolveSpeakerByline(id, [NOVA])).toBeNull();
		}
		expect(resolveSpeakerParticipant("nova", [])).toBeNull();
		expect(resolveSpeakerParticipant("nova", undefined)).toBeNull();
	});

	it("is null for a participant whose display name is blank", () => {
		const blank = { ...NOVA, displayName: "   " } as Participant;
		expect(resolveSpeakerParticipant("nova", [blank])).toBeNull();
		expect(resolveSpeakerByline("nova", [blank])).toBeNull();
	});
});

describe("inkStyle", () => {
	it("is undefined for no colour, so the theme class still wins", () => {
		expect(inkStyle(undefined)).toBeUndefined();
		expect(inkStyle("")).toBeUndefined();
		expect(inkStyle("oklch(0.5 0.1 200)")).toEqual({
			color: "oklch(0.5 0.1 200)",
		});
	});
});
