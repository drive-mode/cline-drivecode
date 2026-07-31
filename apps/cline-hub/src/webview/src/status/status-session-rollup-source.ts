import type { StatusSessionRow } from "@cline/drive";

/**
 * Port for loading Drive session accomplishment rollups (Status Hub sessions
 * mode). Live hub or demo adapter — views must not read CLINE_DEMO_* / query.
 */
export interface StatusSessionRollupSource {
	loadSessions(options?: {
		limit?: number;
		callSessionId?: string;
	}): Promise<StatusSessionRow[]>;
}
