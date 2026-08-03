/**
 * Append-only artifact corpus under `.cline/drive/artifacts/events.jsonl`
 * (ADR-0013 lane 1, envelope `family: "artifact"`).
 *
 * Why a family of its own rather than `media.artifact` records on the room
 * log: the room log trims oldest-first at a cap counted in mixed events, so a
 * busy room's presence and work traffic evicts exactly the records an
 * Artifacts page exists to list. Bank history already took this shape; the
 * artifact family follows it, with a cap denominated in artifacts.
 *
 * The corpus spans rooms — one file per workspace — because the Artifacts page
 * sorts and filters across them. Corpus identity is therefore roomId +
 * showItemId: producers content-hash `showItemId`, so the same diagram
 * rendered in two rooms is two artifacts, not one overwriting the other.
 *
 * Privacy (DRV-PRIVACY): a `ShowBacklogItem` is never persisted verbatim. Its
 * `uri` is a base64 data URI from the producer, and the artifact log carries
 * only the produce recipe that reproduces it — `MediaArtifactEventSchema` is
 * `.strict()` and rejects `uri` and friends outright, including inside
 * `produce.args`.
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
	type DriveArtifactDirectoryEntry,
	projectArtifactDirectory,
	sortArtifactDirectory,
} from "@cline/drive";
import type {
	DriveEvent,
	DriveLogEnvelope,
	ShowBacklogItem,
} from "@cline/shared";
import {
	DRIVE_EVENT_FORBIDDEN_KEYS,
	DRIVE_SCHEMA_VERSION,
	MediaArtifactEventSchema,
	parseDriveLogEnvelope,
	resolveDriveConfigDir,
} from "@cline/shared";
import {
	countNonEmptyLines,
	type LogRetentionOptions,
	trimJsonlFileToMaxRecords,
} from "./logRetention";
import {
	getLiveRetentionFacets,
	resolveArtifactEventLogMaxRecords,
} from "./retentionCaps";

export type MediaArtifactEvent = Extract<
	DriveEvent,
	{ type: "media.artifact" }
>;
export type ArtifactLogEnvelope = Extract<
	DriveLogEnvelope,
	{ family: "artifact" }
>;

export type AppendArtifactLogOptions = LogRetentionOptions;

type Meta = { schemaVersion: 1; nextSeq: number };

export const DRIVE_ARTIFACTS_DIRECTORY_NAME = "artifacts";

/** Cached non-empty line counts keyed by events.jsonl path. */
const artifactLineCounts = new Map<string, number>();

function artifactsDir(configParent: string): string {
	return join(
		resolveDriveConfigDir(configParent),
		DRIVE_ARTIFACTS_DIRECTORY_NAME,
	);
}

function metaPath(configParent: string): string {
	return join(artifactsDir(configParent), "meta.json");
}

