import {
	createSessionId,
	type HubChatLifecycleTransportCursor,
	type HubChatLifecycleTransportReady,
	type HubChatRuntimeCursor,
	type HubClientRegistration,
	type HubCommandEnvelope,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	type HubTransportFrame,
	isHubProtocolCompatible,
	parseHubChatLifecycleReady,
	parseHubChatLifecycleReconciliationSubscription,
	parseHubChatRuntimeCursor,
	resolveClineBuildEnv,
	resolveHubCommandTimeoutMs,
} from "@cline/shared";
import {
	SESSION_NOT_FOUND_ERROR_CODE,
	SessionNotFoundError,
} from "../../runtime/host/runtime-host";
import { spawnDetachedHubServerWithRetry } from "../daemon";
import {
	clearHubDiscovery,
	type HubOwnerContext,
	probeHubServer,
	readHubDiscovery,
} from "../discovery";
import {
	resolveProductionHubOwnerContext,
	resolveSharedHubOwnerContext,
} from "../discovery/workspace";

type PendingReply = {
	resolve: (reply: HubReplyEnvelope) => void;
	reject: (error: unknown) => void;
};

type SubscriptionEntry = {
	listener: (event: HubEventEnvelope) => void;
	sessionId?: string;
	fenced: boolean;
	wireSubscriptionId?: string;
	runtimeCursor?: () => HubChatRuntimeCursor | undefined;
	lifecycleCursor?: () => HubChatLifecycleTransportCursor;
	onStatus?: (status: HubSubscriptionStatus) => void;
	hasSubscribed: boolean;
	physicallySubscribed: boolean;
	requiresReclaim: boolean;
	ackTimer?: ReturnType<typeof setTimeout>;
};

export interface HubSubscriptionStatus {
	readonly status: "ready" | "rejected";
	readonly errorCode?: string;
	readonly runtimeCursor?: HubChatRuntimeCursor;
	readonly lifecycleReady?: HubChatLifecycleTransportReady;
}

export interface HubSubscriptionOptions {
	readonly sessionId?: string;
	readonly fenced?: boolean;
	/** Fails admission unless this exact registered physical generation is live. */
	readonly requiredConnectionGeneration?: number;
	/** Evaluated for each authorized physical subscribe. */
	readonly runtimeCursor?: () => HubChatRuntimeCursor | undefined;
	/** Evaluated for each authorized physical lifecycle subscribe. */
	readonly lifecycleCursor?: () => HubChatLifecycleTransportCursor;
	readonly onStatus?: (status: HubSubscriptionStatus) => void;
}

export interface HubCommandOptions {
	readonly timeoutMs?: number | null;
	/** Fails before send unless this exact registered physical generation is live. */
	readonly requiredConnectionGeneration?: number;
}

function resolveDefaultHubOwnerContext(): HubOwnerContext {
	return resolveClineBuildEnv() === "production"
		? resolveProductionHubOwnerContext()
		: resolveSharedHubOwnerContext();
}

type WebSocketLike = {
	readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(type: string, listener: (...args: unknown[]) => void): void;
};

type WebSocketCtor = new (
	url: string,
	protocols?: string | string[],
) => WebSocketLike;

function getWebSocketCtor(): WebSocketCtor {
	const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
	if (!ctor) {
		throw new Error(
			"Global WebSocket is not available in this runtime. Node 22+ is required for hub mode.",
		);
	}
	return ctor;
}

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
	if (
		data &&
		typeof data === "object" &&
		"data" in data &&
		typeof (data as { data?: unknown }).data !== "undefined"
	) {
		return decodeSocketData((data as { data?: unknown }).data);
	}
	return String(data);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isOptionalSubscriptionId(value: unknown): value is string | undefined {
	return (
		value === undefined ||
		(typeof value === "string" &&
			value.length <= 512 &&
			value.trim() === value &&
			/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
	);
}

function isOptionalRecord(
	value: unknown,
): value is Record<string, unknown> | undefined {
	return value === undefined || isPlainRecord(value);
}

function parseInboundHubFrame(data: unknown): HubTransportFrame {
	const parsed = JSON.parse(decodeSocketData(data)) as unknown;
	if (!isPlainRecord(parsed)) {
		throw new Error("invalid Hub frame");
	}
	if (parsed.kind === "stream.status") {
		let runtimeCursor: HubChatRuntimeCursor | undefined;
		let lifecycleReady: HubChatLifecycleTransportReady | undefined;
		try {
			runtimeCursor =
				parsed.runtimeCursor === undefined
					? undefined
					: parseHubChatRuntimeCursor(parsed.runtimeCursor);
			lifecycleReady =
				parsed.lifecycleReady === undefined
					? undefined
					: parseHubChatLifecycleReady(parsed.lifecycleReady);
		} catch {
			throw new Error("invalid Hub subscription status cursor or readiness");
		}
		if (
			typeof parsed.clientId !== "string" ||
			!isOptionalString(parsed.sessionId) ||
			!isOptionalSubscriptionId(parsed.subscriptionId) ||
			!parsed.subscriptionId ||
			(parsed.status !== "ready" && parsed.status !== "rejected") ||
			!isOptionalString(parsed.errorCode) ||
			(parsed.status === "ready" && parsed.errorCode !== undefined) ||
			(runtimeCursor !== undefined && lifecycleReady !== undefined) ||
			(runtimeCursor !== undefined && !parsed.sessionId?.trim()) ||
			(lifecycleReady !== undefined && parsed.sessionId !== undefined) ||
			(parsed.status === "rejected" &&
				(runtimeCursor !== undefined || lifecycleReady !== undefined))
		) {
			throw new Error("invalid Hub subscription status frame");
		}
		return parsed as unknown as HubTransportFrame;
	}
	if (!isPlainRecord(parsed.envelope)) {
		throw new Error("invalid Hub frame envelope");
	}
	const envelope = parsed.envelope;
	if (parsed.kind === "reply") {
		if (
			envelope.version !== "v1" ||
			typeof envelope.ok !== "boolean" ||
			!isOptionalString(envelope.requestId) ||
			!isOptionalRecord(envelope.payload) ||
			!isOptionalRecord(envelope.error)
		) {
			throw new Error("invalid Hub reply frame");
		}
		if (
			envelope.error !== undefined &&
			(typeof envelope.error.code !== "string" ||
				typeof envelope.error.message !== "string" ||
				!isOptionalRecord(envelope.error.details))
		) {
			throw new Error("invalid Hub reply error");
		}
		return parsed as unknown as HubTransportFrame;
	}
	if (parsed.kind === "event") {
		if (
			!isOptionalSubscriptionId(parsed.subscriptionId) ||
			envelope.version !== "v1" ||
			typeof envelope.event !== "string" ||
			!isOptionalString(envelope.eventId) ||
			!isOptionalString(envelope.sessionId) ||
			!isOptionalString(envelope.clientId) ||
			!isOptionalString(envelope.sourceHubId) ||
			(envelope.timestamp !== undefined &&
				(typeof envelope.timestamp !== "number" ||
					!Number.isFinite(envelope.timestamp))) ||
			!isOptionalRecord(envelope.payload)
		) {
			throw new Error("invalid Hub event frame");
		}
		return parsed as unknown as HubTransportFrame;
	}
	throw new Error("invalid inbound Hub frame kind");
}

function decodeCloseReason(reason: unknown): string {
	if (typeof reason === "string") {
		return reason;
	}
	if (reason instanceof Uint8Array) {
		return Buffer.from(reason).toString("utf8");
	}
	if (reason instanceof ArrayBuffer) {
		return Buffer.from(reason).toString("utf8");
	}
	return "";
}

function createHubCloseError(event: unknown): HubTransportError {
	const closeEvent = event as { code?: number; reason?: unknown };
	const reasonText = decodeCloseReason(closeEvent.reason);
	return new HubTransportError(
		"hub_connection_closed",
		closeEvent.code || reasonText
			? `Hub connection closed (code=${closeEvent.code ?? 0}${reasonText ? `, reason=${reasonText}` : ""})`
			: DEFAULT_HUB_CLOSED_MESSAGE,
		{
			closeCode: closeEvent.code,
			closeReason: reasonText || undefined,
		},
	);
}

function normalizeWebSocketConnectError(
	error: unknown,
	url: URL,
): HubTransportError {
	if (error instanceof HubTransportError) {
		return error;
	}
	if (error instanceof Error) {
		return new HubTransportError("hub_connect_failed", error.message);
	}
	if (
		error &&
		typeof error === "object" &&
		"error" in error &&
		(error as { error?: unknown }).error instanceof Error
	) {
		return new HubTransportError(
			"hub_connect_failed",
			(error as { error: Error }).error.message,
		);
	}
	const message =
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message?: unknown }).message === "string"
			? (error as { message: string }).message.trim()
			: "";
	if (message) {
		return new HubTransportError("hub_connect_failed", message);
	}
	const eventType =
		error &&
		typeof error === "object" &&
		"type" in error &&
		typeof (error as { type?: unknown }).type === "string"
			? (error as { type: string }).type.trim()
			: "";
	return new HubTransportError(
		"hub_connect_failed",
		eventType
			? `Failed to connect to hub at ${url.toString()} (${eventType} event before socket open).`
			: `Failed to connect to hub at ${url.toString()}.`,
	);
}

