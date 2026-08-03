/**
 * Status Hub command handlers (ADR-0005).
 *
 * Publishing goes through the hub so every connected client sees the update
 * immediately (`status.updated`), while the durable copy lands in status.db
 * for anyone who was not listening. High and critical updates additionally
 * raise `ui.notify` so they reach the human rather than waiting to be found.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	isRepoChangelogSnapshot,
	REPO_CHANGELOG_SNAPSHOT_PATH,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import {
	StatusPrunePayloadSchema,
	StatusPublishInputSchema,
	StatusQuerySchema,
	type StatusUpdate,
	shouldPushToUser,
} from "@cline/shared";
import { z } from "zod";
import { getStatusService, type StatusService } from "../../../status";
import { errorReply, type HubTransportContext, okReply } from "./context";

const SubjectPayloadSchema = z.object({ subject: z.string().min(1) }).strict();

const SubjectsPayloadSchema = z
	.object({ limit: z.number().int().positive().max(1000).optional() })
	.strict();

const TasksSnapshotPayloadSchema = z
	.object({ sessionId: z.string().min(1).optional() })
	.strict();

/** Serialize an update for the wire (payloads are plain JSON records). */
function toPayload(update: StatusUpdate): Record<string, unknown> {
	return update as unknown as Record<string, unknown>;
}

function notifyPayload(update: StatusUpdate): Record<string, unknown> {
	return {
		title:
			update.priority === "critical"
				? `Blocked: ${update.agentName ?? update.subject}`
				: (update.agentName ?? update.subject),
		message: update.headline,
		severity: update.state === "failed" ? "error" : "warn",
		subject: update.subject,
		updateId: update.updateId,
		seq: update.seq,
	};
}

/**
 * Bridge every Status Hub publish onto the wire.
 *
 * Subscribing to the service rather than broadcasting from the command handler
 * matters: agents publish through the `report_status` tool, which calls
 * `StatusService.publish` directly and never touches `status.publish`. Handling
 * the broadcast only in the command handler left tool publishes invisible to
 * open views and skipped `ui.notify` entirely, so a `critical` status from an
 * agent never reached the human.
 *
 * Returns an unsubscribe function.
 */
export function attachStatusBroadcast(
	ctx: HubTransportContext,
	service: StatusService = getStatusService(),
): () => void {
	return service.subscribe((update) => {
		ctx.publish(
			ctx.buildEvent("status.updated", toPayload(update), update.sessionId),
		);
		if (shouldPushToUser(update.priority)) {
			ctx.publish(ctx.buildEvent("ui.notify", notifyPayload(update)));
		}
	});
}

/** Point the seeder at a snapshot explicitly, overriding path discovery. */
export const REPO_CHANGELOG_SNAPSHOT_ENV = "CLINE_REPO_CHANGELOG_SNAPSHOT";

export type RepoChangelogSeedResult = {
	/** The snapshot actually read, or null when none was found. */
	snapshotPath: string | null;
	/** Entries inserted by this call. */
	published: number;
	/** Entries left alone: already seeded, older than the seeded run, or invalid. */
	skipped: number;
};

const EMPTY_SEED_RESULT: RepoChangelogSeedResult = {
	snapshotPath: null,
	published: 0,
	skipped: 0,
};

