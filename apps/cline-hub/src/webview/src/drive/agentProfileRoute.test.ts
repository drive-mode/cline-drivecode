/**
 * `/agents?id=` route contract (DRV-AGENT-PROFILE).
 *
 * Query-param detail, mirroring `/drive?id=`. Both route lists — `viewFromPath`
 * in App.tsx and `isWebviewRoute` in the server — match on pathname alone, so
 * `/agents?id=…` needs no change to either. That is asserted here rather than
 * assumed, because the failure mode is silent: `viewFromPath` returns "home"
 * and `isWebviewRoute` 403s a deep link.
 */

import { describe, expect, it } from "vitest";
import {
	AGENTS_PATH,
	agentProfilePath,
	parseAgentProfileParam,
} from "./agentProfileRoute";

describe("agentProfilePath", () => {
	it("round-trips a profile id through the query string", () => {
		const path = agentProfilePath("driveagent.pair-partner");
		expect(path).toBe("/agents?id=driveagent.pair-partner");
		expect(parseAgentProfileParam("?id=driveagent.pair-partner")).toBe(
			"driveagent.pair-partner",
		);
	});

	it("falls back to the index for a blank id", () => {
		expect(agentProfilePath("  ")).toBe(AGENTS_PATH);
	});

	it("encodes the id rather than splicing it in raw", () => {
		expect(agentProfilePath("builtin.a b")).toBe("/agents?id=builtin.a%20b");
	});
});

describe("parseAgentProfileParam", () => {
	it("rejects an id that names no possible agent", () => {
		// The id is an AgentRef flattened. One that does not parse should land
		// on the index, not on a detail page for an agent that cannot exist.
		expect(parseAgentProfileParam("?id=nonsense")).toBeNull();
		expect(parseAgentProfileParam("?id=driveagent.Bad_Slug")).toBeNull();
		expect(parseAgentProfileParam("?id=")).toBeNull();
		expect(parseAgentProfileParam("")).toBeNull();
	});

	it("accepts every ref kind the union allows", () => {
		expect(parseAgentProfileParam("?id=builtin.pair_partner")).toBe(
			"builtin.pair_partner",
		);
		expect(parseAgentProfileParam("?id=configured.legacy")).toBe(
			"configured.legacy",
		);
		expect(parseAgentProfileParam("?id=driveagent.nova")).toBe(
			"driveagent.nova",
		);
	});

	it("ignores other params on the same URL", () => {
		expect(parseAgentProfileParam("?tab=x&id=driveagent.nova&y=1")).toBe(
			"driveagent.nova",
		);
	});
});
