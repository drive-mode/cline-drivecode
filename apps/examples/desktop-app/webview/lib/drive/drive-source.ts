/**
 * The Drive data port. Views and the provider only ever see this interface;
 * `createHubDriveSource` is the live sidecar adapter and `demo-world.ts`
 * builds the labeled in-memory one. The composition root decides which one
 * mounts — a view never inspects env or query flags itself.
 */

import {
	type DriveAgentHomeOp,
	type DriveAgentProfilesOp,
	type DriveBankOp,
	type DriveCallOp,
	type DriveCallReply,
	type DriveCommandName,
	type DriveCommandPayload,
	type DriveConfigOp,
	type DriveHubEvent,
	type DriveHubStatus,
	type DriveRoomsListReply,
	type DriveSessionRollupsReply,
	type DriveSessionRollupsRequest,
	type DriveStatusOp,
	driveAgentHome,
	driveAgentProfiles,
	driveBank,
	driveCall,
	driveCommand,
	driveConfig,
	driveHubStatus,
	driveRoomsList,
	driveSessionRollups,
	driveStatus,
	subscribeDriveHubEvents,
} from "./drive-client";

export type DriveSourceKind = "hub" | "demo";

export type DriveHubEventHandler = (event: DriveHubEvent) => void;

export interface DriveDataSource {
	readonly kind: DriveSourceKind;
	hubStatus(): Promise<DriveHubStatus>;
	call(
		op: DriveCallOp,
		roomId: string,
		payload?: DriveCommandPayload,
	): Promise<DriveCallReply>;
	listRooms(workspaceRoot?: string): Promise<DriveRoomsListReply>;
	command<T = Record<string, unknown>>(
		command: DriveCommandName,
		payload?: DriveCommandPayload,
	): Promise<T>;
	status<T = Record<string, unknown>>(
		op: DriveStatusOp,
		payload?: DriveCommandPayload,
	): Promise<T>;
	bank<T = Record<string, unknown>>(
		op: DriveBankOp,
		payload?: DriveCommandPayload,
	): Promise<T>;
	sessionRollups(
		request?: DriveSessionRollupsRequest,
	): Promise<DriveSessionRollupsReply>;
	agentHome<T = Record<string, unknown>>(
		op: DriveAgentHomeOp,
		payload?: DriveCommandPayload,
	): Promise<T>;
	agentProfiles<T = Record<string, unknown>>(
		op: DriveAgentProfilesOp,
		payload?: DriveCommandPayload,
	): Promise<T>;
	config<T = Record<string, unknown>>(
		op: DriveConfigOp,
		payload?: DriveCommandPayload,
	): Promise<T>;
	/** Hub event stream (`room.*`, `drive.*`, `status.updated`). */
	subscribe(handler: DriveHubEventHandler): () => void;
	/** Release timers or subscriptions the source owns. Idempotent. */
	dispose(): void;
}

export function createHubDriveSource(): DriveDataSource {
	return {
		kind: "hub",
		hubStatus: () => driveHubStatus(),
		call: (op, roomId, payload) => driveCall(op, roomId, payload),
		listRooms: (workspaceRoot) => driveRoomsList(workspaceRoot),
		command: (command, payload) => driveCommand(command, payload),
		status: (op, payload) => driveStatus(op, payload),
		bank: (op, payload) => driveBank(op, payload),
		sessionRollups: (request) => driveSessionRollups(request),
		agentHome: (op, payload) => driveAgentHome(op, payload),
		agentProfiles: (op, payload) => driveAgentProfiles(op, payload),
		config: (op, payload) => driveConfig(op, payload),
		subscribe: (handler) => subscribeDriveHubEvents(handler),
		dispose: () => {
			// The transport is shared with the rest of the app; nothing to tear down.
		},
	};
}
