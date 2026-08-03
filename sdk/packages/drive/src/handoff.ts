/**
 * Tier-0 Leave/End handoff assembler (DRV-RETURN-LOOP / DRV-LEAVE-END).
 *
 * Pure: typed room work events + BankSnapshot (+ optional SessionRollup
 * counts). Never invents facts. Forbids transcript/audio/utterance keys.
 *
 * Two consumers share this packet:
 * - End document → {@link formatHandoffNarration}
 * - Rejoin while-away line → {@link formatWhileAwayLine}
 */

import type {
	BankDriveEvent,
	BankSnapshot,
	DriveEvent,
} from "@cline/shared";
import type { SessionRollup } from "./sessionRollup.js";

/** Mirrors `@cline/shared` DRIVE_EVENT_FORBIDDEN_KEYS (value-import banned). */
const DRIVE_EVENT_FORBIDDEN_KEYS = [
	"audio",
	"rawAudio",
	"pcm",
	"wav",
	"transcript",
	"fullTranscript",
	"rawTranscript",
	"speechAudio",
	"uri",
	"dataUri",
	"svg",
	"image",
	"bytes",
	"thumbnail",
] as const;

/** Keys that must never appear on a Tier-0 handoff packet (privacy gate). */
export const HANDOFF_FORBIDDEN_KEYS = [
	...DRIVE_EVENT_FORBIDDEN_KEYS,
	"utterance",
	"utterances",
	"speech",
	"fullTranscript",
] as const;

export type HandoffDoneItem = {
	taskId: string;
	title?: string;
};

export type HandoffOpenItem = {
	taskId: string;
	title?: string;
	lastFailure?: string;
};

export type HandoffCommandEvidence = {
	command: string;
	failed?: boolean;
	exitCode?: number;
};

export type HandoffDecisionEvidence = {
	title: string;
	choice: string;
};

export type HandoffEvidence = {
	editPaths: string[];
	commands: HandoffCommandEvidence[];
	decisions: HandoffDecisionEvidence[];
};

export type HandoffCounts = {
	durationMs: number | null;
	tasksCompleted: number;
	midPlanAddCount: number;
	editCount: number;
	commandCount: number;
};

export type HandoffPacket = {
	done: HandoffDoneItem[];
	open: HandoffOpenItem[];
	resumeNext: {
		nowTaskId: string | null;
		nextTaskId: string | null;
		nowTitle: string | null;
		nextTitle: string | null;
	};
	evidence: HandoffEvidence;
	counts: HandoffCounts;
};

export type AssembleHandoffInput = {
	roomEvents: readonly DriveEvent[];
	bankSnapshot: BankSnapshot;
	/** Optional bank lifecycle log for done titles / completed ids. */
	bankEvents?: readonly BankDriveEvent[];
	/** Optional counts-only rollup (DRV-CALL-SESSION / DRV-TASK-METRICS). */
	rollup?: Pick<
		SessionRollup,
		"durationMs" | "tasksCompleted" | "midPlanAddCount" | "completedTaskIds"
	>;
	/**
	 * When set, only room work events at/after this ISO timestamp contribute
	 * to evidence (while-away catch-up window). Bank open/resume still use
	 * the live snapshot.
	 */
	sinceAt?: string;
};

function titleByTaskId(
	bankEvents: readonly BankDriveEvent[],
): Map<string, string> {
	const titles = new Map<string, string>();
	for (const event of bankEvents) {
		switch (event.type) {
			case "drive_task_opened":
				titles.set(event.taskId, event.title);
				break;
			case "drive_plan_step":
				if (!titles.has(event.taskId)) {
					titles.set(event.taskId, event.title);
				}
				break;
			case "drive_task_bound":
			case "drive_task_completed":
			case "drive_task_failed":
			case "drive_task_archived":
			case "drive_plan_activated":
			case "drive_plan_archived":
				break;
			default: {
				const _exhaustive: never = event;
				void _exhaustive;
				break;
			}
		}
	}
	return titles;
}

function filterRoomEvents(
	events: readonly DriveEvent[],
	sinceAt: string | undefined,
): DriveEvent[] {
	if (!sinceAt) {
		return [...events];
	}
	const sinceMs = Date.parse(sinceAt);
	if (!Number.isFinite(sinceMs)) {
		return [...events];
	}
	return events.filter((event) => {
		const at = Date.parse(event.at);
		return Number.isFinite(at) && at >= sinceMs;
	});
}

