/**
 * Agent Control Protocol helpers (ADR-0018 §4).
 *
 * Pure propose-only functions at the mutation / tool boundary.
 * Hosts commit leases and progress; this module never writes the bank.
 */

import type {
	DriveRun,
	DriveRunWorkItem,
	DriveRunWorkItemStatus,
	WorkLease,
} from "@cline/shared";

const CLAIMABLE_RUN_STATUSES = new Set<DriveRun["status"]>([
	"admitted",
	"running",
]);

const ELIGIBLE_WORK_STATUSES = new Set<DriveRunWorkItemStatus>(["PENDING"]);

export type AgentControlError = {
	ok: false;
	code: string;
	message: string;
};

export type ListEligibleWorkInput = {
	run: DriveRun;
	/** Active leases already held for this run (host-supplied). */
	activeLeases?: readonly WorkLease[];
	/** Wall clock for lease expiry checks. Defaults to Date.now(). */
	nowMs?: number;
};

export type ClaimWorkLeaseInput = {
	run: DriveRun;
	workItemId: string;
	idempotencyKey: string;
	expiresAt: string;
	runSpecRevision: number;
	leaseId?: string;
	acceptanceCriteria?: readonly string[];
	allowedActions?: readonly string[];
	workspaceFingerprint?: string;
	activeLeases?: readonly WorkLease[];
	nowMs?: number;
};

export type ClaimWorkLeaseResult =
	| { ok: true; lease: WorkLease }
	| AgentControlError;

export type ReportProgressInput = {
	run: DriveRun;
	workItemId: string;
	status: DriveRunWorkItemStatus;
};

export type ReportProgressResult =
	| {
			ok: true;
			/** Proposed run state — host persists. */
			run: DriveRun;
			workItem: DriveRunWorkItem;
	  }
	| AgentControlError;

function leaseIsActive(lease: WorkLease, nowMs: number): boolean {
	const expires = Date.parse(lease.expiresAt);
	if (Number.isNaN(expires)) {
		return true;
	}
	return expires > nowMs;
}

function leasedWorkItemIds(
	leases: readonly WorkLease[] | undefined,
	nowMs: number,
): Set<string> {
	const ids = new Set<string>();
	for (const lease of leases ?? []) {
		if (leaseIsActive(lease, nowMs)) {
			ids.add(lease.workItemId);
		}
	}
	return ids;
}

/**
 * `driveplan.list_eligible_work` — work items an agent may claim.
 * Propose only; does not mutate the run.
 */
export function listEligibleWork(
	input: ListEligibleWorkInput,
): DriveRunWorkItem[] {
	if (!CLAIMABLE_RUN_STATUSES.has(input.run.status)) {
		return [];
	}
	const nowMs = input.nowMs ?? Date.now();
	const leased = leasedWorkItemIds(input.activeLeases, nowMs);
	return input.run.spec.workItems.filter(
		(item) => ELIGIBLE_WORK_STATUSES.has(item.status) && !leased.has(item.id),
	);
}

/**
 * `driveplan.claim_work` — build a WorkLease proposal for one eligible item.
 * Host commits the lease; this never writes storage.
 */
export function claimWorkLease(
	input: ClaimWorkLeaseInput,
): ClaimWorkLeaseResult {
	if (!CLAIMABLE_RUN_STATUSES.has(input.run.status)) {
		return {
			ok: false,
			code: "run_not_claimable",
			message: `DriveRun ${input.run.id} status is ${input.run.status}; claim requires admitted or running.`,
		};
	}
	if (input.runSpecRevision !== input.run.spec.revision) {
		return {
			ok: false,
			code: "revision_mismatch",
			message: `runSpecRevision ${input.runSpecRevision} does not match run.spec.revision ${input.run.spec.revision}.`,
		};
	}
	if (!input.idempotencyKey.trim()) {
		return {
			ok: false,
			code: "missing_idempotency_key",
			message: "idempotencyKey is required to claim a work lease.",
		};
	}

	const nowMs = input.nowMs ?? Date.now();
	const eligible = listEligibleWork({
		run: input.run,
		activeLeases: input.activeLeases,
		nowMs,
	});
	const item = eligible.find((w) => w.id === input.workItemId);
	if (!item) {
		const existing = input.run.spec.workItems.find(
			(w) => w.id === input.workItemId,
		);
		if (!existing) {
			return {
				ok: false,
				code: "work_item_not_found",
				message: `Work item ${input.workItemId} is not on DriveRun ${input.run.id}.`,
			};
		}
		return {
			ok: false,
			code: "work_not_eligible",
			message: `Work item ${input.workItemId} is not eligible to claim (status ${existing.status} or leased).`,
		};
	}

	const lease: WorkLease = {
		id: input.leaseId?.trim() || `lease_${input.workItemId}`,
		driveTaskId: input.run.driveTaskId,
		driveRunId: input.run.id,
		workItemId: item.id,
		runSpecRevision: input.run.spec.revision,
		idempotencyKey: input.idempotencyKey,
		objective: item.objective,
		acceptanceCriteria: [...(input.acceptanceCriteria ?? [])],
		evidenceRequirements: [...item.evidenceRequirements],
		isolation: item.isolation,
		writeClaims: [...item.writeClaims],
		allowedActions: [...(input.allowedActions ?? [])],
		expiresAt: input.expiresAt,
		...(input.workspaceFingerprint
			? { workspaceFingerprint: input.workspaceFingerprint }
			: {}),
	};

	return { ok: true, lease };
}

/**
 * `driveplan.report_progress` — propose an updated run with a new work-item status.
 * Host commits; this never writes storage.
 */
export function reportProgress(
	input: ReportProgressInput,
): ReportProgressResult {
	const index = input.run.spec.workItems.findIndex(
		(item) => item.id === input.workItemId,
	);
	if (index < 0) {
		return {
			ok: false,
			code: "work_item_not_found",
			message: `Work item ${input.workItemId} is not on DriveRun ${input.run.id}.`,
		};
	}

	const previous = input.run.spec.workItems[index]!;
	const workItem: DriveRunWorkItem = {
		...previous,
		status: input.status,
	};
	const workItems = input.run.spec.workItems.map((item, i) =>
		i === index ? workItem : item,
	);
	const run: DriveRun = {
		...input.run,
		spec: {
			...input.run.spec,
			workItems,
		},
	};

	return { ok: true, run, workItem };
}
