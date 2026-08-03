import { describe, expect, it } from "vitest";
import type { AgentRef } from "../agentRef";
import {
	AgentAppearanceSchema,
	AgentProfileSchema,
	agentProfileId,
	DEFAULT_AGENT_PROFILE_ID,
	DRIVE_FACET_FORBIDDEN_PROMPT_KEYS,
	emptyFacetDiskSnapshot,
	mergeFacetScopes,
	parseAgentProfileId,
	parseDriveFacetDiskFile,
	toAgentProfile,
	UnknownFacetSchemaVersionError,
} from "./index";

describe("parseDriveFacetDiskFile", () => {
	it("parses a v1 envelope", () => {
		const file = parseDriveFacetDiskFile({
			schemaVersion: 1,
			entries: {
				"drive.defaults.subMode": { kind: "value", value: "act" },
			},
		});
		expect(file.entries["drive.defaults.subMode"]).toEqual({
			kind: "value",
			value: "act",
		});
	});

	it("rejects an unknown schemaVersion major with a named error", () => {
		expect(() =>
			parseDriveFacetDiskFile({
				schemaVersion: 99,
				entries: {},
			}),
		).toThrow(UnknownFacetSchemaVersionError);
	});
});

describe("mergeFacetScopes", () => {
	it("applies workspace-over-user precedence", () => {
		const merged = mergeFacetScopes(
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "plan" },
				},
			},
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "debug" },
				},
			},
		);
		expect(merged.values["drive.defaults.subMode"]).toBe("debug");
	});

	it("inherits user value when workspace key is absent", () => {
		const merged = mergeFacetScopes(
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "ask" },
				},
			},
			{ schemaVersion: 1, entries: {} },
		);
		expect(merged.values["drive.defaults.subMode"]).toBe("ask");
	});

	it("hides user value behind a workspace tombstone", () => {
		const merged = mergeFacetScopes(
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "value", value: "plan" },
					"agent.appearance": {
						kind: "map",
						entries: {
							partner: {
								kind: "value",
								value: {
									nameInk: { kind: "token", token: "foreground" },
									bodyInk: { kind: "token", token: "muted" },
								},
							},
						},
					},
				},
			},
			{
				schemaVersion: 1,
				entries: {
					"drive.defaults.subMode": { kind: "tombstone" },
					"agent.appearance": {
						kind: "map",
						entries: {
							partner: { kind: "tombstone" },
						},
					},
				},
			},
		);
		expect(merged.values["drive.defaults.subMode"]).toBeUndefined();
		expect(merged.maps["agent.appearance"]?.partner).toBeUndefined();
	});

	it("returns an empty snapshot for null scopes", () => {
		expect(mergeFacetScopes(null, null)).toEqual(emptyFacetDiskSnapshot());
	});
});

const appearanceBase = {
	nameInk: { kind: "token" as const, token: "foreground" as const },
	bodyInk: { kind: "token" as const, token: "muted" as const },
};

describe("AgentAppearanceSchema privacy", () => {
	it("accepts ink-only appearance", () => {
		const value = AgentAppearanceSchema.parse({
			displayName: "Partner",
			nameInk: { kind: "palette", index: 3 },
			bodyInk: { kind: "token", token: "muted" },
		});
		expect(value.displayName).toBe("Partner");
	});

	it("rejects prompt / tool / model fields (DEC-agent-SoT)", () => {
		for (const key of DRIVE_FACET_FORBIDDEN_PROMPT_KEYS) {
			const result = AgentAppearanceSchema.safeParse({
				...appearanceBase,
				[key]: "should-not-persist",
			});
			expect(result.success).toBe(false);
		}
	});

	it("rejects raw hex ink", () => {
		expect(
			InkLikeHexRejected({
				nameInk: { kind: "hex", hex: "#ff00ff" },
				bodyInk: { kind: "token", token: "muted" },
			}),
		).toBe(true);
	});
});

