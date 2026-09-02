/**
 * The room feed — every typed room event a person on the call would want to
 * read back, in one chronological list.
 *
 * `room-state.ts` keeps the conversation lane (messages, narration, beats)
 * because that is room truth the hub folds. Control events (join / leave /
 * mode / address / stage / title / hand / mute / end), work events and show
 * presentations are *display* history: this module projects them from the
 * same `drive_hub_event` stream into feed items, merges them with the
 * conversation lane, and caps the result. Nothing here is authoritative —
 * the hub still owns the room; this is the transcript of what it said.
 *
 * Pure so it runs under `environment: node`; the subscribing hook lives in
 * `components/views/drive/room-feed.tsx`.
 */

import {
	type AddressSet,
	type DriveEvent,
	type Participant,
	parseDriveEvent,
} from "@cline/shared";
import type { DriveHubEvent } from "./drive-client";
import type { DriveFeedEntry } from "./room-state";

export const ROOM_FEED_LIMIT = 200;

export type RoomFeedKind =
	| "message"
	| "narration"
	| "beat"
	| "system"
	| "join"
	| "leave"
	| "mode"
	| "address"
	| "stage"
	| "title"
	| "hand"
	| "mute"
	| "end"
	| "work"
	| "show";

/** Which filter chip an item answers to. */
export type RoomFeedGroup = "talk" | "room";

export type RoomFeedItem = {
	id: string;
	kind: RoomFeedKind;
	group: RoomFeedGroup;
	/** Who the line is about (byline + ink). Null for room-level lines. */
	participantId: string | null;
	text: string;
	at: string;
	/** Secondary line: a pin label, a command, a choice. */
	detail?: string;
};

export type RoomFeedFilter = "all" | RoomFeedGroup;

export const ROOM_FEED_FILTERS: readonly {
	id: RoomFeedFilter;
	label: string;
}[] = [
	{ id: "all", label: "All" },
	{ id: "talk", label: "Talk" },
	{ id: "room", label: "Room" },
];

const TALK_KINDS: readonly RoomFeedKind[] = ["message", "narration", "beat"];

export function roomFeedGroup(kind: RoomFeedKind): RoomFeedGroup {
	return TALK_KINDS.includes(kind) ? "talk" : "room";
}

export type ParticipantNames = Record<string, string>;

export function participantNames(
	participants: readonly Participant[],
): ParticipantNames {
	const names: ParticipantNames = {};
	for (const participant of participants) {
		names[participant.id] = participant.displayName;
	}
	return names;
}

