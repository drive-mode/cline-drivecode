/**
 * Local session rollup reader (DRV-TASK-METRICS / Slice 2).
 *
 * Loads room + bank JSONL from `.cline/drive/`, filters by callSessionId,
 * and derives SessionRollup via `@cline/drive`. Localhost / debug only —
 * no telemetry egress. Status Hub (W3) should consume this same port.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { deriveSessionRollup, type SessionRollup } from "@cline/drive";
import {
	type BankDriveEvent,
	type DriveEvent,
	parseDriveEvent,
	resolveDriveRoomEventsPath,
	resolveDriveRoomsDir,
} from "@cline/shared";
import { readBankLogSince } from "./bankEventLog";

export type { SessionRollup };

export type ReadSessionRollupsOptions = {
	/** Max rollups to return (most recent first). Default 10. */
	limit?: number;
	/** When set, return only this session (limit ignored). */
	callSessionId?: string;
};

export type SessionRollupSource = {
	readRollups(options?: ReadSessionRollupsOptions): SessionRollup[];
};

const DEFAULT_LIMIT = 10;

function listRoomIds(configParent: string): string[] {
	const roomsDir = resolveDriveRoomsDir(configParent);
	if (!existsSync(roomsDir)) {
		return [];
	}
	return readdirSync(roomsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

/**
 * Load all room DriveEvents from durable JSONL under configParent.
 */
export function loadAllRoomEvents(configParent: string): DriveEvent[] {
	const out: DriveEvent[] = [];
	for (const roomId of listRoomIds(configParent)) {
		const eventsPath = resolveDriveRoomEventsPath(configParent, roomId);
		if (!existsSync(eventsPath)) {
			continue;
		}
		for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const raw = JSON.parse(trimmed) as { event?: unknown };
				if (raw.event == null) {
					continue;
				}
				out.push(parseDriveEvent(raw.event));
			} catch {
				// Skip corrupt lines; rollup stays best-effort for debug.
			}
		}
	}
	return out;
}

/**
 * Load all bank DriveEvents from durable JSONL under configParent.
 */
export function loadAllBankEvents(configParent: string): BankDriveEvent[] {
	const out: BankDriveEvent[] = [];
	for (const env of readBankLogSince(configParent, 0)) {
		if (env.family === "bank") {
			out.push(env.event);
		}
	}
	return out;
}

function eventAtMs(at: string | undefined): number {
	if (!at) {
		return 0;
	}
	const ms = Date.parse(at);
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * Discover callSessionIds ordered by most recent activity (desc).
 */
export function listRecentCallSessionIds(
	roomEvents: DriveEvent[],
	bankEvents: BankDriveEvent[],
): string[] {
	const latest = new Map<string, number>();
	for (const event of roomEvents) {
		const id = event.callSessionId?.trim();
		if (!id) {
			continue;
		}
		const at = eventAtMs(event.at);
		const prev = latest.get(id) ?? 0;
		if (at >= prev) {
			latest.set(id, at);
		}
	}
	for (const event of bankEvents) {
		const id = event.callSessionId?.trim();
		if (!id) {
			continue;
		}
		const at = eventAtMs(event.at);
		const prev = latest.get(id) ?? 0;
		if (at >= prev) {
			latest.set(id, at);
		}
	}
	return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/**
 * Derive one SessionRollup from already-loaded event arrays.
 * Pure aside from deriveSessionRollup — Status lens can call this without FS.
 */
export function rollupFromLoadedEvents(input: {
	callSessionId: string;
	roomEvents: DriveEvent[];
	bankEvents: BankDriveEvent[];
}): SessionRollup {
	return deriveSessionRollup(input);
}

/**
 * Read SessionRollup(s) from local room + bank JSONL.
 * Returns empty when logs are missing; never phones home.
 */
export function readSessionRollups(
	configParent: string,
	options: ReadSessionRollupsOptions = {},
): SessionRollup[] {
	const roomEvents = loadAllRoomEvents(configParent);
	const bankEvents = loadAllBankEvents(configParent);

	if (options.callSessionId?.trim()) {
		const callSessionId = options.callSessionId.trim();
		const hasAny =
			roomEvents.some((e) => e.callSessionId === callSessionId) ||
			bankEvents.some((e) => e.callSessionId === callSessionId);
		if (!hasAny) {
			return [];
		}
		return [
			rollupFromLoadedEvents({
				callSessionId,
				roomEvents,
				bankEvents,
			}),
		];
	}

	const limit =
		typeof options.limit === "number" && options.limit > 0
			? Math.floor(options.limit)
			: DEFAULT_LIMIT;
	const ids = listRecentCallSessionIds(roomEvents, bankEvents).slice(0, limit);
	return ids.map((callSessionId) =>
		rollupFromLoadedEvents({
			callSessionId,
			roomEvents,
			bankEvents,
		}),
	);
}

/**
 * FS-backed SessionRollupSource for Status / hub composition roots.
 */
export function createFsSessionRollupSource(
	configParent: string,
): SessionRollupSource {
	return {
		readRollups(options) {
			return readSessionRollups(configParent, options);
		},
	};
}

/**
 * Human-readable dump for CLI / debug panel (no secrets / utterance text).
 */
export function formatSessionRollupsDump(rollups: SessionRollup[]): string {
	if (rollups.length === 0) {
		return "No session rollups found in local Drive logs.";
	}
	const lines: string[] = [`Session rollups (local, n=${rollups.length})`, ""];
	for (const r of rollups) {
		const duration =
			r.durationMs == null ? "—" : `${Math.round(r.durationMs / 1000)}s`;
		const tpm =
			r.tasksPerSessionMinute == null
				? "—"
				: r.tasksPerSessionMinute.toFixed(2);
		lines.push(
			`• ${r.callSessionId}  room=${r.roomId ?? "—"}  S1=${duration}  S2=${r.tasksCompleted}  S3=${r.planCleanDrain ? "clean" : "—"}  E1=${r.postSuccessPlanContinue ? "yes" : "no"}  E2=${r.intentRefresh ? "yes" : "no"}  E3=${tpm}/min  P1=${r.midPlanAddCount}  P2=${r.failureStickyCount}`,
		);
	}
	return lines.join("\n");
}
