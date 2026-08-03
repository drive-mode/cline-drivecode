/**
 * Phase 0 facet catalog — durable defaults, live subMode, privacy.debugRetention.
 */

import type {
	AgentAppearance,
	DriveSubMode,
	FacetDefMeta,
	InkRef,
} from "@cline/shared";

export const DEFAULT_BODY_INK: InkRef = { kind: "token", token: "muted" };
export const DEFAULT_NAME_INK: InkRef = { kind: "palette", index: 0 };

export const DEFAULT_AGENT_APPEARANCE: AgentAppearance = {
	nameInk: DEFAULT_NAME_INK,
	bodyInk: DEFAULT_BODY_INK,
};

export const DRIVE_FACET_CATALOG = {
	"drive.defaults.subMode": {
		id: "drive.defaults.subMode",
		title: "Default Drive sub-mode",
		owner: "hub",
		scope: "user",
		lane: "durable",
		privacy: "public",
		conflict: "workspace_over_user",
		phase: 0,
		defaultValue: "plan",
	} satisfies FacetDefMeta<DriveSubMode>,

	"agent.appearance": {
		id: "agent.appearance",
		title: "Agent appearance",
		owner: "hub",
		scope: "workspace",
		lane: "durable",
		privacy: "public",
		conflict: "workspace_over_user",
		phase: 1,
		defaultValue: DEFAULT_AGENT_APPEARANCE,
	} satisfies FacetDefMeta<AgentAppearance>,

/**
	 * Live room sub-mode. Seeded from drive.defaults.subMode at room create;
	 * disk reload must never overwrite (live_wins).
	 */
	"room.live.subMode": {
		id: "room.live.subMode",
		title: "Live room sub-mode",
		owner: "hub",
		scope: "room",
		lane: "live",
		privacy: "public",
		conflict: "live_wins",
		phase: 0,
		defaultValue: "plan",
	} satisfies FacetDefMeta<DriveSubMode>,

	/**
	 * Session-scoped debug retention (DRV-PRIVACY). When true, hosts may raise
	 * local JSONL caps and keep extra debug blobs — must show a visible
	 * indicator. Never durable; never phone-home.
	 * UI chrome + raised-cap wiring are follow-on (see REMAINING §2.5).
	 */
	"privacy.debugRetention": {
		id: "privacy.debugRetention",
		title: "Debug retention",
		owner: "hub",
		scope: "session",
		lane: "live",
		privacy: "sensitive",
		conflict: "live_wins",
		phase: 0,
		defaultValue: false,
	} satisfies FacetDefMeta<boolean>,

	/**
	 * Durable local retention profile (DRV-PRIVACY). When set, hosts use these
	 * base caps unless privacy.debugRetention raises them. Never phone-home.
	 */
	"privacy.retention": {
		id: "privacy.retention",
		title: "Event log retention",
		owner: "hub",
		scope: "workspace",
		lane: "durable",
		privacy: "sensitive",
		conflict: "workspace_over_user",
		phase: 0,
		defaultValue: {
			roomMaxRecords: 2048,
			bankMaxRecords: 4096,
		},
	} satisfies FacetDefMeta<{
		roomMaxRecords: number;
		bankMaxRecords: number;
	}>,
} as const;

export type DriveFacetCatalog = typeof DRIVE_FACET_CATALOG;
export type DriveFacetKey = keyof DriveFacetCatalog;

export type DriveFacetValue<K extends DriveFacetKey> =
	DriveFacetCatalog[K]["defaultValue"];

export function listFacetDefs(filter?: {
	phase?: number;
	lane?: DriveFacetCatalog[DriveFacetKey]["lane"];
}): Array<DriveFacetCatalog[DriveFacetKey]> {
	return (Object.values(DRIVE_FACET_CATALOG) as Array<
		DriveFacetCatalog[DriveFacetKey]
	>).filter((def) => {
		if (filter?.phase !== undefined && def.phase > filter.phase) {
			return false;
		}
		if (filter?.lane !== undefined && def.lane !== filter.lane) {
			return false;
		}
		return true;
	});
}
