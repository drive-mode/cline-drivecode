/**
 * Pure ink resolution (DRV-AGENT-PROFILE).
 *
 * A durable `InkRef` names a colour without writing hex to disk. This module
 * turns one into a concrete OKLCH colour for the active host theme, clamps its
 * lightness until it clears the contrast ratio against the well it will be
 * painted on, and falls back to a theme token when even the clamp cannot get
 * there — `foreground` for names, `muted` for bodies.
 *
 * Everything here is pure. `@cline/drive` may take only type-level dependencies
 * on `@cline/shared` (see `import-boundary.test.ts`), so the theme constants
 * below repeat the values in `apps/cline-hub/src/webview/src/index.css` rather
 * than reading them. `driveInkTheme.css.test.ts` in the hub pins the two copies
 * together, where both are visible.
 */

import type { DriveInkToken, InkRef } from "@cline/shared";

export type { DriveInkToken, InkRef };

/** Gamma-encoded sRGB, each channel 0–1. */
type Rgb = { r: number; g: number; b: number };

export type Oklch = { l: number; c: number; h: number };

/** Hue + chroma anchor for a palette entry; lightness comes from the theme. */
export type InkAnchor = { c: number; h: number };

/**
 * The eight durable palette entries, as OKLCH hue/chroma anchors.
 *
 * Lightness is deliberately absent — it is derived from the active theme and
 * then clamped, so the same durable `{ kind: "palette", index }` reads correctly
 * on a light and a dark well without storing two colours.
 *
 * Mirrored as `--drive-ink-0`…`--drive-ink-7` in the hub stylesheet.
 */
export const DRIVE_INK_PALETTE: readonly InkAnchor[] = [
	{ c: 0.0861, h: 186.39 }, // 0 teal
	{ c: 0.2172, h: 264.38 }, // 1 blue
	{ c: 0.1455, h: 49.0 }, // 2 amber
	{ c: 0.1978, h: 16.93 }, // 3 rose
	{ c: 0.1049, h: 165.61 }, // 4 emerald
	{ c: 0.1073, h: 277.02 }, // 5 desaturated violet — palette-only, never default
	{ c: 0.0936, h: 223.13 }, // 6 cyan
	{ c: 0.1034, h: 61.91 }, // 7 ochre
];

/**
 * Cline's accent violet is product chrome, not an agent identity colour
 * (DRV-AGENT-PROFILE). It stays selectable but is excluded from the default
 * hash so a fresh roster never paints an agent in it.
 */
export const DRIVE_INK_VIOLET_INDEX = 5;

/** Palette indices the default hash may pick from. */
export const DRIVE_INK_DEFAULT_INDICES: readonly number[] =
	DRIVE_INK_PALETTE.map((_, index) => index).filter(
		(index) => index !== DRIVE_INK_VIOLET_INDEX,
	);

/** WCAG AA for normal text. Names and bodies are both body-sized. */
export const DRIVE_INK_MIN_CONTRAST = 4.5;

export type DriveInkChannel = "name" | "body";

export type DriveInkTheme = {
	mode: "light" | "dark";
	/** Background the ink is painted on; contrast is measured against this. */
	well: string;
	/** Seed lightness per channel before the clamp runs. */
	lightness: Record<DriveInkChannel, number>;
	/**
	 * How far the clamp may move lightness before the ink stops reading as the
	 * colour that was chosen. Outside this band an amber and an ochre agent
	 * collapse into the same near-black, so the token fallback is the honest
	 * answer rather than a technically-compliant smudge.
	 */
	lightnessRange: { min: number; max: number };
	/** Host tokens the durable `{ kind: "token" }` refs point at. */
	tokens: Record<DriveInkToken, string>;
};

/** Mirrors `:root` in `apps/cline-hub/src/webview/src/index.css`. */
export const DRIVE_LIGHT_INK_THEME: DriveInkTheme = {
	mode: "light",
	well: "#f8fafb",
	lightness: { name: 0.52, body: 0.5 },
	lightnessRange: { min: 0.22, max: 0.62 },
	tokens: {
		foreground: "#151516",
		muted: "rgb(21 21 22 / 62%)",
		success: "#2bcc28",
		warning: "#b45309",
		info: "#5487c8",
	},
};

/** Mirrors `.dark` in `apps/cline-hub/src/webview/src/index.css`. */
export const DRIVE_DARK_INK_THEME: DriveInkTheme = {
	mode: "dark",
	well: "#0a0a0a",
	lightness: { name: 0.78, body: 0.74 },
	lightnessRange: { min: 0.55, max: 0.95 },
	tokens: {
		foreground: "#ffffff",
		muted: "#9ca3af",
		success: "#4ade80",
		warning: "#fbbf24",
		info: "#5487c8",
	},
};

