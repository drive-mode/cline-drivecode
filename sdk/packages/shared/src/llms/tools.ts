/**
 * Shared tool policy and execution record types.
 */

import { z } from "zod";

export interface ToolPolicy {
	/**
	 * Whether the tool can be executed at all.
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Whether this tool can run without asking the client for approval.
	 * @default true
	 */
	autoApprove?: boolean;
}

/** Wildcard key: the default applied to every tool with no explicit entry. */
export const TOOL_POLICY_WILDCARD = "*";

/**
 * Resolve the effective policy for one tool.
 *
 * The wildcard is a *default*, not a ceiling — the per-tool entry shadows it
 * field by field and in both directions, so a per-tool entry may be more
 * permissive than `"*"`. The interactive CLI relies on exactly that: it writes
 * `{"*": {autoApprove: false}}` plus per-tool `{autoApprove: true}` for a
 * safe-tool list.
 *
 * Lives here rather than beside a consumer because the enforcement path in
 * `@cline/agents` and the delegation cap below must agree bit for bit, and
 * `@cline/agents` cannot import `@cline/core`.
 */
export function resolveToolPolicy(
	toolName: string,
	policies: Record<string, ToolPolicy> | undefined,
): ToolPolicy {
	return {
		...(policies?.[TOOL_POLICY_WILDCARD] ?? {}),
		...(policies?.[toolName] ?? {}),
	};
}

/**
 * Intersect two policy records so the result grants no more than either side.
 *
 * Used to cap a delegated child's authority by its parent's: the child may
 * narrow itself, never widen beyond what the parent holds.
 *
 * Both fields default to `true`, so an absent key is an *allow* and the
 * intersection has to be computed over resolved effective booleans rather than
 * over the raw records. Intersecting raw records per key is a privilege
 * escalation: a parent holding `{"*": {autoApprove: false}}` has no
 * `read_files` key at all, so a naive merge lets a child asking for
 * `{read_files: {autoApprove: true}}` keep it.
 *
 * Every entry in the result spells both fields out. Omitting a field would mean
 * `true`, but an omitted field also fails to shadow the wildcard it sits under:
 * a per-tool `{}` beneath `{"*": {autoApprove: false}}` resolves to denied, so a
 * tool the parent explicitly allowed would come back capped.
 */
export function intersectToolPolicies(
	parent: Record<string, ToolPolicy> | undefined,
	child: Record<string, ToolPolicy> | undefined,
): Record<string, ToolPolicy> | undefined {
	if (!parent) {
		return child;
	}

	const toolNames = new Set<string>([
		...Object.keys(parent),
		...Object.keys(child ?? {}),
	]);
	toolNames.delete(TOOL_POLICY_WILDCARD);

	const out: Record<string, ToolPolicy> = {
		// Mandatory: without it every tool named by neither side would escape
		// the parent's wildcard.
		[TOOL_POLICY_WILDCARD]: capPolicy(
			parent[TOOL_POLICY_WILDCARD],
			child?.[TOOL_POLICY_WILDCARD],
		),
	};

	for (const toolName of toolNames) {
		out[toolName] = capPolicy(
			resolveToolPolicy(toolName, parent),
			resolveToolPolicy(toolName, child),
		);
	}

	return out;
}

/**
 * AND two already-resolved policies, spelling both fields out so the entry
 * fully describes its own effective policy and does not depend on what it sits
 * under.
 */
function capPolicy(
	parent: ToolPolicy | undefined,
	child: ToolPolicy | undefined,
): ToolPolicy {
	return {
		enabled: parent?.enabled !== false && child?.enabled !== false,
		autoApprove: parent?.autoApprove !== false && child?.autoApprove !== false,
	};
}

// =============================================================================
// Tool Call Record
// =============================================================================

/**
 * Record of a tool call execution
 */
export interface ToolCallRecord {
	/** Unique identifier for this tool call */
	id: string;
	/** Name of the tool that was called */
	name: string;
	/** Input passed to the tool */
	input: unknown;
	/** Output returned from the tool (if successful) */
	output: unknown;
	/** Error message (if the tool failed) */
	error?: string;
	/** Time taken to execute the tool in milliseconds */
	durationMs: number;
	/** Timestamp when the tool call started */
	startedAt: Date;
	/** Timestamp when the tool call ended */
	endedAt: Date;
}

export interface ToolApprovalRequest {
	/**
	 * Core/hub runtime session identifier.
	 *
	 * This is the routing and lifecycle id for the task/session that owns the
	 * tool call. Hosts and hub transports use it to deliver approval events to
	 * clients subscribed to that session and to correlate approval responses
	 * with the pending runtime session. It should not be used as the transcript
	 * id for model history.
	 */
	sessionId: string;
	/**
	 * Agent instance identifier.
	 *
	 * This identifies the lead or delegated agent that requested the tool call.
	 * It is used for attribution in approval prompts, events, telemetry, and
	 * team/sub-agent flows. It is not a hub routing key and should not be used
	 * to find the owning runtime session.
	 */
	agentId: string;
	/**
	 * Agent conversation/transcript identifier.
	 *
	 * This identifies the model conversation that produced the tool call. Tools,
	 * hooks, telemetry, and persisted session metadata use it to correlate work
	 * with the agent's message history. It is contextual data, not the hub event
	 * routing key.
	 */
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy: ToolPolicy;
}

export interface ToolApprovalResult {
	approved: boolean;
	reason?: string;
}

export const ToolCallRecordSchema = z.object({
	id: z.string(),
	name: z.string(),
	input: z.unknown(),
	output: z.unknown(),
	error: z.string().optional(),
	durationMs: z.number(),
	startedAt: z.date(),
	endedAt: z.date(),
});
