/**
 * Draft model behind the agent policy editor (DRV-DRIVEAGENT-HOME, ADR-0023).
 *
 * The editor only ever sees the sanitized home projection — no prompt, no
 * tool allowlist, no provider, no model — so the patch it builds names
 * *only* what the person actually changed, from a diff against the loaded
 * projection. Sending an unchanged field back is harmless; sending a field
 * the projection never carried is not. `tools` is deliberately absent from
 * the draft: Drive UI shows a typed capability and approval posture, never a
 * tool list, and an absent field in the patch means "unchanged on disk".
 */

import {
	assertDriveagentHomePatch,
	type DriveagentHomePatch,
} from "@cline/drive";

export type AgentPolicyPresetIntent = "readonly" | "standard" | "full";

export const AGENT_POLICY_PRESET_INTENTS: readonly AgentPolicyPresetIntent[] = [
	"readonly",
	"standard",
	"full",
];

/** Copy for the three ceilings. A ceiling, not a grant. */
export const AGENT_POLICY_PRESET_OPTIONS: readonly {
	id: AgentPolicyPresetIntent;
	label: string;
	description: string;
}[] = [
	{
		id: "readonly",
		label: "Read only",
		description: "Reads the workspace and reports back. Never edits or runs.",
	},
	{
		id: "standard",
		label: "Standard",
		description:
			"Edits files and runs commands; risky actions wait for approval.",
	},
	{
		id: "full",
		label: "Full",
		description:
			"Everything the seat allows. Still capped by the parent at the approval point.",
	},
];

export function presetIntentLabel(intent: AgentPolicyPresetIntent): string {
	return (
		AGENT_POLICY_PRESET_OPTIONS.find((option) => option.id === intent)?.label ??
		intent
	);
}

/** The sanitized home the sidecar returns for `drive_agent_home get|put`. */
export type AgentHomeProjection = {
	slug: string;
	agent: {
		name: string;
		description: string;
		skills: string[];
		editable: boolean;
	};
	permissions: {
		presetIntent: AgentPolicyPresetIntent;
		approvalHooks: string[];
		notes: string;
		/** False when the reply carried no permissions block (older hosts, demo). */
		reported: boolean;
	};
	compiled: {
		name: string;
		slug: string;
		description: string;
		skills: string[];
	};
	tier: "workspace" | "user" | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.trim().length > 0,
			)
		: [];
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function isPresetIntent(value: unknown): value is AgentPolicyPresetIntent {
	return value === "readonly" || value === "standard" || value === "full";
}

/**
 * Parse a `{ home, compiled, tier? }` reply. Returns null when the shape is
 * not a home at all; tolerates a missing permissions block by reporting it
 * as unreported rather than inventing a ceiling.
 *
 * `tools` is read by neither branch: even if a host sends it, the desktop
 * never renders or drafts a tool list.
 */
export function parseAgentHomeReply(
	value: unknown,
): AgentHomeProjection | null {
	if (!isRecord(value) || !isRecord(value.home)) {
		return null;
	}
	const home = value.home;
	const agent = isRecord(home.agent) ? home.agent : null;
	const slug = readString(home.slug).trim();
	if (!slug || !agent) {
		return null;
	}
	const name = readString(agent.name).trim();
	if (!name) {
		return null;
	}
	const permissions = isRecord(home.permissions) ? home.permissions : null;
	const compiled = isRecord(value.compiled) ? value.compiled : null;
	const description = readString(agent.description).trim();
	return {
		slug,
		agent: {
			name,
			description,
			skills: readStringArray(agent.skills),
			editable: agent.editable !== false,
		},
		permissions: {
			presetIntent: isPresetIntent(permissions?.presetIntent)
				? permissions.presetIntent
				: "standard",
			approvalHooks: readStringArray(permissions?.approvalHooks),
			notes: readString(permissions?.notes),
			reported:
				permissions !== null && isPresetIntent(permissions.presetIntent),
		},
		compiled: {
			name: readString(compiled?.name).trim() || name,
			slug: readString(compiled?.slug).trim() || slug,
			description: readString(compiled?.description).trim() || description,
			skills: readStringArray(compiled?.skills),
		},
		tier:
			value.tier === "user"
				? "user"
				: value.tier === "workspace"
					? "workspace"
					: null,
	};
}

export type AgentPolicyDraft = {
	description: string;
	/** Newline- or comma-separated; parsed by {@link parsePolicyList}. */
	skills: string;
	presetIntent: AgentPolicyPresetIntent;
	approvalHooks: string;
	notes: string;
};

/** Seed a draft from the projection the read path returned. */
export function draftFromProjection(
	home: AgentHomeProjection,
): AgentPolicyDraft {
	return {
		description: home.agent.description,
		skills: home.agent.skills.join("\n"),
		presetIntent: home.permissions.presetIntent,
		approvalHooks: home.permissions.approvalHooks.join("\n"),
		notes: home.permissions.notes,
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
		issues.push({ field: "description", message: "Description is required." });
	}
	return issues;
}

/** True when any field differs from what the projection holds. */
export function policyDraftDirty(
	draft: AgentPolicyDraft,
	loaded: AgentHomeProjection,
): boolean {
	return (
		draft.description.trim() !== loaded.agent.description ||
		!listsEqual(parsePolicyList(draft.skills), loaded.agent.skills) ||
		draft.presetIntent !== loaded.permissions.presetIntent ||
		!listsEqual(
			parsePolicyList(draft.approvalHooks),
			loaded.permissions.approvalHooks,
		) ||
		draft.notes.trim() !== loaded.permissions.notes.trim()
	);
}

export type BuildPolicyPatchResult =
	| { ok: true; patch: DriveagentHomePatch; changed: boolean }
	| { ok: false; issues: AgentPolicyDraftIssue[] };

/**
 * Diff the draft against the loaded projection and build the patch to send.
 *
 * Unchanged fields are omitted, which is what keeps the write a patch: the
 * hub merges it onto the file on disk, and anything absent keeps its stored
 * value. The result runs through the shared validator so a patch this
 * function got wrong fails here rather than at the hub.
 */
export function buildPolicyPatch(input: {
	draft: AgentPolicyDraft;
	loaded: AgentHomeProjection;
}): BuildPolicyPatchResult {
	const issues = validatePolicyDraft(input.draft);
	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const { draft, loaded } = input;
	const agent: { description?: string; skills?: string[] } = {};
	const description = draft.description.trim();
	if (description !== loaded.agent.description) {
		agent.description = description;
	}
	const skills = parsePolicyList(draft.skills);
	if (!listsEqual(skills, loaded.agent.skills)) {
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
	if (notes !== loaded.permissions.notes.trim()) {
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

/** What a successful save should say, naming the tier honestly. */
export function policySavedMessage(tier: "workspace" | "user" | null): string {
	return tier === "user"
		? "Saved to your user home — this applies to every workspace."
		: "Saved to .driveagent/ in this workspace.";
}
