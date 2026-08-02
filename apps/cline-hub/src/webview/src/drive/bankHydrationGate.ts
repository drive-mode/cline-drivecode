/**
 * Decides whether an incoming seated room snapshot should trigger a durable
 * task-bank re-seed (DRV-BANK-REHYDRATE).
 *
 * `wasPendingJoin` alone is not a reliable signal: browser-persisted
 * `driveUi.active` survives a hub process restart (it lives in
 * `localStorage`, untouched by the server dying), so `connectionPhase` can
 * initialize as `"on"` from a prior process. That routes reconnect through
 * `call_get_room` (refresh) instead of `call_join`, and only the latter ever
 * sets `wasPendingJoin`. Gating solely on `wasPendingJoin` leaves the bank
 * stuck at whatever the webview had in memory before the restart — the room
 * (participants, mode, stage) rehydrates from the hub's durable event log,
 * but the task bank never gets asked for.
 *
 * `bankHydrated` tracks whether *this* webview mount has already asked the
 * hub for the bank for *this* room (callers should scope it by room id, since
 * `refreshDriveRoom` can target a different room without setting
 * `wasPendingJoin` either) — it is never persisted, so it always starts false
 * on a fresh page load regardless of what `driveUi.active` says. That
 * guarantees at least one real `drive_bank_seed` round trip to the durable
 * store before a seated snapshot is treated as fully hydrated. It does not
 * cache bank content — only whether the hub has been asked yet.
 */
export function shouldSeedBankOnSeat(input: {
	wasPendingJoin: boolean;
	bankHydrated: boolean;
	seatedOnCall: boolean;
}): boolean {
	if (!input.seatedOnCall) {
		return false;
	}
	return input.wasPendingJoin || !input.bankHydrated;
}