function eventsPath(configParent: string): string {
	return join(artifactsDir(configParent), "events.jsonl");
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

function cachedArtifactLineCount(ePath: string): number {
	const cached = artifactLineCounts.get(ePath);
	if (cached !== undefined) {
		return cached;
	}
	if (!existsSync(ePath)) {
		artifactLineCounts.set(ePath, 0);
		return 0;
	}
	const n = countNonEmptyLines(readFileSync(ePath, "utf8"));
	artifactLineCounts.set(ePath, n);
	return n;
}

/** Test helper: clear in-process artifact line-count cache. */
export function resetArtifactLogRetentionCacheForTests(): void {
	artifactLineCounts.clear();
}

export function appendArtifactLogEvent(
	configParent: string,
	event: MediaArtifactEvent,
	options: AppendArtifactLogOptions = {},
): ArtifactLogEnvelope {
	// Resolved per append (not per log) so a live `privacy.debugRetention`
	// toggle takes effect on the very next write, same as room and bank.
	const maxRecords =
		options.maxRecords ??
		resolveArtifactEventLogMaxRecords(getLiveRetentionFacets(configParent));
	const mPath = metaPath(configParent);
	const ePath = eventsPath(configParent);
	mkdirSync(dirname(ePath), { recursive: true });
	const meta = readMeta(mPath);
	const envelope: ArtifactLogEnvelope = {
		family: "artifact",
		seq: meta.nextSeq,
		roomId: event.roomId,
		event,
	};
	const before = cachedArtifactLineCount(ePath);
	appendFileSync(ePath, `${JSON.stringify(envelope)}\n`, "utf8");
	const tmp = `${mPath}.${process.pid}.tmp`;
	writeFileSync(
		tmp,
		`${JSON.stringify({ schemaVersion: 1, nextSeq: meta.nextSeq + 1 })}\n`,
		"utf8",
	);
	renameSync(tmp, mPath);
	let count = before + 1;
	artifactLineCounts.set(ePath, count);
	if (count > maxRecords) {
		count = trimJsonlFileToMaxRecords(ePath, maxRecords);
		artifactLineCounts.set(ePath, count);
	}
	return envelope;
}

export function readArtifactLogSince(
	configParent: string,
	afterSeq: number,
): ArtifactLogEnvelope[] {
	const ePath = eventsPath(configParent);
	if (!existsSync(ePath)) {
		return [];
	}
	const out: ArtifactLogEnvelope[] = [];
	for (const line of readFileSync(ePath, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		// Skip what will not parse rather than throwing. This read sits on the
		// `call_join` path via room rehydrate, and the corpus is long-lived and
		// cross-room: a half-written line from a crash mid-append, or a record
		// from a superseded schemaVersion, must cost that one artifact — not
		// make every room in the workspace unjoinable.
		let env: ReturnType<typeof parseDriveLogEnvelope>;
		try {
			env = parseDriveLogEnvelope(JSON.parse(trimmed));
		} catch {
			continue;
		}
		if (env.family === "artifact" && env.seq > afterSeq) {
			out.push(env);
		}
	}
	return out;
}

/** Every artifact record on the corpus, oldest first. */
export function readArtifactEvents(
	configParent: string,
	roomId?: string,
): MediaArtifactEvent[] {
	return readArtifactLogSince(configParent, 0)
		.filter((envelope) => roomId === undefined || envelope.roomId === roomId)
		.map((envelope) => envelope.event);
}

/**
 * Move `roomIds`' artifact records from one workspace corpus to another, so a
 * workspace switch does not strand them.
 *
 * The room log migrates by copying whole per-room files; the corpus cannot,
 * because one file holds every room in the workspace. So this copies the
 * scoped rooms' records and leaves the rest of the source corpus alone —
 * exactly the rooms whose event logs moved, and no others. Records already
 * present at the destination are skipped, which makes a repeated rebind to the
 * same root a no-op rather than a source of duplicates.
 */
export function migrateArtifactCorpus(
	fromConfigParent: string,
	toConfigParent: string,
	roomIds: Iterable<string>,
): void {
	if (fromConfigParent === toConfigParent) {
		return;
	}
	const scoped = new Set(roomIds);
	if (scoped.size === 0) {
		return;
	}
	const source = readArtifactLogSince(fromConfigParent, 0).filter((envelope) =>
		scoped.has(envelope.roomId),
	);
	if (source.length === 0) {
		return;
	}
	const alreadyThere = new Set(
		readArtifactLogSince(toConfigParent, 0).map(
			(envelope) => envelope.event.id,
		),
	);
	for (const envelope of source) {
		if (alreadyThere.has(envelope.event.id)) {
			continue;
		}
		appendArtifactLogEvent(toConfigParent, envelope.event);
	}
}

/**
 * The Artifacts-page corpus: one entry per artifact across every room this
 * workspace has recorded, newest first.
 */
export function readArtifactCorpus(
	configParent: string,
): DriveArtifactDirectoryEntry[] {
	return sortArtifactDirectory(
		projectArtifactDirectory({ events: readArtifactEvents(configParent) }),
	);
}

const FORBIDDEN_ARG_KEYS: ReadonlySet<string> = new Set(
	DRIVE_EVENT_FORBIDDEN_KEYS,
);

/**
 * Strip byte-bearing keys from a produce recipe, at every depth.
 *
 * `ShowBacklogItem.produce.args` is an open `Record<string, unknown>` that
 * `drive.show.enqueue` parses straight off the wire, so a nested
 * `{ render: { dataUri } }` is well-formed input. The event schema's own guard
 * only inspects top-level keys, which means depth is exactly where a base64
 * render would otherwise reach disk — and from there the Artifacts list and
 * the restored live backlog. Recursing is what makes "bytes-free" true rather
 * than merely shallow.
 *
 * Keys are emitted in sorted order so the durable fingerprint is a function of
 * the recipe's content, not the order a client happened to serialize it in.
 */
function sanitizeProduceArgs(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(args).sort()) {
		if (FORBIDDEN_ARG_KEYS.has(key)) {
			continue;
		}
		out[key] = sanitizeArgValue(args[key]);
	}
	return out;
}

function sanitizeArgValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeArgValue);
	}
	if (value !== null && typeof value === "object") {
		return sanitizeProduceArgs(value as Record<string, unknown>);
	}
	return value;
}

