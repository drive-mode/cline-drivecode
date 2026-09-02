import { z } from "zod";

export const TASKS_PACK_ID = "tasks" as const;

/**
 * Task graph events — what a fleet surface (map, list, activity rollups)
 * needs: identity, project, state transitions, progress, and dependency
 * edges. Rides `work.generic`; the kernel never special-cases it.
 */
export const TaskStateSchema = z.enum([
	"queued",
	"running",
	"review",
	"blocked",
	"done",
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

const CreatedPayload = z
	.object({
		taskId: z.string().min(1),
		title: z.string().min(1),
		project: z.string().min(1),
		state: TaskStateSchema.default("queued"),
		/** Task ids this task depends on — the edges a task map draws. */
		deps: z.array(z.string().min(1)).optional(),
		summary: z.string().optional(),
	})
	.strict();

const StatePayload = z
	.object({
		taskId: z.string().min(1),
		state: TaskStateSchema,
		title: z.string().min(1).optional(),
		summary: z.string().optional(),
	})
	.strict();

const ProgressPayload = z
	.object({
		taskId: z.string().min(1),
		/** 0..1 — running-task ring/bar fill. */
		progress: z.number().min(0).max(1),
		title: z.string().min(1).optional(),
		summary: z.string().optional(),
	})
	.strict();

export type ValidatedTasksWork =
	| { type: "work.task.created"; payload: z.infer<typeof CreatedPayload> }
	| { type: "work.task.state"; payload: z.infer<typeof StatePayload> }
	| { type: "work.task.progress"; payload: z.infer<typeof ProgressPayload> };

export function validateTasksWork(
	type: string,
	payload: unknown,
): ValidatedTasksWork {
	switch (type) {
		case "work.task.created":
			return { type, payload: CreatedPayload.parse(payload) };
		case "work.task.state":
			return { type, payload: StatePayload.parse(payload) };
		case "work.task.progress":
			return { type, payload: ProgressPayload.parse(payload) };
		default:
			throw new Error(`Unknown tasks work type: ${type}`);
	}
}

export const tasksPack = {
	id: TASKS_PACK_ID,
	schemaVersion: 1 as const,
	validate: validateTasksWork,
};
