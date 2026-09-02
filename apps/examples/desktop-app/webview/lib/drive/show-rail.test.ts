import { describe, expect, it } from "vitest";
import {
	projectShowRail,
	type ShowRailSource,
	selectShowRailCursor,
	summarizeShowRail,
} from "./show-rail";

const backlog: ShowRailSource[] = [
	{
		id: "show-retry-path",
		title: "Retry path · pending flag",
		artifactKind: "diagram.architecture",
		status: "ready",
		ownerParticipantId: "drive:partner",
	},
	{
		id: "show-plan",
		title: "Router fix plan",
		artifactKind: "doc.plan",
		status: "ready",
	},
	{
		id: "show-review",
		title: "Review · retry once",
		artifactKind: "doc.review",
		status: "planned",
	},
	{
		id: "show-cancelled",
		title: "Dropped",
		artifactKind: "doc.review",
		status: "cancelled",
	},
];

describe("projectShowRail", () => {
	it("keeps hub order, drops cancelled shows and labels by artifact kind", () => {
		const rail = projectShowRail(backlog);
		expect(rail.map((entry) => entry.id)).toEqual([
			"show-retry-path",
			"show-plan",
			"show-review",
		]);
		expect(rail[0]?.label).toBe("diagram.architecture");
		expect(rail[0]?.title).toBe("Retry path · pending flag");
		expect(rail[0]?.ownerParticipantId).toBe("drive:partner");
		expect(rail[1]?.ownerParticipantId).toBeNull();
	});

	it("lights exactly the frame-bound show as showing", () => {
		const rail = projectShowRail(
			backlog.map((item) =>
				item.id === "show-plan" ? { ...item, status: "showing" } : item,
			),
			"show-retry-path",
		);
		expect(rail.map((entry) => entry.status)).toEqual([
			"showing",
			"ready",
			"planned",
		]);
	});

	it("reads an unknown or missing status as planned", () => {
		const rail = projectShowRail([{ id: "a", status: "weird" }, { id: "b" }]);
		expect(rail.map((entry) => entry.status)).toEqual(["planned", "planned"]);
		expect(rail[1]?.label).toBe("b");
	});

	it("trusts the hub's showing status when nothing else holds the frame", () => {
		const rail = projectShowRail(
			[
				{ id: "a", status: "showing" },
				{ id: "b", status: "shown" },
			],
			null,
		);
		expect(rail.map((entry) => entry.status)).toEqual(["showing", "shown"]);
	});

	it("returns nothing for an empty backlog", () => {
		expect(projectShowRail(undefined)).toEqual([]);
	});
});

describe("selectShowRailCursor", () => {
	it("picks the showing chip as now and the next unshown chip in order", () => {
		const cursor = selectShowRailCursor(projectShowRail(backlog, "show-plan"));
		expect(cursor.now?.id).toBe("show-plan");
		expect(cursor.next?.id).toBe("show-review");
	});

	it("wraps to the head of the queue when the last show is on screen", () => {
		const cursor = selectShowRailCursor(
			projectShowRail(
				[
					{ id: "a", status: "shown" },
					{ id: "b", status: "ready" },
					{ id: "c", status: "planned" },
				],
				"c",
			),
		);
		expect(cursor.now?.id).toBe("c");
		expect(cursor.next?.id).toBe("b");
	});

	it("has no now before anything is presented, and next is the first upcoming", () => {
		const cursor = selectShowRailCursor(projectShowRail(backlog));
		expect(cursor.now).toBeNull();
		expect(cursor.next?.id).toBe("show-retry-path");
	});

	it("has no next when everything is shown", () => {
		const cursor = selectShowRailCursor(
			projectShowRail(
				[
					{ id: "a", status: "shown" },
					{ id: "b", status: "shown" },
				],
				"b",
			),
		);
		expect(cursor.now?.id).toBe("b");
		expect(cursor.next).toBeNull();
	});
});

describe("summarizeShowRail", () => {
	it("counts chips per state", () => {
		expect(summarizeShowRail(projectShowRail(backlog, "show-plan"))).toEqual({
			planned: 1,
			ready: 1,
			showing: 1,
			shown: 0,
		});
	});
});
