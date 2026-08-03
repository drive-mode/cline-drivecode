/**
 * Narrow DrivePlan–Kanban Interop (ADR-0018 §7 + ADR-0019).
 *
 * Parses at the host boundary: callers pass a typed `DriveRun` (from
 * `@cline/shared` parse helpers). This package stays type-only on shared.
 * `execute` / `collectReceipt` require a `KanbanInteropHost` — drive stays pure.
 */

import type { DriveRun, DriveRunWorkItem, Receipt, WorkLease } from "@cline/shared";

export const DRIVEPLAN_KANBAN_SYSTEM = "driveplan" as const;

export type DriveplanExternalRef = {
	system: typeof DRIVEPLAN_KANBAN_SYSTEM;
	driveTaskId: string;
	driveRunId: string;
	workItemId?: string;
};

export type KanbanInteropCapabilities = {
	protocol: "driveplan-kanban-interop";
	version: 0;
	supports: readonly [
		"getCapabilities",
		"applyProjection",
		"observe",
		"execute",
		"collectReceipt",
	];
	deferred: readonly [];
};

export type ProjectedKanbanCard = {
	title: string;
	prompt: string;
	startInPlanMode: boolean;
	autoReviewEnabled: false;
	externalRef: DriveplanExternalRef;
	columnHint: "backlog" | "in_progress" | "review";
};

export type ApplyProjectionResult = {
	driveTaskId: string;
	driveRunId: string;
	cards: ProjectedKanbanCard[];
};

export type ObserveCursor = {
	driveRunId: string;
	revision: number;
};

export type ObserveResult = {
	cursor: ObserveCursor;
	status: DriveRun["status"];
	workItemStatuses: Array<{ id: string; status: DriveRunWorkItem["status"] }>;
	projectionDiverged: boolean;
};

/** Host-owned side of ADR-0019 — sessions, board IO, evidence collection. */
export type KanbanInteropHost = {
	executeAllowedCommand: (input: {
		lease: WorkLease;
		command: string;
		args?: Record<string, unknown>;
	}) => Promise<{
		ok: boolean;
		result?: Record<string, unknown>;
		error?: string;
	}>;
	collectReceiptEvidence: (input: {
		lease: WorkLease;
		run: DriveRun;
	}) => Promise<{
		evidenceRefs: string[];
		decision?: Receipt["decision"];
		decidedBy?: string;
	}>;
};

export type ExecuteInput = {
	host: KanbanInteropHost;
	lease: WorkLease;
	command: string;
	args?: Record<string, unknown>;
};

export type ExecuteResult =
	| { ok: true; result?: Record<string, unknown> }
	| { ok: false; code: string; message: string };

export type CollectReceiptInput = {
	host: KanbanInteropHost;
	lease: WorkLease;
	run: DriveRun;
	receiptId?: string;
};

export type CollectReceiptResult =
	| { ok: true; receipt: Receipt }
	| { ok: false; code: string; message: string };

export function getCapabilities(): KanbanInteropCapabilities {
	return {
		protocol: "driveplan-kanban-interop",
		version: 0,
		supports: [
			"getCapabilities",
			"applyProjection",
			"observe",
			"execute",
			"collectReceipt",
		],
		deferred: [],
	};
}

