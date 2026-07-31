import type { BankSnapshot } from "@cline/shared";
import type { CleanDrainInvite } from "@cline/drive";

/** Collapse when no active plan / no open tasks — unless clean-drain successor. */
export function shouldShowNowNext(
	snapshot: BankSnapshot,
	cleanDrainInvite?: CleanDrainInvite | null,
): boolean {
	if (cleanDrainInvite) {
		return true;
	}
	return Boolean(snapshot.activePlanId && snapshot.nowTaskId);
}

/** Successor framing so archive collapse ≠ failure (DRV-CLEAN-DRAIN). */
export function isCleanDrainSuccessor(
	cleanDrainInvite?: CleanDrainInvite | null,
): boolean {
	return Boolean(cleanDrainInvite);
}
