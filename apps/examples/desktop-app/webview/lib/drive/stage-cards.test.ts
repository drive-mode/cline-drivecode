import type { AgentTitleGrant, Participant, StageCard } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	buildAddressChoices,
	buildHumanPinDefaults,
	formatAddressSetLabel,
	formatElapsed,
	formatGrantRemaining,
	formatRelativeAge,
	grantsForAgent,
	isClineParticipant,
	isGrantActive,
	nextSpotlightSharer,
	orderStageCards,
	participantInitials,
	preferredAgentSharer,
	presenterActionFor,
	runtimeBadgeLabel,
	sameAddressSet,
	seatSourceLabel,
	stageCardTestStatus,
} from "./stage-cards";

const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "You",
	role: "host",
	status: "idle",
};
const cline: Participant = {
	id: "drive:partner",
	kind: "agent",
	displayName: "Cline",
	role: "partner",
	status: "working",
	ref: { kind: "builtin", id: "pair_partner" },
	seatSources: [{ kind: "manual" }],
};
const riley: Participant = {
	id: "agent:riley",
	kind: "agent",
	displayName: "Riley Chen",
	role: "specialist",
	status: "working",
	ref: { kind: "driveagent", slug: "riley" },
	seatSources: [{ kind: "pack", packId: "router-fix-pack" }],
};
const sam: Participant = {
	id: "agent:sam",
	kind: "agent",
	displayName: "Sam",
	role: "recorder",
	status: "idle",
	ref: { kind: "driveagent", slug: "sam" },
	seatSources: [{ kind: "pack", packId: "router-fix-pack" }],
};

function card(
	id: string,
	category: StageCard["category"],
	updatedAt: string,
	summary?: string,
): StageCard {
	return {
		id,
		category,
		title: id,
		updatedAt,
		...(summary ? { summary } : {}),
	};
}

function grant(
	id: string,
	agentId: string,
	grantedAt: string,
	expiresAt: string,
	extra: Partial<AgentTitleGrant> = {},
): AgentTitleGrant {
	return {
		id,
		agentId,
		title: "presenter",
		scope: { kind: "stage", ref: "router-fix" },
		skillBundleRefs: [],
		resourceGrantRefs: [],
		delegatedAgentIds: [],
		permissions: ["stage.present"],
		grantedAt,
		expiresAt,
		...extra,
	};
}

describe("orderStageCards", () => {
	it("puts the most recently updated card first, later kernel entries first on ties", () => {
		const cards = [
			card("edit", "edit", iso(0)),
			card("command", "command", iso(2_000)),
			card("test", "test", iso(1_000)),
			card("plan", "plan", iso(2_000)),
		];
		expect(orderStageCards(cards).map((entry) => entry.id)).toEqual([
			"plan",
			"command",
			"test",
			"edit",
		]);
		// Pure: the input order is untouched.
		expect(cards.map((entry) => entry.id)).toEqual([
			"edit",
			"command",
			"test",
			"plan",
		]);
	});
});

describe("stageCardTestStatus", () => {
	it("reads the kernel's summary text", () => {
		expect(stageCardTestStatus("42 passed, 0 failed")).toBe("failed");
		expect(stageCardTestStatus("retry once — green")).toBe("passed");
		expect(stageCardTestStatus("running 3 suites")).toBe("running");
		expect(stageCardTestStatus(undefined)).toBe("passed");
	});
});

describe("buildHumanPinDefaults", () => {
	it("seeds file and terminal pins from the last edit and command cards", () => {
		const defaults = buildHumanPinDefaults(
			[
				card("old.ts", "edit", iso(0), "old\nmore"),
				card("router.ts", "edit", iso(1), "Guard scheduleRetry.\nline two"),
				card("bun test", "command", iso(2), "42 passed"),
			],
			"  const x = 1;  ",
		);
		expect(defaults.selection).toEqual({
			kind: "selection",
			label: "const x = 1;",
			ref: "const x = 1;",
		});
		expect(defaults.file).toEqual({
			kind: "file",
			label: "router.ts",
			ref: "Guard scheduleRetry.",
		});
		expect(defaults.terminal).toEqual({
			kind: "terminal",
			label: "bun test",
			ref: "42 passed",
		});
	});

	it("truncates long selections and explains an empty one", () => {
		const long = "x".repeat(80);
		expect(buildHumanPinDefaults([], long).selection.label).toBe(
			`${"x".repeat(45)}…`,
		);
		const empty = buildHumanPinDefaults([]);
		expect(empty.selection.label).toBe("Current selection");
		expect(empty.selection.ref).toMatch(/No text selected/);
		expect(empty.file.label).toBe("Shared file");
		expect(empty.terminal.label).toBe("Terminal");
	});
});

