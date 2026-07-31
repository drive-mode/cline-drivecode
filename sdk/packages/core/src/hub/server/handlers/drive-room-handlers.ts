/**
 * Hub call_* command handlers (DRV-ROOM-MVP + share-screen work bridge).
 */

import {
	assembleHandoffPacket,
	formatHandoffNarration,
	formatWhileAwayLine,
	type HandoffPacket,
} from "@cline/drive";
import type {
	BankSnapshot,
	DriveEvent,
	HubCommandEnvelope,
	HubReplyEnvelope,
	Participant,
	RoomSnapshot,
	StageSharer,
} from "@cline/shared";
import {
	AddressSetSchema,
	DriveSubModeSchema,
	ParticipantSchema,
	StageSharerSchema,
} from "@cline/shared";
import { z } from "zod";
import {
	clearDrivePauseAfterToolForSessions,
	getDriveRoomStore,
	rebindJsonlRoomEventLog,
	setDrivePauseAfterTool,
	syncDrivePauseAfterToolForRoom,
	type WorkRecordPayload,
	workRecordFromToolEvent,
} from "../../collaboration";
import { openWorkspaceBankStore } from "../../collaboration/workspaceBankStore";
import {
	captureHubRoomCommit,
	getHubDriveHarness,
} from "../../driveHarnessBinding";
import { errorReply, type HubTransportContext, okReply } from "./context";
import { runChatForkDirectorTick } from "./drive-fork-tick";

function linkedSessionIds(
	store: ReturnType<typeof getDriveRoomStore>,
	roomId: string,
): string[] {
	return [...(store.roomToSessions.get(roomId) ?? [])];
}

const RoomIdSchema = z.object({
	roomId: z.string().min(1),
});

const CallJoinPayloadSchema = z
	.object({
		roomId: z.string().min(1),
		human: z
			.object({
				id: z.string().min(1),
				displayName: z.string().min(1),
				role: z.enum(["host", "participant", "observer"]).optional(),
			})
			.strict(),
		agent: z
			.object({
				id: z.string().min(1),
				displayName: z.string().min(1),
				role: z.enum(["partner", "specialist", "recorder"]).optional(),
			})
			.strict(),
		activateDrive: z.boolean().optional(),
		/** Optional agent session for tool → stage.cards bridge. */
		sessionId: z.string().min(1).optional(),
		/** Workspace root for durable room event log (ARD-0013). */
		workspaceRoot: z.string().min(1).optional(),
		/** Optional raw participant join without createOrAttach façade. */
		participant: ParticipantSchema.optional(),
	})
	.strict();

const CallLeavePayloadSchema = RoomIdSchema.extend({
	participantId: z.string().min(1),
	reason: z.string().optional(),
}).strict();

const CallEndPayloadSchema = RoomIdSchema.extend({
	actorId: z.string().min(1).optional(),
	reason: z.string().optional(),
	workspaceRoot: z.string().min(1).optional(),
}).strict();

const CallMutePayloadSchema = RoomIdSchema.extend({
	participantId: z.string().min(1),
	muted: z.boolean(),
}).strict();

const CallRaiseHandPayloadSchema = RoomIdSchema.extend({
	participantId: z.string().min(1),
	raised: z.boolean(),
}).strict();

const CallRenameParticipantPayloadSchema = RoomIdSchema.extend({
	participantId: z.string().min(1),
	displayName: z.string().min(1),
}).strict();

const CallSetStagePayloadSchema = RoomIdSchema.extend({
	sharer: StageSharerSchema.nullable(),
	pin: z
		.object({
			kind: z.enum(["selection", "file", "terminal"]),
			label: z.string().min(1),
			ref: z.string().min(1).optional(),
		})
		.strict()
		.nullable()
		.optional(),
}).strict();

const CallSetAddressPayloadSchema = RoomIdSchema.extend({
	addressSet: AddressSetSchema,
}).strict();

const CallSetModePayloadSchema = RoomIdSchema.extend({
	subMode: DriveSubModeSchema,
	driveActive: z.boolean().optional(),
}).strict();

const CallAddRosterPackPayloadSchema = RoomIdSchema.extend({
	packId: z.string().min(1),
	workspaceRoot: z.string().min(1).optional(),
}).strict();