/**
 * Assemble a Tier-0 handoff packet from typed sources only.
 */
export function assembleHandoffPacket(
	input: AssembleHandoffInput,
): HandoffPacket {
	const bankEvents = input.bankEvents ?? [];
	const titles = titleByTaskId(bankEvents);
	const roomEvents = filterRoomEvents(input.roomEvents, input.sinceAt);
	const snap = input.bankSnapshot;

	const completedIds =
		input.rollup?.completedTaskIds ??
		bankEvents
			.filter((event) => event.type === "drive_task_completed")
			.map((event) => event.taskId);

	const done: HandoffDoneItem[] = [];
	const seenDone = new Set<string>();
	for (const taskId of completedIds) {
		if (seenDone.has(taskId)) {
			continue;
		}
		seenDone.add(taskId);
		const title = titles.get(taskId);
		done.push(title ? { taskId, title } : { taskId });
	}
	for (const event of roomEvents) {
		if (event.type === "work.plan_step" && event.status === "done") {
			const key = `plan:${event.title}`;
			if (seenDone.has(key)) {
				continue;
			}
			seenDone.add(key);
			done.push({ taskId: key, title: event.title });
		}
	}

	const open: HandoffOpenItem[] = snap.openTaskIds.map((taskId, index) => {
		const title =
			taskId === snap.nowTaskId
				? (snap.nowTitle ?? titles.get(taskId))
				: taskId === snap.nextTaskId
					? (snap.nextTitle ?? titles.get(taskId))
					: titles.get(taskId);
		const lastFailure =
			taskId === snap.nowTaskId && snap.nowLastFailure
				? snap.nowLastFailure
				: undefined;
		const item: HandoffOpenItem = { taskId };
		if (title) {
			item.title = title;
		}
		if (lastFailure) {
			item.lastFailure = lastFailure;
		}
		void index;
		return item;
	});

	const editPaths: string[] = [];
	const seenPaths = new Set<string>();
	const commands: HandoffCommandEvidence[] = [];
	const decisions: HandoffDecisionEvidence[] = [];

	for (const event of roomEvents) {
		switch (event.type) {
			case "work.edit": {
				if (!seenPaths.has(event.path)) {
					seenPaths.add(event.path);
					editPaths.push(event.path);
				}
				break;
			}
			case "work.command": {
				const entry: HandoffCommandEvidence = { command: event.command };
				if (event.failed === true) {
					entry.failed = true;
				}
				if (typeof event.exitCode === "number") {
					entry.exitCode = event.exitCode;
				}
				commands.push(entry);
				break;
			}
			case "work.decision": {
				decisions.push({ title: event.title, choice: event.choice });
				break;
			}
			case "work.test_result":
			case "work.plan_step":
			case "control.join":
			case "control.leave":
			case "control.end":
			case "control.mute":
			case "control.stage":
			case "control.mode":
			case "control.raise_hand":
			case "control.rename":
			case "control.address":
			case "conversation.message":
			case "conversation.narration":
			case "presence.speaking":
			case "presence.typing":
			case "presence.status":
			case "media.artifact":
				break;
			default: {
				const _exhaustive: never = event;
				void _exhaustive;
				break;
			}
		}
	}

	const tasksCompleted =
		input.rollup?.tasksCompleted ?? done.filter((d) => !d.taskId.startsWith("plan:")).length;
	const midPlanAddCount = input.rollup?.midPlanAddCount ?? 0;
	const durationMs = input.rollup?.durationMs ?? null;

	const packet: HandoffPacket = {
		done,
		open,
		resumeNext: {
			nowTaskId: snap.nowTaskId,
			nextTaskId: snap.nextTaskId,
			nowTitle: snap.nowTitle,
			nextTitle: snap.nextTitle,
		},
		evidence: {
			editPaths,
			commands,
			decisions,
		},
		counts: {
			durationMs,
			tasksCompleted,
			midPlanAddCount,
			editCount: editPaths.length,
			commandCount: commands.length,
		},
	};

	assertNoForbiddenHandoffKeys(packet);
	return packet;
}

/**
 * Walk a value and throw if any forbidden privacy key appears.
 */
export function assertNoForbiddenHandoffKeys(
	value: unknown,
	path: string[] = [],
): void {
	if (value === null || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenHandoffKeys(item, [...path, String(index)]);
		}
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if ((HANDOFF_FORBIDDEN_KEYS as readonly string[]).includes(key)) {
			throw new Error(
				`Handoff packet must not include forbidden key "${key}" at ${[...path, key].join(".") || "(root)"}`,
			);
		}
		assertNoForbiddenHandoffKeys(child, [...path, key]);
	}
}

