import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bindHubWorkspaceConnectionPolicyToInstalledInstance,
	type HubAuthenticatedConnection,
} from "../server/workspace-capability-authority";
import {
	createHubDaemonChatProfileResolver,
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS,
	HUB_DAEMON_CHAT_CONNECTION_POLICIES,
	HUB_DAEMON_CHAT_PROFILE_IDS,
	HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
} from "./chat-management-profiles";

describe("Hub daemon production chat profiles", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function workspace(): string {
		const root = mkdtempSync(join(tmpdir(), "hub-profile-workspace-"));
		tempDirs.push(root);
		return realpathSync(root);
	}

	function identity(
		workspaceKey: string,
		authorityClassId: string = HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.INTERACTIVE_OWNER,
		installedInstanceId = "primary",
	): HubAuthenticatedConnection {
		const template = HUB_DAEMON_CHAT_CONNECTION_POLICIES.find(
			(candidate) => candidate.authorityClassId === authorityClassId,
		);
		if (!template) throw new Error("Missing test authority policy.");
		const policy =
			template.allowedBindingProfileIds.length > 0
				? bindHubWorkspaceConnectionPolicyToInstalledInstance(
						template,
						installedInstanceId,
					)
				: template;
		return Object.freeze({
			connectionId: "connection-1",
			principalId: "owner-1",
			tenantId: "local",
			workspaceKey,
			workspaceEpoch: 0,
			policy,
			transport: "websocket",
			authenticatedAt: "2026-08-15T12:00:00.000Z",
		});
	}

	function resolver(root: string) {
		return createHubDaemonChatProfileResolver({
			workspaceRoot: root,
			resolveModelConfig: async () => ({
				providerId: "anthropic",
				modelId: "claude-test",
				apiKey: "daemon-secret",
			}),
			resolveSystemPrompt: async ({ profileId, mode }) =>
				`trusted:${profileId}:${mode}`,
		});
	}

	it("defines one versioned profile and one authority class per required surface", () => {
		const profileIds = Object.values(HUB_DAEMON_CHAT_PROFILE_IDS);
		const authorityClassIds = Object.values(
			HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS,
		);

		expect(profileIds).toHaveLength(10);
		expect(new Set(profileIds).size).toBe(profileIds.length);
		expect(authorityClassIds).toHaveLength(10);
		expect(new Set(authorityClassIds).size).toBe(authorityClassIds.length);
		expect(HUB_DAEMON_CHAT_CONNECTION_POLICIES).toHaveLength(10);
		expect(HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY).toEqual({
			authorityClassId: HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.INTERACTIVE_OWNER,
			audienceId: "aud_h2_interactive_owner_v1",
			policyEpoch: 2,
			allowedStartProfileIds: [HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE],
			allowedBindingProfileIds: [],
		});
	});

	it("binds start resolution to server-issued audience before credential lookup", async () => {
		const root = workspace();
		const resolveModelConfig = vi.fn(async () => ({
			providerId: "anthropic",
			modelId: "claude-test",
			apiKey: "daemon-secret",
		}));
		const profiles = createHubDaemonChatProfileResolver({
			workspaceRoot: root,
			resolveModelConfig,
			resolveSystemPrompt: async () => "trusted",
		});
		const owner = identity(root);

		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.ZEN,
				identity: owner,
				signal: new AbortController().signal,
				requested: {},
			}),
		).resolves.toBeUndefined();
		expect(resolveModelConfig).not.toHaveBeenCalled();

		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
				identity: owner,
				signal: new AbortController().signal,
				requested: { mode: "plan" },
			}),
		).resolves.toMatchObject({
			config: {
				providerId: "anthropic",
				modelId: "claude-test",
				mode: "plan",
				enableTools: true,
				enableSpawnAgent: true,
				enableAgentTeams: true,
			},
			interactive: true,
			profileRevision: 2,
			allowedModes: ["act", "plan", "yolo"],
			runtimeCapabilityManifest: {
				callbacks: ["tool_executor.askQuestion"],
			},
			toolPolicies: {
				"*": { enabled: false, autoApprove: false },
				read_files: { enabled: true, autoApprove: false },
				spawn_agent: { enabled: true, autoApprove: false },
			},
			source: "cline-managed-interactive",
		});
	});

	it("enforces fixed headless modes and interactivity per profile", async () => {
		const root = workspace();
		const profiles = resolver(root);
		const zen = identity(root, HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.ZEN);

		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.ZEN,
				identity: zen,
				signal: new AbortController().signal,
				requested: { mode: "act" },
			}),
		).resolves.toBeUndefined();
		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.ZEN,
				identity: zen,
				signal: new AbortController().signal,
				requested: { mode: "yolo", interactive: true },
			}),
		).resolves.toBeUndefined();
		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.ZEN,
				identity: zen,
				signal: new AbortController().signal,
				requested: {},
			}),
		).resolves.toMatchObject({
			config: { mode: "yolo", yolo: true },
			interactive: false,
			toolPolicies: {
				"*": { enabled: false, autoApprove: false },
				read_files: { enabled: true, autoApprove: true },
			},
		});
	});

	it("deeply snapshots daemon model configuration and denies future tools", async () => {
		const root = workspace();
		const retained = {
			providerId: "anthropic",
			modelId: "claude-test",
			headers: { "x-daemon": "original" },
			providerConfig: {
				providerId: "anthropic",
				modelId: "claude-test",
				headers: { "x-nested": "original" },
			},
		};
		const profiles = createHubDaemonChatProfileResolver({
			workspaceRoot: root,
			resolveModelConfig: async () => retained,
			resolveSystemPrompt: async () => "trusted",
		});
		const resolved = await profiles.resolveStartProfile({
			profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
			identity: identity(root),
			signal: new AbortController().signal,
			requested: {},
		});
		if (!resolved) throw new Error("missing resolved profile");

		retained.headers["x-daemon"] = "mutated";
		retained.providerConfig.headers["x-nested"] = "mutated";
		expect(resolved.config.headers).toEqual({ "x-daemon": "original" });
		expect(resolved.config.providerConfig?.headers).toEqual({
			"x-nested": "original",
		});
		expect(Object.isFrozen(resolved.config.headers)).toBe(true);
		expect(resolved.runtimeCapabilityManifest).toEqual({
			callbacks: ["tool_executor.askQuestion"],
		});
		expect(Object.isFrozen(resolved.runtimeCapabilityManifest)).toBe(true);
		expect(Object.isFrozen(resolved.runtimeCapabilityManifest?.callbacks)).toBe(
			true,
		);
		expect(resolved.toolPolicies).toMatchObject({
			"*": { enabled: false, autoApprove: false },
			read_files: { enabled: true, autoApprove: false },
		});
		expect(resolved.toolPolicies?.future_plugin_tool).toBeUndefined();
	});

	it("injects connector transport and rejects incomplete or cross-namespace binding", async () => {
		const root = workspace();
		const profiles = resolver(root);
		const slack = identity(
			root,
			HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_SLACK,
		);
		const signal = new AbortController().signal;

		expect(
			profiles.resolveBindingProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_SLACK,
				identity: slack,
				signal,
				requested: {
					instanceId: "primary",
					channelId: "C123",
					threadId: "slack:C123:1700000000.000001",
					participantScope: "all",
				},
			}),
		).toEqual({
			transport: "slack",
			instanceId: "slack:primary",
			channelId: "slack:C123",
			threadId: "slack:C123:1700000000.000001",
			participantScope: "all",
		});

		for (const requested of [
			{ instanceId: "primary", channelId: "C123" },
			{
				instanceId: "secondary",
				channelId: "C123",
				threadId: "slack:C123:1",
			},
			{
				instanceId: "primary",
				channelId: "discord:C123",
				threadId: "slack:C123:1",
			},
		]) {
			expect(
				profiles.resolveBindingProfile({
					profileId: HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_SLACK,
					identity: slack,
					signal,
					requested,
				}),
			).toBeUndefined();
		}
		expect(
			profiles.resolveBindingProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_DISCORD,
				identity: slack,
				signal,
				requested: {
					instanceId: "primary",
					channelId: "C123",
					threadId: "thread-1",
				},
			}),
		).toBeUndefined();
	});

	it("fails closed when daemon-owned credentials are unavailable", async () => {
		const root = workspace();
		const settingsManager = {
			getLastUsedProviderSettings: vi.fn(() => ({
				provider: "anthropic",
				model: "claude-test",
			})),
			getProviderSettings: vi.fn(() => ({
				provider: "anthropic",
				model: "claude-test",
			})),
			getProviderConfig: vi.fn(() => ({
				providerId: "anthropic",
				modelId: "claude-test",
			})),
		};
		const profiles = createHubDaemonChatProfileResolver({
			workspaceRoot: root,
			environment: {},
			providerSettingsManager: settingsManager,
			resolveSystemPrompt: async () => "trusted",
		});

		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
				identity: identity(root),
				signal: new AbortController().signal,
				requested: {},
			}),
		).resolves.toBeUndefined();
	});

	it("honors cancellation before profile work", async () => {
		const root = workspace();
		const resolveModelConfig = vi.fn(async () => ({
			providerId: "anthropic",
			modelId: "claude-test",
		}));
		const profiles = createHubDaemonChatProfileResolver({
			workspaceRoot: root,
			resolveModelConfig,
		});
		const controller = new AbortController();
		controller.abort(new Error("revoked"));

		await expect(
			profiles.resolveStartProfile({
				profileId: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
				identity: identity(root),
				signal: controller.signal,
				requested: {},
			}),
		).rejects.toThrow("revoked");
		expect(resolveModelConfig).not.toHaveBeenCalled();
	});
});