const CallRemoveRosterPackPayloadSchema = RoomIdSchema.extend({
	packId: z.string().min(1),
	workspaceRoot: z.string().min(1).optional(),
}).strict();

const WorkEditSchema = z
	.object({
		kind: z.literal("edit"),
		path: z.string().min(1),
		summary: z.string().optional(),
	})
	.strict();

const WorkCommandSchema = z
	.object({
		kind: z.literal("command"),
		command: z.string().min(1),
		failed: z.boolean().optional(),
		exitCode: z.number().int().optional(),
		summary: z.string().optional(),
	})
	.strict();

const WorkTestSchema = z
	.object({
		kind: z.literal("test_result"),
		label: z.string().min(1),
		passed: z.boolean(),
		summary: z.string().optional(),
	})
	.strict();

const CallRecordWorkPayloadSchema = z
	.object({
		roomId: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
		actorId: z.string().min(1).optional(),
		work: z
			.union([WorkEditSchema, WorkCommandSchema, WorkTestSchema])
			.optional(),
		tool: z
			.object({
				toolCallId: z.string().optional(),
				toolName: z.string().optional(),
				status: z.enum(["running", "completed", "failed"]).optional(),
				input: z.unknown().optional(),
				output: z.unknown().optional(),
				error: z.string().optional(),
				text: z.string().optional(),
			})
			.strict()
			.optional(),
	})
	.strict()
	.refine((value) => Boolean(value.roomId || value.sessionId), {
		message: "roomId or sessionId required",
	})
	.refine((value) => Boolean(value.work || value.tool), {
		message: "work or tool required",
	});

const CallGetRoomPayloadSchema = z
	.object({
		roomId: z.string().min(1).optional(),
		sessionId: z.string().min(1).optional(),
		/** Reconnect cursor: return events with seq > afterSeq. */
		afterSeq: z.number().int().nonnegative().optional(),
		workspaceRoot: z.string().min(1).optional(),
	})
	.strict()
	.refine((value) => Boolean(value.roomId || value.sessionId), {
		message: "roomId or sessionId required",
	});

function publishRoomEvent(
	ctx: HubTransportContext,
	roomId: string,
	snapshot: RoomSnapshot,
	event: unknown,
	seq: number,
): void {
	ctx.publish(
		ctx.buildEvent("room.event", {
			roomId,
			snapshot,
			event,
			seq,
		}),
	);
}

function publishRoomSnapshot(
	ctx: HubTransportContext,
	roomId: string,
	snapshot: RoomSnapshot,
	seq: number,
): void {
	ctx.publish(
		ctx.buildEvent("room.snapshot", {
			roomId,
			snapshot,
			seq,
		}),
	);
}

function snapshotPayload(
	snapshot: RoomSnapshot,
	seq: number,
	gaps: Array<{ seq: number; event: unknown }> = [],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		roomId: snapshot.roomId,
		snapshot,
		seq,
		...(gaps.length > 0 ? { events: gaps } : {}),
		...extra,
	};
}

function resolveRoomId(
	store: ReturnType<typeof getDriveRoomStore>,
	roomId: string | undefined,
	sessionId: string | undefined,
): string {
	if (roomId) {
		return roomId;
	}
	if (sessionId) {
		const linked = store.getRoomIdForSession(sessionId);
		if (linked) {
			return linked;
		}
		throw new Error(`room_not_found:session:${sessionId}`);
	}
	throw new Error("room_not_found:missing_id");
}

function resolveWorkPayload(payload: {
	work?: WorkRecordPayload;
	tool?: {
		toolCallId?: string;
		toolName?: string;
		status?: "running" | "completed" | "failed";
		input?: unknown;
		output?: unknown;
		error?: string;
		text?: string;
	};
}): WorkRecordPayload {
	if (payload.work) {
		return payload.work;
	}
	if (payload.tool) {
		const mapped = workRecordFromToolEvent(payload.tool);
		if (!mapped) {
			throw new Error("unsupported_tool_for_stage");
		}
		return mapped;
	}
	throw new Error("work_or_tool_required");
}

function ensureEventLog(
	store: ReturnType<typeof getDriveRoomStore>,
	workspaceRoot: string | undefined,
): void {
	if (!workspaceRoot) {
		return;
	}
	// Prefer the explicit workspace root. An earlier harness bind may have
	// attached under tmpdir() before workspaceRoot was known; rebind migrates
	// prior durable records so seq stays monotonic.
	rebindJsonlRoomEventLog(store, workspaceRoot);
}