/**
 * End-session narration: factual done / open / resume-next / evidence / counts.
 * No LLM invention.
 */
export function formatHandoffNarration(packet: HandoffPacket): string {
	const lines: string[] = ["Session handoff:"];

	if (packet.done.length > 0) {
		const labels = packet.done.map((item) => item.title ?? item.taskId);
		lines.push(`Done: ${labels.join("; ")}.`);
	} else {
		lines.push("Done: (none).");
	}

	if (packet.open.length > 0) {
		const labels = packet.open.map((item) => {
			const base = item.title ?? item.taskId;
			return item.lastFailure ? `${base} (last failure: ${item.lastFailure})` : base;
		});
		lines.push(`Open: ${labels.join("; ")}.`);
	} else {
		lines.push("Open: (none).");
	}

	const resume = formatResumeNext(packet);
	if (resume) {
		lines.push(resume);
	}

	const evidence = formatEvidenceClause(packet.evidence);
	if (evidence) {
		lines.push(`Evidence: ${evidence}.`);
	}

	const counts = formatCountsClause(packet.counts);
	if (counts) {
		lines.push(`Summary: ${counts}.`);
	}

	return lines.join(" ");
}

/**
 * Rejoin catch-up line (second consumer — not the End document).
 * Returns empty string when there is nothing factual to say.
 */
export function formatWhileAwayLine(packet: HandoffPacket): string {
	const parts: string[] = [];
	const evidence = formatEvidenceClause(packet.evidence);
	if (evidence) {
		parts.push(evidence);
	}
	if (packet.resumeNext.nowTitle) {
		parts.push(`open plan step: ${packet.resumeNext.nowTitle}`);
	} else if (packet.open[0]?.title || packet.open[0]?.taskId) {
		const open = packet.open[0];
		parts.push(`open: ${open.title ?? open.taskId}`);
	}
	if (parts.length === 0) {
		return "";
	}
	return `Since you left: ${parts.join("; ")}.`;
}

function formatResumeNext(packet: HandoffPacket): string | null {
	const { nowTitle, nextTitle, nowTaskId, nextTaskId } = packet.resumeNext;
	if (!nowTitle && !nextTitle && !nowTaskId && !nextTaskId) {
		return null;
	}
	const now = nowTitle ?? nowTaskId ?? "(none)";
	const next = nextTitle ?? nextTaskId ?? "(none)";
	return `Resume next: now ${now}; next ${next}.`;
}

function formatEvidenceClause(evidence: HandoffEvidence): string | null {
	const bits: string[] = [];
	if (evidence.editPaths.length > 0) {
		bits.push(`edited ${evidence.editPaths.join(", ")}`);
	}
	if (evidence.commands.length > 0) {
		const last = evidence.commands[evidence.commands.length - 1]!;
		const outcome =
			last.failed === true
				? "failed"
				: typeof last.exitCode === "number"
					? `exit ${last.exitCode}`
					: "ok";
		bits.push(
			evidence.commands.length === 1
				? `ran ${last.command} (${outcome})`
				: `${evidence.commands.length} commands (last: ${last.command}, ${outcome})`,
		);
	}
	if (evidence.decisions.length > 0) {
		const last = evidence.decisions[evidence.decisions.length - 1]!;
		bits.push(`decision ${last.title}: ${last.choice}`);
	}
	if (bits.length === 0) {
		return null;
	}
	return bits.join("; ");
}

function formatCountsClause(counts: HandoffCounts): string | null {
	const bits: string[] = [];
	if (counts.durationMs != null) {
		const minutes = Math.round(counts.durationMs / 60_000);
		bits.push(
			minutes > 0
				? `${minutes} min`
				: `${Math.round(counts.durationMs / 1000)}s`,
		);
	}
	if (counts.tasksCompleted > 0) {
		bits.push(`${counts.tasksCompleted} completed`);
	}
	if (counts.midPlanAddCount > 0) {
		bits.push(`${counts.midPlanAddCount} plan edits`);
	}
	if (counts.editCount > 0) {
		bits.push(`${counts.editCount} files`);
	}
	if (counts.commandCount > 0) {
		bits.push(`${counts.commandCount} commands`);
	}
	if (bits.length === 0) {
		return null;
	}
	return bits.join(", ");
}