export function driveInkTheme(mode: "light" | "dark"): DriveInkTheme {
	return mode === "dark" ? DRIVE_DARK_INK_THEME : DRIVE_LIGHT_INK_THEME;
}

/**
 * The shared screen is a fixed-dark surface in both host themes
 * (`ScreenFrame` in `Spotlight.tsx`), so chips painted on it resolve against a
 * dark well even when the host theme is light.
 *
 * `SCREEN_SURFACE` there re-pins `--background` only; the subtree still carries
 * `dark`, so `--foreground` and `--muted-foreground` stay the dark-theme
 * values. Inheriting the tokens rather than restating them is the point.
 */
export const DRIVE_SCREEN_INK_THEME: DriveInkTheme = {
	...DRIVE_DARK_INK_THEME,
	well: "#0e0f13",
};

export type ResolvedInk = {
	/** CSS colour, always `oklch(L C H)`. */
	color: string;
	/** Contrast actually achieved against the well. */
	contrast: number;
	/** True when lightness had to move to clear {@link DRIVE_INK_MIN_CONTRAST}. */
	clamped: boolean;
	/** Set when no lightness cleared the ratio and the token fallback fired. */
	fallbackToken: DriveInkToken | null;
};

/**
 * Stable palette index for an agent that has stored no ink.
 *
 * FNV-1a over the durable profile id, so a fresh roster is legible with no
 * settings visit and the same agent keeps the same colour across reloads,
 * machines, and re-seats. Never random, never shared by construction.
 */
export function defaultNameInkIndex(profileId: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < profileId.length; index += 1) {
		hash ^= profileId.charCodeAt(index);
		// FNV prime, via shifts so the product stays inside 32 bits.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	const pool = DRIVE_INK_DEFAULT_INDICES;
	return pool[hash % pool.length] as number;
}

/** Durable default for an agent with no stored ink, per channel. */
export function defaultInkRef(
	channel: DriveInkChannel,
	profileId: string,
): InkRef {
	return channel === "body"
		? { kind: "token", token: "muted" }
		: { kind: "palette", index: defaultNameInkIndex(profileId) as 0 };
}

/** Token a channel falls back to when the clamp cannot reach the ratio. */
export function inkFallbackToken(channel: DriveInkChannel): DriveInkToken {
	return channel === "body" ? "muted" : "foreground";
}

/**
 * Resolve a durable ink to a concrete colour for one theme and one well.
 *
 * `ink` may be null/undefined — that is the "agent stored nothing" path, and it
 * resolves through {@link defaultInkRef} rather than a shared constant, so two
 * agents with no stored ink still differ.
 */
export function resolveInk(input: {
	ink?: InkRef | null;
	channel: DriveInkChannel;
	/** Durable profile id (`agentProfileId(ref)`), seeds the default hash. */
	profileId: string;
	theme: DriveInkTheme;
	minContrast?: number;
}): ResolvedInk {
	const { channel, profileId, theme } = input;
	const minContrast = input.minContrast ?? DRIVE_INK_MIN_CONTRAST;
	const ink = input.ink ?? defaultInkRef(channel, profileId);
	const well = parseCssColor(theme.well)?.rgb ?? { r: 1, g: 1, b: 1 };

	const seed = inkToOklch(ink, channel, theme, well);
	const clamped = clampForContrast(
		seed,
		well,
		minContrast,
		theme.lightnessRange,
	);
	if (clamped) {
		return {
			color: formatOklch(clamped.oklch),
			contrast: clamped.contrast,
			clamped: clamped.oklch.l !== seed.l,
			fallbackToken: null,
		};
	}

	// No legible lightness on this hue cleared the ratio — take the documented
	// token verbatim. It can still fall short on a mid-tone well; the reported
	// `contrast` is what the editor surfaces rather than a silent pass.
	const token = inkFallbackToken(channel);
	const fallback = tokenToOklch(token, theme, well);
	return {
		color: formatOklch(fallback),
		contrast: contrastRatio(oklchToSrgb(fallback), well),
		clamped: true,
		fallbackToken: token,
	};
}

function inkToOklch(
	ink: InkRef,
	channel: DriveInkChannel,
	theme: DriveInkTheme,
	well: Rgb,
): Oklch {
	if (ink.kind === "token") {
		return tokenToOklch(ink.token, theme, well);
	}
	const anchor =
		DRIVE_INK_PALETTE[ink.index] ?? (DRIVE_INK_PALETTE[0] as InkAnchor);
	return { l: theme.lightness[channel], c: anchor.c, h: anchor.h };
}