function emptyBankSnapshot(): BankSnapshot {
	return {
		activePlanId: null,
		openTaskIds: [],
		nowTaskId: null,
		nextTaskId: null,
		nowTitle: null,
		nextTitle: null,
		nowLastFailure: null,
	};
}

function readRoomEvents(
	store: ReturnType<typeof getDriveRoomStore>,
	roomId: string,
): DriveEvent[] {
	const log = store.getEventLog();
	if (!log) {
		return [];
	}
	return log.readSinceSync(roomId, 0).map((record) => record.event);
}

async function loadBankSnapshot(
	workspaceRoot: string | undefined,
	roomId: string,
): Promise<BankSnapshot> {
	if (!workspaceRoot) {
		return emptyBankSnapshot();
	}
	const callSessionId = getDriveRoomStore().getActiveCallSessionId(roomId);
	const bank = openWorkspaceBankStore(workspaceRoot, {
		roomId,
		callSessionId,
	});
	return bank.getSnapshot();
}

function lastHumanLeaveAt(
	events: readonly DriveEvent[],
	participantId?: string,
): string | null {
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event?.type !== "control.leave") {
			continue;
		}
		if (participantId && event.participantId !== participantId) {
			continue;
		}
		return event.at;
	}
	return null;
}

function buildWhileAwayNote(input: {
	roomEvents: readonly DriveEvent[];
	bankSnapshot: BankSnapshot;
	sinceAt: string;
}): string {
	const packet = assembleHandoffPacket({
		roomEvents: input.roomEvents,
		bankSnapshot: input.bankSnapshot,
		sinceAt: input.sinceAt,
	});
	return formatWhileAwayLine(packet);
}

function mintHandoffNarration(input: {
	store: ReturnType<typeof getDriveRoomStore>;
	roomId: string;
	actorId?: string;
	packet: HandoffPacket;
}): {
	snapshot: RoomSnapshot;
	event: DriveEvent;
	seq: number;
	text: string;
} {
	const text = formatHandoffNarration(input.packet);
	const session = input.store.getActiveCallSession(input.roomId);
	const committed = input.store.commit({
		schemaVersion: 1,
		id: `narration_${crypto.randomUUID()}`,
		roomId: input.roomId,
		at: new Date().toISOString(),
		actorId: input.actorId,
		callSessionId: session?.callSessionId,
		type: "conversation.narration",
		track: "conversation",
		text,
	});
	return { ...committed, text };
}

