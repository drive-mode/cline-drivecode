/**
 * DriveRun agent-runtime schemas (ARD-0018).
 *
 * Distinct from room-wave `DriveWorkItem` in `@cline/drive` waves — use
 * `DriveRunWorkItem` for run admission / lease packets.
 */

import { z } from "zod";

export const DriveRunWorkItemStatusSchema = z.enum([
	"PENDING",
	"RUNNING",
	"SUCCESS",
	"FAILED",
	"AWAITING_REVIEW",
]);

export const DriveRunIsolationSchema = z.enum([
	"workspace_shared",
	"worktree_isolated",
	"readonly",
]);

export const DriveRunWorkItemSchema = z
	.object({
		id: z.string().min(1),
		objective: z.string().min(1),
		writeClaims: z.array(z.string()).default([]),
		isolation: DriveRunIsolationSchema,
		evidenceRequirements: z.array(z.string()).default([]),
		status: DriveRunWorkItemStatusSchema.default("PENDING"),
	})
	.strict();

export const DriveRunWaveSchema = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		workItemIds: z.array(z.string().min(1)),
	})
	.strict();

export const DriveRunGateSchema = z
	.object({
		id: z.string().min(1),
		kind: z.enum([
			"gate.admission",
			"gate.wave_checkpoint",
			"gate.receipt",
		]),
		label: z.string().min(1),
	})
	.strict();

export const DriveRunSpecSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		maxParallel: z.number().int().positive(),
		waves: z.array(DriveRunWaveSchema),
		gates: z.array(DriveRunGateSchema),
		workItems: z.array(DriveRunWorkItemSchema),
	})
	.strict();

export const DriveRunStatusSchema = z.enum([
	"draft",
	"admitted",
	"running",
	"awaiting_verification",
	"accepted",
	"rejected",
	"cancelled",
]);

export const DriveRunSchema = z
	.object({
		id: z.string().min(1),
		driveTaskId: z.string().min(1),
		title: z.string().min(1),
		status: DriveRunStatusSchema,
		spec: DriveRunSpecSchema,
	})
	.strict();

export const WorkLeaseSchema = z
	.object({
		id: z.string().min(1),
		driveTaskId: z.string().min(1),
		driveRunId: z.string().min(1),
		workItemId: z.string().min(1),
		runSpecRevision: z.number().int().nonnegative(),
		idempotencyKey: z.string().min(1),
		objective: z.string().min(1),
		acceptanceCriteria: z.array(z.string()).default([]),
		evidenceRequirements: z.array(z.string()).default([]),
		workspaceFingerprint: z.string().optional(),
		isolation: DriveRunIsolationSchema,
		writeClaims: z.array(z.string()).default([]),
		allowedActions: z.array(z.string()).default([]),
		expiresAt: z.string().min(1),
		heartbeatAt: z.string().optional(),
	})
	.strict();

export const ReceiptDecisionSchema = z.enum([
	"pending",
	"accepted",
	"rejected",
]);

export const ReceiptSchema = z
	.object({
		id: z.string().min(1),
		driveTaskId: z.string().min(1),
		driveRunId: z.string().min(1),
		workItemId: z.string().optional(),
		evidenceRefs: z.array(z.string()).default([]),
		decision: ReceiptDecisionSchema.default("pending"),
		decidedBy: z.string().optional(),
		createdAt: z.string().min(1),
	})
	.strict();

export type DriveRunWorkItemStatus = z.infer<typeof DriveRunWorkItemStatusSchema>;
export type DriveRunIsolation = z.infer<typeof DriveRunIsolationSchema>;
export type DriveRunWorkItem = z.infer<typeof DriveRunWorkItemSchema>;
export type DriveRunWave = z.infer<typeof DriveRunWaveSchema>;
export type DriveRunGate = z.infer<typeof DriveRunGateSchema>;
export type DriveRunSpec = z.infer<typeof DriveRunSpecSchema>;
export type DriveRunStatus = z.infer<typeof DriveRunStatusSchema>;
export type DriveRun = z.infer<typeof DriveRunSchema>;
export type WorkLease = z.infer<typeof WorkLeaseSchema>;
export type ReceiptDecision = z.infer<typeof ReceiptDecisionSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

export function parseDriveRun(input: unknown): DriveRun {
	return DriveRunSchema.parse(input);
}

export function parseWorkLease(input: unknown): WorkLease {
	return WorkLeaseSchema.parse(input);
}

export function parseReceipt(input: unknown): Receipt {
	return ReceiptSchema.parse(input);
}
