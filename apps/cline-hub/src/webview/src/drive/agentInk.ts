/**
 * Per-agent ink lookup for Drive chrome (DRV-AGENT-PROFILE).
 *
 * The colour maths lives in `@cline/drive`'s pure `facets/resolve.ts`. This file
 * only maps a seated participant to its durable profile id, reads that agent's
 * stored ink, and asks the resolver — so a component never picks a colour of its
 * own and the clamp cannot be bypassed by a call site.
 */

import {
	DRIVE_SCREEN_INK_THEME,
	type DriveInkChannel,
	type DriveInkTheme,
	driveInkTheme,
	resolveInk,
} from "@cline/drive";
import { agentProfileId, type InkRef, type Participant } from "@cline/shared";
import { useEffect, useState } from "react";
import type { DriveUiState } from "./types";

export { DRIVE_SCREEN_INK_THEME };

/**
 * Durable key an agent's appearance is stored under.
 *
 * `participant.ref` is authoritative when the seat recorded one. Pre-snapshot
 * and legacy seats have no ref, so the participant id stands in — still stable
 * per agent, which is all the default hash needs.
 */
export function driveParticipantProfileId(participant: Participant): string {
	return participant.kind === "agent" && participant.ref
		? agentProfileId(participant.ref)
		: participant.id;
}

/** Stored ink for one agent, or null when it has never been set. */
export function driveParticipantInk(
	drive: DriveUiState,
	participant: Participant,
	channel: DriveInkChannel = "name",
): InkRef | null {
	const stored = drive.agentInks[driveParticipantProfileId(participant)];
	if (!stored) {
		return null;
	}
	return channel === "body"
		? (stored.bodyInk ?? null)
		: (stored.nameInk ?? null);
}

/**
 * Resolved CSS colour for a participant's name.
 *
 * Humans keep the room's chrome colours — only agents carry an identity ink —
 * so this returns undefined for them and the caller leaves its class alone.
 */
export function resolveParticipantNameInk(input: {
	drive: DriveUiState;
	participant: Participant;
	theme: DriveInkTheme;
}): string | undefined {
	const { drive, participant, theme } = input;
	if (participant.kind !== "agent") {
		return undefined;
	}
	return resolveInk({
		ink: driveParticipantInk(drive, participant, "name"),
		channel: "name",
		profileId: driveParticipantProfileId(participant),
		theme,
	}).color;
}

/**
 * Resolved CSS colour for one channel, with no participant involved.
 *
 * The profile page styles an agent that may not be seated anywhere, so it has
 * a profile id and an ink but no `Participant`. Everything still goes through
 * the one resolver, so the clamp cannot be bypassed by that call site either.
 */
export function resolveChannelInk(input: {
	ink: InkRef | null;
	channel: DriveInkChannel;
	profileId: string;
	theme: DriveInkTheme;
}): string {
	return resolveInk(input).color;
}

/**
 * Resolved CSS colour for a participant's message body.
 *
 * Independent of the name channel by design — the resolver is asked for `body`
 * with the body ink, so an agent can carry a loud name and quiet prose, or the
 * reverse. Humans are left alone, exactly as with names.
 */
export function resolveParticipantBodyInk(input: {
	drive: DriveUiState;
	participant: Participant;
	theme: DriveInkTheme;
}): string | undefined {
	const { drive, participant, theme } = input;
	if (participant.kind !== "agent") {
		return undefined;
	}
	return resolveInk({
		ink: driveParticipantInk(drive, participant, "body"),
		channel: "body",
		profileId: driveParticipantProfileId(participant),
		theme,
	}).color;
}

export type SpeakerInk = { name?: string; body?: string };

/**
 * Both channels for every seated participant, keyed by participant id.
 *
 * Built once per render rather than resolved inside the message loop: the feed
 * can hold hundreds of messages and each resolve walks a contrast search. Keyed
 * by participant id because that is what `speakerId` carries — the durable
 * profile id is an implementation detail of where the ink was stored.
 */
export function buildSpeakerInkMap(
	drive: DriveUiState,
	participants: readonly Participant[],
	theme: DriveInkTheme,
): Record<string, SpeakerInk> {
	const inks: Record<string, SpeakerInk> = {};
	for (const participant of participants) {
		if (participant.kind !== "agent") {
			continue;
		}
		inks[participant.id] = {
			name: resolveParticipantNameInk({ drive, participant, theme }),
			body: resolveParticipantBodyInk({ drive, participant, theme }),
		};
	}
	return inks;
}

/**
 * Ink for the agent holding the spotlight.
 *
 * Reads the same roster projection the byline does, so the shared screen's chip
 * and the roster row cannot drift apart — resolving a guessed profile id here
 * would tint the chip differently from the name it belongs to.
 *
 * `spotlightParticipantId` is the sharer, not "the first agent seated": once a
 * second agent joins, those stop being the same participant, and the chip would
 * otherwise carry one agent's colour under another agent's name.
 */
export function resolveSpotlightSharerInk(
	drive: DriveUiState,
	theme: DriveInkTheme,
	participants: readonly Participant[],
): string | undefined {
	const sharer = resolveSpotlightSharer(drive, participants);
	if (!sharer) {
		return undefined;
	}
	return resolveParticipantNameInk({ drive, participant: sharer, theme });
}

/**
 * The agent whose identity the shared screen is presenting under.
 *
 * Shared by the chip's ink and the idle avatar so the two cannot disagree — a
 * screen showing one agent's colour under another agent's mark is worse than
 * showing neither.
 */
export function resolveSpotlightSharer(
	drive: DriveUiState,
	participants: readonly Participant[],
): Participant | undefined {
	const agents = participants.filter(
		(participant) => participant.kind === "agent",
	);
	return (
		agents.find(
			(participant) => participant.id === drive.spotlightParticipantId,
		) ??
		agents.find((participant) => participant.role === "partner") ??
		agents[0]
	);
}

function readThemeMode(): "light" | "dark" {
	if (typeof document === "undefined") {
		return "light";
	}
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * The active host theme, as the resolver's input.
 *
 * `applyHubTheme` toggles `.dark` on the root element, so the class is the
 * signal — watched rather than read once, because a mid-call theme flip has to
 * re-resolve every seated agent or half the roster ends up unreadable.
 */
export function useDriveInkTheme(): DriveInkTheme {
	const [mode, setMode] = useState<"light" | "dark">(readThemeMode);

	useEffect(() => {
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