function nameOf(
	names: ParticipantNames,
	id: string | null | undefined,
	fallback = "Someone",
): string {
	if (!id) {
		return fallback;
	}
	return names[id] ?? id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

/** Conversation lane entries become feed items unchanged in meaning. */
export function roomFeedItemFromConversation(
	entry: DriveFeedEntry,
): RoomFeedItem {
	return {
		id: entry.id,
		kind: entry.kind,
		group: roomFeedGroup(entry.kind),
		participantId: entry.participantId,
		text: entry.text,
		at: entry.at,
	};
}

function addressLabel(names: ParticipantNames, addressSet: AddressSet): string {
	switch (addressSet.mode) {
		case "everyone":
			return "everyone";
		case "pack":
			return `pack ${addressSet.packId}`;
		case "agents": {
			const labels = addressSet.agentIds.map((id) => nameOf(names, id, id));
			if (labels.length <= 2) {
				return labels.join(" + ");
			}
			return `${labels.slice(0, 2).join(" + ")} +${labels.length - 2}`;
		}
		default: {
			const _exhaustive: never = addressSet;
			return _exhaustive;
		}
	}
}

/**
 * One room event → one feed line, or null for events the feed does not
 * narrate (conversation events already arrive through the fold; presence
 * and media events are noise at feed granularity).
 */
export function roomFeedItemFromDriveEvent(
	event: DriveEvent,
	names: ParticipantNames,
): RoomFeedItem | null {
	const base = { id: event.id, at: event.at };
	switch (event.type) {
		case "control.join":
			return {
				...base,
				kind: "join",
				group: "room",
				participantId: event.participant.id,
				text: `${event.participant.displayName} joined as ${event.participant.role}`,
			};
		case "control.leave":
			return {
				...base,
				kind: "leave",
				group: "room",
				participantId: event.participantId,
				text: `${nameOf(names, event.participantId)} left the call`,
				...(event.reason && event.reason !== "left"
					? { detail: event.reason }
					: {}),
			};
		case "control.end":
			return {
				...base,
				kind: "end",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId, "The host")} ended the call`,
				...(event.reason && event.reason !== "ended"
					? { detail: event.reason }
					: {}),
			};
		case "control.mode":
			return {
				...base,
				kind: "mode",
				group: "room",
				participantId: event.actorId ?? null,
				text:
					event.driveActive === false
						? "Drive paused"
						: `Mode set to ${event.subMode}`,
			};
		case "control.address":
			return {
				...base,
				kind: "address",
				group: "room",
				participantId: event.actorId ?? null,
				text: `Now addressing ${addressLabel(names, event.addressSet)}`,
			};
		case "control.stage": {
			if (!event.sharer) {
				return {
					...base,
					kind: "stage",
					group: "room",
					participantId: null,
					text: "Spotlight cleared",
				};
			}
			const who = nameOf(names, event.sharer.participantId);
			return {
				...base,
				kind: "stage",
				group: "room",
				participantId: event.sharer.participantId,
				text:
					event.sharer.kind === "human"
						? `${who} took the Spotlight`
						: `Spotlight moved to ${who}`,
				...(event.pin
					? { detail: `${event.pin.kind} · ${event.pin.label}` }
					: {}),
			};
		}
		case "control.title_granted":
			return {
				...base,
				kind: "title",
				group: "room",
				participantId: event.grant.agentId,
				text: `${nameOf(names, event.grant.agentId)} granted ${event.grant.title}`,
			};
		case "control.title_transferred":
			return {
				...base,
				kind: "title",
				group: "room",
				participantId: event.toGrant.agentId,
				text: `${event.title} transferred to ${nameOf(names, event.toGrant.agentId)}`,
			};
		case "control.title_revoked":
			return {
				...base,
				kind: "title",
				group: "room",
				participantId: null,
				text:
					event.reason === "expired"
						? "A title expired"
						: event.reason === "policy"
							? "A title was revoked by policy"
							: "A title was revoked",
			};
		case "control.raise_hand":
			return {
				...base,
				kind: "hand",
				group: "room",
				participantId: event.participantId,
				text: event.raised
					? `${nameOf(names, event.participantId)} raised a hand`
					: `${nameOf(names, event.participantId)} lowered their hand`,
			};
		case "control.mute":
			return {
				...base,
				kind: "mute",
				group: "room",
				participantId: event.participantId,
				text: event.muted
					? `${nameOf(names, event.participantId)} muted`
					: `${nameOf(names, event.participantId)} unmuted`,
			};
		case "control.rename":
			return {
				...base,
				kind: "system",
				group: "room",
				participantId: event.participantId,
				text: `${nameOf(names, event.participantId)} is now ${event.displayName}`,
			};
		case "work.edit":
			return {
				...base,
				kind: "work",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId)} edited ${event.path}`,
				...(event.summary ? { detail: event.summary } : {}),
			};
		case "work.command":
			return {
				...base,
				kind: "work",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId)} ran a command${event.failed ? " — failed" : ""}`,
				detail: event.command,
			};
		case "work.test_result":
			return {
				...base,
				kind: "work",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId)} · test ${event.passed ? "passed" : "failed"}: ${event.label}`,
				...(event.summary ? { detail: event.summary } : {}),
			};
		case "work.plan_step":
			return {
				...base,
				kind: "work",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId)} · plan step ${event.status.replace("_", " ")}: ${event.title}`,
				...(event.summary ? { detail: event.summary } : {}),
			};
		case "work.decision":
			return {
				...base,
				kind: "work",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId)} decided: ${event.title}`,
				detail: event.choice,
			};
		case "work.generic":
			return {
				...base,
				kind: "work",
				group: "room",
				participantId: event.actorId ?? null,
				text: `${nameOf(names, event.actorId)} · ${event.kind}: ${event.title}`,
				...(event.summary ? { detail: event.summary } : {}),
			};
		case "conversation.message":
		case "conversation.narration":
		case "control.interrupt_ack":
		case "control.invite":
		case "control.session_created":
		case "control.session_scheduled":
		case "control.session_started":
		case "control.session_ended":
		case "presence.speaking":
		case "presence.typing":
		case "presence.status":
		case "media.artifact":
			return null;
		default: {
			const _exhaustive: never = event;
			return _exhaustive;
		}
	}
}

/**
 * One sidecar broadcast → one feed line, or null. Only `room.event` (typed
 * room events) and `drive.show.presented` produce lines; snapshots, live
 * room syncs and beats are covered elsewhere (the fold, the Spotlight).
 */
