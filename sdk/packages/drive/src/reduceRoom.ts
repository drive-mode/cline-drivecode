/**
 * Pure room fold + projections. Apps import these; hub commits separately.
 */

import type {
	AgentTitleGrant,
	DriveEvent,
	RoomSnapshot,
	StageCard,
} from "@cline/shared";

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

export function isTitleGrantActive(
	grant: AgentTitleGrant,
	at: string,
): boolean {
	const timestamp = Date.parse(at);
	return (
		Date.parse(grant.grantedAt) <= timestamp &&
		timestamp < Date.parse(grant.expiresAt) &&
		(grant.revokedAt === undefined || timestamp < Date.parse(grant.revokedAt))
	);
}

export function activePresenterGrant(
	snapshot: RoomSnapshot,
	at: string,
	agentId?: string,
): AgentTitleGrant | undefined {
	return Object.values(snapshot.titleGrantsById).find(
		(grant) =>
			grant.title === "presenter" &&
			(agentId === undefined || grant.agentId === agentId) &&
			isTitleGrantActive(grant, at),
	);
}

function clearExpiredPresenter(
	snapshot: RoomSnapshot,
	at: string,
): RoomSnapshot {
	const presenterGrantId = snapshot.stage.presenterGrantId;
	if (!presenterGrantId) {
		return snapshot;
	}
	const grant = snapshot.titleGrantsById[presenterGrantId];
	if (grant && isTitleGrantActive(grant, at)) {
		return snapshot;
	}
	return {
		...snapshot,
		stage: {
			...snapshot.stage,
			sharer:
				snapshot.stage.sharer?.kind === "agent" ? null : snapshot.stage.sharer,
			presenterGrantId: null,
		},
	};
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
	/** Seeded once from drive.defaults.subMode at room create (ADR-0013). */
	subMode?: RoomSnapshot["subMode"];
}): RoomSnapshot {
	return {
		schemaVersion: 1,
		roomId: input.roomId,
		createdAt: input.createdAt,
		driveActive: false,
		subMode: input.subMode ?? "plan",
		participants: input.host ? [input.host] : [],
		stage: { sharer: null, pin: null, cards: [], presenterGrantId: null },
		titleGrantsById: {},
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
	const base = clearExpiredPresenter(
		{ ...snapshot, appliedEventIds },
		event.at,
	);

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
		case "control.leave": {
			const presenter = activePresenterGrant(
				base,
				event.at,
				event.participantId,
			);
			const clearsStage =
				base.stage.sharer?.participantId === event.participantId;
			return {
				...base,
				participants: base.participants.filter(
					(p) => p.id !== event.participantId,
				),
				...(presenter
					? {
							titleGrantsById: {
								...base.titleGrantsById,
								[presenter.id]: { ...presenter, revokedAt: event.at },
							},
						}
					: {}),
				stage: clearsStage
					? { ...base.stage, sharer: null, pin: null, presenterGrantId: null }
					: base.stage,
			};
		}
		case "control.end":
			return {
				...base,
				participants: [],
				driveActive: false,
				stage: {
					...base.stage,
					sharer: null,
					pin: null,
					presenterGrantId: null,
				},
				titleGrantsById: Object.fromEntries(
					Object.entries(base.titleGrantsById).map(([id, grant]) => [
						id,
						isTitleGrantActive(grant, event.at)
							? { ...grant, revokedAt: event.at }
							: grant,
					]),
				),
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
		case "control.stage": {
			if (event.sharer?.kind === "agent") {
				const grant = activePresenterGrant(
					base,
					event.at,
					event.sharer.participantId,
				);
				if (!grant) {
					return base;
				}
				return {
					...base,
					stage: {
						...base.stage,
						sharer: event.sharer,
						pin: event.pin ?? null,
						presenterGrantId: grant.id,
					},
				};
			}
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
					presenterGrantId: null,
				},
			};
		}
		case "control.title_granted": {
			const activePresenter = activePresenterGrant(base, event.at);
			if (
				event.grant.title === "presenter" &&
				activePresenter &&
				activePresenter.id !== event.grant.id
			) {
				return base;
			}
			return {
				...base,
				titleGrantsById: {
					...base.titleGrantsById,
					[event.grant.id]: event.grant,
				},
				stage: {
					...base.stage,
					presenterGrantId: isTitleGrantActive(event.grant, event.at)
						? event.grant.id
						: base.stage.presenterGrantId,
				},
			};
		}
		case "control.title_revoked": {
			const grant = base.titleGrantsById[event.grantId];
			if (!grant) {
				return base;
			}
			const wasPresenter = base.stage.presenterGrantId === event.grantId;
			return {
				...base,
				titleGrantsById: {
					...base.titleGrantsById,
					[event.grantId]: { ...grant, revokedAt: event.revokedAt },
				},
				stage: wasPresenter
					? { ...base.stage, sharer: null, presenterGrantId: null }
					: base.stage,
			};
		}
		case "control.title_transferred": {
			const from = base.titleGrantsById[event.fromGrantId];
			if (
				!from ||
				from.title !== event.title ||
				event.toGrant.title !== event.title ||
				from.scope.kind !== event.toGrant.scope.kind ||
				from.scope.ref !== event.toGrant.scope.ref ||
				!isTitleGrantActive(from, event.transferredAt) ||
				!isTitleGrantActive(event.toGrant, event.transferredAt)
			) {
				return base;
			}
			return {
				...base,
				titleGrantsById: {
					...base.titleGrantsById,
					[event.fromGrantId]: {
						...from,
						revokedAt: event.transferredAt,
					},
					[event.toGrant.id]: event.toGrant,
				},
				stage: {
					...base.stage,
					sharer: {
						kind: "agent",
						participantId: event.toGrant.agentId,
					},
					pin: null,
					presenterGrantId: event.toGrant.id,
				},
			};
		}
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

export function projectActiveTitleGrants(
	snapshot: RoomSnapshot,
	at: string,
): readonly AgentTitleGrant[] {
	return Object.values(snapshot.titleGrantsById).filter((grant) =>
		isTitleGrantActive(grant, at),
	);
}

export function projectStage(snapshot: RoomSnapshot): RoomSnapshot["stage"] {
	return snapshot.stage;
}

export function projectRoster(
	snapshot: RoomSnapshot,
): RoomSnapshot["participants"] {
	return snapshot.participants;
}
