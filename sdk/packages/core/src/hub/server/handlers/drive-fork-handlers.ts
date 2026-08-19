import {
	activeForkClaimsFromRecords,
	applyPromotePacket,
	buildSeedPacket,
	buildSeedUserMessage,
	countRunningChatForks,
	DEFAULT_MAX_CHAT_FORK_DEPTH,
	DEFAULT_MAX_CONCURRENT_CHAT_FORKS,
	IllegalChatForkError,
} from "@cline/drive";
import type {
	ChatForkRecord,
	DoBacklogItem,
	ForkReason,
	HubCommandEnvelope,
	HubReplyEnvelope,
	PromotePacket,
	SeedPacket,
	SeedWorkspace,
} from "@cline/shared";
import {
	createSessionId,
	DoBacklogItemSchema,
	ForkReasonSchema,
	PromotePacketSchema,
	SeedWorkspaceSchema,
} from "@cline/shared";
import {
	getDriveRoomStore,
	resetDriveRoomStoreForTests,
} from "../../collaboration";
import { runShowDirectorTick } from "../../driveShowRuntime";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(
	payload: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = payload?.[key];
	return typeof value === "boolean" ? value : undefined;
}

/**
 * Depth of `parentSessionId` itself, read from its own persisted session
 * metadata rather than the room's (ephemeral, restart-reset) chatForks list.
 * A session that was never a chat-fork worker (root/human session, or
 * unknown) is depth 0, so its children are first-generation (depth 1).
 *
 * A session that *is* a worker but carries no recorded depth counts as 1, not
 * 0. Every worker session created before this shipped is in exactly that
 * state, and reading them as roots would let their children claim as
 * first-generation — defeating the bound for precisely the sessions it exists
 * to catch.
 */
async function resolveParentForkDepth(
	ctx: HubTransportContext,
	parentSessionId: string,
): Promise<number> {
	try {
		const parentSession = await ctx.sessionHost.getSession?.(parentSessionId);
		const raw = parentSession?.metadata?.chatForkDepth;
		if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
			return raw;
		}
		return parentSession?.metadata?.chatFork === true ? 1 : 0;
	} catch {
		return 0;
	}
}

function publishRoom(
	ctx: HubTransportContext,
	room: ReturnType<ReturnType<typeof getDriveRoomStore>["getOrCreateLive"]>,
	extraEvent?: {
		event: "drive.fork.changed" | "drive.fork.promoted" | "drive.fork.dropped";
		payload: Record<string, unknown>;
	},
): void {
	ctx.publish(
		ctx.buildEvent("drive.room.changed", {
			room: room as unknown as Record<string, unknown>,
		}),
	);
	if (extraEvent) {
		ctx.publish(ctx.buildEvent(extraEvent.event, extraEvent.payload));
	}
}

function upsertFork(
	forks: readonly ChatForkRecord[],
	next: ChatForkRecord,
): ChatForkRecord[] {
	const without = forks.filter(
		(fork) => fork.workerSessionId !== next.workerSessionId,
	);
	return [...without, next];
}

/**
 * A depth-refused claim never gets a worker session, so with nothing else it
 * would read as the agent going quiet. Record it in chatForks (same live
 * state the Workers panel already renders from) and publish so it is visible
 * on the room's live trail instead of vanishing into the best-effort tick
 * catch in drive-room-handlers.ts.
 */
