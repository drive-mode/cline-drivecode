/**
 * Drive task bank schemas.
 *
 * Plans are ordered refs to tasks. Tasks are the durable implementable unit.
 */

import { z } from "zod";

export const DRIVE_BANK_ROOT = ".drive/bank";

export const DriveTaskStatusSchema = z.enum(["open", "in_progress", "done"]);

export const DrivePlanStatusSchema = z.enum(["draft", "active", "closed"]);

export const DriveTaskSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		body: z.string(),
		status: DriveTaskStatusSchema,
		lastFailure: z.string().optional(),
	})
	.strict();

export const DrivePlanSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		taskIds: z.array(z.string().min(1)),
		status: DrivePlanStatusSchema,
	})
	.strict();

/**
 * Draft task proposed before it exists in the bank (09-next-task-proposer rule 2).
 *
 * Carries only what a proposer can honestly know: the prose. `id` and `status`
 * are commit-time facts the host assigns, and `lastFailure` is runtime history —
 * none of them belong on a draft. `.strict()` is the privacy mechanism: an extra
 * `transcript` / `utterance` key fails to parse, so a draft cannot smuggle
 * session prose into the bank alongside its body.
 */
export const DriveTaskDraftSchema = z
	.object({
		title: z.string().min(1),
		body: z.string(),
	})
	.strict();

export const BankSnapshotSchema = z
	.object({
		activePlanId: z.string().nullable(),
		openTaskIds: z.array(z.string()),
		nowTaskId: z.string().nullable(),
		nextTaskId: z.string().nullable(),
		nowTitle: z.string().nullable(),
		nextTitle: z.string().nullable(),
		/** Now-task failure note when present — recovery chrome (DRV-FELT-AGENCY). */
		nowLastFailure: z.string().nullable().optional(),
	})
	.strict();

export type DriveTaskStatus = z.infer<typeof DriveTaskStatusSchema>;
export type DrivePlanStatus = z.infer<typeof DrivePlanStatusSchema>;
export type DriveTask = z.infer<typeof DriveTaskSchema>;
export type DriveTaskDraft = z.infer<typeof DriveTaskDraftSchema>;
export type DrivePlan = z.infer<typeof DrivePlanSchema>;
export type BankSnapshot = z.infer<typeof BankSnapshotSchema>;

export function parseDriveTask(input: unknown): DriveTask {
	return DriveTaskSchema.parse(input);
}

export function parseDrivePlan(input: unknown): DrivePlan {
	return DrivePlanSchema.parse(input);
}

export function parseBankSnapshot(input: unknown): BankSnapshot {
	return BankSnapshotSchema.parse(input);
}

export function parseDriveTaskDraft(input: unknown): DriveTaskDraft {
	return DriveTaskDraftSchema.parse(input);
}
