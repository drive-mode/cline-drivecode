/**
 * Pure helpers for the call surface: stage-card ordering and copy, share
 * pin defaults, Spotlight hand-off targets, Presenter action resolution,
 * address labels, and the small time formatters the strip and deck share.
 *
 * Ported from the hub's `drive/stageReducer.ts` (deck semantics),
 * `drive/pinDefaults.ts`, `drive/addressLabel.ts`, `drive/rosterHelpers.ts`
 * and `sdk/packages/drive/src/reduceRoom.ts` (`activePresenterGrant`).
 * Everything here is DOM-free so it can be tested under `environment: node`.
 */

import type {
	AddressSet,
	AgentRuntimeBadge,
	AgentTitleGrant,
	Participant,
	SeatSource,
	StageCard,
	StagePin,
	StageSharer,
} from "@cline/shared";
import { DRIVE_PARTICIPANT_PARTNER, isDrivePartnerId } from "./drive-ids";

// ── stage cards ──────────────────────────────────────────────────────────

export type StageCardCategory = StageCard["category"];

export const STAGE_CARD_CATEGORIES: readonly StageCardCategory[] = [
	"edit",
	"command",
	"test",
	"plan",
	"decision",
	"other",
];

export const STAGE_CARD_CATEGORY_LABEL: Record<StageCardCategory, string> = {
	edit: "Edit",
	command: "Command",
	test: "Test",
	plan: "Plan",
	decision: "Decision",
	other: "Work",
};

/**
 * Deck order: newest activity first. The kernel keeps one card per category
 * and replaces it in place (last event wins), so the array order is the
 * category's first appearance — `updatedAt` is what says which card moved
 * last. Ties keep the kernel's order, later entries first.
 */
export function orderStageCards(cards: readonly StageCard[]): StageCard[] {
	return cards
		.map((card, index) => ({ card, index, at: Date.parse(card.updatedAt) }))
		.sort((a, b) => {
			const aAt = Number.isFinite(a.at) ? a.at : 0;
			const bAt = Number.isFinite(b.at) ? b.at : 0;
			if (aAt !== bAt) {
				return bAt - aAt;
			}
			return b.index - a.index;
		})
		.map((entry) => entry.card);
}

export type StageCardTestStatus = "passed" | "failed" | "running";

/** The kernel folds pass/fail into the summary text; read it back. */
export function stageCardTestStatus(
	summary: string | undefined,
): StageCardTestStatus {
	const text = (summary ?? "").toLowerCase();
	if (
		text.includes("fail") ||
		text.includes("error") ||
		text.includes("✗") ||
		text.includes("×")
	) {
		return "failed";
	}
	if (text.includes("running") || text.includes("pending")) {
		return "running";
	}
	return "passed";
}

export function lastCardOfCategory(
	cards: readonly StageCard[],
	category: StageCardCategory,
): StageCard | undefined {
	for (let index = cards.length - 1; index >= 0; index -= 1) {
		const card = cards[index];
		if (card?.category === category) {
			return card;
		}
	}
	return undefined;
}

// ── share pin ────────────────────────────────────────────────────────────

export type HumanPinKind = StagePin["kind"];

export const HUMAN_PIN_KINDS: readonly HumanPinKind[] = [
	"selection",
	"file",
	"terminal",
];

export const HUMAN_PIN_KIND_LABEL: Record<HumanPinKind, string> = {
	selection: "Selection",
	file: "File",
	terminal: "Terminal",
};

/**
 * Defaults for the You-take-Spotlight picker. The browser selection is an
 * argument rather than read here so this stays DOM-free; the caller passes
 * `window.getSelection()` text when it has one.
 */
export function buildHumanPinDefaults(
	cards: readonly StageCard[],
	selectionText?: string,
): Record<HumanPinKind, StagePin> {
	const selection = selectionText?.trim() || undefined;
	const edit = lastCardOfCategory(cards, "edit");
	const command = lastCardOfCategory(cards, "command");
	return {
		selection: {
			kind: "selection",
			label: selection
				? selection.length > 48
					? `${selection.slice(0, 45)}…`
					: selection
				: "Current selection",
			ref:
				selection ??
				"No text selected — select something in the app and pin again.",
		},
		file: {
			kind: "file",
			label: edit?.title ?? "Shared file",
			ref: edit?.summary?.split("\n")[0] ?? edit?.title ?? "Enter a file path",
		},
		terminal: {
			kind: "terminal",
			label: command?.title ?? "Terminal",
			ref: command?.summary ?? command?.title ?? "No recent command output",
		},
	};
}

// ── spotlight hand-off ───────────────────────────────────────────────────

/**
 * The agent the Spotlight goes to when it leaves a human: the Presenter if
 * one is seated, else the partner, else the first seated agent.
 */
