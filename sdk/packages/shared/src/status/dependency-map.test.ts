import { describe, expect, it } from "vitest";
import type { TeamTask } from "../team/types";
import { buildDependencyMap } from "./dependency-map";

const task = (
	id: string,
	dependsOn: string[] = [],
	status: TeamTask["status"] = "pending",
): TeamTask => ({
	id,
	title: id,
	description: "",
	status,
	createdAt: new Date(),
	updatedAt: new Date(),
	createdBy: "lead",
	dependsOn,
});
describe("buildDependencyMap", () => {
	it("layers chains and fan-in deterministically while identifying ready work", () => {
		const map = buildDependencyMap([
			{
				teamId: "t",
				tasks: [
					task("deploy", ["api", "web"]),
					task("web"),
					task("api", ["schema"]),
					task("schema", [], "completed"),
				],
			},
		]);
		expect(map.nodes.map((n) => [n.id, n.layer])).toEqual([
			["schema", 0],
			["web", 0],
			["api", 1],
			["deploy", 2],
		]);
		expect(map.nodes.find((n) => n.id === "web")?.isReady).toBe(true);
		expect(map.nodes.find((n) => n.id === "api")?.isReady).toBe(true);
		expect(map.nodes.find((n) => n.id === "deploy")?.isWaiting).toBe(true);
	});
	it("reports missing references and direct and indirect cycles", () => {
		const map = buildDependencyMap([
			{
				teamId: "t",
				tasks: [
					task("missing", ["nope"]),
					task("a", ["b"]),
					task("b", ["c"]),
					task("c", ["a"]),
					task("self", ["self"]),
				],
			},
		]);
		expect(map.missingReferences).toEqual(["t:missing -> nope"]);
		expect(map.cycles).toHaveLength(2);
		expect(map.nodes.filter((n) => n.inCycle).map((n) => n.id)).toEqual([
			"a",
			"b",
			"c",
			"self",
		]);
		expect(map.nodes.find((n) => n.id === "missing")?.isWaiting).toBe(true);
	});
	it("derives edges from resolved dependencies in node order", () => {
		const map = buildDependencyMap([
			{
				teamId: "t",
				tasks: [
					task("deploy", ["api", "web", "nope"]),
					task("web"),
					task("api", ["web"]),
				],
			},
		]);
		expect(map.edges).toEqual([
			{ from: "t:web", to: "t:api" },
			{ from: "t:api", to: "t:deploy" },
			{ from: "t:web", to: "t:deploy" },
		]);
		expect(map.missingReferences).toEqual(["t:deploy -> nope"]);
	});
	it("leaves the projection untouched when annotations are omitted", () => {
		const teams = [{ teamId: "t", tasks: [task("api", ["web"]), task("web")] }];
		const bare = buildDependencyMap(teams);
		expect(bare.plans).toBeUndefined();
		expect(Object.keys(bare).sort()).toEqual([
			"counts",
			"cycles",
			"edges",
			"missingReferences",
			"nodes",
		]);
		for (const node of bare.nodes) {
			expect(node.planIds).toBeUndefined();
			expect(node.displayId).toBeUndefined();
			expect(Object.keys(node)).not.toContain("planIds");
			expect(Object.keys(node)).not.toContain("displayId");
		}
		expect(bare.edges.every((edge) => !("artifactLabel" in edge))).toBe(true);
		const annotated = buildDependencyMap(teams, {
			displayIds: { "t:api": "T001" },
			plans: [
				{ id: "plan-a", displayId: "P001", title: "Plan A", taskIds: ["web"] },
			],
			edgeLabels: [{ from: "web", to: "api", artifactLabel: "schema.json" }],
		});
		expect(annotated.cycles).toEqual(bare.cycles);
		expect(annotated.counts).toEqual(bare.counts);
		expect(annotated.missingReferences).toEqual(bare.missingReferences);
		expect(annotated.nodes.map((n) => [n.key, n.layer, n.isReady])).toEqual(
			bare.nodes.map((n) => [n.key, n.layer, n.isReady]),
		);
	});
	it("applies display ids, plan membership and edge labels from annotations", () => {
		const map = buildDependencyMap(
			[
				{
					teamId: "t",
					tasks: [task("api", ["web"]), task("web"), task("docs")],
				},
			],
			{
				displayIds: { "t:web": "T001", api: "T002" },
				plans: [
					{
						id: "plan-a",
						displayId: "P001",
						title: "Plan A",
						taskIds: ["web", "t:api", "ghost"],
					},
					{
						id: "plan-b",
						displayId: "P002",
						title: "Plan B",
						taskIds: ["t:api"],
					},
				],
				edgeLabels: [
					{ from: "t:web", to: "t:api", artifactLabel: "schema.json" },
				],
			},
		);
		const byId = new Map(map.nodes.map((n) => [n.id, n]));
		expect(byId.get("web")?.displayId).toBe("T001");
		expect(byId.get("api")?.displayId).toBe("T002");
		expect(byId.get("docs")?.displayId).toBeUndefined();
		expect(byId.get("web")?.planIds).toEqual(["plan-a"]);
		expect(byId.get("api")?.planIds).toEqual(["plan-a", "plan-b"]);
		expect(byId.get("docs")?.planIds).toBeUndefined();
		expect(map.plans).toEqual([
			{
				id: "plan-a",
				displayId: "P001",
				title: "Plan A",
				taskIds: ["t:web", "t:api"],
			},
			{ id: "plan-b", displayId: "P002", title: "Plan B", taskIds: ["t:api"] },
		]);
		expect(map.edges).toEqual([
			{ from: "t:web", to: "t:api", artifactLabel: "schema.json" },
		]);
	});
	it("resolves bare task ids across every team that carries them", () => {
		const map = buildDependencyMap(
			[
				{ teamId: "a", tasks: [task("build", ["plan"]), task("plan")] },
				{ teamId: "b", tasks: [task("build", ["plan"]), task("plan")] },
			],
			{
				plans: [
					{
						id: "plan-a",
						displayId: "P001",
						title: "Plan A",
						taskIds: ["build"],
					},
				],
				edgeLabels: [
					{ from: "plan", to: "build", artifactLabel: "outline.md" },
				],
			},
		);
		expect(map.plans?.[0]?.taskIds).toEqual(["a:build", "b:build"]);
		expect(map.edges).toEqual([
			{ from: "a:plan", to: "a:build", artifactLabel: "outline.md" },
			{ from: "b:plan", to: "b:build", artifactLabel: "outline.md" },
		]);
	});
	it("ignores annotations that reference unknown tasks", () => {
		const map = buildDependencyMap(
			[{ teamId: "t", tasks: [task("api", ["web"]), task("web")] }],
			{
				displayIds: { ghost: "T009" },
				plans: [
					{ id: "p", displayId: "P001", title: "Ghost", taskIds: ["ghost"] },
				],
				edgeLabels: [
					{ from: "ghost", to: "t:api", artifactLabel: "nope" },
					{ from: "t:api", to: "t:web", artifactLabel: "backwards" },
				],
			},
		);
		expect(map.plans).toEqual([
			{ id: "p", displayId: "P001", title: "Ghost", taskIds: [] },
		]);
		expect(map.nodes.every((n) => n.displayId === undefined)).toBe(true);
		expect(map.nodes.every((n) => n.planIds === undefined)).toBe(true);
		expect(map.edges).toEqual([{ from: "t:web", to: "t:api" }]);
	});
});
