/**
 * A contrast clamp is invisible when it works and invisible when it does
 * nothing, so every assertion here is on the *returned colour*, never on "the
 * clamp ran".
 */

import { describe, expect, it } from "vitest";
import {
	compositeOver,
	contrastRatio,
	DRIVE_DARK_INK_THEME,
	DRIVE_INK_DEFAULT_INDICES,
	DRIVE_INK_MIN_CONTRAST,
	DRIVE_INK_PALETTE,
	DRIVE_INK_VIOLET_INDEX,
	DRIVE_LIGHT_INK_THEME,
	DRIVE_SCREEN_INK_THEME,
	type DriveInkTheme,
	type DriveInkToken,
	defaultNameInkIndex,
	driveInkTheme,
	formatOklch,
	oklchToSrgb,
	parseCssColor,
	resolveInk,
	srgbToOklch,
} from "./resolve.js";

/** What the raw colour string would render as, untouched by any clamp. */
function asOklchString(css: string): string {
	const parsed = parseCssColor(css);
	if (!parsed) {
		throw new Error(`unparseable colour: ${css}`);
	}
	return formatOklch(srgbToOklch(parsed.rgb));
}

/** What a theme token renders as once composited over its well, unclamped. */
function tokenColor(theme: DriveInkTheme, token: DriveInkToken): string {
	const parsed = parseCssColor(theme.tokens[token]);
	const well = parseCssColor(theme.well);
	if (!parsed || !well) {
		throw new Error(`unparseable token: ${token}`);
	}
	return formatOklch(
		srgbToOklch(compositeOver(parsed.rgb, parsed.alpha, well.rgb)),
	);
}

function measuredContrast(color: string, well: string): number {
	const ink = parseCssColor(color);
	const bg = parseCssColor(well);
	if (!ink || !bg) {
		throw new Error(`unparseable pair: ${color} / ${well}`);
	}
	return contrastRatio(ink.rgb, bg.rgb);
}

/**
 * A gray whose luminance sits in the narrow window that fails against *both*
 * shipped wells: too dark for `#f8fafb`, too light for `#0a0a0a`.
 */
const KNOWN_BAD_INK = "#787878";

function themeWithBadToken(base: DriveInkTheme): DriveInkTheme {
	return { ...base, tokens: { ...base.tokens, info: KNOWN_BAD_INK } };
}

