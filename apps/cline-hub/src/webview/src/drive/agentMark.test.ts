/**
 * Avatar identity (DRV-AGENT-PROFILE).
 *
 * The inert risk this guards is "an avatar that is the Cline mark for
 * everyone" — the exact shape of the boolean `sharerIsAgent` gate it replaced.
 * Asserting that *an* avatar renders would not catch it; only asserting that
 * two different refs produce two different marks does.
 */

import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentAvatarInitial,
	agentAvatarKind,
	CLINE_BUILTIN_REF_ID,
	isClineParticipant,
} from "./agentMark";
import { DRIVE_PARTICIPANT_HUMAN, DRIVE_PARTICIPANT_PARTNER } from "./types";

function agent(overrides: Partial<Participant> = {}): Participant {
	return {
		id: "nova",
		kind: "agent",
		displayName: "Nova",
		role: "specialist",
		status: "idle",
		seatSources: [],
		...overrides,
	} as Participant;
}

describe("agentAvatarKind", () => {
	it("gives the Cline mark only to the builtin pair partner", () => {
		expect(
			agentAvatarKind(
				agent({ ref: { kind: "builtin", id: CLINE_BUILTIN_REF_ID } }),
			),
		).toBe("cline-mark");
	});

	it("two agents with different refs render different avatars", () => {
		const cline = agent({
			id: "cline",
			displayName: "Cline",
			ref: { kind: "builtin", id: CLINE_BUILTIN_REF_ID },
		});
		const nova = agent({
			id: "nova",
			displayName: "Nova",
			ref: { kind: "driveagent", slug: "nova" },
		});
		expect(agentAvatarKind(cline)).not.toBe(agentAvatarKind(nova));
		expect(agentAvatarKind(nova)).toBe("initial");
		expect(agentAvatarInitial(nova)).toBe("N");
	});

	it("does not give the Cline mark to a non-pair_partner ref", () => {
		// Every ref shape that is not the builtin partner, including a
		// Driveagent home that happens to share the partner's slug: it is a
		// workspace-authored agent with its own prompt, not Cline.
		const impostors: Participant[] = [
			agent({ ref: { kind: "driveagent", slug: "pair-partner" } }),
			agent({ ref: { kind: "builtin", id: "other" } }),
			agent({ ref: { kind: "configured", id: "pair_partner" } }),
		];
		for (const participant of impostors) {
			expect(agentAvatarKind(participant)).toBe("initial");
			expect(isClineParticipant(participant)).toBe(false);
		}
	});

	it("keeps the mark for a legacy partner seat that predates ref", () => {
		// Event logs written before `ref` existed carry none, and the hub's own
		// partner id only ever named the builtin partner.
		expect(
			agentAvatarKind(agent({ id: DRIVE_PARTICIPANT_PARTNER, ref: undefined })),
		).toBe("cline-mark");
	});

	it("does not infer identity from the partner role alone", () => {
		// A Driveagent can be seated as `partner`; that is a seat, not an
		// identity, and the old boolean gate is exactly this mistake.
		expect(
			agentAvatarKind(
				agent({
					id: "reviewer",
					role: "partner",
					ref: { kind: "driveagent", slug: "reviewer" },
				}),
			),
		).toBe("initial");
	});

	it("never marks a human", () => {
		const human: Participant = {
			id: DRIVE_PARTICIPANT_HUMAN,
			kind: "human",
			displayName: "You",
			role: "host",
			status: "idle",
		};
		expect(isClineParticipant(human)).toBe(false);
		expect(agentAvatarInitial(human)).toBe("Y");
	});

	it("falls back to the id, then to ?, for a blank display name", () => {
		expect(agentAvatarInitial(agent({ displayName: "   " }))).toBe("N");
		expect(agentAvatarInitial(agent({ displayName: " ", id: " " }))).toBe("?");
	});
});
