/**
 * Narrow DrivePlan–Kanban Interop stub (ADR-0018 §7).
 * Full wire shapes defer to ADR-0019.
 *
 * Parses at the host boundary: callers pass a typed `DriveRun` (from
 * `@cline/shared` parse helpers). This package stays type-only on shared.
 */

import type { DriveRun, DriveRunWorkItem } from "@cline/shared";

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
	supports: readonly ["getCapabilities", "applyProjection", "observe"];
	/** Full execute / collectReceipt land in ADR-0019. */
	deferred: readonly ["execute", "collectReceipt"];
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

export function getCapabilities(): KanbanInteropCapabilities {
	return {
		protocol: "driveplan-kanban-interop",
		version: 0,
		supports: ["getCapabilities", "applyProjection", "observe"],
		deferred: ["execute", "collectReceipt"],
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
