import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import * as Llms from "@cline/llms";
import {
	buildClineSystemPrompt,
	type HubChatLifecycleStartProfile,
} from "@cline/shared";
import { toProviderConfig } from "../../services/llms/provider-settings";
import { getProviderConfigFields } from "../../services/providers/provider-config-fields";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { buildWorkspaceMetadata } from "../../services/workspace/workspace-manifest";
import type { ClineCoreStartConfig } from "../../types/config";
import type { ProviderSettings } from "../../types/provider-settings";
import type { HubWorkspaceConnectionPolicy } from "../server/workspace-capability-authority";
import type {
	HubWorkspaceManagedProfileResolver,
	HubWorkspaceManagedResolvedStartProfile,
} from "../server/workspace-managed-cline-core-factory";
import {
	HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
	type HubManagedRuntimeCallbackCapabilityName,
} from "../server/workspace-managed-runtime-capabilities";

export const HUB_DAEMON_CHAT_PROFILE_IDS = Object.freeze({
	INTERACTIVE: "cline.chat.interactive.v1",
	CONNECTOR_DISCORD: "cline.chat.connector.discord.v1",
	CONNECTOR_GCHAT: "cline.chat.connector.gchat.v1",
	CONNECTOR_LINEAR: "cline.chat.connector.linear.v1",
	CONNECTOR_SLACK: "cline.chat.connector.slack.v1",
	CONNECTOR_TELEGRAM: "cline.chat.connector.telegram.v1",
	CONNECTOR_WHATSAPP: "cline.chat.connector.whatsapp.v1",
	ACP: "cline.chat.acp.v1",
	ZEN: "cline.chat.zen.v1",
	AUTOMATION: "cline.chat.automation.v1",
} as const);

export type HubDaemonChatProfileId =
	(typeof HUB_DAEMON_CHAT_PROFILE_IDS)[keyof typeof HUB_DAEMON_CHAT_PROFILE_IDS];

export const HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS = Object.freeze({
	INTERACTIVE_OWNER: "cline.chat.authority.interactive-owner.v1",
	CONNECTOR_DISCORD: "cline.chat.authority.connector.discord.v1",
	CONNECTOR_GCHAT: "cline.chat.authority.connector.gchat.v1",
	CONNECTOR_LINEAR: "cline.chat.authority.connector.linear.v1",
	CONNECTOR_SLACK: "cline.chat.authority.connector.slack.v1",
	CONNECTOR_TELEGRAM: "cline.chat.authority.connector.telegram.v1",
	CONNECTOR_WHATSAPP: "cline.chat.authority.connector.whatsapp.v1",
	ACP: "cline.chat.authority.acp.v1",
	ZEN: "cline.chat.authority.zen.v1",
	AUTOMATION: "cline.chat.authority.automation.v1",
} as const);

/** Connector classes whose grants must be bound to one installed instance. */
export const HUB_DAEMON_CONNECTOR_AUTHORITY_CLASS_IDS = Object.freeze([
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_DISCORD,
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_GCHAT,
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_LINEAR,
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_SLACK,
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_TELEGRAM,
	HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_WHATSAPP,
] as const);

const policy = (
	authorityClassId: string,
	audienceId: string,
	startProfileId: HubDaemonChatProfileId,
	bindingProfileId?: HubDaemonChatProfileId,
	policyEpoch = 1,
): HubWorkspaceConnectionPolicy =>
	Object.freeze({
		authorityClassId,
		audienceId,
		policyEpoch,
		allowedStartProfileIds: Object.freeze([startProfileId]),
		allowedBindingProfileIds: Object.freeze(
			bindingProfileId ? [bindingProfileId] : [],
		),
	});

