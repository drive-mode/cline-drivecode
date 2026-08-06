/** Drive Layer UI state for hub Chat (wireframe A → B staging). */

import {
	allowWorkspaceMutation,
	type CleanDrainInvite,
	type DrivePostureOverride,
	resolveDriveLoop,
	type SdlcFreezeProposal,
} from "@cline/drive";
import type {
	AddressSet,
	BankSnapshot,
	InkRef,
	Participant,
	PlanningProposal,
	RoomSnapshot,
	StageCard,
	StagePin,
} from "@cline/shared";
import { EVERYONE_ADDRESS } from "@cline/shared";
import {
	type PlanMutationKind,
	planEditConsequenceBanner,
} from "./agencyChrome";
import { isDriveHumanId } from "./participantIds";

export type DriveSubMode = "plan" | "agent" | "ask" | "debug";

/**
 * One agent's two ink channels. Both optional — an unset channel means "use the
 * resolver's default", which is a stable hash for names and `muted` for bodies,
 * not a shared constant.
 */
export type DriveAgentInk = {
	nameInk?: InkRef;
	bodyInk?: InkRef;
};

/** Projection of hub stage.sharer for strip/Stage chrome. */
export type DriveStageSharerLocal = "agent" | "you";

export type DriveUiState = {
	active: boolean;
	/** Call Stage split layout (wireframe B). Off = Drive Layer only (A). */
	stageLayout: boolean;
	subMode: DriveSubMode;
	/** Explicit Ask/Debug override; null means bank-derived Plan/Agent. */
	postureOverride: DrivePostureOverride | null;
	partnerName: string;
	/**
	 * Per-agent appearance, keyed by durable profile id (`agentProfileId(ref)`,
	 * falling back to the participant id for seats with no ref).
	 *
	 * Mirrors the durable `agent.appearance` facet shape so the pending
	 * `drive_config_get` / `drive_config_upsert_profile` wire-up drops straight
	 * in. An agent absent from this map is not colourless — it resolves through
	 * the stable default hash in `@cline/drive`.
	 */
	agentInks: Record<string, DriveAgentInk>;
	/** Human mic mute — input only (DRV-MIC). Never gates playback. */
	muted: boolean;
	/**
	 * Human output mute (DRV-TTS). Governs whether this browser speaks agent
	 * audio; orthogonal to {@link muted}. Client-local — no hub op, no wire
	 * field, because it only ever affects this listener.
	 */
	deafened: boolean;
	handRaised: boolean;
	bankSnapshot: BankSnapshot;
	/**
	 * Spotlight owner participant id.
	 * Use {@link DRIVE_PARTICIPANT_HUMAN} / {@link DRIVE_PARTICIPANT_PARTNER} until
	 * full roster ids are wired from the hub.
	 */
	spotlightParticipantId: string;
	/**
	 * Participant whose narration is playing right now (DRV-TTS speaking
	 * presence). Transient playback state — set from local TTS, never
	 * persisted, never sent to the hub.
	 */
	speakingParticipantId: string | null;
	/** Partner agent cannot speak (TTS/narration). */
	partnerMuted: boolean;
	/** Partner agent cannot hear (inbound context). */
	partnerDeafened: boolean;
	/**
	 * Offline fixture cards when demo and no live session tools yet.
	 * Room ownership still goes through hub call_* when connected.
	 */
	demo: boolean;
	/**
	 * Mirror of hub room stage.sharer (agent|you). Updated from room_snapshot.
	 * Authority is hub call_set_stage — not this field alone.
	 */
	stageSharer: DriveStageSharerLocal;
	/** Hub stage.cards projected for Spotlight (last-event-wins work deck). */
	stageCards: StageCard[];
	/** Hub stage.pin projected for human share Spotlight. */
	stagePin: StagePin | null;
	/** Hub room id when Join has attached a call. */
	roomId: string | null;
	/**
	 * Active call session id for bank/room log correlation (DRV-CALL-SESSION).
	 * Set from join/leave extras or drive_event; cleared on leave/unseat.
	 */
	callSessionId: string | null;
	/**
	 * Hub roster projection (DRV-ROSTER). Read-only copy from room_snapshot.
	 * Empty until a snapshot arrives — UI may synthesize human+partner.
	 */
	participants: Participant[];
	/**
	 * Participant whose transcript stream is focused (DRV-PARTICIPANT-SHEET /
	 * DRV-TRANSCRIPT). Null = room / everyone thread.
	 */
	focusedParticipantId: string | null;
	/**
	 * Stub for DRV-ADDRESS: set when Transcript is chosen on an agent;
	 * cleared (everyone) when focusing self. Profile does not touch this.
	 */
	addressFollowsFocusParticipantId: string | null;
	/**
	 * Hub-projected address set for the next send (PU6).
	 * Mirrored from room_snapshot.addressSet.
	 */
	addressSet: AddressSet;
	/**
	 * One-shot felt-agency consequence banner (DRV-FELT-AGENCY).
	 * Cleared by the chrome after display or on the next explicit clear.
	 */
	agencyBanner: string | null;
	/**
	 * Clean-drain ritual invite after S3 plan success (DRV-CLEAN-DRAIN).
	 * Invite alone does not set E1; dismissible and non-blocking.
	 */
	cleanDrainInvite: CleanDrainInvite | null;
	/**
	 * Last seated agent for bind/complete attribution (DRV-RECRUIT-STALL).
	 * Seating does not rewrite bank next-task truth.
	 */
	attributionAgentId: string | null;
	/**
	 * Pending SDLC phase-entry freeze proposal (req-sdlc-bankable).
	 * Stage freeze card UI is still stubbed — proposals land here for gated
	 * Plan-posture accept → DriveTasks. Cleared on accept/dismiss.
	 */
	pendingSdlcFreeze: SdlcFreezeProposal | null;
	/**
	 * Post-session / after-End planning improve proposal (DRV-PLAN-IMPROVE).
	 * Distinct from in-call StuckRecoveryFork. Cleared on accept/reject/mute.
	 */
	pendingPlanningImprove: PlanningProposal | null;
};