function recordRefusedFork(
	ctx: HubTransportContext,
	store: ReturnType<typeof getDriveRoomStore>,
	room: ReturnType<ReturnType<typeof getDriveRoomStore>["getOrCreateLive"]>,
	chatForks: readonly ChatForkRecord[],
	input: {
		roomId: string;
		doItem: DoBacklogItem;
		parentBriefing: string;
		assigneeParticipantId: string;
		parentSessionId: string;
		workspace: SeedWorkspace;
		allowedPathPrefixes: string[];
		linkedShowTemplateIds: string[];
		depth: number;
		refusal: { code: string; message: string };
	},
): void {
	const refused: ChatForkRecord = {
		workerSessionId: createSessionId("refused_"),
		lifecycle: "refused",
		seed: {
			doItemId: input.doItem.id,
			title: input.doItem.title,
			goal: input.doItem.goal,
			parentBriefing: input.parentBriefing,
			assigneeParticipantId: input.assigneeParticipantId,
			allowedPathPrefixes: input.allowedPathPrefixes,
			linkedShowTemplateIds: input.linkedShowTemplateIds,
			workspace: input.workspace,
			parentSessionId: input.parentSessionId,
			depth: input.depth,
		},
		promote: null,
		visibleToHuman: true,
		refusal: input.refusal,
	};
	const next = store.setLive({
		...room,
		chatForks: upsertFork(chatForks, refused),
	});
	publishRoom(ctx, next, {
		event: "drive.fork.changed",
		payload: {
			roomId: input.roomId,
			workerSessionId: refused.workerSessionId,
			lifecycle: refused.lifecycle,
			doItemId: input.doItem.id,
			refusal: input.refusal,
		},
	});
}

export async function handleDriveForkCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	switch (envelope.command) {
		case "drive.fork.claim":
			return await handleForkClaim(ctx, envelope);
		case "drive.fork.promote":
			return await handleForkPromote(ctx, envelope);
		case "drive.fork.cancel":
			return await handleForkCancel(ctx, envelope);
		case "drive.fork.list":
			return handleForkList(envelope);
		case "drive.fork.audit.get":
			return await handleForkAuditGet(ctx, envelope);
		case "drive.fork.retain.set":
			return handleForkRetainSet(ctx, envelope);
		default:
			return errorReply(
				envelope,
				"not_implemented",
				"Unknown drive fork command",
			);
	}
}

