import {
	canOfferGateSessionAllow,
	classifyToolNameForGate,
	defaultDispositionForGateClass,
} from "@cline/shared";
import { describe, expect, it } from "vitest";

/**
 * GateFeedCard is presentational; behavior contracts live in shared gateSession.
 * These assertions pin the feed-card decision table used by the component.
 */
describe("GateFeedCard decision table", () => {
	it("maps destructive tools to approve disposition with session allow", () => {
		const actionClass = classifyToolNameForGate("delete_file");
		expect(actionClass).toBe("fs.destructive");
		expect(defaultDispositionForGateClass(actionClass)).toBe("approve");
		expect(canOfferGateSessionAllow(actionClass)).toBe(true);
	});

	it("blocks session allow for policy.hard tools", () => {
		const actionClass = classifyToolNameForGate("check_permission_policy");
		expect(actionClass).toBe("policy.hard");
		expect(defaultDispositionForGateClass(actionClass)).toBe("block");
		expect(canOfferGateSessionAllow(actionClass)).toBe(false);
	});
});