describe("contrast clamp", () => {
	// The inert-risk guard: a clamp that never clamps would pass a
	// "was it called" assertion and fail every row below.
	it.each([
		{ mode: "light" as const, base: DRIVE_LIGHT_INK_THEME },
		{ mode: "dark" as const, base: DRIVE_DARK_INK_THEME },
	])(
		"moves a known-bad ink off its input value on the $mode well",
		({ base }) => {
			const theme = themeWithBadToken(base);
			const input = asOklchString(KNOWN_BAD_INK);

			// Precondition: the raw ink really is illegible on this well,
			// otherwise the row proves nothing.
			expect(measuredContrast(KNOWN_BAD_INK, theme.well)).toBeLessThan(
				DRIVE_INK_MIN_CONTRAST,
			);

			const resolved = resolveInk({
				ink: { kind: "token", token: "info" },
				channel: "name",
				profileId: "driveagent.pair-partner",
				theme,
			});

			expect(resolved.color).not.toBe(input);
			expect(resolved.clamped).toBe(true);
			expect(resolved.fallbackToken).toBeNull();
			expect(resolved.contrast).toBeGreaterThanOrEqual(DRIVE_INK_MIN_CONTRAST);
			expect(
				measuredContrast(resolved.color, theme.well),
			).toBeGreaterThanOrEqual(DRIVE_INK_MIN_CONTRAST);
		},
	);

	it("clamps toward the well: darker on light, lighter on dark", () => {
		const light = resolveInk({
			ink: { kind: "token", token: "info" },
			channel: "name",
			profileId: "a",
			theme: themeWithBadToken(DRIVE_LIGHT_INK_THEME),
		});
		const dark = resolveInk({
			ink: { kind: "token", token: "info" },
			channel: "name",
			profileId: "a",
			theme: themeWithBadToken(DRIVE_DARK_INK_THEME),
		});
		const lightness = (color: string) =>
			srgbToOklch(parseCssColor(color)?.rgb ?? { r: 0, g: 0, b: 0 }).l;
		const seed = lightness(asOklchString(KNOWN_BAD_INK));

		expect(lightness(light.color)).toBeLessThan(seed);
		expect(lightness(dark.color)).toBeGreaterThan(seed);
	});

	it("clamps a real shipped token that is illegible as shipped", () => {
		// `--brand-green` on the near-white well is 1.9:1 in its own right.
		const raw = DRIVE_LIGHT_INK_THEME.tokens.success;
		expect(measuredContrast(raw, DRIVE_LIGHT_INK_THEME.well)).toBeLessThan(
			DRIVE_INK_MIN_CONTRAST,
		);

		const resolved = resolveInk({
			ink: { kind: "token", token: "success" },
			channel: "name",
			profileId: "driveagent.reviewer",
			theme: DRIVE_LIGHT_INK_THEME,
		});

		expect(resolved.color).not.toBe(asOklchString(raw));
		expect(resolved.clamped).toBe(true);
		expect(
			measuredContrast(resolved.color, DRIVE_LIGHT_INK_THEME.well),
		).toBeGreaterThanOrEqual(DRIVE_INK_MIN_CONTRAST);

		// Hue survives — a clamped green is still green, not a gray smudge.
		const hue = srgbToOklch(
			parseCssColor(resolved.color)?.rgb ?? { r: 0, g: 0, b: 0 },
		).h;
		expect(
			Math.abs(
				hue - srgbToOklch(parseCssColor(raw)?.rgb ?? { r: 0, g: 0, b: 0 }).h,
			),
		).toBeLessThan(2);
	});

	it("leaves an ink that already clears the ratio exactly where it was", () => {
		const resolved = resolveInk({
			ink: { kind: "token", token: "foreground" },
			channel: "name",
			profileId: "a",
			theme: DRIVE_DARK_INK_THEME,
		});
		expect(resolved.clamped).toBe(false);
		expect(resolved.fallbackToken).toBeNull();
		expect(resolved.color).toBe(tokenColor(DRIVE_DARK_INK_THEME, "foreground"));
	});
});

describe("token fallback", () => {
	// A mid-tone well is the real case where no legible lightness on the
	// requested hue clears the ratio.
	const MID_TONE_WELL = "#767676";

	it.each([
		{
			mode: "light" as const,
			base: DRIVE_LIGHT_INK_THEME,
			channel: "name" as const,
			token: "foreground" as const,
		},
		{
			mode: "light" as const,
			base: DRIVE_LIGHT_INK_THEME,
			channel: "body" as const,
			token: "muted" as const,
		},
		{
			mode: "dark" as const,
			base: DRIVE_DARK_INK_THEME,
			channel: "name" as const,
			token: "foreground" as const,
		},
		{
			mode: "dark" as const,
			base: DRIVE_DARK_INK_THEME,
			channel: "body" as const,
			token: "muted" as const,
		},
	])(
		"falls back to $token for $channel on the $mode theme",
		({ base, channel, token }) => {
			const theme: DriveInkTheme = { ...base, well: MID_TONE_WELL };
			const resolved = resolveInk({
				ink: { kind: "palette", index: 2 },
				channel,
				profileId: "driveagent.nova",
				theme,
			});

			expect(resolved.fallbackToken).toBe(token);
			// The documented token is what actually comes back, not merely a flag.
			expect(resolved.color).toBe(tokenColor(theme, token));
		},
	);

	it("does not fall back on either shipped well", () => {
		for (const theme of [
			DRIVE_LIGHT_INK_THEME,
			DRIVE_DARK_INK_THEME,
			DRIVE_SCREEN_INK_THEME,
		]) {
			for (let index = 0; index < DRIVE_INK_PALETTE.length; index += 1) {
				const resolved = resolveInk({
					ink: { kind: "palette", index: index as 0 },
					channel: "name",
					profileId: "a",
					theme,
				});
				expect(resolved.fallbackToken).toBeNull();
				expect(resolved.contrast).toBeGreaterThanOrEqual(
					DRIVE_INK_MIN_CONTRAST,
				);
			}
		}
	});
});

