import { describe, expect, it } from "vitest";
import { shouldSeedBankOnSeat } from "./bankHydrationGate";

describe("shouldSeedBankOnSeat", () => {
	it("never seeds when the snapshot does not seat the human", () => {
		expect(
			shouldSeedBankOnSeat({
				wasPendingJoin: true,
				bankHydrated: false,
				seatedOnCall: false,
			}),
		).toBe(false);
		expect(
			shouldSeedBankOnSeat({
				wasPendingJoin: false,
				bankHydrated: false,
				seatedOnCall: false,
			}),
		).toBe(false);
	});

	it("seeds on a fresh explicit join (wasPendingJoin) even if already hydrated", () => {
		expect(
			shouldSeedBankOnSeat({
				wasPendingJoin: true,
				bankHydrated: true,
				seatedOnCall: true,
			}),
		).toBe(true);
	});

	it("seeds the first seated snapshot this mount has seen, regardless of wasPendingJoin", () => {
		// Regression: a hub process restart leaves persisted driveUi.active
		// stuck "on" in browser storage, so reconnect resolves through
		// refreshDriveRoom (call_get_room) rather than joinDrive (call_join),
		// and wasPendingJoin never gets set. bankHydrated is never persisted,
		// so it starts false on the fresh mount and must still trigger a seed.
		expect(
			shouldSeedBankOnSeat({
				wasPendingJoin: false,
				bankHydrated: false,
				seatedOnCall: true,
			}),
		).toBe(true);
	});

	it("does not re-seed on later broadcasts once this mount already hydrated", () => {
		expect(
			shouldSeedBankOnSeat({
				wasPendingJoin: false,
				bankHydrated: true,
				seatedOnCall: true,
			}),
		).toBe(false);
	});
});
