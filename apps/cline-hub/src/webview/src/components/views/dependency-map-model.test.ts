import type { TeamTask } from "@cline/shared";
import { buildDependencyMap } from "@cline/shared";
import { describe, expect, it } from "vitest";

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

describe("buildDependencyMap (hub re-export)", () => {
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
});
