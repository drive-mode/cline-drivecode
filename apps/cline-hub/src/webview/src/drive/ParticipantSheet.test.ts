import type { Participant } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	applyAgentNameInk,
	applyPartnerDisplayName,
	DEFAULT_DRIVE_UI,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";

const partner: Participant = {
	id: DRIVE_PARTICIPANT_PARTNER,
	kind: "agent",
	displayName: "Ada",
	role: "partner",
	status: "idle",
	seatSources: [],
};

describe("applyPartnerDisplayName", () => {
	it("updates partnerName and matching agent participant", () => {
		const next = applyPartnerDisplayName(
			{
				...DEFAULT_DRIVE_UI,
				partnerName: "Ada",
				participants: [partner],
			},
			"  Nova  ",
			DRIVE_PARTICIPANT_PARTNER,
		);
		expect(next.partnerName).toBe("Nova");
		expect(next.participants[0]).toMatchObject({
			id: DRIVE_PARTICIPANT_PARTNER,
			displayName: "Nova",
		});
	});

	it("does not retitle partnerName when renaming a secondary agent", () => {
		const specialist: Participant = {
			id: "drive:specialist",
			kind: "agent",
			displayName: "Scout",
			role: "specialist",
			status: "idle",
			seatSources: [],
		};
		const next = applyPartnerDisplayName(
			{
				...DEFAULT_DRIVE_UI,
				partnerName: "Ada",
				participants: [partner, specialist],
			},
			"Nova",
			"drive:specialist",
		);
		expect(next.partnerName).toBe("Ada");
		expect(next.participants[0]).toMatchObject({
			id: DRIVE_PARTICIPANT_PARTNER,
			displayName: "Ada",
		});
		expect(next.participants[1]).toMatchObject({
			id: "drive:specialist",
			displayName: "Nova",
		});
	});

	it("ignores empty names", () => {
		const state = {
			...DEFAULT_DRIVE_UI,
			partnerName: "Ada",
			participants: [partner],
		};
		expect(applyPartnerDisplayName(state, "   ")).toBe(state);
	});
});

describe("applyAgentNameInk", () => {
	it("stores a durable palette ref under one profile id and clears it", () => {
		const tinted = applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 3);
		expect(tinted.agentInks["driveagent.nova"]?.nameInk).toEqual({
			kind: "palette",
			index: 3,
		});
		// No hex reaches state — the concrete colour is resolved per theme.
		expect(JSON.stringify(tinted.agentInks)).not.toContain("#");
		expect(
			applyAgentNameInk(tinted, "driveagent.nova", null).agentInks,
		).toEqual({});
		expect(applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 99)).toBe(
			DEFAULT_DRIVE_UI,
		);
	});

	it("clearing nameInk keeps a bodyInk the sibling channel may have set", () => {
		const withBody = {
			...DEFAULT_DRIVE_UI,
			agentInks: {
				"driveagent.nova": {
					nameInk: { kind: "palette", index: 2 },
					bodyInk: { kind: "token", token: "muted" },
				},
			},
		} as typeof DEFAULT_DRIVE_UI;
		const cleared = applyAgentNameInk(withBody, "driveagent.nova", null);
		expect(cleared.agentInks["driveagent.nova"]).toEqual({
			bodyInk: { kind: "token", token: "muted" },
		});
	});

	it("leaves other agents alone — the old global field repainted all of them", () => {
		const one = applyAgentNameInk(DEFAULT_DRIVE_UI, "driveagent.nova", 3);
		const two = applyAgentNameInk(one, "driveagent.reviewer", 1);
		expect(two.agentInks["driveagent.nova"]?.nameInk).toEqual({
			kind: "palette",
			index: 3,
		});
		expect(two.agentInks["driveagent.reviewer"]?.nameInk).toEqual({
			kind: "palette",
			index: 1,
		});
	});
});
