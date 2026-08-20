import { describe, expect, it } from "vitest";
import {
	AgentParticipantSchema,
	AgentRuntimeBadgeSchema,
	AgentTitleAuthorizationRequestSchema,
	AgentTitleGrantSchema,
	AgentTitleSchema,
	PermissionPresetSchema,
	parseParticipant,
} from "./index";

describe("Agent Title schemas", () => {
	it("keeps the core registry small and capability-oriented", () => {
		expect(AgentTitleSchema.options).toEqual([
			"presenter",
			"researcher",
			"builder",
			"reviewer",
			"verifier",
			"scribe",
		]);
	});

	it("accepts rich grants while preserving legacy Presenter logs", () => {
		const legacy = AgentTitleGrantSchema.parse({
			id: "legacy-presenter",
			agentId: "maya",
			title: "presenter",
			scope: { kind: "stage", ref: "room-1" },
			skillBundleRefs: ["presenter-stage"],
			resourceGrantRefs: ["typed-stage"],
			delegatedAgentIds: [],
			permissions: ["stage.present"],
			grantedAt: "2026-08-18T12:00:00.000Z",
			expiresAt: "2026-08-18T13:00:00.000Z",
		});
		expect(legacy.definitionRef).toBeUndefined();

		const rich = AgentTitleGrantSchema.parse({
			...legacy,
			id: "builder-1",
			title: "builder",
			definitionRef: "builder@1",
			scope: { kind: "target", ref: "opaque-target-1" },
			skillBundleRefs: ["builder-target"],
			resourceGrantRefs: [],
			permissions: ["target.modify"],
			issuedAt: "2026-08-18T12:00:00.000Z",
			notBefore: "2026-08-18T12:00:00.000Z",
			generation: 1,
			exclusivityKey: "target/opaque-target-1",
			grantedBy: "cline:coordinator",
			policyRef: "drive.agent-titles@1",
		});
		expect(rich).toMatchObject({
			definitionRef: "builder@1",
			generation: 1,
			permissions: ["target.modify"],
		});
	});

	it("requires one grant id and generation per authorization decision", () => {
		const request = {
			grantId: "builder-1",
			agentId: "maya",
			permission: "target.modify",
			scope: { kind: "target", ref: "opaque-target-1" },
			generation: 1,
		};
		expect(
			AgentTitleAuthorizationRequestSchema.safeParse(request).success,
		).toBe(true);
		expect(
			AgentTitleAuthorizationRequestSchema.safeParse({
				...request,
				grantIds: ["builder-1", "presenter-1"],
			}).success,
		).toBe(false);
		expect(
			AgentTitleAuthorizationRequestSchema.safeParse({
				...request,
				generation: undefined,
			}).success,
		).toBe(false);
	});
});

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

describe("AgentRuntimeBadgeSchema", () => {
	it("accepts an allowlisted family and execution location", () => {
		expect(
			AgentRuntimeBadgeSchema.parse({
				family: "cline",
				executionLocation: "host",
			}),
		).toEqual({ family: "cline", executionLocation: "host" });
	});

	it("rejects a family outside the allowlist", () => {
		expect(() =>
			AgentRuntimeBadgeSchema.parse({
				family: "gpt",
				executionLocation: "host",
			}),
		).toThrow();
	});

	it("stays sanitized — extra runtime detail is rejected", () => {
		expect(() =>
			AgentRuntimeBadgeSchema.parse({
				family: "claude",
				executionLocation: "managed",
				modelId: "some-model",
			}),
		).toThrow();
	});
});
