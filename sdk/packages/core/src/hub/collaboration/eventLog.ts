/**
 * Append-only room event log (ARD-0013 lane 1).
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
import {
	countNonEmptyLines,
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
	type LogRetentionOptions,
	trimJsonlFileToMaxRecords,
} from "./logRetention";

export type RoomLogRecord = {
	readonly seq: number;
	readonly event: DriveEvent;
};

export type RoomEventLog = {
	appendSync(roomId: string, event: DriveEvent): RoomLogRecord;
	readSince(roomId: string, afterSeq: number): Promise<RoomLogRecord[]>;
	/** Sync gap read for hub command handlers. */
	readSinceSync(roomId: string, afterSeq: number): RoomLogRecord[];
	latestSeq(roomId: string): number;
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
	private readonly maxRecords: number;
	private readonly lineCounts = new Map<string, number>();

	constructor(
		readonly configParent: string,
		options: RoomEventLogOptions = {},
	) {
		this.maxRecords =
			options.maxRecords ?? DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS;
	}

	latestSeq(roomId: string): number {
		const meta = readMeta(resolveDriveRoomMetaPath(this.configParent, roomId));
		return Math.max(0, meta.nextSeq - 1);
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
		if (count > this.maxRecords) {
			count = trimJsonlFileToMaxRecords(eventsPath, this.maxRecords);
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
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const raw = JSON.parse(trimmed) as { seq?: unknown; event?: unknown };
			if (typeof raw.seq !== "number" || raw.seq <= afterSeq) {
				continue;
			}
			out.push({
				seq: raw.seq,
				event: parseDriveEvent(raw.event),
			});
		}
		return out;
	}
}

/**
 * Attach a JsonlRoomEventLog under `configParent`, migrating any prior durable
 * records when the parent changes (e.g. tmpdir → workspaceRoot) so seq stays
 * monotonic and earlier room ops are not orphaned.
 */
export function rebindJsonlRoomEventLog(
	store: RoomEventLogStore,
	configParent: string,
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
	const roomIds = new Set<string>(store.rooms.keys());
	if (existing instanceof JsonlRoomEventLog) {
		for (const roomId of listJsonlRoomIds(existing.configParent)) {
			roomIds.add(roomId);
		}
		migrateJsonlRoomEventLog(existing, next, roomIds);
	}

	// In-memory commits may already have published higher seq than an empty dest.
	for (const roomId of roomIds) {
		const seq = store.lastSeq(roomId);
		if (seq > 0) {
			next.ensureNextSeqAtLeast(roomId, seq + 1);
		}
	}

	store.attachEventLog(next);
}

/** In-memory log for unit tests (no disk). Honors the same retention cap. */
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
