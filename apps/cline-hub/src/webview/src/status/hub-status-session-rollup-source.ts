import {
	type StatusSessionRow,
	statusSessionRowFromUnknown,
} from "@cline/drive";
import { requestSessionRollupsDump } from "../drive/sessionRollupsDump";
import type { StatusSessionRollupSource } from "./status-session-rollup-source";

/**
 * Live hub adapter: reads local SessionRollups via drive_session_rollups
 * (FS-backed SessionRollupSource on the daemon). Requires workspaceRoot.
 */
export class HubStatusSessionRollupSource implements StatusSessionRollupSource {
	private readonly getWorkspaceRoot: () => string | undefined;

	constructor(getWorkspaceRoot: () => string | undefined) {
		this.getWorkspaceRoot = getWorkspaceRoot;
	}

	async loadSessions(options?: {
		limit?: number;
		callSessionId?: string;
	}): Promise<StatusSessionRow[]> {
		const root = this.getWorkspaceRoot()?.trim();
		if (!root) {
			return [];
		}
		const dump = await requestSessionRollupsDump(root, {
			limit: options?.limit ?? 20,
			callSessionId: options?.callSessionId,
		});
		const rows: StatusSessionRow[] = [];
		for (const raw of dump.rollups) {
			const row = statusSessionRowFromUnknown(raw);
			if (row) {
				rows.push(row);
			}
		}
		return rows;
	}
}
