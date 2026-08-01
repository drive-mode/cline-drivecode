import type { TeamRuntimeState } from "@cline/shared";
import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";
import type { StatusTeamsSource } from "./status-teams-source";

type StatusTasksSnapshotResult = HostMessage & {
	type: "status_tasks_snapshot_result";
	requestId?: string;
	teams?: unknown[];
};

export function isStatusTasksSnapshotResult(
	message: HostMessage,
): message is StatusTasksSnapshotResult {
	return (
		message.type === "status_tasks_snapshot_result" &&
		isOptionalString(message.requestId) &&
		(message.teams === undefined || Array.isArray(message.teams))
	);
}

/**
 * Live hub adapter: requests `status_tasks_snapshot` and resolves when the
 * matching `status_tasks_snapshot_result` message arrives.
 */
export class HubStatusTeamsSource implements StatusTeamsSource {
	loadTeams(): Promise<TeamRuntimeState[]> {
		return new Promise((resolve) => {
			const requestId = `status-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`;

			const unsubscribe = subscribeToHostMessages({
				types: ["status_tasks_snapshot_result"],
				guard: isStatusTasksSnapshotResult,
				onMessage: (message) => {
					if (message.requestId !== requestId) {
						return;
					}
					unsubscribe();
					resolve(
						Array.isArray(message.teams)
							? (message.teams as TeamRuntimeState[])
							: [],
					);
				},
			});
			postToHost({ type: "status_tasks_snapshot", requestId });
		});
	}
}
