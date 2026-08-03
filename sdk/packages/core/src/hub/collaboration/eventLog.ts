/**
 * Append-only room event log (ADR-0013 lane 1).
 * JSONL under `.cline/drive/rooms/<roomId>/events.jsonl` + `meta.json`.
 */

import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	type DriveEvent,
	parseDriveEvent,
	resolveDriveRoomEventsPath,
	resolveDriveRoomMetaPath,
	resolveDriveRoomsDir,
} from "@cline/shared";
import { migrateArtifactCorpus } from "./artifactEventLog";
import {
	countNonEmptyLines,
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
	type LogRetentionOptions,
	trimJsonlFileToMaxRecords,
} from "./logRetention";
import {
	getLiveRetentionFacets,
	resolveRoomEventLogMaxRecords,
} from "./retentionCaps";

export type RoomLogRecord = {
	readonly seq: number;
	readonly event: DriveEvent;
};

export type RoomEventLog = {
	/**
	 * Workspace root this log is durable to, when it has one. The artifact
	 * corpus lives beside the room logs under the same root, so whoever holds
	 * the store can find it without a second binding to keep in sync. Undefined
	 * on the pre-bind memory buffer — no workspace root, no durable corpus.
	 */
	readonly configParent?: string;
	appendSync(roomId: string, event: DriveEvent): RoomLogRecord;
	readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]>;
	/** Sync gap read for hub command handlers. */
	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[];
	latestSeq(roomId: string): number;
	/**
	 * Every room recorded under this log's config parent, including ones no
	 * live process holds. This is the authority for "which rooms does this
	 * workspace have": a durable room is owned by the workspace whose log
	 * holds it, and roomIds are unique only within one such root.
	 */
	listRoomIds(): string[];
};

export type RoomEventLogOptions = LogRetentionOptions;

type MetaFile = {
	schemaVersion: 1;
	nextSeq: number;
};

/** Minimal store surface needed to rebind a durable room event log. */
export type RoomEventLogStore = {
	getEventLog(): RoomEventLog | undefined;
	attachEventLog(log: RoomEventLog): void;
	lastSeq(roomId: string): number;
	readonly rooms: ReadonlyMap<string, unknown>;
};

