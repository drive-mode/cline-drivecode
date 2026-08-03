import {
	allowGateClassForSession,
	createGateSessionState,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveIncomingApprovalBypass } from "./gateApproval";

describe("resolveIncomingApprovalBypass", () => {
	it("does not bypass when nothing has been session-allowed", () => {
		const result = resolveIncomingApprovalBypass({
			driveActive: true,
			gateSession: createGateSessionState(),
			toolName: "git_push",
		});
		expect(result).toEqual({ bypass: false, actionClass: "git.mutating" });
	});

	it("bypasses only the exact class the user allowed for the session", () => {
		const allowed = allowGateClassForSession(
			createGateSessionState(),
			"git.mutating",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowed,
				toolName: "git_push",
			}),
		).toEqual({ bypass: true, actionClass: "git.mutating" });
		// A different class from the same session must still ask.
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowed,
				toolName: "delete_file",
			}),
		).toEqual({ bypass: false, actionClass: "fs.destructive" });
	});

	it("never bypasses policy.hard even after allowGateClassForSession is attempted", () => {
		const allowed = allowGateClassForSession(
			createGateSessionState(),
			"policy.hard",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowed,
				toolName: "check_permission_policy",
			}),
		).toEqual({ bypass: false, actionClass: "policy.hard" });
	});

	it("never bypasses outside an active Drive session", () => {
		const allowed = allowGateClassForSession(
			createGateSessionState(),
			"git.mutating",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: false,
				gateSession: allowed,
				toolName: "git_push",
			}),
		).toEqual({ bypass: false, actionClass: "git.mutating" });
	});
});
