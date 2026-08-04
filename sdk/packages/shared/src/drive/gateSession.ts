/**
 * DRV-GATES session-allow + deny tracking (pure).
 *
 * Session allows never survive process restart. policy.hard cannot be
 * session-allowed. After 3 denials of the same class, callers should
 * require a strategy change (sticky strip hint after 5 warnings).
 */

import { defaultDispositionForGateClass, type GateActionClass } from "./gates";

export const GATE_DENIAL_STRATEGY_THRESHOLD = 3 as const;
export const GATE_WARNING_STRIP_THRESHOLD = 5 as const;

export type GateSessionState = {
	/**
	 * Tools allowed for the rest of this room session, keyed by **exact tool
	 * name**.
	 *
	 * Deliberately not keyed by `GateActionClass`. `classifyToolNameForGate` is
	 * a best-effort name matcher whose fallback is `shell.unchecked`, so most of
	 * the default tool set — `read_files`, `search_codebase`, `editor`,
	 * `apply_patch` — shares a bucket with `run_commands`. Allowing a *class*
	 * therefore grants arbitrary shell from an approval the user gave a
	 * read-only tool. The class still decides whether an allow may be offered
	 * at all; it must never decide which tools an allow covers.
	 */
	sessionAllowedTools: ReadonlySet<string>;
	/**
	 * Exact tool names denied in this room session. A denied tool must never
	 * silently retry, so this lives in the state rather than being supplied per
	 * call — the caller that had to remember to pass it did not have the memory
	 * to pass, and so never did.
	 */
	deniedTools: ReadonlySet<string>;
	/** Denial counts per class in this room session. */
	denialCounts: ReadonlyMap<GateActionClass, number>;
	/** Soft warnings (block / deny / sticky) counted for strip hint. */
	warningCount: number;
};

export const EMPTY_GATE_SESSION: GateSessionState = {
	sessionAllowedTools: new Set(),
	deniedTools: new Set(),
	denialCounts: new Map(),
	warningCount: 0,
};

export function createGateSessionState(): GateSessionState {
	return {
		sessionAllowedTools: new Set(),
		deniedTools: new Set(),
		denialCounts: new Map(),
		warningCount: 0,
	};
}

/** Clear all session allows and counters (leave / end / process restart). */
export function clearGateSession(_state?: GateSessionState): GateSessionState {
	return createGateSessionState();
}

export function isGateSessionAllowed(
	state: GateSessionState,
	actionClass: GateActionClass,
	toolName: string,
): boolean {
	if (defaultDispositionForGateClass(actionClass) === "block") {
		return false;
	}
	return state.sessionAllowedTools.has(toolName);
}

/**
 * Whether the feed card may offer "Allow for session".
 * policy.hard is never session-allowable.
 */
export function canOfferGateSessionAllow(
	actionClass: GateActionClass,
): boolean {
	return defaultDispositionForGateClass(actionClass) === "approve";
}

/**
 * Grant "allow for session" to one tool. The class gates whether an allow may
 * be offered at all; the tool name is what the allow actually covers.
 *
 * A tool denied earlier this session cannot be session-allowed without an
 * explicit approve first — otherwise deny is undone by the next card.
 */
export function allowGateToolForSession(
	state: GateSessionState,
	actionClass: GateActionClass,
	toolName: string,
): GateSessionState {
	if (!canOfferGateSessionAllow(actionClass)) {
		return state;
	}
	const sessionAllowedTools = new Set(state.sessionAllowedTools);
	sessionAllowedTools.add(toolName);
	// An explicit allow clears the prior deny for that same tool.
	const deniedTools = new Set(state.deniedTools);
	deniedTools.delete(toolName);
	return { ...state, sessionAllowedTools, deniedTools };
}

/**
 * Record a denial. Revokes any session allow the tool held, so denying is not
 * silently overridden by an earlier grant.
 */
export function recordGateDenial(
	state: GateSessionState,
	actionClass: GateActionClass,
	toolName: string,
): GateSessionState {
	const denialCounts = new Map(state.denialCounts);
	denialCounts.set(actionClass, (denialCounts.get(actionClass) ?? 0) + 1);
	const deniedTools = new Set(state.deniedTools);
	deniedTools.add(toolName);
	const sessionAllowedTools = new Set(state.sessionAllowedTools);
	sessionAllowedTools.delete(toolName);
	return {
		...state,
		denialCounts,
		deniedTools,
		sessionAllowedTools,
		warningCount: state.warningCount + 1,
	};
}

export function recordGateWarning(state: GateSessionState): GateSessionState {
	return { ...state, warningCount: state.warningCount + 1 };
}

export function gateDenialCount(
	state: GateSessionState,
	actionClass: GateActionClass,
): number {
	return state.denialCounts.get(actionClass) ?? 0;
}

export function requiresGateStrategyChange(
	state: GateSessionState,
	actionClass: GateActionClass,
): boolean {
	return gateDenialCount(state, actionClass) >= GATE_DENIAL_STRATEGY_THRESHOLD;
}

export function shouldShowGatesActiveStrip(state: GateSessionState): boolean {
	return state.warningCount >= GATE_WARNING_STRIP_THRESHOLD;
}

/**
 * Resolve whether a gated tool may proceed without a new feed card.
 * Returns a reason when blocked.
 */
export function resolveGateBypass(input: {
	state: GateSessionState;
	actionClass: GateActionClass;
	/** Exact tool name. Both the allow and the deny check key on this. */
	toolName: string;
}): { proceed: boolean; reason?: string } {
	const { state, actionClass, toolName } = input;
	if (defaultDispositionForGateClass(actionClass) === "block") {
		return {
			proceed: false,
			reason: "policy.hard blocks cannot be approved from the feed card.",
		};
	}
	// Read from state rather than from a caller-supplied flag. The previous
	// signature took `previouslyDeniedSameTool` and no caller ever passed it,
	// which made deny a no-op for any session-allowed class.
	if (state.deniedTools.has(toolName)) {
		return {
			proceed: false,
			reason: "Denied tools must not retry silently; replan or ask again.",
		};
	}
	if (isGateSessionAllowed(state, actionClass, toolName)) {
		return { proceed: true };
	}
	return {
		proceed: false,
		reason: "Awaiting approve / deny / allow-for-session.",
	};
}
