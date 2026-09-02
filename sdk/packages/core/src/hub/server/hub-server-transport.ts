import type {
	HubClientRecord,
	HubClientRegistration,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	ToolApprovalRequest,
} from "@cline/shared";
import {
	captureSdkError,
	createSessionId,
	HUB_CHAT_LIFECYCLE_COMMANDS,
	HUB_CHAT_PROJECTION_COMMANDS,
	HUB_CHAT_RUNTIME_COMMANDS,
} from "@cline/shared";
import { CronService } from "../../cron/service/cron-service";
import { HubScheduleCommandService } from "../../cron/service/schedule-command-service";
import { HubScheduleService } from "../../cron/service/schedule-service";
import { resolveResourcePolicy } from "../../resources/policy";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import type {
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { CoreSessionService } from "../../session/services/session-service";
import {
	type CoreSettingsListInput,
	CoreSettingsService,
	type CoreSettingsToggleInput,
	type CoreSettingsType,
} from "../../settings";
import type { CoreSessionEvent } from "../../types/events";
import type {
	HubEventSubscriptionOptions,
	HubSocketCommandTransport,
} from "./command-transport";
import {
	handleApprovalRespond,
	requestToolApproval as requestToolApprovalHandler,
	resolvePendingApproval,
} from "./handlers/approval-handlers";
import {
	cancelPendingCapabilityRequests,
	handleCapabilityProgress,
	handleCapabilityRequest,
	handleCapabilityRespond,
	requestCapability as requestCapabilityHandler,
} from "./handlers/capability-handlers";
import { handleChatCatalogCommand } from "./handlers/chat-catalog-handlers";
import { handleChatLifecycleCommand } from "./handlers/chat-lifecycle-handlers";
import { subscribeChatManagedEvents } from "./handlers/chat-managed-event-handlers";
import { handleChatProjectionCommand } from "./handlers/chat-projection-handlers";
import { handleChatRuntimeCommand } from "./handlers/chat-runtime-handlers";
import {
	handleClientList,
	handleClientRegister,
	handleClientUnregister,
	handleClientUpdate,
} from "./handlers/client-handlers";
import { handleConnectorCommand } from "./handlers/connector-handlers";
import {
	buildHubEvent,
	type HubTransportContext,
	okReply,
	type PendingApproval,
	type PendingCapabilityRequest,
} from "./handlers/context";
import { handleDriveBankCommand } from "./handlers/drive-bank-handlers";
import { handleDriveCatalogCommand } from "./handlers/drive-catalog-handlers";
import { handleDriveConfigCommand } from "./handlers/drive-config-handlers";
import { handleDrivePlanCommand } from "./handlers/drive-driveplan-handlers";
import { handleDriveForkCommand } from "./handlers/drive-fork-handlers";
import { handleDriveForkTickCommand } from "./handlers/drive-fork-tick";
import { handleDriveCommand } from "./handlers/drive-handlers";
import { handleDriveHomeCommand } from "./handlers/drive-home-handlers";
import { handleDrivePrivacyCommand } from "./handlers/drive-privacy-handlers";
import { handleDriveProjectMapCommand } from "./handlers/drive-project-map-handlers";
import { handleDriveRoomCommand } from "./handlers/drive-room-handlers";
import { handleDriveSessionRollupsCommand } from "./handlers/drive-session-rollups-handlers";
import { handleDriveWaveCommand } from "./handlers/drive-wave-handlers";
import {
	handleRunAbort,
	handleSessionHook,
	handleSessionInput,
} from "./handlers/run-handlers";
import { projectSessionEvent } from "./handlers/session-event-projector";
import {
	handleSessionAttach,
	handleSessionCompactionGet,
	handleSessionCompactionUpdate,
	handleSessionCreate,
	handleSessionDelete,
	handleSessionDetach,
	handleSessionGet,
	handleSessionList,
	handleSessionMessages,
	handleSessionPendingPrompts,
	handleSessionRemovePendingPrompt,
	handleSessionRestore,
	handleSessionUpdate,
	handleSessionUpdateConnection,
	handleSessionUpdatePendingPrompt,
} from "./handlers/session-handlers";
import {
	attachStatusBroadcast,
	handleStatusCommand,
	seedRepoChangelog,
} from "./handlers/status-handlers";
import { eventNameForScheduleCommand } from "./hub-schedule-events";
import { logHubBoundaryError } from "./hub-server-logging";
import type { HubWebSocketServerOptions } from "./hub-server-options";
import type { HubSessionState } from "./hub-session-records";
import type { NativeHubTransport } from "./native-transport";
import {
	type HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "./workspace-capability-authority";
import type {
	HubWorkspaceManagedConfirmationRequester,
	HubWorkspaceManagedCorePool,
} from "./workspace-managed-core-pool";

const MANAGED_BOOTSTRAP_COMMANDS = new Set([
	"client.register",
	"client.update",
	"client.unregister",
]);
const CHAT_LIFECYCLE_COMMANDS = new Set<string>(HUB_CHAT_LIFECYCLE_COMMANDS);
const CHAT_PROJECTION_COMMANDS = new Set<string>(HUB_CHAT_PROJECTION_COMMANDS);
const CHAT_RUNTIME_COMMANDS = new Set<string>(HUB_CHAT_RUNTIME_COMMANDS);

function isWorkspaceAuthorityCommand(command: string): boolean {
	return (
		command.startsWith("chat_catalog.") ||
		CHAT_LIFECYCLE_COMMANDS.has(command) ||
		CHAT_PROJECTION_COMMANDS.has(command) ||
		CHAT_RUNTIME_COMMANDS.has(command)
	);
}

function sanitizeManagedBootstrapEnvelope(
	envelope: HubCommandEnvelope,
): HubCommandEnvelope {
	if (envelope.command === "client.update") {
		return { ...envelope, payload: {} };
	}
	if (envelope.command !== "client.register") return envelope;
	const source = envelope.payload ?? {};
	const payload: Record<string, unknown> = {};
	for (const key of [
		"clientId",
		"clientType",
		"displayName",
		"actorKind",
		"transport",
		"protocolVersion",
	] as const) {
		if (source[key] !== undefined) payload[key] = source[key];
	}
	return { ...envelope, payload };
}

const SETTINGS_TYPES = new Set<CoreSettingsType>([
	"skills",
	"workflows",
	"rules",
	"tools",
	"mcp",
]);

function isPayloadObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOptionalString(
	payload: Record<string, unknown>,
	key: "cwd" | "workspaceRoot" | "id" | "path" | "name",
): string | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`settings payload '${key}' must be a string.`);
	}
	return value;
}

