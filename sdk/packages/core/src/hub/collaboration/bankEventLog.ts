/**
 * Append-only bank event log under `.cline/drive/bank/events.jsonl`.
 * Oldest records are trimmed when the JSONL exceeds the retention cap
 * (DRV-PRIVACY).
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type BankDriveEvent,
	type DriveLogEnvelope,
	parseBankDriveEvent,
	parseDriveLogEnvelope,
	resolveDriveConfigDir,
} from "@cline/shared";
import {
	countNonEmptyLines,
	DEFAULT_BANK_EVENT_LOG_MAX_RECORDS,
	type LogRetentionOptions,
	trimJsonlFileToMaxRecords,
} from "./logRetention";

type Meta = { schemaVersion: 1; nextSeq: number };

export type AppendBankLogOptions = LogRetentionOptions;

/** Cached non-empty line counts keyed by events.jsonl path. */
const bankLineCounts = new Map<string, number>();

function metaPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), "bank", "meta.json");
}

function eventsPath(configParent: string): string {
	return join(resolveDriveConfigDir(configParent), "bank", "events.jsonl");
}

function readMeta(path: string): Meta {
	if (!existsSync(path)) {
		return { schemaVersion: 1, nextSeq: 1 };
	}
	const raw = JSON.parse(readFileSync(path, "utf8")) as Meta;
	return {
		schemaVersion: 1,
		nextSeq: typeof raw.nextSeq === "number" ? raw.nextSeq : 1,
	};
}

function cachedBankLineCount(ePath: string): number {
	const cached = bankLineCounts.get(ePath);
	if (cached !== undefined) {
		return cached;
	}
	if (!existsSync(ePath)) {
		bankLineCounts.set(ePath, 0);
		return 0;
	}
	const n = countNonEmptyLines(readFileSync(ePath, "utf8"));
	bankLineCounts.set(ePath, n);
	return n;
}

/** Test helper: clear in-process bank line-count cache. */
export function resetBankLogRetentionCacheForTests(): void {
	bankLineCounts.clear();
}

export function appendBankLogEvent(
	configParent: string,
	event: BankDriveEvent,
	options: AppendBankLogOptions = {},
): DriveLogEnvelope {
	const maxRecords =
		options.maxRecords ?? DEFAULT_BANK_EVENT_LOG_MAX_RECORDS;
	const mPath = metaPath(configParent);
	const ePath = eventsPath(configParent);
	mkdirSync(dirname(ePath), { recursive: true });
	const meta = readMeta(mPath);
	const envelope: DriveLogEnvelope = {
		family: "bank",
		seq: meta.nextSeq,
		workspaceRoot: configParent,
		event,
	};
	const before = cachedBankLineCount(ePath);
	appendFileSync(ePath, `${JSON.stringify(envelope)}\n`, "utf8");
	const tmp = `${mPath}.${process.pid}.tmp`;
	writeFileSync(
		tmp,
		`${JSON.stringify({ schemaVersion: 1, nextSeq: meta.nextSeq + 1 })}\n`,
		"utf8",
	);
	renameSync(tmp, mPath);
	let count = before + 1;
	bankLineCounts.set(ePath, count);
	if (count > maxRecords) {
		count = trimJsonlFileToMaxRecords(ePath, maxRecords);
		bankLineCounts.set(ePath, count);
	}
	return envelope;
}

export function readBankLogSince(
	configParent: string,
	afterSeq: number,
): DriveLogEnvelope[] {
	const ePath = eventsPath(configParent);
	if (!existsSync(ePath)) {
		return [];
	}
	const out: DriveLogEnvelope[] = [];
	for (const line of readFileSync(ePath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const env = parseDriveLogEnvelope(JSON.parse(trimmed));
		if (env.family === "bank" && env.seq > afterSeq) {
			parseBankDriveEvent(env.event);
			out.push(env);
		}
	}
	return out;
}
