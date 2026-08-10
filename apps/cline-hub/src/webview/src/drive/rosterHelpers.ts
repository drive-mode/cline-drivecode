/** Pure helpers for Drive roster + participant sheet (DRV-ROSTER / DRV-PARTICIPANT-SHEET). */

import type { Participant } from "@cline/shared";
import {
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
	type DriveUiState,
} from "./types";

/**
 * Hub-projected participants, or a synthetic human + pair_partner when the
 * snapshot has not arrived yet (demo / pre-join chrome).
 */
export function resolveRosterParticipants(
	drive: DriveUiState,
): Participant[] {
	const seated =
		drive.participants.length > 0
			? drive.participants
			: [
					{
						id: DRIVE_PARTICIPANT_HUMAN,
						kind: "human" as const,
						displayName: "You",
						role: "host" as const,
						status: "idle" as const,
					},
					{
						id: DRIVE_PARTICIPANT_PARTNER,
						kind: "agent" as const,
						displayName: drive.partnerName,
						role: "partner" as const,
						status: "idle" as const,
						seatSources: [],
					},
				];
	return applySpeakingPresence(seated, drive.speakingParticipantId);
}

/**
 * Overlay local TTS playback onto the roster (DRV-TTS speaking presence).
 *
 * Playback is a client-side fact, so it is layered over the hub projection
 * rather than folded into it — a room snapshot arriving mid-utterance must
 * not wipe the ring.
 */
export function applySpeakingPresence(
	participants: Participant[],
	speakingParticipantId: string | null,
): Participant[] {
	if (!speakingParticipantId) {
		return participants;
	}
	let changed = false;
	const next = participants.map((participant) => {
		if (
			participant.id !== speakingParticipantId ||
			participant.status === "speaking"
		) {
			return participant;
		}
		changed = true;
		return { ...participant, status: "speaking" as const };
	});
	return changed ? next : participants;
}

/**
 * Whose voice narration belongs to. MVP speaks with one agent voice, so this
 * is the seated agent — per-agent `voiceSlot` selection is a later slice.
 */
export function resolveNarratorParticipantId(drive: DriveUiState): string {
	const agent = drive.participants.find(
		(participant) => participant.kind === "agent",
	);
	return agent?.id ?? DRIVE_PARTICIPANT_PARTNER;
}

/**
 * Resolve `.driveagent/<slug>/` for an agent participant.
 * `participant.ref` is authoritative when the seat recorded one.
 * Otherwise fall back to the legacy guess: pack / spawn seat sources may
 * carry a driveagent slug, and the builtin partner maps to the fixture slug.
 */
export function resolveAgentHomeSlug(
	participant: Participant,
): string | null {
	if (participant.kind !== "agent") {
		return null;
	}
	if (participant.ref?.kind === "driveagent") {
		return participant.ref.slug;
	}
	for (const source of participant.seatSources) {
		const candidate =
			source.kind === "pack"
				? source.packId.trim()
				: source.kind === "spawn"
					? source.parentId.trim()
					: "";
		if (candidate && /^[a-z0-9-]+$/.test(candidate)) {
			return candidate;
		}
	}
	// `role` and DRIVE_PARTICIPANT_PARTNER identify the partner in every room
	// created today. The bare "adam" id is a compatibility fallback for rooms
	// persisted before the default partner was renamed to Cline — not a missed
	// rename. Renaming it to "cline" would drop those old rooms without gaining
	// anything, since a current partner is already matched by the two checks
	// above and never reaches this one.
	if (
		participant.role === "partner" ||
		participant.id === DRIVE_PARTICIPANT_PARTNER ||
		participant.id === "adam"
	) {
		return "pair-partner";
	}
	return null;
}

/** Mute badge from Drive chrome flags (MVP: human mic + partner mute). */
export function isRosterParticipantMuted(
	drive: DriveUiState,
	participant: Participant,
): boolean {
	switch (participant.kind) {
		case "human":
			return drive.muted;
		case "agent":
			return drive.partnerMuted;
		default: {
			const _exhaustive: never = participant;
			return _exhaustive;
		}
	}
}

export function isRosterParticipantHandRaised(
	drive: DriveUiState,
	participant: Participant,
): boolean {
	switch (participant.kind) {
		case "human":
			return drive.handRaised;
		case "agent":
			return false;
		default: {
			const _exhaustive: never = participant;
			return _exhaustive;
		}
	}
}

/**
 * Transcript intent: focus that participant's stream and apply address-follows-focus
 * (agent → address them; human/self → everyone / cleared).
 */
export function applyTranscriptFocus(
	state: DriveUiState,
	participantId: string,
): DriveUiState {
	const participant = resolveRosterParticipants(state).find(
		(entry) => entry.id === participantId,
	);
	const addressFollowsFocusParticipantId =
		participant?.kind === "agent" ? participantId : null;
	return {
		...state,
		focusedParticipantId: participantId,
		addressFollowsFocusParticipantId,
	};
}

export function participantStatusLabel(
	status: Participant["status"],
): string {
	switch (status) {
		case "idle":
			return "idle";
		case "working":
			return "thinking";
		case "speaking":
			return "speaking";
		case "away":
			return "away";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}