async function handleForkClaim(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parentSessionId = readString(envelope.payload, "parentSessionId");
	const assigneeParticipantId = readString(
		envelope.payload,
		"assigneeParticipantId",
	);
	const parentBriefing = readString(envelope.payload, "parentBriefing") ?? "";
	const reasonParse = ForkReasonSchema.safeParse(
		envelope.payload?.reason ?? "do_claim",
	);
	const workspaceParse = SeedWorkspaceSchema.safeParse(
		envelope.payload?.workspace ?? { mode: "shared_readonly" },
	);
	const doParse = DoBacklogItemSchema.safeParse(envelope.payload?.doItem);
	const allowedPathPrefixes = Array.isArray(
		envelope.payload?.allowedPathPrefixes,
	)
		? (envelope.payload?.allowedPathPrefixes as unknown[]).filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const linkedShowTemplateIds = Array.isArray(
		envelope.payload?.linkedShowTemplateIds,
	)
		? (envelope.payload?.linkedShowTemplateIds as unknown[]).filter(
				(entry): entry is string => typeof entry === "string",
			)
		: [];
	const worktreeIsolationAvailable =
		readBoolean(envelope.payload, "worktreeIsolationAvailable") ?? false;
	const maxConcurrent =
		typeof envelope.payload?.maxConcurrent === "number"
			? envelope.payload.maxConcurrent
			: DEFAULT_MAX_CONCURRENT_CHAT_FORKS;
	const maxDepth =
		typeof envelope.payload?.maxDepth === "number"
			? envelope.payload.maxDepth
			: DEFAULT_MAX_CHAT_FORK_DEPTH;

	if (
		!parentSessionId ||
		!assigneeParticipantId ||
		!reasonParse.success ||
		!workspaceParse.success ||
		!doParse.success
	) {
		return errorReply(
			envelope,
			"invalid_payload",
			"parentSessionId, assigneeParticipantId, doItem, and workspace are required",
		);
	}

	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const chatForks = room.chatForks ?? [];

	if (countRunningChatForks(chatForks) >= maxConcurrent) {
		return errorReply(
			envelope,
			"concurrency_cap",
			`At most ${maxConcurrent} concurrent chat forks`,
		);
	}

	const doItem: DoBacklogItem = doParse.data;
	const workspace: SeedWorkspace = workspaceParse.data;
	const reason: ForkReason = reasonParse.data;
	const parentDepth = await resolveParentForkDepth(ctx, parentSessionId);
	const depth = parentDepth + 1;

	let seed: SeedPacket;
	try {
		seed = buildSeedPacket({
			doItem,
			parentBriefing,
			assigneeParticipantId,
			parentSessionId,
			workspace,
			allowedPathPrefixes,
			linkedShowTemplateIds,
			reason,
			activeForks: activeForkClaimsFromRecords(chatForks),
			worktreeIsolationAvailable,
			depth,
			maxDepth,
		});
	} catch (error) {
		if (error instanceof IllegalChatForkError) {
			if (error.code === "depth_exceeded") {
				recordRefusedFork(ctx, store, room, chatForks, {
					roomId,
					doItem,
					parentBriefing,
					assigneeParticipantId,
					parentSessionId,
					workspace,
					allowedPathPrefixes,
					linkedShowTemplateIds,
					depth,
					refusal: { code: error.code, message: error.message },
				});
			}
			return errorReply(envelope, error.code, error.message);
		}
		throw error;
	}

	const requestedSessionId = createSessionId();
	const seedText = buildSeedUserMessage(seed);
	const initialMessages = [
		{
			role: "user" as const,
			content: seedText,
		},
	];

	let workerSessionId = requestedSessionId;
	try {
		const started = await ctx.sessionHost.startSession({
			interactive: false,
			sessionMetadata: {
				parentSessionId,
				isSubagent: true,
				chatFork: true,
				/**
				 * Persisted on the session record (SQLite-backed, survives hub
				 * restart) so a later claim spawned from *this* worker can read
				 * its own ancestry back via resolveParentForkDepth, instead of
				 * relying on the room's ephemeral chatForks list.
				 */
				chatForkDepth: seed.depth ?? depth,
				doItemId: seed.doItemId,
				assigneeParticipantId,
				roomId,
				source: "drive-chat-fork",
			},
			initialMessages: initialMessages as never[],
			config: {
				sessionId: requestedSessionId,
				providerId: "hub",
				modelId: "hub",
				cwd: seed.workspace.cwd ?? seed.workspace.worktreePath,
				// SessionManifestSchema requires these as booleans (no default);
				// a real (non-mocked) sessionHost rejects the start without them.
				// A chat-fork worker needs tools to do its assigned work, but —
				// consistent with "a worker may not cause workers" — does not get
				// the (currently otherwise-inert, per ADR-0023 Finding 1)
				// agent-spawn/team capabilities.
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			} as never,
		});
		workerSessionId = started.sessionId || requestedSessionId;
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to start worker session";
		return errorReply(envelope, "spawn_failed", message);
	}

	store.linkSession(workerSessionId, roomId);

	const record: ChatForkRecord = {
		workerSessionId,
		lifecycle: "running",
		seed,
		promote: null,
		visibleToHuman: false,
	};

	const doBacklog = room.director.doBacklog.some(
		(item) => item.id === doItem.id,
	)
		? room.director.doBacklog.map((item) =>
				item.id === doItem.id ? { ...item, status: "active" as const } : item,
			)
		: [...room.director.doBacklog, { ...doItem, status: "active" as const }];

	const next = store.setLive({
		...room,
		chatForks: upsertFork(chatForks, record),
		director: {
			...room.director,
			doBacklog,
		},
	});

	publishRoom(ctx, next, {
		event: "drive.fork.changed",
		payload: {
			roomId,
			workerSessionId,
			lifecycle: record.lifecycle,
			doItemId: seed.doItemId,
		},
	});

	return okReply(envelope, {
		room: next,
		seed,
		fork: record,
		auditHandle: workerSessionId,
	});
}