/** Closed server-owned audience registry. Only INTERACTIVE_OWNER is public. */
export const HUB_DAEMON_CHAT_CONNECTION_POLICIES = Object.freeze([
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.INTERACTIVE_OWNER,
		"aud_h2_interactive_owner_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
		undefined,
		2,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_DISCORD,
		"aud_h2_connector_discord_bootstrap_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_DISCORD,
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_DISCORD,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_GCHAT,
		"aud_h2_connector_gchat_bootstrap_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_GCHAT,
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_GCHAT,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_LINEAR,
		"aud_h2_connector_linear_bootstrap_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_LINEAR,
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_LINEAR,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_SLACK,
		"aud_h2_connector_slack_bootstrap_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_SLACK,
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_SLACK,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_TELEGRAM,
		"aud_h2_connector_telegram_bootstrap_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_TELEGRAM,
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_TELEGRAM,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.CONNECTOR_WHATSAPP,
		"aud_h2_connector_whatsapp_bootstrap_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_WHATSAPP,
		HUB_DAEMON_CHAT_PROFILE_IDS.CONNECTOR_WHATSAPP,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.ACP,
		"aud_h2_acp_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.ACP,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.ZEN,
		"aud_h2_zen_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.ZEN,
	),
	policy(
		HUB_DAEMON_CHAT_AUTHORITY_CLASS_IDS.AUTOMATION,
		"aud_h2_automation_v1",
		HUB_DAEMON_CHAT_PROFILE_IDS.AUTOMATION,
	),
]);

function requiredConnectionPolicy(
	value: HubWorkspaceConnectionPolicy | undefined,
): HubWorkspaceConnectionPolicy {
	if (!value) throw new Error("interactive chat connection policy is missing");
	return value;
}

export const HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY =
	requiredConnectionPolicy(HUB_DAEMON_CHAT_CONNECTION_POLICIES[0]);

const CONNECTOR_NAMESPACES = Object.freeze([
	"discord",
	"gchat",
	"linear",
	"slack",
	"telegram",
	"whatsapp",
] as const);

type ConnectorNamespace = (typeof CONNECTOR_NAMESPACES)[number];
type ManagedMode = NonNullable<HubChatLifecycleStartProfile["mode"]>;

interface StartProfilePolicy {
	readonly id: HubDaemonChatProfileId;
	readonly profileRevision: number;
	readonly kind: "interactive" | "connector" | "acp" | "zen" | "automation";
	readonly source: string;
	readonly defaultMode: ManagedMode;
	readonly allowedModes: ReadonlySet<ManagedMode>;
	readonly defaultInteractive: boolean;
	readonly allowInteractiveOverride: boolean;
	readonly enableTools: boolean;
	readonly enableSpawnAgent: boolean;
	readonly enableAgentTeams: boolean;
	readonly disableMcpSettingsTools: boolean;
	readonly toolPolicies: Readonly<
		Record<string, Readonly<{ enabled: boolean; autoApprove: boolean }>>
	>;
	readonly runtimeCallbacks: readonly HubManagedRuntimeCallbackCapabilityName[];
	readonly connector?: ConnectorNamespace;
}

const BASE_MANAGED_TOOL_NAMES = Object.freeze([
	"read_files",
	"search_codebase",
	"run_commands",
	"fetch_web_content",
	"apply_patch",
	"editor",
	"skills",
	"ask_question",
	"report_status",
	"submit_and_exit",
] as const);
const SPAWN_TOOL_NAMES = Object.freeze(["spawn_agent"] as const);
const TEAM_TOOL_NAMES = Object.freeze([
	"team_spawn_teammate",
	"team_shutdown_teammate",
	"team_status",
	"team_task",
	"team_run_task",
	"team_cancel_run",
	"team_list_runs",
	"team_await_runs",
	"team_send_message",
	"team_broadcast",
	"team_read_mailbox",
	"team_mission_log",
	"team_cleanup",
	"team_create_outcome",
	"team_attach_outcome_fragment",
	"team_review_outcome_fragment",
	"team_finalize_outcome",
	"team_list_outcomes",
] as const);

function closedToolPolicy(
	allowed: readonly string[],
	autoApprove: boolean,
): StartProfilePolicy["toolPolicies"] {
	return Object.freeze(
		Object.fromEntries([
			["*", Object.freeze({ enabled: false, autoApprove: false })],
			...allowed.map(
				(name) =>
					[name, Object.freeze({ enabled: true, autoApprove })] as const,
			),
		]),
	);
}

