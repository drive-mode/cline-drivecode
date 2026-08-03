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
import { createEmptyRoomSnapshot } from "../reduceRoom.js";

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
					return rooms.get(op.roomId)!;
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
					const next: RoomSnapshot = {
						...current,
						participants: [...without, op.participant],
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
					const next: RoomSnapshot = {
						...current,
						stage: {
							...current.stage,
							sharer: op.sharer,
							...(op.pin !== undefined ? { pin: op.pin } : {}),
						},
					};
					rooms.set(op.roomId, next);
					emit({
						schemaVersion: 1,
						id: newEventId("stage"),
						roomId: op.roomId,
						at: nowIso(),
						type: "control.stage",
						track: "control",
						sharer: op.sharer,
						...(op.pin !== undefined ? { pin: op.pin } : {}),
					});
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
