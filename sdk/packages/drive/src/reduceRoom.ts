/**
 * Pure room fold + projections. Apps import these; hub commits separately.
 */

import type { DriveEvent, RoomSnapshot, StageCard } from "@cline/shared";

function rememberEventId(ids: readonly string[], id: string): string[] {
	if (ids.includes(id)) {
		return [...ids];
	}
	return [...ids, id];
}

function upsertStageCard(
	cards: readonly StageCard[],
	card: StageCard,
): StageCard[] {
	const without = cards.filter((c) => c.category !== card.category);
	return [...without, card];
}

function cardFromWorkEvent(event: DriveEvent): StageCard | null {
	switch (event.type) {
		case "work.edit":
			return {
				id: `card_${event.id}`,
				category: "edit",
				title: event.path,
				summary: event.summary,
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.command":
			return {
				id: `card_${event.id}`,
				category: "command",
				title: event.command,
				summary: event.summary ?? (event.failed ? "failed" : "ok"),
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.test_result":
			return {
				id: `card_${event.id}`,
				category: "test",
				title: event.label,
				summary: event.summary ?? (event.passed ? "passed" : "failed"),
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.plan_step":
			return {
				id: `card_${event.id}`,
				category: "plan",
				title: event.title,
				summary: event.summary ?? event.status,
				workEventId: event.id,
				updatedAt: event.at,
			};
		case "work.decision":
			return {
				id: `card_${event.id}`,
				category: "decision",
				title: event.title,
				summary: event.choice,
				workEventId: event.id,
				updatedAt: event.at,
			};
		default:
			return null;
	}
}

export function createEmptyRoomSnapshot(input: {
	roomId: string;
	createdAt: string;
	host?: RoomSnapshot["participants"][number];
}): RoomSnapshot {
	return {
		schemaVersion: 1,
		roomId: input.roomId,
		createdAt: input.createdAt,
		driveActive: false,
		subMode: "plan",
		participants: input.host ? [input.host] : [],
		stage: { sharer: null, pin: null, cards: [] },
		addressSet: { mode: "everyone" },
		muteByParticipantId: {},
		raisedHandByParticipantId: {},
		appliedEventIds: [],
	};
}

/**
 * Pure fold. Same event sequence from the same snapshot → identical result.
 * Re-applying an event by id is a no-op (idempotent).
 */
export function reduceRoom(
	snapshot: RoomSnapshot,
	event: DriveEvent,
): RoomSnapshot {
	if (snapshot.appliedEventIds.includes(event.id)) {
		return snapshot;
	}
	if (event.roomId !== snapshot.roomId) {
		return snapshot;
	}

	const appliedEventIds = rememberEventId(snapshot.appliedEventIds, event.id);
	const base = { ...snapshot, appliedEventIds };

	switch (event.type) {
		case "control.join": {
			const exists = base.participants.some(
				(p) => p.id === event.participant.id,
			);
			// A joining human defaults to muted (hot-mic-on-join is the wrong
			// privacy default — mic audio streams to the STT vendor). This is the
			// wire's own default, not a client preference, so it holds regardless
			// of which client joins: a webview that already renders muted first
			// just confirms what the hub already recorded; any other client gets
			// the safe default too. A prior explicit control.mute (e.g. a rejoin
			// of a participant id that unmuted earlier this room) is never
			// overwritten — this only fills a genuinely absent entry.
			const needsMuteDefault =
				event.participant.kind === "human" &&
				!(event.participant.id in base.muteByParticipantId);
			return {
				...base,
				participants: exists
					? base.participants.map((p) =>
							p.id === event.participant.id ? event.participant : p,
						)
					: [...base.participants, event.participant],
				...(needsMuteDefault
					? {
							muteByParticipantId: {
								...base.muteByParticipantId,
								[event.participant.id]: true,
							},
						}
					: {}),
			};
		}
		case "control.leave":
			return {
				...base,
				participants: base.participants.filter(
					(p) => p.id !== event.participantId,
				),
			};
		case "control.end":
			return {
				...base,
				participants: [],
				driveActive: false,
				stage: {
					...base.stage,
					sharer: null,
					pin: null,
				},
				raisedHandByParticipantId: {},
			};
		case "control.mute":
			return {
				...base,
				muteByParticipantId: {
					...base.muteByParticipantId,
					[event.participantId]: event.muted,
				},
			};
		case "control.stage":
			return {
				...base,
				stage: {
					...base.stage,
					sharer: event.sharer,
					pin:
						event.pin !== undefined
							? event.pin
							: event.sharer?.kind === "human"
								? base.stage.pin
								: null,
				},
			};
		case "control.mode":
			return {
				...base,
				subMode: event.subMode,
				driveActive: event.driveActive ?? base.driveActive,
			};
		case "control.raise_hand":
			return {
				...base,
				raisedHandByParticipantId: {
					...base.raisedHandByParticipantId,
					[event.participantId]: event.raised,
				},
			};
		case "control.rename":
			return {
				...base,
				participants: base.participants.map((p) =>
					p.id === event.participantId
						? { ...p, displayName: event.displayName }
						: p,
				),
			};
		case "control.address":
			return { ...base, addressSet: event.addressSet };
		case "work.edit":
		case "work.command":
		case "work.test_result":
		case "work.plan_step":
		case "work.decision": {
			const card = cardFromWorkEvent(event);
			if (!card) {
				return base;
			}
			return {
				...base,
				stage: {
					...base.stage,
					cards: upsertStageCard(base.stage.cards, card),
				},
			};
		}
		case "presence.status":
			return {
				...base,
				participants: base.participants.map((p) =>
					p.id === event.participantId ? { ...p, status: event.status } : p,
				),
			};
		case "presence.speaking":
			return {
				...base,
				participants: base.participants.map((p) => {
					if (p.id !== event.participantId) {
						return p;
					}
					if (event.speaking) {
						return { ...p, status: "speaking" };
					}
					// Only ever retire our own status. A `working` or `away` status
					// set while the utterance played is newer truth than "idle".
					return p.status === "speaking" ? { ...p, status: "idle" } : p;
				}),
			};
		case "conversation.message":
		case "conversation.narration":
		case "presence.typing":
		// Artifacts fold into the artifact directory, not the room snapshot.
		case "media.artifact":
			return base;
		default: {
			const _exhaustive: never = event;
			return _exhaustive;
		}
	}
}

export function projectStage(snapshot: RoomSnapshot): RoomSnapshot["stage"] {
	return snapshot.stage;
}

export function projectRoster(
	snapshot: RoomSnapshot,
): RoomSnapshot["participants"] {
	return snapshot.participants;
}
