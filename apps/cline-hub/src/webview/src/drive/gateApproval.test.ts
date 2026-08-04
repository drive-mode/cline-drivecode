import {
	allowGateToolForSession,
	createGateSessionState,
	recordGateDenial,
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

	it("bypasses only the exact tool the user allowed for the session", () => {
		const allowed = allowGateToolForSession(
			createGateSessionState(),
			"git.mutating",
			"git_push",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowed,
				toolName: "git_push",
			}),
		).toEqual({ bypass: true, actionClass: "git.mutating" });
		// A different tool from the same session must still ask.
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowed,
				toolName: "delete_file",
			}),
		).toEqual({ bypass: false, actionClass: "fs.destructive" });
	});

	it("does not grant shell from an approval given to a read-only tool", () => {
		// The regression this scoping exists to prevent. classifyToolNameForGate
		// has no match for read_files, search_codebase, editor or apply_patch, so
		// all four fall back to shell.unchecked — the same bucket run_commands
		// lands in via its "command" substring. A class-scoped allow therefore
		// granted arbitrary shell from a read-only approval.
		const allowed = allowGateToolForSession(
			createGateSessionState(),
			"shell.unchecked",
			"search_codebase",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowed,
				toolName: "search_codebase",
			}).bypass,
		).toBe(true);
		for (const toolName of [
			"run_commands",
			"editor",
			"apply_patch",
			"read_files",
		]) {
			expect(
				resolveIncomingApprovalBypass({
					driveActive: true,
					gateSession: allowed,
					toolName,
				}),
			).toEqual({ bypass: false, actionClass: "shell.unchecked" });
		}
	});

	it("does not silently retry a tool the user denied", () => {
		// Deny must survive a prior session allow, or denying is a no-op: the
		// agent re-requests and is auto-approved with no card.
		const allowedThenDenied = recordGateDenial(
			allowGateToolForSession(
				createGateSessionState(),
				"git.mutating",
				"git_push",
			),
			"git.mutating",
			"git_push",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: allowedThenDenied,
				toolName: "git_push",
			}),
		).toEqual({ bypass: false, actionClass: "git.mutating" });
	});

	it("lets an explicit allow clear an earlier deny for the same tool", () => {
		const denied = recordGateDenial(
			createGateSessionState(),
			"git.mutating",
			"git_push",
		);
		const reAllowed = allowGateToolForSession(
			denied,
			"git.mutating",
			"git_push",
		);
		expect(
			resolveIncomingApprovalBypass({
				driveActive: true,
				gateSession: reAllowed,
				toolName: "git_push",
			}).bypass,
		).toBe(true);
	});

	it("never bypasses policy.hard even after an allow is attempted", () => {
		const allowed = allowGateToolForSession(
			createGateSessionState(),
			"policy.hard",
			"check_permission_policy",
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
		const allowed = allowGateToolForSession(
			createGateSessionState(),
			"git.mutating",
			"git_push",
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