async function handleForkPromote(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const parsed = PromotePacketSchema.safeParse(envelope.payload?.promote);
	if (!parsed.success) {
		return errorReply(
			envelope,
			"invalid_payload",
			"promote must be a valid PromotePacket",
		);
	}
	const promote: PromotePacket = parsed.data;
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	const chatForks = room.chatForks ?? [];
	const existing = chatForks.find(
		(fork) => fork.workerSessionId === promote.workerSessionId,
	);
	if (!existing) {
		return errorReply(envelope, "fork_not_found", "Unknown workerSessionId");
	}

	const applied = applyPromotePacket({
		state: room.director,
		promote,
		linkedShowTemplateIds: existing.seed.linkedShowTemplateIds,
		ownerParticipantId: existing.seed.assigneeParticipantId,
	});

	const lifecycle = applied.lifecycle === "archived" ? "archived" : "dropped";
	const updated: ChatForkRecord = {
		...existing,
		lifecycle,
		promote,
		visibleToHuman: false,
	};

	if (lifecycle === "dropped") {
		await dropWorkerMessages(ctx, promote.workerSessionId);
	}

	await injectParentSummary(
		ctx,
		existing.seed.parentSessionId,
		applied.mainContextInjection,
	);

	const next = store.setLive({
		...room,
		chatForks: upsertFork(chatForks, updated),
		director: applied.state,
	});

	const tickShow = readBoolean(envelope.payload, "tickShow") === true;
	let presentedRoom = next;
	let presentedShowId: string | null = null;
	if (tickShow && applied.createdShowItemIds.length > 0) {
		const tick = runShowDirectorTick({
			room: next,
			preferShowId: applied.createdShowItemIds[0],
		});
		presentedRoom = store.setLive(tick.room);
		presentedShowId = tick.presented?.id ?? null;
		if (tick.presented) {
			ctx.publish(
				ctx.buildEvent("drive.show.presented", {
					showItemId: tick.presented.id,
					ownerParticipantId: tick.presented.ownerParticipantId,
					uri: tick.presented.uri,
					caption: tick.presented.caption,
					title: tick.presented.title,
				}),
			);
		}
	}

	publishRoom(ctx, presentedRoom, {
		event: "drive.fork.promoted",
		payload: {
			roomId,
			workerSessionId: promote.workerSessionId,
			doItemId: promote.doItemId,
			status: promote.status,
			lifecycle,
			mainContextInjection: applied.mainContextInjection,
			createdShowItemIds: applied.createdShowItemIds,
			presentedShowId,
		},
	});
	if (lifecycle === "dropped") {
		ctx.publish(
			ctx.buildEvent("drive.fork.dropped", {
				roomId,
				workerSessionId: promote.workerSessionId,
			}),
		);
	}

	return okReply(envelope, {
		room: presentedRoom,
		fork: updated,
		mainContextInjection: applied.mainContextInjection,
		createdShowItemIds: applied.createdShowItemIds,
		presentedShowId,
	});
}

async function handleForkCancel(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const workerSessionId = readString(envelope.payload, "workerSessionId");
	const summary = readString(envelope.payload, "summary") ?? "Worker cancelled";
	const retainForAudit =
		readBoolean(envelope.payload, "retainForAudit") ?? false;
	if (!workerSessionId) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workerSessionId is required",
		);
	}

	const store = getDriveRoomStore();
	const room = store.getOrCreateLive(roomId);
	const existing = (room.chatForks ?? []).find(
		(fork) => fork.workerSessionId === workerSessionId,
	);
	if (!existing) {
		return errorReply(envelope, "fork_not_found", "Unknown workerSessionId");
	}

	try {
		await ctx.sessionHost.abort(workerSessionId);
	} catch {
		// best-effort abort
	}

	return await handleForkPromote(ctx, {
		...envelope,
		command: "drive.fork.promote",
		payload: {
			roomId,
			promote: {
				workerSessionId,
				doItemId: existing.seed.doItemId,
				status: "cancelled",
				summary,
				decisions: [],
				showItemIds: [],
				eventRefs: [],
				auditHandle: workerSessionId,
				retainForAudit,
			} satisfies PromotePacket,
		},
	});
}

