import { describe, expect, it } from "vitest";
import {
	AgentParticipantSchema,
	PermissionPresetSchema,
	parseParticipant,
} from "./index";

/** A join event written before `ref` / `capPreset` existed. */
const legacyAgent = {
	id: "agent_1",
	kind: "agent",
	displayName: "Partner",
	role: "partner",
	status: "idle",
	seatSources: [{ kind: "pack", packId: "pack_review" }],
} as const;

describe("AgentParticipantSchema identity + preset fields", () => {
	it("parses a participant persisted before the fields existed", () => {
		const parsed = AgentParticipantSchema.parse(legacyAgent);
		expect(parsed.ref).toBeUndefined();
		expect(parsed.capPreset).toBeUndefined();
	});

	it("keeps the fields absent after a JSON round-trip", () => {
		const parsed = AgentParticipantSchema.parse(legacyAgent);
		const roundTripped = JSON.parse(JSON.stringify(parsed)) as unknown;
		expect(roundTripped).not.toHaveProperty("ref");
		expect(roundTripped).not.toHaveProperty("capPreset");
		expect(AgentParticipantSchema.parse(roundTripped)).toEqual(parsed);
	});

	it("carries a driveagent ref and a capped preset when seated with them", () => {
		const parsed = AgentParticipantSchema.parse({
			...legacyAgent,
			ref: { kind: "driveagent", slug: "pair-partner" },
			capPreset: "readonly",
		});
		expect(parsed.ref).toEqual({ kind: "driveagent", slug: "pair-partner" });
		expect(parsed.capPreset).toBe("readonly");
	});

	it("carries a builtin ref", () => {
		const parsed = AgentParticipantSchema.parse({
			...legacyAgent,
			ref: { kind: "builtin", id: "pair_partner" },
		});
		expect(parsed.ref).toEqual({ kind: "builtin", id: "pair_partner" });
	});

	it("rejects a malformed ref rather than silently dropping it", () => {
		expect(() =>
			AgentParticipantSchema.parse({
				...legacyAgent,
				ref: { kind: "driveagent", slug: "Bad_Slug" },
			}),
		).toThrow();
		expect(() =>
			AgentParticipantSchema.parse({ ...legacyAgent, ref: "pair-partner" }),
		).toThrow();
	});

	it("rejects a preset outside the locked ceiling set", () => {
		expect(() =>
			AgentParticipantSchema.parse({ ...legacyAgent, capPreset: "admin" }),
		).toThrow();
		expect(PermissionPresetSchema.options).toEqual([
			"readonly",
			"standard",
			"full",
		]);
	});

	it("still rejects unknown keys on the strict participant union", () => {
		expect(() =>
			parseParticipant({ ...legacyAgent, systemPrompt: "leak" }),
		).toThrow();
	});
});
