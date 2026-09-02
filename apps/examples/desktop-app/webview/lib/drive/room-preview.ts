/**
 * Read-only projection of the bound Drive room for the Lobby's preview card.
 *
 * Mirrors the hub webview's `driveRoomPreview.ts`, widened for the desktop:
 * the phase from `useDriveHub()` and the outcome of one explicit
 * `call_get_room` probe decide between "still checking", "the hub said there
 * is no room" and "the hub did not answer". The hub answered → we show
 * exactly what it said; the hub did not answer → we say so, never a stale or
 * invented room. Nothing here writes; the card's actions go through the port.
 */

import { activePresenterGrant } from "@cline/drive";
import type {
	AddressSet,
	DriveSubMode,
	Participant,
	ParticipantStatus,
	RoomSnapshot,
} from "@cline/shared";
import type { DriveCommandErrorInfo } from "./drive-client";
import { DRIVE_DEFAULT_ROOM_ID, isDriveHumanId } from "./drive-ids";
import type { DriveRoomState } from "./room-state";
import type { DrivePhase } from "./use-drive-hub";

/** How long a room lookup may stay unanswered before the card says so. */
export const ROOM_LOOKUP_TIMEOUT_MS = 3_000;

/** Outcome of the Lobby's own `call_get_room` probe. */
export type RoomLookup =
	| { kind: "pending" }
	| { kind: "found" }
	| { kind: "not_found" }
	| { kind: "timed_out" }
	| { kind: "failed"; text: string };

export const ROOM_LOOKUP_PENDING: RoomLookup = { kind: "pending" };
export const ROOM_LOOKUP_FOUND: RoomLookup = { kind: "found" };
export const ROOM_LOOKUP_NOT_FOUND: RoomLookup = { kind: "not_found" };
export const ROOM_LOOKUP_TIMED_OUT: RoomLookup = { kind: "timed_out" };

export type RoomPreviewState =
	| "checking"
	| "unreachable"
	| "empty"
	| "available"
	| "seated";

export type RoomPreviewActionKind = "start" | "join" | "continue" | "retry";

export type RoomPreviewAction = {
	kind: RoomPreviewActionKind;
	label: string;
	/** False while the lookup is still outstanding. */
	enabled: boolean;
};

export type RoomPreviewParticipant = {
	id: string;
	kind: Participant["kind"];
	displayName: string;
	status: ParticipantStatus;
	statusLabel: string;
	/** The seat the local person holds. */
	isYou: boolean;
	sharing: boolean;
	presenting: boolean;
	muted: boolean;
	handRaised: boolean;
};

export type RoomPreviewSharer = {
	participantId: string;
	kind: "human" | "agent";
	displayName: string;
};

export type RoomPreviewPresenter = {
	agentId: string;
	displayName: string;
	expiresAt: string;
	remainingLabel: string;
};

export type RoomPreview = {
	state: RoomPreviewState;
	roomId: string;
	/** "Pairing room" for the hub default, otherwise the room id. */
	title: string;
	badge: string;
	description: string;
	action: RoomPreviewAction;
	/** Why the room could not be checked; only set for `unreachable`. */
	problem: string | null;
	roster: RoomPreviewParticipant[];
	subMode: DriveSubMode | null;
	subModeLabel: string;
	addressLabel: string;
	sharer: RoomPreviewSharer | null;
	presenter: RoomPreviewPresenter | null;
	cardCount: number;
	seq: number;
	callSessionId: string | null;
	lastEventAt: string | null;
	/** True once a snapshot backs the details grid. */
	hasSnapshot: boolean;
};

export const DRIVE_SUB_MODE_LABELS: Record<DriveSubMode, string> = {
	plan: "Plan",
	act: "Agent",
	ask: "Ask",
	debug: "Debug",
};

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
	idle: "Idle",
	working: "Working",
	speaking: "Speaking",
	away: "Away",
};

const STATE_COPY: Record<
	Exclude<RoomPreviewState, "unreachable">,
	{ badge: string; description: string; action: RoomPreviewAction }
