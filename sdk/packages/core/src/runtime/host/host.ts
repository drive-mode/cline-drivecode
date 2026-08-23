import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { captureSdkError } from "@cline/shared";
import {
	CatalogManagedSessionRuntime,
	createCatalogWriterLeaseVerifier,
} from "../../chat-catalog/catalog-managed-session-runtime";
import { CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS } from "../../chat-catalog/chat-catalog-authority";
import type {
	CatalogAudienceChatSource,
	CatalogLifecycleEventSource,
} from "../../chat-catalog/chat-catalog-event-source";
import { LocalChatCatalogPort } from "../../chat-catalog/chat-catalog-port";
import {
	type ChatCatalogConfirmationIssuer,
	ChatSessionLifecycleCoordinator,
} from "../../chat-catalog/session-lifecycle-coordinator";
import {
	ChatCatalogError,
	SqliteChatCatalogService,
} from "../../chat-catalog/sqlite-chat-catalog-service";
import type {
	ClineCoreChatLifecycleConfirmationRequest,
	ClineCoreOptions,
} from "../../cline-core/types";
import {
	ensureCompatibleLocalHubUrl,
	resolveCompatibleLocalHubUrl,
} from "../../hub/client";
import { prewarmDetachedHubServer } from "../../hub/daemon";
import { HubRuntimeHost } from "../../hub/runtime-host/hub-runtime-host";
import { RemoteRuntimeHost } from "../../hub/runtime-host/remote-runtime-host";
import {
	type ResolvedResourcePolicy,
	resolveResourcePolicy,
} from "../../resources/policy";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { resolveCoreDistinctId } from "../../services/telemetry/distinct-id";
import { FileSessionService } from "../../session/services/file-session-service";
import { CoreSessionService } from "../../session/services/session-service";
import type { SessionBackend } from "./local/session-record";
import {
	LocalRuntimeHost,
	type LocalRuntimeHostOptions,
} from "./local-runtime-host";
import type { RuntimeHost, RuntimeHostMode } from "./runtime-host";

export type { SessionBackend } from "./local/session-record";

function resolveConfiguredBackendMode(
	options: ClineCoreOptions,
): RuntimeHostMode {
	if (options.backendMode) {
		return options.backendMode;
	}
	if (process.env.CLINE_VCR?.trim()) {
		return "local";
	}
	const raw = process.env.CLINE_SESSION_BACKEND_MODE?.trim().toLowerCase();
	if (raw === "local" || raw === "hub" || raw === "remote") {
		return raw;
	}
	return "auto";
}

let cachedBackend: SessionBackend | undefined;
let backendInitPromise: Promise<SessionBackend> | undefined;

export interface CatalogManagedLocalRuntimeComposition {
	runtime: CatalogManagedSessionRuntime;
	eventSource: CatalogLifecycleEventSource;
	audienceSource?: CatalogAudienceChatSource;
	workspaceRoot: string;
	dispose(): void;
}

const catalogManagedLocalCompositions = new WeakMap<
	RuntimeHost,
	CatalogManagedLocalRuntimeComposition
>();

export function getCatalogManagedLocalRuntimeComposition(
	host: RuntimeHost,
): CatalogManagedLocalRuntimeComposition | undefined {
	return catalogManagedLocalCompositions.get(host);
}

function prewarmLocalHubIfNeeded(
	configuredMode: RuntimeHostMode,
	options: ClineCoreOptions,
): void {
	if (configuredMode !== "auto" && configuredMode !== "hub") {
		return;
	}
	if (options.hub?.endpoint?.trim()) {
		return;
	}
	prewarmDetachedHubServer(
		options.hub?.workspaceRoot?.trim() ||
			options.hub?.cwd?.trim() ||
			process.cwd(),
	);
}

async function reconcileDeadSessionsIfSupported(
	backend: SessionBackend,
): Promise<void> {
	const service = backend as SessionBackend & {
		reconcileDeadSessions?: (limit?: number) => Promise<number>;
	};
	await service.reconcileDeadSessions?.().catch(() => {});
}

function createLocalBackend(options: ClineCoreOptions): SessionBackend {
	try {
		const store = new SqliteSessionStore();
		store.init();
		return new CoreSessionService(store, {
			messagesArtifactUploader: options.messagesArtifactUploader,
			logger: options.logger,
		});
	} catch (error) {
		// Fallback to file-based session service if SQLite is unavailable.
		options.telemetry?.capture({
			event: "session_backend_fallback",
			properties: {
				requestedBackend: "sqlite",
				fallbackBackend: "file",
			},
		});
		captureSdkError(options.telemetry, {
			component: "core",
			operation: "session_backend.sqlite_init",
			error,
			severity: "warn",
			handled: true,
			context: {
				requestedBackend: "sqlite",
				fallbackBackend: "file",
			},
		});
		return new FileSessionService(undefined, {
			messagesArtifactUploader: options.messagesArtifactUploader,
			logger: options.logger,
		});
	}
}