/** Stable ids until hub roster provides real participant UUIDs. */
export const DRIVE_PARTICIPANT_HUMAN = "drive:human";
export const DRIVE_PARTICIPANT_PARTNER = "drive:partner";

/** Stable Chat Drive room id (matches legacy driveCommand roomId default). */
export const DRIVE_DEFAULT_ROOM_ID = "default";

export const EMPTY_BANK_SNAPSHOT: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
	nowLastFailure: null,
};

export const DEFAULT_DRIVE_UI: DriveUiState = {
	active: false,
	stageLayout: false,
	subMode: "plan",
	postureOverride: null,
	partnerName: "Cline",
	agentInks: {},
	// Joining a call with a hot mic is the wrong privacy default (spotlight S4).
	// Safe only because `deafened` — not this — gates playback.
	muted: true,
	deafened: false,
	handRaised: false,
	bankSnapshot: EMPTY_BANK_SNAPSHOT,
	spotlightParticipantId: DRIVE_PARTICIPANT_PARTNER,
	speakingParticipantId: null,
	partnerMuted: false,
	partnerDeafened: false,
	demo: true,
	stageSharer: "agent",
	stageCards: [],
	stagePin: null,
	roomId: null,
	callSessionId: null,
	participants: [],
	focusedParticipantId: null,
	addressFollowsFocusParticipantId: null,
	addressSet: EVERYONE_ADDRESS,
	agencyBanner: null,
	cleanDrainInvite: null,
	attributionAgentId: null,
	pendingSdlcFreeze: null,
	pendingPlanningImprove: null,
};