export interface HubClientOptions {
	url: string;
	clientId?: string;
	clientType?: string;
	displayName?: string;
	workspaceRoot?: string;
	cwd?: string;
	authToken?: string;
	/** Supplies a newly minted one-time credential for every physical socket. */
	workspaceCapabilityProvider?: HubWorkspaceCapabilityProvider;
}

export interface HubWorkspaceCapabilityProvider {
	getFreshCapability(input: {
		readonly hubUrl: string;
		readonly clientId: string;
	}):
		| { readonly credential: string; readonly expiresAt?: string }
		| Promise<{ readonly credential: string; readonly expiresAt?: string }>;
}

export interface HubWorkspaceCapabilityIssuer {
	issue(input: { readonly workspaceId: string }): {
		readonly credential: string;
		readonly expiresAt?: string;
	};
}

export function createInProcessHubWorkspaceCapabilityProvider(
	issuer: HubWorkspaceCapabilityIssuer,
	workspaceId: string,
): HubWorkspaceCapabilityProvider {
	const selectedWorkspaceId = workspaceId.trim();
	if (!selectedWorkspaceId) {
		throw new Error("Workspace ID is required for Hub capability issuance.");
	}
	return Object.freeze({
		getFreshCapability: () =>
			issuer.issue({ workspaceId: selectedWorkspaceId }),
	});
}

function ownerControlPlaneUrl(hubUrl: string): URL {
	const url = new URL(hubUrl);
	if (url.protocol === "ws:") url.protocol = "http:";
	else if (url.protocol === "wss:") url.protocol = "https:";
	else if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Hub owner control plane URL is invalid.");
	}
	url.pathname = "/workspace-capability";
	url.search = "";
	url.hash = "";
	return url;
}

function parseOwnerWorkspaceCapability(input: unknown): {
	credential: string;
	expiresAt: string;
} {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Hub workspace capability response is invalid.");
	}
	const record = input as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(key) => key !== "credential" && key !== "expiresAt",
		) ||
		typeof record.credential !== "string" ||
		!record.credential.trim() ||
		typeof record.expiresAt !== "string" ||
		!Number.isFinite(Date.parse(record.expiresAt))
	) {
		throw new Error("Hub workspace capability response is invalid.");
	}
	return {
		credential: record.credential,
		expiresAt: record.expiresAt,
	};
}

/**
 * Owner-authenticated provider for the detached daemon's single enrolled
 * workspace. Callers submit neither a path nor a workspace ID; the server
 * fails closed unless exactly one startup-enrolled workspace exists.
 */
export function createOwnerAuthenticatedHubWorkspaceCapabilityProvider(options: {
	readonly authToken: string;
	readonly fetch?: typeof fetch;
}): HubWorkspaceCapabilityProvider {
	const authToken = options.authToken.trim();
	if (!authToken) {
		throw new Error("Hub owner authentication token is required.");
	}
	const request = options.fetch ?? fetch;
	return Object.freeze({
		getFreshCapability: async (input: {
			readonly hubUrl: string;
			readonly clientId: string;
		}) => {
			try {
				const response = await request(ownerControlPlaneUrl(input.hubUrl), {
					method: "POST",
					headers: { authorization: `Bearer ${authToken}` },
				});
				if (!response.ok) {
					throw new Error("capability request was rejected");
				}
				return parseOwnerWorkspaceCapability(await response.json());
			} catch {
				throw new Error("Failed to obtain a Hub workspace capability.");
			}
		},
	});
}

export interface LocalHubResolutionOptions {
	endpoint?: string;
	strategy?: "prefer-hub" | "require-hub";
	workspaceRoot?: string;
	cwd?: string;
}

