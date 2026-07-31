/**
 * Demo SessionRollup source for Status Hub sessions mode.
 * Wired only at composition roots (`?demoSessions=1`).
 */

import {
	STATUS_SESSION_FIXTURES,
	buildStatusSessionRow,
	type StatusSessionRow,
} from "@cline/drive";

export class DriveSessionsDemoRollupSource {
	async loadSessions(options?: {
		limit?: number;
		callSessionId?: string;
	}): Promise<StatusSessionRow[]> {
		const all = (
			Object.values(STATUS_SESSION_FIXTURES) as Array<
				(typeof STATUS_SESSION_FIXTURES)[keyof typeof STATUS_SESSION_FIXTURES]
			>
		).map((fixture) => buildStatusSessionRow(fixture));

		if (options?.callSessionId?.trim()) {
			const id = options.callSessionId.trim();
			return all.filter((row) => row.callSessionId === id);
		}
		const limit =
			typeof options?.limit === "number" && options.limit > 0
				? Math.floor(options.limit)
				: all.length;
		return all.slice(0, limit);
	}
}
