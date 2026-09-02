/**
 * Per-agent ink for the desktop Drive surfaces (DRV-AGENT-PROFILE).
 *
 * Ports the hub's `drive/agentInk.ts` usage onto the desktop: the colour maths
 * stays in `@cline/drive`'s pure `facets/resolve.ts`, and this module only
 * maps a seated participant to its durable profile id, finds that agent's
 * stored ink (from the hub's appearance profiles), and asks the resolver. No
 * component ever picks a colour of its own, so the contrast clamp cannot be
 * bypassed by a call site.
 *
 * Palette inks additionally map onto the `--drive-ink-N` tokens defined in
 * `components/views/drive/drive.css` (the desktop copy of the hub ramp), so
 * themed chrome can paint with a token the theme switch re-resolves for free.
 * The fixed-dark Spotlight screen uses the resolver output directly against
 * its own well (`DRIVE_SCREEN_INK_THEME`).
 *
 * Nothing here is a prompt, tool allowlist, key, endpoint or model id.
 */

import {
	DRIVE_SCREEN_INK_THEME,
	type DriveInkChannel,
	type DriveInkTheme,
	defaultInkRef,
	driveInkTheme,
	resolveInk,
} from "@cline/drive";
import {
	agentProfileId,
	type DriveInkToken,
	type InkRef,
	InkRefSchema,
	type Participant,
} from "@cline/shared";
import { useEffect, useState } from "react";
import type { DriveHubEvent } from "./drive-client";
import type { DriveDataSource } from "./drive-source";

export { DRIVE_SCREEN_INK_THEME };

/** Stored appearance inks keyed by durable profile id. */
export type DriveInkMap = Record<
	string,
	{ nameInk?: InkRef; bodyInk?: InkRef }
>;

export const EMPTY_DRIVE_INK_MAP: DriveInkMap = {};

/**
 * Durable key an agent's appearance is stored under.
 *
 * `participant.ref` is authoritative when the seat recorded one. Pre-snapshot
 * and legacy seats have no ref, so the participant id stands in — still
 * stable per agent, which is all the default hash needs.
 */
export function driveParticipantProfileId(participant: Participant): string {
	return participant.kind === "agent" && participant.ref
		? agentProfileId(participant.ref)
		: participant.id;
}

/** Stored ink for one agent, or null when it has never been set. */
export function participantInkRef(
	participant: Participant,
	inks: DriveInkMap | undefined,
	channel: DriveInkChannel = "name",
): InkRef | null {
	const stored = inks?.[driveParticipantProfileId(participant)];
	if (!stored) {
		return null;
	}
	return channel === "body"
		? (stored.bodyInk ?? null)
		: (stored.nameInk ?? null);
}

/** The desktop theme token a durable token ref paints with. */
const TOKEN_CSS: Record<DriveInkToken, string> = {
	foreground: "var(--foreground)",
	muted: "var(--muted-foreground)",
	success: "var(--success-text)",
	warning: "var(--warning-text)",
	info: "var(--info-text)",
};

/** CSS custom property name for one palette entry (`--drive-ink-3`). */
export function driveInkCssVariable(index: number): string {
	return `--drive-ink-${index}`;
}

/**
 * Theme-aware CSS value for a durable ink: palette entries use the ramp
 * token (the theme switch re-resolves it), token refs use the matching
 * desktop token. The resolver colour rides along as the `var()` fallback so
 * an environment without the stylesheet still paints the clamped colour.
 */
export function inkCssValue(ref: InkRef, resolvedColor: string): string {
	switch (ref.kind) {
		case "palette":
			return `var(${driveInkCssVariable(ref.index)}, ${resolvedColor})`;
		case "token":
			return TOKEN_CSS[ref.token];
		default: {
			const _exhaustive: never = ref;
			return _exhaustive;
		}
	}
}

export type ParticipantInk = {
	/** Durable ref the colour came from — stored, or the default hash. */
	ref: InkRef;
	/** Resolver output for the given theme; paint this on that theme's well. */
	color: string;
	/** Theme-aware CSS value for themed chrome (roster, feed, byline). */
	css: string;
	paletteIndex: number | null;
	/** Lightness had to move to clear the contrast ratio. */
	clamped: boolean;
};

/**
 * Resolved ink for a participant's name (or body) channel.
 *
 * Humans keep the room's chrome colours — only agents carry an identity ink —
 * so this returns null for them and the caller leaves its class alone.
 */
