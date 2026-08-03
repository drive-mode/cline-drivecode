import { describe, expect, it } from "vitest";
import {
	GATE_DENIAL_STRATEGY_THRESHOLD,
	GATE_WARNING_STRIP_THRESHOLD,
	allowGateClassForSession,
	canOfferGateSessionAllow,
	clearGateSession,
	createGateSessionState,
	gateDenialCount,
	isGateSessionAllowed,
	recordGateDenial,
	recordGateWarning,
	requiresGateStrategyChange,
	resolveGateBypass,
	shouldShowGatesActiveStrip,
} from "./gateSession";

describe("gateSession", () => {
	it("never session-allows policy.hard", () => {
		expect(canOfferGateSessionAllow("policy.hard")).toBe(false);
		const next = allowGateClassForSession(
			createGateSessionState(),
			"policy.hard",
		);
		expect(isGateSessionAllowed(next, "policy.hard")).toBe(false);
		expect(
			resolveGateBypass({
				state: next,
				actionClass: "policy.hard",
			}).proceed,
		).toBe(false);
	});

	it("allows approve-class tools for the session after allowGateClassForSession", () => {
		const next = allowGateClassForSession(
			createGateSessionState(),
			"git.mutating",
		);
		expect(isGateSessionAllowed(next, "git.mutating")).toBe(true);
		expect(
			resolveGateBypass({ state: next, actionClass: "git.mutating" }),
		).toEqual({ proceed: true });
	});

	it("clears session allows on leave/end", () => {
		const allowed = allowGateClassForSession(
			createGateSessionState(),
			"shell.unchecked",
		);
		expect(isGateSessionAllowed(allowed, "shell.unchecked")).toBe(true);
		const cleared = clearGateSession(allowed);
		expect(isGateSessionAllowed(cleared, "shell.unchecked")).toBe(false);
		expect(cleared.warningCount).toBe(0);
	});

	it("tracks denials and strategy-change threshold", () => {
		let state = createGateSessionState();
		for (let i = 0; i < GATE_DENIAL_STRATEGY_THRESHOLD; i++) {
			state = recordGateDenial(state, "fs.destructive");
		}
		expect(gateDenialCount(state, "fs.destructive")).toBe(
			GATE_DENIAL_STRATEGY_THRESHOLD,
		);
		expect(requiresGateStrategyChange(state, "fs.destructive")).toBe(true);
		expect(requiresGateStrategyChange(state, "git.mutating")).toBe(false);
	});

	it("shows sticky strip after warning threshold", () => {
		let state = createGateSessionState();
		for (let i = 0; i < GATE_WARNING_STRIP_THRESHOLD; i++) {
			state = recordGateWarning(state);
		}
		expect(shouldShowGatesActiveStrip(state)).toBe(true);
	});

	it("blocks silent retry after prior deny", () => {
		expect(
			resolveGateBypass({
				state: createGateSessionState(),
				actionClass: "shell.unchecked",
				previouslyDeniedSameTool: true,
			}),
		).toEqual({
			proceed: false,
			reason: "Denied tools must not retry silently; replan or ask again.",
		});
	});
});
