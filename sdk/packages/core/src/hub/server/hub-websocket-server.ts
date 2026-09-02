import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { URL } from "node:url";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_CAPABILITIES,
	isHubProtocolCompatible,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import { WebSocketServer } from "ws";
import corePackage from "../../../package.json";
import {
	type HubChatCatalogConfirmationTarget,
	normalizeHubChatCatalogConfirmationTarget,
} from "../../chat-catalog/hub-chat-catalog-confirmation-broker";
import { resolveResourcePolicy } from "../../resources/policy";
import { rememberRecoverableLocalHubUrl, verifyHubConnection } from "../client";
import {
	clearHubDiscovery,
	createHubAuthToken,
	createHubServerUrl,
	createHubWorkspaceScopeId,
	type HubServerDiscoveryRecord,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
	resolveHubOwnerContext,
	withHubStartupLock,
	writeHubDiscovery,
} from "../discovery";
import { resolveDefaultHubPort } from "../discovery/defaults";
import { DEFAULT_WEBSOCKET_MAX_INBOUND_PAYLOAD_BYTES } from "./bounded-outbound-channel";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";
import type {
	EnsuredHubWebSocketServerResult,
	EnsureHubWebSocketServerOptions,
	HubWebSocketServer,
	HubWebSocketServerOptions,
	HubWorkspaceConnectionDescriptor,
} from "./hub-server-options";
import { HubServerTransport } from "./hub-server-transport";
import {
	bindHubWorkspaceConnectionPolicyToInstalledInstance,
	HUB_WORKSPACE_DENY_ALL_POLICY,
	type HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
	normalizeHubWorkspaceConnectionPolicy,
} from "./workspace-capability-authority";
import { HubWorkspaceCapabilityRegistry } from "./workspace-capability-registry";
import {
	type HubWorkspaceManagedConfirmationRequester,
	HubWorkspaceManagedCorePool,
} from "./workspace-managed-core-pool";

export { truncateNotificationBody } from "./hub-notifications";
export type {
	EnsuredHubWebSocketServerResult,
	EnsureHubWebSocketServerOptions,
	HubWebSocketServer,
	HubWebSocketServerOptions,
} from "./hub-server-options";
export { HubServerTransport } from "./hub-server-transport";

/** @internal Exported for capability-advertisement tests. */
export function resolveHubCapabilities(
	options: Pick<
		HubWebSocketServerOptions,
		"chatCatalog" | "managedChatLifecycleEnabled"
	>,
): readonly string[] {
	return [
		...HUB_CAPABILITIES,
		...(options.managedChatLifecycleEnabled === true
			? ([
					"chat_projection.v1",
					"chat_lifecycle.v1",
					"chat_runtime.v1",
				] as const)
			: []),
	];
}

type NodeWebSocketLike = {
	send(data: string, callback?: (error?: Error) => void): void;
	close(code?: number, reason?: string): void;
	on(event: "message", listener: (data: unknown) => void): void;
	on(event: "close", listener: () => void): void;
	on(event: "pong", listener: () => void): void;
	once(event: "close", listener: () => void): void;
	ping?(): void;
	terminate?(): void;
};

type TrackedNodeWebSocket = NodeWebSocketLike & {
	isAlive?: boolean;
};

type NodeUpgradeSocketLike = {
	destroy(error?: Error): void;
	write(chunk: string): boolean;
	end(): void;
};

function decodeSocketData(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return Buffer.from(data).toString();
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString();
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString();
	}
	return String(data);
}

function wrapWsSocket(socket: NodeWebSocketLike) {
	return {
		send(data: string, callback?: (error?: unknown) => void): void {
			socket.send(data, callback as ((error?: Error) => void) | undefined);
		},
		close(code?: number, reason?: string): void {
			socket.close(code, reason);
		},
		terminate(): void {
			socket.terminate?.();
		},
		addEventListener(
			type: "message" | "close",
			listener: (...args: never[]) => void,
		): void {
			if (type === "message") {
				socket.on("message", (data: unknown) => {
					(listener as (event: { data: string }) => void)({
						data: decodeSocketData(data),
					});
				});
				return;
			}
			socket.on("close", listener as () => void);
		},
		removeEventListener(): void {},
	};
}