const REQUIRE_TOOL_APPROVAL = closedToolPolicy(
	[...BASE_MANAGED_TOOL_NAMES, ...SPAWN_TOOL_NAMES, ...TEAM_TOOL_NAMES],
	false,
);
const AUTO_APPROVE_TOOLS = closedToolPolicy(BASE_MANAGED_TOOL_NAMES, true);
const DISABLE_TOOLS = Object.freeze({
	"*": Object.freeze({ enabled: false, autoApprove: false }),
});

function modes(...values: ManagedMode[]): ReadonlySet<ManagedMode> {
	return new Set(values);
}

const START_PROFILE_POLICIES = Object.freeze([
	{
		id: HUB_DAEMON_CHAT_PROFILE_IDS.INTERACTIVE,
		profileRevision: 2,
		kind: "interactive",
		source: "cline-managed-interactive",
		defaultMode: "act",
		allowedModes: modes("act", "plan", "yolo"),
		defaultInteractive: true,
		allowInteractiveOverride: true,
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		disableMcpSettingsTools: false,
		toolPolicies: REQUIRE_TOOL_APPROVAL,
		runtimeCallbacks: Object.freeze([
			HUB_MANAGED_RUNTIME_ASK_QUESTION_CAPABILITY,
		]),
	},
	...CONNECTOR_NAMESPACES.map((connector) => ({
		id: HUB_DAEMON_CHAT_PROFILE_IDS[
			`CONNECTOR_${connector.toUpperCase()}` as keyof typeof HUB_DAEMON_CHAT_PROFILE_IDS
		] as HubDaemonChatProfileId,
		profileRevision: 1,
		kind: "connector" as const,
		source: `cline-managed-connector-${connector}`,
		defaultMode: "act" as const,
		allowedModes: modes("act", "plan"),
		defaultInteractive: false,
		allowInteractiveOverride: false,
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		disableMcpSettingsTools: true,
		toolPolicies: REQUIRE_TOOL_APPROVAL,
		runtimeCallbacks: Object.freeze([]),
		connector,
	})),
	{
		id: HUB_DAEMON_CHAT_PROFILE_IDS.ACP,
		profileRevision: 1,
		kind: "acp",
		source: "cline-managed-acp",
		defaultMode: "act",
		allowedModes: modes("act", "plan"),
		defaultInteractive: true,
		allowInteractiveOverride: false,
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: false,
		disableMcpSettingsTools: false,
		toolPolicies: REQUIRE_TOOL_APPROVAL,
		runtimeCallbacks: Object.freeze([]),
	},
	{
		id: HUB_DAEMON_CHAT_PROFILE_IDS.ZEN,
		profileRevision: 1,
		kind: "zen",
		source: "cline-managed-zen",
		defaultMode: "yolo",
		allowedModes: modes("yolo"),
		defaultInteractive: false,
		allowInteractiveOverride: false,
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		disableMcpSettingsTools: true,
		toolPolicies: AUTO_APPROVE_TOOLS,
		runtimeCallbacks: Object.freeze([]),
	},
	{
		id: HUB_DAEMON_CHAT_PROFILE_IDS.AUTOMATION,
		profileRevision: 1,
		kind: "automation",
		source: "cline-managed-automation",
		defaultMode: "act",
		allowedModes: modes("act", "plan"),
		defaultInteractive: false,
		allowInteractiveOverride: false,
		enableTools: false,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		disableMcpSettingsTools: true,
		toolPolicies: DISABLE_TOOLS,
		runtimeCallbacks: Object.freeze([]),
	},
] satisfies readonly StartProfilePolicy[]);

const START_PROFILE_POLICY_BY_ID = new Map<
	HubDaemonChatProfileId,
	StartProfilePolicy
>(START_PROFILE_POLICIES.map((profile) => [profile.id, profile] as const));

