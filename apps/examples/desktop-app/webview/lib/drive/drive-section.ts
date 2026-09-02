/**
 * Drive sections — the navigation vocabulary shared by the sidebar, the
 * `DriveView` shell, and the window title.
 *
 * Kept free of hub state on purpose: `desktop-app-state.ts` type-imports
 * `DriveSection` for the navigation location, and the sidebar reads
 * `DRIVE_SECTIONS` while the Drive view itself is still a lazy chunk.
 */

import {
	Activity,
	Bot,
	ChartColumn,
	DoorOpen,
	Images,
	ListChecks,
	type LucideIcon,
	PhoneCall,
	SlidersHorizontal,
} from "lucide-react";
import type { ComponentType } from "react";
import { DriveMarkIcon } from "@/components/icons/drive-mark";

export const DRIVE_SECTION_IDS = [
	"lobby",
	"call",
	"rooms",
	"artifacts",
	"tasks",
	"status",
	"analytics",
	"agents",
	"settings",
] as const;

export type DriveSection = (typeof DRIVE_SECTION_IDS)[number];

export const DEFAULT_DRIVE_SECTION: DriveSection = "lobby";

/** Sidebar icons are either a lucide glyph or the Drive mark itself. */
export type DriveSectionIcon =
	| LucideIcon
	| ComponentType<{ className?: string }>;

export type DriveSectionDefinition = {
	id: DriveSection;
	label: string;
	description: string;
	icon: DriveSectionIcon;
};

/** Ordered navigation list. Order is the sidebar order. */
export const DRIVE_SECTIONS: readonly DriveSectionDefinition[] = [
	{
		id: "lobby",
		label: "Lobby",
		description: "Join or continue a call with your agents.",
		icon: DriveMarkIcon,
	},
	{
		id: "call",
		label: "Call",
		description: "Stay on the call and watch the Spotlight.",
		icon: PhoneCall,
	},
	{
		id: "rooms",
		label: "Rooms",
		description: "Every room this workspace has opened, live or resumable.",
		icon: DoorOpen,
	},
	{
		id: "artifacts",
		label: "Artifacts",
		description: "Diagrams, walkthroughs and captures agents presented.",
		icon: Images,
	},
	{
		id: "tasks",
		label: "Tasks",
		description: "Plans, task graphs and the dependency map.",
		icon: ListChecks,
	},
	{
		id: "status",
		label: "Status Hub",
		description: "What every agent is doing right now, without a transcript.",
		icon: Activity,
	},
	{
		id: "analytics",
		label: "Analytics",
		description: "Session rollups and the shipped digest.",
		icon: ChartColumn,
	},
	{
		id: "agents",
		label: "Agents",
		description: "The agents you can seat, their homes and appearance.",
		icon: Bot,
	},
	{
		id: "settings",
		label: "Drive Settings",
		description: "Voice, captions, motion and wire diagnostics.",
		icon: SlidersHorizontal,
	},
];

const SECTION_BY_ID: ReadonlyMap<DriveSection, DriveSectionDefinition> =
	new Map(DRIVE_SECTIONS.map((section) => [section.id, section]));

export function isDriveSection(value: unknown): value is DriveSection {
	return (
		typeof value === "string" &&
		(DRIVE_SECTION_IDS as readonly string[]).includes(value)
	);
}

/** Tolerant parse for query strings and stored state; unknown → lobby. */
export function parseDriveSection(value: unknown): DriveSection {
	if (typeof value !== "string") {
		return DEFAULT_DRIVE_SECTION;
	}
	const normalized = value.trim().toLowerCase();
	return isDriveSection(normalized) ? normalized : DEFAULT_DRIVE_SECTION;
}

export function driveSectionDefinition(
	section: DriveSection,
): DriveSectionDefinition {
	const definition = SECTION_BY_ID.get(section);
	if (!definition) {
		// Unreachable for a well-typed caller; keep the shell honest anyway.
		return DRIVE_SECTIONS[0];
	}
	return definition;
}

export function driveSectionTitle(section: DriveSection): string {
	return driveSectionDefinition(section).label;
}

/** Window / document title while a Drive section is on screen. */
export function driveWindowTitle(section: DriveSection): string {
	return `Drive · ${driveSectionTitle(section)}`;
}