describe("emitted colour is the measured colour", () => {
	// The guarantee is about the string handed to CSS, not an internal seed.
	// An out-of-gamut oklch() is remapped by the browser (moving lightness AND
	// hue), so if the clip were dropped the reported ratio would describe a
	// colour nobody ever sees. Re-parsing what we emit is what catches that.
	it.each([
		{ mode: "light" as const, theme: DRIVE_LIGHT_INK_THEME },
		{ mode: "dark" as const, theme: DRIVE_DARK_INK_THEME },
		{ mode: "screen" as const, theme: DRIVE_SCREEN_INK_THEME },
	])("re-measures to the reported contrast on the $mode well", ({ theme }) => {
		for (let index = 0; index < DRIVE_INK_PALETTE.length; index += 1) {
			const resolved = resolveInk({
				ink: { kind: "palette", index: index as 0 },
				channel: "name",
				profileId: "a",
				theme,
			});
			const emitted = measuredContrast(resolved.color, theme.well);
			// Tolerance covers formatOklch rounding only; the bug this catches
			// (emitting an unclipped colour) moved contrast by 0.3-1.1.
			expect(emitted).toBeCloseTo(resolved.contrast, 2);
			expect(emitted).toBeGreaterThanOrEqual(DRIVE_INK_MIN_CONTRAST);
		}
	});

	it("emits an in-gamut colour for an out-of-gamut request", () => {
		// Rose at dark-theme lightness asks for more chroma than sRGB has.
		const requested = { l: 0.78, c: 0.1978, h: 16.93 };
		const emitted = formatOklch(requested);
		const parsed = parseCssColor(emitted);
		if (!parsed) {
			throw new Error(emitted);
		}
		const back = srgbToOklch(parsed.rgb);
		expect(back.c).toBeLessThan(requested.c);
		// Lightness and hue survive; only chroma gives way.
		expect(back.l).toBeCloseTo(requested.l, 2);
		expect(back.h).toBeCloseTo(requested.h, 1);
	});

	it("clamped tokens re-measure too, not just palette entries", () => {
		const resolved = resolveInk({
			ink: { kind: "token", token: "success" },
			channel: "name",
			profileId: "a",
			theme: DRIVE_LIGHT_INK_THEME,
		});
		expect(resolved.clamped).toBe(true);
		expect(
			measuredContrast(resolved.color, DRIVE_LIGHT_INK_THEME.well),
		).toBeCloseTo(resolved.contrast, 2);
	});
});

describe("default ink hash", () => {
	// Golden values. Asserting the function agrees with itself passes for any
	// implementation, including `return 0`; these change only if the hash does,
	// which is the thing that must not drift — an agent's colour is durable.
	it.each([
		{ id: "driveagent.pair-partner", index: 6 },
		{ id: "builtin.pair_partner", index: 2 },
		{ id: "driveagent.reviewer", index: 7 },
		{ id: "driveagent.nova", index: 3 },
		{ id: "driveagent.scout", index: 2 },
		{ id: "drive:partner", index: 7 },
	])("pins $id to palette $index", ({ id, index }) => {
		expect(defaultNameInkIndex(id)).toBe(index);
	});

	it("spreads distinct agents across the palette", () => {
		const ids = [
			"driveagent.pair-partner",
			"builtin.pair_partner",
			"driveagent.reviewer",
			"driveagent.nova",
			"configured.adam",
			"driveagent.scout",
		];
		const picked = new Set(ids.map(defaultNameInkIndex));
		// A two-bucket hash would satisfy `> 1`.
		expect(picked.size).toBeGreaterThanOrEqual(3);
	});

	it("uses the whole default pool, not a corner of it", () => {
		const seen = new Set<number>();
		for (let n = 0; n < 500; n += 1) {
			seen.add(defaultNameInkIndex(`driveagent.agent-${n}`));
		}
		expect(seen.size).toBe(DRIVE_INK_DEFAULT_INDICES.length);
	});

	it("never defaults an agent to Cline violet", () => {
		expect(DRIVE_INK_DEFAULT_INDICES).not.toContain(DRIVE_INK_VIOLET_INDEX);
		for (let n = 0; n < 2000; n += 1) {
			const index = defaultNameInkIndex(`driveagent.agent-${n}`);
			expect(index).not.toBe(DRIVE_INK_VIOLET_INDEX);
			expect(DRIVE_INK_DEFAULT_INDICES).toContain(index);
		}
	});

	it("gives two ink-less agents different colours, and each a stable one", () => {
		const theme = DRIVE_LIGHT_INK_THEME;
		const render = (profileId: string) =>
			resolveInk({ ink: null, channel: "name", profileId, theme }).color;

		expect(render("driveagent.pair-partner")).not.toBe(
			render("driveagent.nova"),
		);
		expect(render("driveagent.nova")).toBe(render("driveagent.nova"));
	});

	it("defaults bodies to muted, not to a palette colour", () => {
		const resolved = resolveInk({
			ink: null,
			channel: "body",
			profileId: "driveagent.nova",
			theme: DRIVE_DARK_INK_THEME,
		});
		expect(resolved.color).toBe(tokenColor(DRIVE_DARK_INK_THEME, "muted"));
	});
});

