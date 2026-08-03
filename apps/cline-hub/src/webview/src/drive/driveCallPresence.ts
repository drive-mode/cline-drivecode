/**
 * Read-only Drive call presence (DRV-PIP prerequisite).
 *
 * `useDriveSession` is the single Drive writer and it only lives inside Chat,
 * so nothing outside the call route can tell whether a call is live. This fold
 * is the passive projection a route-independent reader needs: it consumes the
 * broadcasts the hub already sends every peer and never issues an op of its
 * own. ADR-0006 ("Same ops … No second writer") is why this file exports a
 * projection and not a controller — `applyRoomSnapshot`/`useDriveSession` stay
 * authoritative for chat chrome, and both readers reconcile to the same hub
 * snapshots, so they converge.
 */

import type { RoomSnapshot } from "@cline/shared";
import type { DriveSessionHostMessage } from "./driveSessionPolicy";
import { isDriveRoomSnapshotForTarget } from "./driveSessionPolicy";
import { isDriveHumanId } from "./participantIds";
import { DRIVE_PARTICIPANT_HUMAN, type DriveUiState } from "./types";

export type DriveCallPresence = {
	/** Local human is seated on a live Drive room. */
	active: boolean;
	roomId: string | null;
	partnerName: string | null;
	/** Local human mic mute, folded from the hub mute map / participantAudio. */
	muted: boolean;
	handRaised: boolean;
	/** Last narration line for this call (handoff or conversation.narration). */
	narration: string | null;
};

/** No live call. Referentially stable so idle folds do not re-render readers. */
export const IDLE_DRIVE_CALL_PRESENCE: DriveCallPresence = {
	active: false,
	roomId: null,
	partnerName: null,
	muted: false,
	handRaised: false,
	narration: null,
};

/** Broadcasts a presence reader folds. Strict subset of the session types. */
export const DRIVE_CALL_PRESENCE_MESSAGE_TYPES = [
	"room_snapshot",
	"drive_event",
	"drive_room_changed",
] as const;

export type PersistedDrivePresenceSeed = Pick<
	DriveUiState,
	"active" | "roomId" | "partnerName" | "muted" | "handRaised"
>;

/**
 * Seed presence from the driveUi state `useDriveSession` already persists.
 * A reload lands here before any broadcast arrives, so the reader can decide
 * whether it is worth asking the hub for the room at all.
 */
export function seedDriveCallPresence(
	drive: Partial<PersistedDrivePresenceSeed> | null | undefined,
): DriveCallPresence {
	if (!drive?.active) {
		return IDLE_DRIVE_CALL_PRESENCE;
	}
	const partnerName = drive.partnerName?.trim();
	return {
		active: true,
		roomId: typeof drive.roomId === "string" ? drive.roomId : null,
		partnerName: partnerName || null,
		muted: drive.muted === true,
		handRaised: drive.handRaised === true,
		// Narration is per-call chatter, never restored from a previous session.
		narration: null,
	};
}

function isLocalHumanSeated(snapshot: RoomSnapshot): boolean {
	// Local human seat only — same rule as applyRoomSnapshot; guests do not count.
	return snapshot.participants.some(
		(participant) =>
			participant.kind === "human" && isDriveHumanId(participant.id),
	);
}

function readNarration(message: DriveSessionHostMessage): string | null {
	const handoff = message.handoffNarration?.trim();
	if (handoff) {
		return handoff;
	}
	const event = message.event;
	if (event?.type === "conversation.narration") {
		const text = event.text.trim();
		if (text) {
			return text;
		}
	}
	return null;
}

function samePresence(a: DriveCallPresence, b: DriveCallPresence): boolean {
	return (
		a.active === b.active &&
		a.roomId === b.roomId &&
		a.partnerName === b.partnerName &&
		a.muted === b.muted &&
		a.handRaised === b.handRaised &&
		a.narration === b.narration
	);
}

function foldSnapshot(
	current: DriveCallPresence,
	message: DriveSessionHostMessage,
	snapshot: RoomSnapshot,
): DriveCallPresence {
	// Envelope and snapshot must name the same room, the same consistency check
	// useDriveSession makes before letting a broadcast mutate anything.
	if (
		!isDriveRoomSnapshotForTarget({
			expectedRoomId: snapshot.roomId,
			outerRoomId: message.roomId,
			snapshotRoomId: snapshot.roomId,
		})
	) {
		return current;
	}

	const seated = snapshot.driveActive && isLocalHumanSeated(snapshot);
	const sameRoom =
		current.roomId === null || current.roomId === snapshot.roomId;
	// Another room's traffic only concerns this reader when it seats the local
	// human there — otherwise it says nothing about the call we are tracking.
	if (!sameRoom && !seated) {
		return current;
	}
	if (!seated) {
		return current.active ? IDLE_DRIVE_CALL_PRESENCE : current;
	}

	// A different room replaces presence outright; carrying mute or narration
	// across rooms would report the previous call's state.
	const base = sameRoom ? current : IDLE_DRIVE_CALL_PRESENCE;
	const human = snapshot.participants.find(
		(participant) =>
			participant.kind === "human" && isDriveHumanId(participant.id),
	);
	const agent = snapshot.participants.find(
		(participant) => participant.kind === "agent",
	);
	const humanId = human?.id ?? DRIVE_PARTICIPANT_HUMAN;
	const muted = snapshot.muteByParticipantId[humanId];
	const handRaised = snapshot.raisedHandByParticipantId[humanId];

	const next: DriveCallPresence = {
		active: true,
		roomId: snapshot.roomId,
		partnerName: agent?.displayName ?? base.partnerName,
		muted: typeof muted === "boolean" ? muted : base.muted,
		handRaised: typeof handRaised === "boolean" ? handRaised : base.handRaised,
		narration: readNarration(message) ?? base.narration,
	};
	return samePresence(current, next) ? current : next;
}

function foldRoomChanged(
	current: DriveCallPresence,
	room: DriveSessionHostMessage["room"],
): DriveCallPresence {
	// `drive_room_changed` is a partial live-room patch with no seat or room id
	// of its own, so it can refine a known call but never start or end one.
	if (!current.active) {
		return current;
	}
	const humanFlags = room?.participantAudio?.find((flags) =>
		isDriveHumanId(flags.participantId),
	);
	if (!humanFlags || humanFlags.muted === current.muted) {
		return current;
	}
	return { ...current, muted: humanFlags.muted };
}

/**
 * Fold one hub broadcast onto read-only call presence.
 * Pure: same messages from the same presence always give the same result, and
 * an unrelated or unchanged message returns `current` by reference.
 */
export function foldDriveCallPresence(
	current: DriveCallPresence,
	message: DriveSessionHostMessage,
): DriveCallPresence {
	if (message.type === "drive_room_changed") {
		return foldRoomChanged(current, message.room);
	}
	if (message.type !== "room_snapshot" && message.type !== "drive_event") {
		return current;
	}
	if (!message.snapshot) {
		return current;
	}
	return foldSnapshot(current, message, message.snapshot);
}
