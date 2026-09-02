/**
 * The Agents directory model — a pure fold of the three things the hub knows
 * about an agent into one row per durable identity.
 *
 *  - **Homes** (`drive_agent_home list`): `.driveagent/<slug>/` configuration
 *    as code, already prompt-stripped by the sidecar.
 *  - **Profiles** (`drive_agent_profiles get`): the durable appearance map.
 *  - **The room snapshot**: who is seated right now, with role, status, seat
 *    provenance, runtime badge (family + location only) and title grants.
 *
 * Homes come first because a home is the richer record; a durably-styled
 * agent with no home is still listed; a seated agent with neither is listed
 * too, since it is on the call in front of the person. Nothing here reads a
 * prompt, tool list, provider, key or model id — the wire never carries them.
 */

import {
	type AgentProfile,
	type AgentRef,
	type AgentRuntimeBadge,
	type AgentTitle,
	type AgentTitleGrant,
	agentProfileId,
	type InkRef,
	type Participant,
	type ParticipantStatus,
	parseAgentProfileId,
	type RoomSnapshot,
	type SeatSource,
} from "@cline/shared";
import { fallbackDisplayName, titleCaseSlug } from "./agent-appearance";
import type { DriveFeedEntry } from "./room-state";

export type AgentHomeListing = {
	slug: string;
	tier: "workspace" | "user";
	displayName?: string;
	description?: string;
	skills?: string[];
	editable?: boolean;
};

export type AgentSeat = {
	participantId: string;
	role: string;
	status: ParticipantStatus;
	seatSources: SeatSource[];
	capPreset: string | null;
	muted: boolean;
	handRaised: boolean;
};

export type AgentTitleHeld = {
	grantId: string;
	title: AgentTitle;
	expiresAt: string;
};

export type AgentDirectoryEntry = {
	profileId: string;
	/** Null only for a legacy seat that recorded no ref. */
	ref: AgentRef | null;
	displayName: string;
	description: string | null;
	tier: "workspace" | "user" | null;
	skills: string[];
	editable: boolean | null;
	hasHome: boolean;
	hasProfile: boolean;
	nameInk: InkRef | null;
	bodyInk: InkRef | null;
	seat: AgentSeat | null;
	runtimeBadge: AgentRuntimeBadge | null;
	titles: AgentTitleHeld[];
	/** Newest feed activity for the seated participant, or null. */
	lastActiveAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.trim().length > 0,
			)
		: [];
}

/**
 * Parse `{ homes }` tolerantly. A row is kept on its slug alone: a home whose
 * YAML stopped compiling still exists on disk, and dropping it would make the
 * directory quietly disagree with the filesystem it is a view of.
 */
export function parseAgentHomeListing(value: unknown): AgentHomeListing[] {
	const homes = isRecord(value) ? value.homes : value;
	if (!Array.isArray(homes)) {
		return [];
	}
	const rows: AgentHomeListing[] = [];
	for (const entry of homes) {
		if (!isRecord(entry) || typeof entry.slug !== "string" || !entry.slug) {
			continue;
		}
		const skills = readStringArray(entry.skills);
		rows.push({
			slug: entry.slug,
			tier: entry.tier === "user" ? "user" : "workspace",
			...(typeof entry.displayName === "string" && entry.displayName.trim()
				? { displayName: entry.displayName.trim() }
				: {}),
			...(typeof entry.description === "string" && entry.description.trim()
				? { description: entry.description.trim() }
				: {}),
			...(skills.length > 0 ? { skills } : {}),
			...(typeof entry.editable === "boolean"
				? { editable: entry.editable }
				: {}),
		});
	}
	return rows;
}

function isInkRef(value: unknown): value is InkRef {
	if (!isRecord(value)) {
		return false;
	}
	if (value.kind === "token") {
		return typeof value.token === "string";
	}
	if (value.kind === "palette") {
		return (
			typeof value.index === "number" &&
			Number.isInteger(value.index) &&
			value.index >= 0 &&
			value.index <= 7
		);
	}
	return false;
}

/**
 * Parse `{ profiles }` (or a single `{ profile }`) back into profiles. A row
 * that fails is dropped rather than defaulted — an agent with no stored
 * appearance is not the same as one whose appearance failed to parse, and
 * only the first should fall through to the stable hash.
 */
