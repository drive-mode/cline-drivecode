import { describe, expect, it } from "vitest";
import {
	FIXTURE_ROSTER_PACKS,
	lookupFixtureRosterPack,
	planRosterPackAdd,
} from "./rosterPackAdd";

describe("rosterPackAdd decision table", () => {
	it("allows a single-member pack under seatCap 1", () => {
		const pack = lookupFixtureRosterPack("pair");
		expect(pack).not.toBeNull();
		const plan = planRosterPackAdd({ pack: pack!, seatCap: 1 });
		expect(plan.ok).toBe(true);
		if (plan.ok) {
			expect(plan.proposals).toHaveLength(1);
			expect(plan.proposals[0]?.profileId).toBe("security-reviewer");
		}
	});

	it("fail-closes a multi-member pack when seatCap is 1", () => {
		const pack = lookupFixtureRosterPack("security-crew");
		expect(pack).not.toBeNull();
		const plan = planRosterPackAdd({ pack: pack!, seatCap: 1 });
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.reason).toBe("seat_cap");
			expect(plan.memberCount).toBe(2);
			expect(plan.seatCap).toBe(1);
		}
	});

	it("allows multi-member pack when seatCap covers members", () => {
		const pack = lookupFixtureRosterPack("security-crew");
		expect(pack).not.toBeNull();
		const plan = planRosterPackAdd({ pack: pack!, seatCap: 2 });
		expect(plan.ok).toBe(true);
		if (plan.ok) {
			expect(plan.proposals).toHaveLength(2);
		}
	});

	it("exposes fixture packs for the library UI", () => {
		expect(FIXTURE_ROSTER_PACKS.length).toBeGreaterThanOrEqual(2);
		expect(lookupFixtureRosterPack("cybersecurity")).toBeNull();
		expect(lookupFixtureRosterPack("security-crew")?.displayName).toBe(
			"Cybersecurity",
		);
	});
});
