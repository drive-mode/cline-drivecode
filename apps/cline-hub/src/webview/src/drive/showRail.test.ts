import { describe, expect, it } from "vitest";
import { projectShowRail } from "./showRail";

const BACKLOG = [
	{
		id: "s0",
		title: "the flash · before and after",
		artifactKind: "walkthrough.animation",
		status: "shown",
	},
	{
		id: "s1",
		title: "Fix plan · demo-polish",
		artifactKind: "doc.plan",
		status: "showing",
	},
	{
		id: "s2",
		title: "demo render pipeline",
		artifactKind: "diagram.data_flow",
		status: "ready",
	},
	{
		id: "s3",
		title: "the guard",
		artifactKind: "walkthrough.code",
		status: "planned",
	},
];

describe("projectShowRail", () => {
	it("keeps hub order and hub statuses", () => {
		expect(
			projectShowRail(BACKLOG, "s1").map((entry) => [entry.id, entry.status]),
		).toEqual([
			["s0", "shown"],
			["s1", "showing"],
			["s2", "ready"],
			["s3", "planned"],
		]);
	});

	it("labels chips with the artifact kind and keeps the title", () => {
		const [first] = projectShowRail(BACKLOG, "s1");
		expect(first?.label).toBe("walkthrough.animation");
		expect(first?.title).toBe("the flash · before and after");
	});

	it("falls back to the title, then the id, for a kindless show", () => {
		expect(projectShowRail([{ id: "s9", title: "Handoff" }])[0]).toEqual({
			id: "s9",
			label: "Handoff",
			title: "Handoff",
			status: "planned",
		});
		expect(projectShowRail([{ id: "s9" }])[0]?.label).toBe("s9");
	});

	it("lights exactly the show bound to the frame", () => {
		// Room sync lags a `drive_show_presented`: the hub still calls s1
		// showing while s2 holds the frame. One chip may read `showing`.
		const entries = projectShowRail(BACKLOG, "s2");
		expect(entries.filter((entry) => entry.status === "showing")).toEqual([
			{
				id: "s2",
				label: "diagram.data_flow",
				title: "demo render pipeline",
				status: "showing",
			},
		]);
		// The demoted show is materialised, just off screen.
		expect(entries.find((entry) => entry.id === "s1")?.status).toBe("ready");
	});

	it("trusts a hub `showing` when nothing is bound to the frame", () => {
		expect(projectShowRail(BACKLOG, null)[1]?.status).toBe("showing");
		expect(projectShowRail(BACKLOG, "   ")[1]?.status).toBe("showing");
	});

	it("drops cancelled shows — they left the queue", () => {
		expect(
			projectShowRail([
				{ id: "s1", artifactKind: "doc.plan", status: "cancelled" },
				{ id: "s2", artifactKind: "doc.review", status: "ready" },
			]).map((entry) => entry.id),
		).toEqual(["s2"]);
	});

	it("reads an unknown or missing status as planned", () => {
		expect(
			projectShowRail([
				{ id: "s1", artifactKind: "doc.plan" },
				{ id: "s2", artifactKind: "doc.review", status: "queued" },
			]).map((entry) => entry.status),
		).toEqual(["planned", "planned"]);
	});

	it("projects an empty rail from an absent backlog", () => {
		expect(projectShowRail(undefined, "s1")).toEqual([]);
		expect(projectShowRail([], null)).toEqual([]);
	});
});
