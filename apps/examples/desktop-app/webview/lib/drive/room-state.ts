/**
 * Pure fold of hub broadcasts and `call_*` replies into the Drive room state
 * the desktop surfaces render.
 *
 * Mirrors the hub webview's `foldRoomSnapshot.ts` + `types.ts:applyRoomSnapshot`
 * with one rule kept front and centre: the hub is the only writer. A
 * `room.snapshot` replaces local state, a `room.event` folds through the same
 * `reduceRoom` kernel the hub uses, and anything this fold cannot apply
 * cleanly flags `needsResync` so the provider re-asks with `call_get_room`.
 */

import { activePresenterGrant, reduceRoom } from "@cline/drive";
import {
	type AgentTitleGrant,
	type DriveEvent,
	type DriveRoomLiveState,
	DriveRoomLiveStateSchema,
	type Participant,
	parseDriveEvent,
	type RoomSnapshot,
	type ShowBacklogItem,
	type StageCard,
	type StagePin,
	type StageSharer,
} from "@cline/shared";
import type { DriveCallReply, DriveHubEvent } from "./drive-client";

/** Feed entries: conversation, narration, script beats. Capped at 200. */
export const DRIVE_FEED_LIMIT = 200;
/** Recent script beats kept for the Spotlight caption rail. */
export const DRIVE_BEAT_LIMIT = 50;

export type DriveFeedEntryKind = "message" | "narration" | "beat" | "system";

export type DriveFeedEntry = {
	id: string;
	kind: DriveFeedEntryKind;
	participantId: string | null;
	text: string;
	at: string;
	/** Work event this narration explains, when the hub said so. */
	relatedWorkEventId?: string;
};

export type DrivePresentedShow = {
	showItemId: string;
	/** ShowArtifactKind of the active backlog item — presenter-bar eyebrow. */
	artifactKind?: string;
	/** Sticky policy in force for this show. */
	sticky?: "hold" | "replace";
	title?: string;
	caption?: string;
	uri?: string;
	ownerParticipantId?: string;
};

export type DriveScriptBeat = {
	beatId: string;
	say: string;
	showItemId: string | null;
	stickyShowIds: string[];
	activeScriptId: string | null;
	at: string;
	deliveryBlocked?: string;
};

/** Last `drive.spotlight.changed` broadcast. */
export type DriveSpotlightChange = {
	from: string | null;
	to: string | null;
	reason: string | null;
	via: string | null;
	at: string;
};

export type DriveRoomState = {
	roomId: string | null;
	snapshot: RoomSnapshot | null;
	/** Hub room log cursor; 0 until the first snapshot with a seq. */
	seq: number;
	callSessionId: string | null;
	/** Hub live room (director, spotlight, seats). Not durable truth. */
	live: DriveRoomLiveState | null;
	presentedShow: DrivePresentedShow | null;
	showBacklog: ShowBacklogItem[];
	spotlight: DriveSpotlightChange | null;
	beats: DriveScriptBeat[];
	lastEventAt: string | null;
	conversation: DriveFeedEntry[];
	whileAwayNote: string | null;
	handoffNarration: string | null;
	/** True once a `call_end` reply landed; cleared by the next join. */
	ended: boolean;
	/** The fold fell behind the hub; the provider must `call_get_room`. */
	needsResync: boolean;
};

export const EMPTY_DRIVE_ROOM_STATE: DriveRoomState = {
	roomId: null,
	snapshot: null,
	seq: 0,
	callSessionId: null,
	live: null,
	presentedShow: null,
	showBacklog: [],
	spotlight: null,
	beats: [],
	lastEventAt: null,
	conversation: [],
	whileAwayNote: null,
	handoffNarration: null,
	ended: false,
	needsResync: false,
};

export type FoldOptions = {
	/** ISO instant for entries the wire did not timestamp. */
	now?: string;
};

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

