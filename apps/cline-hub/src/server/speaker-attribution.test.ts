import type { AddressSet, Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	clearTurnSpeaker,
	resolveAddressedSpeakerId,
	setTurnSpeaker,
	type TurnSpeakerStore,
} from "./speaker-attribution";

const human: Participant = {
	id: "drive:human",
	kind: "human",
	displayName: "Harrison",
	role: "host",
	status: "idle",
};

const partner: Participant = {
	id: "drive:partner",
	kind: "agent",
	displayName: "Partner",
	role: "partner",
	status: "idle",
	seatSources: [],
};

const specialist: Participant = {
	id: "agent:reviewer",
	kind: "agent",
	displayName: "Reviewer",
	role: "specialist",
	status: "idle",
	seatSources: [{ kind: "pack", packId: "review" }],
};

const everyone: AddressSet = { mode: "everyone" };

describe("resolveAddressedSpeakerId", () => {
	it("returns undefined with no snapshot", () => {
		expect(resolveAddressedSpeakerId(undefined)).toBeUndefined();
		expect(resolveAddressedSpeakerId(null)).toBeUndefined();
	});

	it("returns undefined when no agent is seated", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: everyone,
				participants: [human],
			}),
		).toBeUndefined();
	});

	it("attributes to the only seated agent", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: everyone,
				participants: [human, partner],
			}),
		).toBe("drive:partner");
	});

	it("returns undefined when everyone covers two agents", () => {
		// One runtime, two candidates — nothing says which one spoke.
		expect(
			resolveAddressedSpeakerId({
				addressSet: everyone,
				participants: [human, partner, specialist],
			}),
		).toBeUndefined();
	});

	it("attributes an explicitly addressed single agent", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "agents", agentIds: ["agent:reviewer"] },
				participants: [human, partner, specialist],
			}),
		).toBe("agent:reviewer");
	});

	it("returns undefined when two agents are addressed explicitly", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: {
					mode: "agents",
					agentIds: ["drive:partner", "agent:reviewer"],
				},
				participants: [human, partner, specialist],
			}),
		).toBeUndefined();
	});

	it("returns undefined when the addressed agent is not seated", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "agents", agentIds: ["agent:ghost"] },
				participants: [human, partner],
			}),
		).toBeUndefined();
	});

	it("attributes a pack address that resolves to one agent", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "pack", packId: "review" },
				participants: [human, partner, specialist],
			}),
		).toBe("agent:reviewer");
	});

	it("returns undefined for a pack nobody carries", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "pack", packId: "absent" },
				participants: [human, partner, specialist],
			}),
		).toBeUndefined();
	});

	it("treats one agent named twice as one, not as ambiguous", () => {
		expect(
			resolveAddressedSpeakerId({
				addressSet: {
					mode: "agents",
					agentIds: ["agent:reviewer", "agent:reviewer"],
				},
				participants: [human, partner, specialist],
			}),
		).toBe("agent:reviewer");
	});

	it("returns undefined instead of throwing on a malformed roster", () => {
		// Snapshots arrive as an unchecked cast off the wire, and pack
		// resolution reads `seatSources` without a guard.
		const brokenAgent = {
			id: "agent:legacy",
			kind: "agent",
			displayName: "Legacy",
			role: "specialist",
			status: "idle",
		} as unknown as Participant;
		expect(() =>
			resolveAddressedSpeakerId({
				addressSet: { mode: "pack", packId: "review" },
				participants: [human, brokenAgent],
			}),
		).not.toThrow();
		expect(
			resolveAddressedSpeakerId({
				addressSet: { mode: "pack", packId: "review" },
				participants: [human, brokenAgent],
			}),
		).toBeUndefined();
	});
});

describe("turn speaker lifecycle", () => {
	const store = (): TurnSpeakerStore => ({
		turnSpeakerBySessionId: new Map<string, string>(),
	});

	it("records a resolved speaker for the session", () => {
		const ctx = store();
		setTurnSpeaker(ctx, "s1", "drive:partner");
		expect(ctx.turnSpeakerBySessionId.get("s1")).toBe("drive:partner");
	});

	it("erases the previous speaker when the next turn is unattributed", () => {
		// A second agent gets seated: the address is now ambiguous, and the
		// earlier id must not carry over onto this turn's deltas.
		const ctx = store();
		setTurnSpeaker(ctx, "s1", "drive:partner");
		setTurnSpeaker(ctx, "s1", undefined);
		expect(ctx.turnSpeakerBySessionId.has("s1")).toBe(false);
	});

	it("drops the attribution once the turn ends", () => {
		const ctx = store();
		setTurnSpeaker(ctx, "s1", "drive:partner");
		clearTurnSpeaker(ctx, "s1");
		expect(ctx.turnSpeakerBySessionId.has("s1")).toBe(false);
	});

	it("keeps sessions independent", () => {
		const ctx = store();
		setTurnSpeaker(ctx, "s1", "drive:partner");
		setTurnSpeaker(ctx, "s2", "agent:reviewer");
		clearTurnSpeaker(ctx, "s1");
		expect(ctx.turnSpeakerBySessionId.get("s2")).toBe("agent:reviewer");
	});
});