/** Map Drive sub-mode onto native Cline plan|act for send config. */
export function toNativeMode(subMode: DriveSubMode): "act" | "plan" {
	switch (subMode) {
		case "plan":
		case "ask":
			return "plan";
		case "agent":
		case "debug":
			return "act";
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

/** Map UI sub-mode onto shared DriveSubMode for call_set_mode. */
export function toSharedDriveSubMode(
	subMode: DriveSubMode,
): "plan" | "act" | "ask" | "debug" {
	switch (subMode) {
		case "agent":
			return "act";
		case "plan":
		case "ask":
		case "debug":
			return subMode;
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

export function fromSharedDriveSubMode(
	subMode: "plan" | "act" | "ask" | "debug",
): DriveSubMode {
	switch (subMode) {
		case "act":
			return "agent";
		case "plan":
		case "ask":
		case "debug":
			return subMode;
		default: {
			const _exhaustive: never = subMode;
			return _exhaustive;
		}
	}
}

/** Recompute Plan/Agent from bank unless Ask/Debug override is set. */
export function syncDrivePostureFromBank(state: DriveUiState): DriveUiState {
	if (!state.active) {
		return state;
	}
	const loop = resolveDriveLoop({
		driveActive: true,
		snapshot: state.bankSnapshot,
		override: state.postureOverride,
	});
	return {
		...state,
		subMode: loop.posture,
	};
}

export function applyBankSnapshot(
	state: DriveUiState,
	snapshot: BankSnapshot,
	options?: {
		mutation?: PlanMutationKind;
		addedTitle?: string;
		recovery?: boolean;
		/** Explicit banner override (e.g. steer applied). Pass null to clear. */
		agencyBanner?: string | null;
	},
): DriveUiState {
	let agencyBanner = state.agencyBanner;
	if (options?.agencyBanner !== undefined) {
		agencyBanner = options.agencyBanner;
	} else if (options?.mutation) {
		agencyBanner = planEditConsequenceBanner(state.bankSnapshot, snapshot, {
			mutation: options.mutation,
			addedTitle: options.addedTitle,
			recovery: options.recovery,
		});
	}
	return syncDrivePostureFromBank({
		...state,
		bankSnapshot: snapshot,
		agencyBanner,
	});
}

/**
 * Project a hub-owned RoomSnapshot into Drive chrome state.
 * Hub is the single writer — callers must not invent room authority locally.
 * Chat Drive `active` means the local human is seated; leave removes the seat
 * while the room (and driveActive) may persist for drop-in rejoin.
 */
export function applyRoomSnapshot(
	drive: DriveUiState,
	snapshot: RoomSnapshot,
): DriveUiState {
	const human = snapshot.participants.find(
		(participant) =>
			participant.kind === "human" && isDriveHumanId(participant.id),
	);
	const agent = snapshot.participants.find(
		(participant) => participant.kind === "agent",
	);
	// Local human seat only — matches Drive preview; guests do not count.
	const humanSeated = human != null;
	const sharer = snapshot.stage.sharer;
	// Hub stage.sharer is authoritative — null clears local "you"/spotlight.
	const stageSharer: DriveStageSharerLocal =
		sharer?.kind === "human" ? "you" : "agent";

	const muteMap = snapshot.muteByParticipantId;
	const humanId = human?.id ?? DRIVE_PARTICIPANT_HUMAN;
	const agentId = agent?.id ?? DRIVE_PARTICIPANT_PARTNER;
	const muted =
		typeof muteMap[humanId] === "boolean" ? muteMap[humanId] : drive.muted;
	const partnerMuted =
		typeof muteMap[agentId] === "boolean"
			? muteMap[agentId]
			: drive.partnerMuted;

	const raisedMap = snapshot.raisedHandByParticipantId;
	const handRaised =
		typeof raisedMap[humanId] === "boolean"
			? raisedMap[humanId]
			: drive.handRaised;

	return {
		...drive,
		active: Boolean(snapshot.driveActive && humanSeated),
		roomId: humanSeated ? snapshot.roomId : null,
		callSessionId: humanSeated ? drive.callSessionId : null,
		partnerName: agent?.displayName ?? drive.partnerName,
		stageSharer,
		spotlightParticipantId: sharer?.participantId ?? agentId,
		stageCards: [...snapshot.stage.cards],
		stagePin: snapshot.stage.pin,
		muted,
		partnerMuted,
		handRaised,
		subMode: fromSharedDriveSubMode(snapshot.subMode),
		demo: false,
		participants: [...snapshot.participants],
		addressSet: snapshot.addressSet ?? EVERYONE_ADDRESS,
	};
}

export function applySubModeIntent(
	state: DriveUiState,
	subMode: DriveSubMode,
): DriveUiState {
	if (!state.active) {
		return state;
	}
	if (subMode === "ask" || subMode === "debug") {
		return {
			...state,
			postureOverride: subMode,
			subMode,
		};
	}
	// Plan/Agent while override is set: ignore (override clears only explicitly).
	if (state.postureOverride) {
		return state;
	}
	return syncDrivePostureFromBank({ ...state, subMode });
}

export function clearPostureOverride(state: DriveUiState): DriveUiState {
	if (!state.active || !state.postureOverride) {
		return state;
	}
	return syncDrivePostureFromBank({ ...state, postureOverride: null });
}

export function canMutateWorkspace(state: DriveUiState): boolean {
	const loop = resolveDriveLoop({
		driveActive: state.active,
		snapshot: state.bankSnapshot,
		override: state.postureOverride,
	});
	return allowWorkspaceMutation(loop).allowed;
}

/**
 * Optimistic partner rename in Drive chrome (Overview Save).
 * Hub `call_rename_participant` remains the room authority when roomId is set.
 * Top-level `partnerName` updates only for the primary (first) agent.
 */
export function applyPartnerDisplayName(
	state: DriveUiState,
	displayName: string,
	participantId?: string,
): DriveUiState {
	const name = displayName.trim();
	if (!name) {
		return state;
	}
	const primaryAgentId =
		state.participants.find((participant) => participant.kind === "agent")
			?.id ?? DRIVE_PARTICIPANT_PARTNER;
	const updatePartnerChrome =
		!participantId || participantId === primaryAgentId;
	return {
		...state,
		...(updatePartnerChrome ? { partnerName: name } : {}),
		participants: state.participants.map((participant) => {
			if (participant.kind !== "agent") {
				return participant;
			}
			if (participantId && participant.id !== participantId) {
				return participant;
			}
			return { ...participant, displayName: name };
		}),
	};
}

/**
 * Set one agent's nameInk palette index, or clear it back to the default hash.
 *
 * Scoped to a single profile id — the previous global field repainted every
 * seated agent at once, which made two agents indistinguishable by design.
 * No hex is stored: the durable `InkRef` is what persists, and the concrete
 * colour is resolved per theme at paint time.
 */
export function applyAgentNameInk(
	state: DriveUiState,
	profileId: string,
	index: number | null,
): DriveUiState {
	if (!profileId) {
		return state;
	}
	const existing = state.agentInks[profileId];
	if (index === null) {
		if (!existing?.nameInk) {
			return state;
		}
		const { nameInk: _dropped, ...rest } = existing;
		const agentInks = { ...state.agentInks };
		if (Object.keys(rest).length > 0) {
			agentInks[profileId] = rest;
		} else {
			delete agentInks[profileId];
		}
		return { ...state, agentInks };
	}
	if (!Number.isInteger(index) || index < 0 || index > 7) {
		return state;
	}
	return {
		...state,
		agentInks: {
			...state.agentInks,
			[profileId]: {
				...existing,
				nameInk: { kind: "palette", index: index as 0 },
			},
		},
	};
}

/**
 * Set one agent's bodyInk, or clear it back to the resolver's `muted` default.
 *
 * Separate from {@link applyAgentNameInk} on purpose: the two channels are
 * chosen independently, and a single "agent colour" would make the name and the
 * message body move together, which is precisely what the feature is not.
 */
export function applyAgentBodyInk(
	state: DriveUiState,
	profileId: string,
	ink: InkRef | null,
): DriveUiState {
	if (!profileId) {
		return state;
	}
	const existing = state.agentInks[profileId];
	if (ink === null) {
		if (!existing?.bodyInk) {
			return state;
		}
		const { bodyInk: _dropped, ...rest } = existing;
		const agentInks = { ...state.agentInks };
		if (Object.keys(rest).length > 0) {
			agentInks[profileId] = rest;
		} else {
			delete agentInks[profileId];
		}
		return { ...state, agentInks };
	}
	return {
		...state,
		agentInks: {
			...state.agentInks,
			[profileId]: { ...existing, bodyInk: ink },
		},
	};
}

/**
 * Replace both of one agent's ink channels at once.
 *
 * The editor changes one channel and carries the other through unchanged, so
 * it hands back a whole {@link DriveAgentInk}. An entry with neither channel
 * set is deleted rather than kept as `{}` — "no stored appearance" and "an
 * appearance that stores nothing" resolve identically, and only one of them
 * should be written back to the persisted blob.
 */
export function applyAgentInk(
	state: DriveUiState,
	profileId: string,
	ink: DriveAgentInk,
): DriveUiState {
	if (!profileId) {
		return state;
	}
	const next: DriveAgentInk = {
		...(ink.nameInk ? { nameInk: ink.nameInk } : {}),
		...(ink.bodyInk ? { bodyInk: ink.bodyInk } : {}),
	};
	const agentInks = { ...state.agentInks };
	if (Object.keys(next).length === 0) {
		if (!(profileId in agentInks)) {
			return state;
		}
		delete agentInks[profileId];
	} else {
		agentInks[profileId] = next;
	}
	return { ...state, agentInks };
}

/**
 * Overlay the hub's durable `agent.appearance` map onto local ink state.
 *
 * Durable wins. The local map is a cache of the same facet, so a browser whose
 * localStorage disagrees with disk is stale, not authoritative — the opposite
 * merge would let one machine's leftover colour outlive a deliberate change
 * made on another. Agents absent from the durable map keep whatever the browser
 * had, so an unsaved in-flight edit is not wiped by a background refresh.
 */
export function applyDurableAgentProfiles(
	state: DriveUiState,
	profiles: readonly {
		id: string;
		nameInk: InkRef;
		bodyInk: InkRef;
	}[],
): DriveUiState {
	if (profiles.length === 0) {
		return state;
	}
	const agentInks: Record<string, DriveAgentInk> = { ...state.agentInks };
	for (const profile of profiles) {
		if (!profile.id) {
			continue;
		}
		agentInks[profile.id] = {
			nameInk: profile.nameInk,
			bodyInk: profile.bodyInk,
		};
	}
	return { ...state, agentInks };
}

export function drivePersonaSystemHint(state: DriveUiState): string {
	if (!state.active) {
		return "";
	}
	const bound = state.bankSnapshot.nowTaskId;
	return [
		"You are in Cline Drive mode: a senior engineer pair-programming on a call.",
		`Partner name: ${state.partnerName}.`,
		`Drive sub-mode: ${state.subMode} (maps to native ${toNativeMode(state.subMode)}).`,
		state.postureOverride
			? `Posture override active: ${state.postureOverride} (clear explicitly to return to bank-derived posture).`
			: "Posture is derived from the task bank (Plan when empty, Agent when open tasks exist).",
		bound
			? `Bound DriveTask: ${bound}${state.bankSnapshot.nowTitle ? ` (${state.bankSnapshot.nowTitle})` : ""}.`
			: "No open DriveTask. Prefer Plan posture: author plan + task files under .drive/bank/.",
		"Narrate decisions briefly and transparently, like a colleague sharing their screen.",
		"Prefer short spoken-style explanations before and after meaningful tool work.",
		"Do not invent a parallel chat participant. Work in this session.",
	].join(" ");
}
