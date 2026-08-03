/**
 * `/agents?id=<profileId>` — the agent profile detail route.
 *
 * Query-param detail, mirroring `/drive?id=`. Not a path param: `viewFromPath`
 * is a static if-chain over every view and `isWebviewRoute` is an exact-match
 * list, so `/agents/<id>` would change the router contract for all eighteen
 * views and 403 on a deep link until both lists learned a prefix rule. A query
 * param needs neither — `/agents` already serves and already routes.
 */

import { parseAgentProfileId } from "@cline/shared";

export const AGENTS_PATH = "/agents";
export const AGENT_PROFILE_QUERY = "id";

/**
 * The profile id in a location search, or null.
 *
 * Validated through `parseAgentProfileId` rather than passed through: the id is
 * the flattened `AgentRef`, and one that does not parse names no agent. Landing
 * on the index is the right answer for a stale or hand-typed link, not an
 * empty detail page for an agent that cannot exist.
 */
export function parseAgentProfileParam(search: string): string | null {
	const raw = new URLSearchParams(search).get(AGENT_PROFILE_QUERY)?.trim();
	if (!raw) {
		return null;
	}
	return parseAgentProfileId(raw) ? raw : null;
}

export function agentProfilePath(profileId: string): string {
	const id = profileId.trim();
	if (!id) {
		return AGENTS_PATH;
	}
	return `${AGENTS_PATH}?${AGENT_PROFILE_QUERY}=${encodeURIComponent(id)}`;
}