export function preferredAgentSharer(
	agents: readonly Participant[],
	presenterAgentId?: string | null,
): Participant | null {
	const seated = agents.filter((participant) => participant.kind === "agent");
	return (
		seated.find((participant) => participant.id === presenterAgentId) ??
		seated.find(
			(participant) =>
				participant.role === "partner" || isDrivePartnerId(participant.id),
		) ??
		seated[0] ??
		null
	);
}

/**
 * "Move Spotlight" target: you ↔ agent. Null when there is nowhere to move it
 * (no agent seated while you hold it, or no human seat while an agent does).
 */
export function nextSpotlightSharer(input: {
	sharer: StageSharer | null;
	humanId: string | null;
	agents: readonly Participant[];
	presenterAgentId?: string | null;
}): StageSharer | null {
	const { sharer, humanId, agents, presenterAgentId } = input;
	const humanHolds = sharer?.kind === "human";
	if (humanHolds || sharer === null) {
		const agent = preferredAgentSharer(agents, presenterAgentId);
		if (agent && !(sharer === null && humanId === null)) {
			return { kind: "agent", participantId: agent.id };
		}
		if (sharer === null && humanId) {
			return { kind: "human", participantId: humanId };
		}
		return null;
	}
	return humanId ? { kind: "human", participantId: humanId } : null;
}

// ── presenter ────────────────────────────────────────────────────────────

export type PresenterAction = "grant" | "transfer" | "revoke";

/** Exclusivity made explicit: one Presenter per stage, so the action for a given agent depends on who holds it. */
export function presenterActionFor(
	agentId: string,
	grant: AgentTitleGrant | null,
): PresenterAction {
	if (!grant) {
		return "grant";
	}
	return grant.agentId === agentId ? "revoke" : "transfer";
}

export const PRESENTER_ACTION_LABEL: Record<PresenterAction, string> = {
	grant: "Grant Presenter",
	transfer: "Transfer Presenter",
	revoke: "Revoke Presenter",
};