/**
 * `ShowBacklogItem.tags` allows an empty string; the event schema requires
 * `.min(1)`. Without this the whole record would fail to parse and be dropped
 * silently — a blank chip label costing the artifact its place in the corpus.
 */
function usableTags(item: ShowBacklogItem): string[] {
	return (item.tags ?? []).filter((tag) => tag.trim().length > 0);
}

/**
 * The bytes-free durable projection of a show item. `uri` is deliberately
 * absent — it is the base64 render, and the produce recipe replaces it.
 */
function artifactEventFrom(input: {
	roomId: string;
	item: ShowBacklogItem;
	at: string;
}): MediaArtifactEvent | undefined {
	const { item } = input;
	const parsed = MediaArtifactEventSchema.safeParse({
		schemaVersion: DRIVE_SCHEMA_VERSION,
		id: `artifact_${crypto.randomUUID()}`,
		roomId: input.roomId,
		at: input.at,
		actorId: item.ownerParticipantId,
		type: "media.artifact",
		track: "media",
		showItemId: item.id,
		artifactKind: item.artifactKind,
		mediaClass: item.mediaClass,
		title: item.title,
		caption: item.caption,
		ownerParticipantId: item.ownerParticipantId,
		produce: {
			tool: item.produce.tool,
			...(item.produce.templateId
				? { templateId: item.produce.templateId }
				: {}),
			args: sanitizeProduceArgs(item.produce.args),
		},
		// The item's own labels — the Artifacts page's filter chips. Never
		// derived from artifactKind, which the entry already carries as its
		// own facet; `tags` exists for the facets a kind cannot express.
		tags: usableTags(item),
		status: item.status,
	});
	// A parse failure is schema drift, never a reason to fail the room
	// mutation that produced the artifact — drop the record instead.
	return parsed.success ? parsed.data : undefined;
}

/**
 * Everything that decides whether an artifact needs a fresh record. Compared
 * rather than cached in process memory so a hub restart re-derives it from the
 * live backlog it just restored, instead of re-appending the whole corpus.
 */
function durableFingerprint(item: ShowBacklogItem): string {
	return JSON.stringify([
		item.id,
		item.artifactKind,
		item.mediaClass,
		item.title,
		item.caption,
		item.ownerParticipantId,
		item.status,
		item.produce.tool,
		item.produce.templateId ?? null,
		sanitizeProduceArgs(item.produce.args),
		usableTags(item),
	]);
}