describe("spotlight hand-off", () => {
	it("prefers the Presenter, then the partner, then the first agent", () => {
		expect(preferredAgentSharer([sam, riley, cline], "agent:riley")?.id).toBe(
			"agent:riley",
		);
		expect(preferredAgentSharer([sam, riley, cline])?.id).toBe("drive:partner");
		expect(preferredAgentSharer([sam, riley])?.id).toBe("agent:sam");
		expect(preferredAgentSharer([human])).toBeNull();
	});

	it("moves you ↔ agent", () => {
		expect(
			nextSpotlightSharer({
				sharer: { kind: "agent", participantId: "drive:partner" },
				humanId: "drive:human",
				agents: [cline, riley],
			}),
		).toEqual({ kind: "human", participantId: "drive:human" });
		expect(
			nextSpotlightSharer({
				sharer: { kind: "human", participantId: "drive:human" },
				humanId: "drive:human",
				agents: [cline, riley],
				presenterAgentId: "agent:riley",
			}),
		).toEqual({ kind: "agent", participantId: "agent:riley" });
	});

	it("fills an empty stage with an agent, then you, and returns null with nobody", () => {
		expect(
			nextSpotlightSharer({
				sharer: null,
				humanId: "drive:human",
				agents: [cline],
			}),
		).toEqual({ kind: "agent", participantId: "drive:partner" });
		expect(
			nextSpotlightSharer({ sharer: null, humanId: "drive:human", agents: [] }),
		).toEqual({ kind: "human", participantId: "drive:human" });
		expect(
			nextSpotlightSharer({ sharer: null, humanId: null, agents: [] }),
		).toBeNull();
		expect(
			nextSpotlightSharer({
				sharer: { kind: "agent", participantId: "drive:partner" },
				humanId: null,
				agents: [cline],
			}),
		).toBeNull();
	});
});

describe("presenter", () => {
	const active = grant("g1", "drive:partner", iso(0), iso(4 * 3_600_000));

	it("resolves the exclusive action per agent", () => {
		expect(presenterActionFor("drive:partner", null)).toBe("grant");
		expect(presenterActionFor("drive:partner", active)).toBe("revoke");
		expect(presenterActionFor("agent:riley", active)).toBe("transfer");
	});

	it("formats what is left on a grant", () => {
		expect(formatGrantRemaining(active, T0)).toBe("4h left");
		expect(formatGrantRemaining(active, T0 + 3_600_000 + 90_000)).toBe(
			"2h 58m left",
		);
		expect(formatGrantRemaining(active, T0 + 4 * 3_600_000 - 30_000)).toBe(
			"under a minute left",
		);
		expect(formatGrantRemaining(active, T0 + 5 * 3_600_000)).toBe("expired");
		expect(formatGrantRemaining({ ...active, revokedAt: iso(1) }, T0)).toBe(
			"revoked",
		);
	});

	it("knows whether a grant is active now", () => {
		expect(isGrantActive(active, T0 + 1)).toBe(true);
		expect(isGrantActive(active, T0 + 5 * 3_600_000)).toBe(false);
		expect(isGrantActive({ ...active, revokedAt: iso(1) }, T0 + 2)).toBe(false);
		expect(isGrantActive({ ...active, notBefore: iso(60_000) }, T0 + 1)).toBe(
			false,
		);
	});

	it("lists an agent's grants newest first", () => {
		const older = grant("g0", "drive:partner", iso(-60_000), iso(0), {
			revokedAt: iso(-1),
		});
		const other = grant("g2", "agent:riley", iso(0), iso(1));
		expect(
			grantsForAgent({ g0: older, g1: active, g2: other }, "drive:partner").map(
				(entry) => entry.id,
			),
		).toEqual(["g1", "g0"]);
		expect(grantsForAgent(undefined, "x")).toEqual([]);
	});
});