const HUB_STARTUP_TIMEOUT_MS = 8_000;
const HUB_STARTUP_POLL_MS = 200;
const GLOBAL_SUBSCRIPTION_KEY = "*";
const HUB_CONNECT_TIMEOUT_MS = 8_000;
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";
const HUB_WORKSPACE_AUTH_PROTOCOL_PREFIX = "cline-hub-workspace.";
const LOCAL_HUB_AUTH_TOKENS = new Map<string, string>();
const RECOVERABLE_LOCAL_HUB_URLS = new Set<string>();
const HUB_RECOVERY_SESSION_LIST_TIMEOUT_MS = 3_000;
const HUB_RECOVERY_RETIRE_TIMEOUT_MS = 3_000;
const HUB_RECOVERY_RETIRE_POLL_MS = 100;
const DEFAULT_HUB_CLOSED_MESSAGE = "Hub connection closed";
const HUB_RECONNECT_INITIAL_DELAY_MS = 250;
const HUB_RECONNECT_MAX_DELAY_MS = 5_000;
const HUB_RECONNECT_JITTER_RATIO = 0.5;
const HUB_SUBSCRIPTION_ACK_TIMEOUT_MS = 10_000;

export type HubTransportErrorCode =
	| "hub_connect_timeout"
	| "hub_connect_failed"
	| "hub_workspace_capability_failed"
	| "hub_protocol_error"
	| "hub_registration_failed"
	| "hub_registration_connection_lost"
	| "hub_connection_changed"
	| "hub_connection_closed"
	| "hub_connection_not_open";

export class HubTransportError extends Error {
	constructor(
		readonly code: HubTransportErrorCode,
		message: string,
		readonly details?: { closeCode?: number; closeReason?: string },
	) {
		super(message);
		this.name = "HubTransportError";
	}
}

export function isHubReconnectableTransportError(
	error: unknown,
): error is HubTransportError {
	return error instanceof HubTransportError;
}

export class HubCommandError extends Error {
	constructor(
		readonly command: HubCommandEnvelope["command"],
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
		this.name = "HubCommandError";
	}
}

export function isHubCommandTimeoutError(
	error: unknown,
	command?: HubCommandEnvelope["command"],
): boolean {
	return (
		error instanceof HubCommandError &&
		error.code === "hub_command_timeout" &&
		(command === undefined || error.command === command)
	);
}

function resolveLocalHubAuthToken(url: URL): string | undefined {
	const queryToken = url.searchParams.get("authToken")?.trim();
	url.searchParams.delete("authToken");
	if (queryToken) {
		return queryToken;
	}
	const key = localHubUrlKey(url.toString());
	return key ? LOCAL_HUB_AUTH_TOKENS.get(key) : undefined;
}

function isLocalHubUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
		return (
			hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
		);
	} catch {
		return false;
	}
}

function localHubUrlKey(url: string): string | undefined {
	if (!isLocalHubUrl(url)) {
		return undefined;
	}
	const parsed = new URL(normalizeHubWebSocketUrl(url));
	parsed.search = "";
	parsed.hash = "";
	return parsed.toString();
}

function isRecoverableLocalHubUrl(url: string): boolean {
	const key = localHubUrlKey(url);
	return !!key && RECOVERABLE_LOCAL_HUB_URLS.has(key);
}

export function rememberRecoverableLocalHubUrl(
	url: string,
	authToken?: string,
): string {
	const key = localHubUrlKey(url);
	if (key) {
		RECOVERABLE_LOCAL_HUB_URLS.add(key);
		if (authToken?.trim()) {
			LOCAL_HUB_AUTH_TOKENS.set(key, authToken);
		}
	}
	return url;
}

export class NodeHubClient {
	private socket: WebSocketLike | undefined;
	private connectPromise: Promise<void> | undefined;
	private openingPromise: Promise<void> | undefined;
	private connectionAttemptGeneration = 0;
	private readonly clientId: string;
	private currentUrl: string;
	private recoveryPromise: Promise<boolean> | undefined;
	private readonly pendingReplies = new Map<string, PendingReply>();
	private readonly listeners = new Set<SubscriptionEntry>();
	private readonly subscriptionCounts = new Map<string, number>();
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectAttempt = 0;
	private closedByClient = false;
	private lastCloseError = new HubTransportError(
		"hub_connection_closed",
		DEFAULT_HUB_CLOSED_MESSAGE,
	);
	private sawSocketClose = false;
	private registered = false;

