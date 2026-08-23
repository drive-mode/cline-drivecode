import {
	existsSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getChatCatalogMutationFence } from "../../chat-catalog/chat-catalog-authority";
import { createHubDaemonChatManagementComposition } from "./chat-management-composition";
import {
	HUB_DAEMON_CHAT_CONNECTION_POLICIES,
	HUB_DAEMON_CONNECTOR_AUTHORITY_CLASS_IDS,
	HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
} from "./chat-management-profiles";

describe("createHubDaemonChatManagementComposition", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("composes one inert, fenced workspace authority over the daemon database", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "hub-managed-workspace-"));
		const dataDir = mkdtempSync(join(tmpdir(), "hub-managed-data-"));
		tempDirs.push(workspaceRoot, dataDir);
		const composition = createHubDaemonChatManagementComposition({
			workspaceRoot,
			dataDir,
		});
		const options = composition.serverOptions;

		expect(options.managedChatLifecycleEnabled).toBe(false);
		expect(options.workspaceAuthority?.trustedWorkspaceKeys).toEqual([
			realpathSync(workspaceRoot),
		]);
		expect(options.workspaceManagedCoreFactory).toBeDefined();
		expect(options.workspaceAuthority?.connectionPolicies).toBe(
			HUB_DAEMON_CHAT_CONNECTION_POLICIES,
		);
		expect(options.workspaceAuthority?.defaultConnectionPolicy).toBe(
			HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
		);
		expect(options.workspaceAuthority?.instanceBoundAuthorityClassIds).toBe(
			HUB_DAEMON_CONNECTOR_AUTHORITY_CLASS_IDS,
		);
		expect(existsSync(join(dataDir, "sessions.db"))).toBe(true);
		await expect(
			Promise.resolve(
				options.workspaceAuthority?.confirmCatalogMutation?.({} as never),
			),
		).resolves.toBe(false);

		const signal = new AbortController().signal;
		const assertActive = vi.fn();
		const mutationFence = Object.freeze({ signal, assertActive });
		const identity = Object.freeze({
			connectionId: "connection-1",
			principalId: "owner-1",
			tenantId: "local",
			workspaceKey: workspaceRoot,
			workspaceEpoch: 0,
			policy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
			transport: "websocket" as const,
			authenticatedAt: "2026-08-15T12:00:00.000Z",
		});
		const host = options.chatCatalog;
		if (!host) throw new Error("Expected chat catalog host.");
		const authority = await host.authorize({
			authenticatedConnection: identity,
			authenticatedClientId: identity.connectionId,
			command: "chat_catalog.list",
			mutationFence,
		});

		expect(authority).toMatchObject({
			principalId: identity.principalId,
			tenantId: "local",
			workspaceKey: workspaceRoot,
			actorKind: "human",
			source: {
				kind: "hub",
				clientId: identity.connectionId,
				transport: "websocket",
			},
		});
		const issuedFence = getChatCatalogMutationFence(authority);
		expect(issuedFence?.signal).toBe(mutationFence.signal);
		issuedFence?.assertActive();
		expect(assertActive).toHaveBeenCalledOnce();

		await composition.dispose();
		await expect(composition.dispose()).resolves.toBeUndefined();
	});

	it("canonicalizes enrollment and rejects a mismatched managed scope", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "hub-managed-workspace-"));
		const dataDir = mkdtempSync(join(tmpdir(), "hub-managed-data-"));
		const alias = join(tmpdir(), `hub-managed-alias-${Date.now()}`);
		symlinkSync(workspaceRoot, alias);
		tempDirs.push(alias, workspaceRoot, dataDir);
		const composition = createHubDaemonChatManagementComposition({
			workspaceRoot: alias,
			dataDir,
		});

		expect(
			composition.serverOptions.workspaceAuthority?.trustedWorkspaceKeys,
		).toEqual([realpathSync(workspaceRoot)]);
		await expect(
			composition.serverOptions.workspaceManagedCoreFactory?.create({
				principalId: "owner-1",
				tenantId: "local",
				workspaceKey: `${workspaceRoot}-other`,
				workspaceEpoch: 0,
				authorityClassId:
					HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY.authorityClassId,
				audienceId: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY.audienceId,
				policyEpoch: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY.policyEpoch,
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ code: "unsupported_capability" });
		await composition.dispose();
	});

	it("passes a trusted owner responder and timeout into the inert composition", async () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "hub-managed-workspace-"));
		const dataDir = mkdtempSync(join(tmpdir(), "hub-managed-data-"));
		tempDirs.push(workspaceRoot, dataDir);
		const confirmCatalogMutation = vi.fn(async () => true);
		const composition = createHubDaemonChatManagementComposition({
			workspaceRoot,
			dataDir,
			confirmCatalogMutation,
			confirmationPromptTimeoutMs: 321,
		});
		const configured =
			composition.serverOptions.workspaceAuthority?.confirmCatalogMutation;
		if (!configured) throw new Error("Expected confirmation responder.");
		const request = Object.freeze({
			target: Object.freeze({
				confirmation: "archive" as const,
				aggregateKind: "chat" as const,
				aggregateId: "chat-1",
				expectedRevision: 1,
			}),
			signal: new AbortController().signal,
		});

		await expect(configured(request)).resolves.toBe(true);
		expect(confirmCatalogMutation).toHaveBeenCalledWith(request);
		expect(
			composition.serverOptions.workspaceAuthority?.confirmationPromptTimeoutMs,
		).toBe(321);
		expect(composition.serverOptions.managedChatLifecycleEnabled).toBe(false);
		await composition.dispose();
	});
});
