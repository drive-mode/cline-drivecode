/**
 * In-memory DriveHostPort for harness / kernel tests (no fs, no hub).
 */

import type { DriveEvent, RoomSnapshot } from "@cline/shared";
import {
	CLINE_HOST_CAPABILITIES,
	type DriveHostPort,
	type HostCapabilities,
	type RoomOp,
} from "../hostPort.js";
import { createEmptyRoomSnapshot, reduceRoom } from "../reduceRoom.js";

export type MemoryDriveHost = DriveHostPort & {
	readonly rooms: Map<string, RoomSnapshot>;
};

function nowIso(): string {
	return new Date().toISOString();
}

function newEventId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function memoryDriveHost(
	capabilities: HostCapabilities = {
		...CLINE_HOST_CAPABILITIES,
		harnessId: "memory",
		durableConfigIo: false,
		promptRewrite: false,
		signedDirectorPolicy: false,
	},
): MemoryDriveHost {
	const rooms = new Map<string, RoomSnapshot>();
	const subscribers = new Set<(event: DriveEvent) => void>();
	const workBridges = new Set<(event: DriveEvent) => void>();

	const emit = (event: DriveEvent): void => {
		for (const handler of subscribers) {
			handler(event);
		}
		if (event.track === "work") {
			for (const handler of workBridges) {
				handler(event);
			}
		}
	};

	const host: MemoryDriveHost = {
		capabilities,
		rooms,
		async resolveKnownAgents() {
			return [];
		},
		async readDurableFacets() {
			throw new Error("memoryDriveHost: durableConfigIo not implemented");
		},
		async writeDurableFacets() {
			throw new Error("memoryDriveHost: durableConfigIo not implemented");
		},
		async getRoom(roomId) {
			return rooms.get(roomId) ?? null;
		},
		async commitRoomOp(op: RoomOp): Promise<RoomSnapshot> {
			switch (op.type) {
				case "create": {
					if (!rooms.has(op.roomId)) {
						rooms.set(
							op.roomId,
							createEmptyRoomSnapshot({
								roomId: op.roomId,
								createdAt: new Date().toISOString(),
							}),
						);
					}
					const created = rooms.get(op.roomId);
					if (!created) {
						throw new Error(`room_create_failed:${op.roomId}`);
					}
					return created;
				}
				case "join": {
					const current =
						rooms.get(op.roomId) ??
						createEmptyRoomSnapshot({
							roomId: op.roomId,
							createdAt: new Date().toISOString(),
						});
					const without = current.participants.filter(
						(p) => p.id !== op.participant.id,
					);
					// Mirror reduceRoom's control.join: a joining human defaults to
					// muted, and a prior explicit mute is never overwritten. This is
					// the wire's default, not a client preference, so a host that
					// skips it disagrees with the real hub about a privacy default.
					const needsMuteDefault =
						op.participant.kind === "human" &&
						!(op.participant.id in current.muteByParticipantId);
					const next: RoomSnapshot = {
						...current,
						participants: [...without, op.participant],
						muteByParticipantId: needsMuteDefault
							? {
									...current.muteByParticipantId,
									[op.participant.id]: true,
								}
							: current.muteByParticipantId,
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("join"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.join",
						track: "control",
						participant: op.participant,
					});
					return next;
				}
				case "leave": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const next: RoomSnapshot = {
						...current,
						participants: current.participants.filter(
							(p) => p.id !== op.participantId,
						),
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("leave"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.leave",
						track: "control",
						participantId: op.participantId,
					});
					return next;
				}
				case "setAddress": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const next: RoomSnapshot = {
						...current,
						addressSet: op.addressSet,
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("address"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.address",
						track: "control",
						addressSet: op.addressSet,
					});
					return next;
				}
				case "setStage": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const event: DriveEvent = {
						schemaVersion: 1,
						id: newEventId("stage"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.stage",
						track: "control",
						sharer: op.sharer,
						...(op.pin !== undefined ? { pin: op.pin } : {}),
					};
					const next = reduceRoom(current, event);
					if (
						op.sharer?.kind === "agent" &&
						next.stage.sharer?.participantId !== op.sharer.participantId
					) {
						throw new Error(`presenter_required:${op.sharer.participantId}`);
					}
					rooms.set(op.roomId, next);
					emit(event);
					return next;
				}
				case "setMode": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const next: RoomSnapshot = {
						...current,
						subMode: op.subMode,
						driveActive:
							op.driveActive !== undefined
								? op.driveActive
								: current.driveActive,
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("mode"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.mode",
						track: "control",
						subMode: op.subMode,
						driveActive: op.driveActive,
					});
					return next;
				}
				case "raiseHand": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const next: RoomSnapshot = {
						...current,
						raisedHandByParticipantId: {
							...current.raisedHandByParticipantId,
							[op.participantId]: op.raised,
						},
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("hand"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.raise_hand",
						track: "control",
						participantId: op.participantId,
						raised: op.raised,
					});
					return next;
				}
				case "mute": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const next: RoomSnapshot = {
						...current,
						muteByParticipantId: {
							...current.muteByParticipantId,
							[op.participantId]: op.muted,
						},
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("mute"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.mute",
						track: "control",
						participantId: op.participantId,
						muted: op.muted,
					});
					return next;
				}
				case "grantTitle":
				case "revokeTitle":
				case "transferTitle": {
					const current = rooms.get(op.roomId);
					if (!current) {
						throw new Error(`room_not_found:${op.roomId}`);
					}
					const event: DriveEvent =
						op.type === "grantTitle"
							? {
									schemaVersion: 1,
									id: newEventId("title_grant"),
									roomId: op.roomId,
									at: op.grant.grantedAt,
									type: "control.title_granted",
									track: "control",
									actorId: "cline:coordinator",
									grant: op.grant,
								}
							: op.type === "revokeTitle"
								? {
										schemaVersion: 1,
										id: newEventId("title_revoke"),
										roomId: op.roomId,
										at: op.revokedAt,
										type: "control.title_revoked",
										track: "control",
										actorId: "cline:coordinator",
										grantId: op.grantId,
										revokedAt: op.revokedAt,
										reason: op.reason,
									}
								: {
										schemaVersion: 1,
										id: newEventId("title_transfer"),
										roomId: op.roomId,
										at: op.transferredAt,
										type: "control.title_transferred",
										track: "control",
										actorId: "cline:coordinator",
										title: op.title,
										fromGrantId: op.fromGrantId,
										toGrant: op.toGrant,
										transferredAt: op.transferredAt,
									};
					const next = reduceRoom(current, event);
					if (
						op.type === "grantTitle" &&
						next.titleGrantsById[op.grant.id] === undefined
					) {
						throw new Error("presenter_conflict");
					}
					if (
						op.type === "revokeTitle" &&
						next.titleGrantsById[op.grantId]?.revokedAt !== op.revokedAt
					) {
						throw new Error(`title_grant_not_found:${op.grantId}`);
					}
					if (
						op.type === "transferTitle" &&
						next.titleGrantsById[op.toGrant.id] === undefined
					) {
						throw new Error(
							`presenter_transfer_source_invalid:${op.fromGrantId}`,
						);
					}
					rooms.set(op.roomId, next);
					emit(event);
					return next;
				}
				default: {
					const _never: never = op;
					return _never;
				}
			}
		},
		async broadcast(event) {
			emit(event);
		},
		subscribe(handler) {
			subscribers.add(handler);
			return () => {
				subscribers.delete(handler);
			};
		},
		bridgeWorkEvents(handler) {
			workBridges.add(handler);
			return () => {
				workBridges.delete(handler);
			};
		},
		async applyPromptRewrite() {
			throw new Error("memoryDriveHost: promptRewrite not implemented");
		},
	};

	return host;
}
