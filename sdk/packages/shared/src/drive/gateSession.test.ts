import { describe, expect, it } from "vitest";
import {
	allowGateToolForSession,
	canOfferGateSessionAllow,
	clearGateSession,
	createGateSessionState,
	GATE_DENIAL_STRATEGY_THRESHOLD,
	GATE_WARNING_STRIP_THRESHOLD,
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
		const next = allowGateToolForSession(
			createGateSessionState(),
			"policy.hard",
			"check_permission_policy",
		);
		expect(
			isGateSessionAllowed(next, "policy.hard", "check_permission_policy"),
		).toBe(false);
		expect(
			resolveGateBypass({
				state: next,
				actionClass: "policy.hard",
				toolName: "check_permission_policy",
			}).proceed,
		).toBe(false);
	});

	it("allows the exact tool for the session, and only that tool", () => {
		const next = allowGateToolForSession(
			createGateSessionState(),
			"git.mutating",
			"git_push",
		);
		expect(isGateSessionAllowed(next, "git.mutating", "git_push")).toBe(true);
		expect(
			resolveGateBypass({
				state: next,
				actionClass: "git.mutating",
				toolName: "git_push",
			}),
		).toEqual({ proceed: true });
		// A sibling tool in the same class is not covered by the allow.
		expect(isGateSessionAllowed(next, "git.mutating", "git_force_push")).toBe(
			false,
		);
	});

	it("clears session allows on leave/end", () => {
		const allowed = allowGateToolForSession(
			createGateSessionState(),
			"shell.unchecked",
			"run_commands",
		);
		expect(
			isGateSessionAllowed(allowed, "shell.unchecked", "run_commands"),
		).toBe(true);
		const cleared = clearGateSession(allowed);
		expect(
			isGateSessionAllowed(cleared, "shell.unchecked", "run_commands"),
		).toBe(false);
		expect(cleared.warningCount).toBe(0);
	});

	it("tracks denials and strategy-change threshold", () => {
		let state = createGateSessionState();
		for (let i = 0; i < GATE_DENIAL_STRATEGY_THRESHOLD; i++) {
			state = recordGateDenial(state, "fs.destructive", "delete_file");
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

	it("blocks silent retry after prior deny, reading the deny from state", () => {
		// The deny memory lives in the state rather than in a caller-supplied
		// flag: the previous signature took previouslyDeniedSameTool and no
		// caller ever passed it, so deny was a no-op for any allowed class.
		const denied = recordGateDenial(
			createGateSessionState(),
			"shell.unchecked",
			"run_commands",
		);
		expect(
			resolveGateBypass({
				state: denied,
				actionClass: "shell.unchecked",
				toolName: "run_commands",
			}),
		).toEqual({
			proceed: false,
			reason: "Denied tools must not retry silently; replan or ask again.",
		});
		// A different tool is unaffected by that deny.
		expect(
			resolveGateBypass({
				state: denied,
				actionClass: "shell.unchecked",
				toolName: "read_files",
			}).reason,
		).toBe("Awaiting approve / deny / allow-for-session.");
	});
});