function createLocalRuntimeHost(
	options: ClineCoreOptions,
	distinctId: string,
	resourcePolicy: ResolvedResourcePolicy,
	backend?: SessionBackend,
	writerLeaseVerifier?: LocalRuntimeHostOptions["writerLeaseVerifier"],
): LocalRuntimeHost {
	return new LocalRuntimeHost({
		sessionService:
			backend ?? options.sessionService ?? createLocalBackend(options),
		capabilities: options.capabilities,
		logger: options.logger,
		telemetry: options.telemetry,
		toolPolicies: options.toolPolicies,
		distinctId,
		fetch: options.fetch,
		resourcePolicy: resourcePolicy.profile,
		...(writerLeaseVerifier ? { writerLeaseVerifier } : {}),
	});
}

export function createLocalChatCatalogConfirmationIssuer(options: {
	confirm?: (
		request: ClineCoreChatLifecycleConfirmationRequest,
	) => boolean | Promise<boolean>;
	ttlMs?: number;
	clock?: () => Date;
	credentialFactory?: () => string;
}): ChatCatalogConfirmationIssuer {
	const ttlMs = options.ttlMs ?? 5 * 60_000;
	if (
		!Number.isSafeInteger(ttlMs) ||
		ttlMs <= 0 ||
		ttlMs > CHAT_CATALOG_CONFIRMATION_MAX_LIFETIME_MS
	) {
		throw new ChatCatalogError(
			"invalid_input",
			"managed lifecycle confirmation TTL is invalid",
		);
	}
	const clock = options.clock ?? (() => new Date());
	const credentialFactory =
		options.credentialFactory ?? (() => randomBytes(32).toString("base64url"));
	return {
		issue: async (target) => {
			if (!options.confirm) {
				throw new ChatCatalogError(
					"unsupported_capability",
					"managed lifecycle confirmation UI is not configured",
				);
			}
			const { invocationId: _invocationId, ...request } = target;
			if (!(await options.confirm(Object.freeze(request)))) {
				throw new ChatCatalogError(
					"invalid_input",
					"managed lifecycle confirmation was declined",
				);
			}
			const issuedAt = clock();
			if (!Number.isFinite(issuedAt.getTime())) {
				throw new ChatCatalogError(
					"invalid_input",
					"managed lifecycle confirmation clock is invalid",
				);
			}
			return Object.freeze({
				credential: credentialFactory(),
				...target,
				issuedAt: issuedAt.toISOString(),
				expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
			});
		},
	};
}