function rejectUpgradeSocket(socket: NodeUpgradeSocketLike): void {
	try {
		socket.write(
			"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

function rejectUnauthorizedUpgradeSocket(socket: NodeUpgradeSocketLike): void {
	try {
		socket.write(
			"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

function isValidHubAuthToken(
	candidate: string | null,
	expected: string,
): boolean {
	if (!candidate || !expected) {
		return false;
	}
	const candidateBuffer = Buffer.from(candidate, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	return (
		candidateBuffer.length === expectedBuffer.length &&
		timingSafeEqual(candidateBuffer, expectedBuffer)
	);
}

function formatHubStartupError(
	error: unknown,
	context: {
		host: string;
		port: number;
		pathname: string;
	},
): Error {
	const code =
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
			? (error as { code: string }).code
			: undefined;
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown startup error";
	const details = `Failed to start hub server on ${context.host}:${context.port}${context.pathname}: ${message}`;
	const wrapped = new Error(code ? `${details} (${code})` : details);
	if (code) {
		(error as Error & { code?: string }).code = code;
		(wrapped as Error & { code?: string }).code = code;
	}
	if (error instanceof Error && error.stack) {
		wrapped.stack = `${wrapped.name}: ${wrapped.message}\nCaused by: ${error.stack}`;
	}
	return wrapped;
}

async function resolveEphemeralPort(host: string): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const probe = net.createServer();
		probe.once("error", reject);
		probe.listen(0, host, () => {
			const address = probe.address();
			if (!address || typeof address === "string") {
				probe.close(() => reject(new Error("Failed to resolve free port")));
				return;
			}
			const port = address.port;
			probe.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
	});
}

function isAddressInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as Error & { code?: string }).code === "EADDRINUSE"
	);
}

const SHARED_SERVERS = new Map<string, Promise<HubWebSocketServer>>();
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";
const HUB_WORKSPACE_AUTH_PROTOCOL_PREFIX = "cline-hub-workspace.";
const HUB_SOCKET_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_CATALOG_CONFIRMATION_PROMPT_TIMEOUT_MS = 30_000;
const MAX_CATALOG_CONFIRMATION_PROMPT_TIMEOUT_MS = 5 * 60_000;
const MAX_PENDING_CATALOG_CONFIRMATIONS_PER_CONNECTION = 8;
const MAX_PENDING_CATALOG_CONFIRMATIONS = 1_024;

function parseHeaderValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value.join(",") : (value ?? "");
}

function isAuthHeaderWhitespace(code: number): boolean {
	return code === 0x20 || code === 0x09;
}

/** @internal Exported for focused payload-limit tests. */
export function resolveHubMaxInboundPayloadBytes(
	options: Pick<HubWebSocketServerOptions, "maxInboundPayloadBytes">,
): number {
	return (
		options.maxInboundPayloadBytes ??
		DEFAULT_WEBSOCKET_MAX_INBOUND_PAYLOAD_BYTES
	);
}

/** @internal Resolves one immutable policy view for transport and runtime ownership. */
export function resolveHubResourceOptions(
	options: HubWebSocketServerOptions,
): HubWebSocketServerOptions {
	const resourcePolicy = resolveResourcePolicy({
		overrides: options.resourcePolicy,
	});
	const websocketPolicy = resourcePolicy.profile.transport.websocket;
	return {
		...options,
		resourcePolicy: resourcePolicy.profile,
		maxInboundPayloadBytes:
			options.maxInboundPayloadBytes ?? websocketPolicy.maxInboundPayloadBytes,
		websocketDelivery: {
			softWatermarkBytes: websocketPolicy.softWatermarkBytes,
			hardWatermarkBytes: websocketPolicy.hardWatermarkBytes,
			congestionGraceMs: websocketPolicy.congestionGraceMs,
			closeGraceMs: websocketPolicy.closeGraceMs,
			...options.websocketDelivery,
		},
	};
}

export function readBearerToken(
	value: string | string[] | undefined,
): string | null {
	const header = parseHeaderValue(value).trim();
	const bearerScheme = "bearer";
	if (
		header.length <= bearerScheme.length ||
		header.slice(0, bearerScheme.length).toLowerCase() !== bearerScheme ||
		!isAuthHeaderWhitespace(header.charCodeAt(bearerScheme.length))
	) {
		return null;
	}

	let tokenStart = bearerScheme.length + 1;
	while (
		tokenStart < header.length &&
		isAuthHeaderWhitespace(header.charCodeAt(tokenStart))
	) {
		tokenStart += 1;
	}

	return header.slice(tokenStart).trim() || null;
}

function readWebSocketAuthToken(
	value: string | string[] | undefined,
): string | null {
	for (const protocol of parseHeaderValue(value).split(",")) {
		const trimmed = protocol.trim();
		if (trimmed.startsWith(HUB_AUTH_PROTOCOL_PREFIX)) {
			return trimmed.slice(HUB_AUTH_PROTOCOL_PREFIX.length).trim() || null;
		}
	}
	return null;
}

/** @internal Exported for workspace-upgrade protocol tests. */
export function readWebSocketWorkspaceCapability(
	value: string | string[] | undefined,
): string | null {
	let credential: string | undefined;
	for (const protocol of parseHeaderValue(value).split(",")) {
		const trimmed = protocol.trim();
		if (trimmed.startsWith(HUB_WORKSPACE_AUTH_PROTOCOL_PREFIX)) {
			const candidate = trimmed
				.slice(HUB_WORKSPACE_AUTH_PROTOCOL_PREFIX.length)
				.trim();
			if (!candidate || credential !== undefined) return null;
			credential = candidate;
		}
	}
	return credential ?? null;
}

/** @internal Exported for websocket auth tests. */
export function isLocalHubHostName(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1" ||
		normalized === "[::1]"
	);
}

/** @internal Exported for websocket auth tests. */
export function isLocalHubOrigin(
	value: string | string[] | undefined,
): boolean {
	const raw = parseHeaderValue(value).trim();
	if (!raw) {
		return false;
	}
	try {
		return isLocalHubHostName(new URL(raw).hostname);
	} catch {
		return false;
	}
}

export async function startHubWebSocketServer(
	options: HubWebSocketServerOptions,
): Promise<HubWebSocketServer> {
	const resolvedOptions = resolveHubResourceOptions(options);
	let chatCatalogHostDisposed = false;
	const disposeChatCatalogHost = async (): Promise<void> => {
		if (chatCatalogHostDisposed) return;
		chatCatalogHostDisposed = true;
		await resolvedOptions.chatCatalog?.dispose?.();
	};
	const owner = options.owner ?? resolveHubOwnerContext();
	const host = options.host ?? "127.0.0.1";
	const pathname = options.pathname ?? "/hub";
	const configuredPort = options.port ?? resolveDefaultHubPort();
	const requestedPort =
		configuredPort === 0 ? await resolveEphemeralPort(host) : configuredPort;
	let port = requestedPort;
	let url = createHubServerUrl(host, requestedPort, pathname);
	const buildId = resolveHubBuildId();
	const authToken = createHubAuthToken();
	const trustedWorkspaceKeys =
		resolvedOptions.workspaceAuthority?.trustedWorkspaceKeys ?? [];
	const configuredConnectionPolicies = new Map(
		(resolvedOptions.workspaceAuthority?.connectionPolicies ?? []).map(
			(candidate) => {
				const policy = normalizeHubWorkspaceConnectionPolicy(candidate);
				return [policy.authorityClassId, policy] as const;
			},
		),
	);
	if (
		configuredConnectionPolicies.size !==
		(resolvedOptions.workspaceAuthority?.connectionPolicies?.length ?? 0)
	) {
		throw new Error("Hub workspace authority classes must be unique.");
	}
	const configuredInstanceBoundAuthorityClassIds = (
		resolvedOptions.workspaceAuthority?.instanceBoundAuthorityClassIds ?? []
	).map((authorityClassId) => authorityClassId.trim());
	if (
		configuredInstanceBoundAuthorityClassIds.some(
			(authorityClassId) => !authorityClassId || authorityClassId.length > 512,
		) ||
		new Set(configuredInstanceBoundAuthorityClassIds).size !==
			configuredInstanceBoundAuthorityClassIds.length
	) {
		throw new Error(
			"Hub instance-bound workspace authority classes must be unique and valid.",
		);
	}
	const instanceBoundAuthorityClassIds = new Set(
		configuredInstanceBoundAuthorityClassIds,
	);
	for (const authorityClassId of instanceBoundAuthorityClassIds) {
		if (!configuredConnectionPolicies.has(authorityClassId)) {
			throw new Error(
				"Hub instance-bound workspace authority class is unavailable.",
			);
		}
	}
	for (const policy of configuredConnectionPolicies.values()) {
		if (policy.installedInstanceId !== undefined) {
			throw new Error(
				"Hub configured workspace connection policies must be unbound templates.",
			);
		}
		if (
			policy.allowedBindingProfileIds.length > 0 !==
			instanceBoundAuthorityClassIds.has(policy.authorityClassId)
		) {
			throw new Error(
				"Hub binding-capable workspace authority classes must require an installed instance.",
			);
		}
	}
	const defaultConnectionPolicy = normalizeHubWorkspaceConnectionPolicy(
		resolvedOptions.workspaceAuthority?.defaultConnectionPolicy ??
			HUB_WORKSPACE_DENY_ALL_POLICY,
	);
	const registeredDefaultPolicy = configuredConnectionPolicies.get(
		defaultConnectionPolicy.authorityClassId,
	);
	if (
		configuredConnectionPolicies.size > 0 &&
		(!registeredDefaultPolicy ||
			JSON.stringify(registeredDefaultPolicy) !==
				JSON.stringify(defaultConnectionPolicy))
	) {
		throw new Error(
			"Hub default workspace authority class must exactly match its registry entry.",
		);
	}
	if (
		instanceBoundAuthorityClassIds.has(defaultConnectionPolicy.authorityClassId)
	) {
		throw new Error(
			"Hub default workspace authority cannot require an installed-instance binding.",
		);
	}
	const workspaceScopeId =
		trustedWorkspaceKeys.length === 1 && trustedWorkspaceKeys[0]
			? createHubWorkspaceScopeId(authToken, trustedWorkspaceKeys[0])
			: undefined;
	const workspaceCapabilities = new HubWorkspaceCapabilityAuthority();
	if (resolvedOptions.workspaceAuthority && !resolvedOptions.chatCatalog) {
		throw new Error(
			"Hub workspace authority requires a configured chat catalog host.",
		);
	}
	if (
		resolvedOptions.workspaceManagedCoreFactory &&
		!resolvedOptions.workspaceAuthority
	) {
		throw new Error(
			"Hub workspace managed Core requires configured workspace authority.",
		);
	}
	if (
		resolvedOptions.managedChatLifecycleEnabled === true &&
		!resolvedOptions.workspaceManagedCoreFactory
	) {
		throw new Error(
			"Enabled Hub managed lifecycle requires a configured managed Core factory.",
		);
	}
	const workspaceManagedCores = resolvedOptions.workspaceManagedCoreFactory
		? new HubWorkspaceManagedCorePool(
				workspaceCapabilities,
				resolvedOptions.workspaceManagedCoreFactory,
			)
		: undefined;
	const confirmationPromptTimeoutMs =
		resolvedOptions.workspaceAuthority?.confirmationPromptTimeoutMs ??
		DEFAULT_CATALOG_CONFIRMATION_PROMPT_TIMEOUT_MS;
	if (
		!Number.isSafeInteger(confirmationPromptTimeoutMs) ||
		confirmationPromptTimeoutMs < 1 ||
		confirmationPromptTimeoutMs > MAX_CATALOG_CONFIRMATION_PROMPT_TIMEOUT_MS
	) {
		throw new Error("Hub catalog confirmation prompt timeout is invalid.");
	}
	const workspaceRegistry = new HubWorkspaceCapabilityRegistry(
		workspaceCapabilities,
	);
	for (const workspaceKey of trustedWorkspaceKeys) {
		workspaceRegistry.register({
			principalId: owner.ownerId,
			tenantId: "local",
			workspaceKey,
		});
	}
	let requestManagedCatalogConfirmation: HubWorkspaceManagedConfirmationRequester =
		async () => {
			throw new Error("Hub catalog confirmation is not configured.");
		};
	const transport = new HubServerTransport(
		resolvedOptions,
		workspaceCapabilities,
		workspaceManagedCores,
		(input) => requestManagedCatalogConfirmation(input),
	);
	try {
		await transport.start();
	} catch (error) {
		const cleanup = await Promise.allSettled([
			transport.stop(),
			disposeChatCatalogHost(),
		]);
		const failures = cleanup.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (failures.length > 0) {
			throw new AggregateError(
				[error, ...failures],
				"Hub transport startup and cleanup failed",
			);
		}
		throw error;
	}
	const adapter = new BrowserWebSocketHubAdapter(
		options.telemetry,
		resolvedOptions.websocketDelivery,
		resolveResourcePolicy({
			overrides: resolvedOptions.resourcePolicy,
		}).profile.transport.websocket.maxActiveSubscriptions,
	);
	const cleanup = new Set<() => void>();
	const startedAt = new Date().toISOString();
	const versionPayload = {
		protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
		minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
		maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
		capabilities: resolveHubCapabilities(resolvedOptions),
		coreVersion: corePackage.version,
		buildId,
		pid: process.pid,
		startedAt,
	} as const;
	const sockets = new Set<TrackedNodeWebSocket>();
	const activeWorkspaceConnections = new Map<
		string,
		HubAuthenticatedConnection
	>();
	const pendingCatalogConfirmationPrompts = new Map<
		string,
		Set<AbortController>
	>();
	let pendingCatalogConfirmationPromptCount = 0;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let closePromise: Promise<void> | undefined;
	let workspaceAuthorityActive = true;
	const assertWorkspaceAuthorityActive = (): void => {
		if (!workspaceAuthorityActive) {
			throw new Error("Hub workspace authority is closed.");
		}
	};
	const describeWorkspaceConnection = (
		identity: HubAuthenticatedConnection,
	): HubWorkspaceConnectionDescriptor => {
		workspaceCapabilities.assertActive(identity);
		const registration = workspaceRegistry.registrationForConnection(identity);
		return Object.freeze({
			connectionId: identity.connectionId,
			principalId: identity.principalId,
			tenantId: identity.tenantId,
			workspaceId: registration.workspaceId,
			workspaceEpoch: identity.workspaceEpoch,
			authorityClassId: identity.policy.authorityClassId,
			policyEpoch: identity.policy.policyEpoch,
			authenticatedAt: identity.authenticatedAt,
		});
	};
	const requireActiveWorkspaceConnection = (
		connectionId: string,
	): HubAuthenticatedConnection => {
		const normalized = connectionId.trim();
		const identity = activeWorkspaceConnections.get(normalized);
		if (!normalized || normalized.length > 512 || !identity) {
			throw new Error("Hub workspace connection is missing or inactive.");
		}
		workspaceCapabilities.assertActive(identity);
		return identity;
	};
	const revokeWorkspaceConnection = (connectionId: string): void => {
		activeWorkspaceConnections.delete(connectionId);
		const prompts = pendingCatalogConfirmationPrompts.get(connectionId);
		pendingCatalogConfirmationPrompts.delete(connectionId);
		for (const controller of prompts ?? []) controller.abort();
		resolvedOptions.chatCatalog?.confirmationBroker.revokeClient(connectionId);
	};
	const promptCatalogMutation = async (
		identity: HubAuthenticatedConnection,
		rawTarget: HubChatCatalogConfirmationTarget,
		externalSignal?: AbortSignal,
	): Promise<boolean> => {
		assertWorkspaceAuthorityActive();
		const confirm = resolvedOptions.workspaceAuthority?.confirmCatalogMutation;
		if (!confirm) {
			throw new Error("Hub catalog confirmation is not configured.");
		}
		const activeIdentity = requireActiveWorkspaceConnection(
			identity.connectionId,
		);
		if (activeIdentity !== identity) {
			throw new Error("Hub catalog confirmation failed.");
		}
		const descriptor = describeWorkspaceConnection(identity);
		const target = normalizeHubChatCatalogConfirmationTarget(rawTarget);
		const displayTarget = Object.freeze({
			confirmation: target.confirmation,
			aggregateKind: target.aggregateKind,
			aggregateId: target.aggregateId,
			expectedRevision: target.expectedRevision,
			...(target.effects
				? { effects: Object.freeze([...target.effects]) }
				: {}),
		});
		const controller = new AbortController();
		let prompts = pendingCatalogConfirmationPrompts.get(identity.connectionId);
		if (
			(prompts?.size ?? 0) >=
				MAX_PENDING_CATALOG_CONFIRMATIONS_PER_CONNECTION ||
			pendingCatalogConfirmationPromptCount >= MAX_PENDING_CATALOG_CONFIRMATIONS
		) {
			throw new Error("Hub catalog confirmation limit was reached.");
		}
		if (externalSignal?.aborted) {
			throw new Error("Hub catalog confirmation failed.");
		}
		if (!prompts) {
			prompts = new Set();
			pendingCatalogConfirmationPrompts.set(identity.connectionId, prompts);
		}
		const abortFromExternal = () => controller.abort();
		externalSignal?.addEventListener("abort", abortFromExternal, {
			once: true,
		});
		prompts.add(controller);
		pendingCatalogConfirmationPromptCount += 1;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let confirmed: boolean;
		try {
			const aborted = new Promise<never>((_resolve, reject) => {
				controller.signal.addEventListener(
					"abort",
					() => reject(new Error("confirmation aborted")),
					{ once: true },
				);
			});
			timeout = setTimeout(
				() => controller.abort(),
				confirmationPromptTimeoutMs,
			);
			confirmed = await Promise.race([
				Promise.resolve().then(() =>
					confirm(
						Object.freeze({
							target: displayTarget,
							signal: controller.signal,
						}),
					),
				),
				aborted,
			]);
		} catch {
			throw new Error("Hub catalog confirmation failed.");
		} finally {
			if (timeout) clearTimeout(timeout);
			controller.abort();
			externalSignal?.removeEventListener("abort", abortFromExternal);
			prompts.delete(controller);
			pendingCatalogConfirmationPromptCount -= 1;
			if (prompts.size === 0) {
				pendingCatalogConfirmationPrompts.delete(identity.connectionId);
			}
		}
		try {
			assertWorkspaceAuthorityActive();
			const current = requireActiveWorkspaceConnection(identity.connectionId);
			if (
				current !== identity ||
				describeWorkspaceConnection(current).workspaceId !==
					descriptor.workspaceId
			) {
				throw new Error("identity changed");
			}
		} catch {
			throw new Error("Hub catalog confirmation failed.");
		}
		return confirmed === true;
	};
	requestManagedCatalogConfirmation = async (input) => {
		const target = normalizeHubChatCatalogConfirmationTarget({
			...input.request,
			invocationId: input.operationId,
		});
		return await promptCatalogMutation(input.identity, target, input.signal);
	};
	const workspaceAuthority = resolvedOptions.workspaceAuthority
		? Object.freeze({
				list: () => {
					assertWorkspaceAuthorityActive();
					return workspaceRegistry.list({
						principalId: owner.ownerId,
						tenantId: "local",
					});
				},
				listConnections: () => {
					assertWorkspaceAuthorityActive();
					const descriptors: HubWorkspaceConnectionDescriptor[] = [];
					for (const [connectionId, identity] of activeWorkspaceConnections) {
						try {
							descriptors.push(describeWorkspaceConnection(identity));
						} catch {
							activeWorkspaceConnections.delete(connectionId);
						}
					}
					return Object.freeze(
						descriptors.sort((left, right) =>
							left.connectionId.localeCompare(right.connectionId),
						),
					);
				},
				issue: (input: {
					workspaceId: string;
					ttlMs?: number;
					authorityClassId?: string;
				}) => {
					assertWorkspaceAuthorityActive();
					const policy = input.authorityClassId
						? configuredConnectionPolicies.get(input.authorityClassId.trim())
						: defaultConnectionPolicy;
					if (!policy) {
						throw new Error("Hub workspace authority class is unavailable.");
					}
					if (instanceBoundAuthorityClassIds.has(policy.authorityClassId)) {
						throw new Error(
							"Hub workspace authority class requires an installed-instance binding.",
						);
					}
					return workspaceRegistry.issue({
						principalId: owner.ownerId,
						tenantId: "local",
						workspaceId: input.workspaceId,
						...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
						policy,
					});
				},
				issueForInstalledInstance: (input: {
					workspaceId: string;
					authorityClassId: string;
					installedInstanceId: string;
					ttlMs?: number;
				}) => {
					assertWorkspaceAuthorityActive();
					const authorityClassId = input.authorityClassId.trim();
					if (!instanceBoundAuthorityClassIds.has(authorityClassId)) {
						throw new Error(
							"Hub installed-instance workspace authority class is unavailable.",
						);
					}
					const template = configuredConnectionPolicies.get(authorityClassId);
					if (!template) {
						throw new Error("Hub workspace authority class is unavailable.");
					}
					const policy = bindHubWorkspaceConnectionPolicyToInstalledInstance(
						template,
						input.installedInstanceId,
					);
					return workspaceRegistry.issue({
						principalId: owner.ownerId,
						tenantId: "local",
						workspaceId: input.workspaceId,
						...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
						policy,
					});
				},
				requestCatalogConfirmation: async (input: {
					connectionId: string;
					target: HubChatCatalogConfirmationTarget;
					ttlMs?: number;
				}) => {
					assertWorkspaceAuthorityActive();
					const broker = resolvedOptions.chatCatalog?.confirmationBroker;
					if (!broker) {
						throw new Error("Hub catalog confirmation is not configured.");
					}
					const identity = requireActiveWorkspaceConnection(input.connectionId);
					const target = normalizeHubChatCatalogConfirmationTarget(
						input.target,
					);
					if (!(await promptCatalogMutation(identity, target))) {
						throw new Error("Hub catalog confirmation was declined.");
					}
					assertWorkspaceAuthorityActive();
					if (
						requireActiveWorkspaceConnection(identity.connectionId) !== identity
					) {
						throw new Error("Hub catalog confirmation failed.");
					}
					return broker.issue({
						authenticatedClientId: identity.connectionId,
						target,
						...(input.ttlMs !== undefined ? { ttlMs: input.ttlMs } : {}),
					});
				},
				revoke: async (workspaceId: string) => {
					assertWorkspaceAuthorityActive();
					const revocation = workspaceRegistry.revoke({
						principalId: owner.ownerId,
						tenantId: "local",
						workspaceId,
					});
					await workspaceManagedCores?.revokeWorkspace({
						tenantId: revocation.tenantId,
						workspaceKey: revocation.workspaceKey,
					});
				},
				unregister: async (workspaceId: string) => {
					assertWorkspaceAuthorityActive();
					const result = workspaceRegistry.unregister({
						principalId: owner.ownerId,
						tenantId: "local",
						workspaceId,
					});
					await workspaceManagedCores?.revokeWorkspace({
						tenantId: result.revocation.tenantId,
						workspaceKey: result.revocation.workspaceKey,
					});
				},
			})
		: undefined;

	const closeServer = async (): Promise<void> => {
		if (closePromise) {
			return closePromise;
		}
		closePromise = (async () => {
			workspaceAuthorityActive = false;
			const workspaceRetirements: Promise<void>[] = [];
			for (const registration of workspaceRegistry.list({
				principalId: owner.ownerId,
				tenantId: "local",
			})) {
				const result = workspaceRegistry.unregister({
					principalId: owner.ownerId,
					tenantId: "local",
					workspaceId: registration.workspaceId,
				});
				if (workspaceManagedCores) {
					workspaceRetirements.push(
						workspaceManagedCores.revokeWorkspace({
							tenantId: result.revocation.tenantId,
							workspaceKey: result.revocation.workspaceKey,
						}),
					);
				}
			}
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = undefined;
			}
			for (const websocket of sockets) {
				websocket.terminate?.();
			}
			sockets.clear();
			for (const detach of cleanup) {
				detach();
			}
			cleanup.clear();
			for (const connectionId of [...activeWorkspaceConnections.keys()]) {
				revokeWorkspaceConnection(connectionId);
			}
			const settled = await Promise.allSettled([
				...workspaceRetirements,
				new Promise<void>((resolve, reject) => {
					wss.close((error?: Error) => {
						if (error) reject(error);
						else resolve();
					});
				}),
				new Promise<void>((resolve, reject) => {
					server.close((error) => {
						if (error) reject(error);
						else resolve();
					});
				}),
				transport.stop(),
				(async () => {
					const current = await readHubDiscovery(owner.discoveryPath);
					if (current?.url === url) {
						await clearHubDiscovery(owner.discoveryPath);
					}
				})(),
			]);
			const failures = settled.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			try {
				await disposeChatCatalogHost();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length > 0) {
				throw new AggregateError(failures, "Hub server shutdown failed");
			}
		})();
		return closePromise;
	};

	const server = http.createServer((req, res) => {
		if ((req.url ?? "/") === "/health") {
			const body = JSON.stringify({
				ok: true,
				protocolVersion: versionPayload.protocolVersion,
				minClientProtocolVersion: versionPayload.minClientProtocolVersion,
				maxClientProtocolVersion: versionPayload.maxClientProtocolVersion,
				coreVersion: versionPayload.coreVersion,
				host,
				port,
				url,
			});
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(body);
			return;
		}
		if ((req.url ?? "/") === "/status") {
			if (
				!isValidHubAuthToken(
					readBearerToken(req.headers.authorization),
					authToken,
				)
			) {
				res.statusCode = 401;
				res.end("Unauthorized");
				return;
			}
			const body = JSON.stringify({
				hubId: transport.getHubId(),
				...versionPayload,
				...(workspaceScopeId ? { workspaceScopeId } : {}),
				authToken,
				host,
				port,
				url,
				updatedAt: new Date().toISOString(),
			} satisfies HubServerDiscoveryRecord);
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(body);
			return;
		}
		if ((req.url ?? "/") === "/version") {
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(versionPayload));
			return;
		}
		const requestUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
		if (
			requestUrl.pathname === "/workspace-capability" &&
			req.method === "POST"
		) {
			if (
				!isValidHubAuthToken(
					readBearerToken(req.headers.authorization),
					authToken,
				)
			) {
				res.statusCode = 401;
				res.end("Unauthorized");
				return;
			}
			if (!workspaceAuthority) {
				res.statusCode = 404;
				res.end("Not found");
				return;
			}
			if (requestUrl.search !== "") {
				res.statusCode = 400;
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						error:
							"Hub workspace capability request must not select a workspace.",
					}),
				);
				return;
			}
			const contentLength = req.headers["content-length"]?.trim();
			if (
				req.headers["transfer-encoding"] !== undefined ||
				(contentLength !== undefined && contentLength !== "0")
			) {
				res.statusCode = 400;
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						error: "Hub workspace capability request must be empty.",
					}),
				);
				req.resume();
				return;
			}
			try {
				const registrations = workspaceAuthority.list();
				if (registrations.length !== 1 || !registrations[0]) {
					res.statusCode = 409;
					res.setHeader("content-type", "application/json");
					res.end(
						JSON.stringify({
							error: "Hub workspace selection is unavailable.",
						}),
					);
					return;
				}
				const grant = workspaceAuthority.issue({
					workspaceId: registrations[0].workspaceId,
				});
				res.statusCode = 201;
				res.setHeader("content-type", "application/json");
				res.setHeader("cache-control", "no-store");
				res.end(JSON.stringify(grant));
			} catch {
				res.statusCode = 503;
				res.setHeader("content-type", "application/json");
				res.end(
					JSON.stringify({
						error: "Hub workspace capability is unavailable.",
					}),
				);
			}
			return;
		}
		if (requestUrl.pathname === "/shutdown" && req.method === "POST") {
			if (
				!isValidHubAuthToken(
					readBearerToken(req.headers.authorization),
					authToken,
				)
			) {
				res.statusCode = 401;
				res.end("Unauthorized");
				return;
			}
			res.statusCode = 202;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ ok: true }));
			queueMicrotask(() => {
				try {
					void Promise.resolve(options.onShutdownRequested?.()).catch(
						() => undefined,
					);
				} catch {
					// The accepted request still closes the server if owner
					// notification fails.
				} finally {
					// Closing is memoized, so the daemon coordinator and this
					// safety path converge on the same teardown operation.
					closeServer().catch(() => undefined);
				}
			});
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
	});
	const wss = new WebSocketServer({
		noServer: true,
		maxPayload: resolveHubMaxInboundPayloadBytes(resolvedOptions),
	});
	heartbeatTimer = setInterval(() => {
		for (const websocket of sockets) {
			if (websocket.isAlive === false) {
				try {
					websocket.terminate?.();
				} catch {
					// The socket is already unhealthy; cleanup below is sufficient.
				}
				sockets.delete(websocket);
				continue;
			}
			websocket.isAlive = false;
			try {
				websocket.ping?.();
			} catch {
				try {
					websocket.terminate?.();
				} catch {
					// best-effort termination
				}
				sockets.delete(websocket);
			}
		}
	}, HUB_SOCKET_HEARTBEAT_INTERVAL_MS);

	server.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
		if (requestUrl.pathname !== pathname) {
			socket.destroy();
			return;
		}
		const protocolHeader = request.headers["sec-websocket-protocol"];
		const workspaceCredential =
			readWebSocketWorkspaceCapability(protocolHeader);
		const workspaceProtocolPresented = parseHeaderValue(protocolHeader)
			.split(",")
			.some((protocol) =>
				protocol.trim().startsWith(HUB_WORKSPACE_AUTH_PROTOCOL_PREFIX),
			);
		let upgradedSocket: NodeWebSocketLike | undefined;
		let authenticatedConnection: HubAuthenticatedConnection | undefined;
		if (workspaceProtocolPresented) {
			if (!workspaceCredential) {
				rejectUnauthorizedUpgradeSocket(socket);
				return;
			}
			try {
				authenticatedConnection = workspaceCapabilities.consume({
					credential: workspaceCredential,
					transport: "websocket",
					close: () => {
						const connectionId = authenticatedConnection?.connectionId;
						if (connectionId) {
							revokeWorkspaceConnection(connectionId);
						}
						upgradedSocket?.close(4003, "Workspace authority revoked");
					},
				});
			} catch {
				// A presented but invalid workspace credential cannot downgrade to
				// daemon-token or Origin authentication.
				rejectUnauthorizedUpgradeSocket(socket);
				return;
			}
		}
		const isAuthorized =
			authenticatedConnection !== undefined ||
			isValidHubAuthToken(readWebSocketAuthToken(protocolHeader), authToken) ||
			(isLocalHubHostName(host) && isLocalHubOrigin(request.headers.origin));
		if (!isAuthorized) {
			rejectUnauthorizedUpgradeSocket(socket);
			return;
		}
		try {
			wss.handleUpgrade(
				request,
				socket,
				head,
				(websocket: NodeWebSocketLike) => {
					upgradedSocket = websocket;
					const tracked = websocket as TrackedNodeWebSocket;
					tracked.isAlive = true;
					tracked.on("pong", () => {
						tracked.isAlive = true;
					});
					sockets.add(tracked);
					const socketTransport = authenticatedConnection
						? transport.openConnection(authenticatedConnection)
						: transport.openUnscopedConnection();
					const detach = adapter.attach(
						wrapWsSocket(websocket),
						socketTransport,
					);
					if (authenticatedConnection) {
						activeWorkspaceConnections.set(
							authenticatedConnection.connectionId,
							authenticatedConnection,
						);
					}
					cleanup.add(detach);
					websocket.once("close", () => {
						sockets.delete(tracked);
						if (authenticatedConnection) {
							revokeWorkspaceConnection(authenticatedConnection.connectionId);
						}
						detach();
						cleanup.delete(detach);
					});
				},
			);
		} catch {
			if (authenticatedConnection) {
				revokeWorkspaceConnection(authenticatedConnection.connectionId);
				workspaceCapabilities.release(authenticatedConnection);
			}
			rejectUpgradeSocket(socket);
		}
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", (error) => {
				reject(
					formatHubStartupError(error, {
						host,
						port: requestedPort,
						pathname,
					}),
				);
			});
			server.listen(requestedPort, host, () => {
				const address = server.address();
				if (!address || typeof address === "string") {
					reject(
						formatHubStartupError(new Error("Failed to resolve hub port"), {
							host,
							port: requestedPort,
							pathname,
						}),
					);
					return;
				}
				port = address.port;
				url = createHubServerUrl(host, port, pathname);
				resolve();
			});
		});
	} catch (error) {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
		const cleanup = await Promise.allSettled([
			transport.stop(),
			disposeChatCatalogHost(),
		]);
		const failures = cleanup.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (failures.length > 0) {
			throw new AggregateError(
				[error, ...failures],
				"Hub server startup and cleanup failed",
			);
		}
		throw error;
	}

	try {
		await writeHubDiscovery(owner.discoveryPath, {
			hubId: transport.getHubId(),
			protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
			minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
			maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
			capabilities: [...versionPayload.capabilities],
			coreVersion: corePackage.version,
			buildId,
			...(workspaceScopeId ? { workspaceScopeId } : {}),
			authToken,
			host,
			port,
			url,
			pid: process.pid,
			startedAt,
			updatedAt: startedAt,
		});
	} catch (error) {
		try {
			await closeServer();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Hub discovery write and cleanup failed",
			);
		}
		throw error;
	}

	return {
		host,
		port,
		url,
		authToken,
		...(workspaceScopeId ? { workspaceScopeId } : {}),
		...(workspaceAuthority ? { workspaceAuthority } : {}),
		close: closeServer,
	};
}