/** Human-readable remaining time on a grant, or "expired". */
export function formatGrantRemaining(
	grant: Pick<AgentTitleGrant, "expiresAt" | "revokedAt">,
	nowMs: number = Date.now(),
): string {
	if (grant.revokedAt) {
		return "revoked";
	}
	const expires = Date.parse(grant.expiresAt);
	if (!Number.isFinite(expires) || expires <= nowMs) {
		return "expired";
	}
	const remaining = expires - nowMs;
	const minutes = Math.floor(remaining / 60_000);
	if (minutes < 1) {
		return "under a minute left";
	}
	if (minutes < 60) {
		return `${minutes}m left`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest > 0 ? `${hours}h ${rest}m left` : `${hours}h left`;
}

/** Every grant the room holds for one agent, newest first. */
export function grantsForAgent(
	titleGrantsById: Record<string, AgentTitleGrant> | undefined,
	agentId: string,
): AgentTitleGrant[] {
	return Object.values(titleGrantsById ?? {})
		.filter((grant) => grant.agentId === agentId)
		.sort((a, b) => Date.parse(b.grantedAt) - Date.parse(a.grantedAt));
}

export function isGrantActive(
	grant: Pick<AgentTitleGrant, "expiresAt" | "revokedAt" | "notBefore">,
	nowMs: number = Date.now(),
): boolean {
	if (grant.revokedAt) {
		return false;
	}
	const expires = Date.parse(grant.expiresAt);
	if (!Number.isFinite(expires) || expires <= nowMs) {
		return false;
	}
	if (grant.notBefore) {
		const from = Date.parse(grant.notBefore);
		if (Number.isFinite(from) && from > nowMs) {
			return false;
		}
	}
	return true;
}

// ── address ──────────────────────────────────────────────────────────────

/** Address set label for the strip chip (hub `addressLabel.ts`). */
export function formatAddressSetLabel(
	addressSet: AddressSet,
	participants: readonly Participant[] = [],
): string {
	switch (addressSet.mode) {
		case "everyone":
			return "Everyone";
		case "pack":
			return `Pack · ${addressSet.packId}`;
		case "agents": {
			const names = addressSet.agentIds.map((id) => {
				const seated = participants.find(
					(participant) => participant.id === id,
				);
				return seated?.displayName ?? id;
			});
			if (names.length === 1) {
				return names[0] ?? "Agent";
			}
			return names.slice(0, 2).join(" + ") + (names.length > 2 ? "…" : "");
		}
		default: {
			const _exhaustive: never = addressSet;
			return _exhaustive;
		}
	}
}

export type AddressChoice = {
	id: string;
	label: string;
	addressSet: AddressSet;
	kind: "everyone" | "one" | "many" | "pack";
};

/**
 * The address menu: everyone, each seated agent, "all agents" when more than
 * one is seated, and one entry per roster pack that seated somebody.
 */
export function buildAddressChoices(
	participants: readonly Participant[],
): AddressChoice[] {
	const agents = participants.filter(
		(participant): participant is Extract<Participant, { kind: "agent" }> =>
			participant.kind === "agent",
	);
	const choices: AddressChoice[] = [
		{
			id: "everyone",
			label: "Everyone",
			addressSet: { mode: "everyone" },
			kind: "everyone",
		},
	];
	for (const agent of agents) {
		choices.push({
			id: `agent:${agent.id}`,
			label: agent.displayName,
			addressSet: { mode: "agents", agentIds: [agent.id] },
			kind: "one",
		});
	}
	if (agents.length > 1) {
		choices.push({
			id: "agents:all",
			label: "All agents",
			addressSet: { mode: "agents", agentIds: agents.map((agent) => agent.id) },
			kind: "many",
		});
	}
	const packIds = new Set<string>();
	for (const agent of agents) {
		for (const source of agent.seatSources) {
			if (source.kind === "pack") {
				packIds.add(source.packId);
			}
		}
	}
	for (const packId of packIds) {
		choices.push({
			id: `pack:${packId}`,
			label: `Pack · ${packId}`,
			addressSet: { mode: "pack", packId },
			kind: "pack",
		});
	}
	return choices;
}

export function sameAddressSet(a: AddressSet, b: AddressSet): boolean {
	if (a.mode !== b.mode) {
		return false;
	}
	switch (a.mode) {
		case "everyone":
			return true;
		case "pack":
			return b.mode === "pack" && a.packId === b.packId;
		case "agents": {
			if (b.mode !== "agents" || a.agentIds.length !== b.agentIds.length) {
				return false;
			}
			const other = new Set(b.agentIds);
			return a.agentIds.every((id) => other.has(id));
		}
		default: {
			const _exhaustive: never = a;
			return _exhaustive;
		}
	}
}

// ── roster copy ──────────────────────────────────────────────────────────

export function participantStatusLabel(status: Participant["status"]): string {
	switch (status) {
		case "idle":
			return "idle";
		case "working":
			return "working";
		case "speaking":
			return "speaking";
		case "away":
			return "away";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

export function seatSourceLabel(source: SeatSource): string {
	switch (source.kind) {
		case "manual":
			return "seated manually";
		case "pack":
			return `pack · ${source.packId}`;
		case "spawn":
			return `spawned by ${source.parentId}`;
		default: {
			const _exhaustive: never = source;
			return _exhaustive;
		}
	}
}

/** Family + location only — never a model id, endpoint or key. */
export function runtimeBadgeLabel(badge: AgentRuntimeBadge): string {
	return `${badge.family} · ${badge.executionLocation}`;
}

/** Cline's builtin pair partner wears the Cline mark; every other agent wears an initial. */
export function isClineParticipant(participant: Participant): boolean {
	if (participant.kind !== "agent") {
		return false;
	}
	if (participant.ref) {
		return (
			participant.ref.kind === "builtin" &&
			participant.ref.id === "pair_partner"
		);
	}
	return participant.id === DRIVE_PARTICIPANT_PARTNER;
}

/** Up to two letters for a participant with no mark of their own. */
export function participantInitials(participant: Participant): string {
	const source = participant.displayName.trim() || participant.id.trim();
	if (!source) {
		return "?";
	}
	const words = source.split(/\s+/).filter(Boolean);
	if (words.length >= 2) {
		return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
	}
	return source.slice(0, 1).toUpperCase();
}

// ── time ─────────────────────────────────────────────────────────────────

/** `mm:ss`, or `h:mm:ss` past an hour. Negative or unreadable reads `00:00`. */
export function formatElapsed(ms: number): string {
	const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const mm = String(minutes).padStart(2, "0");
	const ss = String(seconds).padStart(2, "0");
	return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Compact age for deck cards and feed rows: now, 12s, 3m, 2h, 1d. */
export function formatRelativeAge(
	iso: string | null | undefined,
	nowMs: number = Date.now(),
): string {
	if (!iso) {
		return "";
	}
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) {
		return "";
	}
	const diff = nowMs - at;
	if (diff < 10_000) {
		return "now";
	}
	if (diff < 60_000) {
		return `${Math.floor(diff / 1000)}s`;
	}
	if (diff < 3_600_000) {
		return `${Math.floor(diff / 60_000)}m`;
	}
	if (diff < 86_400_000) {
		return `${Math.floor(diff / 3_600_000)}h`;
	}
	return `${Math.floor(diff / 86_400_000)}d`;
}

/** Wall-clock stamp for feed rows (`10:42:07`). */
export function formatClock(iso: string): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) {
		return "";
	}
	const hh = String(at.getHours()).padStart(2, "0");
	const mm = String(at.getMinutes()).padStart(2, "0");
	const ss = String(at.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}