function handleForkList(envelope: HubCommandEnvelope): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const store = getDriveRoomStore();
	store.create(roomId);
	const room = store.getOrCreateLive(roomId);
	return okReply(envelope, {
		roomId,
		chatForks: room.chatForks ?? [],
	});
}

async function handleForkAuditGet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const auditHandle = readString(envelope.payload, "auditHandle");
	if (!auditHandle) {
		return errorReply(envelope, "invalid_payload", "auditHandle is required");
	}
	const store = getDriveRoomStore();
	const room = store.getOrCreateLive(roomId);
	const fork = (room.chatForks ?? []).find(
		(entry) =>
			entry.workerSessionId === auditHandle ||
			entry.promote?.auditHandle === auditHandle,
	);
	if (!fork) {
		return errorReply(envelope, "fork_not_found", "Unknown auditHandle");
	}

	let messages: unknown[] = [];
	if (fork.lifecycle !== "dropped") {
		try {
			messages = await ctx.sessionHost.readSessionMessages(
				fork.workerSessionId,
			);
		} catch {
			messages = [];
		}
	}

	return okReply(envelope, {
		fork,
		messages: fork.lifecycle === "dropped" ? [] : messages,
		summaryOnly: fork.lifecycle === "dropped",
		promote: fork.promote,
	});
}

function handleForkRetainSet(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const roomId = readString(envelope.payload, "roomId") ?? "default";
	const workerSessionId = readString(envelope.payload, "workerSessionId");
	const retainForAudit = readBoolean(envelope.payload, "retainForAudit");
	if (!workerSessionId || retainForAudit === undefined) {
		return errorReply(
			envelope,
			"invalid_payload",
			"workerSessionId and retainForAudit are required",
		);
	}
	const store = getDriveRoomStore();
	const room = store.getOrCreateLive(roomId);
	const existing = (room.chatForks ?? []).find(
		(fork) => fork.workerSessionId === workerSessionId,
	);
	if (!existing) {
		return errorReply(envelope, "fork_not_found", "Unknown workerSessionId");
	}
	if (!existing.promote) {
		return errorReply(envelope, "not_promoted", "Retain applies after promote");
	}

	const updated: ChatForkRecord = {
		...existing,
		lifecycle: retainForAudit ? "archived" : "dropped",
		promote: {
			...existing.promote,
			retainForAudit,
		},
	};
	const next = store.setLive({
		...room,
		chatForks: upsertFork(room.chatForks ?? [], updated),
	});
	publishRoom(ctx, next, {
		event: "drive.fork.changed",
		payload: {
			roomId,
			workerSessionId,
			lifecycle: updated.lifecycle,
		},
	});
	return okReply(envelope, { room: next, fork: updated });
}

async function injectParentSummary(
	ctx: HubTransportContext,
	parentSessionId: string,
	summary: string,
): Promise<void> {
	if (!summary.trim()) {
		return;
	}
	try {
		await ctx.sessionHost.runTurn({
			sessionId: parentSessionId,
			prompt: summary,
			delivery: "queue",
		});
	} catch {
		// Soft success: promote still applies director state even if inject is unavailable in tests.
	}
}

async function dropWorkerMessages(
	ctx: HubTransportContext,
	workerSessionId: string,
): Promise<void> {
	try {
		await ctx.sessionHost.deleteSession(workerSessionId);
	} catch {
		// best-effort GC
	}
}

/** @internal */
export function __resetDriveForkRoomsForTests(): void {
	resetDriveRoomStoreForTests();
}
