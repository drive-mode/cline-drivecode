/**
 * Agent appearance (DRV-AGENT-PROFILE) for the desktop Agents surface.
 *
 * Every colour a component paints for an agent goes through
 * `@cline/drive`'s `resolveInk` — the palette, the default hash, the 4.5:1
 * clamp and the token fallback all live there. This module only decides
 * which durable key to resolve against, which ink a picker choice maps to,
 * and what a whole-profile write looks like when the person touched one
 * channel. Nothing here is a prompt, tool, provider, key or model id: the
 * durable `AgentProfile` schema is appearance-only by construction.
 */

import {
	DRIVE_INK_PALETTE,
	DRIVE_INK_VIOLET_INDEX,
	DRIVE_SCREEN_INK_THEME,
	type DriveInkChannel,
	type DriveInkTheme,
	defaultInkRef,
	type ResolvedInk,
	resolveInk,
} from "@cline/drive";
import {
	type AgentProfile,
	type AgentRef,
	agentProfileId,
	type InkRef,
	type Participant,
} from "@cline/shared";

// Shared with the Call surface: one profile key and one theme watcher.
export { driveParticipantProfileId, useDriveInkTheme } from "./agent-ink";

export { DRIVE_SCREEN_INK_THEME };

/** Local (possibly unsaved) ink for one agent; either channel may be unset. */
export type DriveAgentInk = {
	nameInk?: InkRef;
	bodyInk?: InkRef;
};

export type DriveAgentProfileDraft = Omit<AgentProfile, "id">;

/** Palette index a picker may choose. Mirrors `DRIVE_INK_PALETTE`. */
export type DriveInkPaletteIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DRIVE_INK_PALETTE_INDICES: readonly DriveInkPaletteIndex[] = [
	0, 1, 2, 3, 4, 5, 6, 7,
];

/** Human names for the eight durable palette entries, in resolver order. */
export const DRIVE_INK_PALETTE_LABELS: readonly string[] = [
	"Teal",
	"Blue",
	"Amber",
	"Rose",
	"Emerald",
	"Violet",
	"Cyan",
	"Ochre",
];

export function inkPaletteLabel(index: number): string {
	return DRIVE_INK_PALETTE_LABELS[index] ?? `Palette ${index}`;
}

/**
 * The durable target an agent's appearance can be saved under, or null.
 *
 * Null for a legacy seat: `agent.appearance` is keyed by `agentProfileId(ref)`
 * and the inverse parse is strict, so a participant with no `ref` has no
 * durable identity to write against. Its colour still resolves through the
 * stable hash; it just cannot be pinned.
 */
export function durableAppearanceTarget(
	participant: Participant,
): { ref: AgentRef; profileId: string } | null {
	if (participant.kind !== "agent" || !participant.ref) {
		return null;
	}
	return { ref: participant.ref, profileId: agentProfileId(participant.ref) };
}

/** Palette index of an ink, or null when it is a token or unset. */
export function inkPaletteIndex(
	ink: InkRef | null | undefined,
): DriveInkPaletteIndex | null {
	return ink?.kind === "palette" ? ink.index : null;
}

/**
 * The ink a picker value maps to.
 *
 * `""` (or anything unparseable) clears back to the channel default rather
 * than writing index 0 — those are different states, and conflating them
 * would make "Default" unreachable once anything had been chosen.
 */
export function inkFromPaletteChoice(raw: string): InkRef | null {
	if (raw === "") {
		return null;
	}
	const index = Number.parseInt(raw, 10);
	if (!Number.isInteger(index) || index < 0 || index > 7) {
		return null;
	}
	return { kind: "palette", index: index as DriveInkPaletteIndex };
}

/**
 * Fill a whole durable profile from whatever the two channels currently hold.
 *
 * The durable schema requires both inks, while the editor lets a person set
 * one and leave the other alone. The gap is filled with the resolver's own
 * default for the untouched channel — the value that channel was already
 * painting — so saving a name colour cannot silently restyle the body.
 */