function readNullableString(
	record: Record<string, unknown>,
	key: string,
): string | null {
	return readString(record, key) ?? null;
}

function readNumber(
	record: Record<string, unknown>,
	key: string,
): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readStringArray(
	record: Record<string, unknown>,
	key: string,
): string[] {
	const value = record[key];
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function asRoomSnapshot(value: unknown): RoomSnapshot | null {
	if (!isRecord(value) || typeof value.roomId !== "string") {
		return null;
	}
	if (!Array.isArray(value.participants) || !isRecord(value.stage)) {
		return null;
	}
	return value as unknown as RoomSnapshot;
}

function eventAt(event: DriveHubEvent, options?: FoldOptions): string {
	return event.timestamp ?? options?.now ?? new Date().toISOString();
}

function appendFeed(
	feed: readonly DriveFeedEntry[],
	entry: DriveFeedEntry,
): DriveFeedEntry[] {
	if (feed.some((existing) => existing.id === entry.id)) {
		return [...feed];
	}
	const next = [...feed, entry];
	return next.length > DRIVE_FEED_LIMIT
		? next.slice(next.length - DRIVE_FEED_LIMIT)
		: next;
}

function appendBeat(
	beats: readonly DriveScriptBeat[],
	beat: DriveScriptBeat,
): DriveScriptBeat[] {
	const next = [...beats, beat];
	return next.length > DRIVE_BEAT_LIMIT
		? next.slice(next.length - DRIVE_BEAT_LIMIT)
		: next;
}

function feedEntryForEvent(event: DriveEvent): DriveFeedEntry | null {
	switch (event.type) {
		case "conversation.message":
			return {
				id: event.id,
				kind: "message",
				participantId: event.actorId ?? null,
				text: event.text,
				at: event.at,
			};
		case "conversation.narration":
			return {
				id: event.id,
				kind: "narration",
				participantId: event.actorId ?? null,
				text: event.text,
				at: event.at,
				...(event.relatedWorkEventId
					? { relatedWorkEventId: event.relatedWorkEventId }
					: {}),
			};
		default:
			return null;
	}
}

/** Fill the eyebrow/sticky fields from the backlog item that owns the frame. */
function decoratePresentedShow(
	presented: DrivePresentedShow | null,
	live: DriveRoomLiveState | null,
): DrivePresentedShow | null {
	if (!presented || !live) {
		return presented;
	}
	const item = live.director.showBacklog.find(
		(entry) => entry.id === presented.showItemId,
	);
	if (!item) {
		return presented;
	}
	const beat = live.director.activeScript?.beats.find(
		(entry) => entry.showItemId === item.id,
	);
	const sticky: DrivePresentedShow["sticky"] | undefined =
		beat?.sticky.mode === "replace"
			? "replace"
			: beat?.sticky.mode === "hold" || beat?.sticky.mode === "hold_until"
				? "hold"
				: presented.sticky;
	return {
		...presented,
		artifactKind: item.artifactKind,
		...(sticky ? { sticky } : {}),
		title: presented.title ?? item.title,
		caption: presented.caption ?? item.caption,
		uri: presented.uri ?? item.uri,
		ownerParticipantId: presented.ownerParticipantId ?? item.ownerParticipantId,
	};
}

function sameRoom(state: DriveRoomState, roomId: string | undefined): boolean {
	if (!roomId) {
		return true;
	}
	if (state.roomId === null) {
		return true;
	}
	return state.roomId === roomId;
}

function applyRoomSnapshotEvent(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	const snapshot = asRoomSnapshot(payload.snapshot);
	if (!snapshot) {
		return state;
	}
	const roomId = readString(payload, "roomId") ?? snapshot.roomId;
	if (!sameRoom(state, roomId)) {
		return state;
	}
	const seq = readNumber(payload, "seq");
	if (seq !== undefined && seq < state.seq) {
		// Stale broadcast — a newer snapshot already landed.
		return state;
	}
	return {
		...state,
		roomId: state.roomId ?? snapshot.roomId,
		snapshot,
		seq: seq ?? state.seq,
		lastEventAt: at,
		needsResync: false,
	};
}

function applyRoomEvent(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	const roomId = readString(payload, "roomId");
	if (!sameRoom(state, roomId)) {
		return state;
	}
	const seq = readNumber(payload, "seq");
	if (seq !== undefined && state.seq > 0 && seq <= state.seq) {
		// Already reflected by the snapshot we hold.
		return state;
	}
	const skippedAhead =
		seq !== undefined && state.seq > 0 && seq > state.seq + 1;

	let event: DriveEvent;
	try {
		event = parseDriveEvent(payload.event);
	} catch {
		return { ...state, needsResync: true, lastEventAt: at };
	}
	if (!sameRoom(state, event.roomId)) {
		return state;
	}

	const feedEntry = feedEntryForEvent(event);
	const conversation = feedEntry
		? appendFeed(state.conversation, feedEntry)
		: state.conversation;

	if (!state.snapshot || state.snapshot.roomId !== event.roomId) {
		// Nothing to fold onto — the provider must fetch the room.
		return {
			...state,
			roomId: state.roomId ?? event.roomId,
			conversation,
			lastEventAt: event.at,
			needsResync: true,
		};
	}

	const folded = reduceRoom(state.snapshot, event);
	return {
		...state,
		snapshot: folded,
		seq: seq ?? state.seq,
		conversation,
		lastEventAt: event.at,
		needsResync: state.needsResync || skippedAhead,
	};
}

function applyLiveRoomChanged(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	const parsed = DriveRoomLiveStateSchema.safeParse(payload.room);
	if (!parsed.success) {
		return state;
	}
	const live = parsed.data;
	if (!sameRoom(state, live.roomId)) {
		return state;
	}
	let presentedShow = decoratePresentedShow(state.presentedShow, live);
	if (
		!presentedShow &&
		live.director.activeShowId &&
		live.director.showBacklog.some(
			(item) => item.id === live.director.activeShowId,
		)
	) {
		// A room sync landing before the presented broadcast: light the frame
		// from the backlog so the Spotlight never shows a stale blank.
		presentedShow = decoratePresentedShow(
			{ showItemId: live.director.activeShowId },
			live,
		);
	}
	return {
		...state,
		roomId: state.roomId ?? live.roomId,
		live,
		showBacklog: [...live.director.showBacklog],
		presentedShow,
		lastEventAt: at,
	};
}

function applySpotlightChanged(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	return {
		...state,
		spotlight: {
			from: readNullableString(payload, "from"),
			to: readNullableString(payload, "to"),
			reason: readNullableString(payload, "reason"),
			via: readNullableString(payload, "via"),
			at,
		},
		lastEventAt: at,
	};
}

function applyShowPresented(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	const showItemId = readString(payload, "showItemId");
	if (!showItemId) {
		return state;
	}
	const current = state.presentedShow;
	const carried =
		current?.showItemId === showItemId
			? {
					...(current.artifactKind
						? { artifactKind: current.artifactKind }
						: {}),
					...(current.sticky ? { sticky: current.sticky } : {}),
				}
			: {};
	const presented: DrivePresentedShow = {
		...carried,
		showItemId,
		...(readString(payload, "title")
			? { title: readString(payload, "title") }
			: {}),
		...(readString(payload, "caption")
			? { caption: readString(payload, "caption") }
			: {}),
		...(readString(payload, "uri") ? { uri: readString(payload, "uri") } : {}),
		...(readString(payload, "ownerParticipantId")
			? { ownerParticipantId: readString(payload, "ownerParticipantId") }
			: {}),
	};
	return {
		...state,
		presentedShow: decoratePresentedShow(presented, state.live),
		showBacklog: state.showBacklog.map((item) =>
			item.id === showItemId ? { ...item, status: "showing" } : item,
		),
		lastEventAt: at,
	};
}

const SHOW_STATUSES: readonly ShowBacklogItem["status"][] = [
	"planned",
	"ready",
	"showing",
	"shown",
	"cancelled",
];

function parseShowStatus(
	value: string | undefined,
): ShowBacklogItem["status"] | undefined {
	return value && (SHOW_STATUSES as readonly string[]).includes(value)
		? (value as ShowBacklogItem["status"])
		: undefined;
}

function applyShowPlanned(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	const showItemId = readString(payload, "showItemId");
	if (!showItemId) {
		return state;
	}
	const status = parseShowStatus(readString(payload, "status"));
	const title = readString(payload, "title");
	const priority = readNumber(payload, "priority");
	let touched = false;
	const showBacklog = state.showBacklog.map((item) => {
		if (item.id !== showItemId) {
			return item;
		}
		touched = true;
		return {
			...item,
			...(title ? { title } : {}),
			...(priority !== undefined ? { priority } : {}),
			...(status ? { status } : {}),
		};
	});
	return {
		...state,
		showBacklog: touched ? showBacklog : state.showBacklog,
		lastEventAt: at,
	};
}

function applyScriptBeat(
	state: DriveRoomState,
	payload: Record<string, unknown>,
	at: string,
): DriveRoomState {
	const beatId = readString(payload, "beatId");
	if (!beatId) {
		return state;
	}
	const say = typeof payload.say === "string" ? payload.say.trim() : "";
	const showItemId = readNullableString(payload, "showItemId");
	const beat: DriveScriptBeat = {
		beatId,
		say,
		showItemId,
		stickyShowIds: readStringArray(payload, "stickyShowIds"),
		activeScriptId: readNullableString(payload, "activeScriptId"),
		at,
		...(readString(payload, "deliveryBlocked")
			? { deliveryBlocked: readString(payload, "deliveryBlocked") }
			: {}),
	};
	const speakerId =
		state.live?.director.activeScript?.ownerParticipantId ??
		state.live?.spotlightParticipantId ??
		null;
	let presentedShow = state.presentedShow;
	let conversation = state.conversation;
	if (say) {
		// Caption and speech are the same line: the Spotlight subtitle is what
		// a deafened viewer reads instead of hearing it.
		presentedShow = presentedShow
			? { ...presentedShow, caption: say }
			: { showItemId: showItemId ?? "script-beat", caption: say };
		conversation = appendFeed(conversation, {
			id: `beat:${beatId}:${at}`,
			kind: "beat",
			participantId: speakerId,
			text: say,
			at,
		});
	}
	return {
		...state,
		beats: appendBeat(state.beats, beat),
		presentedShow,
		conversation,
		lastEventAt: at,
	};
}

/**
 * Fold one sidecar `drive_hub_event` broadcast. Unknown events (`status.*`,
 * `drive.fork.*`, `drive.wave.*`, config/profile changes) leave room state
 * untouched — they are other surfaces' business.
 */
export function applyDriveHubEvent(
	state: DriveRoomState,
	hubEvent: DriveHubEvent,
	options?: FoldOptions,
): DriveRoomState {
	const payload = isRecord(hubEvent.payload) ? hubEvent.payload : {};
	const at = eventAt(hubEvent, options);
	switch (hubEvent.event) {
		case "room.snapshot":
			return applyRoomSnapshotEvent(state, payload, at);
		case "room.event":
			return applyRoomEvent(state, payload, at);
		case "drive.room.changed":
			return applyLiveRoomChanged(state, payload, at);
		case "drive.spotlight.changed":
			return applySpotlightChanged(state, payload, at);
		case "drive.show.presented":
			return applyShowPresented(state, payload, at);
		case "drive.show.planned":
			return applyShowPlanned(state, payload, at);
		case "drive.script.beat":
			return applyScriptBeat(state, payload, at);
		default:
			return state;
	}
}

/**
 * Apply a unicast `call_*` reply. Replies are authoritative for the room they
 * name: they replace the snapshot outright and clear any pending resync.
 */
export function applyCallReply(
	state: DriveRoomState,
	reply: DriveCallReply,
	options?: FoldOptions,
): DriveRoomState {
	const snapshot = asRoomSnapshot(reply.snapshot);
	if (!snapshot) {
		return state;
	}
	const roomId = reply.roomId || snapshot.roomId;
	const switchingRooms = state.roomId !== null && state.roomId !== roomId;
	const base = switchingRooms ? resetDriveRoomState(roomId) : state;
	const seq =
		typeof reply.seq === "number" && Number.isFinite(reply.seq)
			? Math.max(reply.seq, base.seq)
			: base.seq;
	const ended = reply.ended === true;
	return {
		...base,
		roomId,
		snapshot,
		seq,
		callSessionId: ended
			? null
			: (reply.callSessionId ?? (switchingRooms ? null : base.callSessionId)),
		whileAwayNote: reply.whileAwayNote ?? null,
		handoffNarration: reply.handoffNarration ?? null,
		ended,
		lastEventAt: options?.now ?? new Date().toISOString(),
		needsResync: false,
	};
}

/** Fresh state bound to one room (or none). */
export function resetDriveRoomState(roomId: string | null): DriveRoomState {
	return { ...EMPTY_DRIVE_ROOM_STATE, roomId };
}

/** Clear the resync flag once `call_get_room` has been re-requested. */
export function markResyncRequested(state: DriveRoomState): DriveRoomState {
	return state.needsResync ? { ...state, needsResync: false } : state;
}

// ── selectors ────────────────────────────────────────────────────────────

export type DriveSpotlightSelection = {
	sharer: StageSharer | null;
	sharerParticipant: Participant | null;
	cards: StageCard[];
	pin: StagePin | null;
	presenterGrant: AgentTitleGrant | null;
};

export function selectSpotlight(
	state: DriveRoomState,
	at: string = new Date().toISOString(),
): DriveSpotlightSelection {
	const snapshot = state.snapshot;
	if (!snapshot) {
		return {
			sharer: null,
			sharerParticipant: null,
			cards: [],
			pin: null,
			presenterGrant: null,
		};
	}
	const sharer = snapshot.stage.sharer;
	const sharerParticipant = sharer
		? (snapshot.participants.find((p) => p.id === sharer.participantId) ?? null)
		: null;
	const byId = snapshot.stage.presenterGrantId
		? snapshot.titleGrantsById[snapshot.stage.presenterGrantId]
		: undefined;
	const presenterGrant = byId ?? activePresenterGrant(snapshot, at) ?? null;
	return {
		sharer,
		sharerParticipant,
		cards: [...snapshot.stage.cards],
		pin: snapshot.stage.pin,
		presenterGrant,
	};
}

export function selectRoster(state: DriveRoomState): Participant[] {
	return state.snapshot ? [...state.snapshot.participants] : [];
}

/** Newest last, capped at {@link DRIVE_FEED_LIMIT}. */
export function selectFeed(state: DriveRoomState): DriveFeedEntry[] {
	return state.conversation;
}

export function selectHumanParticipant(
	state: DriveRoomState,
): Participant | null {
	return state.snapshot?.participants.find((p) => p.kind === "human") ?? null;
}

export function selectAgentParticipants(state: DriveRoomState): Participant[] {
	return state.snapshot?.participants.filter((p) => p.kind === "agent") ?? [];
}

/** A call is live when Drive is active and a human holds a seat. */
export function selectCallLive(state: DriveRoomState): boolean {
	const snapshot = state.snapshot;
	if (!snapshot || state.ended) {
		return false;
	}
	return (
		snapshot.driveActive &&
		snapshot.participants.some((participant) => participant.kind === "human")
	);
}
