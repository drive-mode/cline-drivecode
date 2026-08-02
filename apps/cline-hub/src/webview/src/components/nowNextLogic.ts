import type { CleanDrainInvite } from "@cline/drive";
import type { BankSnapshot } from "@cline/shared";

/**
 * Collapse when no active plan / no open tasks — unless the card carries
 * something that is not now/next.
 *
 * The clean-drain invite and the agency banner both render only inside this
 * card, so collapsing on plan state alone silently drops them. The agency
 * banner in particular is a one-shot consequence line (DRV-FELT-AGENCY): a
 * plan archiving to empty is exactly when it fires, and exactly when the
 * plan check would have hidden it.
 */
export function shouldShowNowNext(
	snapshot: BankSnapshot,
	cleanDrainInvite?: CleanDrainInvite | null,
	agencyBanner?: string | null,
): boolean {
	if (cleanDrainInvite || agencyBanner?.trim()) {
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