function readMeta(path: string): MetaFile {
	if (!existsSync(path)) {
		return { schemaVersion: 1, nextSeq: 1 };
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as MetaFile;
	return {
		schemaVersion: 1,
		nextSeq: typeof raw.nextSeq === "number" ? raw.nextSeq : 1,
	};
}

function writeMetaAtomic(path: string, meta: MetaFile): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(meta)}\n`, "utf8");
	renameSync(tmp, path);
}

function listJsonlRoomIds(configParent: string): string[] {
	const roomsDir = resolveDriveRoomsDir(configParent);
	if (!existsSync(roomsDir)) {
		return [];
	}
	return readdirSync(roomsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

/**
 * Migrate `roomIds` from whatever log is currently attached (the in-memory
 * pre-bind buffer, or a prior durable log) into a freshly bound durable log.
 * Jsonl→Jsonl reuses the fast file-copy path; anything else (the memory
 * buffer) replays each room's records in order via appendSync so the new
 * log sees the room's full buffered history, not just what happens after it
 * attaches — otherwise events committed before a workspace root was known
 * would be durably lost the moment a real log finally binds.
 */
function migrateRoomEventLog(
	from: RoomEventLog,
	to: JsonlRoomEventLog,
	roomIds: Iterable<string>,
): void {
	if (from instanceof JsonlRoomEventLog) {
		migrateJsonlRoomEventLog(from, to, roomIds);
		return;
	}
	for (const roomId of roomIds) {
		for (const record of from.readSinceSync(roomId, 0)) {
			to.appendSync(roomId, record.event);
		}
	}
}

function migrateJsonlRoomEventLog(
	from: JsonlRoomEventLog,
	to: JsonlRoomEventLog,
	roomIds: Iterable<string>,
): void {
	if (from.configParent === to.configParent) {
		return;
	}
	for (const roomId of roomIds) {
		const srcEvents = resolveDriveRoomEventsPath(from.configParent, roomId);
		const srcMeta = resolveDriveRoomMetaPath(from.configParent, roomId);
		const dstEvents = resolveDriveRoomEventsPath(to.configParent, roomId);
		const dstMeta = resolveDriveRoomMetaPath(to.configParent, roomId);
		if (!existsSync(srcEvents) && !existsSync(srcMeta)) {
			continue;
		}
		if (!existsSync(dstEvents) && !existsSync(dstMeta)) {
			mkdirSync(dirname(dstEvents), { recursive: true });
			if (existsSync(srcEvents)) {
				copyFileSync(srcEvents, dstEvents);
			}
			if (existsSync(srcMeta)) {
				copyFileSync(srcMeta, dstMeta);
			}
			continue;
		}
		// Destination already durable: keep its records, never let nextSeq go backwards.
		const nextSeq = Math.max(
			readMeta(srcMeta).nextSeq,
			readMeta(dstMeta).nextSeq,
		);
		writeMetaAtomic(dstMeta, { schemaVersion: 1, nextSeq });
	}
}

/**
 * File-backed room event log for a workspace config parent
 * (`<workspace>` or similar — used with resolveDriveConfigDir).
 * Oldest records are trimmed when the JSONL exceeds `maxRecords`
 * (DRV-PRIVACY retention cap).
 */
export class JsonlRoomEventLog implements RoomEventLog {
	/**
	 * Explicit override (tests, callers that already resolved a cap) always
	 * wins. When absent, `currentMaxRecords()` resolves fresh on every append
	 * through the retention facet helpers so a live `privacy.debugRetention`
	 * toggle takes effect on the very next write without recreating the log.
	 */
	private readonly explicitMaxRecords: number | undefined;
	private readonly lineCounts = new Map<string, number>();
	/** Last skip count warned per room, so a stuck bad line warns once. */
	private readonly warnedSkips = new Map<string, number>();

	constructor(
		readonly configParent: string,
		options: RoomEventLogOptions = {},
	) {
		this.explicitMaxRecords = options.maxRecords;
	}

	private currentMaxRecords(): number {
		return (
			this.explicitMaxRecords ??
			resolveRoomEventLogMaxRecords(getLiveRetentionFacets(this.configParent))
		);
	}

	latestSeq(roomId: string): number {
		const meta = readMeta(resolveDriveRoomMetaPath(this.configParent, roomId));
		return Math.max(0, meta.nextSeq - 1);
	}

	listRoomIds(): string[] {
		return listJsonlRoomIds(this.configParent);
	}

	/** Ensure subsequent appends allocate seq >= minNextSeq. */
	ensureNextSeqAtLeast(roomId: string, minNextSeq: number): void {
		if (minNextSeq <= 1) {
			return;
		}
		const metaPath = resolveDriveRoomMetaPath(this.configParent, roomId);
		const meta = readMeta(metaPath);
		if (meta.nextSeq >= minNextSeq) {
			return;
		}
		writeMetaAtomic(metaPath, { schemaVersion: 1, nextSeq: minNextSeq });
	}

	private cachedLineCount(roomId: string, eventsPath: string): number {
		const cached = this.lineCounts.get(roomId);
		if (cached !== undefined) {
			return cached;
		}
		if (!existsSync(eventsPath)) {
			this.lineCounts.set(roomId, 0);
			return 0;
		}
		const n = countNonEmptyLines(readFileSync(eventsPath, "utf8"));
		this.lineCounts.set(roomId, n);
		return n;
	}

	appendSync(roomId: string, event: DriveEvent): RoomLogRecord {
		const metaPath = resolveDriveRoomMetaPath(this.configParent, roomId);
		const eventsPath = resolveDriveRoomEventsPath(this.configParent, roomId);
		mkdirSync(dirname(eventsPath), { recursive: true });
		const meta = readMeta(metaPath);
		const seq = meta.nextSeq;
		const record: RoomLogRecord = { seq, event };
		const before = this.cachedLineCount(roomId, eventsPath);
		appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, "utf8");
		writeMetaAtomic(metaPath, { schemaVersion: 1, nextSeq: seq + 1 });
		let count = before + 1;
		this.lineCounts.set(roomId, count);
		const maxRecords = this.currentMaxRecords();
		if (count > maxRecords) {
			count = trimJsonlFileToMaxRecords(eventsPath, maxRecords);
			this.lineCounts.set(roomId, count);
		}
		return record;
	}

	async readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]> {
		return this.readSinceSync(roomId, afterSeq);
	}

	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[] {
		const eventsPath = resolveDriveRoomEventsPath(this.configParent, roomId);
		if (!existsSync(eventsPath)) {
			return [];
		}
		const text = readFileSync(eventsPath, "utf8");
		const out: RoomLogRecord[] = [];
		let skipped = 0;
		let total = 0;
		// One corrupt or forward-incompatible record must degrade a single
		// event, never the whole room history.
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			total += 1;
			let raw: { seq?: unknown; event?: unknown };
			try {
				raw = JSON.parse(trimmed) as { seq?: unknown; event?: unknown };
			} catch {
				skipped += 1;
				continue;
			}
			if (typeof raw.seq !== "number") {
				skipped += 1;
				continue;
			}
			// Already-seen records are a normal skip, not a corrupt one.
			if (raw.seq <= afterSeq) {
				continue;
			}
			try {
				out.push({ seq: raw.seq, event: parseDriveEvent(raw.event) });
			} catch {
				skipped += 1;
			}
		}
		this.warnOnceForSkips(roomId, skipped, total);
		return out;
	}

	private warnOnceForSkips(
		roomId: string,
		skipped: number,
		total: number,
	): void {
		if (skipped === 0) {
			this.warnedSkips.delete(roomId);
			return;
		}
		if (this.warnedSkips.get(roomId) === skipped) {
			return;
		}
		this.warnedSkips.set(roomId, skipped);
		const detail =
			skipped === total
				? `every one of its ${total} record(s) is unreadable; the room cannot be restored`
				: `skipped ${skipped} of ${total} unreadable event log record(s)`;
		console.warn(`[drive] room ${roomId}: ${detail}`);
	}
}

/**
 * Attach a JsonlRoomEventLog under `configParent`, migrating whatever the
 * store was durable to before — a prior JsonlRoomEventLog (e.g. a workspace
 * switch) or the in-memory pre-bind buffer every store starts with (see
 * DriveRoomStore) — so seq stays monotonic and earlier room ops are not
 * orphaned.
 *
 * `roomIds`, when given, scopes the migration to exactly those rooms — the
 * one(s) the caller's own operation concerns. This matters because the
 * store is a single process-wide map: an unrelated room this process
 * happened to touch earlier (before *any* workspace root was known, so it
 * too lived on the pre-bind buffer) is still resident and would otherwise
 * migrate along for free, handing a foreign or ephemeral room's history to
 * whichever workspace binds next. Every hub handler that knows which room
 * it is acting on passes it explicitly; only the harness-level rebind on a
 * workspace switch (which has no single room in view) falls back to
 * `store.rooms.keys()` — the pre-existing, ADR-worthy limitation that a
 * long-lived process switching workspaces mid-session shares one room map
 * across both (see PR #123).
 */
export function rebindJsonlRoomEventLog(
	store: RoomEventLogStore,
	configParent: string,
	roomIds?: Iterable<string>,
): void {
	const nextParent = configParent.trim();
	if (!nextParent) {
		return;
	}
	const existing = store.getEventLog();
	if (
		existing instanceof JsonlRoomEventLog &&
		existing.configParent === nextParent
	) {
		return;
	}

	const next = new JsonlRoomEventLog(nextParent);
	// Only the scoped rooms migrate — never everything the old config parent
	// happens to contain on disk, and never every room this store's process
	// has resident in memory when the caller knows exactly which room its
	// operation concerns. The old parent can be a shared or stale directory
	// (a prior run's tmpdir, another workspace's root) that holds rooms this
	// process never created — e.g. leftover test fixtures — and those must
	// never surface as this workspace's rooms.
	const scopedRoomIds = new Set<string>(roomIds ?? store.rooms.keys());
	if (existing) {
		migrateRoomEventLog(existing, next, scopedRoomIds);
		// The artifact corpus is durable to the same root and must move with the
		// rooms whose logs just moved — otherwise a workspace switch leaves a
		// room's events under the new root and its artifacts under the old one,
		// and the split is permanent.
		if (existing.configParent) {
			migrateArtifactCorpus(existing.configParent, nextParent, scopedRoomIds);
		}
	}

	// In-memory commits may already have published higher seq than an empty dest.
	for (const roomId of scopedRoomIds) {
		const seq = store.lastSeq(roomId);
		if (seq > 0) {
			next.ensureNextSeqAtLeast(roomId, seq + 1);
		}
	}

	store.attachEventLog(next);
}

/**
 * In-memory log (no disk). Used directly by unit tests, and as
 * `DriveRoomStore`'s default pre-bind buffer — every store starts with one so
 * commits before a workspace root is known are never silently un-durable;
 * `rebindJsonlRoomEventLog` replays it into the first real log that attaches.
 * Honors the same retention cap as `JsonlRoomEventLog` (oldest-trimmed), so
 * the buffer cannot grow unbounded on a store that never gets a workspace
 * root — it is a bounded window, not a guarantee every pre-bind event
 * survives forever.
 */
export class MemoryRoomEventLog implements RoomEventLog {
	private readonly byRoom = new Map<string, RoomLogRecord[]>();
	private readonly maxRecords: number;

	constructor(options: RoomEventLogOptions = {}) {
		this.maxRecords =
			options.maxRecords ?? DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS;
	}

	latestSeq(roomId: string): number {
		const records = this.byRoom.get(roomId) ?? [];
		const last = records[records.length - 1];
		return last?.seq ?? 0;
	}

	listRoomIds(): string[] {
		return [...this.byRoom.keys()];
	}

	appendSync(roomId: string, event: DriveEvent): RoomLogRecord {
		const list = this.byRoom.get(roomId) ?? [];
		const last = list[list.length - 1];
		const seq = last ? last.seq + 1 : 1;
		const record = { seq, event };
		list.push(record);
		if (list.length > this.maxRecords) {
			list.splice(0, list.length - this.maxRecords);
		}
		this.byRoom.set(roomId, list);
		return record;
	}

	async readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]> {
		return this.readSinceSync(roomId, afterSeq);
	}

	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[] {
		return (this.byRoom.get(roomId) ?? []).filter((r) => r.seq > afterSeq);
	}
}
