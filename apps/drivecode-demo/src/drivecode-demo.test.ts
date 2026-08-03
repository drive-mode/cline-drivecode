import { buildDependencyMap } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { readDrivecodeDemoCliBootstrap } from "./cli-env";
import { DrivePlansDemoAnnotationsSource } from "./drive-plans-demo-annotations-source";
import { DrivePlansDemoStatusSnapshotSource } from "./drive-plans-demo-status-source";
import { DrivePlansDemoTeamsSource } from "./drive-plans-demo-teams-source";
import { readDrivecodeDemoHubBootstrap } from "./hub-query";
import {
	PLAN_DEPENDENCY_DEMO_ANNOTATIONS,
	PLAN_DEPENDENCY_DEMO_TEAM,
} from "./plan-tasks-fixture";

describe("DrivePlansDemoStatusSnapshotSource", () => {
	it("load() returns non-empty board updates and plan teams", async () => {
		const source = new DrivePlansDemoStatusSnapshotSource();
		const snap = await source.load();
		expect(snap.updates.length).toBeGreaterThan(0);
		expect(snap.teams.length).toBeGreaterThan(0);
		expect(snap.summary).toBeNull();
		expect(snap.teams[0]?.tasks.length).toBeGreaterThan(0);
	});
});

describe("DrivePlansDemoTeamsSource", () => {
	it("loadTeams() returns plan dependency demo teams", async () => {
		const teams = await new DrivePlansDemoTeamsSource().loadTeams();
		expect(teams.length).toBeGreaterThan(0);
		expect(teams[0]?.tasks.length).toBeGreaterThan(0);
	});
});

describe("PLAN_DEPENDENCY_DEMO_ANNOTATIONS", () => {
	const tasks = PLAN_DEPENDENCY_DEMO_TEAM.tasks;

	it("files every demo task in exactly one plan", () => {
		const memberships = new Map<string, number>(
			tasks.map((task) => [task.id, 0]),
		);
		for (const plan of PLAN_DEPENDENCY_DEMO_ANNOTATIONS.plans ?? []) {
			for (const taskId of plan.taskIds) {
				const seen = memberships.get(taskId);
				expect(seen, `${taskId} is not a demo task`).toBeDefined();
				memberships.set(taskId, (seen ?? 0) + 1);
			}
		}

		expect([...memberships].filter(([, count]) => count !== 1)).toEqual([]);
	});

	it("mints a unique T### for every task and a P### for every plan", () => {
		const displayIds = Object.entries(
			PLAN_DEPENDENCY_DEMO_ANNOTATIONS.displayIds ?? {},
		);

		expect(displayIds).toHaveLength(tasks.length);
		expect(new Set(displayIds.map(([, id]) => id)).size).toBe(tasks.length);
		expect(displayIds.every(([, id]) => /^T\d{3,}$/.test(id))).toBe(true);
		expect(
			(PLAN_DEPENDENCY_DEMO_ANNOTATIONS.plans ?? []).every((plan) =>
				/^P\d{3,}$/.test(plan.displayId),
			),
		).toBe(true);
	});

	it("resolves against the projection: every node lands in a plan", () => {
		const graph = buildDependencyMap(
			[PLAN_DEPENDENCY_DEMO_TEAM],
			PLAN_DEPENDENCY_DEMO_ANNOTATIONS,
		);

		expect(graph.plans).toHaveLength(
			PLAN_DEPENDENCY_DEMO_ANNOTATIONS.plans?.length ?? 0,
		);
		expect(graph.nodes.every((node) => node.planIds?.length === 1)).toBe(true);
		expect(graph.nodes.every((node) => Boolean(node.displayId))).toBe(true);
	});

	it("leaves the projection unannotated when no annotations are passed", () => {
		const graph = buildDependencyMap([PLAN_DEPENDENCY_DEMO_TEAM]);

		expect(graph.plans).toBeUndefined();
		expect(graph.nodes.some((node) => node.planIds?.length)).toBe(false);
		expect(graph.nodes.some((node) => node.displayId)).toBe(false);
		expect(graph.edges.some((edge) => edge.artifactLabel)).toBe(false);
	});
});

