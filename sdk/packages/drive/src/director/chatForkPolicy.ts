import type {
	DoBacklogItem,
	ForkReason,
	PromotePacket,
	SeedPacket,
	SeedWorkspace,
	ShowBacklogItem,
	StageDirectorState,
	WorkspaceIsolationMode,
} from "@cline/shared";
import { DEFAULT_MAX_CHAT_FORK_DEPTH } from "./chatForkLifecycle.js";
import { getShowTemplate, showItemFromTemplate } from "./showTemplates.js";

export class IllegalChatForkError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "IllegalChatForkError";
		this.code = code;
	}
}

export type ActiveForkClaim = {
	doItemId: string;
	allowedPathPrefixes: readonly string[];
	workspaceMode: WorkspaceIsolationMode;
};

export type AssertForkLegalInput = {
	reason: ForkReason;
	doItem: DoBacklogItem;
	workspace: SeedWorkspace;
	allowedPathPrefixes?: readonly string[];
	activeForks?: readonly ActiveForkClaim[];
	worktreeIsolationAvailable?: boolean;
	/**
	 * Generations from the nearest non-fork ancestor this fork would be
	 * created at. 1 = spawned by a root/human session. Defaults to 1 when
	 * omitted, matching "assume first generation" for callers that don't
	 * track ancestry.
	 */
	depth?: number;
	/** Ceiling for `depth`. Defaults to DEFAULT_MAX_CHAT_FORK_DEPTH. */
	maxDepth?: number;
};

function normalizePrefix(prefix: string): string {
	return prefix.replace(/\\/g, "/").replace(/\/+$/, "");
}

function prefixesOverlap(a: string, b: string): boolean {
	const left = normalizePrefix(a);
	const right = normalizePrefix(b);
	if (left === "" || right === "") {
		return true;
	}
	return (
		left.startsWith(`${right}/`) ||
		right.startsWith(`${left}/`) ||
		left === right
	);
}

/**
 * Pure gate for ChatForkLifecycle spawn. Rejects illegal reasons and unsafe
 * shared-cwd edit claims.
 */
export function assertForkLegal(input: AssertForkLegalInput): void {
	switch (input.reason) {
		case "do_claim":
		case "wave_item":
		case "review_gate":
			break;
		default: {
			const _exhaustive: never = input.reason;
			throw new IllegalChatForkError(
				"illegal_reason",
				`Unsupported fork reason: ${_exhaustive}`,
			);
		}
	}

	const depth = input.depth ?? 1;
	const maxDepth = input.maxDepth ?? DEFAULT_MAX_CHAT_FORK_DEPTH;
	if (depth > maxDepth) {
		throw new IllegalChatForkError(
			"depth_exceeded",
			`Fork depth ${depth} exceeds max depth ${maxDepth}: a worker may not cause workers by default`,
		);
	}

	if (input.doItem.status !== "queued" && input.doItem.status !== "active") {
		throw new IllegalChatForkError(
			"do_not_claimable",
			`Do item ${input.doItem.id} is ${input.doItem.status}, not claimable`,
		);
	}

	const prefixes = input.allowedPathPrefixes ?? [];

	if (input.workspace.mode === "worktree_isolated") {
		if (!input.worktreeIsolationAvailable) {
			throw new IllegalChatForkError(
				"worktree_unavailable",
				"worktree_isolated requires HostCapabilities.worktreeIsolation",
			);
		}
		if (!input.workspace.worktreePath) {
			throw new IllegalChatForkError(
				"worktree_path_required",
				"worktree_isolated requires worktreePath",
			);
		}
		return;
	}

	if (input.workspace.mode === "shared_readonly") {
		if (prefixes.length > 0) {
			throw new IllegalChatForkError(
				"readonly_paths",
				"shared_readonly forks must not claim edit path prefixes",
			);
		}
		return;
	}

	if (prefixes.length === 0) {
		throw new IllegalChatForkError(
			"paths_required",
			"path_disjoint forks require allowedPathPrefixes",
		);
	}

	const active = input.activeForks ?? [];
	for (const claim of active) {
		if (
			claim.workspaceMode === "shared_readonly" ||
			claim.workspaceMode === "worktree_isolated"
		) {
			continue;
		}
		for (const mine of prefixes) {
			for (const theirs of claim.allowedPathPrefixes) {
				if (prefixesOverlap(mine, theirs)) {
					throw new IllegalChatForkError(
						"path_overlap",
						`Path prefix ${mine} overlaps active fork ${claim.doItemId} (${theirs})`,
					);
				}
			}
		}
	}
}

export type BuildSeedPacketInput = {
	doItem: DoBacklogItem;
	parentBriefing: string;
	assigneeParticipantId: string;
	parentSessionId: string;
	workspace: SeedWorkspace;
	allowedPathPrefixes?: readonly string[];
	linkedShowTemplateIds?: readonly string[];
	reason?: ForkReason;
	activeForks?: readonly ActiveForkClaim[];
	worktreeIsolationAvailable?: boolean;
	/** See AssertForkLegalInput.depth. Defaults to 1 (first generation). */
	depth?: number;
	/** See AssertForkLegalInput.maxDepth. */
	maxDepth?: number;
};