export async function ensureHubWebSocketServer(
	options: EnsureHubWebSocketServerOptions,
): Promise<EnsuredHubWebSocketServerResult> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const hasExplicitEndpoint =
		options.host !== undefined ||
		options.port !== undefined ||
		options.pathname !== undefined ||
		!!process.env.CLINE_HUB_PORT?.trim();
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? resolveDefaultHubPort();
	const pathname = options.pathname ?? "/hub";
	const expectedUrl = createHubServerUrl(host, port, pathname);
	const sharedKey = owner.discoveryPath;
	const expectedWorkspaceScopeId = (authToken: string): string | undefined => {
		const keys = options.workspaceAuthority?.trustedWorkspaceKeys ?? [];
		return keys.length === 1 && keys[0]
			? createHubWorkspaceScopeId(authToken, keys[0])
			: undefined;
	};
	const assertMatchingWorkspaceScope = (
		authToken: string,
		...actual: Array<string | undefined>
	): void => {
		const expected = expectedWorkspaceScopeId(authToken);
		if (expected && actual.some((candidate) => candidate !== expected)) {
			throw new Error(
				"The running Cline Hub is enrolled for a different workspace.",
			);
		}
	};
	const rememberIfManaged = <T extends EnsuredHubWebSocketServerResult>(
		result: T,
	): T => {
		if (!hasExplicitEndpoint) {
			rememberRecoverableLocalHubUrl(result.url, result.authToken);
		}
		return result;
	};
	const existing = SHARED_SERVERS.get(sharedKey);
	if (existing) {
		const server = await existing;
		if (server.url === expectedUrl) {
			assertMatchingWorkspaceScope(server.authToken, server.workspaceScopeId);
			return rememberIfManaged({
				server,
				url: server.url,
				authToken: server.authToken,
				action: "reuse",
			});
		}
	}

	return await withHubStartupLock(owner.discoveryPath, async () => {
		const discovered = await readHubDiscovery(owner.discoveryPath);
		const canReuseDiscovered =
			discovered?.url &&
			(discovered.url === expectedUrl || options.allowPortFallback === true);
		if (canReuseDiscovered) {
			const healthy = await probeHubServer(discovered.url, {
				authToken: discovered.authToken,
			});
			if (
				healthy?.url &&
				isHubProtocolCompatible(healthy).compatible &&
				(await verifyHubConnection(healthy.url, {
					authToken: discovered.authToken,
				}))
			) {
				assertMatchingWorkspaceScope(
					discovered.authToken,
					discovered.workspaceScopeId,
					healthy.workspaceScopeId,
				);
				return rememberIfManaged({
					url: healthy.url,
					authToken: discovered.authToken,
					action: "reuse",
				});
			}
		}

		// The discovered hub was not reusable (missing, mismatched, or failed
		// verification), so its record is stale either way.
		if (discovered?.url) {
			await clearHubDiscovery(owner.discoveryPath);
		}

		const start = async (
			startOptions: HubWebSocketServerOptions,
		): Promise<EnsuredHubWebSocketServerResult> => {
			const serverPromise = startHubWebSocketServer({ ...startOptions, owner });
			SHARED_SERVERS.set(sharedKey, serverPromise);
			try {
				const server = await serverPromise;
				return rememberIfManaged({
					server,
					url: server.url,
					authToken: server.authToken,
					action: "started",
				});
			} catch (error) {
				SHARED_SERVERS.delete(sharedKey);
				throw error;
			}
		};

		try {
			return await start(options);
		} catch (error) {
			if (!options.allowPortFallback || !isAddressInUseError(error)) {
				throw error;
			}
			return await start({ ...options, port: 0 });
		}
	});
}
