/**
 * Durable fold checkpoint for a room (ADR-0029 / ADR-0013 amendment).
 *
 * Retention may trim oldest JSONL records (including control.join). Live
 * snapshot stays correct in memory; without a checkpoint, cold hydrate from
 * the trimmed log rebuilds a wrong roster. Write the folded snapshot when
 * trim happens; hydrate loads checkpoint then folds only the tail.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	type RoomSnapshot,
	parseRoomSnapshot,
	resolveDriveRoomCheckpointPath,
} from "@cline/shared";

export type RoomFoldCheckpoint = {
	readonly schemaVersion: 1;
	readonly seq: number;
	readonly snapshot: RoomSnapshot;
};

export function writeRoomFoldCheckpoint(
	configParent: string,
	roomId: string,
	seq: number,
	snapshot: RoomSnapshot,
): void {
	const path = resolveDriveRoomCheckpointPath(configParent, roomId);
	mkdirSync(dirname(path), { recursive: true });
	const body: RoomFoldCheckpoint = {
		schemaVersion: 1,
		seq,
		snapshot,
	};
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(body)}\n`, "utf8");
	renameSync(tmp, path);
}

export function readRoomFoldCheckpoint(
	configParent: string,
	roomId: string,
): RoomFoldCheckpoint | undefined {
	const path = resolveDriveRoomCheckpointPath(configParent, roomId);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as {
			schemaVersion?: unknown;
			seq?: unknown;
			snapshot?: unknown;
		};
		if (raw.schemaVersion !== 1 || typeof raw.seq !== "number") {
			return undefined;
		}
		return {
			schemaVersion: 1,
			seq: raw.seq,
			snapshot: parseRoomSnapshot(raw.snapshot),
		};
	} catch {
		return undefined;
	}
}