function requireOptionalBoolean(
	payload: Record<string, unknown>,
	key: "enabled",
): boolean | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`settings payload '${key}' must be a boolean.`);
	}
	return value;
}

function parseSettingsListInput(payload: unknown): CoreSettingsListInput {
	if (payload === undefined) {
		return {};
	}
	if (!isPayloadObject(payload)) {
		throw new Error("settings.list payload must be an object.");
	}
	return {
		cwd: requireOptionalString(payload, "cwd"),
		workspaceRoot: requireOptionalString(payload, "workspaceRoot"),
		availabilityContext: isPayloadObject(payload.availabilityContext)
			? (payload.availabilityContext as CoreSettingsListInput["availabilityContext"])
			: undefined,
	};
}

function parseSettingsToggleInput(payload: unknown): CoreSettingsToggleInput {
	if (!isPayloadObject(payload)) {
		throw new Error("settings.toggle payload must be an object.");
	}
	const { type } = payload;
	if (
		typeof type !== "string" ||
		!SETTINGS_TYPES.has(type as CoreSettingsType)
	) {
		throw new Error(
			"settings.toggle payload 'type' must be one of: skills, workflows, rules, tools, mcp.",
		);
	}
	return {
		...parseSettingsListInput(payload),
		type: type as CoreSettingsType,
		id: requireOptionalString(payload, "id"),
		path: requireOptionalString(payload, "path"),
		name: requireOptionalString(payload, "name"),
		enabled: requireOptionalBoolean(payload, "enabled"),
	};
}

interface OpenHubConnectionState {
	readonly marker: object;
	readonly authenticatedConnection?: HubAuthenticatedConnection;
	readonly subscriptions: Set<() => void>;
	pendingSubscriptions: number;
	closed: boolean;
}

function connectionErrorReply(
	envelope: HubCommandEnvelope,
	code: string,
	message: string,
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: false,
		error: { code, message },
	};
}

/** @internal Exported for unit testing fetch/runtime wiring. */
export class HubServerTransport implements NativeHubTransport {
	private readonly clients = new Map<string, HubClientRecord>();
	private readonly listeners = new Map<
		string,
		Set<{ sessionId?: string; listener: (event: HubEventEnvelope) => void }>
	>();
	private readonly sessionState = new Map<string, HubSessionState>();
	private readonly pendingApprovals = new Map<string, PendingApproval>();
	private readonly pendingCapabilityRequests = new Map<
		string,
		PendingCapabilityRequest
	>();
	private readonly suppressNextTerminalEventBySession = new Map<
		string,
		string
	>();
	private readonly schedules: HubScheduleService;
	private readonly scheduleCommands: HubScheduleCommandService;
	private readonly settings: CoreSettingsService;
	private readonly cronService?: CronService;
	private readonly sessionHost: RuntimeHost &
		Partial<PendingPromptsRuntimeService>;
	private readonly hubId = createSessionId("hub_");
	private readonly ctx: HubTransportContext;
	private readonly detachStatusBroadcast: () => void;
	private readonly openConnections = new Set<OpenHubConnectionState>();
	private readonly clientConnectionOwners = new Map<
		string,
		OpenHubConnectionState
	>();
	private readonly maxActiveSubscriptionsPerConnection: number;

