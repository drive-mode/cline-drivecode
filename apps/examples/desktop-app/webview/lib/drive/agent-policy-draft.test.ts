import { describe, expect, it } from "vitest";
import {
	AGENT_POLICY_PRESET_OPTIONS,
	type AgentHomeProjection,
	buildPolicyPatch,
	draftFromProjection,
	parseAgentHomeReply,
	parsePolicyList,
	policyDraftDirty,
	policySavedMessage,
	presetIntentLabel,
	validatePolicyDraft,
} from "./agent-policy-draft";

const loaded: AgentHomeProjection = {
	slug: "riley",
	agent: {
		name: "Riley",
		description: "Runs the tests and reads the failures back plainly.",
		skills: ["run-tests", "read-failures"],
		editable: true,
	},
	permissions: {
		presetIntent: "standard",
		approvalHooks: ["before-shell"],
		notes: "",
		reported: true,
	},
	compiled: {
		name: "Riley",
		slug: "riley",
		description: "Runs the tests and reads the failures back plainly.",
		skills: ["run-tests", "read-failures"],
	},
	tier: "workspace",
};

describe("agent home reply parsing", () => {
	it("parses the sanitized shape and ignores any tool list", () => {
		const parsed = parseAgentHomeReply({
			home: {
				slug: "riley",
				agent: {
					name: "Riley",
					description: "Runs the tests.",
					tools: ["shell", "edit"],
					skills: ["run-tests"],
					editable: true,
				},
				permissions: {
					presetIntent: "readonly",
					approvalHooks: ["before-shell", ""],
					notes: "keep it quiet",
				},
			},
			compiled: {
				name: "Riley",
				slug: "riley",
				description: "Runs the tests.",
				tools: ["shell"],
				skills: ["run-tests"],
			},
			tier: "user",
		});
		expect(parsed).toEqual({
			slug: "riley",
			agent: {
				name: "Riley",
				description: "Runs the tests.",
				skills: ["run-tests"],
				editable: true,
			},
			permissions: {
				presetIntent: "readonly",
				approvalHooks: ["before-shell"],
				notes: "keep it quiet",
				reported: true,
			},
			compiled: {
				name: "Riley",
				slug: "riley",
				description: "Runs the tests.",
				skills: ["run-tests"],
			},
			tier: "user",
		});
		expect(JSON.stringify(parsed)).not.toContain('"tools"');
		expect(JSON.stringify(parsed)).not.toContain('"edit"');
	});

	it("reports a missing permissions block instead of inventing one", () => {
		const parsed = parseAgentHomeReply({
			home: {
				slug: "sam",
				agent: { name: "Sam", description: "Keeps the log.", editable: false },
			},
			compiled: { name: "Sam", description: "Keeps the log.", skills: [] },
		});
		expect(parsed?.permissions).toEqual({
			presetIntent: "standard",
			approvalHooks: [],
			notes: "",
			reported: false,
		});
		expect(parsed?.agent.editable).toBe(false);
		expect(parsed?.compiled.slug).toBe("sam");
		expect(parsed?.tier).toBeNull();
	});

	it("rejects shapes that are not a home", () => {
		expect(parseAgentHomeReply(null)).toBeNull();
		expect(parseAgentHomeReply({ home: { slug: "x" } })).toBeNull();
		expect(
			parseAgentHomeReply({ home: { slug: "x", agent: { name: "" } } }),
		).toBeNull();
	});
});

describe("policy draft", () => {
	it("seeds from the projection and never carries tools", () => {
		const draft = draftFromProjection(loaded);
		expect(draft).toEqual({
			description: loaded.agent.description,
			skills: "run-tests\nread-failures",
			presetIntent: "standard",
			approvalHooks: "before-shell",
			notes: "",
		});
		expect(Object.keys(draft)).not.toContain("tools");
		expect(policyDraftDirty(draft, loaded)).toBe(false);
	});

	it("parses lists, dropping blanks and duplicates", () => {
		expect(parsePolicyList("a\n b ,a,\n\nc")).toEqual(["a", "b", "c"]);
		expect(parsePolicyList("")).toEqual([]);
	});

	it("requires a description", () => {
		const draft = { ...draftFromProjection(loaded), description: "  " };
		expect(validatePolicyDraft(draft)).toEqual([
			{ field: "description", message: "Description is required." },
		]);
		const built = buildPolicyPatch({ draft, loaded });
		expect(built.ok).toBe(false);
	});

	it("builds a patch that names only what changed", () => {
		const draft = {
			...draftFromProjection(loaded),
			skills: "run-tests\nread-failures\nwrite-handoff",
			presetIntent: "readonly" as const,
			notes: "  ask before shell  ",
		};
		expect(policyDraftDirty(draft, loaded)).toBe(true);
		const built = buildPolicyPatch({ draft, loaded });
		expect(built).toEqual({
			ok: true,
			changed: true,
			patch: {
				agent: { skills: ["run-tests", "read-failures", "write-handoff"] },
				permissions: { presetIntent: "readonly", notes: "ask before shell" },
			},
		});
	});

	it("reports no change for an untouched draft", () => {
		const built = buildPolicyPatch({
			draft: draftFromProjection(loaded),
			loaded,
		});
		expect(built).toEqual({ ok: true, changed: false, patch: {} });
	});

	it("clears the note and hooks when emptied", () => {
		const withNote: AgentHomeProjection = {
			...loaded,
			permissions: { ...loaded.permissions, notes: "old note" },
		};
		const built = buildPolicyPatch({
			draft: { ...draftFromProjection(withNote), notes: "", approvalHooks: "" },
			loaded: withNote,
		});
		expect(built).toEqual({
			ok: true,
			changed: true,
			patch: { permissions: { approvalHooks: [], notes: "" } },
		});
	});

	it("labels presets and save destinations", () => {
		expect(AGENT_POLICY_PRESET_OPTIONS.map((option) => option.id)).toEqual([
			"readonly",
			"standard",
			"full",
		]);
		expect(presetIntentLabel("readonly")).toBe("Read only");
		expect(policySavedMessage("user")).toContain("every workspace");
		expect(policySavedMessage("workspace")).toContain(".driveagent/");
		expect(policySavedMessage(null)).toContain(".driveagent/");
	});
});
