import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	bindHubWorkspaceConnectionPolicyToInstalledInstance,
	HubWorkspaceCapabilityAuthority,
	type HubWorkspaceConnectionPolicy,
} from "./workspace-capability-authority";
import {
	type HubWorkspaceManagedCore,
	HubWorkspaceManagedCorePool,
} from "./workspace-managed-core-pool";

const WORKSPACE_A = resolve("/tmp/hub-managed-core-a");
const WORKSPACE_B = resolve("/tmp/hub-managed-core-b");

function identity(
	authority: HubWorkspaceCapabilityAuthority,
	workspaceKey = WORKSPACE_A,
	principalId = "owner-managed-core",
	tenantId = "local",
	policy?: HubWorkspaceConnectionPolicy,
) {
	return authority.consume({
		credential: authority.issue({
			principalId,
			tenantId,
			workspaceKey,
			...(policy ? { policy } : {}),
		}).credential,
		transport: "websocket",
	});
}

function fakeCore(dispose = vi.fn(async () => {})): HubWorkspaceManagedCore {
	return {
		chatLifecycle: {} as never,
		dispose,
	};
}

describe("HubWorkspaceManagedCorePool", () => {
	it("single-flights one Core per authenticated principal/tenant/workspace epoch", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const firstIdentity = identity(authority);
		const secondIdentity = identity(authority);
		const otherWorkspaceIdentity = identity(authority, WORKSPACE_B);
		const create = vi.fn(async () => fakeCore());
		const pool = new HubWorkspaceManagedCorePool(authority, { create });

		const [first, replay, second, other] = await Promise.all([
			pool.get(firstIdentity),
			pool.get(firstIdentity),
			pool.get(secondIdentity),
			pool.get(otherWorkspaceIdentity),
		]);

		expect(first).toBe(replay);
		expect(first).toBe(second);
		expect(other).not.toBe(first);
		expect(create).toHaveBeenCalledTimes(2);
		expect(create).toHaveBeenCalledWith(
			Object.freeze({
				principalId: firstIdentity.principalId,
				tenantId: firstIdentity.tenantId,
				workspaceKey: firstIdentity.workspaceKey,
				workspaceEpoch: firstIdentity.workspaceEpoch,
				authorityClassId: firstIdentity.policy.authorityClassId,
				audienceId: firstIdentity.policy.audienceId,
				policyEpoch: firstIdentity.policy.policyEpoch,
				signal: expect.any(AbortSignal),
			}),
		);
		await pool.dispose();
	});

	it("does not share a Core across audiences, authority classes, or policy epochs", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const base = {
			authorityClassId: "interactive.v1",
			audienceId: "aud_interactive_v1",
			policyEpoch: 1,
			allowedStartProfileIds: ["interactive.v1"],
			allowedBindingProfileIds: [],
		};
		const interactive = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			base,
		);
		const changedEpoch = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			{ ...base, policyEpoch: 2 },
		);
		const changedAudience = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			{ ...base, audienceId: "aud_interactive_instance_2_v1" },
		);
		const connector = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			{ ...base, authorityClassId: "connector.slack.v1" },
		);
		const create = vi.fn(async () => fakeCore());
		const pool = new HubWorkspaceManagedCorePool(authority, { create });

		const cores = await Promise.all([
			pool.get(interactive),
			pool.get(changedEpoch),
			pool.get(changedAudience),
			pool.get(connector),
		]);
		expect(new Set(cores).size).toBe(4);
		expect(create).toHaveBeenCalledTimes(4);
		await pool.dispose();
	});

	it("derives stable isolated audiences and Cores for connector installations", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const connectorTemplate = {
			authorityClassId: "connector.slack.v1",
			audienceId: "aud_connector_slack_bootstrap_v1",
			policyEpoch: 1,
			allowedStartProfileIds: ["connector.slack.v1"],
			allowedBindingProfileIds: ["connector.slack.v1"],
		};
		const firstPolicy = bindHubWorkspaceConnectionPolicyToInstalledInstance(
			connectorTemplate,
			"slack:installation-a",
		);
		const replayPolicy = bindHubWorkspaceConnectionPolicyToInstalledInstance(
			connectorTemplate,
			"slack:installation-a",
		);
		const secondPolicy = bindHubWorkspaceConnectionPolicyToInstalledInstance(
			connectorTemplate,
			"slack:installation-b",
		);
		expect(replayPolicy).toEqual(firstPolicy);
		expect(secondPolicy.audienceId).not.toBe(firstPolicy.audienceId);
		expect(firstPolicy.audienceId).not.toContain("installation-a");
		expect(secondPolicy.audienceId).not.toContain("installation-b");

		const first = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			firstPolicy,
		);
		const firstReplay = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			replayPolicy,
		);
		const second = identity(
			authority,
			WORKSPACE_A,
			"owner-managed-core",
			"local",
			secondPolicy,
		);
		const create = vi.fn(async () => fakeCore());
		const pool = new HubWorkspaceManagedCorePool(authority, { create });

		const [firstCore, replayCore, secondCore] = await Promise.all([
			pool.get(first),
			pool.get(firstReplay),
			pool.get(second),
		]);
		expect(firstCore).toBe(replayCore);
		expect(secondCore).not.toBe(firstCore);
		expect(create).toHaveBeenCalledTimes(2);
		await pool.dispose();
	});

	it("rejects identities from another authority", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const foreignAuthority = new HubWorkspaceCapabilityAuthority();
		const create = vi.fn(async () => fakeCore());
		const pool = new HubWorkspaceManagedCorePool(authority, { create });

		await expect(pool.get(identity(foreignAuthority))).rejects.toThrow(
			"invalid or revoked",
		);
		expect(create).not.toHaveBeenCalled();
		await pool.dispose();
	});

	it("disposes a late factory result when workspace authority is revoked", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const connection = identity(authority);
		let resolveCore: ((core: HubWorkspaceManagedCore) => void) | undefined;
		const dispose = vi.fn(async () => {});
		const pool = new HubWorkspaceManagedCorePool(authority, {
			create: () =>
				new Promise<HubWorkspaceManagedCore>((resolve) => {
					resolveCore = resolve;
				}),
		});
		const pending = pool.get(connection);
		await vi.waitFor(() => expect(resolveCore).toBeTypeOf("function"));
		authority.revokeWorkspace({ workspaceKey: connection.workspaceKey });
		const retiring = pool.revokeWorkspace({
			tenantId: connection.tenantId,
			workspaceKey: connection.workspaceKey,
		});
		resolveCore?.(fakeCore(dispose));

		await expect(pending).rejects.toThrow("authority was retired");
		await retiring;
		expect(dispose).toHaveBeenCalledOnce();
		await pool.dispose();
	});

	it("reports a rejected late-Core disposal to the revocation owner", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const connection = identity(authority);
		let resolveCore: ((core: HubWorkspaceManagedCore) => void) | undefined;
		const disposalFailure = new Error("late disposal failed");
		const dispose = vi.fn(async () => {
			throw disposalFailure;
		});
		const pool = new HubWorkspaceManagedCorePool(authority, {
			create: () =>
				new Promise<HubWorkspaceManagedCore>((resolve) => {
					resolveCore = resolve;
				}),
		});
		const pending = pool.get(connection);
		await vi.waitFor(() => expect(resolveCore).toBeTypeOf("function"));
		authority.revokeWorkspace({ workspaceKey: connection.workspaceKey });
		const retiring = pool.revokeWorkspace({
			tenantId: connection.tenantId,
			workspaceKey: connection.workspaceKey,
		});
		resolveCore?.(fakeCore(dispose));

		await expect(pending).rejects.toThrow("authority was retired");
		await expect(retiring).rejects.toThrow("retirement failed");
		expect(dispose).toHaveBeenCalledOnce();
		await pool.dispose();
	});

	it("bounds a non-settling late-Core disposal", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const connection = identity(authority);
		let resolveCore: ((core: HubWorkspaceManagedCore) => void) | undefined;
		const dispose = vi.fn(() => new Promise<void>(() => {}));
		const pool = new HubWorkspaceManagedCorePool(
			authority,
			{
				create: () =>
					new Promise<HubWorkspaceManagedCore>((resolve) => {
						resolveCore = resolve;
					}),
			},
			{ retirementWaitMs: 50, disposalWaitMs: 5 },
		);
		const pending = pool.get(connection);
		await vi.waitFor(() => expect(resolveCore).toBeTypeOf("function"));
		authority.revokeWorkspace({ workspaceKey: connection.workspaceKey });
		const retiring = pool.revokeWorkspace({
			tenantId: connection.tenantId,
			workspaceKey: connection.workspaceKey,
		});
		resolveCore?.(fakeCore(dispose));

		await expect(pending).rejects.toThrow("authority was retired");
		await retiring;
		expect(dispose).toHaveBeenCalledOnce();
		await pool.dispose();
	});

	it("replaces an old epoch and disposes every Core exactly once", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const firstIdentity = identity(authority);
		const disposers: Array<ReturnType<typeof vi.fn>> = [];
		const pool = new HubWorkspaceManagedCorePool(authority, {
			create: async () => {
				const dispose = vi.fn(async () => {});
				disposers.push(dispose);
				return fakeCore(dispose);
			},
		});
		await pool.get(firstIdentity);
		authority.revokeWorkspace({ workspaceKey: firstIdentity.workspaceKey });
		const replacementIdentity = identity(authority);
		await pool.get(replacementIdentity);

		expect(disposers).toHaveLength(2);
		expect(disposers[0]).toHaveBeenCalledWith("workspace_epoch_replaced");
		await pool.dispose("test_shutdown");
		await pool.dispose("duplicate_shutdown");
		expect(disposers[0]).toHaveBeenCalledOnce();
		expect(disposers[1]).toHaveBeenCalledOnce();
		expect(disposers[1]).toHaveBeenCalledWith("test_shutdown");
		await expect(pool.get(replacementIdentity)).rejects.toThrow(
			"pool is closed",
		);
	});

	it("single-flights a replacement while the old epoch is still disposing", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const firstIdentity = identity(authority);
		let releaseOld: (() => void) | undefined;
		const oldDispose = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseOld = resolve;
				}),
		);
		const replacementDispose = vi.fn(async () => {});
		const create = vi
			.fn()
			.mockResolvedValueOnce(fakeCore(oldDispose))
			.mockResolvedValue(fakeCore(replacementDispose));
		const pool = new HubWorkspaceManagedCorePool(authority, { create });
		await pool.get(firstIdentity);
		authority.revokeWorkspace({ workspaceKey: firstIdentity.workspaceKey });
		const replacementIdentity = identity(authority);
		const firstReplacement = pool.get(replacementIdentity);
		await vi.waitFor(() => expect(oldDispose).toHaveBeenCalledOnce());
		const secondReplacement = pool.get(replacementIdentity);
		releaseOld?.();

		const [first, second] = await Promise.all([
			firstReplacement,
			secondReplacement,
		]);
		expect(first).toBe(second);
		expect(create).toHaveBeenCalledTimes(2);
		await pool.dispose();
		expect(replacementDispose).toHaveBeenCalledOnce();
	});

	it("uses an unambiguous tenant/principal/workspace tuple key", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const first = identity(authority, WORKSPACE_A, "b\0c", "a");
		const second = identity(authority, WORKSPACE_A, "c", "a\0b");
		const create = vi.fn(async () => fakeCore());
		const pool = new HubWorkspaceManagedCorePool(authority, { create });

		expect(await pool.get(first)).not.toBe(await pool.get(second));
		expect(create).toHaveBeenCalledTimes(2);
		await pool.dispose();
	});

	it("aborts and bounds retirement of a hung factory", async () => {
		const authority = new HubWorkspaceCapabilityAuthority();
		const connection = identity(authority);
		let factorySignal: AbortSignal | undefined;
		const create = vi.fn(
			(scope: { signal: AbortSignal }) =>
				new Promise<HubWorkspaceManagedCore>(() => {
					factorySignal = scope.signal;
				}),
		);
		const pool = new HubWorkspaceManagedCorePool(
			authority,
			{ create },
			{ retirementWaitMs: 5, disposalWaitMs: 5 },
		);
		const pending = pool.get(connection);
		const pendingRejection = expect(pending).rejects.toThrow(
			"authority was retired",
		);
		await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
		await pool.dispose();

		expect(factorySignal?.aborted).toBe(true);
		await pendingRejection;
	});
});
