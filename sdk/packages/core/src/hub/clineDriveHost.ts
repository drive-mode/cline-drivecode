/**
 * Local Cline DriveHostPort adapter (ADR-0013).
 * Hub command handlers remain the primary entry; this adapter is the
 * commit/broadcast/facets boundary for conformance and future remote hosts.
 * Prefer createDriveHarness({ host }) from @cline/drive for room composition.
 */

import {
	activePresenterGrant,
	CLINE_HOST_CAPABILITIES,
	type DirectorOp,
	type DirectorOpResult,
	type DirectorPolicyDescriptor,
	type DriveHostPort,
	normalizeEnqueuedShowStatus,
	type PromptRewriteDecision,
	type RoomOp,
} from "@cline/drive";
import type { AgentTitleGrant, DriveEvent, RoomSnapshot } from "@cline/shared";
import { parseDriveFacetValues } from "@cline/shared";
import {
	type DriveRoomStore,
	getDriveRoomStore,
	rebindJsonlRoomEventLog,
} from "./collaboration";
import {
	builtInDirectorPolicyDescriptor,
	mintClinePresenterGrant,
} from "./directorPolicy";
import { getCatalogDefaultSubMode } from "./drive-config/driveCatalogFacetStore";
import {
	loadOrSeedDriveFacets,
	writeDriveFacetsFile,
} from "./drive-config/driveFacetsStore";
import {
	advanceScriptOnStore,
	attachScriptOnStore,
	enqueueShowOnStore,
	planFromWorkOnStore,
	presentShowOnStore,
	tickShowOnStore,
} from "./driveDirectorOps";
import {
	materializeShowItem,
	runShowDirectorTick,
	runShowPlannerFromWork,
} from "./driveShowRuntime";

export type ClineDriveHostOptions = {
	/**
	 * Workspace / config parent for facets + room event log. Omit while no
	 * workspace root is known yet — a durable room is owned by the workspace
	 * whose log holds it (ADR-0013), so there must be no log until there is a
	 * workspace. Binding one under a fallback (e.g. tmpdir()) would make the
	 * process durable to a shared, uncontrolled directory that a later real
	 * workspace's first join could mistake for its own history.
	 */
	configParent?: string;
	store?: DriveRoomStore;
	broadcastFn?: (event: DriveEvent) => void;
	promptRewriteFn?: (decision: PromptRewriteDecision) => Promise<void>;
};

const CLINE_COORDINATOR_ID = "cline:coordinator";
const DEFAULT_PRESENTER_DURATION_MS = 60 * 60 * 1_000;

function requestedGrantDurationMs(grant: AgentTitleGrant): number {
	const requested = Date.parse(grant.expiresAt) - Date.parse(grant.grantedAt);
	if (!Number.isFinite(requested)) {
		return DEFAULT_PRESENTER_DURATION_MS;
	}
	return Math.max(60_000, requested);
}

function isHumanPresenter(
	snapshot: RoomSnapshot,
	participantId: string,
): boolean {
	const participant = snapshot.participants.find(
		(entry) => entry.id === participantId,
	);
	return (
		participant?.kind === "human" ||
		participantId === "drive:human" ||
		participantId === "human" ||
		participantId === "you"
	);
}