export interface HubDaemonManagedModelConfig {
	readonly providerId: string;
	readonly modelId: string;
	readonly apiKey?: string;
	readonly baseUrl?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly providerConfig?: ClineCoreStartConfig["providerConfig"];
	readonly thinking?: boolean;
	readonly reasoningEffort?: ClineCoreStartConfig["reasoningEffort"];
	readonly thinkingBudgetTokens?: number;
}

export interface HubDaemonChatProfileResolverOptions {
	readonly workspaceRoot: string;
	readonly tenantId?: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly providerSettingsManager?: Pick<
		ProviderSettingsManager,
		"getLastUsedProviderSettings" | "getProviderSettings" | "getProviderConfig"
	>;
	readonly resolveModelConfig?: (
		input: Readonly<{
			profileId: HubDaemonChatProfileId;
			signal: AbortSignal;
		}>,
	) =>
		| HubDaemonManagedModelConfig
		| undefined
		| Promise<HubDaemonManagedModelConfig | undefined>;
	readonly resolveSystemPrompt?: (
		input: Readonly<{
			workspaceRoot: string;
			profileId: HubDaemonChatProfileId;
			providerId: string;
			mode: ManagedMode;
			signal: AbortSignal;
		}>,
	) => string | Promise<string>;
}

function text(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
	if (!value || typeof value !== "object" || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value as Record<string, unknown>)) {
		deepFreeze(child, seen);
	}
	return Object.freeze(value);
}

function snapshotData<T>(value: T): T | undefined {
	try {
		return deepFreeze(structuredClone(value));
	} catch {
		return undefined;
	}
}

function hasStoredProviderAuthority(
	providerId: string,
	settings: ProviderSettings | undefined,
	config: NonNullable<ReturnType<ProviderSettingsManager["getProviderConfig"]>>,
	environment: Readonly<Record<string, string | undefined>>,
	environmentCredential: string | undefined,
): boolean {
	if (
		environmentCredential ||
		text(config.apiKey) ||
		text(config.accessToken) ||
		text(config.refreshToken)
	) {
		return true;
	}
	const normalizedProviderId = Llms.normalizeProviderId(providerId);
	if (getProviderConfigFields(normalizedProviderId).authMethod === "local") {
		return true;
	}
	if (normalizedProviderId === "bedrock") {
		const region = text(
			settings?.aws?.region ??
				settings?.region ??
				environment.AWS_REGION ??
				environment.AWS_DEFAULT_REGION,
		);
		const hasCredentials = Boolean(
			settings?.aws?.authentication === "iam" ||
				text(settings?.aws?.profile) ||
				text(environment.AWS_PROFILE) ||
				(text(settings?.aws?.accessKey) && text(settings?.aws?.secretKey)) ||
				(text(environment.AWS_ACCESS_KEY_ID) &&
					text(environment.AWS_SECRET_ACCESS_KEY)),
		);
		return Boolean(region && hasCredentials);
	}
	if (normalizedProviderId === "vertex") {
		return Boolean(
			text(settings?.gcp?.projectId) ||
				text(environment.GOOGLE_CLOUD_PROJECT) ||
				text(environment.GCLOUD_PROJECT),
		);
	}
	if (normalizedProviderId === "azure") {
		return settings?.azure?.useIdentity === true;
	}
	if (normalizedProviderId === "sapaicore") {
		return Boolean(
			text(settings?.sap?.clientId) &&
				text(settings?.sap?.clientSecret) &&
				text(settings?.sap?.tokenUrl) &&
				text(settings?.baseUrl),
		);
	}
	const fields = getProviderConfigFields(normalizedProviderId).fields;
	return Boolean(
		fields.baseUrl && text(config.baseUrl) && text(config.modelId),
	);
}