function createCatalogManagedLocalRuntimeHost(
	options: ClineCoreOptions,
	distinctId: string,
	resourcePolicy: ResolvedResourcePolicy,
): LocalRuntimeHost {
	const configured = options.chatLifecycle;
	if (!configured) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog-managed local runtime was not configured",
		);
	}
	const confirmationIssuer = createLocalChatCatalogConfirmationIssuer({
		...(configured.confirm ? { confirm: configured.confirm } : {}),
		...(configured.confirmationTtlMs === undefined
			? {}
			: { ttlMs: configured.confirmationTtlMs }),
	});
	const configuredTenantId = configured.tenantId?.trim() || "local";
	if (configuredTenantId !== "local" && !configured.dataDir?.trim()) {
		throw new ChatCatalogError(
			"invalid_input",
			"nonlocal managed lifecycle tenants require an explicit data directory",
		);
	}
	let ownedStore: SqliteSessionStore | undefined;
	let backend: CoreSessionService;
	if (options.sessionService) {
		if (!(options.sessionService instanceof CoreSessionService)) {
			throw new ChatCatalogError(
				"unsupported_capability",
				"catalog-managed local runtime requires SQLite CoreSessionService",
			);
		}
		backend = options.sessionService;
	} else {
		ownedStore = new SqliteSessionStore({
			...(configured.dataDir?.trim()
				? { sessionsDir: configured.dataDir.trim() }
				: {}),
			tenantId: configuredTenantId,
		});
		ownedStore.init();
		backend = new CoreSessionService(ownedStore, {
			messagesArtifactUploader: options.messagesArtifactUploader,
			logger: options.logger,
		});
	}
	const identity = backend.catalogStorageIdentity();
	if (
		(configured.dataDir?.trim() &&
			resolve(identity.dataDir) !== resolve(configured.dataDir.trim())) ||
		(configured.tenantId?.trim() && identity.tenantId !== configuredTenantId)
	) {
		ownedStore?.close();
		throw new ChatCatalogError(
			"invalid_input",
			"managed lifecycle storage options do not match the supplied session service",
		);
	}
	let catalog: SqliteChatCatalogService | undefined;
	try {
		catalog = new SqliteChatCatalogService({
			dataDir: identity.dataDir,
			tenantId: identity.tenantId,
			...(configured.audienceMigrationMappings
				? {
						audienceMigrationMappings: configured.audienceMigrationMappings,
					}
				: {}),
			artifactCleanup: {
				cleanupChatArtifacts: async (input) => {
					for (const sessionId of input.sessionIds) {
						input.signal.throwIfAborted();
						await backend.purgeSessionArtifacts(sessionId, input.signal);
					}
					input.signal.throwIfAborted();
					return {
						receiptId: createHash("sha256")
							.update(
								JSON.stringify({
									attemptId: input.attemptId,
									chatId: input.chatId,
									sessionIds: input.sessionIds,
								}),
							)
							.digest("hex"),
					};
				},
			},
		});
		catalog.init();
		const port = new LocalChatCatalogPort({
			service: catalog,
			tenantId: identity.tenantId,
		});
		const coordinator = new ChatSessionLifecycleCoordinator({
			port,
			workspaceKey: configured.workspaceRoot,
			tenantId: identity.tenantId,
			...(configured.audienceId ? { audienceId: configured.audienceId } : {}),
			principalId: configured.principalId?.trim() || distinctId,
			...(configured.actorLabel ? { actorLabel: configured.actorLabel } : {}),
			source: configured.source ?? {
				kind: "interactive",
				transport: "core-local",
			},
			confirmationIssuer,
			...(configured.mutationFence
				? { mutationFence: configured.mutationFence }
				: {}),
		});
		const host = createLocalRuntimeHost(
			options,
			distinctId,
			resourcePolicy,
			backend,
			createCatalogWriterLeaseVerifier(coordinator),
		);
		const runtime = new CatalogManagedSessionRuntime({ host, coordinator });
		const audienceId = configured.audienceId?.trim() || undefined;
		let disposed = false;
		catalogManagedLocalCompositions.set(host, {
			runtime,
			eventSource: Object.freeze({
				currentSequence: () => {
					if (!catalog) {
						throw new ChatCatalogError(
							"unsupported_capability",
							"catalog lifecycle event source is unavailable",
						);
					}
					return catalog.currentEventSequence();
				},
				listAfter: (input: { afterSequence: number; limit?: number }) => {
					if (!catalog) {
						throw new ChatCatalogError(
							"unsupported_capability",
							"catalog lifecycle event source is unavailable",
						);
					}
					return catalog.listWorkspaceEventsAfter({
						workspaceKey: configured.workspaceRoot,
						...input,
					});
				},
			}),
			...(audienceId
				? {
						audienceSource: Object.freeze({
							currentSequence: () => {
								if (!catalog) {
									throw new ChatCatalogError(
										"unsupported_capability",
										"catalog audience source is unavailable",
									);
								}
								return catalog.currentEventSequence();
							},
							listAfter: (input: { afterSequence: number; limit?: number }) => {
								if (!catalog) {
									throw new ChatCatalogError(
										"unsupported_capability",
										"catalog audience source is unavailable",
									);
								}
								return catalog.listAudienceEventsAfter({
									workspaceKey: configured.workspaceRoot,
									audienceId,
									...input,
								});
							},
							createProjectionSnapshot: (input: {
								catalogState?: "active" | "archived" | "all";
								maxChats: number;
							}) => {
								if (!catalog) {
									throw new ChatCatalogError(
										"unsupported_capability",
										"catalog audience source is unavailable",
									);
								}
								return catalog.createAudienceProjectionSnapshot({
									workspaceKey: configured.workspaceRoot,
									audienceId,
									...input,
								});
							},
							getProjection: (input: { chatId: string }) => {
								if (!catalog) {
									throw new ChatCatalogError(
										"unsupported_capability",
										"catalog audience source is unavailable",
									);
								}
								return catalog.getAudienceProjection({
									chatId: input.chatId,
									workspaceKey: configured.workspaceRoot,
									audienceId,
								});
							},
							getSessionProjection: (input: { sessionId: string }) => {
								if (!catalog) {
									throw new ChatCatalogError(
										"unsupported_capability",
										"catalog audience source is unavailable",
									);
								}
								return catalog.getAudienceSessionProjection({
									sessionId: input.sessionId,
									workspaceKey: configured.workspaceRoot,
									audienceId,
								});
							},
						}),
					}
				: {}),
			workspaceRoot: resolve(configured.workspaceRoot),
			dispose: () => {
				if (disposed) return;
				disposed = true;
				const activeCatalog = catalog;
				catalog = undefined;
				activeCatalog?.close();
				ownedStore?.close();
			},
		});
		return host;
	} catch (error) {
		catalog?.close();
		ownedStore?.close();
		throw error;
	}
}