export function buildSeedPacket(input: BuildSeedPacketInput): SeedPacket {
	const allowedPathPrefixes = [...(input.allowedPathPrefixes ?? [])];
	const depth = input.depth ?? 1;
	assertForkLegal({
		reason: input.reason ?? "do_claim",
		doItem: input.doItem,
		workspace: input.workspace,
		allowedPathPrefixes,
		activeForks: input.activeForks,
		worktreeIsolationAvailable: input.worktreeIsolationAvailable,
		depth,
		maxDepth: input.maxDepth,
	});

	return {
		doItemId: input.doItem.id,
		title: input.doItem.title,
		goal: input.doItem.goal,
		parentBriefing: input.parentBriefing,
		assigneeParticipantId: input.assigneeParticipantId,
		allowedPathPrefixes,
		linkedShowTemplateIds: [
			...((input.linkedShowTemplateIds &&
			input.linkedShowTemplateIds.length > 0
				? input.linkedShowTemplateIds
				: input.doItem.linkedShowTemplateIds) ?? []),
		],
		workspace: input.workspace,
		parentSessionId: input.parentSessionId,
		depth,
	};
}

export type ApplyPromotePacketResult = {
	state: StageDirectorState;
	mainContextInjection: string;
	lifecycle: "archived" | "dropped";
	createdShowItemIds: string[];
};

function markShowReady(item: ShowBacklogItem): ShowBacklogItem {
	if (item.status === "planned") {
		return { ...item, status: "ready" };
	}
	return item;
}

/**
 * Fold a PromotePacket into StageDirectorState. Does not splice worker
 * transcript messages into the room or main session history.
 *
 * Missing showItemIds that match a template id are created. Additional
 * linkedShowTemplateIds (from promote, seed fallback, or the Do item)
 * create ready rows when absent.
 */
export function applyPromotePacket(input: {
	state: StageDirectorState;
	promote: PromotePacket;
	/** Fallback when promote omits linkedShowTemplateIds (typically seed). */
	linkedShowTemplateIds?: readonly string[];
	ownerParticipantId?: string;
}): ApplyPromotePacketResult {
	const doItem = input.state.doBacklog.find(
		(item) => item.id === input.promote.doItemId,
	);
	const doBacklog = input.state.doBacklog.map((item) => {
		if (item.id !== input.promote.doItemId) {
			return item;
		}
		const status =
			input.promote.status === "done"
				? ("done" as const)
				: ("blocked" as const);
		return { ...item, status };
	});

	const ownerParticipantId =
		input.ownerParticipantId ??
		doItem?.assigneeParticipantId ??
		"system";

	const templateIds = [
		...(input.promote.linkedShowTemplateIds ?? []),
		...(input.linkedShowTemplateIds ?? []),
		...(doItem?.linkedShowTemplateIds ?? []),
	].filter((id, index, all) => all.indexOf(id) === index);

	let showBacklog = [...input.state.showBacklog];
	const createdShowItemIds: string[] = [];
	const existingIds = new Set(showBacklog.map((item) => item.id));

	for (const showItemId of input.promote.showItemIds) {
		const existingIndex = showBacklog.findIndex((item) => item.id === showItemId);
		if (existingIndex >= 0) {
			showBacklog[existingIndex] = markShowReady(showBacklog[existingIndex]!);
			continue;
		}
		const created = showItemFromTemplate({
			templateId: showItemId,
			showItemId,
			ownerParticipantId,
			linkedDoItemId: input.promote.doItemId,
		});
		if (created) {
			showBacklog = [created, ...showBacklog];
			createdShowItemIds.push(created.id);
			existingIds.add(created.id);
		}
	}

	for (const templateId of templateIds) {
		const already =
			showBacklog.find(
				(item) =>
					item.linkedDoItemId === input.promote.doItemId &&
					item.produce.templateId === templateId,
			) ??
			showBacklog.find(
				(item) =>
					item.linkedDoItemId === input.promote.doItemId &&
					item.id === templateId,
			);
		if (already) {
			showBacklog = showBacklog.map((item) =>
				item.id === already.id ? markShowReady(item) : item,
			);
			continue;
		}
		if (!getShowTemplate(templateId)) {
			continue;
		}
		const created = showItemFromTemplate({
			templateId,
			ownerParticipantId,
			linkedDoItemId: input.promote.doItemId,
		});
		if (!created || existingIds.has(created.id)) {
			continue;
		}
		showBacklog = [created, ...showBacklog];
		createdShowItemIds.push(created.id);
		existingIds.add(created.id);
	}

	const decisionBlock =
		input.promote.decisions.length > 0
			? `\nDecisions:\n${input.promote.decisions.map((d) => `- ${d}`).join("\n")}`
			: "";
	const mainContextInjection = [
		`[worker promote ${input.promote.workerSessionId}]`,
		`Do ${input.promote.doItemId}: ${input.promote.status}`,
		input.promote.summary,
		decisionBlock,
	]
		.filter((line) => line.length > 0)
		.join("\n");

	return {
		state: {
			...input.state,
			doBacklog,
			showBacklog,
		},
		mainContextInjection,
		lifecycle: input.promote.retainForAudit ? "archived" : "dropped",
		createdShowItemIds,
	};
}