function tokenToOklch(
	token: DriveInkToken,
	theme: DriveInkTheme,
	well: Rgb,
): Oklch {
	const parsed = parseCssColor(theme.tokens[token]);
	if (!parsed) {
		return { l: theme.mode === "dark" ? 1 : 0, c: 0, h: 0 };
	}
	// Tokens may carry alpha (`--muted-foreground` is a 62% black); what the eye
	// reads is the composite over the well, so measure and clamp that.
	return srgbToOklch(compositeOver(parsed.rgb, parsed.alpha, well));
}

/**
 * Walk lightness away from the well until the ratio is met, keeping hue and
 * chroma so the ink still reads as the colour that was chosen.
 *
 * Returns null when no lightness inside the theme's band clears the ratio —
 * which is a real outcome on a mid-tone well, not a defensive branch.
 */
function clampForContrast(
	seed: Oklch,
	well: Rgb,
	minContrast: number,
	range: { min: number; max: number },
): { oklch: Oklch; contrast: number } | null {
	// A colour that already clears the ratio is never moved — host tokens sit
	// outside the palette band on purpose and must survive untouched.
	const seedContrast = contrastRatio(oklchToSrgb(seed), well);
	if (seedContrast >= minContrast) {
		return { oklch: seed, contrast: seedContrast };
	}

	// Only now does the band apply: search from the in-band lightness nearest
	// the seed, so a seed above/below the band still gets the whole band tried.
	const start = Math.min(range.max, Math.max(range.min, seed.l));
	const startCandidate: Oklch = { ...seed, l: start };
	const startContrast = contrastRatio(oklchToSrgb(startCandidate), well);
	if (startContrast >= minContrast) {
		return { oklch: startCandidate, contrast: startContrast };
	}

	// Darken on a light well, lighten on a dark one; try the far side second so
	// a mid-tone well still gets its best shot before the token fallback.
	const wellIsLight = relativeLuminance(well) > 0.18;
	const directions = wellIsLight ? [-1, 1] : [1, -1];
	const step = 0.005;
	const steps = Math.ceil((range.max - range.min) / step);

	for (const direction of directions) {
		for (let n = 1; n <= steps; n += 1) {
			const l = start + direction * step * n;
			if (l < range.min || l > range.max) {
				break;
			}
			const candidate: Oklch = { ...seed, l };
			const contrast = contrastRatio(oklchToSrgb(candidate), well);
			if (contrast >= minContrast) {
				return { oklch: candidate, contrast };
			}
		}
	}
	return null;
}

/**
 * The single point where a colour leaves this module, so the gamut clip cannot
 * be forgotten at one call site and applied at another.
 */
export function formatOklch(oklch: Oklch): string {
	const clipped = clipToGamut(oklch);
	const l = round(clipped.l, 4);
	const c = round(clipped.c, 4);
	const h = round(clipped.h, 2);
	return `oklch(${l} ${c} ${h})`;
}

function round(value: number, places: number): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

/* ---------------------------------------------------------------- colour math */

export function parseCssColor(
	input: string,
): { rgb: Rgb; alpha: number } | null {
	const value = input.trim().toLowerCase();
	if (value.startsWith("#")) {
		return parseHex(value);
	}
	if (value.startsWith("rgb")) {
		return parseRgb(value);
	}
	if (value.startsWith("oklch")) {
		return parseOklchColor(value);
	}
	return null;
}

function parseHex(value: string): { rgb: Rgb; alpha: number } | null {
	const hex = value.slice(1);
	const expand = (part: string) => Number.parseInt(part, 16) / 255;
	if (hex.length === 3 || hex.length === 4) {
		const parts = [...hex].map((char) => `${char}${char}`);
		if (parts.some((part) => Number.isNaN(Number.parseInt(part, 16)))) {
			return null;
		}
		return {
			rgb: {
				r: expand(parts[0] as string),
				g: expand(parts[1] as string),
				b: expand(parts[2] as string),
			},
			alpha: parts[3] ? expand(parts[3]) : 1,
		};
	}
	if (hex.length === 6 || hex.length === 8) {
		const parts = (hex.match(/.{2}/g) ?? []) as string[];
		if (parts.some((part) => Number.isNaN(Number.parseInt(part, 16)))) {
			return null;
		}
		return {
			rgb: {
				r: expand(parts[0] as string),
				g: expand(parts[1] as string),
				b: expand(parts[2] as string),
			},
			alpha: parts[3] ? expand(parts[3]) : 1,
		};
	}
	return null;
}

function parseRgb(value: string): { rgb: Rgb; alpha: number } | null {
	const body = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
	const [colorPart, alphaPart] = body.split("/");
	const numbers = (colorPart ?? "")
		.split(/[\s,]+/)
		.filter(Boolean)
		.map((part) => Number.parseFloat(part));
	if (numbers.length < 3 || numbers.some((n) => Number.isNaN(n))) {
		return null;
	}
	return {
		rgb: {
			r: (numbers[0] as number) / 255,
			g: (numbers[1] as number) / 255,
			b: (numbers[2] as number) / 255,
		},
		alpha: parsePercentOrUnit(alphaPart) ?? 1,
	};
}

