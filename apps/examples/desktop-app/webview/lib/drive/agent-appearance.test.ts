import {
	DRIVE_INK_MIN_CONTRAST,
	DRIVE_INK_VIOLET_INDEX,
	DRIVE_SCREEN_INK_THEME,
	defaultInkRef,
	driveInkTheme,
} from "@cline/drive";
import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentInitial,
	agentInkColor,
	agentRefLabel,
	buildAgentProfileDraft,
	DRIVE_INK_PALETTE_LABELS,
	DRIVE_INK_PALETTE_SIZE,
	describeResolvedInk,
	driveParticipantProfileId,
	durableAppearanceTarget,
	fallbackDisplayName,
	inkFromPaletteChoice,
	inkFromProfile,
	inkPaletteIndex,
	paletteSwatches,
	resolveAgentInk,
	titleCaseSlug,
} from "./agent-appearance";

const riley: Participant = {
	id: "agent:riley",
	kind: "agent",
	displayName: "Riley",
	role: "specialist",
	status: "working",
	ref: { kind: "driveagent", slug: "riley" },
	seatSources: [{ kind: "manual" }],
};

const legacy: Participant = {
	id: "agent:legacy",
	kind: "agent",
	displayName: "Legacy",
	role: "specialist",
	status: "idle",
	seatSources: [],
};

const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
};

describe("agent appearance", () => {
	it("keys durable appearance by the flattened ref, else the seat id", () => {
		expect(driveParticipantProfileId(riley)).toBe("driveagent.riley");
		expect(driveParticipantProfileId(legacy)).toBe("agent:legacy");
		expect(durableAppearanceTarget(riley)).toEqual({
			ref: { kind: "driveagent", slug: "riley" },
			profileId: "driveagent.riley",
		});
		expect(durableAppearanceTarget(legacy)).toBeNull();
		expect(durableAppearanceTarget(human)).toBeNull();
	});

	it("maps picker choices to inks and back, with '' as Default", () => {
		expect(inkFromPaletteChoice("")).toBeNull();
		expect(inkFromPaletteChoice("3")).toEqual({ kind: "palette", index: 3 });
		expect(inkFromPaletteChoice("8")).toBeNull();
		expect(inkFromPaletteChoice("-1")).toBeNull();
		expect(inkFromPaletteChoice("teal")).toBeNull();
		expect(inkPaletteIndex({ kind: "palette", index: 6 })).toBe(6);
		expect(inkPaletteIndex({ kind: "token", token: "muted" })).toBeNull();
		expect(inkPaletteIndex(undefined)).toBeNull();
	});

	it("fills the untouched channel with the resolver default", () => {
		const draft = buildAgentProfileDraft({
			ref: { kind: "driveagent", slug: "riley" },
			profileId: "driveagent.riley",
			displayName: "  Riley  ",
			ink: { nameInk: { kind: "palette", index: 2 } },
		});
		expect(draft).toEqual({
			ref: { kind: "driveagent", slug: "riley" },
			displayName: "Riley",
			nameInk: { kind: "palette", index: 2 },
			bodyInk: defaultInkRef("body", "driveagent.riley"),
		});
		const blank = buildAgentProfileDraft({
			ref: { kind: "builtin", id: "pair_partner" },
			profileId: "builtin.pair_partner",
			displayName: "   ",
		});
		expect(blank.displayName).toBeUndefined();
		expect(blank.nameInk).toEqual(
			defaultInkRef("name", "builtin.pair_partner"),
		);
	});

	it("reads ink out of a stored profile", () => {
		expect(inkFromProfile(null)).toEqual({});
		expect(
			inkFromProfile({
				nameInk: { kind: "palette", index: 1 },
				bodyInk: { kind: "token", token: "muted" },
			}),
		).toEqual({
			nameInk: { kind: "palette", index: 1 },
			bodyInk: { kind: "token", token: "muted" },
		});
	});

	it("resolves every palette swatch through the contrast clamp", () => {
		expect(DRIVE_INK_PALETTE_LABELS).toHaveLength(DRIVE_INK_PALETTE_SIZE);
		for (const theme of [
			driveInkTheme("light"),
			driveInkTheme("dark"),
			DRIVE_SCREEN_INK_THEME,
		]) {
			const swatches = paletteSwatches({
				channel: "name",
				profileId: "driveagent.riley",
				theme,
			});
			expect(swatches.map((swatch) => swatch.index)).toEqual([
				0, 1, 2, 3, 4, 5, 6, 7,
			]);
			for (const swatch of swatches) {
				expect(swatch.color).toMatch(/^oklch\(/);
				expect(swatch.contrast).toBeGreaterThanOrEqual(
					DRIVE_INK_MIN_CONTRAST - 0.01,
				);
				expect(swatch.isAccent).toBe(swatch.index === DRIVE_INK_VIOLET_INDEX);
			}
			expect(swatches[5]?.label).toBe("Violet");
		}
	});

	it("describes how an ink resolved in one line", () => {
		const resolved = resolveAgentInk({
			ink: { kind: "palette", index: 0 },
			channel: "name",
			profileId: "driveagent.riley",
			theme: driveInkTheme("dark"),
		});
		expect(describeResolvedInk(resolved)).toMatch(/:1/);
		expect(
			describeResolvedInk({
				color: "oklch(0.5 0 0)",
				contrast: 3.2,
				clamped: true,
				fallbackToken: "foreground",
			}),
		).toContain("foreground");
		expect(
			describeResolvedInk({
				color: "oklch(0.5 0 0)",
				contrast: 5,
				clamped: true,
				fallbackToken: null,
			}),
		).toBe("Lightness adjusted to reach 5.0:1.");
	});

	it("resolves an unstyled agent through its stable default", () => {
		const theme = driveInkTheme("dark");
		const unstyled = agentInkColor({
			ink: null,
			channel: "name",
			profileId: "driveagent.riley",
			theme,
		});
		const explicit = agentInkColor({
			ink: defaultInkRef("name", "driveagent.riley"),
			channel: "name",
			profileId: "driveagent.riley",
			theme,
		});
		expect(unstyled).toBe(explicit);
		expect(defaultInkRef("name", "driveagent.riley")).not.toEqual({
			kind: "palette",
			index: DRIVE_INK_VIOLET_INDEX,
		});
	});

	it("formats names, initials and ref labels", () => {
		expect(agentInitial("riley")).toBe("R");
		expect(agentInitial("  ")).toBe("?");
		expect(titleCaseSlug("pair_partner")).toBe("Pair Partner");
		expect(fallbackDisplayName({ kind: "driveagent", slug: "sam-two" })).toBe(
			"Sam Two",
		);
		expect(agentRefLabel({ kind: "driveagent", slug: "riley" })).toBe(
			".driveagent/riley/",
		);
		expect(agentRefLabel({ kind: "builtin", id: "pair_partner" })).toBe(
			"builtin · pair_partner",
		);
		expect(agentRefLabel(null)).toBe("legacy seat · no ref");
	});
});