	constructor(
		readonly options: HubWebSocketServerOptions,
		private readonly workspaceCapabilities = new HubWorkspaceCapabilityAuthority(),
		private readonly workspaceManagedCores?: HubWorkspaceManagedCorePool,
		private readonly requestManagedCatalogConfirmation?: HubWorkspaceManagedConfirmationRequester,
	) {
		const resourcePolicy = resolveResourcePolicy({
			overrides: options.resourcePolicy,
		}).profile;
		this.maxActiveSubscriptionsPerConnection =
			resourcePolicy.transport.websocket.maxActiveSubscriptions;
		this.sessionHost =
			options.sessionHost ??
			new LocalRuntimeHost({
				sessionService: new CoreSessionService(new SqliteSessionStore()),
				fetch: options.fetch,
				logger: options.logger,
				telemetry: options.telemetry,
				resourcePolicy,
			});
		this.ctx = {
			clients: this.clients,
			sessionState: this.sessionState,
			pendingApprovals: this.pendingApprovals,
			pendingCapabilityRequests: this.pendingCapabilityRequests,
			suppressNextTerminalEventBySession:
				this.suppressNextTerminalEventBySession,
			pendingDriveToolInputs: new Map(),
			activeRpcTurnCountBySession: new Map(),
			telemetry: options.telemetry,
			chatCatalog: options.chatCatalog,
			sessionHost: this.sessionHost,
			publish: (event) => this.publish(event),
			buildEvent: buildHubEvent,
			requestCapability: (
				sessionId,
				capabilityName,
				payload,
				targetClientId,
				onProgress,
			) =>
				requestCapabilityHandler(
					this.ctx,
					sessionId,
					capabilityName,
					payload,
					targetClientId,
					onProgress,
				),
		};
		// Status Hub publishes reach the wire from here rather than from the
		// command handler, so the `report_status` tool broadcasts too.
		this.detachStatusBroadcast = attachStatusBroadcast(this.ctx);
		this.schedules = new HubScheduleService({
			...options.scheduleOptions,
			runtimeHandlers: options.runtimeHandlers,
			eventPublisher: (eventType, payload) => {
				const mapped =
					eventType === "schedule.execution.completed"
						? "schedule.execution_completed"
						: eventType === "schedule.execution.failed"
							? "schedule.execution_failed"
							: undefined;
				if (!mapped) {
					return;
				}
				this.publish(
					buildHubEvent(
						mapped,
						payload && typeof payload === "object"
							? (payload as Record<string, unknown>)
							: undefined,
					),
				);
			},
		});
		this.scheduleCommands = new HubScheduleCommandService(this.schedules);
		this.settings = options.settingsService ?? new CoreSettingsService();
		if (options.cronOptions) {
			this.cronService = new CronService({
				runtimeHandlers: options.runtimeHandlers,
				...options.cronOptions,
			});
		}
		this.sessionHost.subscribe((event: CoreSessionEvent) => {
			void projectSessionEvent(this.ctx, event).catch((error) => {
				logHubBoundaryError("session event handling failed", error);
				captureSdkError(this.options.telemetry, {
					component: "core",
					operation: "hub.session_event_project",
					error,
					severity: "error",
					handled: true,
					context: {
						eventType: event.type,
						sessionId: event.payload.sessionId,
					},
				});
			});
		});
	}

	getCronService(): CronService | undefined {
		return this.cronService;
	}

	getHubId(): string {
		return this.hubId;
	}

	async start(): Promise<void> {
		// Seed before listening: the changelog is empty on a fresh data dir, and
		// an empty changelog reads as a broken feature rather than as no news.
		// Idempotent, so restarts republish nothing.
		const seeded = seedRepoChangelog();
		if (seeded.published > 0) {
			console.info(
				`[hub] seeded ${seeded.published} repo changelog entries from ${seeded.snapshotPath}`,
			);
		}
		await this.schedules.start();
		if (this.cronService) {
			try {
				await this.cronService.start();
			} catch (err) {
				console.error("[hub] cron service start failed", err);
			}
		}
	}