function parseOklchColor(value: string): { rgb: Rgb; alpha: number } | null {
	const body = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
	const [colorPart, alphaPart] = body.split("/");
	const parts = (colorPart ?? "").split(/[\s,]+/).filter(Boolean);
	if (parts.length < 3) {
		return null;
	}
	const l = parsePercentOrUnit(parts[0]);
	const c = Number.parseFloat(parts[1] as string);
	const h = Number.parseFloat(parts[2] as string);
	if (l === null || Number.isNaN(c) || Number.isNaN(h)) {
		return null;
	}
	return {
		rgb: oklchToSrgb({ l, c, h }),
		alpha: parsePercentOrUnit(alphaPart) ?? 1,
	};
}

function parsePercentOrUnit(input: string | undefined): number | null {
	if (input === undefined) {
		return null;
	}
	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}
	const numeric = Number.parseFloat(trimmed);
	if (Number.isNaN(numeric)) {
		return null;
	}
	return trimmed.endsWith("%") ? numeric / 100 : numeric;
}

export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
	if (alpha >= 1) {
		return fg;
	}
	return {
		r: fg.r * alpha + bg.r * (1 - alpha),
		g: fg.g * alpha + bg.g * (1 - alpha),
		b: fg.b * alpha + bg.b * (1 - alpha),
	};
}

function toLinear(channel: number): number {
	return channel <= 0.04045
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4;
}

function toGamma(channel: number): number {
	return channel <= 0.0031308
		? channel * 12.92
		: 1.055 * channel ** (1 / 2.4) - 0.055;
}

export function relativeLuminance(rgb: Rgb): number {
	return (
		0.2126 * toLinear(rgb.r) +
		0.7152 * toLinear(rgb.g) +
		0.0722 * toLinear(rgb.b)
	);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

export function srgbToOklch(rgb: Rgb): Oklch {
	const r = toLinear(rgb.r);
	const g = toLinear(rgb.g);
	const b = toLinear(rgb.b);

	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	const okL = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const okA = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const okB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	const chroma = Math.sqrt(okA * okA + okB * okB);
	const hue = ((Math.atan2(okB, okA) * 180) / Math.PI + 360) % 360;
	return { l: okL, c: chroma, h: hue };
}

function oklchToLinearSrgb(oklch: Oklch): {
	r: number;
	g: number;
	b: number;
} {
	const hueRad = (oklch.h * Math.PI) / 180;
	const okA = oklch.c * Math.cos(hueRad);
	const okB = oklch.c * Math.sin(hueRad);

	const l_ = oklch.l + 0.3963377774 * okA + 0.2158037573 * okB;
	const m_ = oklch.l - 0.1055613458 * okA - 0.0638541728 * okB;
	const s_ = oklch.l - 0.0894841775 * okA - 1.291485548 * okB;

	const l = l_ * l_ * l_;
	const m = m_ * m_ * m_;
	const s = s_ * s_ * s_;

	return {
		r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	};
}

function inSrgbGamut(candidate: Oklch): boolean {
	const linear = oklchToLinearSrgb(candidate);
	return (
		linear.r >= -1e-4 &&
		linear.r <= 1 + 1e-4 &&
		linear.g >= -1e-4 &&
		linear.g <= 1 + 1e-4 &&
		linear.b >= -1e-4 &&
		linear.b <= 1 + 1e-4
	);
}

/**
 * Reduce chroma until the colour fits sRGB, keeping lightness and hue.
 *
 * Every colour this module *emits* goes through here first. A CSS `oklch()`
 * outside the gamut is gamut-mapped by the browser in a way that moves both
 * lightness and hue, so returning an unclipped value would hand CSS a colour
 * whose contrast was never the one measured — the AA guarantee would be
 * arithmetic about a colour nobody ever sees.
 */
export function clipToGamut(oklch: Oklch): Oklch {
	if (inSrgbGamut(oklch)) {
		return oklch;
	}
	let low = 0;
	let high = oklch.c;
	for (let i = 0; i < 24; i += 1) {
		const mid = (low + high) / 2;
		if (inSrgbGamut({ ...oklch, c: mid })) {
			low = mid;
		} else {
			high = mid;
		}
	}
	return { ...oklch, c: low };
}

/** OKLCH → sRGB, through the same clip the emitted colour goes through. */
export function oklchToSrgb(oklch: Oklch): Rgb {
	const linear = oklchToLinearSrgb(clipToGamut(oklch));
	const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
	return {
		r: clamp01(toGamma(clamp01(linear.r))),
		g: clamp01(toGamma(clamp01(linear.g))),
		b: clamp01(toGamma(clamp01(linear.b))),
	};
}