> = {
	checking: {
		badge: "Checking",
		description: "Checking the room with Cline Hub.",
		action: { kind: "join", label: "Checking…", enabled: false },
	},
	empty: {
		badge: "Off",
		description:
			"No room is open yet. Start a call to pair with an agent while you watch and steer the work.",
		action: { kind: "start", label: "Start a call", enabled: true },
	},
	available: {
		badge: "Ready",
		description:
			"The room is open. Join the call to pick up the roster, the working mode and the Spotlight.",
		action: { kind: "join", label: "Join call", enabled: true },
	},
	seated: {
		badge: "On the call",
		description:
			"You are on the call. Continue to watch the agent work and steer when it matters.",
		action: { kind: "continue", label: "Continue call", enabled: true },
	},
};

export const ROOM_HUB_UNREACHABLE_MESSAGE =
	"Cline Hub did not answer. The room could not be checked.";

export function driveSubModeLabel(subMode: DriveSubMode | string): string {
	return (
		DRIVE_SUB_MODE_LABELS[subMode as DriveSubMode] ?? (subMode ? subMode : "—")
	);
}

export function roomPreviewTitle(roomId: string): string {
	return roomId === DRIVE_DEFAULT_ROOM_ID ? "Pairing room" : roomId;
}

/** Human-readable address set; names come from the roster when seated. */
export function addressSetLabel(
	addressSet: AddressSet | undefined,
	participants: readonly Participant[] = [],
): string {
	if (!addressSet) {
		return "Everyone";
	}
	switch (addressSet.mode) {
		case "everyone":
			return "Everyone";
		case "agents": {
			const names = addressSet.agentIds.map(
				(agentId) =>
					participants.find((participant) => participant.id === agentId)
						?.displayName ?? agentId,
			);
			return names.join(" + ");
		}
		case "pack":
			return `Pack · ${addressSet.packId}`;
		default: {
			const _exhaustive: never = addressSet;
			return _exhaustive;
		}
	}
}

