import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";
import { HubWorkspaceCapabilityRegistry } from "./workspace-capability-registry";

describe("HubWorkspaceCapabilityRegistry", () => {
	const tempDirs: string[] = [];

	function workspace(name: string): string {
		const value = mkdtempSync(join(tmpdir(), `${name}-`));
		tempDirs.push(value);
		return value;
	}

	afterEach(() => {
		for (const path of tempDirs.splice(0)) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	it("registers a canonical directory once and exposes no filesystem path", () => {
		const target = workspace("hub-registry-target");
		const aliasRoot = workspace("hub-registry-alias");
		const alias = join(aliasRoot, "workspace-link");
		symlinkSync(target, alias, "dir");
		const authority = new HubWorkspaceCapabilityAuthority();
		const registry = new HubWorkspaceCapabilityRegistry(authority);

		const first = registry.register({
			principalId: "owner-1",
			workspaceKey: alias,
		});
		const replay = registry.register({
			principalId: "owner-1",
			workspaceKey: realpathSync.native(target),
		});

		expect(first).toBe(replay);
		expect(Buffer.from(first.workspaceId.slice(4), "base64url")).toHaveLength(
			32,
		);
		expect(
			JSON.stringify(registry.list({ principalId: "owner-1" })),
		).not.toContain(target);
		expect(
			JSON.stringify(registry.list({ principalId: "owner-1" })),
		).not.toContain(alias);
	});

	it("mints by opaque ID and binds the resulting identity to registry scope", () => {
		const target = workspace("hub-registry-mint");
		const authority = new HubWorkspaceCapabilityAuthority();
		const registry = new HubWorkspaceCapabilityRegistry(authority);
		const registration = registry.register({
			principalId: "owner-1",
			tenantId: "tenant-1",
			workspaceKey: target,
		});

		const grant = registry.issue({
			principalId: "owner-1",
			tenantId: "tenant-1",
			workspaceId: registration.workspaceId,
		});
		const identity = authority.consume({
			credential: grant.credential,
			transport: "websocket",
		});

		expect(identity).toMatchObject({
			principalId: "owner-1",
			tenantId: "tenant-1",
			workspaceKey: realpathSync.native(target),
			workspaceEpoch: 0,
		});
		expect(registry.registrationForConnection(identity)).toBe(registration);
		authority.revokeWorkspace({
			tenantId: "tenant-1",
			workspaceKey: identity.workspaceKey,
		});
		expect(() => registry.registrationForConnection(identity)).toThrow(
			"invalid or revoked",
		);
	});

	it("returns one generic error for unknown, cross-principal, and cross-tenant IDs", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const registry = new HubWorkspaceCapabilityRegistry(authority);
		const registration = registry.register({
			principalId: "owner-1",
			tenantId: "tenant-1",
			workspaceKey: workspace("hub-registry-auth"),
		});
		for (const input of [
			{
				principalId: "owner-1",
				tenantId: "tenant-1",
				workspaceId: "unknown",
			},
			{
				principalId: "owner-2",
				tenantId: "tenant-1",
				workspaceId: registration.workspaceId,
			},
			{
				principalId: "owner-1",
				tenantId: "tenant-2",
				workspaceId: registration.workspaceId,
			},
		]) {
			expect(() => registry.issue(input)).toThrow(
				"workspace registration is missing or unauthorized",
			);
		}
	});

	it("uses an unambiguous tenant/principal/workspace registration key", () => {
		const target = workspace("hub-registry-tuple-key");
		const authority = new HubWorkspaceCapabilityAuthority();
		const registry = new HubWorkspaceCapabilityRegistry(authority);
		const first = registry.register({
			principalId: "b\0c",
			tenantId: "a",
			workspaceKey: target,
		});
		const second = registry.register({
			principalId: "c",
			tenantId: "a\0b",
			workspaceKey: target,
		});

		expect(first.workspaceId).not.toBe(second.workspaceId);
		expect(registry.list({ principalId: "b\0c", tenantId: "a" })).toEqual([
			first,
		]);
		expect(registry.list({ principalId: "c", tenantId: "a\0b" })).toEqual([
			second,
		]);
	});

	it("revokes in place and unregisters before invalidating pending and active authority", () => {
		const close = vi.fn();
		const target = workspace("hub-registry-revoke");
		const authority = new HubWorkspaceCapabilityAuthority();
		const registry = new HubWorkspaceCapabilityRegistry(authority);
		const registration = registry.register({
			principalId: "owner-1",
			workspaceKey: target,
		});
		const pending = registry.issue({
			principalId: "owner-1",
			workspaceId: registration.workspaceId,
		});
		const active = authority.consume({
			credential: registry.issue({
				principalId: "owner-1",
				workspaceId: registration.workspaceId,
			}).credential,
			transport: "websocket",
			close,
		});

		const result = registry.unregister({
			principalId: "owner-1",
			workspaceId: registration.workspaceId,
		});

		expect(result.revocation).toMatchObject({
			workspaceEpoch: 1,
			revokedPendingCapabilities: 1,
			revokedConnectionIds: [active.connectionId],
		});
		expect(close).toHaveBeenCalledWith("workspace_revoked");
		expect(registry.list({ principalId: "owner-1" })).toEqual([]);
		expect(() =>
			authority.consume({
				credential: pending.credential,
				transport: "websocket",
			}),
		).toThrow("missing, expired, consumed, or revoked");
		expect(() =>
			registry.issue({
				principalId: "owner-1",
				workspaceId: registration.workspaceId,
			}),
		).toThrow("missing or unauthorized");
	});

	it("rejects missing directories and fails closed on repeated ID factories", () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const registry = new HubWorkspaceCapabilityRegistry(authority, {
			workspaceIdFactory: () => "duplicate-id",
		});
		registry.register({
			principalId: "owner-1",
			workspaceKey: workspace("hub-registry-first"),
		});
		expect(() =>
			registry.register({
				principalId: "owner-1",
				workspaceKey: workspace("hub-registry-second"),
			}),
		).toThrow("could not produce a unique value");
		expect(() =>
			registry.register({
				principalId: "owner-1",
				workspaceKey: join(tmpdir(), "definitely-missing-hub-workspace"),
			}),
		).toThrow("existing canonical directory");
	});
});
