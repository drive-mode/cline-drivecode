import { describe, expect, it } from "vitest";
import { isProjectMapSnapshot, type ProjectMap } from "./projectMap";

const project: ProjectMap = {
	schemaVersion: 1,
	id: "golden-path",
	title: "Golden path",
	lanes: [
		{ id: "now", title: "Now", order: 0 },
		{ id: "next", title: "Next", order: 1 },
	],
	items: [
		{
			id: "drv-a",
			displayId: "GP0",
			title: "Foundation",
			status: "active_partial",
			laneId: "now",
			dependsOn: [],
			owner: "Platform",
			systems: ["data", "software"],
			acceptance: "The contract passes.",
		},
		{
			id: "drv-b",
			displayId: "GP1",
			title: "Client",
			status: "planned",
			laneId: "next",
			dependsOn: ["drv-a"],
			owner: "Client",
			systems: ["people", "networks"],
			acceptance: "The client reconnects.",
		},
	],
};

describe("ProjectMap", () => {
	it("guards available and unavailable snapshots", () => {
		expect(isProjectMapSnapshot({ availability: "available", project })).toBe(
			true,
		);
		expect(
			isProjectMapSnapshot({
				availability: "unavailable",
				reason: "registry_missing",
			}),
		).toBe(true);
		expect(
			isProjectMapSnapshot({ availability: "unavailable", reason: "/tmp/x" }),
		).toBe(false);
	});

	it("rejects malformed item status without coercing it to task lifecycle", () => {
		expect(
			isProjectMapSnapshot({
				availability: "available",
				project: {
					...project,
					items: [{ ...project.items[0], status: "completed" }],
				},
			}),
		).toBe(false);
	});
});
