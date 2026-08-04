/**
 * PiP companion visibility (DRV-PIP E5, PRD PIP-06/07).
 *
 * The open card shows only when the call is live, the user is off the Drive
 * call route (strip owns ops there), and they have not opted out (minimise).
 * Mounting the companion shell (including the restore pill) uses the same
 * helper with `optedOut: false`.
 */

export function shouldShowPip({
	active,
	onCallRoute,
	optedOut = false,
}: {
	active: boolean;
	onCallRoute: boolean;
	/** PIP-07: hide companion chrome without leaving the call. */
	optedOut?: boolean;
}): boolean {
	return active && !onCallRoute && !optedOut;
}