describe("AgentProfileSchema no-prompt invariant", () => {
	const profileBase = {
		id: "partner",
		ref: { kind: "driveagent" as const, slug: "pair-partner" },
		...appearanceBase,
	};

	it("accepts appearance-only profile with AgentRef", () => {
		const profile = AgentProfileSchema.parse({
			...profileBase,
			displayName: "Partner",
		});
		expect(profile.ref).toEqual({
			kind: "driveagent",
			slug: "pair-partner",
		});
	});

	it("rejects systemPrompt, tools, skills, providerId, modelId", () => {
		for (const key of [
			"systemPrompt",
			"tools",
			"skills",
			"providerId",
			"modelId",
		] as const) {
			const result = AgentProfileSchema.safeParse({
				...profileBase,
				[key]: key === "tools" || key === "skills" ? [] : "nope",
			});
			expect(result.success).toBe(false);
		}
	});

	it("rejects every DRIVE_FACET_FORBIDDEN_PROMPT_KEYS entry", () => {
		for (const key of DRIVE_FACET_FORBIDDEN_PROMPT_KEYS) {
			const result = AgentProfileSchema.safeParse({
				...profileBase,
				[key]: "should-not-persist",
			});
			expect(result.success).toBe(false);
		}
	});
});

describe("facet document no-prompt invariant", () => {
	it("rejects forbidden keys nested in agent.appearance map values via profile schema", () => {
		const disk = parseDriveFacetDiskFile({
			schemaVersion: 1,
			entries: {
				"agent.appearance": {
					kind: "map",
					entries: {
						partner: {
							kind: "value",
							value: {
								...appearanceBase,
								displayName: "Partner",
							},
						},
					},
				},
			},
		});
		const appearance = disk.entries["agent.appearance"];
		expect(appearance?.kind).toBe("map");
		if (appearance?.kind !== "map") {
			return;
		}
		const entry = appearance.entries.partner;
		expect(entry?.kind).toBe("value");
		if (entry?.kind !== "value") {
			return;
		}
		expect(AgentAppearanceSchema.safeParse(entry.value).success).toBe(true);
		for (const key of DRIVE_FACET_FORBIDDEN_PROMPT_KEYS) {
			expect(
				AgentAppearanceSchema.safeParse({
					...(entry.value as object),
					[key]: "nope",
				}).success,
			).toBe(false);
		}
	});
});

describe("agentProfileId", () => {
	/**
	 * The id is the only place the ref survives — the `agent.appearance` map
	 * stores appearance alone. A lossy id would strand every stored appearance
	 * on an agent nobody could name again.
	 */
	const refs: AgentRef[] = [
		{ kind: "driveagent", slug: "pair-partner" },
		{ kind: "driveagent", slug: "a1" },
		{ kind: "builtin", id: "pair_partner" },
		{ kind: "configured", id: "legacy-1" },
		// Ids may contain the separator; the split is on the first one only.
		{ kind: "builtin", id: "team.reviewer.v2" },
	];

	it("round-trips every AgentRef kind", () => {
		for (const ref of refs) {
			expect(parseAgentProfileId(agentProfileId(ref))).toEqual(ref);
		}
	});

	it("gives distinct kinds distinct ids", () => {
		const ids = refs.map(agentProfileId);
		expect(new Set(ids).size).toBe(refs.length);
		expect(agentProfileId({ kind: "builtin", id: "x" })).not.toBe(
			agentProfileId({ kind: "configured", id: "x" }),
		);
	});

	it("agrees with the store's default instance id", () => {
		expect(agentProfileId({ kind: "builtin", id: "pair_partner" })).toBe(
			DEFAULT_AGENT_PROFILE_ID,
		);
	});

	it("returns null rather than inventing a ref for a non-canonical id", () => {
		for (const id of [
			"",
			"partner",
			".partner",
			"builtin.",
			"unknown.thing",
			// Driveagent slugs are `[a-z0-9-]+`; an invalid one is not a ref.
			"driveagent.Not_A_Slug",
		]) {
			expect(parseAgentProfileId(id)).toBeNull();
		}
	});

	it("rebuilds a schema-valid AgentProfile from id + appearance", () => {
		const id = agentProfileId({ kind: "driveagent", slug: "pair-partner" });
		const profile = toAgentProfile(id, {
			displayName: "Partner",
			...appearanceBase,
		});
		expect(AgentProfileSchema.safeParse(profile).success).toBe(true);
		expect(profile?.ref).toEqual({ kind: "driveagent", slug: "pair-partner" });
	});
});

function InkLikeHexRejected(value: unknown): boolean {
	return !AgentAppearanceSchema.safeParse(value).success;
}