function createDefaultModelResolver(
	options: HubDaemonChatProfileResolverOptions,
): NonNullable<HubDaemonChatProfileResolverOptions["resolveModelConfig"]> {
	const environment = options.environment ?? process.env;
	let settingsManager = options.providerSettingsManager;
	return async ({ profileId: _profileId, signal }) => {
		signal.throwIfAborted();
		settingsManager ??= new ProviderSettingsManager();
		const lastUsed = settingsManager.getLastUsedProviderSettings({
			isClinePassEnabled: true,
		});
		const providerId = Llms.normalizeProviderId(
			text(environment.CLINE_PROVIDER) ?? lastUsed?.provider ?? "cline",
		);
		const settings = settingsManager.getProviderSettings(providerId);
		const storedConfig = settingsManager.getProviderConfig(providerId, {
			includeKnownModels: false,
		});
		const baseConfig =
			storedConfig ??
			toProviderConfig(
				{
					provider: providerId,
					...(text(environment.CLINE_MODEL)
						? { model: text(environment.CLINE_MODEL) }
						: {}),
				},
				{ includeKnownModels: false },
			);
		const providerCollection = await Llms.getProviderCollection(providerId);
		signal.throwIfAborted();
		const environmentCredential =
			text(environment.CLINE_API_KEY) ??
			providerCollection?.provider.env
				?.map((key) => text(environment[key]))
				.find(Boolean);
		const providerConfig = Object.freeze({
			...baseConfig,
			modelId: text(environment.CLINE_MODEL) ?? baseConfig.modelId,
			...(environmentCredential ? { apiKey: environmentCredential } : {}),
		});
		if (
			!hasStoredProviderAuthority(
				providerId,
				settings,
				providerConfig,
				environment,
				environmentCredential,
			)
		) {
			return undefined;
		}
		return Object.freeze({
			providerId,
			modelId: providerConfig.modelId,
			...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
			...(providerConfig.baseUrl ? { baseUrl: providerConfig.baseUrl } : {}),
			...(providerConfig.headers ? { headers: providerConfig.headers } : {}),
			providerConfig,
			...(providerConfig.thinking === undefined
				? {}
				: { thinking: providerConfig.thinking }),
			...(providerConfig.reasoningEffort
				? { reasoningEffort: providerConfig.reasoningEffort }
				: {}),
			...(providerConfig.thinkingBudgetTokens
				? { thinkingBudgetTokens: providerConfig.thinkingBudgetTokens }
				: {}),
		});
	};
}

async function defaultSystemPrompt(
	input: Readonly<{
		workspaceRoot: string;
		providerId: string;
		mode: ManagedMode;
		signal: AbortSignal;
	}>,
): Promise<string> {
	const metadata = await buildWorkspaceMetadata(input.workspaceRoot);
	input.signal.throwIfAborted();
	return buildClineSystemPrompt({
		ide: "Cline Hub",
		workspaceRoot: input.workspaceRoot,
		workspaceName: basename(input.workspaceRoot),
		metadata,
		mode: input.mode,
		providerId: input.providerId,
		platform: process.platform,
	});
}

function normalizedBindingValue(
	value: string | undefined,
	connector: ConnectorNamespace,
): string | undefined {
	const normalized = text(value);
	if (!normalized) return undefined;
	const prefix = /^([a-z][a-z0-9-]*):/i.exec(normalized)?.[1]?.toLowerCase();
	if (prefix && CONNECTOR_NAMESPACES.includes(prefix as ConnectorNamespace)) {
		return prefix === connector ? normalized : undefined;
	}
	return `${connector}:${normalized}`;
}

/**
 * Creates the daemon-owned profile authority. Profile IDs select fixed host
 * policy; callers never submit model credentials, transport names, or tool
 * policy. Unavailable credentials and policy mismatches are indistinguishable
 * from an unknown profile at the wire boundary.
 */
