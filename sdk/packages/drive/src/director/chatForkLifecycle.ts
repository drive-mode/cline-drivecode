import type {
	ChatForkRecord,
	DoBacklogItem,
	DriveRoomLiveState,
} from "@cline/shared";
import { type ActiveForkClaim } from "./chatForkPolicy.js";
import { rankDoBacklog } from "./rankBacklogs.js";

export const DEFAULT_MAX_CONCURRENT_CHAT_FORKS = 2;

/**
 * Default ceiling on fork generations: a worker may not cause workers.
 * Room-global like DEFAULT_MAX_CONCURRENT_CHAT_FORKS, configurable upward via
 * assertForkLegal's `maxDepth` / the drive.fork.claim payload's `maxDepth`.
 */
export const DEFAULT_MAX_CHAT_FORK_DEPTH = 1;

export function activeForkClaimsFromRecords(
	forks: readonly ChatForkRecord[],
): ActiveForkClaim[] {
	return forks
		.filter(
			(fork) =>
				fork.lifecycle === "seeded" ||
				fork.lifecycle === "running" ||
				fork.lifecycle === "promoting",
		)
		.map((fork) => ({
			doItemId: fork.seed.doItemId,
			allowedPathPrefixes: fork.seed.allowedPathPrefixes,
			workspaceMode: fork.seed.workspace.mode,
		}));
}

export function countRunningChatForks(
	forks: readonly ChatForkRecord[],
): number {
	return forks.filter(
		(fork) =>
			fork.lifecycle === "seeded" ||
			fork.lifecycle === "running" ||
			fork.lifecycle === "promoting",
	).length;
}

export type ChatForkClaimIntent = {
	doItem: DoBacklogItem;
};

/**
 * Pure tick: pick claimable Do items that are not already forked, respecting
 * concurrency and dependsOn. Never forks for spotlight/mute/replan-only.
 */
export function tickChatForks(input: {
	director: DriveRoomLiveState["director"];
	chatForks: readonly ChatForkRecord[];
	maxConcurrent?: number;
}): ChatForkClaimIntent[] {
	const max = input.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_CHAT_FORKS;
	const running = countRunningChatForks(input.chatForks);
	const slots = Math.max(0, max - running);
	if (slots === 0) {
		return [];
	}

	// `refused` is excluded alongside dropped/archived: a depth refusal says
	// "not from this parent", not "this work is spoken for". Leaving it in
	// would keep the Do item claimed forever, so a legal first-generation
	// parent could never pick up work a worker was refused — turning a
	// generation bound into permanent work loss.
	const claimedDoIds = new Set(
		input.chatForks
			.filter(
				(fork) =>
					fork.lifecycle !== "dropped" &&
					fork.lifecycle !== "archived" &&
					fork.lifecycle !== "refused",
			)
			.map((fork) => fork.seed.doItemId),
	);
	const doneIds = new Set(
		input.director.doBacklog
			.filter((item) => item.status === "done")
			.map((item) => item.id),
	);

	const ranked = rankDoBacklog(input.director.doBacklog).filter((item) => {
		if (claimedDoIds.has(item.id)) {
			return false;
		}
		if (item.status !== "queued" && item.status !== "active") {
			return false;
		}
		return item.dependsOn.every((dep) => doneIds.has(dep));
	});

	return ranked.slice(0, slots).map((doItem) => ({ doItem }));
}

export function buildSeedUserMessage(seed: {
	title: string;
	goal: string;
	parentBriefing: string;
	allowedPathPrefixes: readonly string[];
}): string {
	const paths =
		seed.allowedPathPrefixes.length > 0
			? `\nAllowed paths: ${seed.allowedPathPrefixes.join(", ")}`
			: "";
	return [
		`[Drive ChatFork] ${seed.title}`,
		seed.goal,
		seed.parentBriefing ? `Briefing: ${seed.parentBriefing}` : "",
		paths.trim(),
	]
		.filter((line) => line.length > 0)
		.join("\n");
}
