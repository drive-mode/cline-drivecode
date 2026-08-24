import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	type HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
	normalizeHubWorkspaceConnectionPolicy,
} from "./workspace-capability-authority";

const WORKSPACE_A = resolve("/tmp/hub-workspace-capability-a");
const WORKSPACE_B = resolve("/tmp/hub-workspace-capability-b");

describe("HubWorkspaceCapabilityAuthority", () => {
	it("issues a 256-bit one-time credential and stores only sanitized state", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const grant = authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
		});

		expect(Buffer.from(grant.credential, "base64url")).toHaveLength(32);
		expect(JSON.stringify(authority.snapshot())).not.toContain(
			grant.credential,
		);
		const identity = authority.consume({
			credential: grant.credential,
			transport: "websocket",
		});
		expect(identity).toMatchObject({
			principalId: "owner-1",
			tenantId: "local",
			workspaceKey: WORKSPACE_A,
			workspaceEpoch: 0,
			transport: "websocket",
		});
		authority.assertActive(identity);
		expect(() =>
			authority.consume({
				credential: grant.credential,
				transport: "websocket",
			}),
		).toThrow("missing, expired, consumed, or revoked");
	});

	it("rejects expired capabilities and consumes the failed credential", () => {
		let now = new Date("2026-08-15T00:00:00.000Z");
		const authority = new HubWorkspaceCapabilityAuthority({ clock: () => now });
		const grant = authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
			ttlMs: 1_000,
		});
		now = new Date("2026-08-15T00:00:01.000Z");

		expect(() =>
			authority.consume({
				credential: grant.credential,
				transport: "websocket",
			}),
		).toThrow("missing, expired, consumed, or revoked");
		expect(authority.snapshot().pendingCapabilities).toBe(0);
	});

	it("carries one immutable server-issued profile audience through consume", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const policy = {
			authorityClassId: "connector.slack.v1",
			audienceId: "aud_slack_install_1",
			policyEpoch: 3,
			allowedStartProfileIds: ["start.slack.v1"],
			allowedBindingProfileIds: ["binding.slack.v1"],
		};
		const grant = authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
			policy,
		});
		policy.allowedStartProfileIds.push("start.discord.v1");
		const identity = authority.consume({
			credential: grant.credential,
			transport: "websocket",
		});

		expect(identity.policy).toEqual({
			authorityClassId: "connector.slack.v1",
			audienceId: "aud_slack_install_1",
			policyEpoch: 3,
			allowedStartProfileIds: ["start.slack.v1"],
			allowedBindingProfileIds: ["binding.slack.v1"],
		});
		expect(Object.isFrozen(identity.policy)).toBe(true);
		expect(Object.isFrozen(identity.policy.allowedStartProfileIds)).toBe(true);
		expect(() =>
			normalizeHubWorkspaceConnectionPolicy({
				...policy,
				allowedStartProfileIds: ["duplicate", "duplicate"],
			}),
		).toThrow("allowed start profile is invalid");
	});

	it("rejects conflicting claims under the same authority class and policy epoch", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
			policy: {
				authorityClassId: "connector.slack.v1",
				audienceId: "aud_slack_install_1",
				policyEpoch: 3,
				allowedStartProfileIds: ["start.slack.v1"],
				allowedBindingProfileIds: ["binding.slack.v1"],
			},
		});

		expect(() =>
			authority.issue({
				principalId: "owner-2",
				workspaceKey: WORKSPACE_B,
				policy: {
					authorityClassId: "connector.slack.v1",
					audienceId: "aud_slack_install_2",
					policyEpoch: 3,
					allowedStartProfileIds: ["start.slack.v2"],
					allowedBindingProfileIds: ["binding.slack.v1"],
				},
			}),
		).toThrow("identify conflicting policies");
	});

	it("bounds pending capabilities and sweeps expired grants before minting", () => {
		let now = new Date("2026-08-15T00:00:00.000Z");
		const authority = new HubWorkspaceCapabilityAuthority({
			clock: () => now,
			maxPendingCapabilities: 2,
		});
		authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
			ttlMs: 1_000,
		});
		authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
			ttlMs: 2_000,
		});
		expect(() =>
			authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
			}),
		).toThrow("pending limit");

		now = new Date("2026-08-15T00:00:01.000Z");
		expect(() =>
			authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
			}),
		).not.toThrow();
		expect(authority.snapshot().pendingCapabilities).toBe(2);
	});

	it("revokes pending and active authority for only one workspace", () => {
		const closeA = vi.fn();
		const closeB = vi.fn();
		const authority = new HubWorkspaceCapabilityAuthority();
		const pendingA = authority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
		});
		const activeA = authority.consume({
			credential: authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
			}).credential,
			transport: "websocket",
			close: closeA,
		});
		const activeB = authority.consume({
			credential: authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_B,
			}).credential,
			transport: "websocket",
			close: closeB,
		});
		const signalA = authority.signal(activeA);
		const signalB = authority.signal(activeB);

		const revoked = authority.revokeWorkspace({ workspaceKey: WORKSPACE_A });

		expect(revoked).toMatchObject({
			workspaceKey: WORKSPACE_A,
			workspaceEpoch: 1,
			revokedPendingCapabilities: 1,
			revokedConnectionIds: [activeA.connectionId],
		});
		expect(closeA).toHaveBeenCalledWith("workspace_revoked");
		expect(closeB).not.toHaveBeenCalled();
		expect(signalA.aborted).toBe(true);
		expect(signalB.aborted).toBe(false);
		expect(() => authority.assertActive(activeA)).toThrow("invalid or revoked");
		authority.assertActive(activeB);
		expect(() =>
			authority.consume({
				credential: pendingA.credential,
				transport: "websocket",
			}),
		).toThrow("missing, expired, consumed, or revoked");
	});

	it("rejects forged structural identities and releases issued ones once", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const identity = authority.consume({
			credential: authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
			}).credential,
			transport: "websocket",
		});
		const forged = { ...identity } as HubAuthenticatedConnection;
		const signal = authority.signal(identity);

		expect(() => authority.assertActive(forged)).toThrow("invalid or revoked");
		expect(authority.release(identity)).toBe(true);
		expect(signal.aborted).toBe(true);
		expect(authority.release(identity)).toBe(false);
		expect(() => authority.assertActive(identity)).toThrow(
			"invalid or revoked",
		);
	});

	it("rejects non-absolute workspaces and invalid TTLs", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		expect(() =>
			authority.issue({ principalId: "owner-1", workspaceKey: "relative" }),
		).toThrow("workspace key must be absolute");
		expect(() =>
			authority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
				ttlMs: 0,
			}),
		).toThrow("TTL is invalid");
	});

	it("fails closed when injected factories repeat active values", () => {
		const duplicateCredentialAuthority = new HubWorkspaceCapabilityAuthority({
			credentialFactory: () => "duplicate-credential",
		});
		duplicateCredentialAuthority.issue({
			principalId: "owner-1",
			workspaceKey: WORKSPACE_A,
		});
		expect(() =>
			duplicateCredentialAuthority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
			}),
		).toThrow("could not produce a unique value");

		const duplicateConnectionAuthority = new HubWorkspaceCapabilityAuthority({
			connectionIdFactory: () => "duplicate-connection",
		});
		let firstIdentity: HubAuthenticatedConnection | undefined;
		for (let index = 0; index < 2; index += 1) {
			const grant = duplicateConnectionAuthority.issue({
				principalId: "owner-1",
				workspaceKey: WORKSPACE_A,
			});
			if (index === 0) {
				firstIdentity = duplicateConnectionAuthority.consume({
					credential: grant.credential,
					transport: "websocket",
				});
				expect(duplicateConnectionAuthority.release(firstIdentity)).toBe(true);
			} else {
				expect(() =>
					duplicateConnectionAuthority.consume({
						credential: grant.credential,
						transport: "websocket",
					}),
				).toThrow("could not produce a unique value");
			}
		}
	});
});