export function createHubDaemonChatProfileResolver(
	options: HubDaemonChatProfileResolverOptions,
): HubWorkspaceManagedProfileResolver {
	const workspaceRoot = realpathSync(resolve(options.workspaceRoot));
	const tenantId = text(options.tenantId) ?? "local";
	const resolveModelConfig =
		options.resolveModelConfig ?? createDefaultModelResolver(options);
	const resolveSystemPrompt =
		options.resolveSystemPrompt ?? defaultSystemPrompt;

	const resolver: HubWorkspaceManagedProfileResolver = {
		resolveStartProfile: async (input) => {
			input.signal.throwIfAborted();
			const policy = START_PROFILE_POLICY_BY_ID.get(
				input.profileId as HubDaemonChatProfileId,
			);
			if (
				!policy ||
				!input.identity.policy.allowedStartProfileIds.includes(
					input.profileId,
				) ||
				input.identity.workspaceKey !== workspaceRoot ||
				input.identity.tenantId !== tenantId
			) {
				return undefined;
			}
			const mode = input.requested.mode ?? policy.defaultMode;
			if (!policy.allowedModes.has(mode)) return undefined;
			if (
				!policy.allowInteractiveOverride &&
				input.requested.interactive !== undefined &&
				input.requested.interactive !== policy.defaultInteractive
			) {
				return undefined;
			}
			const resolvedModel = await resolveModelConfig({
				profileId: policy.id,
				signal: input.signal,
			});
			input.signal.throwIfAborted();
			const model = resolvedModel ? snapshotData(resolvedModel) : undefined;
			if (!model || !text(model.providerId) || !text(model.modelId)) {
				return undefined;
			}
			const systemPrompt = await resolveSystemPrompt({
				workspaceRoot,
				profileId: policy.id,
				providerId: model.providerId,
				mode,
				signal: input.signal,
			});
			input.signal.throwIfAborted();
			if (!text(systemPrompt)) return undefined;

			const config = snapshotData<ClineCoreStartConfig>({
				...model,
				systemPrompt,
				mode,
				enableTools: policy.enableTools,
				enableSpawnAgent: policy.enableSpawnAgent,
				enableAgentTeams: policy.enableAgentTeams,
				disableMcpSettingsTools: policy.disableMcpSettingsTools,
				yolo: mode === "yolo",
			});
			if (!config) return undefined;
			return deepFreeze({
				config,
				interactive: policy.defaultInteractive,
				profileRevision: policy.profileRevision,
				allowedModes: Object.freeze([...policy.allowedModes]),
				toolPolicies: policy.toolPolicies,
				...(policy.runtimeCallbacks.length > 0
					? {
							runtimeCapabilityManifest: Object.freeze({
								callbacks: Object.freeze([...policy.runtimeCallbacks]),
							}),
						}
					: {}),
				source: policy.source,
				sessionMetadata: Object.freeze({
					managedProfileId: policy.id,
					managedProfileKind: policy.kind,
				}),
			}) satisfies HubWorkspaceManagedResolvedStartProfile;
		},
		resolveBindingProfile: (input) => {
			input.signal.throwIfAborted();
			const policy = START_PROFILE_POLICY_BY_ID.get(
				input.profileId as HubDaemonChatProfileId,
			);
			if (
				!policy?.connector ||
				!input.identity.policy.allowedBindingProfileIds.includes(
					input.profileId,
				) ||
				input.identity.workspaceKey !== workspaceRoot ||
				input.identity.tenantId !== tenantId
			) {
				return undefined;
			}
			const instanceId = normalizedBindingValue(
				input.requested.instanceId,
				policy.connector,
			);
			const installedInstanceId = normalizedBindingValue(
				input.identity.policy.installedInstanceId,
				policy.connector,
			);
			const channelId = normalizedBindingValue(
				input.requested.channelId,
				policy.connector,
			);
			const threadId = normalizedBindingValue(
				input.requested.threadId,
				policy.connector,
			);
			if (
				!instanceId ||
				instanceId !== installedInstanceId ||
				!channelId ||
				!threadId
			) {
				return undefined;
			}
			return Object.freeze({
				transport: policy.connector,
				instanceId,
				channelId,
				threadId,
				...(text(input.requested.participantScope)
					? { participantScope: text(input.requested.participantScope) }
					: {}),
			});
		},
	};
	return Object.freeze(resolver);
}