export function parseAgentProfiles(value: unknown): AgentProfile[] {
	const rows = isRecord(value)
		? Array.isArray(value.profiles)
			? value.profiles
			: isRecord(value.profile)
				? [value.profile]
				: []
		: Array.isArray(value)
			? value
			: [];
	const profiles: AgentProfile[] = [];
	for (const entry of rows) {
		if (
			!isRecord(entry) ||
			typeof entry.id !== "string" ||
			!entry.id ||
			!isInkRef(entry.nameInk) ||
			!isInkRef(entry.bodyInk)
		) {
			continue;
		}
		const ref = parseAgentProfileId(entry.id);
		if (!ref) {
			continue;
		}
		profiles.push({
			id: entry.id,
			ref,
			...(typeof entry.displayName === "string" && entry.displayName.trim()
				? { displayName: entry.displayName.trim() }
				: {}),
			nameInk: entry.nameInk,
			bodyInk: entry.bodyInk,
		});
	}
	return profiles;
}

/** Active (not revoked, not expired, already effective) grants for one agent. */
export function activeTitleGrantsFor(
	snapshot: RoomSnapshot | null,
	agentId: string,
	at: string,
): AgentTitleGrant[] {
	if (!snapshot) {
		return [];
	}
	const now = Date.parse(at);
	return Object.values(snapshot.titleGrantsById)
		.filter((grant) => {
			if (grant.agentId !== agentId || grant.revokedAt) {
				return false;
			}
			if (grant.notBefore && Date.parse(grant.notBefore) > now) {
				return false;
			}
			return Date.parse(grant.expiresAt) > now;
		})
		.sort((a, b) => a.title.localeCompare(b.title));
}

function seatFor(snapshot: RoomSnapshot, participant: Participant): AgentSeat {
	return {
		participantId: participant.id,
		role: participant.role,
		status: participant.status,
		seatSources:
			participant.kind === "agent" ? [...participant.seatSources] : [],
		capPreset:
			participant.kind === "agent" ? (participant.capPreset ?? null) : null,
		muted: snapshot.muteByParticipantId[participant.id] === true,
		handRaised: snapshot.raisedHandByParticipantId[participant.id] === true,
	};
}

function emptyEntry(
	profileId: string,
	ref: AgentRef | null,
): AgentDirectoryEntry {
	return {
		profileId,
		ref,
		displayName: ref ? fallbackDisplayName(ref) : titleCaseSlug(profileId),
		description: null,
		tier: null,
		skills: [],
		editable: null,
		hasHome: false,
		hasProfile: false,
		nameInk: null,
		bodyInk: null,
		seat: null,
		runtimeBadge: null,
		titles: [],
		lastActiveAt: null,
	};
}

export function buildAgentDirectory(input: {
	homes: readonly AgentHomeListing[];
	profiles: readonly AgentProfile[];
	snapshot: RoomSnapshot | null;
	feed?: readonly DriveFeedEntry[];
	now: string;
}): AgentDirectoryEntry[] {
	const byId = new Map<string, AgentDirectoryEntry>();
	// Ids whose display name came from a home or a stored profile; a seat's
	// display name only fills in when neither said anything.
	const named = new Set<string>();

	for (const home of input.homes) {
		const ref: AgentRef = { kind: "driveagent", slug: home.slug };
		const id = agentProfileId(ref);
		const entry = byId.get(id) ?? emptyEntry(id, ref);
		entry.displayName = home.displayName?.trim() || titleCaseSlug(home.slug);
		named.add(id);
		entry.description = home.description ?? null;
		entry.tier = home.tier;
		entry.skills = home.skills ? [...home.skills] : [];
		entry.editable = home.editable ?? null;
		entry.hasHome = true;
		byId.set(id, entry);
	}

	for (const profile of input.profiles) {
		const entry = byId.get(profile.id) ?? emptyEntry(profile.id, profile.ref);
		entry.hasProfile = true;
		entry.nameInk = profile.nameInk;
		entry.bodyInk = profile.bodyInk;
		if (profile.displayName?.trim()) {
			entry.displayName = profile.displayName.trim();
			named.add(profile.id);
		}
		byId.set(profile.id, entry);
	}

	const snapshot = input.snapshot;
	if (snapshot) {
		const lastActive = new Map<string, string>();
		for (const feedEntry of input.feed ?? []) {
			if (!feedEntry.participantId) {
				continue;
			}
			const previous = lastActive.get(feedEntry.participantId);
			if (!previous || feedEntry.at > previous) {
				lastActive.set(feedEntry.participantId, feedEntry.at);
			}
		}
		for (const participant of snapshot.participants) {
			if (participant.kind !== "agent") {
				continue;
			}
			const ref = participant.ref ?? null;
			const id = ref ? agentProfileId(ref) : participant.id;
			const entry = byId.get(id) ?? emptyEntry(id, ref);
			if (!named.has(id)) {
				entry.displayName = participant.displayName;
			}
			entry.seat = seatFor(snapshot, participant);
			entry.runtimeBadge =
				snapshot.profilesByParticipantId[participant.id]?.runtimeBadge ?? null;
			entry.titles = activeTitleGrantsFor(
				snapshot,
				participant.id,
				input.now,
			).map((grant) => ({
				grantId: grant.id,
				title: grant.title,
				expiresAt: grant.expiresAt,
			}));
			entry.lastActiveAt = lastActive.get(participant.id) ?? null;
			byId.set(id, entry);
		}
	}

	return [...byId.values()].sort((a, b) =>
		a.displayName.localeCompare(b.displayName),
	);
}

