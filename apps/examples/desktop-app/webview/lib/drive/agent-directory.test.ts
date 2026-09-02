import { createEmptyRoomSnapshot } from "@cline/drive";
import type { AgentProfile, RoomSnapshot } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	activeTitleGrantsFor,
	buildAgentDirectory,
	filterAndSortAgentDirectory,
	matchesAgentQuery,
	parseAgentHomeListing,
	parseAgentProfiles,
	participantStatusLabel,
	relativeTimeLabel,
	runtimeBadgeLabel,
	seatSourceLabel,
	sortAgentDirectory,
} from "./agent-directory";
import type { DriveFeedEntry } from "./room-state";

const NOW = "2026-09-02T12:00:00.000Z";

function snapshotWithSeats(): RoomSnapshot {
	const base = createEmptyRoomSnapshot({
		roomId: "router-fix",
		createdAt: "2026-09-02T11:50:00.000Z",
		subMode: "act",
	});
	return {
		...base,
		driveActive: true,
		participants: [
			{
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
			{
				id: "drive:partner",
				kind: "agent",
				displayName: "Cline",
				role: "partner",
				status: "working",
				ref: { kind: "builtin", id: "pair_partner" },
				capPreset: "standard",
				seatSources: [{ kind: "manual" }],
			},
			{
				id: "agent:riley",
				kind: "agent",
				displayName: "Riley (seat)",
				role: "specialist",
				status: "speaking",
				ref: { kind: "driveagent", slug: "riley" },
				capPreset: "readonly",
				seatSources: [{ kind: "pack", packId: "router-fix-pack" }],
			},
			{
				id: "agent:legacy",
				kind: "agent",
				displayName: "Legacy",
				role: "specialist",
				status: "away",
				seatSources: [],
			},
		],
		titleGrantsById: {
			"grant-live": {
				id: "grant-live",
				agentId: "agent:riley",
				title: "presenter",
				scope: { kind: "stage", ref: "router-fix" },
				skillBundleRefs: [],
				resourceGrantRefs: [],
				delegatedAgentIds: [],
				permissions: ["stage.present"],
				grantedAt: "2026-09-02T11:55:00.000Z",
				expiresAt: "2026-09-02T12:30:00.000Z",
			},
			"grant-expired": {
				id: "grant-expired",
				agentId: "agent:riley",
				title: "builder",
				scope: { kind: "room", ref: "router-fix" },
				skillBundleRefs: [],
				resourceGrantRefs: [],
				delegatedAgentIds: [],
				permissions: ["stage.present"],
				grantedAt: "2026-09-02T10:00:00.000Z",
				expiresAt: "2026-09-02T11:00:00.000Z",
			},
			"grant-revoked": {
				id: "grant-revoked",
				agentId: "drive:partner",
				title: "scribe",
				scope: { kind: "room", ref: "router-fix" },
				skillBundleRefs: [],
				resourceGrantRefs: [],
				delegatedAgentIds: [],
				permissions: ["stage.present"],
				grantedAt: "2026-09-02T11:00:00.000Z",
				expiresAt: "2026-09-02T13:00:00.000Z",
				revokedAt: "2026-09-02T11:30:00.000Z",
			},
		},
		muteByParticipantId: { "agent:riley": true },
		raisedHandByParticipantId: { "drive:partner": true },
		profilesByParticipantId: {
			"drive:partner": {
				participantId: "drive:partner",
				runtimeBadge: { family: "cline", executionLocation: "host" },
			},
		},
	};
}

const profiles: AgentProfile[] = [
	{
		id: "driveagent.riley",
		ref: { kind: "driveagent", slug: "riley" },
		displayName: "Riley",
		nameInk: { kind: "palette", index: 2 },
		bodyInk: { kind: "token", token: "muted" },
	},
	{
		id: "builtin.pair_partner",
		ref: { kind: "builtin", id: "pair_partner" },
		nameInk: { kind: "palette", index: 5 },
		bodyInk: { kind: "token", token: "foreground" },
	},
];

const feed: DriveFeedEntry[] = [
	{
		id: "f1",
		kind: "narration",
		participantId: "agent:riley",
		text: "Running the suite.",
		at: "2026-09-02T11:58:00.000Z",
	},
	{
		id: "f2",
		kind: "narration",
		participantId: "agent:riley",
		text: "Two failures.",
		at: "2026-09-02T11:59:30.000Z",
	},
	{
		id: "f3",
		kind: "system",
		participantId: null,
		text: "Mode → act",
		at: "2026-09-02T11:59:45.000Z",
	},
];

describe("agent directory parsing", () => {
	it("keeps a home on its slug alone and drops junk", () => {
		expect(
			parseAgentHomeListing({
				homes: [
					{ slug: "riley", tier: "workspace", skills: ["run-tests", ""] },
					{
						slug: "scribe",
						tier: "user",
						displayName: " Scribe ",
						editable: false,
					},
					{ tier: "workspace" },
					"nope",
				],
			}),
		).toEqual([
			{ slug: "riley", tier: "workspace", skills: ["run-tests"] },
			{ slug: "scribe", tier: "user", displayName: "Scribe", editable: false },
		]);
		expect(parseAgentHomeListing(null)).toEqual([]);
	});

	it("re-validates profiles and accepts a single-profile reply", () => {
		expect(parseAgentProfiles({ profiles })).toEqual(profiles);
		expect(parseAgentProfiles({ profile: profiles[0] })).toEqual([profiles[0]]);
		expect(
			parseAgentProfiles({
				profiles: [
					{ id: "driveagent.riley", nameInk: { kind: "palette", index: 9 } },
					{
						id: "nonsense",
						nameInk: profiles[0]?.nameInk,
						bodyInk: profiles[0]?.bodyInk,
					},
					{ ...profiles[1], displayName: "   " },
				],
			}),
		).toEqual([{ ...profiles[1] }]);
	});
});

describe("agent directory fold", () => {
	it("merges homes, profiles and seats into one row per identity", () => {
		const entries = buildAgentDirectory({
			homes: [
				{
					slug: "riley",
					tier: "workspace",
					displayName: "Riley",
					description: "Runs the tests.",
					skills: ["run-tests"],
					editable: true,
				},
				{
					slug: "scribe",
					tier: "user",
					displayName: "Scribe",
					editable: false,
				},
			],
			profiles,
			snapshot: snapshotWithSeats(),
			feed,
			now: NOW,
		});
		expect(entries.map((entry) => entry.profileId)).toEqual([
			"builtin.pair_partner",
			"agent:legacy",
			"driveagent.riley",
			"driveagent.scribe",
		]);

		const riley = entries.find(
			(entry) => entry.profileId === "driveagent.riley",
		);
		expect(riley).toMatchObject({
			displayName: "Riley",
			hasHome: true,
			hasProfile: true,
			tier: "workspace",
			skills: ["run-tests"],
			nameInk: { kind: "palette", index: 2 },
			seat: {
				participantId: "agent:riley",
				role: "specialist",
				status: "speaking",
				capPreset: "readonly",
				muted: true,
				handRaised: false,
			},
			runtimeBadge: null,
			lastActiveAt: "2026-09-02T11:59:30.000Z",
		});
		expect(riley?.titles).toEqual([
			{
				grantId: "grant-live",
				title: "presenter",
				expiresAt: "2026-09-02T12:30:00.000Z",
			},
		]);

		const cline = entries.find(
			(entry) => entry.profileId === "builtin.pair_partner",
		);
		expect(cline).toMatchObject({
			displayName: "Cline",
			hasHome: false,
			hasProfile: true,
			runtimeBadge: { family: "cline", executionLocation: "host" },
			titles: [],
			seat: { handRaised: true, muted: false },
		});

		const legacy = entries.find((entry) => entry.profileId === "agent:legacy");
		expect(legacy).toMatchObject({
			ref: null,
			displayName: "Legacy",
			hasHome: false,
			hasProfile: false,
			seat: { status: "away" },
		});

		const scribe = entries.find(
			(entry) => entry.profileId === "driveagent.scribe",
		);
		expect(scribe).toMatchObject({
			tier: "user",
			editable: false,
			seat: null,
			lastActiveAt: null,
		});
	});

	it("lists a profile with no home and no seat, titled from its ref", () => {
		const entries = buildAgentDirectory({
			homes: [],
			profiles: [profiles[1] as AgentProfile],
			snapshot: null,
			now: NOW,
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]?.displayName).toBe("Pair Partner");
	});

	it("filters active title grants by agent, expiry and revocation", () => {
		const snapshot = snapshotWithSeats();
		expect(
			activeTitleGrantsFor(snapshot, "agent:riley", NOW).map((g) => g.id),
		).toEqual(["grant-live"]);
		expect(activeTitleGrantsFor(snapshot, "drive:partner", NOW)).toEqual([]);
		expect(activeTitleGrantsFor(null, "agent:riley", NOW)).toEqual([]);
	});
});

describe("agent directory search and sort", () => {
	const entries = buildAgentDirectory({
		homes: [
			{
				slug: "riley",
				tier: "workspace",
				displayName: "Riley",
				description: "Runs the tests.",
				skills: ["run-tests"],
			},
			{ slug: "scribe", tier: "user", displayName: "Scribe" },
		],
		profiles,
		snapshot: snapshotWithSeats(),
		now: NOW,
	});

	it("matches over name, id, description, role, skills and titles", () => {
		const riley = entries.find(
			(entry) => entry.profileId === "driveagent.riley",
		);
		if (!riley) {
			throw new Error("missing riley");
		}
		expect(matchesAgentQuery(riley, "")).toBe(true);
		expect(matchesAgentQuery(riley, "RUN-TESTS")).toBe(true);
		expect(matchesAgentQuery(riley, "presenter")).toBe(true);
		expect(matchesAgentQuery(riley, "specialist")).toBe(true);
		expect(matchesAgentQuery(riley, "driveagent.ri")).toBe(true);
		expect(matchesAgentQuery(riley, "zebra")).toBe(false);
	});

	it("sorts seated-first by status, by name, and by role", () => {
		expect(
			sortAgentDirectory(entries, "seated").map((entry) => entry.displayName),
		).toEqual(["Riley", "Cline", "Legacy", "Scribe"]);
		expect(
			sortAgentDirectory(entries, "name").map((entry) => entry.displayName),
		).toEqual(["Cline", "Legacy", "Riley", "Scribe"]);
		expect(
			sortAgentDirectory(entries, "role").map((entry) => entry.displayName),
		).toEqual(["Cline", "Legacy", "Riley", "Scribe"]);
		expect(
			filterAndSortAgentDirectory(entries, "ri", "name").map(
				(entry) => entry.displayName,
			),
		).toEqual(["Riley", "Scribe"]);
	});
});

describe("agent directory labels", () => {
	it("renders the runtime badge as family and location only", () => {
		expect(runtimeBadgeLabel(null)).toBe("Runtime not reported");
		expect(
			runtimeBadgeLabel({ family: "claude", executionLocation: "managed" }),
		).toBe("Claude · managed");
		expect(
			runtimeBadgeLabel({ family: "cline", executionLocation: "host" }),
		).toBe("Cline · on this machine");
	});

	it("labels seat sources and statuses", () => {
		expect(seatSourceLabel([])).toBe("Seated");
		expect(seatSourceLabel([{ kind: "manual" }])).toBe("Seated by you");
		expect(
			seatSourceLabel([
				{ kind: "pack", packId: "router-fix-pack" },
				{ kind: "spawn", parentId: "drive:partner" },
			]),
		).toBe("Pack · router-fix-pack · Spawned by drive:partner");
		expect(participantStatusLabel("speaking")).toBe("Speaking");
	});

	it("formats relative time or null", () => {
		expect(relativeTimeLabel(null, NOW)).toBeNull();
		expect(relativeTimeLabel("2026-09-02T11:59:58.000Z", NOW)).toBe("just now");
		expect(relativeTimeLabel("2026-09-02T11:59:20.000Z", NOW)).toBe("40s ago");
		expect(relativeTimeLabel("2026-09-02T11:30:00.000Z", NOW)).toBe("30m ago");
		expect(relativeTimeLabel("2026-09-02T09:00:00.000Z", NOW)).toBe("3h ago");
		expect(relativeTimeLabel("2026-08-30T09:00:00.000Z", NOW)).toBe("3d ago");
		expect(relativeTimeLabel("garbage", NOW)).toBeNull();
	});
});
