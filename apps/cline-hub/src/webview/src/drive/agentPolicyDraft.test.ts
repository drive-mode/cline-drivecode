import { describe, expect, it } from "vitest";
import {
	buildPolicyPatch,
	draftFromProjection,
	parsePolicyList,
	validatePolicyDraft,
} from "./agentPolicyDraft";
import type { DriveagentHomeProjection } from "./requestDriveagentHome";

function projection(
	overrides?: Partial<DriveagentHomeProjection>,
): DriveagentHomeProjection {
	return {
		slug: "pair-partner",
		agent: {
			name: "pair-partner",
			description: "Default Drive pair partner.",
			tools: ["read_file", "write_file"],
			skills: ["drive-persona"],
		},
		permissions: {
			presetIntent: "standard",
			approvalHooks: ["highImpact"],
			notes: "Intent only.",
		},
		compiled: {
			name: "pair-partner",
			slug: "pair-partner",
			description: "Default Drive pair partner.",
			tools: ["read_file", "write_file"],
			skills: ["drive-persona"],
		},
		...overrides,
	};
}

describe("parsePolicyList", () => {
	it("splits on newlines and commas, dropping blanks and duplicates", () => {
		expect(parsePolicyList(" read_file\n write_file, read_file\n\n")).toEqual([
			"read_file",
			"write_file",
		]);
	});

	it("returns an empty list for whitespace", () => {
		expect(parsePolicyList("  \n \n")).toEqual([]);
	});
});

describe("buildPolicyPatch", () => {
	it("sends nothing when the draft still matches what was loaded", () => {
		const loaded = projection();
		const result = buildPolicyPatch({
			draft: draftFromProjection(loaded),
			loaded,
		});
		expect(result).toEqual({ ok: true, patch: {}, changed: false });
	});

	it("names only the fields the user actually changed", () => {
		const loaded = projection();
		const draft = draftFromProjection(loaded);
		draft.description = "Reviewed pair partner.";
		draft.presetIntent = "readonly";

		const result = buildPolicyPatch({ draft, loaded });
		if (!result.ok) {
			throw new Error("expected the patch to build");
		}
		expect(result.patch).toEqual({
			agent: { description: "Reviewed pair partner." },
			permissions: { presetIntent: "readonly" },
		});
		expect(result.changed).toBe(true);
	});

	/**
	 * The patch this component sends is the destroyer payload's ancestor: it is
	 * built from a projection with no prompt in it. Naming a prompt field would
	 * be refused by the hub, but naming nothing is what makes the save a patch
	 * rather than a replacement — so the absence is asserted here, at the point
	 * where a future edit could reintroduce it.
	 */
	it("never names a field the read path stripped", () => {
		const loaded = projection();
		const draft = draftFromProjection(loaded);
		draft.description = "Changed.";
		draft.tools = "read_file";
		draft.notes = "";

		const result = buildPolicyPatch({ draft, loaded });
		if (!result.ok) {
			throw new Error("expected the patch to build");
		}
		const agentKeys = Object.keys(result.patch.agent ?? {});
		for (const stripped of [
			"systemPrompt",
			"promptPath",
			"providerId",
			"modelId",
			"maxIterations",
			"name",
			"editable",
		]) {
			expect(agentKeys).not.toContain(stripped);
		}
	});

	it("expresses a cleared list as an empty array, not an omission", () => {
		const loaded = projection();
		const draft = draftFromProjection(loaded);
		draft.tools = "   ";

		const result = buildPolicyPatch({ draft, loaded });
		if (!result.ok) {
			throw new Error("expected the patch to build");
		}
		expect(result.patch.agent?.tools).toEqual([]);
	});

	it("sends an empty note to clear one that was set", () => {
		const loaded = projection();
		const draft = draftFromProjection(loaded);
		draft.notes = "  ";

		const result = buildPolicyPatch({ draft, loaded });
		if (!result.ok) {
			throw new Error("expected the patch to build");
		}
		expect(result.patch.permissions?.notes).toBe("");
	});

	it("refuses an empty description rather than sending one", () => {
		const loaded = projection();
		const draft = draftFromProjection(loaded);
		draft.description = "   ";

		const result = buildPolicyPatch({ draft, loaded });
		expect(result.ok).toBe(false);
		expect(validatePolicyDraft(draft)).toEqual([
			{ field: "description", message: "Description is required." },
		]);
	});

	it("treats a home with no tools as an empty list, not a change", () => {
		const loaded = projection({
			agent: {
				name: "pair-partner",
				description: "Default Drive pair partner.",
			},
		});
		const result = buildPolicyPatch({
			draft: draftFromProjection(loaded),
			loaded,
		});
		expect(result).toEqual({ ok: true, patch: {}, changed: false });
	});
});
