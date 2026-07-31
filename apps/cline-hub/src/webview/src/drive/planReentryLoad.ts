/**
 * Load unfinished-plan re-entry model from hub bank + last SessionRollup.
 */

import type { PlanReentryRowModel } from "@cline/drive";
import {
	buildPlanReentryRow,
	planReentryRollupFromUnknown,
} from "@cline/drive";
import { requestHubBankOp } from "./bankSession";
import { requestSessionRollupsDump } from "./sessionRollupsDump";

export async function loadPlanReentryRow(
	workspaceRoot: string,
	options?: { planTitle?: string | null },
): Promise<PlanReentryRowModel | null> {
	const root = workspaceRoot.trim();
	if (!root) {
		return null;
	}
	const snapshot = await requestHubBankOp("drive_bank_get", {
		workspaceRoot: root,
	});
	let rollup = null;
	try {
		const dump = await requestSessionRollupsDump(root, { limit: 1 });
		rollup = planReentryRollupFromUnknown(dump.rollups[0] ?? null);
	} catch {
		// Rollup chips are optional — row still useful without them.
	}
	return buildPlanReentryRow({
		snapshot,
		planTitle: options?.planTitle ?? "Current work",
		rollup,
	});
}
