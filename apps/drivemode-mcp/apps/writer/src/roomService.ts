import {
	allowNarrationByRate,
	classifyInterrupt,
	isTitleGrantActive,
	narrate,
} from "@cline/drive";
import {
	type AddressSet,
	type AgentRuntimeBadge,
	AgentRuntimeBadgeSchema,
	type AgentTitleGrant,
	AgentTitleGrantSchema,
	type DriveEvent,
	type DriveSubMode,
	type Participant,
	type StageSharer,
} from "@cline/shared";
import { artifactsPack } from "@drivemode/packs-artifacts";
import { codingPack } from "@drivemode/packs-coding";
import { demoOpsPack } from "@drivemode/packs-demo-ops";
import { directionPack } from "@drivemode/packs-direction";
import { tasksPack } from "@drivemode/packs-tasks";
import type { WriterAppendResult, WriterStore } from "./store.js";

let eventCounter = 0;
function mintId(prefix: string): string {
	eventCounter += 1;
	return `${prefix}_${Date.now().toString(36)}_${eventCounter.toString(36)}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

const packs = {
	[codingPack.id]: codingPack,
	[demoOpsPack.id]: demoOpsPack,
	[tasksPack.id]: tasksPack,
	[artifactsPack.id]: artifactsPack,
	[directionPack.id]: directionPack,
} as const;

export type PackId = keyof typeof packs;

export function listPackIds(): PackId[] {
	return Object.keys(packs) as PackId[];
}

/**
 * Recorded outcomes of publishes that carried a client `opId`, so an
 * at-least-once caller (an MCP host that retries a call whose response was
 * lost after the append landed) gets the original outcome back instead of a
 * second, visibly duplicated card or message in the append-only log. Retries
 * cannot be deduplicated below this layer — only the caller knows two
 * requests are the same operation — so the id rides end-to-end and the single
 * writer keeps the memory. The cache shares fate with the log on purpose: a
 * restarted writer is a new log, and replaying a previous incarnation's
 * responses against it would be exactly the confusion `logId` exists to stop.
 */
const IDEMPOTENCY_CACHE_CAP = 512;

export function createRoomService(store: WriterStore) {
	const recordedPublishes = new Map<string, WriterAppendResult>();
	let recordedPublishReplays = 0;

	/**
	 * Replay the recorded result for `key`, or run `perform` and record it.
	 * Only successful appends are recorded — a thrown validation error never
	 * reached the log, so retrying it is harmless and should re-attempt.
	 * `perform` must be synchronous: check-then-record stays atomic on the
	 * event loop, so two racing duplicates cannot both append.
	 */
	function withIdempotency(
		key: string | undefined,
		perform: () => WriterAppendResult,
	): WriterAppendResult {
		if (!key) {
			return perform();
		}
		const recorded = recordedPublishes.get(key);
		if (recorded) {
			recordedPublishReplays += 1;
			return recorded;
		}
		const result = perform();
		recordedPublishes.set(key, result);
		if (recordedPublishes.size > IDEMPOTENCY_CACHE_CAP) {
			// Oldest-inserted first; a retry arrives seconds after the
			// original, not hundreds of publishes later.
			const oldest = recordedPublishes.keys().next().value;
			if (oldest !== undefined) {
				recordedPublishes.delete(oldest);
			}
		}
		return result;
	}

	function base(actorId?: string) {
		return {
			schemaVersion: 1 as const,
			id: mintId("evt"),
			roomId: store.roomId,
			at: nowIso(),
			actorId,
		};
	}

	function assertAgentParticipant(agentId: string): void {
		const participant = store
			.getState()
			.snapshot.participants.find((candidate) => candidate.id === agentId);
		if (participant?.kind !== "agent") {
			throw new Error(`Presenter must reference a seated agent: ${agentId}`);
		}
	}

	function activePresenterAt(at: string): AgentTitleGrant | undefined {
		return Object.values(store.getState().snapshot.titleGrantsById).find(
			(grant) => grant.title === "presenter" && isTitleGrantActive(grant, at),
		);
	}

	return {
		snapshot() {
			const state = store.getState();
			return {
				seq: Math.max(0, state.nextSeq - 1),
				logId: store.logId,
				room: state.snapshot,
				activePackId: state.activePackId,
				conversationFeed: state.conversationFeed,
			};
		},

		/** Operability readout for /health; not for room logic. */
		idempotencyStats() {
			return {
				recorded: recordedPublishes.size,
				replays: recordedPublishReplays,
			};
		},

		eventsSince(sinceSeq: number) {
			return store.eventsSince(sinceSeq);
		},

		join(participant: Participant, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.join",
				track: "control",
				participant,
			});
		},

		leave(participantId: string, reason?: string, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.leave",
				track: "control",
				participantId,
				reason,
			});
		},

		/**
		 * End the room. The kernel fold clears roster and stage and revokes
		 * every still-active title grant — coordinator-parity cleanup.
		 */
		end(reason?: string, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.end",
				track: "control",
				reason,
			});
		},

		setAddress(addressSet: AddressSet, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.address",
				track: "control",
				addressSet,
			});
		},

		setSharer(sharer: StageSharer | null, actorId?: string) {
			const eventBase = base(actorId);
			if (sharer?.kind === "agent") {
				const eligible = Object.values(
					store.getState().snapshot.titleGrantsById,
				).some(
					(grant) =>
						grant.agentId === sharer.participantId &&
						grant.title === "presenter" &&
						isTitleGrantActive(grant, eventBase.at),
				);
				if (!eligible) {
					throw new Error(
						"Agent stage sharing requires an active Presenter title grant",
					);
				}
			}
			return store.append({
				...eventBase,
				type: "control.stage",
				track: "control",
				sharer,
			});
		},

		setMode(subMode: DriveSubMode, driveActive?: boolean, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.mode",
				track: "control",
				subMode,
				driveActive,
			});
		},

		getMode() {
			const { snapshot } = store.getState();
			return {
				subMode: snapshot.subMode,
				driveActive: snapshot.driveActive,
			};
		},

		raiseHand(participantId: string, raised: boolean, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.raise_hand",
				track: "control",
				participantId,
				raised,
			});
		},

		interruptAck(
			participantId: string,
			input: {
				intent?: "stop" | "clarify" | "redirect" | "fresh";
				gist?: string;
				turnInFlight?: boolean;
				hardCancel?: boolean;
			},
			actorId?: string,
		) {
			const classification = classifyInterrupt({
				intent: input.intent,
				gist: input.gist,
				turnInFlight: input.turnInFlight ?? true,
				hardCancel: input.hardCancel,
			});
			return store.append({
				...base(actorId),
				type: "control.interrupt_ack",
				track: "control",
				participantId,
				action: classification.action,
				revise: classification.revise,
			});
		},

		setProfile(
			participantId: string,
			profile: {
				displayName?: string;
				ink?: string;
				runtimeBadge?: AgentRuntimeBadge;
			},
			actorId?: string,
		) {
			const results = [];
			if (profile.displayName) {
				results.push(
					store.append({
						...base(actorId),
						type: "control.rename",
						track: "control",
						participantId,
						displayName: profile.displayName,
					}),
				);
			}
			const state = store.getState();
			const runtimeBadge = profile.runtimeBadge
				? AgentRuntimeBadgeSchema.parse(profile.runtimeBadge)
				: state.snapshot.profilesByParticipantId[participantId]?.runtimeBadge;
			const nextProfiles = {
				...state.snapshot.profilesByParticipantId,
				[participantId]: {
					participantId,
					displayName:
						profile.displayName ??
						state.snapshot.profilesByParticipantId[participantId]?.displayName,
					ink:
						profile.ink ??
						state.snapshot.profilesByParticipantId[participantId]?.ink,
					runtimeBadge,
				},
			};
			state.snapshot = {
				...state.snapshot,
				profilesByParticipantId: nextProfiles,
			};
			const last = results.at(-1);
			return {
				seq: last?.seq ?? Math.max(0, state.nextSeq - 1),
				snapshot: state.snapshot,
				event: last?.event ?? (null as DriveEvent | null),
			};
		},

		grantTitle(input: {
			grantId: string;
			agentId: string;
			title: "presenter";
			scope: AgentTitleGrant["scope"];
			skillBundleRefs?: string[];
			resourceGrantRefs?: string[];
			delegatedAgentIds?: string[];
			permissions?: AgentTitleGrant["permissions"];
			expiresAt: string;
			actorId?: string;
		}) {
			const grantedAt = nowIso();
			const grant = AgentTitleGrantSchema.parse({
				id: input.grantId,
				agentId: input.agentId,
				title: input.title,
				scope: input.scope,
				skillBundleRefs: input.skillBundleRefs ?? [],
				resourceGrantRefs: input.resourceGrantRefs ?? [],
				delegatedAgentIds: input.delegatedAgentIds ?? [],
				permissions: input.permissions ?? ["stage.present"],
				grantedAt,
				expiresAt: input.expiresAt,
			});
			assertAgentParticipant(grant.agentId);
			const active = activePresenterAt(grantedAt);
			if (active && active.id !== grant.id) {
				throw new Error(
					`Presenter already owned by ${active.agentId}; use title_transfer`,
				);
			}
			const event: DriveEvent = {
				...base(input.actorId),
				at: grantedAt,
				type: "control.title_granted",
				track: "control",
				grant,
			};
			return store.append(event);
		},

		revokeTitle(input: {
			grantId: string;
			reason?: "revoked" | "expired" | "policy";
			actorId?: string;
		}) {
			const grant = store.getState().snapshot.titleGrantsById[input.grantId];
			if (!grant) {
				throw new Error(`Unknown title grant: ${input.grantId}`);
			}
			const revokedAt = nowIso();
			const event: DriveEvent = {
				...base(input.actorId),
				at: revokedAt,
				type: "control.title_revoked",
				track: "control",
				grantId: input.grantId,
				revokedAt,
				reason: input.reason ?? "revoked",
			};
			return store.append(event);
		},

		transferTitle(input: {
			fromGrantId: string;
			toGrantId: string;
			toAgentId: string;
			title: "presenter";
			skillBundleRefs?: string[];
			resourceGrantRefs?: string[];
			delegatedAgentIds?: string[];
			permissions?: AgentTitleGrant["permissions"];
			expiresAt: string;
			actorId?: string;
		}) {
			const transferredAt = nowIso();
			const from = store.getState().snapshot.titleGrantsById[input.fromGrantId];
			if (
				!from ||
				from.title !== input.title ||
				!isTitleGrantActive(from, transferredAt)
			) {
				throw new Error(`Inactive title grant: ${input.fromGrantId}`);
			}
			assertAgentParticipant(input.toAgentId);
			const toGrant = AgentTitleGrantSchema.parse({
				id: input.toGrantId,
				agentId: input.toAgentId,
				title: input.title,
				scope: from.scope,
				skillBundleRefs: input.skillBundleRefs ?? [],
				resourceGrantRefs: input.resourceGrantRefs ?? [],
				delegatedAgentIds: input.delegatedAgentIds ?? [],
				permissions: input.permissions ?? ["stage.present"],
				grantedAt: transferredAt,
				expiresAt: input.expiresAt,
			});
			const event: DriveEvent = {
				...base(input.actorId),
				at: transferredAt,
				type: "control.title_transferred",
				track: "control",
				title: input.title,
				fromGrantId: input.fromGrantId,
				toGrant,
				transferredAt,
			};
			return store.append(event);
		},

		setActivePack(packId: string) {
			if (!(packId in packs)) {
				throw new Error(
					`Unknown pack: ${packId}. Known: ${listPackIds().join(", ")}`,
				);
			}
			store.setActivePack(packId);
			return { activePackId: packId };
		},

		publishWork(input: {
			packId?: string;
			type: string;
			payload: unknown;
			actorId?: string;
			narrate?: boolean;
			/** Client retry key: same opId replays the recorded result. */
			opId?: string;
		}) {
			const packId = input.packId ?? store.getState().activePackId;
			const pack = packs[packId as PackId];
			if (!pack) {
				throw new Error(`Unknown pack: ${packId}`);
			}

			const validated = pack.validate(input.type, input.payload);
			let event: DriveEvent;

			if (packId === "coding") {
				const coding = validated as ReturnType<typeof codingPack.validate>;
				switch (coding.type) {
					case "work.edit":
						event = {
							...base(input.actorId),
							type: "work.edit",
							track: "work",
							...coding.payload,
						};
						break;
					case "work.command":
						event = {
							...base(input.actorId),
							type: "work.command",
							track: "work",
							...coding.payload,
						};
						break;
					case "work.test":
						event = {
							...base(input.actorId),
							type: "work.test_result",
							track: "work",
							...coding.payload,
						};
						break;
					case "work.plan":
						event = {
							...base(input.actorId),
							type: "work.plan_step",
							track: "work",
							...coding.payload,
						};
						break;
					case "work.decision": {
						const { title, choice, summary } = coding.payload;
						event = {
							...base(input.actorId),
							type: "work.decision",
							track: "work",
							title,
							choice,
							summary,
						};
						break;
					}
					case "work.generic":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					default: {
						const _exhaustive: never = coding;
						return _exhaustive;
					}
				}
			} else if (packId === "demo-ops") {
				const ops = validated as ReturnType<typeof demoOpsPack.validate>;
				switch (ops.type) {
					case "work.ops.alert":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: ops.type,
							title: ops.payload.title,
							summary:
								ops.payload.summary ??
								`${ops.payload.severity}${ops.payload.service ? ` · ${ops.payload.service}` : ""}`,
							payload: ops.payload,
						};
						break;
					case "work.ops.runbook_step":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: ops.type,
							title: ops.payload.title,
							summary:
								ops.payload.summary ??
								`${ops.payload.step} (${ops.payload.status})`,
							payload: ops.payload,
						};
						break;
					default: {
						const _exhaustive: never = ops;
						return _exhaustive;
					}
				}
			} else if (packId === "tasks") {
				const task = validated as ReturnType<typeof tasksPack.validate>;
				switch (task.type) {
					case "work.task.created":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: task.type,
							title: task.payload.title,
							summary:
								task.payload.summary ??
								`${task.payload.project} · ${task.payload.state}${task.payload.deps?.length ? ` · ${task.payload.deps.length} dep${task.payload.deps.length === 1 ? "" : "s"}` : ""}`,
							payload: task.payload,
						};
						break;
					case "work.task.state":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: task.type,
							title: task.payload.title ?? task.payload.taskId,
							summary: task.payload.summary ?? task.payload.state,
							payload: task.payload,
						};
						break;
					case "work.task.progress":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: task.type,
							title: task.payload.title ?? task.payload.taskId,
							summary:
								task.payload.summary ??
								`${Math.round(task.payload.progress * 100)}%`,
							payload: task.payload,
						};
						break;
					default: {
						const _exhaustive: never = task;
						return _exhaustive;
					}
				}
			} else if (packId === "artifacts") {
				const artifact = validated as ReturnType<typeof artifactsPack.validate>;
				switch (artifact.type) {
					case "work.artifact.created":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: artifact.type,
							title: artifact.payload.title,
							summary:
								artifact.payload.summary ??
								`${artifact.payload.kind} · ${"permanent" in artifact.payload.life ? "keeps" : `${artifact.payload.life.ttlDays}d ttl`}${artifact.payload.sizeKb != null ? ` · ${artifact.payload.sizeKb} KB` : ""}`,
							payload: artifact.payload,
						};
						break;
					case "work.artifact.superseded":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: artifact.type,
							title: artifact.payload.title ?? artifact.payload.artifactId,
							summary:
								artifact.payload.summary ??
								`superseded by ${artifact.payload.supersededBy}`,
							payload: artifact.payload,
						};
						break;
					case "work.artifact.lifecycle":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: artifact.type,
							title: artifact.payload.title ?? artifact.payload.artifactId,
							summary: artifact.payload.summary ?? artifact.payload.action,
							payload: artifact.payload,
						};
						break;
					default: {
						const _exhaustive: never = artifact;
						return _exhaustive;
					}
				}
			} else if (packId === "direction") {
				const beat = validated as ReturnType<typeof directionPack.validate>;
				switch (beat.type) {
					case "work.direction.beat":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: beat.type,
							title: beat.payload.title,
							summary:
								beat.payload.summary ??
								`${beat.payload.kind} · beat ${beat.payload.beatIndex + 1}`,
							payload: beat.payload,
						};
						break;
					default: {
						const _exhaustive: never = beat.type;
						return _exhaustive;
					}
				}
			} else {
				throw new Error(`No event mapping for pack: ${packId}`);
			}

			// The narration side effect lives inside the idempotency window:
			// a replayed publish must not append a second card *or* a second
			// narration line.
			return withIdempotency(
				input.opId ? `work:${input.opId}` : undefined,
				() => {
					const result = store.append(event);

					if (input.narrate !== false) {
						const state = store.getState();
						const nowMs = Date.now();
						if (allowNarrationByRate(state.lastNarrationAtMs, nowMs)) {
							const candidate = narrate(event, "decision-points");
							if (candidate) {
								store.markNarration(nowMs);
								store.append({
									...base(input.actorId),
									type: "conversation.narration",
									track: "conversation",
									text: candidate.text,
									relatedWorkEventId: candidate.relatedWorkEventId,
								});
							}
						}
					}

					return result;
				},
			);
		},

		/** Invite someone to a working session — invited, never "called". */
		invite(input: {
			inviterId: string;
			inviteeId: string;
			sessionId?: string;
			title?: string;
			note?: string;
		}) {
			const event: DriveEvent = {
				...base(input.inviterId),
				type: "control.invite",
				track: "control",
				inviterId: input.inviterId,
				inviteeId: input.inviteeId,
				...(input.sessionId ? { sessionId: input.sessionId } : {}),
				...(input.title ? { title: input.title } : {}),
				...(input.note ? { note: input.note } : {}),
			};
			return store.append(event);
		},

		createSession(input: {
			sessionId: string;
			organizerId: string;
			title: string;
			project: string;
			participantIds: string[];
			agendaTaskIds: string[];
			note?: string;
		}) {
			const event: DriveEvent = {
				...base(input.organizerId),
				type: "control.session_created",
				track: "control",
				sessionId: input.sessionId,
				organizerId: input.organizerId,
				title: input.title,
				project: input.project,
				participantIds: input.participantIds,
				agendaTaskIds: input.agendaTaskIds,
				...(input.note ? { note: input.note } : {}),
			};
			return store.append(event);
		},

		scheduleSession(sessionId: string, scheduledFor: string, actorId?: string) {
			const event: DriveEvent = {
				...base(actorId),
				type: "control.session_scheduled",
				track: "control",
				sessionId,
				scheduledFor,
			};
			return store.append(event);
		},

		startSession(sessionId: string, programId: string, actorId?: string) {
			const event: DriveEvent = {
				...base(actorId),
				type: "control.session_started",
				track: "control",
				sessionId,
				programId,
			};
			return store.append(event);
		},

		endSession(input: {
			sessionId: string;
			outcome?: "completed" | "cancelled";
			replayArtifactId?: string;
			actorId?: string;
		}) {
			const event: DriveEvent = {
				...base(input.actorId),
				type: "control.session_ended",
				track: "control",
				sessionId: input.sessionId,
				outcome: input.outcome ?? "completed",
				...(input.replayArtifactId
					? { replayArtifactId: input.replayArtifactId }
					: {}),
			};
			return store.append(event);
		},

		publishConversation(text: string, actorId?: string, opId?: string) {
			const trimmed = text.trim();
			if (!trimmed) {
				throw new Error("conversation text must be non-empty");
			}
			if (trimmed.length > 500) {
				throw new Error("conversation text capped at 500 chars (density)");
			}
			return withIdempotency(opId ? `conversation:${opId}` : undefined, () =>
				store.append({
					...base(actorId),
					type: "conversation.message",
					track: "conversation",
					text: trimmed,
				}),
			);
		},
	};
}

export type RoomService = ReturnType<typeof createRoomService>;
