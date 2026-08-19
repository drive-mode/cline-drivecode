/**
 * Opt-in “what Drive shipped” digest (DRV-SHIPPED-DIGEST).
 *
 * Pure builder from SessionRollups → Markdown / JSON. Default off — callers
 * must explicitly export. No phone-home; localhost file/clipboard only.
 * Forbids transcript / utterance / audio fields (inherits DRV-PRIVACY).
 */

import type { SessionRollup } from "./sessionRollup.js";

/** Keys that must never appear on a shipped digest (privacy gate). */
export const SHIPPED_DIGEST_FORBIDDEN_KEYS = [
	"utterance",
	"utterances",
	"transcript",
	"message",
	"messages",
	"speech",
	"audio",
	"fullTranscript",
	"recording",
] as const;

export type ShippedDigestTaskRef = {
	taskId: string;
	/** Optional title when known from bank — never utterance text. */
	title?: string;
};

export type ShippedDigestSession = {
	callSessionId: string;
	roomId: string | null;
	tasksCompleted: number;
	completedTasks: ShippedDigestTaskRef[];
	planCleanDrain: boolean;
	postSuccessPlanContinue: boolean;
	durationMs: number | null;
};

export type ShippedDigest = {
	kind: "shipped_digest";
	/** ISO timestamp when the digest was built (local). */
	generatedAt: string;
	sessionCount: number;
	tasksCompletedTotal: number;
	cleanDrainCount: number;
	continueCount: number;
	sessions: ShippedDigestSession[];
};

export type ShippedDigestRollupInput = Pick<
	SessionRollup,
	| "callSessionId"
	| "roomId"
	| "tasksCompleted"
	| "completedTaskIds"
	| "planCleanDrain"
	| "postSuccessPlanContinue"
	| "durationMs"
>;

export type BuildShippedDigestInput = {
	rollups: readonly ShippedDigestRollupInput[];
	/** Optional taskId → title map from local bank (ids only if omitted). */
	taskTitles?: ReadonlyMap<string, string> | Record<string, string>;
	/** Override clock for tests. */
	now?: () => Date;
};

function resolveTitle(
	taskId: string,
	taskTitles: BuildShippedDigestInput["taskTitles"],
): string | undefined {
	if (!taskTitles) {
		return undefined;
	}
	if (taskTitles instanceof Map) {
		const title = taskTitles.get(taskId)?.trim();
		return title || undefined;
	}
	const record = taskTitles as Record<string, string>;
	const title = record[taskId]?.trim();
	return title || undefined;
}

/**
 * Build a value-proof digest from local SessionRollups.
 * Does not phone home; does not emit core-events telemetry.
 */
export function buildShippedDigest(
	input: BuildShippedDigestInput,
): ShippedDigest {
	const now = input.now ?? (() => new Date());
	const sessions: ShippedDigestSession[] = input.rollups.map((rollup) => {
		const completedTasks: ShippedDigestTaskRef[] = rollup.completedTaskIds.map(
			(taskId) => {
				const title = resolveTitle(taskId, input.taskTitles);
				return title ? { taskId, title } : { taskId };
			},
		);
		return {
			callSessionId: rollup.callSessionId,
			roomId: rollup.roomId,
			tasksCompleted: rollup.tasksCompleted,
			completedTasks,
			planCleanDrain: rollup.planCleanDrain,
			postSuccessPlanContinue: rollup.postSuccessPlanContinue,
			durationMs: rollup.durationMs,
		};
	});

	return {
		kind: "shipped_digest",
		generatedAt: now().toISOString(),
		sessionCount: sessions.length,
		tasksCompletedTotal: sessions.reduce(
			(sum, session) => sum + session.tasksCompleted,
			0,
		),
		cleanDrainCount: sessions.filter((s) => s.planCleanDrain).length,
		continueCount: sessions.filter((s) => s.postSuccessPlanContinue).length,
		sessions,
	};
}

/** Reject digests that smuggle utterance-like fields (privacy). */
export function shippedDigestIsPrivate(value: unknown): boolean {
	return !findForbiddenShippedDigestKey(value);
}

/**
 * Walk a value and return the first forbidden privacy key path, or null.
 */
export function findForbiddenShippedDigestKey(
	value: unknown,
	path: string[] = [],
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const hit = findForbiddenShippedDigestKey(value[i], [...path, String(i)]);
			if (hit) {
				return hit;
			}
		}
		return null;
	}
	if (typeof value !== "object") {
		return null;
	}
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const lower = key.toLowerCase();
		for (const forbidden of SHIPPED_DIGEST_FORBIDDEN_KEYS) {
			if (lower === forbidden || lower.includes(forbidden)) {
				return [...path, key].join(".") || key;
			}
		}
		const hit = findForbiddenShippedDigestKey(child, [...path, key]);
		if (hit) {
			return hit;
		}
	}
	return null;
}

export function assertShippedDigestPrivate(digest: ShippedDigest): void {
	const hit = findForbiddenShippedDigestKey(digest);
	if (hit) {
		throw new Error(`Shipped digest must not include forbidden key at ${hit}`);
	}
}

function formatDuration(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) {
		return "—";
	}
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const rem = seconds % 60;
	return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}

/**
 * Human-readable Markdown digest for personal / lead review.
 */
export function formatShippedDigestMarkdown(digest: ShippedDigest): string {
	assertShippedDigestPrivate(digest);
	const lines: string[] = [
		"# What Drive shipped",
		"",
		`Generated: ${digest.generatedAt} (local)`,
		"",
		`Sessions: **${digest.sessionCount}** · Tasks completed: **${digest.tasksCompletedTotal}** · Clean-drain: **${digest.cleanDrainCount}** · Continued: **${digest.continueCount}**`,
		"",
	];
	if (digest.sessions.length === 0) {
		lines.push("_No local session rollups in the export window._", "");
		return lines.join("\n");
	}
	for (const session of digest.sessions) {
		const flags: string[] = [];
		if (session.planCleanDrain) {
			flags.push("S3 clean-drain");
		}
		if (session.postSuccessPlanContinue) {
			flags.push("E1 continued");
		}
		lines.push(`## Session \`${session.callSessionId}\``);
		lines.push("");
		lines.push(
			`- Room: \`${session.roomId ?? "—"}\` · Duration: ${formatDuration(session.durationMs)} · S2: ${session.tasksCompleted} done${flags.length ? ` · ${flags.join(" · ")}` : ""}`,
		);
		if (session.completedTasks.length === 0) {
			lines.push("- Completed tasks: —");
		} else {
			lines.push("- Completed tasks:");
			for (const task of session.completedTasks) {
				const label = task.title?.trim()
					? `${task.title.trim()} (\`${task.taskId}\`)`
					: `\`${task.taskId}\``;
				lines.push(`  - ${label}`);
			}
		}
		lines.push("");
	}
	lines.push("_Local export only — not telemetry, billing, or NPS._", "");
	return lines.join("\n");
}

/**
 * JSON digest for machine review / clipboard. Asserts privacy before stringify.
 */
export function formatShippedDigestJson(
	digest: ShippedDigest,
	pretty = true,
): string {
	assertShippedDigestPrivate(digest);
	return pretty ? JSON.stringify(digest, null, 2) : JSON.stringify(digest);
}
