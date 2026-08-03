/**
 * Plans rail — the pure half.
 *
 * Every decision the rail and the plan accents make lives here rather than in
 * `dependency-map.tsx`, because the hub suite is node-only and excludes
 * `.tsx`: logic left in the component could not be tested at all.
 *
 * Nothing in this module derives plan membership. It only arranges what the
 * projection was handed — `DependencyMap.plans`, and the `planIds` the
 * projection echoed onto each node. No plans in, no rows out.
 */

import type { DependencyPlan } from "./dependency-map-model";

/**
 * Categorical accents for plans, deliberately clear of the status inks the
 * nodes already use (emerald completed, amber blocked, primary in progress) so
 * a plan colour can never be misread as a state.
 */
export const PLAN_ACCENT_CLASSES = [
	"bg-sky-500",
	"bg-violet-500",
	"bg-teal-500",
	"bg-rose-500",
	"bg-indigo-500",
	"bg-orange-500",
] as const;

export type PlanRailRow = {
	id: string;
	displayId: string;
	title: string;
	taskCount: number;
	accentClass: string;
};

/**
 * One row per plan, in the order the annotation source declared them, with a
 * stable accent. Rail order is the authority for accent assignment, so a plan
 * keeps its colour however a node happens to list its memberships.
 */
export function planRailRows(
	plans: readonly DependencyPlan[] | undefined,
): PlanRailRow[] {
	return (plans ?? []).map((plan, index) => ({
		id: plan.id,
		displayId: plan.displayId,
		title: plan.title,
		taskCount: plan.taskIds.length,
		accentClass:
			PLAN_ACCENT_CLASSES[index % PLAN_ACCENT_CLASSES.length] ??
			PLAN_ACCENT_CLASSES[0],
	}));
}

/**
 * The accent a node wears: the filtered plan when the node belongs to it,
 * otherwise the node's first membership *in rail order*.
 *
 * Ordering by the rail rather than by `planIds` is what stops a node changing
 * colour because the projection appended memberships in a different order on
 * the next snapshot. A node in no listed plan gets no accent — it is not
 * assigned a fallback colour, because "no plan" is a real answer.
 */
export function nodeAccentClass(
	planIds: readonly string[] | undefined,
	rows: readonly PlanRailRow[],
	activePlanId: string | null,
): string | undefined {
	if (!planIds?.length || !rows.length) return undefined;
	const memberships = new Set(planIds);
	if (activePlanId && memberships.has(activePlanId)) {
		return rows.find((row) => row.id === activePlanId)?.accentClass;
	}
	return rows.find((row) => memberships.has(row.id))?.accentClass;
}

/**
 * How a node reads under the current plan filter. `none` is the unfiltered
 * case — every node stays at full strength, which is also what an empty rail
 * leaves behind.
 */
export type PlanEmphasis = "none" | "match" | "dim";

export function planEmphasis(
	planIds: readonly string[] | undefined,
	activePlanId: string | null,
): PlanEmphasis {
	if (!activePlanId) return "none";
	return planIds?.includes(activePlanId) ? "match" : "dim";
}

/**
 * Click-to-toggle: the same plan clears the filter, a different one replaces
 * it. Multi-select is an explicit "optional" in the UX and buys nothing until
 * someone asks for a union.
 */
export function togglePlanFilter(
	activePlanId: string | null,
	planId: string,
): string | null {
	return activePlanId === planId ? null : planId;
}

/**
 * The filter, dropped if the plan it names is gone. Plans arrive from a source
 * that can change under a live snapshot, and a filter pointing at a plan no
 * longer on the rail would dim every node with no visible way to clear it.
 */
export function resolveActivePlanId(
	rows: readonly PlanRailRow[],
	activePlanId: string | null,
): string | null {
	if (!activePlanId) return null;
	return rows.some((row) => row.id === activePlanId) ? activePlanId : null;
}
