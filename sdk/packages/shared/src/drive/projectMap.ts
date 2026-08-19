export const PROJECT_MAP_SYSTEMS = [
	"people",
	"data",
	"hardware",
	"software",
	"processes",
	"networks",
] as const;

export type ProjectMapSystem = (typeof PROJECT_MAP_SYSTEMS)[number];

export type ProjectMapItemStatus =
	| "scaffold"
	| "active_partial"
	| "verified_shipped"
	| "blocked"
	| "planned";

export type ProjectMapLane = {
	id: string;
	title: string;
	order: number;
};

export type ProjectMapItem = {
	id: string;
	displayId: string;
	title: string;
	status: ProjectMapItemStatus;
	laneId: string;
	dependsOn: string[];
	owner: string;
	systems: ProjectMapSystem[];
	acceptance: string;
};

/**
 * Read-only project structure. It is deliberately not DriveTask/DrivePlan:
 * this model can project a delivery registry without becoming a second task
 * lifecycle or a write API.
 */
export type ProjectMap = {
	schemaVersion: 1;
	id: string;
	title: string;
	lanes: ProjectMapLane[];
	items: ProjectMapItem[];
};

export type ProjectMapUnavailableReason =
	| "workspace_unset"
	| "registry_missing"
	| "registry_unreadable"
	| "registry_invalid";

export type ProjectMapSnapshot =
	| { availability: "available"; project: ProjectMap }
	| {
			availability: "unavailable";
			reason: ProjectMapUnavailableReason;
	  };

const SYSTEM_VALUES = new Set<string>(PROJECT_MAP_SYSTEMS);
const ITEM_STATUS_VALUES = new Set<ProjectMapItemStatus>([
	"scaffold",
	"active_partial",
	"verified_shipped",
	"blocked",
	"planned",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

export function isProjectMap(value: unknown): value is ProjectMap {
	if (!isRecord(value) || value.schemaVersion !== 1) return false;
	if (
		typeof value.id !== "string" ||
		typeof value.title !== "string" ||
		!Array.isArray(value.lanes) ||
		!Array.isArray(value.items)
	) {
		return false;
	}
	const lanesValid = value.lanes.every(
		(lane) =>
			isRecord(lane) &&
			typeof lane.id === "string" &&
			typeof lane.title === "string" &&
			Number.isInteger(lane.order),
	);
	if (!lanesValid) return false;
	return value.items.every((item) => {
		if (!isRecord(item)) return false;
		return (
			typeof item.id === "string" &&
			typeof item.displayId === "string" &&
			typeof item.title === "string" &&
			typeof item.status === "string" &&
			ITEM_STATUS_VALUES.has(item.status as ProjectMapItemStatus) &&
			typeof item.laneId === "string" &&
			isStringArray(item.dependsOn) &&
			typeof item.owner === "string" &&
			Array.isArray(item.systems) &&
			item.systems.every(
				(system) => typeof system === "string" && SYSTEM_VALUES.has(system),
			) &&
			typeof item.acceptance === "string"
		);
	});
}

export function isProjectMapSnapshot(
	value: unknown,
): value is ProjectMapSnapshot {
	if (!isRecord(value)) return false;
	if (value.availability === "available") return isProjectMap(value.project);
	return (
		value.availability === "unavailable" &&
		(value.reason === "workspace_unset" ||
			value.reason === "registry_missing" ||
			value.reason === "registry_unreadable" ||
			value.reason === "registry_invalid")
	);
}
