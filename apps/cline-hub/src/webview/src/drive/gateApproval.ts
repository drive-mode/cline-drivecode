/**
 * Incoming-approval gate bypass (DRV-GATES). Pure — behavior contracts live
 * in shared gateSession; this only adapts them to a webview approval_request
 * event. Kept out of GateFeedCard.tsx (a component with UI-only imports) so
 * it stays testable under the plain node vitest config.
 */

import {
	classifyToolNameForGate,
	type GateActionClass,
	type GateSessionState,
	resolveGateBypass,
} from "@cline/shared";

/**
 * Whether an *incoming* approval request may be auto-approved instead of
 * queuing a new gate card. Session-allow is only ever granted from the gate
 * feed, so it only ever applies while Drive is active — matching
 * clearGateSession() firing on Drive leave/end.
 *
 * Scope is the **exact tool name**, never the gate class. The class is only
 * consulted to reject `policy.hard`. `classifyToolNameForGate` falls back to
 * `shell.unchecked` for any unmatched name, so class-scoping would let an
 * approval given to `search_codebase` auto-approve `run_commands`.
 */
export function resolveIncomingApprovalBypass(input: {
	driveActive: boolean;
	gateSession: GateSessionState;
	toolName: string;
}): { bypass: boolean; actionClass: GateActionClass } {
	const actionClass = classifyToolNameForGate(input.toolName);
	if (!input.driveActive) {
		return { bypass: false, actionClass };
	}
	return {
		actionClass,
		bypass: resolveGateBypass({
			actionClass,
			state: input.gateSession,
			toolName: input.toolName,
		}).proceed,
	};
}
