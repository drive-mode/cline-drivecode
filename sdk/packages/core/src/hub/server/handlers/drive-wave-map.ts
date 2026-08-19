/**
 * Map Director Do backlog → wave work inputs.
 * Wave DriveWorkItem ≠ bank DriveRunWorkItem (ADR-0018).
 */

import type { DriveWorkInput } from "@cline/drive";
import type { DoBacklogItem } from "@cline/shared";

/** Queued Do items become wave tasks; dependsOn / priority carry through. */
export function doBacklogToWaveInputs(
	items: readonly DoBacklogItem[],
): DriveWorkInput[] {
	return items
		.filter((item) => item.status === "queued")
		.map((item) => ({
			id: item.id,
			kind: "do_item",
			payload: { doItem: item },
			dependsOn: [...item.dependsOn],
			priority: item.priority,
		}));
}

export function resolveDoItemFromWaveTask(task: {
	id: string;
	kind: string;
	payload: Record<string, unknown>;
	priority: number;
	dependsOn: string[];
}): DoBacklogItem {
	const raw = task.payload.doItem;
	if (raw && typeof raw === "object") {
		const item = raw as Partial<DoBacklogItem>;
		if (
			typeof item.id === "string" &&
			typeof item.title === "string" &&
			typeof item.goal === "string" &&
			typeof item.priority === "number" &&
			typeof item.status === "string" &&
			Array.isArray(item.dependsOn) &&
			typeof item.source === "string"
		) {
			return item as DoBacklogItem;
		}
	}
	return {
		id: task.id,
		title:
			typeof task.payload.title === "string" ? task.payload.title : task.id,
		goal:
			typeof task.payload.goal === "string"
				? task.payload.goal
				: `Wave task ${task.id}`,
		priority: task.priority,
		status: "queued",
		dependsOn: [...task.dependsOn],
		source: "system",
		...(typeof task.payload.assigneeParticipantId === "string"
			? { assigneeParticipantId: task.payload.assigneeParticipantId }
			: {}),
	};
}