describe("DrivePlansDemoAnnotationsSource", () => {
	it("loadAnnotations() returns the fixture's declared plans", async () => {
		const annotations =
			await new DrivePlansDemoAnnotationsSource().loadAnnotations();

		expect(annotations).toBe(PLAN_DEPENDENCY_DEMO_ANNOTATIONS);
	});
});

describe("readDrivecodeDemoCliBootstrap", () => {
	it("defaults to demos off when env is empty", () => {
		const boot = readDrivecodeDemoCliBootstrap({});
		expect(boot).toEqual({
			useDemoStatusAdapter: false,
			statusInitialLens: undefined,
			autoOpenStatus: false,
			driveActiveOnStart: false,
		});
	});

	it("parses CLI demo env flags", () => {
		const boot = readDrivecodeDemoCliBootstrap({
			CLINE_DEMO_STATUS_PLANS: "1",
			CLINE_DEMO_STATUS_LENS: "dependency-map",
			CLINE_DEMO_OPEN_STATUS: "1",
			CLINE_DEMO_DRIVE: "1",
		});
		expect(boot).toEqual({
			useDemoStatusAdapter: true,
			statusInitialLens: "dependency-map",
			autoOpenStatus: true,
			driveActiveOnStart: true,
		});
	});

	it("ignores unknown status lens values", () => {
		const boot = readDrivecodeDemoCliBootstrap({
			CLINE_DEMO_STATUS_LENS: "changelog",
		});
		expect(boot.statusInitialLens).toBeUndefined();
	});
});

describe("readDrivecodeDemoHubBootstrap", () => {
	it("defaults to demos off when search is empty", () => {
		expect(readDrivecodeDemoHubBootstrap()).toEqual({
			useDemoTeamsAdapter: false,
			useDemoSessionsAdapter: false,
			useShareScreenSpotlightDemo: false,
			useChatForkDemo: false,
			initialStatusMode: undefined,
			openAnalytics: false,
		});
	});

	it("parses demoPlans and statusMode from a query string", () => {
		const boot = readDrivecodeDemoHubBootstrap(
			"?demoPlans=1&demoShareScreen=1&demoChatFork=1&statusMode=dependency-map",
		);
		expect(boot).toEqual({
			useDemoTeamsAdapter: true,
			useDemoSessionsAdapter: false,
			useShareScreenSpotlightDemo: true,
			useChatForkDemo: true,
			initialStatusMode: "dependency-map",
			openAnalytics: false,
		});
	});

	it("parses demoSessions and maps legacy sessions statusMode to Analytics", () => {
		const boot = readDrivecodeDemoHubBootstrap(
			"?demoSessions=1&statusMode=sessions",
		);
		expect(boot.useDemoSessionsAdapter).toBe(true);
		expect(boot.initialStatusMode).toBeUndefined();
		expect(boot.openAnalytics).toBe(true);
	});

	it("accepts URLSearchParams and board/changelog modes", () => {
		const params = new URLSearchParams({
			demoPlans: "1",
			statusMode: "changelog",
		});
		expect(readDrivecodeDemoHubBootstrap(params)).toEqual({
			useDemoTeamsAdapter: true,
			useDemoSessionsAdapter: false,
			useShareScreenSpotlightDemo: false,
			useChatForkDemo: false,
			initialStatusMode: "changelog",
			openAnalytics: false,
		});
	});

	it("opens Analytics via analytics=1", () => {
		expect(readDrivecodeDemoHubBootstrap("?analytics=1").openAnalytics).toBe(
			true,
		);
	});

	it("ignores unknown statusMode values", () => {
		expect(
			readDrivecodeDemoHubBootstrap("demoPlans=0&statusMode=nope")
				.initialStatusMode,
		).toBeUndefined();
	});
});