export function createClineDriveHost(
	options: ClineDriveHostOptions,
): DriveHostPort {
	const store = options.store ?? getDriveRoomStore();
	if (options.configParent) {
		// Idempotent and migration-aware: replays whatever the store was
		// durable to before (the in-memory pre-bind buffer, or a prior real
		// log) into this configParent, and no-ops if already bound to it.
		rebindJsonlRoomEventLog(store, options.configParent);
	}

	const subscribers = new Set<(event: DriveEvent) => void>();
	const workBridges = new Set<(event: DriveEvent) => void>();

	const emit = (event: DriveEvent): void => {
		options.broadcastFn?.(event);
		for (const handler of subscribers) {
			handler(event);
		}
		if (event.track === "work") {
			for (const handler of workBridges) {
				handler(event);
			}
		}
	};

	const promptRewriteWired = options.promptRewriteFn != null;
	const capabilities = {
		...CLINE_HOST_CAPABILITIES,
		promptRewrite: promptRewriteWired,
	};

	const ensurePresenter = (
		roomId: string,
		agentId: string,
	): { ok: true } | { ok: false; code: string; message: string } => {
		store.create(roomId);
		const at = new Date();
		const atIso = at.toISOString();
		const snapshot = store.getOrThrow(roomId);
		if (isHumanPresenter(snapshot, agentId)) {
			return { ok: true };
		}
		const active = activePresenterGrant(snapshot, atIso);
		if (active?.agentId === agentId) {
			return { ok: true };
		}
		if (active) {
			return {
				ok: false,
				code: "presenter_conflict",
				message: `${active.agentId} owns the Presenter title; transfer it before ${agentId} presents`,
			};
		}
		const committed = store.grantTitle({
			roomId,
			grant: mintClinePresenterGrant({ roomId, agentId, at }),
			actorId: CLINE_COORDINATOR_ID,
		});
		emit(committed.event);
		return { ok: true };
	};

	const prospectivePresenter = (op: DirectorOp): string | null => {
		const snapshot = store.get(op.roomId) ?? null;
		const live = store.getOrCreateLive(op.roomId);
		switch (op.type) {
			case "presentShow": {
				const preview = materializeShowItem(op.showItem, {
					demoCapture: capabilities.demoCapture,
				});
				return preview.uri ? preview.ownerParticipantId : null;
			}
			case "enqueueShow": {
				if (!op.presentNow) {
					return null;
				}
				const enqueued = {
					...op.showItem,
					status: normalizeEnqueuedShowStatus(op.showItem.status),
				};
				const preview = runShowDirectorTick({
					room: {
						...live,
						director: {
							...live.director,
							showBacklog: [
								enqueued,
								...live.director.showBacklog.filter(
									(item) => item.id !== enqueued.id,
								),
							],
						},
					},
					preferShowId: enqueued.id,
					demoCapture: capabilities.demoCapture,
					snapshot,
				});
				return preview.presented?.ownerParticipantId ?? null;
			}
			case "tickShow": {
				const preview = runShowDirectorTick({
					room: live,
					preferShowId: op.preferShowId,
					demoCapture: capabilities.demoCapture,
					snapshot,
				});
				return preview.presented?.ownerParticipantId ?? null;
			}
			case "attachScript":
				return op.script.ownerParticipantId;
			case "advanceScript":
				return live.director.activeScript?.ownerParticipantId ?? null;
			case "planFromWork": {
				if (live.director.tickOnWork === false) {
					return null;
				}
				const preview = runShowPlannerFromWork({
					room: live,
					workKind: op.workKind,
					ownerParticipantId: op.ownerParticipantId,
					nowMs: op.nowMs,
					snapshot,
				});
				return preview.presented || preview.scriptBeat
					? op.ownerParticipantId
					: null;
			}
			default: {
				const _never: never = op;
				return _never;
			}
		}
	};

	const stagePresenter = (roomId: string, agentId: string): void => {
		const snapshot = store.getOrThrow(roomId);
		if (isHumanPresenter(snapshot, agentId)) {
			return;
		}
		if (
			snapshot.stage.sharer?.kind === "agent" &&
			snapshot.stage.sharer.participantId === agentId
		) {
			return;
		}
		const committed = store.setStage({
			roomId,
			sharer: { kind: "agent", participantId: agentId },
			pin: null,
			actorId: CLINE_COORDINATOR_ID,
		});
		emit(committed.event);
	};

	return {
		capabilities,
		async resolveKnownAgents() {
			return [];
		},
		async readDurableFacets(workspaceRoot: string) {
			return loadOrSeedDriveFacets({ configParent: workspaceRoot });
		},
		async writeDurableFacets(workspaceRoot: string, next: unknown) {
			const facets = parseDriveFacetValues(next);
			writeDriveFacetsFile(workspaceRoot, facets);
		},
		async getRoom(roomId: string) {
			return store.get(roomId) ?? null;
		},
		async getDirectorPolicyDescriptor(): Promise<DirectorPolicyDescriptor> {
			return builtInDirectorPolicyDescriptor();
		},
		async commitDirectorOp(op: DirectorOp): Promise<DirectorOpResult> {
			const demoCapture = capabilities.demoCapture;
			store.create(op.roomId);
			const presenterId = prospectivePresenter(op);
			if (presenterId) {
				const authorization = ensurePresenter(op.roomId, presenterId);
				if (!authorization.ok) {
					return {
						roomId: op.roomId,
						presented: null,
						planned: null,
						liveRoom: store.getOrCreateLive(op.roomId),
						errorCode: authorization.code,
						errorMessage: authorization.message,
					};
				}
			}
			let result: DirectorOpResult;
			switch (op.type) {
				case "enqueueShow": {
					const committed = enqueueShowOnStore({
						roomId: op.roomId,
						showItem: op.showItem,
						presentNow: op.presentNow,
						demoCapture,
						store,
					});
					result = {
						roomId: op.roomId,
						presented: committed.presented,
						planned: committed.planned,
						liveRoom: committed.room,
						errorCode: committed.errorCode,
						errorMessage: committed.errorMessage,
					};
					break;
				}
				case "presentShow": {
					const committed = presentShowOnStore({
						roomId: op.roomId,
						showItem: op.showItem,
						demoCapture,
						store,
					});
					result = {
						roomId: op.roomId,
						presented: committed.presented,
						planned: committed.planned,
						liveRoom: committed.room,
						errorCode: committed.errorCode,
						errorMessage: committed.errorMessage,
					};
					break;
				}
				case "tickShow": {
					const committed = tickShowOnStore({
						roomId: op.roomId,
						preferShowId: op.preferShowId,
						demoCapture,
						store,
					});
					result = {
						roomId: op.roomId,
						presented: committed.presented,
						planned: committed.planned,
						liveRoom: committed.room,
					};
					break;
				}
				case "attachScript": {
					const committed = attachScriptOnStore({
						roomId: op.roomId,
						script: op.script,
						showItems: op.showItems,
						store,
					});
					result = {
						roomId: op.roomId,
						presented: committed.presented,
						planned: committed.planned,
						liveRoom: committed.room,
						beatId: committed.beatId,
						say: committed.say,
					};
					break;
				}
				case "advanceScript": {
					const committed = advanceScriptOnStore({
						roomId: op.roomId,
						store,
					});
					result = {
						roomId: op.roomId,
						presented: committed.presented,
						planned: committed.planned,
						liveRoom: committed.room,
						beatId: committed.beatId,
						say: committed.say,
						showChanged: committed.showChanged,
						errorCode: committed.errorCode,
						errorMessage: committed.errorMessage,
					};
					break;
				}
				case "planFromWork": {
					const committed = planFromWorkOnStore({
						roomId: op.roomId,
						workKind: op.workKind,
						ownerParticipantId: op.ownerParticipantId,
						nowMs: op.nowMs,
						store,
					});
					result = {
						roomId: op.roomId,
						presented: committed.presented,
						planned: committed.planned,
						liveRoom: committed.room,
						plannedShows: committed.plannedShows,
						plannerReasons: committed.plannerReasons,
						beatId: committed.beatId,
						say: committed.say,
						scriptBeat: committed.scriptBeat,
					};
					break;
				}
				default: {
					const _never: never = op;
					return _never;
				}
			}
			if (presenterId && !result.errorCode) {
				const ownsStage =
					result.presented != null ||
					op.type === "attachScript" ||
					op.type === "advanceScript";
				if (ownsStage) {
					stagePresenter(op.roomId, presenterId);
					result = { ...result, liveRoom: store.getOrCreateLive(op.roomId) };
				}
			}
			return result;
		},
		async commitRoomOp(op: RoomOp): Promise<RoomSnapshot> {
			switch (op.type) {
				case "create": {
					const subMode = options.configParent
						? getCatalogDefaultSubMode(options.configParent)
						: undefined;
					store.create(op.roomId, undefined, { subMode });
					return store.getOrThrow(op.roomId);
				}
				case "join": {
					const result = store.join({
						roomId: op.roomId,
						participant: op.participant,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "leave": {
					const result = store.leave({
						roomId: op.roomId,
						participantId: op.participantId,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setAddress": {
					const result = store.setAddress({
						roomId: op.roomId,
						addressSet: op.addressSet,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setStage": {
					const result = store.setStage({
						roomId: op.roomId,
						sharer: op.sharer,
						pin: op.pin,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "setMode": {
					const result = store.setMode({
						roomId: op.roomId,
						subMode: op.subMode,
						driveActive: op.driveActive,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "raiseHand": {
					const result = store.raiseHand({
						roomId: op.roomId,
						participantId: op.participantId,
						raised: op.raised,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "mute": {
					const result = store.mute({
						roomId: op.roomId,
						participantId: op.participantId,
						muted: op.muted,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "grantTitle": {
					const grant = mintClinePresenterGrant({
						roomId: op.roomId,
						agentId: op.grant.agentId,
						durationMs: requestedGrantDurationMs(op.grant),
					});
					const result = store.grantTitle({
						roomId: op.roomId,
						grant,
						actorId: CLINE_COORDINATOR_ID,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "revokeTitle": {
					const result = store.revokeTitle({
						roomId: op.roomId,
						grantId: op.grantId,
						revokedAt: new Date().toISOString(),
						reason: op.reason,
						actorId: CLINE_COORDINATOR_ID,
					});
					emit(result.event);
					return result.snapshot;
				}
				case "transferTitle": {
					const toGrant = mintClinePresenterGrant({
						roomId: op.roomId,
						agentId: op.toGrant.agentId,
						durationMs: requestedGrantDurationMs(op.toGrant),
					});
					const result = store.transferTitle({
						roomId: op.roomId,
						title: "presenter",
						fromGrantId: op.fromGrantId,
						toGrant,
						transferredAt: toGrant.grantedAt,
						actorId: CLINE_COORDINATOR_ID,
					});
					emit(result.event);
					return result.snapshot;
				}
				default: {
					const _never: never = op;
					return _never;
				}
			}
		},
		async broadcast(event: DriveEvent) {
			emit(event);
		},
		subscribe(handler: (event: DriveEvent) => void) {
			subscribers.add(handler);
			return () => {
				subscribers.delete(handler);
			};
		},
		bridgeWorkEvents(handler: (event: DriveEvent) => void) {
			workBridges.add(handler);
			return () => {
				workBridges.delete(handler);
			};
		},
		async applyPromptRewrite(decision: PromptRewriteDecision) {
			if (!promptRewriteWired || !options.promptRewriteFn) {
				throw new Error(
					"promptRewrite not advertised on ClineDriveHost (wire promptRewriteFn to enable)",
				);
			}
			await options.promptRewriteFn(decision);
		},
	};
}
