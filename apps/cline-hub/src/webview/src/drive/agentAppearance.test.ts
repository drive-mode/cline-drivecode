/**
 * Durable appearance plumbing (DRV-AGENT-PROFILE).
 *
 * The inert risk here is "colours that vanish on reload": before this, the
 * webview's `agentInks` was localStorage only, so an upsert returning OK proved
 * nothing about what a fresh browser would paint. These cover the pure halves —
 * what gets written, and what a durable read does to local state.
 */

import { defaultInkRef } from "@cline/drive";
import type { AgentRef, Participant } from "@cline/shared";
import { agentProfileId } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	buildAgentProfileDraft,
	durableAppearanceTarget,
	inkFromPaletteChoice,
	inkPaletteIndex,
} from "./agentAppearance";
import {
	applyAgentBodyInk,
	applyAgentInk,
	applyDurableAgentProfiles,
	DEFAULT_DRIVE_UI,
} from "./types";

const NOVA: AgentRef = { kind: "driveagent", slug: "nova" };
const NOVA_ID = agentProfileId(NOVA);

function agent(overrides: Partial<Participant> = {}): Participant {
	return {
		id: "nova",
		kind: "agent",
		displayName: "Nova",
		role: "specialist",
		status: "idle",
		seatSources: [],
		...overrides,
	} as Participant;
}

