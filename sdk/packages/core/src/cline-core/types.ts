import type { Message } from "@cline/llms";
import type {
	AgentConfig,
	AgentResult,
	AutomationEventEnvelope,
	BasicLogger,
	ChatBindingRecord,
	ChatDetail,
	ChatMutationSourceKind,
	ITelemetryService,
	ResourcePolicyOverrides,
	ResourcePolicyProfile,
} from "@cline/shared";
import type { ChatCatalogMutationFence } from "../chat-catalog/chat-catalog-authority";
import type { ChatAudienceMigrationMapping } from "../chat-catalog/sqlite-chat-catalog-service";
import type { CronEventSuppression } from "../cron/events/cron-event-ingress";
import type {
	CronEventLogRecord,
	CronRunRecord,
	CronSpecRecord,
} from "../cron/store/sqlite-cron-store";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import type { SessionHistoryListOptions } from "../runtime/host/history";
import type { SessionBackend } from "../runtime/host/host";
import type {
	LocalRuntimeStartOptions,
	RuntimeHostMode,
	SendSessionInput,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/host/runtime-host";
import type { FeatureFlagsService } from "../services/feature-flags";
import type { CheckpointWorkspaceCompareResult } from "../session/checkpoint-diff";
import type { ClineCoreStartConfig } from "../types/config";
import type { SessionMessagesArtifactUploader } from "../types/session";

export type { RuntimeHostMode } from "../runtime/host/runtime-host";
export type { ClineCoreSettingsApi } from "../settings";

export interface HubOptions {
	endpoint?: string;
	authToken?: string;
	strategy?: "prefer-hub" | "require-hub";
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
}

export interface RemoteOptions {
	endpoint: string;
	authToken?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
}

export interface ClineCoreAutomationOptions {
	/** @deprecated Use `cronSpecsDir`. */
	cronDir?: string;
	cronSpecsDir?: string;
	/** @deprecated Reports are written under the resolved cron specs directory. */
	reportsDir?: string;
	cronScope?: "global" | "user" | "workspace";
	workspaceRoot?: string;
	dbPath?: string;
	pollIntervalMs?: number;
	claimLeaseSeconds?: number;
	globalMaxConcurrency?: number;
	watcherDebounceMs?: number;
	autoStart?: boolean;
}

export type ClineAutomationSpec = CronSpecRecord;
export type ClineAutomationRun = CronRunRecord;
export type ClineAutomationEventLog = CronEventLogRecord;
export type ClineAutomationEventSuppression = CronEventSuppression;
export type ClineAutomationRunStatus =
	| "queued"
	| "running"
	| "done"
	| "failed"
	| "cancelled";

export interface ClineAutomationListSpecsOptions {
	triggerKind?: "one_off" | "schedule" | "event";
	enabled?: boolean;
	parseStatus?: "valid" | "invalid";
	includeRemoved?: boolean;
	limit?: number;
}

export interface ClineAutomationListRunsOptions {
	specId?: string;
	status?: ClineAutomationRunStatus | ClineAutomationRunStatus[];
	limit?: number;
}

export interface ClineAutomationListEventsOptions {
	eventType?: string;
	source?: string;
	processingStatus?:
		| "received"
		| "unmatched"
		| "queued"
		| "suppressed"
		| "failed";
	limit?: number;
}

export interface ClineAutomationEventIngressResult {
	event: ClineAutomationEventLog;
	duplicate: boolean;
	matchedSpecIds: string[];
	queuedRuns: ClineAutomationRun[];
	suppressions: ClineAutomationEventSuppression[];
}

export interface ClineCoreAutomationApi {
	start(): Promise<void>;
	stop(): Promise<void>;
	reconcileNow(): Promise<void>;
	ingestEvent(
		event: AutomationEventEnvelope,
	): ClineAutomationEventIngressResult;
	listEvents(
		options?: ClineAutomationListEventsOptions,
	): ClineAutomationEventLog[];
	getEvent(eventId: string): ClineAutomationEventLog | undefined;
	listSpecs(options?: ClineAutomationListSpecsOptions): ClineAutomationSpec[];
	listRuns(options?: ClineAutomationListRunsOptions): ClineAutomationRun[];
}

export type ClineCoreListHistoryOptions = SessionHistoryListOptions;

export interface ClineCoreStartInput
	extends Omit<StartSessionInput, "config" | "localRuntime"> {
	config: ClineCoreStartConfig;
	localRuntime?: LocalRuntimeStartOptions;
}

export interface ClineCoreChatLifecycleStartResult {
	startResult: StartSessionResult;
	turnResult?: AgentResult;
	chatId: string;
	leaseRevision: number;
	writerGeneration: number;
	leaseExpiresAt: string;
}

export type ClineCoreManagedStartInput = Omit<
	ClineCoreStartInput,
	"writerLease"
>;

export interface ClineCoreChatLifecycleStartRootInput {
	/** Stable across retries of one user-visible fresh-start operation. */
	operationId: string;
	/** Stable across retries; Core never regenerates it from ambient state. */
	sessionId: string;
	chatId?: string;
	title?: string;
	titleSource?: string;
	leaseTtlMs?: number;
	startInput: ClineCoreManagedStartInput;
}

interface ClineCoreChatLifecycleStartRelatedBase {
	/** Stable across retries of one user-visible derived-start operation. */
	operationId: string;
	/** Stable across retries; Core never regenerates it from ambient state. */
	sessionId: string;
	chatId: string;
	parentSessionId: string;
	title?: string;
	titleSource?: string;
	leaseTtlMs?: number;
	startInput: ClineCoreManagedStartInput;
}

export type ClineCoreChatLifecycleStartRelatedInput =
	ClineCoreChatLifecycleStartRelatedBase &
		(
			| {
					relationKind: "fork" | "checkpoint_restore";
					expectedRevision?: never;
			  }
			| {
					relationKind: "config_restart" | "recovery";
					expectedRevision: number;
			  }
		);

export interface ClineCoreChatLifecycleRestoreCheckpointInput {
	/** Stable across retries of one user-visible checkpoint restore. */
	operationId: string;
	/** Stable replacement identity; Core never regenerates it on retry. */
	sessionId: string;
	/** Stable branch chat identity for the restored conversation. */
	chatId: string;
	/** Source session whose checkpoint and lineage are being restored. */
	parentSessionId: string;
	checkpointRunCount: number;
	cwd?: string;
	restore?: RestoreOptions;
	title?: string;
	titleSource?: string;
	leaseTtlMs?: number;
	startInput: ClineCoreManagedStartInput;
}

export interface ClineCoreChatLifecycleRestoreCheckpointResult
	extends ClineCoreChatLifecycleStartResult {
	messages?: Message[];
	checkpoint: CheckpointEntry;
}

export interface ClineCoreChatLifecycleResumeInput {
	/** Stable across retries of one user-visible resume operation. */
	operationId: string;
	sessionId: string;
	expectedLeaseRevision?: number;
	leaseTtlMs?: number;
	startInput: ClineCoreManagedStartInput;
}

export interface ClineCoreChatLifecycleRecoverLostLeaseInput {
	/** Stable across retries of one user-confirmed recovery operation. */
	operationId: string;
	sessionId: string;
	leaseTtlMs?: number;
	startInput: ClineCoreManagedStartInput;
}

export interface ClineCoreChatLifecycleConfirmationRequest {
	readonly confirmation: "archive" | "activate" | "purge" | "revoke_lease";
	readonly aggregateKind: "chat" | "lease";
	readonly aggregateId: string;
	readonly expectedRevision: number;
	readonly effects?: readonly ("stop_running" | "clear_bindings")[];
}

export interface ClineCoreChatLifecycleStopInput {
	/** Stable across retries of one user-visible stop operation. */
	operationId: string;
	sessionId: string;
}

export interface ClineCoreChatLifecycleRunTurnInput extends SendSessionInput {
	/** Stable activity-mutation identity for this completed turn. */
	operationId: string;
}

export interface ClineCoreChatLifecycleBindingScope {
	transport: string;
	instanceId?: string;
	channelId?: string;
	threadId?: string;
	participantScope?: string;
}

export interface ClineCoreChatLifecycleBindingTarget
	extends ClineCoreChatLifecycleBindingScope {
	bindingId: string;
	expectedBindingRevision: number;
}

export interface ClineCoreChatLifecycleBindInput {
	operationId: string;
	sessionId: string;
	target: ClineCoreChatLifecycleBindingTarget;
}

export interface ClineCoreChatLifecycleResetInput {
	operationId: string;
	sessionId: string;
	binding?: ClineCoreChatLifecycleBindingTarget;
}

export interface ClineCoreChatLifecycleArchiveInput {
	operationId: string;
	chatId: string;
	expectedRevision: number;
	/** Explicit stop-and-archive; ordinary archive still rejects running chats. */
	stopRunning?: boolean;
	/** Atomically clear current bindings in the archive transaction. */
	clearBindings?: boolean;
}

export interface ClineCoreChatLifecycleActivateInput {
	operationId: string;
	chatId: string;
	expectedRevision: number;
}

export interface ClineCoreChatLifecycleRenameInput
	extends ClineCoreChatLifecycleActivateInput {
	title: string;
}

export interface ClineCoreChatLifecyclePurgeResult {
	chatId: string;
	sessionIds: string[];
	applied: boolean;
}

/**
 * Sanitized app-facing managed-chat lifecycle. Writer and confirmation
 * credentials never appear in this contract.
 */
export interface ClineCoreChatLifecycleApi {
	startRoot(
		input: ClineCoreChatLifecycleStartRootInput,
	): Promise<ClineCoreChatLifecycleStartResult>;
	startRelated(
		input: ClineCoreChatLifecycleStartRelatedInput,
	): Promise<ClineCoreChatLifecycleStartResult>;
	restoreCheckpoint(
		input: ClineCoreChatLifecycleRestoreCheckpointInput,
	): Promise<ClineCoreChatLifecycleRestoreCheckpointResult>;
	resume(
		input: ClineCoreChatLifecycleResumeInput,
	): Promise<ClineCoreChatLifecycleStartResult>;
	recoverLostLease(
		input: ClineCoreChatLifecycleRecoverLostLeaseInput,
	): Promise<ClineCoreChatLifecycleStartResult>;
	runTurn(
		input: ClineCoreChatLifecycleRunTurnInput,
	): Promise<AgentResult | undefined>;
	getBinding(
		scope: ClineCoreChatLifecycleBindingScope,
	): Promise<ChatBindingRecord | undefined>;
	bind(input: ClineCoreChatLifecycleBindInput): Promise<ChatBindingRecord>;
	reset(
		input: ClineCoreChatLifecycleResetInput,
	): Promise<ChatBindingRecord | undefined>;
	archive(input: ClineCoreChatLifecycleArchiveInput): Promise<ChatDetail>;
	activate(input: ClineCoreChatLifecycleActivateInput): Promise<ChatDetail>;
	rename(input: ClineCoreChatLifecycleRenameInput): Promise<ChatDetail>;
	purge(
		input: ClineCoreChatLifecycleActivateInput,
	): Promise<ClineCoreChatLifecyclePurgeResult>;
	stop(input: ClineCoreChatLifecycleStopInput): Promise<void>;
}

export interface ClineCoreLocalChatLifecycleOptions {
	/** Absolute server-owned workspace scope for this local Core instance. */
	workspaceRoot: string;
	/** Optional explicit directory containing the shared sessions.db. */
	dataDir?: string;
	/** Durable database owner; nonlocal tenants require an explicit dataDir. */
	tenantId?: string;
	/** Server-issued managed target namespace. Omit only for legacy local mode. */
	audienceId?: string;
	/** Exact pre-audience upgrade mappings retained inside trusted composition. */
	audienceMigrationMappings?: readonly ChatAudienceMigrationMapping[];
	/** Stable local human owner; defaults to Core's distinct machine identity. */
	principalId?: string;
	actorLabel?: string;
	source?: {
		kind: ChatMutationSourceKind;
		clientId?: string;
		transport?: string;
		threadId?: string;
		channelId?: string;
	};
	/**
	 * Host-owned human confirmation bridge. Core supplies only the bound action,
	 * aggregate, and observed revision; returning true attests that the host
	 * observed explicit human approval for this one operation.
	 */
	confirm?: (
		request: ClineCoreChatLifecycleConfirmationRequest,
	) => boolean | Promise<boolean>;
	/** Lifetime of the internal one-time confirmation grant. Defaults to 5 min. */
	confirmationTtlMs?: number;
	/**
	 * Trusted host provider for the current invocation's final mutation fence.
	 * Internal maintenance may return a workspace-lifetime fence.
	 */
	mutationFence?: () => ChatCatalogMutationFence | undefined;
}

export interface RestoreOptions {
	/**
	 * Restore the message history by starting a new session fork trimmed to
	 * `checkpointRunCount`. Defaults to true.
	 */
	messages?: boolean;
	/**
	 * Restore the workspace files from the checkpoint's git snapshot.
	 * Defaults to true.
	 */
	workspace?: boolean;
	/**
	 * Start the forked session with messages before the checkpoint user message
	 * while still returning messages through that user message. This is for
	 * clients that put the checkpoint message back into a compose box so it can
	 * be edited and submitted again without duplicating it in session history.
	 */
	omitCheckpointMessageFromSession?: boolean;
}

export interface RestoreInput {
	sessionId: string;
	checkpointRunCount: number;
	start?: ClineCoreStartInput;
	cwd?: string;
	restore?: RestoreOptions;
}

export interface RestoreResult {
	sessionId?: string;
	startResult?: StartSessionResult;
	messages?: Message[];
	checkpoint: CheckpointEntry;
}

export interface CompareCheckpointInput {
	sessionId: string;
	checkpointRunCount: number;
	cwd?: string;
}

export type CompareCheckpointResult = CheckpointWorkspaceCompareResult;

export interface ClineCoreOptions {
	/**
	 * A human-readable name for this SDK client (e.g. `"my-app"`, `"acme-bot"`).
	 * Used to identify the consumer in telemetry and logs.
	 */
	clientName?: string;
	/**
	 * A stable identifier for this machine or user, used for telemetry attribution.
	 * Defaults to the system machine ID, falling back to a generated `cl-<nanoid>` persisted
	 * at `~/.cline/data/machine-id`.
	 */
	distinctId?: string;
	/**
	 * Controls how the runtime host is selected:
	 * - `"auto"` (default) — prefers a compatible local hub when one is available and falls
	 *   back to local in-process execution when not.
	 * - `"hub"` — requires a compatible websocket hub runtime; throws if one is not reachable.
	 * - `"remote"` — requires an explicit remote websocket hub endpoint.
	 * - `"local"` — always uses local in-process execution and local SQLite/file storage.
	 */
	backendMode?: RuntimeHostMode;
	/**
	 * Enables the local catalog-authoritative lifecycle composition. This is
	 * local-only and fails closed if SQLite cannot be used; it never falls back
	 * to file persistence or a generic hub session path.
	 */
	chatLifecycle?: ClineCoreLocalChatLifecycleOptions;
	/**
	 * Hub runtime connection options. Used when `backendMode` is `"hub"` or when `"auto"`
	 * should prefer a shared local hub if available.
	 */
	hub?: HubOptions;
	/**
	 * Remote hub connection options. Only relevant when `backendMode` is `"remote"`.
	 */
	remote?: RemoteOptions;
	/**
	 * Client-owned runtime capabilities. Core adapts these handlers to the
	 * selected runtime backend so apps implement interactive behavior once.
	 */
	capabilities?: RuntimeCapabilities;
	/**
	 * Telemetry service instance to use for capturing events and usage.
	 * If omitted, telemetry is a no-op.
	 */
	telemetry?: ITelemetryService;
	/**
	 * Feature flags service for this ClineCore instance.
	 * If omitted, Core uses a no-op provider with default flag values.
	 */
	featureFlags?: FeatureFlagsService;
	/**
	 * Optional structured logger for core-side operational diagnostics such as
	 * runtime-host selection and fallback decisions.
	 */
	logger?: BasicLogger;
	/**
	 * Explicit resource-policy values. Values override environment variables and
	 * hardware-derived defaults, and are always clamped to finite safety bounds.
	 * The initial policy is observe-only and does not throttle runtime work.
	 */
	resourcePolicy?: ResourcePolicyOverrides | ResourcePolicyProfile;
	/**
	 * Per-tool approval policies that control whether a tool runs automatically,
	 * requires user confirmation, or is blocked entirely.
	 */
	toolPolicies?: AgentConfig["toolPolicies"];
	/**
	 * Optional hook invoked after `messages.json` is persisted to disk.
	 * Consumers can use this to mirror session transcripts into remote storage.
	 */
	messagesArtifactUploader?: SessionMessagesArtifactUploader;
	/**
	 * Enables file-based and event-driven automation through this ClineCore
	 * instance. When configured, callers use `cline.automation.*` instead of
	 * constructing cron services directly.
	 */
	automation?: boolean | ClineCoreAutomationOptions;
	/**
	 * Custom `fetch` implementation forwarded to the AI gateway providers used
	 * by local sessions. When supplied, it is threaded into each
	 * `ProviderConfig.fetch` built during session bootstrap, which in turn
	 * populates `GatewayProviderSettings.fetch` (and the top-level
	 * `GatewayConfig.fetch` fallback) so hosts can inject custom HTTP behavior
	 * such as proxies, retries, tracing, or test doubles.
	 *
	 * Per-session or per-provider overrides still win: an explicit
	 * `config.fetch` on `CoreSessionConfig` or a stored provider-level `fetch`
	 * takes precedence over this default.
	 *
	 * Applies only to sessions executed in this process (local and fallback-
	 * to-local auto mode). For hub and remote runtimes the HTTP call happens
	 * inside the process that owns the gateway, so configure `fetch` there:
	 *   - `startHubServer({ fetch })` / `ensureHubServer({ fetch })` from
	 *     `@cline/hub`
	 *   - `createLocalHubScheduleRuntimeHandlers({ fetch })` from
	 *     `@cline/core/hub` for the scheduler
	 */
	fetch?: typeof fetch;
	/**
	 * An already-constructed session backend to use instead of resolving one automatically.
	 * Intended for testing or embedding a custom persistence layer.
	 * @internal
	 */
	sessionService?: SessionBackend;
	/**
	 * Optional hook invoked before each session starts.
	 * Use this to prepare workspace-scoped runtime state and then return an
	 * adapter that mutates the shared session input before core starts the run.
	 * This runs before the execution host resolves an omitted workspace, so
	 * pathless starts expose neither `cwd` nor `workspaceRoot` to this hook.
	 */
	prepare?: (
		input: ClineCoreStartInput,
	) =>
		| Promise<StartSessionBootstrap | undefined>
		| StartSessionBootstrap
		| undefined;
}

export interface StartSessionBootstrap {
	applyToStartSessionInput(
		input: ClineCoreStartInput,
	): Promise<ClineCoreStartInput> | ClineCoreStartInput;
	dispose?(): Promise<void> | void;
}