export type AgentDirectorySort = "name" | "seated" | "role";

export const AGENT_DIRECTORY_SORTS: readonly {
	id: AgentDirectorySort;
	label: string;
}[] = [
	{ id: "seated", label: "On the call first" },
	{ id: "name", label: "Name" },
	{ id: "role", label: "Role" },
];

const STATUS_RANK: Record<ParticipantStatus, number> = {
	speaking: 0,
	working: 1,
	idle: 2,
	away: 3,
};

function seatRank(entry: AgentDirectoryEntry): number {
	return entry.seat ? STATUS_RANK[entry.seat.status] : 4;
}

/** Case-insensitive match over name, id, description, role and skills. */
export function matchesAgentQuery(
	entry: AgentDirectoryEntry,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return true;
	}
	const haystack = [
		entry.displayName,
		entry.profileId,
		entry.description ?? "",
		entry.seat?.role ?? "",
		...entry.skills,
		...entry.titles.map((title) => title.title),
	]
		.join("\n")
		.toLowerCase();
	return haystack.includes(needle);
}

export function sortAgentDirectory(
	entries: readonly AgentDirectoryEntry[],
	sort: AgentDirectorySort,
): AgentDirectoryEntry[] {
	const copy = [...entries];
	switch (sort) {
		case "name":
			return copy.sort((a, b) => a.displayName.localeCompare(b.displayName));
		case "seated":
			return copy.sort(
				(a, b) =>
					seatRank(a) - seatRank(b) ||
					a.displayName.localeCompare(b.displayName),
			);
		case "role":
			return copy.sort(
				(a, b) =>
					(a.seat ? 0 : 1) - (b.seat ? 0 : 1) ||
					(a.seat?.role ?? "").localeCompare(b.seat?.role ?? "") ||
					a.displayName.localeCompare(b.displayName),
			);
		default: {
			const _exhaustive: never = sort;
			return _exhaustive;
		}
	}
}

export function filterAndSortAgentDirectory(
	entries: readonly AgentDirectoryEntry[],
	query: string,
	sort: AgentDirectorySort,
): AgentDirectoryEntry[] {
	return sortAgentDirectory(
		entries.filter((entry) => matchesAgentQuery(entry, query)),
		sort,
	);
}

/** Runtime badge is family + location only — never a model or endpoint. */
export function runtimeBadgeLabel(badge: AgentRuntimeBadge | null): string {
	if (!badge) {
		return "Runtime not reported";
	}
	const family = titleCaseSlug(badge.family);
	const location =
		badge.executionLocation === "host"
			? "on this machine"
			: badge.executionLocation === "device"
				? "on a device"
				: "managed";
	return `${family} · ${location}`;
}

export function seatSourceLabel(sources: readonly SeatSource[]): string {
	if (sources.length === 0) {
		return "Seated";
	}
	return sources
		.map((source) => {
			switch (source.kind) {
				case "manual":
					return "Seated by you";
				case "pack":
					return `Pack · ${source.packId}`;
				case "spawn":
					return `Spawned by ${source.parentId}`;
				default: {
					const _exhaustive: never = source;
					return _exhaustive;
				}
			}
		})
		.join(" · ");
}

export function participantStatusLabel(status: ParticipantStatus): string {
	switch (status) {
		case "speaking":
			return "Speaking";
		case "working":
			return "Working";
		case "idle":
			return "Idle";
		case "away":
			return "Away";
		default: {
			const _exhaustive: never = status;
			return _exhaustive;
		}
	}
}

/** Short relative label for a timestamp, or null when it is unknown. */
export function relativeTimeLabel(
	iso: string | null,
	nowIso: string,
): string | null {
	if (!iso) {
		return null;
	}
	const then = Date.parse(iso);
	const now = Date.parse(nowIso);
	if (!Number.isFinite(then) || !Number.isFinite(now)) {
		return null;
	}
	const diff = Math.max(0, now - then);
	const seconds = Math.floor(diff / 1000);
	if (seconds < 10) {
		return "just now";
	}
	if (seconds < 60) {
		return `${seconds}s ago`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	return `${Math.floor(hours / 24)}d ago`;
}
