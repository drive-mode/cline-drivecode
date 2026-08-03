import type { DependencyMapAnnotations } from "@cline/shared";
import { PLAN_DEPENDENCY_DEMO_ANNOTATIONS } from "./plan-tasks-fixture";

/**
 * Demo annotations source for the Tasks page Plans rail.
 * Does not read env or query — wire via composition-root bootstrap helpers.
 */
export class DrivePlansDemoAnnotationsSource {
	loadAnnotations(): Promise<DependencyMapAnnotations | null> {
		return Promise.resolve(PLAN_DEPENDENCY_DEMO_ANNOTATIONS);
	}
}
