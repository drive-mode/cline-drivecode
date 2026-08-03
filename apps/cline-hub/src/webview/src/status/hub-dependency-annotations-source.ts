import type { DependencyMapAnnotations } from "@cline/shared";
import type { DependencyAnnotationsSource } from "./dependency-annotations-source";

/**
 * Live hub adapter — always `null`, on purpose.
 *
 * There is no source to read yet. `TeamTask` carries no plan membership and no
 * artifact reference, and the only transport this lens has
 * (`status_tasks_snapshot`) returns teams. The task bank (DRV-TASK-BANK) is
 * where minted ids and `DrivePlan.taskIds` will come from; until it reaches
 * this lens, "no annotations" is the true answer.
 *
 * The alternative — grouping tasks by a prefix of their title or by the phase
 * written into a description — would put plan membership on screen that no
 * part of the product actually holds. A rail that is honestly empty is worth
 * more than one that is confidently wrong.
 */
export class HubDependencyAnnotationsSource
	implements DependencyAnnotationsSource
{
	loadAnnotations(): Promise<DependencyMapAnnotations | null> {
		return Promise.resolve(null);
	}
}