function columnForStatus(status: DriveRunWorkItem["status"]): ProjectedKanbanCard["columnHint"] {
	switch (status) {
		case "PENDING":
			return "backlog";
		case "RUNNING":
		case "FAILED":
			return "in_progress";
		case "SUCCESS":
		case "AWAITING_REVIEW":
			return "review";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

/**
 * Read-only projection for one DriveTask + one DriveRun.
 * Does not mutate a Kanban board — returns card descriptors for a host adapter.
 */
export function applyProjection(run: DriveRun): ApplyProjectionResult {
	const cards: ProjectedKanbanCard[] = run.spec.workItems.map((item) => ({
		title: `${item.id} · ${item.objective}`,
		prompt: [
			`DriveTask: ${run.driveTaskId}`,
			`DriveRun: ${run.id}`,
			`WorkItem: ${item.id}`,
			"",
			item.objective,
			"",
			`Isolation: ${item.isolation}`,
			item.writeClaims.length ? `Write claims: ${item.writeClaims.join(", ")}` : "Write claims: none",
			item.evidenceRequirements.length
				? `Evidence: ${item.evidenceRequirements.join(", ")}`
				: "Evidence: none",
		].join("\n"),
		startInPlanMode: false,
		autoReviewEnabled: false,
		externalRef: {
			system: DRIVEPLAN_KANBAN_SYSTEM,
			driveTaskId: run.driveTaskId,
			driveRunId: run.id,
			workItemId: item.id,
		},
		columnHint: columnForStatus(item.status),
	}));

	return {
		driveTaskId: run.driveTaskId,
		driveRunId: run.id,
		cards,
	};
}

/**
 * Observe run status for an existing projection cursor.
 * `projectionDiverged` is set by the host when a human edits a managed card;
 * this stub only reports run-side state.
 */
export function observe(run: DriveRun, cursor?: ObserveCursor): ObserveResult {
	return {
		cursor: {
			driveRunId: run.id,
			revision: cursor?.revision ?? run.spec.revision,
		},
		status: run.status,
		workItemStatuses: run.spec.workItems.map((item) => ({
			id: item.id,
			status: item.status,
		})),
		projectionDiverged: false,
	};
}

function assertLeaseMatchesRun(lease: WorkLease, run: DriveRun): string | null {
	if (lease.driveRunId !== run.id) {
		return `lease ${lease.id} is for run ${lease.driveRunId}, not ${run.id}`;
	}
	if (lease.driveTaskId !== run.driveTaskId) {
		return `lease ${lease.id} is for task ${lease.driveTaskId}, not ${run.driveTaskId}`;
	}
	if (lease.runSpecRevision !== run.spec.revision) {
		return `lease ${lease.id} revision ${lease.runSpecRevision} ≠ run revision ${run.spec.revision}`;
	}
	return null;
}

/**
 * Lease-scoped allowed command (ADR-0019). Host enforces allowlist + workspace.
 */
export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
	const allowed = input.lease.allowedActions;
	if (allowed.length > 0 && !allowed.includes(input.command)) {
		return {
			ok: false,
			code: "command_not_allowed",
			message: `Command ${input.command} is not in lease allowedActions`,
		};
	}
	const result = await input.host.executeAllowedCommand({
		lease: input.lease,
		command: input.command,
		args: input.args,
	});
	if (!result.ok) {
		return {
			ok: false,
			code: "host_execute_failed",
			message: result.error ?? "host execute failed",
		};
	}
	return { ok: true, result: result.result };
}

/**
 * Collect a Receipt draft from host evidence (ADR-0019).
 * Does not archive the DriveTask — bank complete still requires the receipt.
 */
export async function collectReceipt(
	input: CollectReceiptInput,
): Promise<CollectReceiptResult> {
	const mismatch = assertLeaseMatchesRun(input.lease, input.run);
	if (mismatch) {
		return { ok: false, code: "lease_run_mismatch", message: mismatch };
	}
	const evidence = await input.host.collectReceiptEvidence({
		lease: input.lease,
		run: input.run,
	});
	if (evidence.evidenceRefs.length === 0) {
		return {
			ok: false,
			code: "evidence_required",
			message: "collectReceipt requires at least one evidence ref",
		};
	}
	const decision = evidence.decision ?? "accepted";
	const receipt: Receipt = {
		id: input.receiptId ?? `receipt_${input.lease.id}`,
		driveTaskId: input.lease.driveTaskId,
		driveRunId: input.lease.driveRunId,
		workItemId: input.lease.workItemId,
		decision,
		evidenceRefs: [...evidence.evidenceRefs],
		createdAt: new Date().toISOString(),
		...(evidence.decidedBy ? { decidedBy: evidence.decidedBy } : {}),
	};
	return { ok: true, receipt };
}
