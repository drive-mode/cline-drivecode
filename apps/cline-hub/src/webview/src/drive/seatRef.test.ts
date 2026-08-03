/**
 * Seat identity (DRV-AGENT-PROFILE / #173).
 *
 * The inert risk is "a `ref` field that nothing populates". `call_seat` gained
 * the field hub-side but no browser frame could carry it, so every seat landed
 * ref-less. The guard is not that the field exists — it is that a ref is sent
 * exactly when there is evidence for it, and omitted otherwise.
 */

import { describe, expect, it } from "vitest";
import { homeRecruitCandidates, resolveSeatRef } from "./seatRef";
import { DRIVE_PARTICIPANT_PARTNER } from "./types";

const HOMES = new Set(["nova", "reviewer"]);

describe("resolveSeatRef", () => {
	it("names a Driveagent the hub listed as a real home", () => {
		expect(resolveSeatRef("nova", HOMES)).toEqual({
			kind: "driveagent",
			slug: "nova",
		});
	});

	it("omits a ref for a slug with no home on disk", () => {
		// The picker's fixture candidates are labels, not homes. A ref here
		// would be a durable false claim in an append-only join event.
		expect(resolveSeatRef("security-reviewer", HOMES)).toBeNull();
		expect(resolveSeatRef("test-fixer", HOMES)).toBeNull();
	});

	it("names the builtin partner for the hub's own partner id", () => {
		expect(resolveSeatRef(DRIVE_PARTICIPANT_PARTNER, HOMES)).toEqual({
			kind: "builtin",
			id: "pair_partner",
		});
	});

	it("prefers a workspace home over the builtin for `pair-partner`", () => {
		// A workspace-authored `.driveagent/pair-partner/` has its own prompt
		// and permissions; recording it as the builtin would attribute the
		// wrong configuration to the seat.
		expect(resolveSeatRef("pair-partner", new Set(["pair-partner"]))).toEqual({
			kind: "driveagent",
			slug: "pair-partner",
		});
		expect(resolveSeatRef("pair-partner", new Set())).toEqual({
			kind: "builtin",
			id: "pair_partner",
		});
	});

	it("refuses slugs the AgentRef schema would reject", () => {
		// `DriveagentSlugSchema` is `[a-z0-9-]+`; sending anything else would
		// make the hub reject the whole seat rather than just drop the ref.
		expect(resolveSeatRef("Nova", new Set(["Nova"]))).toBeNull();
		expect(resolveSeatRef("has.dot", new Set(["has.dot"]))).toBeNull();
		expect(resolveSeatRef("has space", new Set(["has space"]))).toBeNull();
		expect(resolveSeatRef("   ", HOMES)).toBeNull();
	});
});

describe("homeRecruitCandidates", () => {
	it("turns real homes into seatable candidates", () => {
		const candidates = homeRecruitCandidates([
			{
				slug: "nova",
				tier: "workspace",
				displayName: "Nova",
				skills: ["drive-persona"],
			},
			{ slug: "reviewer", tier: "user" },
		]);
		expect(candidates.map((entry) => entry.slug)).toEqual(["nova", "reviewer"]);
		expect(candidates[0]?.displayName).toBe("Nova");
		expect(candidates[0]?.domains).toEqual(["drive-persona"]);
		// A home with no compiled name still has to be pickable.
		expect(candidates[1]?.displayName).toBe("reviewer");
	});

	it("carries no utterance-shaped fields (DRV-RECRUIT)", () => {
		const [candidate] = homeRecruitCandidates([
			{ slug: "nova", tier: "workspace", description: "A description" },
		]);
		expect(candidate && "description" in candidate).toBe(false);
	});
});