describe("palette", () => {
	it("keeps violet selectable but out of the default pool", () => {
		expect(DRIVE_INK_PALETTE).toHaveLength(8);
		expect(DRIVE_INK_DEFAULT_INDICES).toHaveLength(7);
		// Violet is still resolvable when a human picks it on purpose.
		const violet = resolveInk({
			ink: { kind: "palette", index: DRIVE_INK_VIOLET_INDEX as 5 },
			channel: "name",
			profileId: "a",
			theme: DRIVE_LIGHT_INK_THEME,
		});
		const hue = srgbToOklch(
			parseCssColor(violet.color)?.rgb ?? { r: 0, g: 0, b: 0 },
		).h;
		expect(hue).toBeCloseTo(
			DRIVE_INK_PALETTE[DRIVE_INK_VIOLET_INDEX]?.h ?? 0,
			0,
		);
	});

	it("renders every palette index as a distinct colour per theme", () => {
		for (const mode of ["light", "dark"] as const) {
			const colors = DRIVE_INK_PALETTE.map(
				(_anchor, index) =>
					resolveInk({
						ink: { kind: "palette", index: index as 0 },
						channel: "name",
						profileId: "a",
						theme: driveInkTheme(mode),
					}).color,
			);
			expect(new Set(colors).size).toBe(DRIVE_INK_PALETTE.length);
		}
	});

	it("resolves the same durable ink to different colours per theme", () => {
		const ink = { kind: "palette", index: 3 } as const;
		const light = resolveInk({
			ink,
			channel: "name",
			profileId: "a",
			theme: DRIVE_LIGHT_INK_THEME,
		});
		const dark = resolveInk({
			ink,
			channel: "name",
			profileId: "a",
			theme: DRIVE_DARK_INK_THEME,
		});
		expect(light.color).not.toBe(dark.color);
	});
});

describe("colour math", () => {
	it("round-trips sRGB through OKLCH", () => {
		for (const hex of ["#0f766e", "#be123c", "#ffffff", "#000000", "#5487c8"]) {
			const rgb = parseCssColor(hex)?.rgb;
			if (!rgb) {
				throw new Error(hex);
			}
			const back = oklchToSrgb(srgbToOklch(rgb));
			expect(back.r).toBeCloseTo(rgb.r, 3);
			expect(back.g).toBeCloseTo(rgb.g, 3);
			expect(back.b).toBeCloseTo(rgb.b, 3);
		}
	});

	it("composites an alpha token over the well before measuring", () => {
		// `--muted-foreground` in the light theme is a 62% black.
		const resolved = resolveInk({
			ink: { kind: "token", token: "muted" },
			channel: "body",
			profileId: "a",
			theme: DRIVE_LIGHT_INK_THEME,
		});
		// A naive parse that ignored alpha would land near black (L ~0.2).
		const l = srgbToOklch(
			parseCssColor(resolved.color)?.rgb ?? { r: 0, g: 0, b: 0 },
		).l;
		expect(l).toBeGreaterThan(0.4);
		expect(l).toBeLessThan(0.7);
	});

	it("agrees with the WCAG reference pair", () => {
		expect(measuredContrast("#ffffff", "#000000")).toBeCloseTo(21, 1);
		expect(measuredContrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
	});
});
