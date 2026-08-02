/**
 * Show-backlog rail projection — the director's queue as four chip states.
 *
 * `room.director.showBacklog` is hub-authored and already broadcast into
 * `useDriveSession`; the rail renders what the hub says rather than tracking
 * its own queue. The single derivation is `showing`: the show bound to the
 * frame wins over a backlog `status`, so a room sync landing after
 * `drive_show_presented` can never light two chips at once.
 */

/** Rail states from the initiative brief. `cancelled` items leave the queue. */
export type ShowRailStatus = "planned" | "ready" | "showing" | "shown";

/** Structural slice of the hub `ShowBacklogItem` the rail reads. */
export type ShowRailSource = {
	id: string;
	title?: string;
	artifactKind?: string;
	status?: string;
};

export type ShowRailEntry = {
	id: string;
	/** Chip text — the artifact kind, same vocabulary as the presenter bar. */
	label: string;
	/** Full show title; two shows can share an artifact kind. */
	title: string;
	status: ShowRailStatus;
};

const RAIL_STATUSES: readonly string[] = [
	"planned",
	"ready",
	"showing",
	"shown",
];

/**
 * Project the hub backlog into rail chips, in hub order. An unrecognised or
 * missing status reads as `planned` — the rail never claims more progress
 * than the room reported.
 */
export function projectShowRail(
	backlog: readonly ShowRailSource[] | undefined,
	activeShowId?: string | null,
): ShowRailEntry[] {
	const active = activeShowId?.trim() ? activeShowId : null;
	const entries: ShowRailEntry[] = [];
	for (const item of backlog ?? []) {
		if (item.status === "cancelled") {
			continue;
		}
		entries.push({
			id: item.id,
			label: item.artifactKind ?? item.title ?? item.id,
			title: item.title ?? item.artifactKind ?? item.id,
			status: railStatus(item.status, item.id === active, active !== null),
		});
	}
	return entries;
}

function railStatus(
	raw: string | undefined,
	isActive: boolean,
	hasActive: boolean,
): ShowRailStatus {
	if (isActive) {
		return "showing";
	}
	if (!raw || !RAIL_STATUSES.includes(raw)) {
		return "planned";
	}
	// A show the hub still calls `showing` while a different one holds the
	// frame is materialised but off screen — that is `ready`, not showing.
	if (raw === "showing" && hasActive) {
		return "ready";
	}
	return raw as ShowRailStatus;
}
