import type { ChatForkRecord, DriveEvent, RoomSnapshot } from "@cline/shared";
import {
	type HostMessage,
	isOptionalString,
	isRecord,
} from "../lib/host-message-gateway";
import { isDriveRoomNotFoundError } from "./driveRoomPreview";
import {
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";

export type DriveJoinPayload = {
	type: "call_join";
	roomId: string;
	human: { id: string; displayName: string };
	agent: { id: string; displayName: string };
	activateDrive: boolean;
	sessionId?: string;
	workspaceRoot?: string;
};

/**
 * Builds the call_join payload, or null when it must be deferred.
 *
 * `workspaceRoot` and "workspace root not resolved yet" are both the empty
 * string from the caller's point of view, so `workspaceRootReady` carries
 * that distinction explicitly. Sending call_join before it is true risks
 * shipping a payload with no workspaceRoot purely because the host's
 * `defaults` reply had not landed yet — not because there truly is none —
 * which leaves the room the hub creates without a durable log.
 */
export function buildDriveJoinPayload(input: {
	roomId: string;
	partnerName: string;
	sessionId?: string | null;
	workspaceRoot?: string;
	workspaceRootReady: boolean;
}): DriveJoinPayload | null {
	if (!input.workspaceRootReady) {
		return null;
	}
	const payload: DriveJoinPayload = {
		type: "call_join",
		roomId: input.roomId,
		human: {
			id: DRIVE_PARTICIPANT_HUMAN,
			displayName: "You",
		},
		agent: {
			id: DRIVE_PARTICIPANT_PARTNER,
			displayName: input.partnerName,
		},
		activateDrive: true,
	};
	const normalizedSessionId = input.sessionId?.trim();
	if (normalizedSessionId) {
		payload.sessionId = normalizedSessionId;
	}
	const workspaceRoot = input.workspaceRoot?.trim();
	if (workspaceRoot) {
		payload.workspaceRoot = workspaceRoot;
	}
	return payload;
}

export type DriveConnectionPhase = "off" | "joining" | "on" | "error";

export type DriveCallErrorResolution =
	| {
			kind: "reset";
			note: string;
			phase: Extract<DriveConnectionPhase, "off" | "error">;
	  }
	| {
			kind: "refresh";
			note: string;
	  }
	| {
			kind: "notice";
			note: string;
	  };

export function resolveDriveCallError({
	code,
	command,
	text,
	wasJoining,
}: {
	code?: string;
	command?: string;
	text?: string;
	wasJoining: boolean;
}): DriveCallErrorResolution {
	const detail = text?.trim();
	if (isDriveRoomNotFoundError({ code, text })) {
		const joinFailed =
			wasJoining && (command === undefined || command === "call_join");
		if (command === "call_join" && !joinFailed) {
			return {
				kind: "notice",
				note: detail
					? `Could not attach this Chat session to Drive: ${detail}`
					: "Could not attach this Chat session to Drive.",
			};
		}
		return {
			kind: "reset",
			note: joinFailed
				? detail
					? `Could not join Drive: ${detail}`
					: "Could not join Drive."
				: "Room ended. Join again.",
			phase: joinFailed ? "error" : "off",
		};
	}
	if (wasJoining && (command === undefined || command === "call_join")) {
		return {
			kind: "reset",
			note: detail
				? `Could not join Drive: ${detail}`
				: "Could not join Drive.",
			phase: "error",
		};
	}
	if (command === "call_get_room") {
		if (
			code === "hub_disconnected" ||
			code === "version_skew" ||
			/hub is not (connected|running)/i.test(detail ?? "")
		) {
			return {
				kind: "reset",
				note:
					code === "version_skew"
						? detail
							? `Drive schema skew — reconnect blocked: ${detail}`
							: "Drive schema skew — reconnect blocked. Update clients and Join again."
						: detail
							? `Hub is down: ${detail}`
							: "Hub is down. Join again when it is back.",
				phase: "error",
			};
		}
		return {
			kind: "notice",
			note: detail
				? `Could not refresh the Drive call: ${detail}`
				: "Could not refresh the Drive call.",
		};
	}
	if (command === "call_join") {
		return {
			kind: "notice",
			note: detail
				? `Could not attach this Chat session to Drive: ${detail}`
				: "Could not attach this Chat session to Drive.",
		};
	}
	return {
		kind: "refresh",
		note:
			command === "call_rename_participant"
				? detail
					? `Could not rename participant: ${detail}`
					: "Could not rename participant."
				: detail || "Drive call command failed.",
	};
}

export function isDriveRoomSnapshotForTarget({
	expectedRoomId,
	outerRoomId,
	snapshotRoomId,
}: {
	expectedRoomId: string;
	outerRoomId?: string;
	snapshotRoomId: string;
}): boolean {
	return (
		snapshotRoomId === expectedRoomId &&
		(outerRoomId === undefined || outerRoomId === expectedRoomId)
	);
}

export const DRIVE_SESSION_MESSAGE_TYPES = [
	"drive_show_presented",
	"drive_script_beat",
	"call_error",
	"drive_fork_audit",
	"room_snapshot",
	"drive_event",
	"drive_room_changed",
] as const;

export type DriveSessionHostMessage = HostMessage & {
	type: (typeof DRIVE_SESSION_MESSAGE_TYPES)[number];
	text?: string;
	code?: string;
	command?: string;
	seq?: number;
	showItemId?: string | null;
	title?: string;
	caption?: string;
	uri?: string;
	say?: string;
	ownerParticipantId?: string;
	roomId?: string;
	callSessionId?: string;
	whileAwayNote?: string;
	handoffNarration?: string;
	snapshot?: RoomSnapshot;
	event?: DriveEvent;
	auditHandle?: string;
	messages?: unknown[];
	summaryOnly?: boolean;
	room?: {
		spotlightParticipantId?: string | null;
		participantAudio?: Array<{
			participantId: string;
			muted: boolean;
			deafened: boolean;
		}>;
		director?: {
			activeShowId?: string | null;
			stickyShowIds?: string[];
			showBacklog?: Array<{
				id: string;
				title: string;
				caption: string;
				artifactKind?: string;
				uri?: string;
				ownerParticipantId: string;
				/**
				 * The source the hub materialized `uri` from. The Spotlight
				 * re-renders artifacts from it client-side, so it is a read field
				 * here even though nothing in this hook consumes it.
				 */
				produce?: {
					tool?: string;
					templateId?: string;
					args?: Record<string, unknown>;
				};
			}>;
		};
		chatForks?: ChatForkRecord[];
	};
};

/**
 * Structural check for hub RoomSnapshot payloads covering the fields this
 * hook and applyRoomSnapshot consume — the same shallow-trust idiom as the
 * hub server's asRoomSnapshot. Deeper drive state flows through the shared
 * reducer, which re-validates events via parseDriveEvent.
 */
function isRoomSnapshotPayload(value: unknown): value is RoomSnapshot {
	if (
		!isRecord(value) ||
		typeof value.roomId !== "string" ||
		typeof value.driveActive !== "boolean" ||
		typeof value.subMode !== "string" ||
		!isRecord(value.muteByParticipantId) ||
		!isRecord(value.raisedHandByParticipantId)
	) {
		return false;
	}
	if (
		!Array.isArray(value.participants) ||
		!value.participants.every(
			(participant) =>
				isRecord(participant) &&
				typeof participant.id === "string" &&
				typeof participant.kind === "string" &&
				isOptionalString(participant.displayName),
		)
	) {
		return false;
	}
	const stage = value.stage;
	if (!isRecord(stage) || !Array.isArray(stage.cards)) {
		return false;
	}
	if (
		stage.sharer !== null &&
		stage.sharer !== undefined &&
		(!isRecord(stage.sharer) ||
			typeof stage.sharer.kind !== "string" ||
			typeof stage.sharer.participantId !== "string")
	) {
		return false;
	}
	if (stage.pin !== null && stage.pin !== undefined && !isRecord(stage.pin)) {
		return false;
	}
	return true;
}

function isDriveEventPayload(value: unknown): value is DriveEvent {
	// Shallow: foldIncomingDriveEvent re-validates via parseDriveEvent and
	// falls back to the hub snapshot when the event is malformed.
	return (
		isRecord(value) &&
		typeof value.type === "string" &&
		(value.type !== "conversation.narration" || typeof value.text === "string")
	);
}

function isDriveRoomChangedRoom(
	value: unknown,
): value is NonNullable<DriveSessionHostMessage["room"]> {
	if (!isRecord(value)) {
		return false;
	}
	if (
		value.spotlightParticipantId !== undefined &&
		value.spotlightParticipantId !== null &&
		typeof value.spotlightParticipantId !== "string"
	) {
		return false;
	}
	if (value.participantAudio !== undefined) {
		if (
			!Array.isArray(value.participantAudio) ||
			!value.participantAudio.every(
				(flags) =>
					isRecord(flags) &&
					typeof flags.participantId === "string" &&
					typeof flags.muted === "boolean" &&
					typeof flags.deafened === "boolean",
			)
		) {
			return false;
		}
	}
	if (value.director !== undefined) {
		if (!isRecord(value.director)) {
			return false;
		}
		const activeShowId = value.director.activeShowId;
		if (
			activeShowId !== undefined &&
			activeShowId !== null &&
			typeof activeShowId !== "string"
		) {
			return false;
		}
		const stickyShowIds = value.director.stickyShowIds;
		if (
			stickyShowIds !== undefined &&
			(!Array.isArray(stickyShowIds) ||
				!stickyShowIds.every((id) => typeof id === "string"))
		) {
			return false;
		}
		const backlog = value.director.showBacklog;
		if (
			backlog !== undefined &&
			(!Array.isArray(backlog) ||
				!backlog.every(
					(item) =>
						isRecord(item) &&
						typeof item.id === "string" &&
						typeof item.title === "string" &&
						typeof item.caption === "string" &&
						isOptionalString(item.artifactKind) &&
						isOptionalString(item.uri) &&
						typeof item.ownerParticipantId === "string",
				))
		) {
			return false;
		}
	}
	if (value.chatForks !== undefined) {
		// Fork records are display-only here; deep fields render as React text.
		if (
			!Array.isArray(value.chatForks) ||
			!value.chatForks.every(
				(fork) => isRecord(fork) && typeof fork.id === "string",
			)
		) {
			return false;
		}
	}
	return true;
}

export function isDriveSessionHostMessage(
	message: HostMessage,
): message is DriveSessionHostMessage {
	switch (message.type) {
		case "drive_show_presented":
			return (
				typeof message.showItemId === "string" &&
				isOptionalString(message.title) &&
				isOptionalString(message.caption) &&
				isOptionalString(message.uri) &&
				isOptionalString(message.ownerParticipantId)
			);
		case "drive_script_beat":
			return (
				isOptionalString(message.say) &&
				(message.showItemId === undefined ||
					message.showItemId === null ||
					typeof message.showItemId === "string")
			);
		case "call_error":
			return (
				isOptionalString(message.text) &&
				isOptionalString(message.code) &&
				isOptionalString(message.command)
			);
		case "drive_fork_audit":
			return (
				isOptionalString(message.auditHandle) &&
				(message.messages === undefined || Array.isArray(message.messages)) &&
				(message.summaryOnly === undefined ||
					typeof message.summaryOnly === "boolean")
			);
		case "room_snapshot":
		case "drive_event":
			return (
				isOptionalString(message.roomId) &&
				(message.seq === undefined || typeof message.seq === "number") &&
				isOptionalString(message.callSessionId) &&
				isOptionalString(message.whileAwayNote) &&
				isOptionalString(message.handoffNarration) &&
				(message.snapshot === undefined ||
					isRoomSnapshotPayload(message.snapshot)) &&
				(message.event === undefined || isDriveEventPayload(message.event))
			);
		case "drive_room_changed":
			return message.room === undefined || isDriveRoomChangedRoom(message.room);
		default:
			return false;
	}
}

export function resolveDriveTargetRoomId({
	requestedRoomId,
	currentRoomId,
	expectedRoomId,
}: {
	requestedRoomId?: string | null;
	currentRoomId?: string | null;
	expectedRoomId?: string | null;
}): string {
	for (const candidate of [
		requestedRoomId,
		currentRoomId,
		expectedRoomId,
		DRIVE_DEFAULT_ROOM_ID,
	]) {
		// typeof, not just optional-chaining: these ids reach us from React
		// handlers and persisted storage, where a non-string can slip in.
		const normalized =
			typeof candidate === "string" ? candidate.trim() : undefined;
		if (normalized) {
			return normalized;
		}
	}
	return DRIVE_DEFAULT_ROOM_ID;
}

export function hasPendingDriveJoinRequest({
	pendingRoomJoin,
	pendingAttachedSessionId,
}: {
	pendingRoomJoin: boolean;
	pendingAttachedSessionId: string | null;
}): boolean {
	return pendingRoomJoin || pendingAttachedSessionId !== null;
}

export function shouldReattachDriveSession({
	active,
	confirmedAttachedSessionId,
	connectionPhase,
	driveIntended,
	failedAttachedSessionId,
	pendingAttachedSessionId,
	sessionId,
}: {
	active: boolean;
	confirmedAttachedSessionId: string | null;
	connectionPhase: DriveConnectionPhase;
	driveIntended: boolean;
	failedAttachedSessionId: string | null;
	pendingAttachedSessionId: string | null;
	sessionId?: string | null;
}): boolean {
	const normalizedSessionId = sessionId?.trim();
	return Boolean(
		normalizedSessionId &&
			connectionPhase === "on" &&
			active &&
			driveIntended &&
			confirmedAttachedSessionId !== normalizedSessionId &&
			pendingAttachedSessionId === null &&
			failedAttachedSessionId !== normalizedSessionId,
	);
}
