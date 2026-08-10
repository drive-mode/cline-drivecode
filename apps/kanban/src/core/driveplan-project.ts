/**
 * DrivePlan → Kanban projection host (ADR-0018 §7).
 *
 * The card shape is Drive's, not ours: `applyProjection` is imported from
 * `@cline/drive` rather than reimplemented here.
 *
 * This file used to carry a copy, on the rationale that Kanban should not
 * take a package dependency on Drive. That was true when Kanban was a
 * separate repository consuming `@cline/*` from npm; in the monorepo Drive is
 * a workspace sibling and the copy bought nothing but drift — and it had
 * already drifted twice by the time it was replaced:
 *
 *   - `startInPlanMode` was `true` here and `false` in Drive, so every
 *     projected card opened in the wrong mode.
 *   - the prompt omitted the `Evidence:` line entirely, so a work item's
 *     evidence requirements never reached the agent expected to satisfy
 *     them — the card said what to do and silently dropped what to prove.
 *
 * Neither would fail a test on either side, because each side tested its own
 * copy. Importing the real function is what makes that class of divergence
 * impossible rather than merely unlikely.
 */

import { applyProjection, type ProjectedKanbanCard } from "@cline/drive";
import type { DriveRun } from "@cline/shared";

import type { RuntimeBoardColumnId, RuntimeBoardData } from "./api-contract";
import { isDriveplanManagedCard } from "./api-contract";
import { addTaskToColumn } from "./task-board-mutations";

export type { ProjectedKanbanCard };

/**
 * The run shape the projection needs.
 *
 * Aliased to Drive's own type so a change there surfaces here as a type
 * error rather than as cards that quietly stop matching the run.
 */
export type DriveRunProjection = DriveRun;

export type ProjectDriveRunToBoardResult = {
	board: RuntimeBoardData;
	created: Array<{ columnId: RuntimeBoardColumnId; taskId: string }>;
};

/**
 * Apply a DriveRun projection onto a board (one card per work item).
 * Skips cards whose externalRef already exists on the board.
 */
export function projectDriveRunToBoard(
	board: RuntimeBoardData,
	run: DriveRunProjection,
	baseRef: string,
	randomUuid: () => string,
	now: number = Date.now(),
): ProjectDriveRunToBoardResult {
	const projection = applyProjection(run);
	const existingRefs = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (!isDriveplanManagedCard(card) || !card.externalRef) {
				continue;
			}
			const key = [
				card.externalRef.driveTaskId,
				card.externalRef.driveRunId,
				card.externalRef.workItemId ?? "",
			].join(":");
			existingRefs.add(key);
		}
	}

	let next = board;
	const created: ProjectDriveRunToBoardResult["created"] = [];

	for (const card of projection.cards) {
		const key = [
			card.externalRef.driveTaskId,
			card.externalRef.driveRunId,
			card.externalRef.workItemId ?? "",
		].join(":");
		if (existingRefs.has(key)) {
			continue;
		}
		// Drive's `columnHint` is backlog | in_progress | review — trash is
		// deliberately not projectable, because discarding a work item is a
		// Drive-side decision, not something a projection can express. The
		// guard that used to map trash onto backlog here was unreachable, and
		// switching to Drive's own type is what proved it.
		const columnId: RuntimeBoardColumnId = card.columnHint;
		const result = addTaskToColumn(
			next,
			columnId,
			{
				title: card.title,
				prompt: card.prompt,
				startInPlanMode: card.startInPlanMode,
				autoReviewEnabled: true, // forced false by managed ref
				baseRef,
				externalRef: card.externalRef,
			},
			randomUuid,
			now,
		);
		next = result.board;
		created.push({ columnId, taskId: result.task.id });
		existingRefs.add(key);
	}

	return { board: next, created };
}
