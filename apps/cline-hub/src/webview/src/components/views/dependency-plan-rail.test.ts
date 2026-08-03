import { describe, expect, it } from "vitest";
import type { DependencyPlan } from "./dependency-map-model";
import {
	nodeAccentClass,
	PLAN_ACCENT_CLASSES,
	planEmphasis,
	planRailRows,
	resolveActivePlanId,
	togglePlanFilter,
} from "./dependency-plan-rail";

const plan = (
	id: string,
	title: string,
	taskIds: string[],
): DependencyPlan => ({ id, displayId: id, title, taskIds });

describe("planRailRows", () => {
	it("returns no rows when the projection carried no plans", () => {
		expect(planRailRows(undefined)).toEqual([]);
		expect(planRailRows([])).toEqual([]);
	});

	it("keeps declaration order and counts members", () => {
		const rows = planRailRows([
			plan("P001", "Kernel", ["t:a", "t:b"]),
			plan("P002", "Voice", ["t:c"]),
		]);

		expect(rows.map((row) => row.id)).toEqual(["P001", "P002"]);
		expect(rows.map((row) => row.taskCount)).toEqual([2, 1]);
		expect(rows[0]?.accentClass).not.toBe(rows[1]?.accentClass);
	});

	it("cycles the palette rather than running out of accents", () => {
		const rows = planRailRows(
			Array.from({ length: PLAN_ACCENT_CLASSES.length + 1 }, (_, index) =>
				plan(`P${index}`, `Plan ${index}`, []),
			),
		);

		expect(rows.at(-1)?.accentClass).toBe(rows[0]?.accentClass);
		expect(rows.every((row) => row.accentClass.length > 0)).toBe(true);
	});
});

describe("nodeAccentClass", () => {
	const rows = planRailRows([
		plan("P001", "Kernel", []),
		plan("P002", "Voice", []),
	]);

	it("gives no accent when nothing declared plans", () => {
		expect(nodeAccentClass(undefined, rows, null)).toBeUndefined();
		expect(nodeAccentClass([], rows, null)).toBeUndefined();
		expect(nodeAccentClass(["P001"], [], null)).toBeUndefined();
	});

	it("gives no accent to a task in no listed plan", () => {
		expect(nodeAccentClass(["P999"], rows, null)).toBeUndefined();
	});

	it("prefers rail order over the order memberships were appended", () => {
		expect(nodeAccentClass(["P002", "P001"], rows, null)).toBe(
			rows[0]?.accentClass,
		);
	});

	it("prefers the filtered plan when the task belongs to it", () => {
		expect(nodeAccentClass(["P001", "P002"], rows, "P002")).toBe(
			rows[1]?.accentClass,
		);
	});

	it("falls back to rail order when the task is outside the filter", () => {
		expect(nodeAccentClass(["P001"], rows, "P002")).toBe(rows[0]?.accentClass);
	});
});

describe("planEmphasis", () => {
	it("leaves every task at full strength with no filter", () => {
		expect(planEmphasis(["P001"], null)).toBe("none");
		expect(planEmphasis(undefined, null)).toBe("none");
	});

	it("separates members from everything else once filtered", () => {
		expect(planEmphasis(["P001"], "P001")).toBe("match");
		expect(planEmphasis(["P002"], "P001")).toBe("dim");
		expect(planEmphasis(undefined, "P001")).toBe("dim");
	});
});

describe("togglePlanFilter", () => {
	it("selects, replaces, and clears", () => {
		expect(togglePlanFilter(null, "P001")).toBe("P001");
		expect(togglePlanFilter("P001", "P002")).toBe("P002");
		expect(togglePlanFilter("P001", "P001")).toBeNull();
	});
});

describe("resolveActivePlanId", () => {
	const rows = planRailRows([plan("P001", "Kernel", [])]);

	it("keeps a filter the rail still offers", () => {
		expect(resolveActivePlanId(rows, "P001")).toBe("P001");
		expect(resolveActivePlanId(rows, null)).toBeNull();
	});

	it("drops a filter whose plan left the rail", () => {
		expect(resolveActivePlanId(rows, "P002")).toBeNull();
		expect(resolveActivePlanId([], "P001")).toBeNull();
	});
});