describe("durableAppearanceTarget", () => {
	it("keys off the ref, not the participant id", () => {
		expect(durableAppearanceTarget(agent({ ref: NOVA }))).toEqual({
			ref: NOVA,
			profileId: "driveagent.nova",
		});
	});

	it("is null for a seat with no ref — there is nowhere to store it", () => {
		expect(durableAppearanceTarget(agent())).toBeNull();
	});

	it("is null for a human", () => {
		expect(
			durableAppearanceTarget({
				id: "drive:human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			}),
		).toBeNull();
	});
});

describe("buildAgentProfileDraft", () => {
	it("fills the untouched channel with the resolver's own default", () => {
		// The facet requires both inks while the UI sets one at a time. Filling
		// the gap with anything other than the current default would restyle a
		// channel the user never touched.
		const draft = buildAgentProfileDraft({
			ref: NOVA,
			profileId: NOVA_ID,
			displayName: "Nova",
			ink: { nameInk: { kind: "palette", index: 3 } },
		});
		expect(draft.nameInk).toEqual({ kind: "palette", index: 3 });
		expect(draft.bodyInk).toEqual(defaultInkRef("body", NOVA_ID));
		expect(draft.ref).toEqual(NOVA);
		expect(draft.displayName).toBe("Nova");
	});

	it("omits a blank display name rather than storing whitespace", () => {
		const draft = buildAgentProfileDraft({
			ref: NOVA,
			profileId: NOVA_ID,
			displayName: "   ",
		});
		expect(draft.displayName).toBeUndefined();
		expect(draft.nameInk).toEqual(defaultInkRef("name", NOVA_ID));
	});

	it("carries both channels through when both are set", () => {
		const draft = buildAgentProfileDraft({
			ref: NOVA,
			profileId: NOVA_ID,
			ink: {
				nameInk: { kind: "palette", index: 1 },
				bodyInk: { kind: "palette", index: 6 },
			},
		});
		expect(draft.nameInk).toEqual({ kind: "palette", index: 1 });
		expect(draft.bodyInk).toEqual({ kind: "palette", index: 6 });
	});
});

describe("palette choice mapping", () => {
	it("maps an empty choice to the default, not to index 0", () => {
		// Conflating the two would make "Default" unreachable once anything was
		// picked, and would silently pin every reset agent to teal.
		expect(inkFromPaletteChoice("")).toBeNull();
		expect(inkFromPaletteChoice("0")).toEqual({ kind: "palette", index: 0 });
	});

	it("refuses out-of-range and non-numeric choices", () => {
		expect(inkFromPaletteChoice("8")).toBeNull();
		expect(inkFromPaletteChoice("-1")).toBeNull();
		expect(inkFromPaletteChoice("nope")).toBeNull();
	});

	it("reads back a palette index and ignores tokens", () => {
		expect(inkPaletteIndex({ kind: "palette", index: 5 })).toBe(5);
		expect(inkPaletteIndex({ kind: "token", token: "muted" })).toBeNull();
		expect(inkPaletteIndex(undefined)).toBeNull();
	});
});

describe("applyDurableAgentProfiles", () => {
	it("lets the hub's stored appearance beat this browser's copy", () => {
		// The local map is a cache of the durable facet. A browser whose
		// localStorage disagrees with disk is stale, not authoritative.
		const stale = applyAgentInk(DEFAULT_DRIVE_UI, NOVA_ID, {
			nameInk: { kind: "palette", index: 0 },
		});
		const hydrated = applyDurableAgentProfiles(stale, [
			{
				id: NOVA_ID,
				nameInk: { kind: "palette", index: 4 },
				bodyInk: { kind: "palette", index: 2 },
			},
		]);
		expect(hydrated.agentInks[NOVA_ID]).toEqual({
			nameInk: { kind: "palette", index: 4 },
			bodyInk: { kind: "palette", index: 2 },
		});
	});

	it("leaves agents the durable map does not mention alone", () => {
		const local = applyAgentInk(DEFAULT_DRIVE_UI, "driveagent.riley", {
			nameInk: { kind: "palette", index: 7 },
		});
		const hydrated = applyDurableAgentProfiles(local, [
			{
				id: NOVA_ID,
				nameInk: { kind: "palette", index: 1 },
				bodyInk: { kind: "token", token: "muted" },
			},
		]);
		expect(hydrated.agentInks["driveagent.riley"]?.nameInk).toEqual({
			kind: "palette",
			index: 7,
		});
	});

	it("is identity for an empty map, so a cold hub cannot wipe local state", () => {
		const local = applyAgentInk(DEFAULT_DRIVE_UI, NOVA_ID, {
			nameInk: { kind: "palette", index: 2 },
		});
		expect(applyDurableAgentProfiles(local, [])).toBe(local);
	});

	it("keeps two agents apart", () => {
		const hydrated = applyDurableAgentProfiles(DEFAULT_DRIVE_UI, [
			{
				id: "driveagent.nova",
				nameInk: { kind: "palette", index: 3 },
				bodyInk: { kind: "palette", index: 4 },
			},
			{
				id: "driveagent.riley",
				nameInk: { kind: "palette", index: 6 },
				bodyInk: { kind: "token", token: "muted" },
			},
		]);
		expect(hydrated.agentInks["driveagent.nova"]?.nameInk).not.toEqual(
			hydrated.agentInks["driveagent.riley"]?.nameInk,
		);
	});
});

describe("applyAgentInk", () => {
	it("replaces both channels and drops an entry that stores nothing", () => {
		const set = applyAgentInk(DEFAULT_DRIVE_UI, NOVA_ID, {
			nameInk: { kind: "palette", index: 2 },
			bodyInk: { kind: "palette", index: 5 },
		});
		expect(set.agentInks[NOVA_ID]).toEqual({
			nameInk: { kind: "palette", index: 2 },
			bodyInk: { kind: "palette", index: 5 },
		});
		const cleared = applyAgentInk(set, NOVA_ID, {});
		expect(NOVA_ID in cleared.agentInks).toBe(false);
	});

	it("changes one channel without disturbing the other", () => {
		const both = applyAgentInk(DEFAULT_DRIVE_UI, NOVA_ID, {
			nameInk: { kind: "palette", index: 2 },
			bodyInk: { kind: "palette", index: 5 },
		});
		const bodyOnly = applyAgentBodyInk(both, NOVA_ID, {
			kind: "palette",
			index: 7,
		});
		expect(bodyOnly.agentInks[NOVA_ID]).toEqual({
			nameInk: { kind: "palette", index: 2 },
			bodyInk: { kind: "palette", index: 7 },
		});
	});

	it("stores an ink ref, never a resolved colour", () => {
		// A hex would freeze one theme's answer into durable state.
		const set = applyAgentInk(DEFAULT_DRIVE_UI, NOVA_ID, {
			nameInk: { kind: "palette", index: 2 },
		});
		expect(JSON.stringify(set.agentInks)).not.toContain("#");
		expect(JSON.stringify(set.agentInks)).not.toContain("oklch");
	});
});