/**
 * Commit the artifact records a director mutation earned.
 *
 * Diffing the backlog before against after — rather than keeping a
 * process-local "already recorded" set — keeps this a pure function of the two
 * states the caller already holds, and means a restored backlog re-records
 * nothing until it actually changes.
 */
export function recordShowBacklogArtifacts(input: {
	configParent: string | undefined;
	roomId: string;
	before: readonly ShowBacklogItem[];
	after: readonly ShowBacklogItem[];
	at?: string;
	options?: AppendArtifactLogOptions;
}): ArtifactLogEnvelope[] {
	// No workspace root yet means no durable home for the corpus. Same rule the
	// room log follows: a durable artifact is owned by the workspace whose log
	// holds it, so there must be no log until there is a workspace.
	//
	// Known gap, inherited from that rule: the room log buffers pre-bind commits
	// in memory and replays them when a real log attaches, but a show enqueued
	// before any workspace root is known has no such buffer here. It stays live
	// and re-records on its next director mutation; if it never mutates again it
	// never reaches the corpus.
	if (!input.configParent) {
		return [];
	}
	const unchanged = new Set(input.before.map(durableFingerprint));
	const at = input.at ?? new Date().toISOString();
	const appended: ArtifactLogEnvelope[] = [];
	for (const item of input.after) {
		if (unchanged.has(durableFingerprint(item))) {
			continue;
		}
		const event = artifactEventFrom({ roomId: input.roomId, item, at });
		if (!event) {
			continue;
		}
		appended.push(
			appendArtifactLogEvent(input.configParent, event, input.options),
		);
	}
	return appended;
}

/**
 * Rebuild a room's show backlog from the corpus (hub restart / cold join).
 *
 * A restored item has no `uri` — bytes never reach the log. `produce` is what
 * comes back, and `materializeShowItem` reproduces the render the next time
 * the director presents it; that is the whole reason the recipe rides the
 * record.
 *
 * Status is carried, not reset. `rankShowBacklog` competes only `planned` and
 * `ready`, so an artifact that already had its moment returns as `shown`: it
 * is listed, and a human or agent can present it again explicitly, but a
 * `drive.show.tick` right after a restart will not put a previous session's
 * diagram back on the stage ahead of the room's live work. Only a `planned`
 * artifact — one the room still owed — comes back as a candidate.
 *
 * `priority` and `intent` are not on the durable record, so a restored item
 * ranks at the floor. That is deliberate: restored context should never
 * outrank what the room is doing now.
 *
 * Order matches the Artifacts page: newest first, same as an enqueued backlog.
 */
export function restoreShowBacklogFromArtifacts(input: {
	configParent: string | undefined;
	roomId: string;
}): ShowBacklogItem[] {
	if (!input.configParent) {
		return [];
	}
	const events = readArtifactEvents(input.configParent, input.roomId);
	if (events.length === 0) {
		return [];
	}
	const captionByShowItemId = new Map<string, string>();
	for (const event of events) {
		captionByShowItemId.set(event.showItemId, event.caption);
	}
	const entries = sortArtifactDirectory(projectArtifactDirectory({ events }));
	return entries
		.filter((entry) => entry.status !== "cancelled")
		.map((entry) => ({
			id: entry.showItemId,
			ownerParticipantId: entry.ownerParticipantId,
			title: entry.title,
			intent: "",
			artifactKind: entry.artifactKind,
			mediaClass: entry.mediaClass,
			caption: captionByShowItemId.get(entry.showItemId) ?? "",
			produce: {
				tool: entry.produce.tool,
				...(entry.produce.templateId
					? { templateId: entry.produce.templateId }
					: {}),
				args: { ...entry.produce.args },
			},
			priority: 0,
			status:
				entry.status === "planned" ? ("planned" as const) : ("shown" as const),
			scoreReasons: ["restored_from_artifact_log"],
			tags: [...entry.tags],
		}));
}
