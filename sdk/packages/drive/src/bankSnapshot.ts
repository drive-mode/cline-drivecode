import type { BankSnapshot, DrivePlan, DriveTask } from "@cline/shared";

export function deriveBankSnapshot(
	plan: DrivePlan | null,
	tasksById: ReadonlyMap<string, DriveTask>,
): BankSnapshot {
	if (!plan || plan.status !== "active") {
		return emptySnapshot();
	}

	const openTaskIds: string[] = [];
	const openTitles: string[] = [];
	const openFailures: Array<string | undefined> = [];
	for (const taskId of plan.taskIds) {
		const task = tasksById.get(taskId);
		if (!task) {
			continue;
		}
		if (task.status === "open" || task.status === "in_progress") {
			openTaskIds.push(task.id);
			openTitles.push(task.title);
			openFailures.push(task.lastFailure);
		}
	}

	const nowTaskId = openTaskIds[0] ?? null;
	const nextTaskId = openTaskIds[1] ?? null;
	const nowLastFailure = openFailures[0] ?? null;

	return {
		activePlanId: plan.id,
		openTaskIds,
		nowTaskId,
		nextTaskId,
		nowTitle: openTitles[0] ?? null,
		nextTitle: openTitles[1] ?? null,
		nowLastFailure: nowLastFailure ?? null,
	};
}

function emptySnapshot(): BankSnapshot {
	return {
		activePlanId: null,
		openTaskIds: [],
		nowTaskId: null,
		nextTaskId: null,
		nowTitle: null,
		nextTitle: null,
		nowLastFailure: null,
	};
}
