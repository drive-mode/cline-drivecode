/**
 * DRV-GATES session-allow + deny tracking (pure).
 *
 * Session allows never survive process restart. policy.hard cannot be
 * session-allowed. After 3 denials of the same class, callers should
 * require a strategy change (sticky strip hint after 5 warnings).
 */

import {
	defaultDispositionForGateClass,
	type GateActionClass,
} from "./gates";

export const GATE_DENIAL_STRATEGY_THRESHOLD = 3 as const;
export const GATE_WARNING_STRIP_THRESHOLD = 5 as const;

export type GateSessionState = {
	/** Classes allowed for the rest of this room session. */
	sessionAllowed: ReadonlySet<GateActionClass>;
	/** Denial counts per class in this room session. */
	denialCounts: ReadonlyMap<GateActionClass, number>;
	/** Soft warnings (block / deny / sticky) counted for strip hint. */
	warningCount: number;
};

export const EMPTY_GATE_SESSION: GateSessionState = {
	sessionAllowed: new Set(),
	denialCounts: new Map(),
	warningCount: 0,
};

export function createGateSessionState(): GateSessionState {
	return {
		sessionAllowed: new Set(),
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
): boolean {
	if (defaultDispositionForGateClass(actionClass) === "block") {
		return false;
	}
	return state.sessionAllowed.has(actionClass);
}

/**
 * Whether the feed card may offer "Allow for session".
 * policy.hard is never session-allowable.
 */
export function canOfferGateSessionAllow(actionClass: GateActionClass): boolean {
	return defaultDispositionForGateClass(actionClass) === "approve";
}

export function allowGateClassForSession(
	state: GateSessionState,
	actionClass: GateActionClass,
): GateSessionState {
	if (!canOfferGateSessionAllow(actionClass)) {
		return state;
	}
	const sessionAllowed = new Set(state.sessionAllowed);
	sessionAllowed.add(actionClass);
	return { ...state, sessionAllowed };
}

export function recordGateDenial(
	state: GateSessionState,
	actionClass: GateActionClass,
): GateSessionState {
	const denialCounts = new Map(state.denialCounts);
	denialCounts.set(actionClass, (denialCounts.get(actionClass) ?? 0) + 1);
	return {
		...state,
		denialCounts,
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
	/** When true, prior deny for this exact tool must not silent-retry. */
	previouslyDeniedSameTool?: boolean;
}): { proceed: boolean; reason?: string } {
	const { state, actionClass, previouslyDeniedSameTool } = input;
	if (defaultDispositionForGateClass(actionClass) === "block") {
		return {
			proceed: false,
			reason: "policy.hard blocks cannot be approved from the feed card.",
		};
	}
	if (previouslyDeniedSameTool) {
		return {
			proceed: false,
			reason: "Denied tools must not retry silently; replan or ask again.",
		};
	}
	if (isGateSessionAllowed(state, actionClass)) {
		return { proceed: true };
	}
	return { proceed: false, reason: "Awaiting approve / deny / allow-for-session." };
}