export function roomFeedItemFromHubEvent(
	hubEvent: DriveHubEvent,
	names: ParticipantNames,
	options?: { now?: string },
): RoomFeedItem | null {
	const payload = isRecord(hubEvent.payload) ? hubEvent.payload : {};
	const at = hubEvent.timestamp ?? options?.now ?? new Date().toISOString();
	switch (hubEvent.event) {
		case "room.event": {
			let event: DriveEvent;
			try {
				event = parseDriveEvent(payload.event);
			} catch {
				return null;
			}
			return roomFeedItemFromDriveEvent(event, names);
		}
		case "drive.show.presented": {
			const showItemId = readString(payload, "showItemId");
			if (!showItemId) {
				return null;
			}
			const owner = readString(payload, "ownerParticipantId") ?? null;
			const title = readString(payload, "title") ?? showItemId;
			return {
				id: `show:${showItemId}:${at}`,
				kind: "show",
				group: "room",
				participantId: owner,
				text: `${nameOf(names, owner, "The Director")} presented “${title}”`,
				at,
			};
		}
		default:
			return null;
	}
}

/** Append one item, dropping duplicates by id and keeping the cap. */
export function appendRoomFeedItem(
	items: readonly RoomFeedItem[],
	item: RoomFeedItem,
	limit: number = ROOM_FEED_LIMIT,
): RoomFeedItem[] {
	if (items.some((existing) => existing.id === item.id)) {
		return [...items];
	}
	const next = [...items, item];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

/** A beat whose text a narration already carries, within a few seconds. */
const BEAT_ECHO_WINDOW_MS = 15_000;

function isEchoedBeat(
	beat: DriveFeedEntry,
	narrations: readonly DriveFeedEntry[],
): boolean {
	const text = beat.text.trim();
	const at = Date.parse(beat.at);
	return narrations.some((narration) => {
		if (narration.text.trim() !== text) {
			return false;
		}
		const narratedAt = Date.parse(narration.at);
		if (!Number.isFinite(at) || !Number.isFinite(narratedAt)) {
			return true;
		}
		return Math.abs(at - narratedAt) <= BEAT_ECHO_WINDOW_MS;
	});
}

/**
 * The feed the drawer renders: conversation lane + room lines, oldest first,
 * de-duplicated by id, capped. Stable for equal timestamps (room lines
 * before talk, so "X took the Spotlight" precedes the narration it caused).
 */
export function mergeRoomFeed(
	conversation: readonly DriveFeedEntry[],
	roomItems: readonly RoomFeedItem[],
	limit: number = ROOM_FEED_LIMIT,
): RoomFeedItem[] {
	const seen = new Set<string>();
	const merged: { item: RoomFeedItem; order: number }[] = [];
	let order = 0;
	for (const item of roomItems) {
		if (!seen.has(item.id)) {
			seen.add(item.id);
			merged.push({ item, order: order++ });
		}
	}
	const narrations = conversation.filter((entry) => entry.kind === "narration");
	for (const entry of conversation) {
		if (seen.has(entry.id)) {
			continue;
		}
		if (entry.kind === "beat" && isEchoedBeat(entry, narrations)) {
			// Caption and speech are the same line: the hub narrates a beat and
			// also broadcasts it as a script beat. One row, not two.
			continue;
		}
		seen.add(entry.id);
		merged.push({
			item: roomFeedItemFromConversation(entry),
			order: order++,
		});
	}
	merged.sort((a, b) => {
		const aAt = Date.parse(a.item.at);
		const bAt = Date.parse(b.item.at);
		const left = Number.isFinite(aAt) ? aAt : 0;
		const right = Number.isFinite(bAt) ? bAt : 0;
		if (left !== right) {
			return left - right;
		}
		if (a.item.group !== b.item.group) {
			return a.item.group === "room" ? -1 : 1;
		}
		return a.order - b.order;
	});
	const items = merged.map((entry) => entry.item);
	return items.length > limit ? items.slice(items.length - limit) : items;
}

export function filterRoomFeed(
	items: readonly RoomFeedItem[],
	options: { filter: RoomFeedFilter; participantId?: string | null },
): RoomFeedItem[] {
	const { filter, participantId } = options;
	return items.filter((item) => {
		if (filter !== "all" && item.group !== filter) {
			return false;
		}
		if (participantId && item.participantId !== participantId) {
			return false;
		}
		return true;
	});
}

/** The sync line the feed opens with, so an empty log still says what it knows. */
export function roomFeedSyncItem(input: {
	roomId: string;
	seq: number;
	participantCount: number;
	at: string;
}): RoomFeedItem {
	const seats =
		input.participantCount === 1 ? "1 seat" : `${input.participantCount} seats`;
	return {
		id: `sync:${input.roomId}:${input.seq}`,
		kind: "system",
		group: "room",
		participantId: null,
		text: `Synced with the hub · ${seats} · seq ${input.seq}`,
		at: input.at,
	};
}