export function resolveParticipantInk(input: {
	participant: Participant;
	inks?: DriveInkMap;
	theme: DriveInkTheme;
	channel?: DriveInkChannel;
}): ParticipantInk | null {
	const { participant, inks, theme } = input;
	const channel = input.channel ?? "name";
	if (participant.kind !== "agent") {
		return null;
	}
	const profileId = driveParticipantProfileId(participant);
	const stored = participantInkRef(participant, inks, channel);
	const resolved = resolveInk({ ink: stored, channel, profileId, theme });
	// When the clamp could not reach the ratio the resolver painted a token;
	// report that token so the CSS value agrees with the colour.
	const ref: InkRef = resolved.fallbackToken
		? { kind: "token", token: resolved.fallbackToken }
		: (stored ?? defaultInkRef(channel, profileId));
	return {
		ref,
		color: resolved.color,
		css: inkCssValue(ref, resolved.color),
		paletteIndex: ref.kind === "palette" ? ref.index : null,
		clamped: resolved.clamped,
	};
}

/**
 * Name ink for every seated agent, keyed by participant id — built once per
 * render rather than inside a list loop, since each resolve walks a contrast
 * search. Keyed by participant id because that is what feed entries carry.
 */
export function buildParticipantInkMap(
	participants: readonly Participant[],
	inks: DriveInkMap | undefined,
	theme: DriveInkTheme,
): Record<string, ParticipantInk> {
	const map: Record<string, ParticipantInk> = {};
	for (const participant of participants) {
		const ink = resolveParticipantInk({ participant, inks, theme });
		if (ink) {
			map[participant.id] = ink;
		}
	}
	return map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readInk(value: unknown): InkRef | undefined {
	const parsed = InkRefSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

/**
 * Tolerant projection of a `drive_agent_profiles` / `drive_config` reply
 * into an ink map. Accepts `{ profiles: [...] }`, `{ profile }`, or a bare
 * array; anything unreadable is skipped rather than thrown — a missing
 * appearance store just means default inks.
 */
export function readAgentInkMap(reply: unknown): DriveInkMap {
	const entries: unknown[] = Array.isArray(reply)
		? reply
		: isRecord(reply)
			? Array.isArray(reply.profiles)
				? reply.profiles
				: isRecord(reply.profile)
					? [reply.profile]
					: []
			: [];
	const map: DriveInkMap = {};
	for (const entry of entries) {
		if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) {
			continue;
		}
		const nameInk = readInk(entry.nameInk);
		const bodyInk = readInk(entry.bodyInk);
		if (!nameInk && !bodyInk) {
			continue;
		}
		map[entry.id] = {
			...(nameInk ? { nameInk } : {}),
			...(bodyInk ? { bodyInk } : {}),
		};
	}
	return map;
}

function readThemeMode(): "light" | "dark" {
	if (typeof document === "undefined") {
		return "dark";
	}
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The active host theme, as the resolver's input. `lib/theme.ts` toggles
 * `.dark` on the root element, so the class is the signal — watched rather
 * than read once, because a mid-call theme flip has to re-resolve every
 * seated agent or half the roster ends up unreadable.
 */
export function useDriveInkTheme(): DriveInkTheme {
	const [mode, setMode] = useState<"light" | "dark">(readThemeMode);

	useEffect(() => {
		setMode(readThemeMode());
		const observer = new MutationObserver(() => {
			setMode(readThemeMode());
		});
		observer.observe(document.documentElement, {
			attributeFilter: ["class"],
			attributes: true,
		});
		return () => observer.disconnect();
	}, []);

	return driveInkTheme(mode);
}

const INK_REFRESH_DEBOUNCE_MS = 300;

function isProfileChange(event: DriveHubEvent): boolean {
	return (
		event.event === "drive.profile.changed" ||
		event.event === "drive.config.changed"
	);
}

/**
 * Stored appearance inks from the hub (or the demo world), refreshed when a
 * profile changes. Errors resolve to an empty map: a hub without an
 * appearance store is a room full of default-hashed inks, not a broken call.
 */
export function useAgentInks(source: DriveDataSource): DriveInkMap {
	const [inks, setInks] = useState<DriveInkMap>(EMPTY_DRIVE_INK_MAP);

	useEffect(() => {
		let disposed = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const load = async () => {
			try {
				const reply = await source.agentProfiles<unknown>("get");
				if (!disposed) {
					setInks(readAgentInkMap(reply));
				}
			} catch {
				if (!disposed) {
					setInks(EMPTY_DRIVE_INK_MAP);
				}
			}
		};
		void load();
		const unsubscribe = source.subscribe((event) => {
			if (!isProfileChange(event)) {
				return;
			}
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				timer = null;
				void load();
			}, INK_REFRESH_DEBOUNCE_MS);
		});
		return () => {
			disposed = true;
			unsubscribe();
			if (timer) {
				clearTimeout(timer);
			}
		};
	}, [source]);

	return inks;
}
