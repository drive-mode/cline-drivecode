/**
 * Show-backlog rail projection — the Director's queue as chip states.
 *
 * Ported from the hub's `drive/showRail.ts`. `room.live.director.showBacklog`
 * is hub-authored and already folded into `DriveRoomState.showBacklog`; the
 * rail renders what the hub says rather than tracking its own queue. The one
 * derivation is `showing`: the show bound to the frame wins over a backlog
 * `status`, so a room sync landing after `drive.show.presented` can never
 * light two chips at once.
 */

/** Rail states from the initiative brief. `cancelled` items leave the queue. */
export type ShowRailStatus = "planned" | "ready" | "showing" | "shown";

/** Structural slice of the hub `ShowBacklogItem` the rail reads. */
export type ShowRailSource = {
	id: string;
	title?: string;
	artifactKind?: string;
	status?: string;
	ownerParticipantId?: string;
	priority?: number;
};

export type ShowRailEntry = {
	id: string;
	/** Chip text — the artifact kind, same vocabulary as the presenter bar. */
	label: string;
	/** Full show title; two shows can share an artifact kind. */
	title: string;
	status: ShowRailStatus;
	ownerParticipantId: string | null;
};

const RAIL_STATUSES: readonly string[] = [
	"planned",
	"ready",
	"showing",
	"shown",
];

export const SHOW_RAIL_STATUS_LABEL: Record<ShowRailStatus, string> = {
	planned: "planned",
	ready: "ready",
	showing: "showing",
	shown: "shown",
};

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
			ownerParticipantId: item.ownerParticipantId ?? null,
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

export type ShowRailCursor = {
	now: ShowRailEntry | null;
	next: ShowRailEntry | null;
};

/**
 * The plan cursor under the rail: `now` is the chip on screen, `next` is the
 * first unshown chip after it in hub order (wrapping to the head of the
 * queue when the current show is the last one). `ready` outranks `planned`
 * only when both are equally near — the hub's order is the plan.
 */
export function selectShowRailCursor(
	entries: readonly ShowRailEntry[],
): ShowRailCursor {
	const nowIndex = entries.findIndex((entry) => entry.status === "showing");
	const now = nowIndex >= 0 ? (entries[nowIndex] ?? null) : null;
	const isUpcoming = (entry: ShowRailEntry) =>
		entry.status === "ready" || entry.status === "planned";
	const after = nowIndex >= 0 ? entries.slice(nowIndex + 1) : entries;
	const before = nowIndex >= 0 ? entries.slice(0, nowIndex) : [];
	const next = after.find(isUpcoming) ?? before.find(isUpcoming) ?? null;
	return { now, next };
}

/** Counts per state, for the rail's summary and the sr-only status line. */
export function summarizeShowRail(
	entries: readonly ShowRailEntry[],
): Record<ShowRailStatus, number> {
	const summary: Record<ShowRailStatus, number> = {
		planned: 0,
		ready: 0,
		showing: 0,
		shown: 0,
	};
	for (const entry of entries) {
		summary[entry.status] += 1;
	}
	return summary;
}
