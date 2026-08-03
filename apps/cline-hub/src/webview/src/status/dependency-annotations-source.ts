import type { DependencyMapAnnotations } from "@cline/shared";

/**
 * Port for the dependency map's optional annotations — plan groups, minted
 * `T###`/`P###` display ids, and artifact edge labels.
 *
 * Deliberately separate from `StatusTeamsSource` rather than a second method
 * on it. Teams are the projection's required input and every deployment has
 * them; annotations are structure the team runtime does not carry at all
 * (`TeamTask` has no plan or artifact field, and `status_tasks_snapshot`
 * transports `TeamRuntimeState[]` and nothing else). Widening the teams port
 * would have forced every implementation to answer a question none of them
 * can, which is how a rail ends up inventing plan membership.
 */
export interface DependencyAnnotationsSource {
	/**
	 * `null` means "this deployment has no annotation source". It is the
	 * ordinary answer, not an error: the rail renders its empty state and the
	 * graph is unaffected.
	 */
	loadAnnotations(): Promise<DependencyMapAnnotations | null>;
}