	async stop(): Promise<void> {
		for (const connection of [...this.openConnections]) {
			this.closeConnection(connection);
		}
		this.detachStatusBroadcast();
		for (const approvalId of this.pendingApprovals.keys()) {
			resolvePendingApproval(this.ctx, approvalId, {
				approved: false,
				reason: "Hub shutting down before approval was resolved.",
			});
		}
		cancelPendingCapabilityRequests(
			this.ctx,
			() => true,
			"Hub shutting down before capability request was resolved.",
		);
		const settled = await Promise.allSettled([
			this.workspaceManagedCores?.dispose("hub_server_stop"),
			this.sessionHost.dispose("hub_server_stop"),
			this.schedules.dispose(),
			this.cronService?.dispose(),
		]);
		const failures = settled.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (failures.length > 0) {
			throw new AggregateError(failures, "Hub transport shutdown failed");
		}
	}

	async handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		return this.handleCommandForConnection(envelope);
	}

	openConnection(
		identity: HubAuthenticatedConnection,
	): HubSocketCommandTransport {
		this.workspaceCapabilities.assertActive(identity);
		if (
			[...this.openConnections].some(
				(connection) => connection.authenticatedConnection === identity,
			)
		) {
			throw new Error("Hub workspace connection is already open.");
		}
		return this.createConnection(identity);
	}

	openUnscopedConnection(): HubSocketCommandTransport {
		return this.createConnection();
	}

	private createConnection(
		authenticatedConnection?: HubAuthenticatedConnection,
	): HubSocketCommandTransport {
		const state: OpenHubConnectionState = {
			marker: {},
			...(authenticatedConnection ? { authenticatedConnection } : {}),
			subscriptions: new Set(),
			pendingSubscriptions: 0,
			closed: false,
		};
		this.openConnections.add(state);
		return Object.freeze({
			command: (envelope: HubCommandEnvelope) =>
				this.handleBoundCommand(state, envelope),
			subscribe: (
				clientId: string,
				listener: (event: HubEventEnvelope) => void,
				options?: HubEventSubscriptionOptions,
			) => {
				this.assertConnectionUsable(state);
				if (this.clientConnectionOwners.get(clientId) !== state) {
					throw new Error(
						"Hub event subscription requires this connection's registered client identity.",
					);
				}
				if (
					state.subscriptions.size + state.pendingSubscriptions >=
					this.maxActiveSubscriptionsPerConnection
				) {
					throw new Error("Hub active subscription bound was reached.");
				}
				const track = (unsubscribe: () => void): (() => void) => {
					try {
						this.assertConnectionUsable(state);
					} catch (error) {
						unsubscribe();
						throw error;
					}
					let active = true;
					const release = () => {
						if (!active) return;
						active = false;
						state.subscriptions.delete(release);
						unsubscribe();
					};
					state.subscriptions.add(release);
					return release;
				};
				state.pendingSubscriptions += 1;
				let pending = true;
				const releasePending = () => {
					if (!pending) return;
					pending = false;
					state.pendingSubscriptions -= 1;
				};
				const complete = (unsubscribe: () => void) => {
					releasePending();
					return track(unsubscribe);
				};
				try {
					if (
						!this.workspaceManagedCores ||
						this.options.managedChatLifecycleEnabled !== true ||
						!state.authenticatedConnection
					) {
						if (options?.runtimeCursor || options?.lifecycleCursor) {
							throw new Error(
								"Managed cursors require the managed event lane.",
							);
						}
						return complete(
							this.subscribe(clientId, listener, {
								...(options?.sessionId ? { sessionId: options.sessionId } : {}),
							}),
						);
					}
					return subscribeChatManagedEvents(
						state.authenticatedConnection,
						this.workspaceCapabilities,
						this.workspaceManagedCores,
						options,
						listener,
					).then(complete, (error) => {
						releasePending();
						throw error;
					});
				} catch (error) {
					releasePending();
					throw error;
				}
			},
			closeConnection: () => this.closeConnection(state),
		});
	}

	private async handleBoundCommand(
		state: OpenHubConnectionState,
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			this.assertConnectionUsable(state);
		} catch {
			return connectionErrorReply(
				envelope,
				state.authenticatedConnection
					? "workspace_connection_revoked"
					: "hub_connection_closed",
				"Hub connection is closed or revoked.",
			);
		}

		const registration = (envelope.payload ??
			{}) as unknown as HubClientRegistration;
		const registrationClientId =
			envelope.command === "client.register"
				? registration.clientId?.trim() || envelope.clientId?.trim()
				: undefined;
		if (registrationClientId) {
			const owner = this.clientConnectionOwners.get(registrationClientId);
			if (
				(owner && owner !== state) ||
				(this.clients.has(registrationClientId) && !owner)
			) {
				return connectionErrorReply(
					envelope,
					"client_conflict",
					"Client ID is already registered on another connection.",
				);
			}
			this.clientConnectionOwners.set(registrationClientId, state);
		} else if (envelope.clientId?.trim()) {
			const clientId = envelope.clientId.trim();
			if (this.clientConnectionOwners.get(clientId) !== state) {
				return connectionErrorReply(
					envelope,
					"client_not_registered",
					"Command requires this connection's registered client identity.",
				);
			}
		}
		if (isWorkspaceAuthorityCommand(envelope.command)) {
			const clientId = envelope.clientId?.trim();
			if (
				!clientId ||
				this.clientConnectionOwners.get(clientId) !== state ||
				!this.clients.has(clientId)
			) {
				return connectionErrorReply(
					envelope,
					"client_not_registered",
					"Workspace authority commands require this connection's registered client identity.",
				);
			}
		}

		const managedScopedConnection =
			this.workspaceManagedCores !== undefined &&
			this.options.managedChatLifecycleEnabled === true &&
			state.authenticatedConnection !== undefined;
		const dispatchEnvelope = managedScopedConnection
			? sanitizeManagedBootstrapEnvelope(envelope)
			: envelope;
		const reply = await this.handleCommandForConnection(
			dispatchEnvelope,
			state.authenticatedConnection,
		);
		if (envelope.command === "client.register") {
			if (!reply.ok) {
				if (
					registrationClientId &&
					this.clientConnectionOwners.get(registrationClientId) === state
				) {
					this.clientConnectionOwners.delete(registrationClientId);
				}
			} else {
				const registeredClientId =
					registrationClientId ||
					(typeof reply.payload?.clientId === "string"
						? reply.payload.clientId.trim()
						: "");
				if (registeredClientId) {
					this.clientConnectionOwners.set(registeredClientId, state);
				}
			}
		} else if (envelope.command === "client.unregister" && reply.ok) {
			const clientId = envelope.clientId?.trim();
			if (clientId && this.clientConnectionOwners.get(clientId) === state) {
				this.clientConnectionOwners.delete(clientId);
			}
		}
		return reply;
	}

	private assertConnectionUsable(state: OpenHubConnectionState): void {
		if (state.closed || !this.openConnections.has(state)) {
			throw new Error("Hub connection is closed.");
		}
		if (state.authenticatedConnection) {
			this.workspaceCapabilities.assertActive(state.authenticatedConnection);
		}
	}

	private closeConnection(state: OpenHubConnectionState): void {
		if (state.closed) return;
		state.closed = true;
		this.openConnections.delete(state);
		for (const unsubscribe of [...state.subscriptions]) unsubscribe();
		for (const [clientId, owner] of this.clientConnectionOwners) {
			if (owner !== state) continue;
			this.clientConnectionOwners.delete(clientId);
			this.clients.delete(clientId);
			this.listeners.delete(clientId);
			this.detachClientFromSessions(clientId);
			this.publish(
				this.ctx.buildEvent("hub.client.disconnected", { clientId }),
			);
		}
		if (state.authenticatedConnection) {
			this.options.chatCatalog?.confirmationBroker.revokeClient(
				state.authenticatedConnection.connectionId,
			);
			this.workspaceCapabilities.release(state.authenticatedConnection);
		}
	}

	private async handleCommandForConnection(
		envelope: HubCommandEnvelope,
		authenticatedConnection?: HubAuthenticatedConnection,
	): Promise<HubReplyEnvelope> {
		try {
			const reply = await this.dispatchCommand(
				envelope,
				authenticatedConnection,
			);
			this.captureFailedReply(envelope, reply);
			return reply;
		} catch (error) {
			captureSdkError(this.options.telemetry, {
				component: "core",
				operation: "hub.command",
				error,
				severity: "error",
				handled: false,
				context: this.commandTelemetryContext(envelope),
			});
			throw error;
		}
	}

	private async dispatchCommand(
		envelope: HubCommandEnvelope,
		authenticatedConnection?: HubAuthenticatedConnection,
	): Promise<HubReplyEnvelope> {
		const isManagedLifecycleCommand = CHAT_LIFECYCLE_COMMANDS.has(
			envelope.command,
		);
		const isManagedRuntimeCommand = CHAT_RUNTIME_COMMANDS.has(envelope.command);
		const isManagedProjectionCommand = CHAT_PROJECTION_COMMANDS.has(
			envelope.command,
		);
		if (
			envelope.command.startsWith("chat_catalog.") &&
			this.workspaceManagedCores &&
			this.options.managedChatLifecycleEnabled === true &&
			authenticatedConnection
		) {
			return connectionErrorReply(
				envelope,
				"unsupported_capability",
				"Raw chat catalog commands are unavailable on managed workspace connections.",
			);
		}
		if (
			envelope.command.startsWith("chat_catalog.") &&
			this.options.managedChatLifecycleEnabled !== true
		) {
			return connectionErrorReply(
				envelope,
				"unsupported_capability",
				"Managed chat commands are disabled.",
			);
		}
		if (
			this.workspaceManagedCores &&
			this.options.managedChatLifecycleEnabled === true &&
			authenticatedConnection &&
			!MANAGED_BOOTSTRAP_COMMANDS.has(envelope.command) &&
			!envelope.command.startsWith("chat_catalog.") &&
			!isManagedLifecycleCommand &&
			!isManagedProjectionCommand &&
			!isManagedRuntimeCommand
		) {
			return connectionErrorReply(
				envelope,
				"unsupported_capability",
				"Managed workspace commands require a sanitized managed chat wire.",
			);
		}
		if (isManagedLifecycleCommand) {
			if (
				this.options.managedChatLifecycleEnabled !== true ||
				!authenticatedConnection ||
				!this.workspaceManagedCores
			) {
				return connectionErrorReply(
					envelope,
					"unsupported_capability",
					"Managed lifecycle commands require an authenticated workspace connection.",
				);
			}
			return await handleChatLifecycleCommand(
				envelope,
				authenticatedConnection,
				this.workspaceCapabilities,
				this.workspaceManagedCores,
				this.requestManagedCatalogConfirmation,
			);
		}
		if (isManagedRuntimeCommand) {
			if (
				this.options.managedChatLifecycleEnabled !== true ||
				!authenticatedConnection ||
				!this.workspaceManagedCores
			) {
				return connectionErrorReply(
					envelope,
					"unsupported_capability",
					"Managed runtime commands require an authenticated workspace connection.",
				);
			}
			return await handleChatRuntimeCommand(
				envelope,
				authenticatedConnection,
				this.workspaceCapabilities,
				this.workspaceManagedCores,
			);
		}
		if (isManagedProjectionCommand) {
			if (
				this.options.managedChatLifecycleEnabled !== true ||
				!authenticatedConnection ||
				!this.workspaceManagedCores
			) {
				return connectionErrorReply(
					envelope,
					"unsupported_capability",
					"Managed projection commands require an authenticated workspace connection.",
				);
			}
			return await handleChatProjectionCommand(
				envelope,
				authenticatedConnection,
				this.workspaceCapabilities,
				this.workspaceManagedCores,
			);
		}
		switch (envelope.command) {
			case "client.register":
				return handleClientRegister(this.ctx, envelope);
			case "client.update":
				return handleClientUpdate(this.ctx, envelope);
			case "client.unregister":
				return handleClientUnregister(this.ctx, envelope, (clientId) => {
					this.listeners.delete(clientId);
					this.detachClientFromSessions(clientId);
				});
			case "client.list":
				return handleClientList(this.ctx, envelope);
			case "chat_catalog.list":
			case "chat_catalog.get":
			case "chat_catalog.adopt_root":
			case "chat_catalog.record_branch":
			case "chat_catalog.attach_successor":
			case "chat_catalog.record_activity":
			case "chat_catalog.rename":
			case "chat_catalog.archive":
			case "chat_catalog.activate":
			case "chat_catalog.bind":
			case "chat_catalog.unbind":
			case "chat_catalog.lease.get":
			case "chat_catalog.lease.verify":
			case "chat_catalog.lease.acquire":
			case "chat_catalog.lease.renew":
			case "chat_catalog.lease.release":
			case "chat_catalog.lease.revoke":
			case "chat_catalog.purge":
				if (!authenticatedConnection) {
					return {
						version: envelope.version,
						requestId: envelope.requestId,
						ok: false,
						error: {
							code: "unsupported_capability",
							message:
								"Chat catalog commands require an authenticated workspace connection.",
						},
					};
				}
				return await handleChatCatalogCommand(
					this.ctx,
					envelope,
					authenticatedConnection,
					(identity) =>
						Object.freeze({
							signal: this.workspaceCapabilities.signal(identity),
							assertActive: () =>
								this.workspaceCapabilities.assertActive(identity),
						}),
				);
			case "session.create":
				return await handleSessionCreate(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
				);
			case "session.restore":
				return await handleSessionRestore(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
				);
			case "session.attach":
				return await handleSessionAttach(this.ctx, envelope);
			case "session.detach":
				return await handleSessionDetach(this.ctx, envelope);
			case "session.get":
				return await handleSessionGet(this.ctx, envelope);
			case "session.messages":
				return await handleSessionMessages(this.ctx, envelope);
			case "session.compaction.get":
				return await handleSessionCompactionGet(this.ctx, envelope);
			case "session.list":
				return await handleSessionList(this.ctx, envelope);
			case "session.update":
				return await handleSessionUpdate(this.ctx, envelope);
			case "session.update_connection":
				return await handleSessionUpdateConnection(this.ctx, envelope);
			case "session.compaction.update":
				return await handleSessionCompactionUpdate(this.ctx, envelope);
			case "session.pending_prompts":
				return await handleSessionPendingPrompts(this.ctx, envelope);
			case "session.update_pending_prompt":
				return await handleSessionUpdatePendingPrompt(this.ctx, envelope);
			case "session.remove_pending_prompt":
				return await handleSessionRemovePendingPrompt(this.ctx, envelope);
			case "session.delete":
				return await handleSessionDelete(this.ctx, envelope);
			case "session.hook":
				return await handleSessionHook(this.ctx, envelope);
			case "run.start":
			case "session.send_input":
				return await handleSessionInput(this.ctx, envelope);
			case "run.abort":
				return await handleRunAbort(this.ctx, envelope);
			case "capability.request":
				return await handleCapabilityRequest(this.ctx, envelope);
			case "approval.respond":
				return await handleApprovalRespond(this.ctx, envelope);
			case "capability.respond":
				return handleCapabilityRespond(this.ctx, envelope);
			case "capability.progress":
				return handleCapabilityProgress(this.ctx, envelope);
			case "ui.notify":
				this.publish(buildHubEvent("ui.notify", envelope.payload ?? {}));
				return okReply(envelope);
			case "ui.show_window":
				this.publish(buildHubEvent("ui.show_window", envelope.payload ?? {}));
				return okReply(envelope);
			case "settings.list":
				return await this.handleSettingsList(envelope);
			case "settings.toggle":
				return await this.handleSettingsToggle(envelope);
			case "connector.channels":
			case "connector.configure":
			case "connector.delete_config":
				return await handleConnectorCommand(this.ctx, envelope);

			case "drive.room.get":
			case "drive.presenter.grant":
			case "drive.presenter.transfer":
			case "drive.presenter.revoke":
			case "drive.presenter.status":
			case "drive.spotlight.set":
			case "drive.participant.mute.set":
			case "drive.participant.deafen.set":
			case "drive.show.present":
			case "drive.show.enqueue":
			case "drive.show.tick":
			case "drive.do.enqueue":
			case "drive.planner.set":
			case "drive.script.attach":
			case "drive.script.advance":
			case "drive.artifacts.list":
				return handleDriveCommand(this.ctx, envelope);
			case "drive.fork.claim":
			case "drive.fork.promote":
			case "drive.fork.cancel":
			case "drive.fork.list":
			case "drive.fork.audit.get":
			case "drive.fork.retain.set":
				return await handleDriveForkCommand(this.ctx, envelope);
			case "drive.fork.tick":
				return await handleDriveForkTickCommand(this.ctx, envelope);
			case "drive.wave.run":
				return await handleDriveWaveCommand(this.ctx, envelope);
			case "driveplan.put_run":
			case "driveplan.get_run":
			case "driveplan.list_eligible_work":
			case "driveplan.claim_work":
			case "driveplan.report_progress":
			case "driveplan.project_to_kanban":
				return await handleDrivePlanCommand(this.ctx, envelope);
			case "drive_config_get":
			case "drive_config_put":
			case "drive_config_upsert_profile":
				return handleDriveConfigCommand(this.ctx, envelope);
			case "drive_catalog_get":
			case "drive_catalog_put":
				return handleDriveCatalogCommand(this.ctx, envelope);
			case "drive_project_map_get":
				return handleDriveProjectMapCommand(envelope);
			case "drive_privacy_put":
				return handleDrivePrivacyCommand(this.ctx, envelope);
			case "drive_bank_get":
			case "drive_bank_seed":
			case "drive_bank_create_task":
			case "drive_bank_edit_plan_tasks":
			case "drive_bank_complete_task":
			case "drive_bank_bind_now":
			case "drive_bank_activate_plan":
			case "drive_bank_record_failure":
			case "drive_bank_accept_sdlc_freeze":
				return await handleDriveBankCommand(this.ctx, envelope);
			case "drive_session_rollups":
				return await handleDriveSessionRollupsCommand(this.ctx, envelope);
			case "drive_agent_home_get":
			case "drive_agent_home_list":
			case "drive_agent_home_put":
				return await handleDriveHomeCommand(this.ctx, envelope);
			case "call_join":
			case "call_leave":
			case "call_end":
			case "call_mute":
			case "call_raise_hand":
			case "call_rename_participant":
			case "call_set_stage":
			case "call_set_address":
			case "call_set_mode":
			case "call_add_roster_pack":
			case "call_remove_roster_pack":
			case "call_seat":
			case "call_record_work":
			case "call_get_room":
			case "call_list_rooms":
				return await handleDriveRoomCommand(this.ctx, envelope);
			case "status.publish":
			case "status.query":
			case "status.current":
			case "status.board":
			case "status.summary":
			case "status.subjects":
			case "status.tasks_snapshot":
			case "status.prune":
				return await handleStatusCommand(this.ctx, envelope);
			case "settings.get":
			case "settings.patch":
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: false,
					error: {
						code: "not_implemented",
						message: `${envelope.command} is not implemented yet.`,
					},
				};
			default: {
				const reply = await this.scheduleCommands.handleCommand(envelope);
				if (reply.ok) {
					const event = eventNameForScheduleCommand(envelope.command);
					if (event) {
						this.publish(buildHubEvent(event, reply.payload));
					}
				}
				return reply;
			}
		}
	}

	private captureFailedReply(
		envelope: HubCommandEnvelope,
		reply: HubReplyEnvelope,
	): void {
		if (
			reply.ok ||
			!reply.error ||
			!shouldCaptureHubReplyError(reply.error.code)
		) {
			return;
		}
		captureSdkError(this.options.telemetry, {
			component: "core",
			operation: "hub.command_reply",
			error: new Error(reply.error.message),
			severity: reply.error.code === "session_not_found" ? "warn" : "error",
			handled: true,
			context: {
				...this.commandTelemetryContext(envelope),
				errorCode: reply.error.code,
			},
		});
	}

	private commandTelemetryContext(envelope: HubCommandEnvelope) {
		return {
			command: envelope.command,
			requestId: envelope.requestId,
			clientId: envelope.clientId,
			sessionId:
				typeof envelope.payload?.sessionId === "string"
					? envelope.payload.sessionId
					: envelope.sessionId,
		};
	}

	private async handleSettingsList(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const snapshot = await this.settings.list(
				parseSettingsListInput(envelope.payload),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: { snapshot },
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_list_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async handleSettingsToggle(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const result = await this.settings.toggle(
				parseSettingsToggleInput(envelope.payload),
			);
			this.publish(
				buildHubEvent("settings.changed", {
					types: result.changedTypes,
					snapshot: result.snapshot,
				}),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					snapshot: result.snapshot,
					changedTypes: result.changedTypes,
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_toggle_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		const current = this.listeners.get(clientId) ?? new Set();
		const entry = { sessionId: options?.sessionId, listener };
		current.add(entry);
		this.listeners.set(clientId, current);
		return () => {
			const listeners = this.listeners.get(clientId);
			if (!listeners) {
				return;
			}
			listeners.delete(entry);
			if (listeners.size === 0) {
				this.listeners.delete(clientId);
			}
		};
	}

	private detachClientFromSessions(clientId: string): void {
		for (const [sessionId, state] of this.sessionState.entries()) {
			state.participants.delete(clientId);
			if (state.createdByClientId === clientId) {
				state.createdByClientId = undefined;
			}
			if (state.participants.size === 0) {
				this.sessionState.delete(sessionId);
			}
		}
		cancelPendingCapabilityRequests(
			this.ctx,
			(request) => request.targetClientId === clientId,
			`Capability owner client ${clientId} disconnected before request was resolved.`,
		);
	}

	private publish(event: HubEventEnvelope): void {
		for (const entries of this.listeners.values()) {
			for (const entry of entries) {
				if (entry.sessionId && entry.sessionId !== event.sessionId) {
					continue;
				}
				try {
					entry.listener(event);
				} catch (error) {
					logHubBoundaryError(
						`listener threw while publishing ${event.event}`,
						error,
					);
					captureSdkError(this.options.telemetry, {
						component: "core",
						operation: "hub.publish",
						error,
						severity: "warn",
						handled: true,
						context: {
							event: event.event,
							sessionId: event.sessionId,
						},
					});
				}
			}
		}
	}
}

function shouldCaptureHubReplyError(code: string): boolean {
	return (
		code === "session_not_found" ||
		code === "session_messages_not_found" ||
		code === "hub_command_timeout" ||
		code.endsWith("_failed")
	);
}