describe("address", () => {
	it("labels the address set with seated names", () => {
		expect(formatAddressSetLabel({ mode: "everyone" })).toBe("Everyone");
		expect(
			formatAddressSetLabel({ mode: "pack", packId: "router-fix-pack" }),
		).toBe("Pack · router-fix-pack");
		expect(
			formatAddressSetLabel({ mode: "agents", agentIds: ["agent:riley"] }, [
				riley,
			]),
		).toBe("Riley Chen");
		expect(
			formatAddressSetLabel(
				{ mode: "agents", agentIds: ["agent:riley", "agent:sam", "x"] },
				[riley, sam],
			),
		).toBe("Riley Chen + Sam…");
	});

	it("builds everyone / one / many / pack choices from the roster", () => {
		const choices = buildAddressChoices([human, cline, riley, sam]);
		expect(choices.map((choice) => choice.id)).toEqual([
			"everyone",
			"agent:drive:partner",
			"agent:agent:riley",
			"agent:agent:sam",
			"agents:all",
			"pack:router-fix-pack",
		]);
		expect(choices.map((choice) => choice.kind)).toEqual([
			"everyone",
			"one",
			"one",
			"one",
			"many",
			"pack",
		]);
		expect(
			buildAddressChoices([human, cline]).map((choice) => choice.id),
		).toEqual(["everyone", "agent:drive:partner"]);
	});

	it("compares address sets structurally", () => {
		expect(sameAddressSet({ mode: "everyone" }, { mode: "everyone" })).toBe(
			true,
		);
		expect(
			sameAddressSet(
				{ mode: "agents", agentIds: ["a", "b"] },
				{ mode: "agents", agentIds: ["b", "a"] },
			),
		).toBe(true);
		expect(
			sameAddressSet(
				{ mode: "agents", agentIds: ["a"] },
				{ mode: "agents", agentIds: ["a", "b"] },
			),
		).toBe(false);
		expect(
			sameAddressSet(
				{ mode: "pack", packId: "p" },
				{ mode: "pack", packId: "q" },
			),
		).toBe(false);
		expect(
			sameAddressSet({ mode: "everyone" }, { mode: "pack", packId: "p" }),
		).toBe(false);
	});
});

describe("roster copy", () => {
	it("marks only the builtin pair partner as Cline", () => {
		expect(isClineParticipant(cline)).toBe(true);
		expect(isClineParticipant(riley)).toBe(false);
		expect(isClineParticipant(human)).toBe(false);
		expect(
			isClineParticipant({ ...riley, ref: undefined, id: "drive:partner" }),
		).toBe(true);
	});

	it("builds initials", () => {
		expect(participantInitials(riley)).toBe("RC");
		expect(participantInitials(sam)).toBe("S");
		expect(participantInitials({ ...sam, displayName: " " })).toBe("A");
	});

	it("labels seat sources and runtime badges without leaking anything", () => {
		expect(seatSourceLabel({ kind: "manual" })).toBe("seated manually");
		expect(seatSourceLabel({ kind: "pack", packId: "p" })).toBe("pack · p");
		expect(seatSourceLabel({ kind: "spawn", parentId: "cline" })).toBe(
			"spawned by cline",
		);
		expect(
			runtimeBadgeLabel({ family: "claude", executionLocation: "host" }),
		).toBe("claude · host");
	});
});

describe("time", () => {
	it("formats elapsed call time", () => {
		expect(formatElapsed(0)).toBe("00:00");
		expect(formatElapsed(-5)).toBe("00:00");
		expect(formatElapsed(65_000)).toBe("01:05");
		expect(formatElapsed(3_723_000)).toBe("1:02:03");
	});

	it("formats compact ages", () => {
		expect(formatRelativeAge(iso(0), T0 + 5_000)).toBe("now");
		expect(formatRelativeAge(iso(0), T0 + 42_000)).toBe("42s");
		expect(formatRelativeAge(iso(0), T0 + 3 * 60_000)).toBe("3m");
		expect(formatRelativeAge(iso(0), T0 + 2 * 3_600_000)).toBe("2h");
		expect(formatRelativeAge(iso(0), T0 + 30 * 3_600_000)).toBe("1d");
		expect(formatRelativeAge("nope", T0)).toBe("");
		expect(formatRelativeAge(null, T0)).toBe("");
	});
});
