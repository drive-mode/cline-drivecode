import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ITelemetryService } from "@cline/shared";
import { resolveDbDataDir } from "@cline/shared/storage";
import {
	issueChatCatalogAuthority,
	normalizeChatCatalogWorkspaceKey,
} from "../../chat-catalog/chat-catalog-authority";
import { LocalChatCatalogPort } from "../../chat-catalog/chat-catalog-port";
import { HubChatCatalogConfirmationBroker } from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import type { HubChatCatalogAuthorityRequest } from "../../chat-catalog/hub-chat-catalog-host";
import {
	ChatCatalogError,
	SqliteChatCatalogService,
} from "../../chat-catalog/sqlite-chat-catalog-service";
import type {
	HubWebSocketServerOptions,
	HubWorkspaceCatalogConfirmationRequest,
} from "../server/hub-server-options";
import {
	createHubWorkspaceManagedClineCoreFactory,
	type HubWorkspaceManagedProfileResolver,
} from "../server/workspace-managed-cline-core-factory";
import {
	createHubDaemonChatProfileResolver,
	HUB_DAEMON_CHAT_CONNECTION_POLICIES,
	HUB_DAEMON_CONNECTOR_AUTHORITY_CLASS_IDS,
	HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
	type HubDaemonChatProfileResolverOptions,
} from "./chat-management-profiles";

type ChatManagementServerOptions = Pick<
	HubWebSocketServerOptions,
	| "chatCatalog"
	| "workspaceAuthority"
	| "workspaceManagedCoreFactory"
	| "managedChatLifecycleEnabled"
>;

export interface HubDaemonChatManagementComposition {
	readonly serverOptions: ChatManagementServerOptions;
	dispose(): Promise<void>;
}

export interface HubDaemonChatManagementCompositionOptions {
	readonly workspaceRoot: string;
	readonly dataDir?: string;
	readonly telemetry?: ITelemetryService;
	/** Trusted test/embedding seam; production uses daemon-owned settings. */
	readonly profileResolver?: HubWorkspaceManagedProfileResolver;
	readonly profileResolverOptions?: Omit<
		HubDaemonChatProfileResolverOptions,
		"workspaceRoot" | "tenantId"
	>;
	/** Trusted owner-surface seam. Omission preserves headless default-deny. */
	readonly confirmCatalogMutation?: (
		request: HubWorkspaceCatalogConfirmationRequest,
	) => boolean | Promise<boolean>;
	readonly confirmationPromptTimeoutMs?: number;
}

/**
 * Builds the production daemon's managed-chat dependencies without enabling
 * managed routing. Opaque profile policy is composed but remains unreachable
 * until the single managed lifecycle release gate is enabled.
 */
export function createHubDaemonChatManagementComposition(
	options: HubDaemonChatManagementCompositionOptions,
): HubDaemonChatManagementComposition {
	const workspaceRoot = realpathSync(
		normalizeChatCatalogWorkspaceKey(options.workspaceRoot),
	);
	const dataDir = resolve(options.dataDir?.trim() || resolveDbDataDir());
	const catalog = new SqliteChatCatalogService({ dataDir, tenantId: "local" });
	catalog.init();
	const confirmationBroker = new HubChatCatalogConfirmationBroker();
	const port = new LocalChatCatalogPort({
		service: catalog,
		tenantId: "local",
	});
	let workspaceManagedCoreFactory: HubWebSocketServerOptions["workspaceManagedCoreFactory"];
	try {
		const profiles =
			options.profileResolver ??
			createHubDaemonChatProfileResolver({
				workspaceRoot,
				tenantId: "local",
				...options.profileResolverOptions,
			});
		workspaceManagedCoreFactory = createHubWorkspaceManagedClineCoreFactory({
			profiles,
			dataDirForScope: (scope) => {
				if (
					scope.tenantId !== "local" ||
					scope.workspaceKey !== workspaceRoot
				) {
					throw new ChatCatalogError(
						"unsupported_capability",
						"managed workspace scope is unavailable",
					);
				}
				return dataDir;
			},
			...(options.telemetry
				? { coreOptions: { telemetry: options.telemetry } }
				: {}),
		});
	} catch (error) {
		catalog.close();
		throw error;
	}
	let disposed = false;

	return Object.freeze({
		serverOptions: Object.freeze({
			chatCatalog: Object.freeze({
				port,
				confirmationBroker,
				dispose: async () => {
					if (disposed) return;
					disposed = true;
					catalog.close();
				},
				authorize: (request: HubChatCatalogAuthorityRequest) =>
					issueChatCatalogAuthority({
						principalId: request.authenticatedConnection.principalId,
						tenantId: request.authenticatedConnection.tenantId,
						workspaceKey: request.authenticatedConnection.workspaceKey,
						audienceId: request.authenticatedConnection.policy.audienceId,
						actorKind: "human",
						actorLabel: "Cline Hub owner",
						source: {
							kind: "hub",
							clientId: request.authenticatedClientId,
							transport: request.authenticatedConnection.transport,
						},
						confirmationGrants: request.confirmationGrant
							? [request.confirmationGrant]
							: [],
						mutationFence: request.mutationFence,
					}),
			}),
			workspaceAuthority: Object.freeze({
				trustedWorkspaceKeys: Object.freeze([workspaceRoot]),
				connectionPolicies: HUB_DAEMON_CHAT_CONNECTION_POLICIES,
				instanceBoundAuthorityClassIds:
					HUB_DAEMON_CONNECTOR_AUTHORITY_CLASS_IDS,
				defaultConnectionPolicy: HUB_DAEMON_DEFAULT_CHAT_CONNECTION_POLICY,
				confirmCatalogMutation: options.confirmCatalogMutation ?? (() => false),
				...(options.confirmationPromptTimeoutMs === undefined
					? {}
					: {
							confirmationPromptTimeoutMs: options.confirmationPromptTimeoutMs,
						}),
			}),
			workspaceManagedCoreFactory,
			managedChatLifecycleEnabled: false,
		}),
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			catalog.close();
		},
	});
}
