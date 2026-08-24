import type {
	BasicLogger,
	ITelemetryService,
	ResourcePolicyOverrides,
	ResourcePolicyProfile,
} from "@cline/shared";
import type { ChatCatalogConfirmationGrant } from "../../chat-catalog/chat-catalog-authority";
import type { HubChatCatalogConfirmationTarget } from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import type { HubChatCatalogHost } from "../../chat-catalog/hub-chat-catalog-host";
import type { CronServiceOptions } from "../../cron/service/cron-service";
import type {
	HubScheduleRuntimeHandlers,
	HubScheduleServiceOptions,
} from "../../cron/service/schedule-service";
import type {
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import type { CoreSettingsService } from "../../settings";
import type { HubOwnerContext } from "../discovery";
import type { BoundedOutboundChannelOptions } from "./bounded-outbound-channel";
import type {
	HubWorkspaceCapabilityGrant,
	HubWorkspaceConnectionPolicy,
} from "./workspace-capability-authority";
import type { HubWorkspaceRegistration } from "./workspace-capability-registry";
import type { HubWorkspaceManagedCoreFactory } from "./workspace-managed-core-pool";

export interface HubWorkspaceAuthorityOptions {
	/** Trusted startup-only paths. No network request may add to this set. */
	readonly trustedWorkspaceKeys: readonly string[];
	/** Closed server-owned caller audiences available to trusted issuers. */
	readonly connectionPolicies?: readonly HubWorkspaceConnectionPolicy[];
	/** Classes whose trusted grants must be bound to one installed instance. */
	readonly instanceBoundAuthorityClassIds?: readonly string[];
	/** Selector-free owner endpoint always issues this policy. */
	readonly defaultConnectionPolicy?: HubWorkspaceConnectionPolicy;
	/**
	 * Trusted host UI seam. The callback must return true only after a human
	 * observes and confirms the exact frozen target. No workspace path is exposed.
	 */
	readonly confirmCatalogMutation?: (
		request: HubWorkspaceCatalogConfirmationRequest,
	) => boolean | Promise<boolean>;
	/** Bounded time allowed for the trusted human prompt. */
	readonly confirmationPromptTimeoutMs?: number;
}

export interface HubWorkspaceConnectionDescriptor {
	readonly connectionId: string;
	readonly principalId: string;
	readonly tenantId: string;
	readonly workspaceId: string;
	readonly workspaceEpoch: number;
	readonly authorityClassId: string;
	readonly policyEpoch: number;
	readonly authenticatedAt: string;
}

export type HubWorkspaceCatalogConfirmationDisplayTarget = Omit<
	HubChatCatalogConfirmationTarget,
	"invocationId"
>;

export interface HubWorkspaceCatalogConfirmationRequest {
	/** Pathless, authority-free display data. Correlation remains server-side. */
	readonly target: HubWorkspaceCatalogConfirmationDisplayTarget;
	readonly signal: AbortSignal;
}

export interface HubWorkspaceAuthorityControl {
	list(): readonly HubWorkspaceRegistration[];
	listConnections(): readonly HubWorkspaceConnectionDescriptor[];
	issue(input: {
		workspaceId: string;
		ttlMs?: number;
		/** Trusted in-process selection; never accepted by the HTTP endpoint. */
		authorityClassId?: string;
	}): HubWorkspaceCapabilityGrant;
	issueForInstalledInstance(input: {
		workspaceId: string;
		authorityClassId: string;
		installedInstanceId: string;
		ttlMs?: number;
	}): HubWorkspaceCapabilityGrant;
	requestCatalogConfirmation(input: {
		connectionId: string;
		target: HubChatCatalogConfirmationTarget;
		ttlMs?: number;
	}): Promise<ChatCatalogConfirmationGrant>;
	revoke(workspaceId: string): Promise<void>;
	unregister(workspaceId: string): Promise<void>;
}

export interface HubWebSocketServerOptions {
	host?: string;
	port?: number;
	pathname?: string;
	owner?: HubOwnerContext;
	maxInboundPayloadBytes?: number;
	websocketDelivery?: BoundedOutboundChannelOptions;
	resourcePolicy?: ResourcePolicyOverrides | ResourcePolicyProfile;
	sessionHost?: RuntimeHost & Partial<PendingPromptsRuntimeService>;
	settingsService?: CoreSettingsService;
	/**
	 * Explicit ChatCatalog authority. When omitted, every chat_catalog.* command
	 * fails closed with unsupported_capability.
	 */
	chatCatalog?: HubChatCatalogHost;
	/**
	 * Optional trusted workspace enrollment for in-process capability issuance.
	 * When exactly one workspace is enrolled, the owner-authenticated local
	 * control endpoint may mint a selector-free one-time socket capability.
	 * This does not advertise either managed chat capability.
	 */
	workspaceAuthority?: HubWorkspaceAuthorityOptions;
	/**
	 * Trusted managed-Core construction for authenticated workspace scope. Raw
	 * session/run commands are denied on scoped sockets when the release gate is
	 * enabled.
	 */
	workspaceManagedCoreFactory?: HubWorkspaceManagedCoreFactory;
	/**
	 * Explicit release gate for managed lifecycle routing, subscriptions, and
	 * capability advertisement. A configured factory alone remains inert.
	 */
	managedChatLifecycleEnabled?: boolean;
	runtimeHandlers: HubScheduleRuntimeHandlers;
	scheduleOptions?: Omit<HubScheduleServiceOptions, "runtimeHandlers">;
	/**
	 * File-based cron automation options. When provided, the hub starts a
	 * `CronService` that watches global `~/.cline/cron/` by default, reconciles
	 * specs into `cron.db`, and executes queued runs through `runtimeHandlers`.
	 * Pass `cronOptions.specs` to use a different source, including future
	 * workspace-scoped specs.
	 */
	cronOptions?: Omit<CronServiceOptions, "runtimeHandlers">;
	/**
	 * Custom `fetch` implementation forwarded to the internally-constructed
	 * `LocalRuntimeHost` that executes incoming `session.create` traffic.
	 * Used by the AI gateway providers for every session that runs inside
	 * this hub process.
	 *
	 * Ignored when `sessionHost` is supplied — in that case the caller owns
	 * runtime construction and is responsible for wiring its own fetch.
	 */
	fetch?: typeof fetch;
	/**
	 * Telemetry forwarded to the internally-constructed `LocalRuntimeHost`.
	 * Ignored when `sessionHost` is supplied.
	 */
	telemetry?: ITelemetryService;
	/**
	 * Structured logger forwarded to the internally-constructed local runtime.
	 * Ignored when `sessionHost` is supplied.
	 */
	logger?: BasicLogger;
}

export interface HubWebSocketServer {
	host: string;
	port: number;
	url: string;
	authToken: string;
	/** Present only for exactly one trusted startup workspace. */
	workspaceScopeId?: string;
	/** Present only when trusted startup workspace enrollment was configured. */
	workspaceAuthority?: HubWorkspaceAuthorityControl;
	close(): Promise<void>;
}

export interface EnsureHubWebSocketServerOptions
	extends HubWebSocketServerOptions {
	allowPortFallback?: boolean;
}

export interface EnsuredHubWebSocketServerResult {
	server?: HubWebSocketServer;
	url: string;
	authToken?: string;
	action: "reuse" | "started";
}
