import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
	ProjectMap,
	ProjectMapItem,
	ProjectMapItemStatus,
	ProjectMapSnapshot,
	ProjectMapSystem,
} from "@cline/shared";
import { PROJECT_MAP_SYSTEMS } from "@cline/shared";
import YAML from "yaml";

export const PROJECT_MAP_REGISTRY_PATH = join(
	"docs",
	"drivecode",
	"plans",
	"cline-drivemode",
	"delivery",
	"claims-registry.yaml",
);

const LANE_ORDER = ["now", "next", "release"] as const;
const LANE_TITLES: Record<(typeof LANE_ORDER)[number], string> = {
	now: "Now",
	next: "Next",
	release: "Release",
};
const STATUS_VALUES = new Set<ProjectMapItemStatus>([
	"scaffold",
	"active_partial",
	"verified_shipped",
	"blocked",
	"planned",
]);
const SYSTEM_VALUES = new Set<string>(PROJECT_MAP_SYSTEMS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		return null;
	}
	return value.map((item) => item.trim());
}

function compileProjectMap(raw: unknown): ProjectMap | null {
	if (!isRecord(raw) || !Array.isArray(raw.claims)) return null;
	const items: ProjectMapItem[] = [];
	for (const claim of raw.claims) {
		if (!isRecord(claim) || claim.displayId === undefined) continue;
		const dependsOn = stringArray(claim.dependsOn);
		const systems = stringArray(claim.systems);
		if (
			typeof claim.id !== "string" ||
			typeof claim.displayId !== "string" ||
			!/^GP[0-9]$/.test(claim.displayId) ||
			typeof claim.title !== "string" ||
			typeof claim.status !== "string" ||
			!STATUS_VALUES.has(claim.status as ProjectMapItemStatus) ||
			typeof claim.lane !== "string" ||
			!LANE_ORDER.includes(claim.lane as (typeof LANE_ORDER)[number]) ||
			!dependsOn ||
			dependsOn.some((id) => !id) ||
			new Set(dependsOn).size !== dependsOn.length ||
			typeof claim.owner !== "string" ||
			!claim.owner.trim() ||
			!systems ||
			systems.length === 0 ||
			systems.some((system) => !SYSTEM_VALUES.has(system)) ||
			new Set(systems).size !== systems.length ||
			typeof claim.acceptance !== "string" ||
			!claim.acceptance.trim()
		) {
			return null;
		}
		items.push({
			id: claim.id,
			displayId: claim.displayId,
			title: claim.title,
			status: claim.status as ProjectMapItemStatus,
			laneId: claim.lane,
			dependsOn,
			owner: claim.owner.trim(),
			systems: systems as ProjectMapSystem[],
			acceptance: claim.acceptance.trim(),
		});
	}
	if (items.length === 0) return null;
	const byId = new Map(items.map((item) => [item.id, item]));
	if (byId.size !== items.length) return null;
	if (new Set(items.map((item) => item.displayId)).size !== items.length) {
		return null;
	}
	for (const item of items) {
		const itemLane = LANE_ORDER.indexOf(
			item.laneId as (typeof LANE_ORDER)[number],
		);
		for (const dependencyId of item.dependsOn) {
			const dependency = byId.get(dependencyId);
			if (!dependency) return null;
			const dependencyLane = LANE_ORDER.indexOf(
				dependency.laneId as (typeof LANE_ORDER)[number],
			);
			if (dependencyLane > itemLane) return null;
		}
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (item: ProjectMapItem): boolean => {
		if (visiting.has(item.id)) return false;
		if (visited.has(item.id)) return true;
		visiting.add(item.id);
		for (const dependencyId of item.dependsOn) {
			const dependency = byId.get(dependencyId);
			if (!dependency || !visit(dependency)) return false;
		}
		visiting.delete(item.id);
		visited.add(item.id);
		return true;
	};
	if (!items.every(visit)) return null;

	items.sort(
		(a, b) =>
			Number(a.displayId.slice(2)) - Number(b.displayId.slice(2)) ||
			a.id.localeCompare(b.id),
	);
	return {
		schemaVersion: 1,
		id: "drive-golden-path",
		title: "Drive golden path",
		lanes: LANE_ORDER.map((id, order) => ({
			id,
			title: LANE_TITLES[id],
			order,
		})),
		items,
	};
}

function isWithinRoot(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Read the one allowlisted registry below a caller-selected workspace root.
 * Results never include the root, registry path, parser errors, or evidence
 * paths from claims, keeping this read surface safe to forward to a browser.
 */
export async function readProjectMapSnapshot(
	workspaceRoot: string,
): Promise<ProjectMapSnapshot> {
	if (!workspaceRoot.trim()) {
		return { availability: "unavailable", reason: "workspace_unset" };
	}
	let root: string;
	try {
		root = await realpath(resolve(workspaceRoot));
		if (!(await stat(root)).isDirectory()) {
			return { availability: "unavailable", reason: "registry_unreadable" };
		}
	} catch {
		return { availability: "unavailable", reason: "registry_unreadable" };
	}

	const candidate = join(root, PROJECT_MAP_REGISTRY_PATH);
	let registryPath: string;
	try {
		registryPath = await realpath(candidate);
	} catch (error) {
		return {
			availability: "unavailable",
			reason:
				isRecord(error) && error.code === "ENOENT"
					? "registry_missing"
					: "registry_unreadable",
		};
	}
	if (!isWithinRoot(root, registryPath)) {
		return { availability: "unavailable", reason: "registry_unreadable" };
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(await readFile(registryPath, "utf8"));
	} catch {
		return { availability: "unavailable", reason: "registry_invalid" };
	}
	const project = compileProjectMap(parsed);
	return project
		? { availability: "available", project }
		: { availability: "unavailable", reason: "registry_invalid" };
}
