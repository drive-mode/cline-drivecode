/**
 * Hub DrivePlan Agent Control + projection commands (ADR-0018).
 */

import {
	applyProjection,
	claimWorkLease,
	listEligibleWork,
	reportProgress,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	DriveRunWorkItemStatusSchema,
	parseDriveRun,
	parseReceipt,
} from "@cline/shared";
import {
	getDriveRun,
	listWorkLeasesForRun,
	putDriveRun,
	putProjectionArtifact,
	putWorkLease,
} from "../../collaboration/driveRunStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function handleDrivePlanCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const workspaceRoot =
		readString(envelope.payload, "workspaceRoot") ??
		readString(envelope.payload, "configParent");
	if (!workspaceRoot) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workspaceRoot or configParent is required",
		);
	}

	switch (envelope.command) {
		case "driveplan.put_run": {
			try {
				const run = parseDriveRun(envelope.payload?.run);
				await putDriveRun(workspaceRoot, run);
				return okReply(envelope, { run });
			} catch (error) {
				return errorReply(
					envelope,
					"invalid_run",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		case "driveplan.get_run": {
			const runId = readString(envelope.payload, "runId");
			if (!runId) {
				return errorReply(envelope, "invalid_payload", "runId is required");
			}
			const run = await getDriveRun(workspaceRoot, runId);
			if (!run) {
				return errorReply(envelope, "not_found", `DriveRun ${runId} not found`);
			}
			return okReply(envelope, { run });
		}
		case "driveplan.list_eligible_work": {
			const runId = readString(envelope.payload, "runId");
			if (!runId) {
				return errorReply(envelope, "invalid_payload", "runId is required");
			}
			const run = await getDriveRun(workspaceRoot, runId);
			if (!run) {
				return errorReply(envelope, "not_found", `DriveRun ${runId} not found`);
			}
			const activeLeases = await listWorkLeasesForRun(workspaceRoot, runId);
			const workItems = listEligibleWork({ run, activeLeases });
			return okReply(envelope, { workItems, runId });
		}
		case "driveplan.claim_work": {
			const runId = readString(envelope.payload, "runId");
			const workItemId = readString(envelope.payload, "workItemId");
			const idempotencyKey = readString(envelope.payload, "idempotencyKey");
			const expiresAt = readString(envelope.payload, "expiresAt");
			if (!runId || !workItemId || !idempotencyKey || !expiresAt) {
				return errorReply(
					envelope,
					"invalid_payload",
					"runId, workItemId, idempotencyKey, and expiresAt are required",
				);
			}
			const run = await getDriveRun(workspaceRoot, runId);
			if (!run) {
				return errorReply(envelope, "not_found", `DriveRun ${runId} not found`);
			}
			const activeLeases = await listWorkLeasesForRun(workspaceRoot, runId);
			const claimed = claimWorkLease({
				run,
				workItemId,
				idempotencyKey,
				expiresAt,
				runSpecRevision: run.spec.revision,
				activeLeases,
			});
			if (!claimed.ok) {
				return errorReply(envelope, claimed.code, claimed.message);
			}
			await putWorkLease(workspaceRoot, claimed.lease);
			return okReply(envelope, { lease: claimed.lease });
		}
		case "driveplan.report_progress": {
			const runId = readString(envelope.payload, "runId");
			const workItemId = readString(envelope.payload, "workItemId");
			const statusRaw = readString(envelope.payload, "status");
			if (!runId || !workItemId || !statusRaw) {
				return errorReply(
					envelope,
					"invalid_payload",
					"runId, workItemId, and status are required",
				);
			}
			const statusParse = DriveRunWorkItemStatusSchema.safeParse(statusRaw);
			if (!statusParse.success) {
				return errorReply(
					envelope,
					"invalid_payload",
					"invalid work item status",
				);
			}
			const run = await getDriveRun(workspaceRoot, runId);
			if (!run) {
				return errorReply(envelope, "not_found", `DriveRun ${runId} not found`);
			}
			const reported = reportProgress({
				run,
				workItemId,
				status: statusParse.data,
			});
			if (!reported.ok) {
				return errorReply(envelope, reported.code, reported.message);
			}
			await putDriveRun(workspaceRoot, reported.run);
			return okReply(envelope, {
				run: reported.run,
				workItem: reported.workItem,
			});
		}
		case "driveplan.project_to_kanban": {
			const runId = readString(envelope.payload, "runId");
			if (!runId) {
				return errorReply(envelope, "invalid_payload", "runId is required");
			}
			const run = await getDriveRun(workspaceRoot, runId);
			if (!run) {
				return errorReply(envelope, "not_found", `DriveRun ${runId} not found`);
			}
			const projection = applyProjection(run);
			const path = await putProjectionArtifact(
				workspaceRoot,
				runId,
				projection,
			);
			return okReply(envelope, {
				projection,
				artifactPath: path,
				note: "Import projection.cards into DriveKanban via projectDriveRunToBoard (externalRef).",
			});
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				"Unknown driveplan command",
			);
	}
}

/** Parse optional boundRun + receipt from bank complete payload. */
export function readCompletionGuardPayload(
	payload: Record<string, unknown> | undefined,
): {
	boundRun?: ReturnType<typeof parseDriveRun>;
	receipt?: ReturnType<typeof parseReceipt>;
} {
	const out: {
		boundRun?: ReturnType<typeof parseDriveRun>;
		receipt?: ReturnType<typeof parseReceipt>;
	} = {};
	if (payload?.boundRun !== undefined) {
		out.boundRun = parseDriveRun(payload.boundRun);
	}
	if (payload?.receipt !== undefined) {
		out.receipt = parseReceipt(payload.receipt);
	}
	return out;
}