/** "42s left" / "12m left" / "2h left" / "expired". */
export function formatRemaining(
	expiresAt: string,
	now: string | number = Date.now(),
): string {
	const end = Date.parse(expiresAt);
	const at = typeof now === "number" ? now : Date.parse(now);
	if (!Number.isFinite(end) || !Number.isFinite(at)) {
		return "";
	}
	const remainingMs = end - at;
	if (remainingMs <= 0) {
		return "expired";
	}
	const seconds = Math.round(remainingMs / 1000);
	if (seconds < 60) {
		return `${seconds}s left`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m left`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h left`;
}

/**
 * Classify a failed `call_get_room`. The sidecar keeps the hub's error code
 * first, and legacy hubs put it in the text — both read as "no room".
 */
export function roomLookupFromError(error: DriveCommandErrorInfo): RoomLookup {
	if (
		error.code === "room_not_found" ||
		error.text.startsWith("room_not_found")
	) {
		return ROOM_LOOKUP_NOT_FOUND;
	}
	return { kind: "failed", text: error.text || "Could not check the room." };
}

function projectRoster(
	snapshot: RoomSnapshot,
	humanParticipantId: string | null,
	presenterAgentId: string | null,
	now: string,
): RoomPreviewParticipant[] {
	const sharerId = snapshot.stage.sharer?.participantId ?? null;
	return snapshot.participants.map((participant) => ({
		id: participant.id,
		kind: participant.kind,
		displayName: participant.displayName,
		status: participant.status,
		statusLabel: PARTICIPANT_STATUS_LABELS[participant.status],
		isYou:
			participant.kind === "human" &&
			(participant.id === humanParticipantId ||
				(humanParticipantId === null && isDriveHumanId(participant.id))),
		sharing: participant.id === sharerId,
		presenting:
			participant.kind === "agent" &&
			(participant.id === presenterAgentId ||
				activePresenterGrant(snapshot, now, participant.id) !== undefined),
		muted: snapshot.muteByParticipantId[participant.id] === true,
		handRaised: snapshot.raisedHandByParticipantId[participant.id] === true,
	}));
}

function emptyPreview(
	roomId: string,
	state: RoomPreviewState,
	overrides: Partial<RoomPreview> = {},
): RoomPreview {
	const copy =
		state === "unreachable"
			? {
					badge: "Unavailable",
					description: ROOM_HUB_UNREACHABLE_MESSAGE,
					action: {
						kind: "retry" as const,
						label: "Retry",
						enabled: true,
					},
				}
			: STATE_COPY[state];
	return {
		state,
		roomId,
		title: roomPreviewTitle(roomId),
		badge: copy.badge,
		description: copy.description,
		action: copy.action,
		problem: state === "unreachable" ? ROOM_HUB_UNREACHABLE_MESSAGE : null,
		roster: [],
		subMode: null,
		subModeLabel: "—",
		addressLabel: "—",
		sharer: null,
		presenter: null,
		cardCount: 0,
		seq: 0,
		callSessionId: null,
		lastEventAt: null,
		hasSnapshot: false,
		...overrides,
	};
}

export type ProjectRoomPreviewInput = {
	phase: DrivePhase;
	room: DriveRoomState;
	lookup: RoomLookup;
	/** The room the provider is bound to; used when the fold is still empty. */
	roomId: string;
	humanParticipantId?: string | null;
	/** ISO instant for presenter expiry; defaults to now. */
	now?: string;
};

export function projectRoomPreview({
	phase,
	room,
	lookup,
	roomId,
	humanParticipantId = null,
	now = new Date().toISOString(),
}: ProjectRoomPreviewInput): RoomPreview {
	const boundRoomId = room.roomId ?? roomId;

	if (phase === "unreachable") {
		return emptyPreview(boundRoomId, "unreachable");
	}
	if (phase === "connecting") {
		return lookup.kind === "timed_out"
			? emptyPreview(boundRoomId, "unreachable")
			: emptyPreview(boundRoomId, "checking");
	}

	const snapshot = room.snapshot;
	if (!snapshot) {
		switch (lookup.kind) {
			case "pending":
			case "found":
				return emptyPreview(boundRoomId, "checking");
			case "not_found":
				return emptyPreview(boundRoomId, "empty");
			case "timed_out":
				return emptyPreview(boundRoomId, "unreachable");
			case "failed":
				return emptyPreview(boundRoomId, "unreachable", {
					problem: lookup.text,
					description: lookup.text,
				});
			default: {
				const _exhaustive: never = lookup;
				return _exhaustive;
			}
		}
	}

	const grant = activePresenterGrant(snapshot, now) ?? null;
	const presenterAgentId = grant?.agentId ?? null;
	const roster = projectRoster(
		snapshot,
		humanParticipantId,
		presenterAgentId,
		now,
	);
	const humanSeated = roster.some(
		(participant) => participant.kind === "human" && participant.isYou,
	);
	const state: RoomPreviewState =
		snapshot.driveActive && humanSeated && !room.ended ? "seated" : "available";
	const copy = STATE_COPY[state];

	const sharer = snapshot.stage.sharer;
	const sharerParticipant = sharer
		? snapshot.participants.find(
				(participant) => participant.id === sharer.participantId,
			)
		: undefined;
	const presenterParticipant = grant
		? snapshot.participants.find(
				(participant) => participant.id === grant.agentId,
			)
		: undefined;

	return {
		state,
		roomId: snapshot.roomId,
		title: roomPreviewTitle(snapshot.roomId),
		badge: copy.badge,
		description: copy.description,
		action: copy.action,
		problem: null,
		roster,
		subMode: snapshot.subMode,
		subModeLabel: driveSubModeLabel(snapshot.subMode),
		addressLabel: addressSetLabel(snapshot.addressSet, snapshot.participants),
		sharer: sharer
			? {
					participantId: sharer.participantId,
					kind: sharer.kind,
					displayName: sharerParticipant?.displayName ?? sharer.participantId,
				}
			: null,
		presenter: grant
			? {
					agentId: grant.agentId,
					displayName: presenterParticipant?.displayName ?? grant.agentId,
					expiresAt: grant.expiresAt,
					remainingLabel: formatRemaining(grant.expiresAt, now),
				}
			: null,
		cardCount: snapshot.stage.cards.length,
		seq: room.seq,
		callSessionId: room.callSessionId,
		lastEventAt: room.lastEventAt,
		hasSnapshot: true,
	};
}