	constructor(private readonly options: HubClientOptions) {
		this.clientId =
			options.clientId ??
			`core-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
		this.currentUrl = options.url;
	}

	getClientId(): string {
		return this.clientId;
	}

	getUrl(): string {
		return this.currentUrl;
	}

	isConnected(): boolean {
		return this.socket?.readyState === 1 && this.registered;
	}

	getRegisteredConnectionGeneration(): number | undefined {
		return this.isConnected() ? this.connectionAttemptGeneration : undefined;
	}

	getConnectionError(): HubTransportError | null {
		return this.isConnected() ? null : this.lastCloseError;
	}

	async connect(): Promise<void> {
		if (this.openingPromise) return await this.openingPromise;
		if (
			this.socket &&
			this.registered &&
			(this.socket.readyState === 1 || this.socket.readyState === 0)
		) {
			return this.connectPromise ?? Promise.resolve();
		}
		const attemptGeneration = ++this.connectionAttemptGeneration;
		const openingPromise = this.openFreshConnection(attemptGeneration);
		this.openingPromise = openingPromise;
		try {
			await openingPromise;
		} finally {
			if (this.openingPromise === openingPromise) {
				this.openingPromise = undefined;
			}
		}
	}

	private async openFreshConnection(attemptGeneration: number): Promise<void> {
		this.closedByClient = false;
		this.clearReconnectTimer();

		const url = new URL(this.currentUrl);
		const authToken =
			this.options.authToken?.trim() || resolveLocalHubAuthToken(url);
		url.hash = "";
		let protocols: string[] | undefined;
		if (this.options.workspaceCapabilityProvider) {
			let credential: string;
			try {
				const grant =
					await this.options.workspaceCapabilityProvider.getFreshCapability({
						hubUrl: url.toString(),
						clientId: this.clientId,
					});
				credential = grant.credential.trim();
				if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) {
					throw new Error("invalid credential");
				}
			} catch {
				if (
					this.closedByClient ||
					attemptGeneration !== this.connectionAttemptGeneration
				) {
					throw this.lastCloseError;
				}
				this.lastCloseError = new HubTransportError(
					"hub_workspace_capability_failed",
					"Failed to obtain a fresh Hub workspace capability.",
				);
				this.sawSocketClose = false;
				throw this.lastCloseError;
			}
			if (
				this.closedByClient ||
				attemptGeneration !== this.connectionAttemptGeneration
			) {
				throw this.lastCloseError;
			}
			protocols = [`${HUB_WORKSPACE_AUTH_PROTOCOL_PREFIX}${credential}`];
		} else if (authToken) {
			protocols = [`${HUB_AUTH_PROTOCOL_PREFIX}${authToken}`];
		}

		const WebSocketImpl = getWebSocketCtor();
		const socket = new WebSocketImpl(url.toString(), protocols);
		this.socket = socket;
		let suppressCloseMessage = false;
		this.connectPromise = new Promise<void>((resolve, reject) => {
			let settled = false;
			const timeout = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				suppressCloseMessage = true;
				this.lastCloseError = new HubTransportError(
					"hub_connect_timeout",
					`Timed out connecting to hub after ${HUB_CONNECT_TIMEOUT_MS}ms`,
				);
				this.sawSocketClose = false;
				this.connectPromise = undefined;
				this.socket = undefined;
				try {
					socket.close();
				} catch {
					// best-effort close
				}
				reject(this.lastCloseError);
			}, HUB_CONNECT_TIMEOUT_MS);
			socket.addEventListener("open", () => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				resolve();
			});
			socket.addEventListener("error", (error) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				this.lastCloseError = normalizeWebSocketConnectError(error, url);
				this.sawSocketClose = false;
				this.connectPromise = undefined;
				this.socket = undefined;
				reject(this.lastCloseError);
			});
			socket.addEventListener("close", (event: unknown) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeout);
				if (!suppressCloseMessage) {
					this.lastCloseError = createHubCloseError(event);
					this.sawSocketClose = true;
				}
				this.connectPromise = undefined;
				this.socket = undefined;
				reject(this.lastCloseError);
			});
		});

		socket.addEventListener("message", (data: unknown) => {
			if (this.socket !== socket) return;
			try {
				this.handleFrame(parseInboundHubFrame(data));
			} catch {
				this.retireSocket(
					socket,
					new HubTransportError(
						"hub_protocol_error",
						"Hub sent a malformed transport frame.",
					),
				);
			}
		});
		socket.addEventListener("close", (event: unknown) => {
			if (this.socket !== socket) {
				return;
			}
			if (!suppressCloseMessage) {
				this.lastCloseError = createHubCloseError(event);
				this.sawSocketClose = true;
			}
			this.registered = false;
			this.clearAllSubscriptionAcks();
			for (const pending of this.pendingReplies.values()) {
				pending.reject(this.lastCloseError);
			}
			this.pendingReplies.clear();
			this.connectPromise = undefined;
			this.socket = undefined;
			this.notifyRuntimeSubscriptionsReclaimRequired();
			if (!this.closedByClient && this.hasActiveSubscriptions()) {
				this.scheduleReconnect();
			}
		});

		await this.connectPromise;
		try {
			await this.sendConnectedCommand("client.register", {
				clientId: this.clientId,
				clientType: this.options.clientType ?? "core",
				displayName: this.options.displayName ?? "core",
				transport: "native",
				actorKind: "client",
				workspaceContext: {
					workspaceRoot: this.options.workspaceRoot,
					cwd: this.options.cwd,
				},
			} satisfies HubClientRegistration);
			if (
				this.closedByClient ||
				this.socket !== socket ||
				socket.readyState !== 1 ||
				attemptGeneration !== this.connectionAttemptGeneration
			) {
				throw new HubTransportError(
					"hub_registration_connection_lost",
					"Hub connection changed before client registration completed.",
				);
			}
		} catch (error) {
			this.retireSocket(
				socket,
				new HubTransportError(
					"hub_registration_failed",
					"Hub client registration failed.",
				),
			);
			throw error;
		}
		this.registered = true;
		for (const key of this.subscriptionCounts.keys()) {
			this.sendSubscriptionFrame(
				"stream.subscribe",
				this.subscriptionSessionIdFromKey(key),
			);
		}
		for (const entry of [...this.listeners]) {
			if (!entry.fenced) continue;
			entry.wireSubscriptionId = createSessionId("hub_subscription_");
			if (entry.runtimeCursor && entry.hasSubscribed) {
				if (!entry.requiresReclaim) {
					entry.requiresReclaim = true;
					this.notifySubscriptionStatus(entry, {
						status: "rejected",
						errorCode: "session_reclaim_required",
					});
				}
				continue;
			}
			this.sendFencedSubscription(entry);
		}
		this.reconnectAttempt = 0;
	}

	subscribe(
		listener: (event: HubEventEnvelope) => void,
		options?: HubSubscriptionOptions,
	): () => void {
		const sessionId = options?.sessionId?.trim() || undefined;
		const fenced = options?.fenced === true;
		if (options?.runtimeCursor && (!fenced || !sessionId)) {
			throw new Error("Runtime cursor requires a fenced session subscription.");
		}
		if (options?.lifecycleCursor && (!fenced || sessionId)) {
			throw new Error(
				"Lifecycle cursor requires one fenced audience-wide subscription.",
			);
		}
		if (options?.runtimeCursor && options.lifecycleCursor) {
			throw new Error(
				"Runtime and lifecycle cursors require separate subscriptions.",
			);
		}
		if (options?.requiredConnectionGeneration !== undefined) {
			if (
				!fenced ||
				!Number.isSafeInteger(options.requiredConnectionGeneration) ||
				options.requiredConnectionGeneration < 1
			) {
				throw new Error(
					"A required connection generation needs a valid fenced subscription.",
				);
			}
			if (
				this.getRegisteredConnectionGeneration() !==
				options.requiredConnectionGeneration
			) {
				throw new HubTransportError(
					"hub_connection_changed",
					"Hub connection changed before subscription admission.",
				);
			}
		}
		const entry: SubscriptionEntry = {
			listener,
			sessionId,
			fenced,
			hasSubscribed: false,
			physicallySubscribed: false,
			requiresReclaim: false,
			...(options?.runtimeCursor
				? { runtimeCursor: options.runtimeCursor }
				: {}),
			...(options?.lifecycleCursor
				? { lifecycleCursor: options.lifecycleCursor }
				: {}),
			...(options?.onStatus ? { onStatus: options.onStatus } : {}),
			...(fenced
				? { wireSubscriptionId: createSessionId("hub_subscription_") }
				: {}),
		};
		this.listeners.add(entry);
		if (fenced) {
			if (this.socket?.readyState === 1 && this.registered) {
				try {
					this.sendFencedSubscription(entry);
				} catch (error) {
					this.listeners.delete(entry);
					this.clearSubscriptionAck(entry);
					throw error;
				}
			}
		} else {
			this.adjustSubscriptionCount(sessionId, 1);
		}
		return () => {
			if (!this.listeners.delete(entry)) {
				return;
			}
			if (entry.fenced) {
				this.clearSubscriptionAck(entry);
				if (entry.physicallySubscribed && this.isConnected()) {
					this.sendSubscriptionFrame(
						"stream.unsubscribe",
						sessionId,
						entry.wireSubscriptionId,
					);
					entry.physicallySubscribed = false;
				}
				if (!this.hasActiveSubscriptions()) this.clearReconnectTimer();
				return;
			}
			this.adjustSubscriptionCount(sessionId, -1);
		};
	}

	async command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: HubCommandOptions,
	): Promise<HubReplyEnvelope> {
		let attempt = 0;
		const canRecoverTransport =
			command !== "client.register" &&
			command !== "client.unregister" &&
			options?.requiredConnectionGeneration === undefined;
		while (true) {
			try {
				return await this.commandOnce(command, payload, sessionId, options);
			} catch (error) {
				if (
					!canRecoverTransport ||
					attempt >= 1 ||
					!(await this.recoverLocalHubTransport(error))
				) {
					throw error;
				}
				attempt += 1;
			}
		}
	}

	private async commandOnce(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: HubCommandOptions,
	): Promise<HubReplyEnvelope> {
		if (options?.requiredConnectionGeneration === undefined) {
			await this.connect();
		}
		this.assertRequiredConnectionGeneration(options);
		return await this.sendConnectedCommand(
			command,
			payload,
			sessionId,
			options,
		);
	}

	private async sendConnectedCommand(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: HubCommandOptions,
	): Promise<HubReplyEnvelope> {
		this.assertRequiredConnectionGeneration(options);
		const requestId = createSessionId("hubreq_");
		const effectiveTimeoutMs = resolveHubCommandTimeoutMs(
			command,
			options?.timeoutMs,
		);
		const reply = new Promise<HubReplyEnvelope>((resolve, reject) => {
			const timeout =
				effectiveTimeoutMs === null
					? undefined
					: setTimeout(() => {
							if (!this.pendingReplies.delete(requestId)) {
								return;
							}
							reject(
								new HubCommandError(
									command,
									"hub_command_timeout",
									`Hub command ${command} timed out after ${effectiveTimeoutMs}ms (hub=${this.currentUrl}, requestId=${requestId}, clientId=${this.clientId}). Check hub-daemon.log for matching command.start/command.slow entries, or run 'cline doctor fix' to restart the hub.`,
								),
							);
						}, effectiveTimeoutMs);
			this.pendingReplies.set(requestId, {
				resolve: (value) => {
					if (timeout) {
						clearTimeout(timeout);
					}
					resolve(value);
				},
				reject: (error) => {
					if (timeout) {
						clearTimeout(timeout);
					}
					reject(error);
				},
			});
		});
		try {
			this.sendFrame({
				kind: "command",
				envelope: {
					version: "v1",
					command,
					requestId,
					clientId: this.clientId,
					sessionId,
					timeoutMs: effectiveTimeoutMs,
					payload,
				},
			});
		} catch (error) {
			this.pendingReplies.delete(requestId);
			throw error;
		}
		const resolved = await reply;
		if (!resolved.ok) {
			if (resolved.error?.code === SESSION_NOT_FOUND_ERROR_CODE) {
				const targetSessionId =
					sessionId ??
					(typeof payload?.sessionId === "string"
						? payload.sessionId
						: undefined);
				throw new SessionNotFoundError(targetSessionId, resolved.error.message);
			}
			throw new HubCommandError(
				command,
				resolved.error?.code,
				resolved.error?.message ?? `Hub command ${command} failed`,
			);
		}
		return resolved;
	}

	private retireSocket(socket: WebSocketLike, error: HubTransportError): void {
		if (this.socket !== socket) return;
		this.lastCloseError = error;
		this.sawSocketClose = false;
		this.registered = false;
		this.clearAllSubscriptionAcks();
		for (const pending of this.pendingReplies.values()) {
			pending.reject(error);
		}
		this.pendingReplies.clear();
		this.connectPromise = undefined;
		this.socket = undefined;
		this.notifyRuntimeSubscriptionsReclaimRequired();
		try {
			socket.close();
		} catch {
			// best-effort close
		}
		if (!this.closedByClient && this.hasActiveSubscriptions()) {
			this.scheduleReconnect();
		}
	}

	private async recoverLocalHubTransport(error: unknown): Promise<boolean> {
		if (
			!isRecoverableLocalHubUrl(this.currentUrl) ||
			!isHubReconnectableTransportError(error)
		) {
			return false;
		}
		if (this.recoveryPromise) {
			return await this.recoveryPromise;
		}
		this.recoveryPromise = (async () => {
			const recoveredUrl = await ensureCompatibleLocalHubUrl({
				workspaceRoot: this.options.workspaceRoot,
				cwd: this.options.cwd,
			}).catch(() => undefined);
			if (!recoveredUrl) {
				return false;
			}
			this.currentUrl = recoveredUrl;
			this.close();
			return true;
		})().finally(() => {
			this.recoveryPromise = undefined;
		});
		return await this.recoveryPromise;
	}

	private hasActiveSubscriptions(): boolean {
		return (
			this.subscriptionCounts.size > 0 ||
			[...this.listeners].some(
				(entry) => entry.fenced && !entry.requiresReclaim,
			)
		);
	}

	private clearReconnectTimer(): void {
		if (!this.reconnectTimer) {
			return;
		}
		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	private scheduleReconnect(): void {
		if (
			this.reconnectTimer ||
			this.closedByClient ||
			!this.hasActiveSubscriptions()
		) {
			return;
		}
		const delayMs = Math.min(
			HUB_RECONNECT_INITIAL_DELAY_MS * 2 ** this.reconnectAttempt,
			HUB_RECONNECT_MAX_DELAY_MS,
		);
		const jitteredDelayMs = Math.round(
			delayMs * (1 - HUB_RECONNECT_JITTER_RATIO) +
				Math.random() * delayMs * HUB_RECONNECT_JITTER_RATIO,
		);
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.reconnectSubscribedTransport();
		}, jitteredDelayMs);
	}

	private async reconnectSubscribedTransport(): Promise<void> {
		if (this.closedByClient || !this.hasActiveSubscriptions()) {
			return;
		}
		try {
			await this.connect();
			this.reconnectAttempt = 0;
		} catch {
			if (!isRecoverableLocalHubUrl(this.currentUrl)) {
				this.reconnectAttempt += 1;
				this.scheduleReconnect();
				return;
			}
			try {
				const recoveredUrl = await ensureCompatibleLocalHubUrl({
					workspaceRoot: this.options.workspaceRoot,
					cwd: this.options.cwd,
				});
				if (recoveredUrl) {
					this.currentUrl = recoveredUrl;
					await this.connect();
					this.reconnectAttempt = 0;
					return;
				}
			} catch {
				// fall through to retry below
			}
			this.reconnectAttempt += 1;
			this.scheduleReconnect();
		}
	}

	close(): void {
		const socket = this.socket;
		this.closedByClient = true;
		this.connectionAttemptGeneration += 1;
		this.openingPromise = undefined;
		this.clearReconnectTimer();
		this.registered = false;
		this.clearAllSubscriptionAcks();
		this.lastCloseError = new HubTransportError(
			"hub_connection_closed",
			DEFAULT_HUB_CLOSED_MESSAGE,
		);
		this.sawSocketClose = false;
		if (!socket) {
			return;
		}
		for (const pending of this.pendingReplies.values()) {
			pending.reject(this.lastCloseError);
		}
		this.pendingReplies.clear();
		this.connectPromise = undefined;
		this.socket = undefined;
		try {
			socket.close();
		} catch {
			// best-effort close
		}
	}

	async dispose(): Promise<void> {
		const socket = this.socket;
		if (socket?.readyState === 1 && this.registered) {
			try {
				await this.command("client.unregister", undefined, undefined, {
					timeoutMs: 2_000,
				});
			} catch {
				// Best-effort unregister during shutdown. The websocket adapter also
				// unregisters clients on close, so failure here should not block teardown.
			}
		}
		this.close();
	}

	private sendFrame(frame: HubTransportFrame): void {
		if (this.socket?.readyState !== 1) {
			if (
				this.lastCloseError.code === "hub_connection_closed" &&
				!this.sawSocketClose
			) {
				throw new HubTransportError(
					"hub_connection_not_open",
					"Hub connection is not open.",
				);
			}
			throw this.lastCloseError;
		}
		this.socket.send(JSON.stringify(frame));
	}

	private sendSubscriptionFrame(
		kind: "stream.subscribe" | "stream.unsubscribe",
		sessionId?: string,
		subscriptionId?: string,
		runtimeCursor?: HubChatRuntimeCursor,
		lifecycleCursor?: HubChatLifecycleTransportCursor,
	): void {
		this.sendFrame({
			kind,
			clientId: this.clientId,
			...(sessionId ? { sessionId } : {}),
			...(subscriptionId ? { subscriptionId } : {}),
			...(kind === "stream.subscribe" && runtimeCursor
				? { runtimeCursor }
				: {}),
			...(kind === "stream.subscribe" && lifecycleCursor
				? { lifecycleCursor }
				: {}),
		});
	}

	private sendFencedSubscription(entry: SubscriptionEntry): void {
		if (!entry.fenced || !entry.wireSubscriptionId) {
			throw new Error("Fenced Hub subscription is missing its wire identity.");
		}
		const lifecycleCursor = entry.lifecycleCursor
			? parseHubChatLifecycleReconciliationSubscription(entry.lifecycleCursor())
			: undefined;
		this.sendSubscriptionFrame(
			"stream.subscribe",
			entry.sessionId,
			entry.wireSubscriptionId,
			entry.runtimeCursor?.(),
			lifecycleCursor,
		);
		entry.hasSubscribed = true;
		entry.physicallySubscribed = true;
		entry.requiresReclaim = false;
		this.clearSubscriptionAck(entry);
		const wireSubscriptionId = entry.wireSubscriptionId;
		entry.ackTimer = setTimeout(() => {
			if (
				!this.listeners.has(entry) ||
				entry.wireSubscriptionId !== wireSubscriptionId
			) {
				return;
			}
			this.notifySubscriptionStatus(entry, {
				status: "rejected",
				errorCode: "subscription_ack_timeout",
			});
		}, HUB_SUBSCRIPTION_ACK_TIMEOUT_MS);
		(entry.ackTimer as { unref?: () => void }).unref?.();
	}

	private clearSubscriptionAck(entry: SubscriptionEntry): void {
		if (!entry.ackTimer) return;
		clearTimeout(entry.ackTimer);
		entry.ackTimer = undefined;
	}

	private clearAllSubscriptionAcks(): void {
		for (const entry of this.listeners) {
			this.clearSubscriptionAck(entry);
			entry.physicallySubscribed = false;
		}
	}

	private notifySubscriptionStatus(
		entry: SubscriptionEntry,
		status: HubSubscriptionStatus,
	): void {
		this.clearSubscriptionAck(entry);
		try {
			entry.onStatus?.(status);
		} catch {
			// Subscription observers cannot affect transport routing.
		}
	}

	private notifyRuntimeSubscriptionsReclaimRequired(): void {
		for (const entry of [...this.listeners]) {
			if (
				!entry.fenced ||
				!entry.runtimeCursor ||
				!entry.hasSubscribed ||
				entry.requiresReclaim
			) {
				continue;
			}
			entry.requiresReclaim = true;
			this.notifySubscriptionStatus(entry, {
				status: "rejected",
				errorCode: "session_reclaim_required",
			});
		}
	}

	private assertRequiredConnectionGeneration(
		options: HubCommandOptions | undefined,
	): void {
		const required = options?.requiredConnectionGeneration;
		if (required === undefined) return;
		if (!Number.isSafeInteger(required) || required < 1) {
			throw new Error("Required Hub connection generation is invalid.");
		}
		if (this.getRegisteredConnectionGeneration() !== required) {
			throw new HubTransportError(
				"hub_connection_changed",
				"Hub connection changed before command admission.",
			);
		}
	}

	private adjustSubscriptionCount(
		sessionId: string | undefined,
		delta: 1 | -1,
	): void {
		const key = this.subscriptionKeyForSessionId(sessionId);
		const next = (this.subscriptionCounts.get(key) ?? 0) + delta;
		if (next <= 0) {
			this.subscriptionCounts.delete(key);
			if (!this.hasActiveSubscriptions()) {
				this.clearReconnectTimer();
			}
			if (delta < 0 && this.socket?.readyState === 1) {
				this.sendSubscriptionFrame("stream.unsubscribe", sessionId);
			}
			return;
		}
		this.subscriptionCounts.set(key, next);
		if (delta > 0 && next === 1 && this.socket?.readyState === 1) {
			this.sendSubscriptionFrame("stream.subscribe", sessionId);
		}
	}

	private subscriptionKeyForSessionId(sessionId: string | undefined): string {
		return sessionId ?? GLOBAL_SUBSCRIPTION_KEY;
	}

	private subscriptionSessionIdFromKey(key: string): string | undefined {
		return key === GLOBAL_SUBSCRIPTION_KEY ? undefined : key;
	}

	private handleFrame(frame: HubTransportFrame): void {
		switch (frame.kind) {
			case "reply": {
				const requestId = frame.envelope.requestId;
				if (!requestId) {
					return;
				}
				const pending = this.pendingReplies.get(requestId);
				if (!pending) {
					return;
				}
				this.pendingReplies.delete(requestId);
				pending.resolve(frame.envelope);
				return;
			}
			case "event": {
				const subscriptionId = frame.subscriptionId?.trim();
				for (const entry of [...this.listeners]) {
					if (
						entry.fenced
							? !subscriptionId || entry.wireSubscriptionId !== subscriptionId
							: subscriptionId !== undefined
					) {
						continue;
					}
					if (
						entry.sessionId &&
						entry.sessionId !== frame.envelope.sessionId?.trim()
					) {
						continue;
					}
					try {
						entry.listener(frame.envelope);
					} catch {
						// One consumer cannot prevent delivery to other subscribers.
					}
				}
				return;
			}
			case "stream.status": {
				if (frame.clientId !== this.clientId) return;
				for (const entry of [...this.listeners]) {
					if (
						!entry.fenced ||
						entry.wireSubscriptionId !== frame.subscriptionId ||
						(entry.sessionId && entry.sessionId !== frame.sessionId)
					) {
						continue;
					}
					this.notifySubscriptionStatus(entry, {
						status: frame.status,
						...(frame.errorCode ? { errorCode: frame.errorCode } : {}),
						...(frame.runtimeCursor
							? { runtimeCursor: frame.runtimeCursor }
							: {}),
						...(frame.lifecycleReady
							? { lifecycleReady: frame.lifecycleReady }
							: {}),
					});
				}
				return;
			}
			case "command":
			case "stream.subscribe":
			case "stream.unsubscribe":
				return;
		}
	}
}

export function normalizeHubWebSocketUrl(url: string): string {
	const parsed = new URL(url);
	if (parsed.protocol === "http:") {
		parsed.protocol = "ws:";
	} else if (parsed.protocol === "https:") {
		parsed.protocol = "wss:";
	}
	return parsed.toString();
}

export async function verifyHubConnection(
	url: string,
	options?: Pick<HubClientOptions, "workspaceRoot" | "cwd" | "authToken">,
): Promise<boolean> {
	const client = new NodeHubClient({
		url,
		authToken: options?.authToken,
		clientType: "hub-healthcheck",
		displayName: "hub healthcheck",
		workspaceRoot: options?.workspaceRoot,
		cwd: options?.cwd,
	});
	try {
		await client.connect();
		return true;
	} catch {
		return false;
	} finally {
		client.close();
	}
}

type HubProbeResult =
	| {
			status: "compatible";
			url: string;
	  }
	| {
			status: "unreachable" | "protocol_mismatch";
			url: string;
	  };

async function probeCompatibleHubUrl(
	url: string,
	options?: {
		verifyConnection?: boolean;
		workspaceRoot?: string;
		cwd?: string;
		authToken?: string;
	},
): Promise<HubProbeResult> {
	const normalized = normalizeHubWebSocketUrl(url);
	const record = await probeHubServer(normalized, {
		authToken: options?.authToken,
	});
	if (!record) {
		return {
			status: "unreachable",
			url: normalized,
		};
	}
	if (!isHubProtocolCompatible(record).compatible) {
		return {
			status: "protocol_mismatch",
			url: normalized,
		};
	}
	if (
		options?.verifyConnection === true &&
		!(await verifyHubConnection(normalized, {
			workspaceRoot: options.workspaceRoot,
			cwd: options.cwd,
			authToken: options.authToken,
		}))
	) {
		return {
			status: "unreachable",
			url: normalized,
		};
	}
	return {
		status: "compatible",
		url: normalized,
	};
}

async function waitForCompatibleHubUrl(
	owner: HubOwnerContext,
): Promise<string | undefined> {
	const deadline = Date.now() + HUB_STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const record = await readHubDiscovery(owner.discoveryPath);
		if (record?.url) {
			const compatible = await probeCompatibleHubUrl(record.url, {
				verifyConnection: true,
				authToken: record.authToken,
			});
			if (compatible.status === "compatible") {
				return rememberRecoverableLocalHubUrl(compatible.url, record.authToken);
			}
		}
		await new Promise((resolve) => setTimeout(resolve, HUB_STARTUP_POLL_MS));
	}
	return undefined;
}

async function waitForHubToRetire(url: string): Promise<boolean> {
	const deadline = Date.now() + HUB_RECOVERY_RETIRE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const healthy = await probeHubServer(url).catch(() => undefined);
		if (!healthy?.url) {
			return true;
		}
		await new Promise((resolve) =>
			setTimeout(resolve, HUB_RECOVERY_RETIRE_POLL_MS),
		);
	}
	return false;
}

function sameNormalizedHubUrl(left: string, right: string): boolean {
	try {
		return normalizeHubWebSocketUrl(left) === normalizeHubWebSocketUrl(right);
	} catch {
		return false;
	}
}

function hasActiveHubSessions(payload: unknown): boolean {
	const sessions =
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { sessions?: unknown }).sessions)
			? (payload as { sessions: unknown[] }).sessions
			: [];
	return sessions.some((session) => {
		if (!session || typeof session !== "object") {
			return false;
		}
		const record = session as {
			status?: unknown;
			participants?: unknown;
		};
		if (
			record.status === "running" ||
			record.status === "idle" ||
			record.status === "pending"
		) {
			return true;
		}
		return Array.isArray(record.participants) && record.participants.length > 0;
	});
}

async function localHubHasNoActiveSessions(
	url: string,
	authToken?: string,
	options?: Pick<HubClientOptions, "workspaceRoot" | "cwd">,
): Promise<boolean> {
	const client = new NodeHubClient({
		url,
		authToken,
		clientType: "hub-recovery-check",
		displayName: "hub recovery check",
		workspaceRoot: options?.workspaceRoot,
		cwd: options?.cwd,
	});
	try {
		const reply = await client.command(
			"session.list",
			{ limit: 500 },
			undefined,
			{ timeoutMs: HUB_RECOVERY_SESSION_LIST_TIMEOUT_MS },
		);
		return !hasActiveHubSessions(reply.payload);
	} catch {
		return false;
	} finally {
		await client.dispose().catch(() => undefined);
	}
}

export async function resolveCompatibleLocalHubUrl(
	options: LocalHubResolutionOptions = {},
): Promise<string | undefined> {
	if (options.endpoint?.trim()) {
		const compatible = await probeCompatibleHubUrl(options.endpoint);
		return compatible.status === "compatible" ? compatible.url : undefined;
	}

	const owner = resolveDefaultHubOwnerContext();
	const record = await readHubDiscovery(owner.discoveryPath);
	if (!record?.url) {
		return undefined;
	}
	const compatible = await probeCompatibleHubUrl(record.url, {
		authToken: record.authToken,
	});
	if (compatible.status === "compatible") {
		return rememberRecoverableLocalHubUrl(compatible.url, record.authToken);
	}
	if (compatible.status === "protocol_mismatch") {
		await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
	}
	return undefined;
}

export async function ensureCompatibleLocalHubUrl(
	options: LocalHubResolutionOptions = {},
): Promise<string | undefined> {
	const resolved = await resolveCompatibleLocalHubUrl(options);
	if (
		resolved &&
		(await verifyHubConnection(resolved, {
			workspaceRoot: options.workspaceRoot,
			cwd: options.cwd,
		}))
	) {
		return resolved;
	}
	if (options.endpoint?.trim()) {
		return undefined;
	}
	const owner = resolveDefaultHubOwnerContext();
	await spawnDetachedHubServerWithRetry(options.workspaceRoot ?? process.cwd());
	return await waitForCompatibleHubUrl(owner);
}

export async function requestHubShutdown(
	url: string,
	authToken?: string,
): Promise<boolean> {
	const parsed = new URL(url);
	const resolvedAuthToken =
		authToken?.trim() || resolveLocalHubAuthToken(parsed);
	if (parsed.protocol === "ws:") {
		parsed.protocol = "http:";
	} else if (parsed.protocol === "wss:") {
		parsed.protocol = "https:";
	}
	parsed.pathname = "/shutdown";
	parsed.hash = "";
	const response = await fetch(parsed, {
		method: "POST",
		headers: resolvedAuthToken
			? { authorization: `Bearer ${resolvedAuthToken}` }
			: undefined,
	});
	return response.ok;
}

export async function stopLocalHubServerGracefully(
	owner: HubOwnerContext = resolveDefaultHubOwnerContext(),
): Promise<boolean> {
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (!discovery?.url) {
		return false;
	}
	try {
		const stopped = await requestHubShutdown(
			discovery.url,
			discovery.authToken,
		);
		if (stopped) {
			return true;
		}
	} catch {
		// Fall through so callers can apply a stronger fallback.
	}
	return false;
}

export async function restartLocalHubIfIdleAfterStartupTimeout(options: {
	url: string;
	workspaceRoot?: string;
	cwd?: string;
}): Promise<string | undefined> {
	if (!isRecoverableLocalHubUrl(options.url)) {
		return undefined;
	}
	const owner = resolveDefaultHubOwnerContext();
	const discovery = await readHubDiscovery(owner.discoveryPath);
	if (!discovery?.url || !sameNormalizedHubUrl(discovery.url, options.url)) {
		return undefined;
	}
	const hasNoActiveSessions = await localHubHasNoActiveSessions(
		discovery.url,
		discovery.authToken,
		{ workspaceRoot: options.workspaceRoot, cwd: options.cwd },
	);
	if (!hasNoActiveSessions) {
		return undefined;
	}
	if (!(await stopLocalHubServerGracefully())) {
		return undefined;
	}
	if (!(await waitForHubToRetire(discovery.url))) {
		return undefined;
	}
	await clearHubDiscovery(owner.discoveryPath).catch(() => undefined);
	return await ensureCompatibleLocalHubUrl({
		workspaceRoot: options.workspaceRoot,
		cwd: options.cwd,
	});
}

export {
	HubChatLifecycleClient,
	type HubChatLifecycleClientTransport,
	HubChatLifecycleCommandError,
	type HubChatLifecycleInvokeInput,
	type HubChatLifecycleReconciliationHandle,
	type HubChatLifecycleReconciliationHandlers,
	type HubChatLifecycleReconciliationOptions,
	HubChatLifecycleStreamError,
	type HubChatLifecycleStreamErrorCode,
	type HubChatLifecycleSubscriptionHandlers,
} from "./chat-lifecycle-client";
export {
	HubChatProjectionClient,
	type HubChatProjectionClientTransport,
	HubChatProjectionCommandError,
	type HubChatProjectionCommandOptions,
	HubChatProjectionProtocolError,
} from "./chat-projection-client";
export {
	HubChatRuntimeClient,
	type HubChatRuntimeClientTransport,
	HubChatRuntimeCommandError,
	type HubChatRuntimeInvokeInput,
	type HubChatRuntimeSubscriptionHandlers,
} from "./chat-runtime-client";
export {
	MANAGED_HUB_CHAT_REQUIRED_CAPABILITIES,
	ManagedHubChatClient,
	ManagedHubChatClientError,
	type ManagedHubChatClientErrorCode,
	type ManagedHubChatClientOptions,
	type ManagedHubChatClientSnapshot,
	type ManagedHubChatClientState,
	type ManagedHubChatHydration,
	type ManagedHubChatPendingOperation,
	type ManagedHubChatProjectionSnapshot,
	type ManagedHubChatReattachInput,
	type ManagedHubChatRuntimeEvent,
	type ManagedHubChatRuntimeEventListener,
	ManagedHubChatSession,
	type ManagedHubChatSessionSnapshot,
	type ManagedHubChatTransport,
	type ManagedHubWorkspaceCapabilityProvider,
} from "./managed-chat-client";
export {
	ManagedSessionController,
	ManagedSessionControllerError,
	type ManagedSessionControllerErrorCode,
	type ManagedSessionControllerOptions,
	type ManagedSessionControllerSnapshot,
	type ManagedSessionControllerState,
	type ManagedSessionControllerTransport,
} from "./managed-session-controller";