export async function handleDriveRoomCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const store = getDriveRoomStore();
	try {
		switch (envelope.command) {
			case "call_join": {
				const payload = CallJoinPayloadSchema.parse(envelope.payload ?? {});
				ensureEventLog(store, payload.workspaceRoot);
				if (!store.get(payload.roomId) && store.getEventLog()) {
					store.hydrateFromLogSync(payload.roomId);
				}
				const priorEvents = readRoomEvents(store, payload.roomId);
				const priorSnapshot = store.get(payload.roomId);
				const humanId = payload.participant?.id ?? payload.human.id;
				const humanWasSeated =
					priorSnapshot?.participants.some(
						(participant) =>
							participant.kind === "human" && participant.id === humanId,
					) ?? false;
				const leaveAt = lastHumanLeaveAt(priorEvents, humanId);
				const isRejoin = Boolean(leaveAt) && !humanWasSeated;

				let result: { snapshot: RoomSnapshot; seq: number };
				if (payload.participant) {
					store.create(payload.roomId);
					const committed = store.join({
						roomId: payload.roomId,
						participant: payload.participant as Participant,
						sessionId: payload.sessionId,
					});
					result = { snapshot: committed.snapshot, seq: committed.seq };
					publishRoomEvent(
						ctx,
						payload.roomId,
						committed.snapshot,
						committed.event,
						committed.seq,
					);
				} else {
					const { harness } = getHubDriveHarness({
						store,
						configParent: payload.workspaceRoot,
					});
					const snapshot = await harness.rooms.createOrAttach({
						roomId: payload.roomId,
						humanId: payload.human.id,
						humanDisplayName: payload.human.displayName,
						humanRole: payload.human.role,
						partner: {
							id: payload.agent.id,
							displayName: payload.agent.displayName,
							role: payload.agent.role,
						},
						activateDrive: payload.activateDrive,
					});
					const seq = store.lastSeq(payload.roomId);
					publishRoomSnapshot(ctx, payload.roomId, snapshot, seq);
					result = { snapshot, seq };
				}
				if (payload.sessionId) {
					store.linkSession(payload.sessionId, payload.roomId);
				}

				let whileAwayNote: string | undefined;
				if (isRejoin && leaveAt) {
					const bankSnapshot = await loadBankSnapshot(
						payload.workspaceRoot,
						payload.roomId,
					);
					const note = buildWhileAwayNote({
						roomEvents: priorEvents,
						bankSnapshot,
						sinceAt: leaveAt,
					});
					if (note) {
						whileAwayNote = note;
					}
				}

				return okReply(
					envelope,
					snapshotPayload(result.snapshot, result.seq, [], {
						callSessionId: store.getActiveCallSessionId(payload.roomId),
						...(whileAwayNote ? { whileAwayNote } : {}),
					}),
				);
			}
			case "call_leave": {
				const payload = CallLeavePayloadSchema.parse(envelope.payload ?? {});
				const sessionIds = linkedSessionIds(store, payload.roomId);
				const committed = store.leave(payload);
				const remaining = store.get(payload.roomId);
				if (!remaining || sessionIds.length === 0) {
					clearDrivePauseAfterToolForSessions(sessionIds);
				} else {
					syncDrivePauseAfterToolForRoom(committed.snapshot, sessionIds);
				}
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq, [], {
						callSessionId:
							committed.event.type === "control.leave"
								? committed.event.callSessionId
								: undefined,
						durationMs:
							committed.event.type === "control.leave"
								? committed.event.durationMs
								: undefined,
					}),
				);
			}
			case "call_end": {
				const payload = CallEndPayloadSchema.parse(envelope.payload ?? {});
				ensureEventLog(store, payload.workspaceRoot);
				if (!store.get(payload.roomId) && store.getEventLog()) {
					store.hydrateFromLogSync(payload.roomId);
				}
				if (!store.get(payload.roomId) && !store.isEnded(payload.roomId)) {
					return errorReply(
						envelope,
						"room_not_found",
						`room_not_found:${payload.roomId}`,
					);
				}

				// Idempotent: second end returns prior close without re-narrating.
				if (store.isEnded(payload.roomId)) {
					const snapshot = store.getOrThrow(payload.roomId);
					return okReply(
						envelope,
						snapshotPayload(snapshot, store.lastSeq(payload.roomId), [], {
							ended: true,
							idempotent: true,
						}),
					);
				}

				const sessionIds = linkedSessionIds(store, payload.roomId);
				// Pause-after-tool while we assemble handoff (DRV-LEAVE-END).
				for (const sessionId of sessionIds) {
					setDrivePauseAfterTool(sessionId, true);
				}

				const roomEvents = readRoomEvents(store, payload.roomId);
				const bankSnapshot = await loadBankSnapshot(
					payload.workspaceRoot,
					payload.roomId,
				);
				const packet = assembleHandoffPacket({
					roomEvents,
					bankSnapshot,
				});
				const narration = mintHandoffNarration({
					store,
					roomId: payload.roomId,
					actorId: payload.actorId,
					packet,
				});
				publishRoomEvent(
					ctx,
					payload.roomId,
					narration.snapshot,
					narration.event,
					narration.seq,
				);

				const ended = store.end({
					roomId: payload.roomId,
					actorId: payload.actorId,
					reason: payload.reason,
				});
				clearDrivePauseAfterToolForSessions(sessionIds);
				publishRoomEvent(
					ctx,
					payload.roomId,
					ended.snapshot,
					ended.event,
					ended.seq,
				);

				return okReply(
					envelope,
					snapshotPayload(ended.snapshot, ended.seq, [], {
						ended: true,
						handoff: packet,
						handoffNarration: narration.text,
						callSessionId:
							ended.event.type === "control.end"
								? ended.event.callSessionId
								: undefined,
						durationMs:
							ended.event.type === "control.end"
								? ended.event.durationMs
								: undefined,
					}),
				);
			}
			case "call_mute": {
				const payload = CallMutePayloadSchema.parse(envelope.payload ?? {});
				const committed = store.mute(payload);
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_raise_hand": {
				const payload = CallRaiseHandPayloadSchema.parse(
					envelope.payload ?? {},
				);
				const { harness } = getHubDriveHarness({ store });
				const committed = await captureHubRoomCommit(store, () =>
					harness.rooms.raiseHand(
						payload.roomId,
						payload.participantId,
						payload.raised,
					),
				);
				if (!committed) {
					return errorReply(
						envelope,
						"commit_failed",
						"raiseHand did not produce a room commit",
					);
				}
				syncDrivePauseAfterToolForRoom(
					committed.snapshot,
					linkedSessionIds(store, payload.roomId),
				);
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_rename_participant": {
				const payload = CallRenameParticipantPayloadSchema.parse(
					envelope.payload ?? {},
				);
				const committed = store.renameParticipant(payload);
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_set_stage": {
				const payload = CallSetStagePayloadSchema.parse(envelope.payload ?? {});
				const { harness } = getHubDriveHarness({ store });
				const committed = await captureHubRoomCommit(store, () =>
					harness.rooms.setSharer(
						payload.roomId,
						payload.sharer as StageSharer | null,
						payload.pin,
					),
				);
				if (!committed) {
					return errorReply(
						envelope,
						"commit_failed",
						"setStage did not produce a room commit",
					);
				}
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_set_address": {
				const payload = CallSetAddressPayloadSchema.parse(
					envelope.payload ?? {},
				);
				store.create(payload.roomId);
				const { harness } = getHubDriveHarness({ store });
				const committed = await captureHubRoomCommit(store, () =>
					harness.rooms.setAddress(payload.roomId, payload.addressSet),
				);
				if (!committed) {
					return errorReply(
						envelope,
						"commit_failed",
						"setAddress did not produce a room commit",
					);
				}
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_set_mode": {
				const payload = CallSetModePayloadSchema.parse(envelope.payload ?? {});
				const { harness } = getHubDriveHarness({ store });
				const committed = await captureHubRoomCommit(store, () =>
					harness.rooms.setSubMode(
						payload.roomId,
						payload.subMode,
						payload.driveActive,
					),
				);
				if (!committed) {
					return errorReply(
						envelope,
						"commit_failed",
						"setMode did not produce a room commit",
					);
				}
				publishRoomEvent(
					ctx,
					payload.roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_record_work": {
				const payload = CallRecordWorkPayloadSchema.parse(
					envelope.payload ?? {},
				);
				const roomId = resolveRoomId(store, payload.roomId, payload.sessionId);
				const work = resolveWorkPayload(payload);
				const committed = store.recordWork({
					roomId,
					work,
					actorId: payload.actorId,
					eventId: payload.tool?.toolCallId
						? `work_${payload.tool.toolCallId}`
						: undefined,
				});
				publishRoomEvent(
					ctx,
					roomId,
					committed.snapshot,
					committed.event,
					committed.seq,
				);
				const live = store.getOrCreateLive(roomId);
				const ownerParticipantId =
					live.spotlightParticipantId ??
					live.seatedParticipantIds[0] ??
					payload.actorId ??
					"system";
				const { harness } = getHubDriveHarness({ store });
				const planner = await harness.shows.planFromWork(
					roomId,
					work.kind,
					ownerParticipantId,
				);
				const planned = planner.plannedShows ?? [];
				if (planned.length > 0) {
					const nextLive = planner.liveRoom as Record<string, unknown>;
					ctx.publish(
						ctx.buildEvent("drive.room.changed", {
							room: nextLive,
						}),
					);
					for (const item of planned) {
						ctx.publish(
							ctx.buildEvent("drive.show.planned", {
								showItemId: item.id,
								ownerParticipantId: item.ownerParticipantId,
								status: item.status,
								title: item.title,
								priority: item.priority,
								scoreReasons: item.scoreReasons,
								plannerReasons: planner.plannerReasons,
							}),
						);
					}
					if (planner.presented) {
						const caption =
							planner.scriptBeat?.showItemId === planner.presented.id
								? planner.scriptBeat.say
								: planner.presented.caption;
						ctx.publish(
							ctx.buildEvent("drive.show.presented", {
								showItemId: planner.presented.id,
								ownerParticipantId: planner.presented.ownerParticipantId,
								uri: planner.presented.uri,
								caption,
								title: planner.presented.title,
							}),
						);
					}
					if (planner.scriptBeat) {
						const nextDirector = (
							nextLive as {
								director?: {
									stickyShowIds?: string[];
									activeScript?: { scriptId?: string } | null;
								};
							}
						).director;
						ctx.publish(
							ctx.buildEvent("drive.script.beat", {
								beatId: planner.scriptBeat.beatId,
								say: planner.scriptBeat.say,
								showItemId: planner.scriptBeat.showItemId,
								stickyShowIds: nextDirector?.stickyShowIds ?? [],
								activeScriptId: nextDirector?.activeScript?.scriptId ?? null,
							}),
						);
					}
				}
				void runChatForkDirectorTick(ctx, {
					roomId,
					parentSessionId: payload.sessionId,
				}).catch(() => {
					// tick is best-effort; claim failures must not fail work record
				});
				return okReply(
					envelope,
					snapshotPayload(committed.snapshot, committed.seq),
				);
			}
			case "call_add_roster_pack": {
				const payload = CallAddRosterPackPayloadSchema.parse(
					envelope.payload ?? {},
				);
				ensureEventLog(store, payload.workspaceRoot);
				store.create(payload.roomId);
				const configParent = payload.workspaceRoot;
				const beforeIds = new Set(
					(store.get(payload.roomId)?.participants ?? []).map((p) => p.id),
				);
				const { harness } = getHubDriveHarness({
					store,
					configParent,
				});
				const snapshot = await harness.rooms.addRosterPack(
					payload.roomId,
					payload.packId,
				);
				const seq = store.lastSeq(payload.roomId);
				publishRoomSnapshot(ctx, payload.roomId, snapshot, seq);
				const seated = snapshot.participants
					.filter((p) => p.kind === "agent" && !beforeIds.has(p.id))
					.map((p) => p.id);
				// Seat sources are tagged with the lookup packId argument (not pack.id).
				const seatedPackId = payload.packId;
				const alreadyPresent = snapshot.participants
					.filter(
						(p) =>
							p.kind === "agent" &&
							beforeIds.has(p.id) &&
							p.seatSources.some(
								(source) =>
									source.kind === "pack" && source.packId === seatedPackId,
							),
					)
					.map((p) => p.id);
				return okReply(envelope, {
					...snapshotPayload(snapshot, seq),
					seated,
					alreadyPresent,
					missing: [],
					truncated: false,
				});
			}
			case "call_remove_roster_pack": {
				const payload = CallRemoveRosterPackPayloadSchema.parse(
					envelope.payload ?? {},
				);
				ensureEventLog(store, payload.workspaceRoot);
				store.create(payload.roomId);
				const configParent = payload.workspaceRoot;
				const { harness } = getHubDriveHarness({
					store,
					configParent,
				});
				const snapshot = await harness.rooms.removeRosterPack(
					payload.roomId,
					payload.packId,
				);
				const seq = store.lastSeq(payload.roomId);
				publishRoomSnapshot(ctx, payload.roomId, snapshot, seq);
				return okReply(envelope, snapshotPayload(snapshot, seq));
			}
			case "call_get_room": {
				const payload = CallGetRoomPayloadSchema.parse(envelope.payload ?? {});
				ensureEventLog(store, payload.workspaceRoot);
				const roomId = resolveRoomId(store, payload.roomId, payload.sessionId);
				if (!store.get(roomId) && store.getEventLog()) {
					store.hydrateFromLogSync(roomId);
				}
				const snapshot = store.getOrThrow(roomId);
				const seq = store.lastSeq(roomId);
				const log = store.getEventLog();
				const gaps =
					log && payload.afterSeq !== undefined
						? log.readSinceSync(roomId, payload.afterSeq).map((r) => ({
								seq: r.seq,
								event: r.event,
							}))
						: [];
				return okReply(envelope, snapshotPayload(snapshot, seq, gaps));
			}
			default:
				return errorReply(
					envelope,
					"unsupported_call_command",
					`unsupported call command: ${envelope.command}`,
				);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "unsupported_tool_for_stage") {
			return errorReply(envelope, "unsupported_tool_for_stage", message);
		}
		const code = message.startsWith("room_not_found")
			? "room_not_found"
			: "call_command_failed";
		return errorReply(envelope, code, message);
	}
}
