/**
 * Draft model behind `AgentPolicyEditor` (DRV-PARTICIPANT-SHEET, ADR-0023).
 *
 * The editor only ever sees the sanitized projection — no prompt, no provider,
 * no model — so the patch it builds must name *only* what the user actually
 * changed. Sending an unchanged field back is harmless; sending a field the
 * projection never carried is not, which is why the patch is assembled from a
 * diff against the loaded projection rather than from the whole draft.
 *
 * Kept in a `.ts` module rather than the component because the hub's vitest
 * project is node-env and only collects `src/**\/*.test.ts` — logic that lives
 * inside the `.tsx` is logic nothing can test.
 */

import {
	assertDriveagentHomePatch,
	type DriveagentHomePatch,
} from "@cline/drive";
import type { DriveagentHomeProjection } from "./requestDriveagentHome";

export type AgentPolicyPresetIntent = "readonly" | "standard" | "full";

export type AgentPolicyDraft = {
	description: string;
	/** Newline- or comma-separated; parsed by {@link parsePolicyList}. */
	tools: string;
	skills: string;
	presetIntent: AgentPolicyPresetIntent;
	approvalHooks: string;
	notes: string;
};

/** Seed a draft from the projection the read path returned. */
export function draftFromProjection(
	home: DriveagentHomeProjection,
): AgentPolicyDraft {
	return {
		description: home.agent.description,
		tools: (home.agent.tools ?? []).join("\n"),
		skills: (home.agent.skills ?? []).join("\n"),
		presetIntent: home.permissions.presetIntent,
		approvalHooks: home.permissions.approvalHooks.join("\n"),
		notes: home.permissions.notes ?? "",
	};
}

/** Split a textarea into entries, dropping blanks and duplicates. */
export function parsePolicyList(raw: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const entry of raw.split(/[\n,]/)) {
		const trimmed = entry.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

function listsEqual(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

export type AgentPolicyDraftIssue = {
	field: keyof AgentPolicyDraft;
	message: string;
};

/** Client-side checks that mirror the schema, so a bad draft never leaves. */
export function validatePolicyDraft(
	draft: AgentPolicyDraft,
): AgentPolicyDraftIssue[] {
	const issues: AgentPolicyDraftIssue[] = [];
	if (!draft.description.trim()) {
		issues.push({
			field: "description",
			message: "Description is required.",
		});
	}
	return issues;
}

export type BuildPolicyPatchResult =
	| { ok: true; patch: DriveagentHomePatch; changed: boolean }
	| { ok: false; issues: AgentPolicyDraftIssue[] };

/**
 * Diff the draft against the loaded projection and build the patch to send.
 *
 * Unchanged fields are omitted, which is what keeps the write a patch: the hub
 * merges it onto the file on disk, and anything absent keeps its stored value.
 * The result is run through the shared validator so a patch this function got
 * wrong fails here rather than at the hub.
 */
export function buildPolicyPatch(input: {
	draft: AgentPolicyDraft;
	loaded: DriveagentHomeProjection;
}): BuildPolicyPatchResult {
	const issues = validatePolicyDraft(input.draft);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const { draft, loaded } = input;
	const agent: {
		description?: string;
		tools?: string[];
		skills?: string[];
	} = {};
	const description = draft.description.trim();
	if (description !== loaded.agent.description) {
		agent.description = description;
	}
	const tools = parsePolicyList(draft.tools);
	if (!listsEqual(tools, loaded.agent.tools ?? [])) {
		agent.tools = tools;
	}
	const skills = parsePolicyList(draft.skills);
	if (!listsEqual(skills, loaded.agent.skills ?? [])) {
		agent.skills = skills;
	}

	const permissions: {
		presetIntent?: AgentPolicyPresetIntent;
		approvalHooks?: string[];
		notes?: string;
	} = {};
	if (draft.presetIntent !== loaded.permissions.presetIntent) {
		permissions.presetIntent = draft.presetIntent;
	}
	const approvalHooks = parsePolicyList(draft.approvalHooks);
	if (!listsEqual(approvalHooks, loaded.permissions.approvalHooks)) {
		permissions.approvalHooks = approvalHooks;
	}
	const notes = draft.notes.trim();
	if (notes !== (loaded.permissions.notes ?? "")) {
		permissions.notes = notes;
	}

	const patch: DriveagentHomePatch = {
		...(Object.keys(agent).length > 0 ? { agent } : {}),
		...(Object.keys(permissions).length > 0 ? { permissions } : {}),
	};

	try {
		return {
			ok: true,
			patch: assertDriveagentHomePatch(patch),
			changed: Object.keys(patch).length > 0,
		};
	} catch (error) {
		return {
			ok: false,
			issues: [
				{
					field: "description",
					message: error instanceof Error ? error.message : String(error),
				},
			],
		};
	}
}
