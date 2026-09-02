import { DRIVE_INK_VIOLET_INDEX, driveInkTheme } from "@cline/drive";
import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	buildParticipantInkMap,
	DRIVE_SCREEN_INK_THEME,
	driveInkCssVariable,
	driveParticipantProfileId,
	inkCssValue,
	readAgentInkMap,
	resolveParticipantInk,
} from "./agent-ink";

const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
};

const cline: Participant = {
	id: "drive:partner",
	kind: "agent",
	displayName: "Cline",
	role: "partner",
	status: "working",
	ref: { kind: "builtin", id: "pair_partner" },
	seatSources: [{ kind: "manual" }],
};

const riley: Participant = {
	id: "agent:riley",
	kind: "agent",
	displayName: "Riley",
	role: "specialist",
	status: "working",
	ref: { kind: "driveagent", slug: "riley" },
	seatSources: [{ kind: "pack", packId: "router-fix-pack" }],
};

const legacy: Participant = {
	id: "agent:legacy",
	kind: "agent",
	displayName: "Legacy",
	role: "specialist",
	status: "idle",
	seatSources: [],
};

describe("driveParticipantProfileId", () => {
	it("flattens the ref when the seat recorded one", () => {
		expect(driveParticipantProfileId(cline)).toBe("builtin.pair_partner");
		expect(driveParticipantProfileId(riley)).toBe("driveagent.riley");
	});

	it("falls back to the participant id for legacy seats and humans", () => {
		expect(driveParticipantProfileId(legacy)).toBe("agent:legacy");
		expect(driveParticipantProfileId(human)).toBe("drive:human");
	});
});

describe("resolveParticipantInk", () => {
	const dark = driveInkTheme("dark");
	const light = driveInkTheme("light");

	it("leaves humans alone", () => {
		expect(
			resolveParticipantInk({ participant: human, theme: dark }),
		).toBeNull();
	});

	it("gives an agent with no stored ink a stable palette default that is never the violet", () => {
		const first = resolveParticipantInk({ participant: riley, theme: dark });
		const again = resolveParticipantInk({ participant: riley, theme: dark });
		expect(first).not.toBeNull();
		expect(first?.ref.kind).toBe("palette");
		expect(first?.paletteIndex).not.toBe(DRIVE_INK_VIOLET_INDEX);
		expect(again?.paletteIndex).toBe(first?.paletteIndex);
		expect(first?.color).toMatch(/^oklch\(/);
		expect(first?.css).toBe(
			`var(${driveInkCssVariable(first?.paletteIndex ?? -1)}, ${first?.color})`,
		);
	});

	it("uses the stored ink keyed by the durable profile id", () => {
		const ink = resolveParticipantInk({
			participant: cline,
			inks: {
				"builtin.pair_partner": { nameInk: { kind: "palette", index: 5 } },
			},
			theme: dark,
		});
		expect(ink?.paletteIndex).toBe(5);
		expect(ink?.css).toContain("--drive-ink-5");
	});

	it("paints token refs with the matching desktop token", () => {
		const ink = resolveParticipantInk({
			participant: riley,
			inks: {
				"driveagent.riley": { nameInk: { kind: "token", token: "foreground" } },
			},
			theme: light,
		});
		expect(ink?.ref).toEqual({ kind: "token", token: "foreground" });
		expect(ink?.css).toBe("var(--foreground)");
		expect(ink?.paletteIndex).toBeNull();
	});

	it("resolves differently per theme and against the fixed-dark screen well", () => {
		const onDark = resolveParticipantInk({ participant: riley, theme: dark });
		const onLight = resolveParticipantInk({ participant: riley, theme: light });
		const onScreen = resolveParticipantInk({
			participant: riley,
			theme: DRIVE_SCREEN_INK_THEME,
		});
		expect(onDark?.paletteIndex).toBe(onLight?.paletteIndex);
		expect(onDark?.color).not.toBe(onLight?.color);
		expect(onScreen?.color).toMatch(/^oklch\(/);
	});

	it("reads the body channel independently of the name channel", () => {
		const body = resolveParticipantInk({
			participant: riley,
			theme: dark,
			channel: "body",
		});
		expect(body?.ref).toEqual({ kind: "token", token: "muted" });
		expect(body?.css).toBe("var(--muted-foreground)");
	});
});

describe("inkCssValue", () => {
	it("maps palette entries to the ramp token with the resolved fallback", () => {
		expect(
			inkCssValue({ kind: "palette", index: 2 }, "oklch(0.5 0.1 49)"),
		).toBe("var(--drive-ink-2, oklch(0.5 0.1 49))");
	});

	it("maps every token", () => {
		expect(inkCssValue({ kind: "token", token: "muted" }, "x")).toBe(
			"var(--muted-foreground)",
		);
		expect(inkCssValue({ kind: "token", token: "success" }, "x")).toBe(
			"var(--success-text)",
		);
		expect(inkCssValue({ kind: "token", token: "warning" }, "x")).toBe(
			"var(--warning-text)",
		);
		expect(inkCssValue({ kind: "token", token: "info" }, "x")).toBe(
			"var(--info-text)",
		);
	});
});

describe("buildParticipantInkMap", () => {
	it("keys agents by participant id and skips humans", () => {
		const map = buildParticipantInkMap(
			[human, cline, riley],
			undefined,
			driveInkTheme("dark"),
		);
		expect(Object.keys(map).sort()).toEqual(["agent:riley", "drive:partner"]);
	});
});

describe("readAgentInkMap", () => {
	it("reads `{ profiles }`, `{ profile }` and bare arrays, skipping junk", () => {
		const profile = {
			id: "driveagent.riley",
			ref: { kind: "driveagent", slug: "riley" },
			nameInk: { kind: "palette", index: 3 },
			bodyInk: { kind: "token", token: "muted" },
		};
		expect(readAgentInkMap({ profiles: [profile, { id: "" }, 42] })).toEqual({
			"driveagent.riley": {
				nameInk: { kind: "palette", index: 3 },
				bodyInk: { kind: "token", token: "muted" },
			},
		});
		expect(readAgentInkMap({ profile })).toHaveProperty("driveagent.riley");
		expect(readAgentInkMap([profile])).toHaveProperty("driveagent.riley");
		expect(readAgentInkMap(null)).toEqual({});
		expect(
			readAgentInkMap({
				profiles: [{ id: "x", nameInk: { kind: "palette", index: 9 } }],
			}),
		).toEqual({});
	});
});
