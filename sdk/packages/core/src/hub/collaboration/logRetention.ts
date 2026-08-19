/**
 * Local JSONL retention helpers (DRV-PRIVACY).
 *
 * Room and bank event logs are durable under `.cline/drive/` for Status /
 * digest / reconnect, but must not grow without bound. Caps trim oldest
 * records on append; seq / meta.nextSeq stay monotonic.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** Default max records retained per room `events.jsonl`. */
export const DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS = 2_048;

/** Default max records retained in workspace bank `events.jsonl`. */
export const DEFAULT_BANK_EVENT_LOG_MAX_RECORDS = 4_096;

/**
 * Default max records retained in the workspace artifact `events.jsonl`.
 *
 * Denominated in artifact records, not mixed room events — that is the point
 * of giving artifacts their own family: no amount of presence or work traffic
 * can push an artifact out.
 *
 * One artifact writes a record each time its durable projection changes
 * (planned → ready → showing → shown), so distinct-artifact capacity is some
 * fraction of this. Re-enqueuing an item demotes it to `planned` again, so a
 * demo loop that re-shows the same artifact spends the cap faster than a room
 * that shows each once — and the corpus is workspace-wide, so that spend is
 * shared across rooms.
 */
export const DEFAULT_ARTIFACT_EVENT_LOG_MAX_RECORDS = 8_192;

/**
 * Raised caps when `privacy.debugRetention` is on (see retentionCaps.ts).
 * Still local-only — never phone-home.
 */
export const DEBUG_ROOM_EVENT_LOG_MAX_RECORDS = 16_384;
export const DEBUG_BANK_EVENT_LOG_MAX_RECORDS = 32_768;
export const DEBUG_ARTIFACT_EVENT_LOG_MAX_RECORDS = 65_536;

export type LogRetentionOptions = {
	/** Max JSONL records to keep (oldest trimmed). */
	readonly maxRecords?: number;
};

/** Count non-empty lines in a JSONL blob. */
export function countNonEmptyLines(text: string): number {
	let n = 0;
	for (const line of text.split("\n")) {
		if (line.trim()) {
			n += 1;
		}
	}
	return n;
}

/**
 * Keep the last `maxRecords` non-empty lines. Returns a trailing newline when
 * any lines remain (stable JSONL shape).
 */
export function keepLastNonEmptyLines(
	text: string,
	maxRecords: number,
): string {
	if (maxRecords <= 0) {
		return "";
	}
	const lines: string[] = [];
	for (const line of text.split("\n")) {
		if (line.trim()) {
			lines.push(line);
		}
	}
	if (lines.length <= maxRecords) {
		return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
	}
	return `${lines.slice(-maxRecords).join("\n")}\n`;
}

/**
 * Atomically rewrite `path` so it holds at most `maxRecords` non-empty lines
 * (newest kept). Returns the retained line count.
 */
export function trimJsonlFileToMaxRecords(
	path: string,
	maxRecords: number,
): number {
	if (!existsSync(path)) {
		return 0;
	}
	if (maxRecords <= 0) {
		const tmp = `${path}.${process.pid}.trim.tmp`;
		writeFileSync(tmp, "", "utf8");
		renameSync(tmp, path);
		return 0;
	}
	const text = readFileSync(path, "utf8");
	const lines: string[] = [];
	for (const line of text.split("\n")) {
		if (line.trim()) {
			lines.push(line);
		}
	}
	if (lines.length <= maxRecords) {
		return lines.length;
	}
	const kept = lines.slice(-maxRecords);
	const next = `${kept.join("\n")}\n`;
	const tmp = `${path}.${process.pid}.trim.tmp`;
	writeFileSync(tmp, next, "utf8");
	renameSync(tmp, path);
	return kept.length;
}