export async function resolveSessionBackend(
	options: ClineCoreOptions,
): Promise<SessionBackend> {
	if (cachedBackend) {
		return cachedBackend;
	}
	if (backendInitPromise) {
		return await backendInitPromise;
	}

	backendInitPromise = (async () => {
		cachedBackend = createLocalBackend(options);
		await reconcileDeadSessionsIfSupported(cachedBackend);
		return cachedBackend;
	})().finally(() => {
		backendInitPromise = undefined;
	});

	return await backendInitPromise;
}

export async function createRuntimeHost(
	options: ClineCoreOptions,
	resolvedResourcePolicy?: ResolvedResourcePolicy,
): Promise<RuntimeHost> {
	const resourcePolicy =
		resolvedResourcePolicy ??
		resolveResourcePolicy({ overrides: options.resourcePolicy });
	const distinctId = resolveCoreDistinctId(options.distinctId);
	options.telemetry?.setDistinctId(distinctId);
	const configuredMode = resolveConfiguredBackendMode(options);
	if (options.chatLifecycle && configuredMode !== "local") {
		throw new ChatCatalogError(
			"unsupported_capability",
			"catalog-managed lifecycle currently requires backendMode 'local'",
		);
	}
	prewarmLocalHubIfNeeded(configuredMode, options);
	if (configuredMode === "remote") {
		const remoteEndpoint = options.remote?.endpoint?.trim();
		if (!remoteEndpoint) {
			throw new Error(
				"Remote runtime mode requires `remote.endpoint` to be configured.",
			);
		}
		options.logger?.log("Using remote runtime host", {
			endpoint: remoteEndpoint,
		});
		return new RemoteRuntimeHost({
			endpoint: remoteEndpoint,
			authToken: options.remote?.authToken,
			clientType: options.remote?.clientType,
			displayName: options.remote?.displayName,
			workspaceRoot: options.remote?.workspaceRoot,
			cwd: options.remote?.cwd,
			capabilities: options.capabilities,
		});
	}
	if (configuredMode === "hub") {
		const explicitEndpoint = options.hub?.endpoint?.trim();
		const hubUrl =
			explicitEndpoint ||
			(await ensureCompatibleLocalHubUrl({
				strategy: options.hub?.strategy ?? "require-hub",
				workspaceRoot: options.hub?.workspaceRoot,
				cwd: options.hub?.cwd,
			}));
		if (!hubUrl) {
			throw new Error("No compatible hub runtime is available.");
		}
		options.logger?.log("Using hub runtime host", {
			url: hubUrl,
			explicitEndpoint: explicitEndpoint || undefined,
		});
		return new HubRuntimeHost(
			{
				url: hubUrl,
				authToken: options.hub?.authToken,
				clientType: options.hub?.clientType,
				displayName: options.hub?.displayName,
				capabilities: options.capabilities,
				telemetry: options.telemetry,
			},
			{
				workspaceRoot: options.hub?.workspaceRoot,
				cwd: options.hub?.cwd,
			},
		);
	}
	if (configuredMode === "auto") {
		const hubUrl = await resolveCompatibleLocalHubUrl({
			endpoint: options.hub?.endpoint,
			strategy: options.hub?.strategy ?? "prefer-hub",
			workspaceRoot: options.hub?.workspaceRoot,
			cwd: options.hub?.cwd,
		});
		if (hubUrl) {
			options.logger?.log("Using discovered local hub runtime host", {
				url: hubUrl,
			});
			const host = new HubRuntimeHost(
				{
					url: hubUrl,
					authToken: options.hub?.authToken,
					clientType: options.hub?.clientType,
					displayName: options.hub?.displayName,
					capabilities: options.capabilities,
					telemetry: options.telemetry,
				},
				{
					workspaceRoot: options.hub?.workspaceRoot,
					cwd: options.hub?.cwd,
				},
			);
			try {
				await host.connect();
				return host;
			} catch (error) {
				options.logger?.log("Falling back to local runtime host", {
					reason: "hub_connect_failed",
					severity: "warn",
					error,
				});
				captureSdkError(options.telemetry, {
					component: "core",
					operation: "runtime_host.hub_connect",
					error,
					severity: "warn",
					handled: true,
					context: {
						backendMode: "auto",
						fallbackBackend: "local",
					},
				});
			}
		}
		options.logger?.log("Falling back to local runtime host", {
			reason: "compatible_hub_unavailable",
			severity: "warn",
		});
		return createLocalRuntimeHost(options, distinctId, resourcePolicy);
	}
	return options.chatLifecycle
		? createCatalogManagedLocalRuntimeHost(options, distinctId, resourcePolicy)
		: createLocalRuntimeHost(options, distinctId, resourcePolicy);
}