function findSnapshotUpwards(startDir: string): string | null {
	let dir = resolve(startDir);
	for (;;) {
		const candidate = join(dir, REPO_CHANGELOG_SNAPSHOT_PATH);
		if (existsSync(candidate)) {
			return candidate;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

/**
 * Locate the committed repo changelog snapshot.
 *
 * An explicit env path wins; otherwise walk up from the working directory and
 * then from this module, which finds it in a monorepo checkout whether the hub
 * was started from the repo root or from a package. Returns null when the hub
 * is running outside a checkout that carries the snapshot — seeding is then a
 * no-op rather than an error.
 */
export function resolveRepoChangelogSnapshotPath(
	env: Record<string, string | undefined> = process.env,
	startDirs: readonly string[] = [process.cwd(), import.meta.dirname],
): string | null {
	const explicit = env[REPO_CHANGELOG_SNAPSHOT_ENV]?.trim();
	if (explicit) {
		return existsSync(explicit) ? resolve(explicit) : null;
	}
	for (const startDir of startDirs) {
		if (!startDir) {
			continue;
		}
		const found = findSnapshotUpwards(startDir);
		if (found) {
			return found;
		}
	}
	return null;
}

/**
 * Seed the Status Hub from the committed repo changelog snapshot.
 *
 * A fresh hub has an empty changelog, which makes the whole surface look
 * broken; this fills it with the repo's own history, tags and all.
 *
 * Only the entries after the newest already-seeded one are published. Plain
 * per-entry deduplication would be enough for a re-run of the same snapshot,
 * but a snapshot regenerated with a larger `--limit` *prepends* older commits:
 * publishing those would hand the oldest history the highest `seq`, and the
 * changelog reads newest `seq` first, so the whole feed would invert.
 *
 * Every failure is swallowed. A missing, malformed, or unreadable snapshot —
 * or a busy database — must never stop the hub from starting.
 */
export function seedRepoChangelog(
	service: StatusService = getStatusService(),
	options: { snapshotPath?: string | null } = {},
): RepoChangelogSeedResult {
	try {
		return seedRepoChangelogUnguarded(service, options);
	} catch {
		return EMPTY_SEED_RESULT;
	}
}

function seedRepoChangelogUnguarded(
	service: StatusService,
	options: { snapshotPath?: string | null },
): RepoChangelogSeedResult {
	const snapshotPath =
		options.snapshotPath === undefined
			? resolveRepoChangelogSnapshotPath()
			: options.snapshotPath;
	if (!snapshotPath) {
		return EMPTY_SEED_RESULT;
	}

	let snapshot: unknown;
	try {
		snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
	} catch {
		return { ...EMPTY_SEED_RESULT, snapshotPath };
	}
	if (!isRepoChangelogSnapshot(snapshot)) {
		return { ...EMPTY_SEED_RESULT, snapshotPath };
	}

	const parsed = snapshot.entries.map((raw) =>
		StatusPublishInputSchema.safeParse(raw),
	);
	let start = 0;
	for (let index = parsed.length - 1; index >= 0; index -= 1) {
		const entry = parsed[index];
		if (entry?.success && service.current(entry.data.subject)) {
			start = index + 1;
			break;
		}
	}

	let published = 0;
	let skipped = start;
	for (const entry of parsed.slice(start)) {
		if (!entry?.success) {
			skipped += 1;
			continue;
		}
		try {
			service.publish(entry.data);
			published += 1;
		} catch {
			skipped += 1;
		}
	}
	return { snapshotPath, published, skipped };
}

export async function handleStatusCommand(
	// Kept for symmetry with every other command handler. Broadcasting moved to
	// `attachStatusBroadcast`, so this handler no longer touches the wire.
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
	service: StatusService = getStatusService(),
): Promise<HubReplyEnvelope> {
	const payload = envelope.payload ?? {};

	try {
		switch (envelope.command) {
			case "status.publish": {
				const input = StatusPublishInputSchema.parse({
					source: "hub",
					...payload,
					sessionId:
						(payload.sessionId as string | undefined) ?? envelope.sessionId,
				});
				// Broadcast is handled by attachStatusBroadcast, which subscribes to
				// the service so tool publishes reach the wire too.
				const update = service.publish(input);
				return okReply(envelope, { update: toPayload(update) });
			}

			case "status.query": {
				const query = StatusQuerySchema.parse(payload);
				return okReply(envelope, {
					...service.query(query),
					ftsAvailable: service.ftsAvailable,
				});
			}

			case "status.board": {
				// Attention ordering matters even though the client groups by
				// state: with more subjects than fit on a page, recency order
				// could leave every blocked row off page 1 and the grouping
				// would then be quietly wrong.
				const query = StatusQuerySchema.parse({
					orderBy: "attention",
					includeHistoryCount: true,
					...payload,
					currentOnly: true,
				});
				return okReply(envelope, {
					...service.query(query),
					ftsAvailable: service.ftsAvailable,
				});
			}

			case "status.summary": {
				return okReply(envelope, {
					summary: service.summary() as unknown as Record<string, unknown>,
				});
			}

			case "status.current": {
				const { subject } = SubjectPayloadSchema.parse(payload);
				const update = service.current(subject);
				return okReply(envelope, {
					update: update ? toPayload(update) : null,
				});
			}

			case "status.subjects": {
				const { limit } = SubjectsPayloadSchema.parse(payload);
				return okReply(envelope, { subjects: service.subjects(limit) });
			}

			case "status.tasks_snapshot": {
				const { sessionId } = TasksSnapshotPayloadSchema.parse(payload);
				const targetSessionId = sessionId ?? envelope.sessionId;
				const teams = targetSessionId
					? await ctx.sessionHost
							.readTeamState?.(targetSessionId)
							.then((team) => (team ? [team] : []))
					: await ctx.sessionHost.listTeamStates?.();
				return okReply(envelope, {
					teams: (teams ?? []) as unknown as Record<string, unknown>,
				});
			}

			case "status.prune": {
				const prunePayload = StatusPrunePayloadSchema.parse(payload);
				return okReply(envelope, { deleted: service.prune(prunePayload) });
			}

			default:
				return errorReply(
					envelope,
					"unsupported_command",
					`Unsupported status command: ${envelope.command}`,
				);
		}
	} catch (error) {
		if (error instanceof z.ZodError) {
			return errorReply(
				envelope,
				"invalid_payload",
				error.issues[0]?.message ?? "invalid payload",
			);
		}
		return errorReply(
			envelope,
			"status_error",
			error instanceof Error ? error.message : "status command failed",
		);
	}
}