export function buildAgentProfileDraft(input: {
	ref: AgentRef;
	profileId: string;
	displayName?: string;
	ink?: DriveAgentInk;
}): DriveAgentProfileDraft {
	const { ref, profileId, displayName, ink } = input;
	const trimmedName = displayName?.trim();
	return {
		ref,
		...(trimmedName ? { displayName: trimmedName } : {}),
		nameInk: ink?.nameInk ?? defaultInkRef("name", profileId),
		bodyInk: ink?.bodyInk ?? defaultInkRef("body", profileId),
	};
}

/** The ink a stored profile carries, in editor shape. */
export function inkFromProfile(
	profile: Pick<AgentProfile, "nameInk" | "bodyInk"> | null | undefined,
): DriveAgentInk {
	if (!profile) {
		return {};
	}
	return { nameInk: profile.nameInk, bodyInk: profile.bodyInk };
}

/**
 * Resolved CSS colour for one channel of one agent. The only way feature
 * code should ever turn an ink into a colour.
 */
export function resolveAgentInk(input: {
	ink: InkRef | null | undefined;
	channel: DriveInkChannel;
	profileId: string;
	theme: DriveInkTheme;
}): ResolvedInk {
	return resolveInk({
		ink: input.ink ?? null,
		channel: input.channel,
		profileId: input.profileId,
		theme: input.theme,
	});
}

export function agentInkColor(input: {
	ink: InkRef | null | undefined;
	channel: DriveInkChannel;
	profileId: string;
	theme: DriveInkTheme;
}): string {
	return resolveAgentInk(input).color;
}

export type DriveInkSwatch = {
	index: DriveInkPaletteIndex;
	label: string;
	color: string;
	contrast: number;
	clamped: boolean;
	/** Cline's accent violet: selectable, never a default. */
	isAccent: boolean;
};

/**
 * Every palette entry resolved for one channel on one theme — what a picker
 * paints its swatches with, so a swatch and the text it will produce cannot
 * disagree.
 */
export function paletteSwatches(input: {
	channel: DriveInkChannel;
	profileId: string;
	theme: DriveInkTheme;
}): DriveInkSwatch[] {
	return DRIVE_INK_PALETTE_INDICES.map((index) => {
		const resolved = resolveInk({
			ink: { kind: "palette", index },
			channel: input.channel,
			profileId: input.profileId,
			theme: input.theme,
		});
		return {
			index,
			label: inkPaletteLabel(index),
			color: resolved.color,
			contrast: resolved.contrast,
			clamped: resolved.clamped,
			isAccent: index === DRIVE_INK_VIOLET_INDEX,
		};
	});
}

/** Guard against the palette and its labels drifting apart. */
export const DRIVE_INK_PALETTE_SIZE = DRIVE_INK_PALETTE.length;

/** One readable line about how an ink resolved — shown next to a preview. */
export function describeResolvedInk(resolved: ResolvedInk): string {
	const ratio = `${resolved.contrast.toFixed(1)}:1`;
	if (resolved.fallbackToken) {
		return `Fell back to the ${resolved.fallbackToken} token at ${ratio} — this hue cannot reach 4.5:1 here.`;
	}
	if (resolved.clamped) {
		return `Lightness adjusted to reach ${ratio}.`;
	}
	return `${ratio} contrast, as chosen.`;
}

/** First grapheme of a display name, upper-cased, for an initial avatar. */
export function agentInitial(displayName: string): string {
	const trimmed = displayName.trim();
	if (!trimmed) {
		return "?";
	}
	return [...trimmed][0]?.toUpperCase() ?? "?";
}

/** Title-case a slug or id (`pair_partner` → `Pair Partner`). */
export function titleCaseSlug(raw: string): string {
	return raw
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
		.join(" ");
}

export function fallbackDisplayName(ref: AgentRef): string {
	return titleCaseSlug(ref.kind === "driveagent" ? ref.slug : ref.id);
}

/** Where an agent's identity is defined, for a mono caption. */
export function agentRefLabel(ref: AgentRef | null): string {
	if (!ref) {
		return "legacy seat · no ref";
	}
	switch (ref.kind) {
		case "driveagent":
			return `.driveagent/${ref.slug}/`;
		case "builtin":
			return `builtin · ${ref.id}`;
		case "configured":
			return `configured · ${ref.id}`;
		default: {
			const _exhaustive: never = ref;
			return _exhaustive;
		}
	}
}
