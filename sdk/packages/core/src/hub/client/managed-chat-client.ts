import { createHash } from "node:crypto";
import {
	CHAT_LIFECYCLE_WIRE_VERSION,
	CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE,
	CHAT_RUNTIME_WIRE_VERSION,
	type HubChatLifecycleCommandName,
	type HubChatLifecycleProfileAuthority,
	type HubChatLifecycleReady,
	type HubChatLifecycleReconciledWireEvent,
	type HubChatLifecycleRequestPayload,
	type HubChatLifecycleResult,
	type HubChatProjectionChat,
	type HubChatProjectionGetResult,
	type HubChatProjectionListRequest,
	type HubChatProjectionListResult,
	type HubChatRuntimeCommandName,
	type HubChatRuntimeRequestPayload,
	type HubChatRuntimeResult,
	type HubChatRuntimeWireEvent,
	type HubEventEnvelope,
	type HubProtocolMetadata,
	isHubProtocolCompatible,
	parseHubChatLifecycleWireRequest,
	parseHubChatRuntimeWireRequest,
} from "@cline/shared";
import {
	HubChatLifecycleClient,
	type HubChatLifecycleClientTransport,
	HubChatLifecycleCommandError,
	type HubChatLifecycleReconciliationHandle,
	type HubChatLifecycleStreamError,
} from "./chat-lifecycle-client";
import {
	HubChatProjectionClient,
	type HubChatProjectionClientTransport,
} from "./chat-projection-client";
import {
	HubChatRuntimeClient,
	type HubChatRuntimeClientTransport,
	HubChatRuntimeCommandError,
} from "./chat-runtime-client";
import {
	ManagedSessionController,
	type ManagedSessionControllerSnapshot,
	type ManagedSessionControllerTransport,
} from "./managed-session-controller";

export const MANAGED_HUB_CHAT_REQUIRED_CAPABILITIES = [
	"chat_projection.v1",
	"chat_lifecycle.v1",
	"chat_runtime.v1",
] as const;

const DEFAULT_MAX_RESIDENT_SESSIONS = 32;
const MAX_RESIDENT_SESSIONS = 255;
const DEFAULT_PROJECTION_PAGE_SIZE = 100;
const DEFAULT_READINESS_TIMEOUT_MS = 10_000;
const MAX_PENDING_OPERATIONS = 256;
const MAX_RUNTIME_EVENT_OBSERVERS = 32;
const MAX_RUNTIME_OBSERVER_PENDING_EVENTS =
	CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE;
const MAX_INITIAL_RUNTIME_EVENTS = CHAT_RUNTIME_MAX_SESSION_SEQUENCE_RANGE;

export interface ManagedHubWorkspaceCapabilityProvider {
	getFreshCapability(input: {
		readonly hubUrl: string;
		readonly clientId: string;
	}):
		| { readonly credential: string; readonly expiresAt?: string }
		| Promise<{ readonly credential: string; readonly expiresAt?: string }>;
}

export type ManagedHubChatTransport = HubChatProjectionClientTransport &
	HubChatLifecycleClientTransport &
	HubChatRuntimeClientTransport &
	ManagedSessionControllerTransport & {
		dispose(): void | Promise<void>;
	};

export interface ManagedHubChatClientOptions {
	/** Read-only protocol/capability probe. It runs before transport creation. */
	readonly capabilityProbe: () =>
		| HubProtocolMetadata
		| undefined
		| Promise<HubProtocolMetadata | undefined>;
	/** The only accepted workspace authority input. */
	readonly workspaceCapabilityProvider: ManagedHubWorkspaceCapabilityProvider;
	/** Called only after managed capability preflight succeeds. */
	readonly transportFactory: (input: {
		readonly workspaceCapabilityProvider: ManagedHubWorkspaceCapabilityProvider;
	}) => ManagedHubChatTransport;
	readonly maxResidentSessions?: number;
	readonly projectionPageSize?: number;
	readonly readinessTimeoutMs?: number;
	readonly onProjectionChange?: (
		snapshot: ManagedHubChatProjectionSnapshot,
	) => void | Promise<void>;
	readonly onError?: (error: ManagedHubChatClientError) => void | Promise<void>;
}

export type ManagedHubChatClientState =
	| "opening"
	| "ready"
	| "failed"
	| "disposed";

export type ManagedHubChatClientErrorCode =
	| "capacity_exhausted"
	| "correlation_error"
	| "disposed"
	| "failed"
	| "incompatible_hub"
	| "initialization_failed"
	| "invalid_configuration"
	| "missing_capability"
	| "observer_failed"
	| "observer_overflow"
	| "operation_conflict"
	| "reattach_failed"
	| "session_busy"
	| "session_not_ready";

export class ManagedHubChatClientError extends Error {
	constructor(
		readonly code: ManagedHubChatClientErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ManagedHubChatClientError";
	}
}

export interface ManagedHubChatProjectionSnapshot {
	readonly snapshotId: string;
	readonly snapshotSequence: number;
	readonly checkpoint: number;
	readonly chats: readonly HubChatProjectionChat[];
	readonly nextCursor?: string;
}

export interface ManagedHubChatClientSnapshot {
	readonly state: ManagedHubChatClientState;
	readonly residentSessionIds: readonly string[];
	readonly pendingOperations: readonly ManagedHubChatPendingOperation[];
	readonly projection?: ManagedHubChatProjectionSnapshot;
}

export interface ManagedHubChatPendingOperation {
	readonly operationId: string;
	readonly command: HubChatLifecycleCommandName | HubChatRuntimeCommandName;
	readonly intentDigest: string;
}

/** Ordinary resume intent used only when continuity reports nonresidency. */
export type ManagedHubChatReattachInput =
	HubChatLifecycleRequestPayload<"chat_lifecycle.resume">;

/** Bounded, sanitized authoritative state captured before reattach readiness. */
export type ManagedHubChatHydration =
	HubChatRuntimeResult<"chat_runtime.session.hydrate">;

type DeepReadonly<Value> = Value extends readonly unknown[]
	? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
	: Value extends object
		? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
		: Value;

/** One deeply immutable, sanitized event already accepted by the controller. */
export type ManagedHubChatRuntimeEvent = DeepReadonly<HubChatRuntimeWireEvent>;

export type ManagedHubChatRuntimeEventListener = (
	event: ManagedHubChatRuntimeEvent,
) => void | Promise<void>;

interface PendingOperation extends ManagedHubChatPendingOperation {
	readonly inFlight: boolean;
}

type ManagedAdmissionCommand =
	| "chat_lifecycle.start_root"
	| "chat_lifecycle.start_related"
	| "chat_lifecycle.restore_checkpoint"
	| "chat_lifecycle.resume"
	| "chat_lifecycle.recover_lost_lease";

interface ManagedAdmissionResult {
	readonly sessionId: string;
	readonly chatId: string;
	readonly leaseRevision: number;
	readonly writerGeneration: number;
	readonly leaseExpiresAt: string;
	readonly profileAuthority: HubChatLifecycleProfileAuthority;
}

interface ManagedAdmissionState {
	cancelled: boolean;
	controller?: ManagedSessionController;
	promise?: Promise<ManagedHubChatSession>;
}

type LifecycleInvoker = <Command extends HubChatLifecycleCommandName>(
	command: Command,
	payload: HubChatLifecycleRequestPayload<Command>,
	requiredConnectionGeneration: number,
) => Promise<HubChatLifecycleResult<Command>>;

type RuntimeInvoker = <Command extends HubChatRuntimeCommandName>(
	command: Command,
	payload: HubChatRuntimeRequestPayload<Command>,
	requiredConnectionGeneration: number,
) => Promise<HubChatRuntimeResult<Command>>;

const SESSION_ACCEPT_RUNTIME_EVENT = Symbol("managed-session-runtime-event");
const SESSION_ASSERT_RUNTIME_OBSERVER_READY = Symbol(
	"managed-session-runtime-observer-ready",
);
const SESSION_MARK_READY = Symbol("managed-session-ready");
const SESSION_DISPOSE_FROM_OWNER = Symbol("managed-session-owner-dispose");

function boundedPositiveInteger(
	value: number | undefined,
	fallback: number,
	maximum: number,
	label: string,
): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
		throw new ManagedHubChatClientError(
			"invalid_configuration",
			`Managed chat ${label} is invalid.`,
		);
	}
	return resolved;
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).sort(
		([left], [right]) => left.localeCompare(right),
	);
	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function intentDigest(
	command: string,
	payload: Record<string, unknown>,
): string {
	return createHash("sha256")
		.update(command)
		.update("\0")
		.update(canonicalJson(payload))
		.digest("hex");
}

function cloneProjectionChat(
	chat: HubChatProjectionChat,
): HubChatProjectionChat {
	return structuredClone(chat);
}

function freezeProfileAuthority(
	authority: HubChatLifecycleProfileAuthority,
): HubChatLifecycleProfileAuthority {
	return Object.freeze({
		...authority,
		allowedModes: Object.freeze([...authority.allowedModes]),
	});
}

function freezeData<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const nested of Object.values(value as Record<string, unknown>)) {
		freezeData(nested);
	}
	return Object.freeze(value) as T;
}

function freezeHydration(
	hydration: ManagedHubChatHydration,
): ManagedHubChatHydration {
	return freezeData(structuredClone(hydration));
}

function freezeRuntimeEvent(
	event: HubChatRuntimeWireEvent,
): ManagedHubChatRuntimeEvent {
	return freezeData(structuredClone(event));
}

function compareProjectionChats(
	left: HubChatProjectionChat,
	right: HubChatProjectionChat,
): number {
	const activityOrder =
		Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt);
	return activityOrder !== 0
		? activityOrder
		: left.chatId.localeCompare(right.chatId);
}

function validateFactoryOptions(options: ManagedHubChatClientOptions): void {
	const allowed = new Set([
		"capabilityProbe",
		"workspaceCapabilityProvider",
		"transportFactory",
		"maxResidentSessions",
		"projectionPageSize",
		"readinessTimeoutMs",
		"onProjectionChange",
		"onError",
	]);
	if (
		!options ||
		typeof options !== "object" ||
		Object.keys(options).some((key) => !allowed.has(key)) ||
		typeof options.capabilityProbe !== "function" ||
		typeof options.transportFactory !== "function" ||
		!options.workspaceCapabilityProvider ||
		typeof options.workspaceCapabilityProvider.getFreshCapability !== "function"
	) {
		throw new ManagedHubChatClientError(
			"invalid_configuration",
			"Managed chat client configuration is invalid.",
		);
	}
}

/**
 * Gate-off owner for managed projection, lifecycle reconciliation, and a
 * bounded set of per-session runtime controllers.
 */
export class ManagedHubChatClient {
	readonly #transport: ManagedHubChatTransport;
	readonly #projectionClient: HubChatProjectionClient;
	readonly #lifecycleClient: HubChatLifecycleClient;
	readonly #runtimeClient: HubChatRuntimeClient;
	readonly #maxResidentSessions: number;
	readonly #projectionPageSize: number;
	readonly #readinessTimeoutMs: number;
	readonly #onProjectionChange?: (
		snapshot: ManagedHubChatProjectionSnapshot,
	) => void | Promise<void>;
	readonly #onError?: (
		error: ManagedHubChatClientError,
	) => void | Promise<void>;
	readonly #resident = new Map<string, ManagedHubChatSession>();
	readonly #reservations = new Set<string>();
	readonly #admissions = new Set<ManagedAdmissionState>();
	readonly #pendingOperations = new Map<string, PendingOperation>();
	readonly #projectionChats = new Map<string, HubChatProjectionChat>();
	#state: ManagedHubChatClientState = "opening";
	#lifecycleSubscription: HubChatLifecycleReconciliationHandle | undefined;
	#projectionSnapshotId: string | undefined;
	#projectionSnapshotSequence: number | undefined;
	#projectionNextCursor: string | undefined;
	#lifecycleCheckpoint = 0;
	#transportDisposed = false;
	#transportDisposeBarrier: Promise<void> | undefined;
	#disposeBarrier: Promise<void> | undefined;

	private constructor(
		transport: ManagedHubChatTransport,
		options: ManagedHubChatClientOptions,
	) {
		this.#transport = transport;
		this.#projectionClient = new HubChatProjectionClient(transport);
		this.#lifecycleClient = new HubChatLifecycleClient(transport);
		this.#runtimeClient = new HubChatRuntimeClient(transport);
		this.#maxResidentSessions = boundedPositiveInteger(
			options.maxResidentSessions,
			DEFAULT_MAX_RESIDENT_SESSIONS,
			MAX_RESIDENT_SESSIONS,
			"resident-session limit",
		);
		this.#projectionPageSize = boundedPositiveInteger(
			options.projectionPageSize,
			DEFAULT_PROJECTION_PAGE_SIZE,
			DEFAULT_PROJECTION_PAGE_SIZE,
			"projection page size",
		);
		this.#readinessTimeoutMs = boundedPositiveInteger(
			options.readinessTimeoutMs,
			DEFAULT_READINESS_TIMEOUT_MS,
			300_000,
			"readiness timeout",
		);
		this.#onProjectionChange = options.onProjectionChange;
		this.#onError = options.onError;
	}

	static async create(
		options: ManagedHubChatClientOptions,
	): Promise<ManagedHubChatClient> {
		validateFactoryOptions(options);
		let metadata: HubProtocolMetadata | undefined;
		try {
			metadata = await options.capabilityProbe();
		} catch {
			throw new ManagedHubChatClientError(
				"incompatible_hub",
				"Managed chat capability preflight failed.",
			);
		}
		if (!metadata || !isHubProtocolCompatible(metadata).compatible) {
			throw new ManagedHubChatClientError(
				"incompatible_hub",
				"Hub protocol is incompatible with managed chat.",
			);
		}
		const capabilities = new Set(metadata.capabilities ?? []);
		for (const capability of MANAGED_HUB_CHAT_REQUIRED_CAPABILITIES) {
			if (!capabilities.has(capability)) {
				throw new ManagedHubChatClientError(
					"missing_capability",
					`Hub is missing required managed capability ${capability}.`,
				);
			}
		}

		let transport: ManagedHubChatTransport;
		try {
			transport = options.transportFactory({
				workspaceCapabilityProvider: options.workspaceCapabilityProvider,
			});
		} catch {
			throw new ManagedHubChatClientError(
				"initialization_failed",
				"Managed chat transport construction failed.",
			);
		}
		const client = new ManagedHubChatClient(transport, options);
		try {
			await client.#open();
			return client;
		} catch (error) {
			try {
				await client.dispose();
			} catch {
				// Cleanup failure cannot replace the primary initialization failure.
			}
			if (error instanceof ManagedHubChatClientError) throw error;
			throw new ManagedHubChatClientError(
				"initialization_failed",
				"Managed chat client initialization failed closed.",
			);
		}
	}

	getSnapshot(): ManagedHubChatClientSnapshot {
		return Object.freeze({
			state: this.#state,
			residentSessionIds: Object.freeze([...this.#resident.keys()].sort()),
			pendingOperations: Object.freeze(
				[...this.#pendingOperations.values()].map((operation) =>
					Object.freeze({
						operationId: operation.operationId,
						command: operation.command,
						intentDigest: operation.intentDigest,
					}),
				),
			),
			...(this.#projectionSnapshotId
				? { projection: this.getProjectionSnapshot() }
				: {}),
		});
	}

	getProjectionSnapshot(): ManagedHubChatProjectionSnapshot {
		if (
			!this.#projectionSnapshotId ||
			this.#projectionSnapshotSequence === undefined
		) {
			throw new ManagedHubChatClientError(
				"failed",
				"Managed chat projection is unavailable.",
			);
		}
		return Object.freeze({
			snapshotId: this.#projectionSnapshotId,
			snapshotSequence: this.#projectionSnapshotSequence,
			checkpoint: this.#lifecycleCheckpoint,
			chats: Object.freeze(
				[...this.#projectionChats.values()].map(cloneProjectionChat),
			),
			...(this.#projectionNextCursor
				? { nextCursor: this.#projectionNextCursor }
				: {}),
		});
	}

	async listChats(
		input: HubChatProjectionListRequest = {},
	): Promise<HubChatProjectionListResult> {
		this.#assertReady();
		return await this.#projectionClient.list(input, {
			requiredConnectionGeneration: this.#currentConnectionGeneration(),
		});
	}

	async getChat(chatId: string): Promise<HubChatProjectionGetResult> {
		this.#assertReady();
		return await this.#projectionClient.get(
			{ chatId },
			{ requiredConnectionGeneration: this.#currentConnectionGeneration() },
		);
	}

	startRoot(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.start_root">,
	): Promise<ManagedHubChatSession> {
		return this.#startAdmission("chat_lifecycle.start_root", input);
	}

	startRelated(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.start_related">,
	): Promise<ManagedHubChatSession> {
		return this.#startAdmission("chat_lifecycle.start_related", input);
	}

	restoreCheckpoint(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.restore_checkpoint">,
	): Promise<ManagedHubChatSession> {
		return this.#startAdmission("chat_lifecycle.restore_checkpoint", input);
	}

	resume(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.resume">,
	): Promise<ManagedHubChatSession> {
		return this.#startAdmission("chat_lifecycle.resume", input);
	}

	/**
	 * Reattaches a fresh caller process without treating client cache as writer
	 * authority. Nonresident sessions use the supplied ordinary resume intent;
	 * resident orphans use server-issued continuity and the durable reclaim path.
	 */
	reattach(input: ManagedHubChatReattachInput): Promise<ManagedHubChatSession> {
		const admission: ManagedAdmissionState = { cancelled: false };
		this.#admissions.add(admission);
		const promise = this.#reattach(input, admission);
		admission.promise = promise;
		void promise.then(
			() => this.#admissions.delete(admission),
			() => this.#admissions.delete(admission),
		);
		return promise;
	}

	recoverLostLease(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.recover_lost_lease">,
	): Promise<ManagedHubChatSession> {
		return this.#startAdmission("chat_lifecycle.recover_lost_lease", input);
	}

	archiveChat(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.archive">,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.archive">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.archive",
			input,
			this.#readyConnectionGeneration(),
		);
	}

	activateChat(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.activate">,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.activate">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.activate",
			input,
			this.#readyConnectionGeneration(),
		);
	}

	renameChat(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.rename">,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.rename">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.rename",
			input,
			this.#readyConnectionGeneration(),
		);
	}

	purgeChat(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.purge">,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.purge">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.purge",
			input,
			this.#readyConnectionGeneration(),
		);
	}

	getBinding(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.binding.get">,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.binding.get">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.binding.get",
			input,
			this.#readyConnectionGeneration(),
		);
	}

	bind(
		input: HubChatLifecycleRequestPayload<"chat_lifecycle.bind">,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.bind">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.bind",
			input,
			this.#readyConnectionGeneration(),
		);
	}

	dispose(): Promise<void> {
		if (this.#disposeBarrier) return this.#disposeBarrier;
		this.#disposeBarrier = this.#disposeOwned();
		return this.#disposeBarrier;
	}

	async #disposeOwned(): Promise<void> {
		this.#state = "disposed";
		this.#lifecycleSubscription?.release();
		this.#lifecycleSubscription = undefined;
		const admissions = [...this.#admissions];
		for (const admission of admissions) admission.cancelled = true;
		await Promise.allSettled([
			...[...this.#resident.values()].map((session) =>
				session[SESSION_DISPOSE_FROM_OWNER](),
			),
			...admissions.flatMap((admission) =>
				admission.controller ? [admission.controller.disposeAndWait()] : [],
			),
		]);
		this.#resident.clear();
		if (!this.#transportDisposed) {
			this.#transportDisposed = true;
			this.#transportDisposeBarrier = Promise.resolve()
				.then(() => this.#transport.dispose())
				.then(() => undefined);
		}
		let transportError: unknown;
		try {
			await this.#transportDisposeBarrier;
		} catch (error) {
			transportError = error;
		}
		await Promise.allSettled(
			admissions.flatMap((admission) =>
				admission.promise ? [admission.promise] : [],
			),
		);
		this.#admissions.clear();
		this.#reservations.clear();
		this.#pendingOperations.clear();
		if (transportError) throw transportError;
	}

	async #open(): Promise<void> {
		await this.#transport.connect();
		const connectionGeneration = this.#currentConnectionGeneration();
		const initial = await this.#projectionClient.list(
			{ catalogState: "all", limit: this.#projectionPageSize },
			{ requiredConnectionGeneration: connectionGeneration },
		);
		this.#projectionSnapshotId = initial.snapshotId;
		this.#projectionSnapshotSequence = initial.snapshotSequence;
		this.#projectionNextCursor = initial.nextCursor;
		this.#lifecycleCheckpoint = initial.snapshotSequence;
		for (const chat of initial.chats) {
			this.#projectionChats.set(chat.chatId, cloneProjectionChat(chat));
		}
		this.#trimProjection();

		const subscription = this.#lifecycleClient.subscribeReconciled(
			{
				onEvent: (event) => this.#applyLifecycleEvent(event),
				onCheckpoint: (checkpoint) => {
					this.#lifecycleCheckpoint = checkpoint;
					if (this.#state === "ready") this.#notifyProjection();
				},
				onError: (error) => this.#failLifecycle(error),
			},
			{
				afterSequence: initial.snapshotSequence,
				requiredConnectionGeneration: connectionGeneration,
				readinessTimeoutMs: this.#readinessTimeoutMs,
			},
		);
		this.#lifecycleSubscription = subscription;
		const ready = await subscription.ready;
		this.#acceptLifecycleReady(initial.snapshotSequence, ready);
		if (this.#state !== "opening") {
			throw new ManagedHubChatClientError(
				"initialization_failed",
				"Managed chat client lost lifecycle authority during startup.",
			);
		}
		this.#state = "ready";
		this.#notifyProjection();
	}

	#acceptLifecycleReady(
		afterSequence: number,
		ready: HubChatLifecycleReady,
	): void {
		if (
			ready.afterSequence !== afterSequence ||
			ready.throughSequence < this.#lifecycleCheckpoint
		) {
			throw new ManagedHubChatClientError(
				"initialization_failed",
				"Managed lifecycle readiness did not reconcile its projection cut.",
			);
		}
		this.#lifecycleCheckpoint = ready.throughSequence;
	}

	#applyLifecycleEvent(event: HubChatLifecycleReconciledWireEvent): void {
		const projected = event.payload.chat;
		if (projected) {
			this.#projectionChats.set(
				projected.chatId,
				cloneProjectionChat(projected),
			);
		} else {
			this.#projectionChats.delete(event.payload.chatId);
		}
		this.#trimProjection();
	}

	#trimProjection(): void {
		const ordered = [...this.#projectionChats.values()]
			.sort(compareProjectionChats)
			.slice(0, this.#projectionPageSize);
		this.#projectionChats.clear();
		for (const chat of ordered) this.#projectionChats.set(chat.chatId, chat);
	}

	#notifyProjection(): void {
		let outcome: void | Promise<void>;
		try {
			outcome = this.#onProjectionChange?.(this.getProjectionSnapshot());
		} catch {
			// Projection observers cannot affect managed authority.
			return;
		}
		if (outcome) void Promise.resolve(outcome).catch(() => undefined);
	}

	#notifyError(error: ManagedHubChatClientError): void {
		let outcome: void | Promise<void>;
		try {
			outcome = this.#onError?.(error);
		} catch {
			// Error observers cannot affect managed authority.
			return;
		}
		if (outcome) void Promise.resolve(outcome).catch(() => undefined);
	}

	#failLifecycle(error: HubChatLifecycleStreamError): void {
		if (this.#state === "disposed" || this.#state === "failed") return;
		this.#state = "failed";
		this.#lifecycleSubscription?.release();
		this.#lifecycleSubscription = undefined;
		const admissions = [...this.#admissions];
		for (const admission of admissions) admission.cancelled = true;
		const controllerDrain = Promise.allSettled([
			...[...this.#resident.values()].map((session) =>
				session[SESSION_DISPOSE_FROM_OWNER](),
			),
			...admissions.flatMap((admission) =>
				admission.controller ? [admission.controller.disposeAndWait()] : [],
			),
		]);
		this.#resident.clear();
		const sanitized = new ManagedHubChatClientError(
			"failed",
			error.code === "replay_unavailable"
				? "Managed lifecycle replay is unavailable; replace the projection snapshot."
				: "Managed lifecycle reconciliation failed closed.",
		);
		this.#notifyError(sanitized);
		if (!this.#transportDisposed) {
			this.#transportDisposed = true;
			this.#transportDisposeBarrier = (async () => {
				await controllerDrain;
				try {
					await this.#transport.dispose();
				} catch {
					// Failure cleanup remains best effort and fail closed.
				}
				await Promise.allSettled(
					admissions.flatMap((admission) =>
						admission.promise ? [admission.promise] : [],
					),
				);
			})();
		}
	}

	#reportRuntimeObserverError(
		code: "observer_failed" | "observer_overflow",
	): void {
		const sanitized = new ManagedHubChatClientError(
			code,
			code === "observer_overflow"
				? "Managed runtime event observer capacity was exceeded."
				: "Managed runtime event observer failed.",
		);
		this.#notifyError(sanitized);
	}

	async #reattach(
		input: ManagedHubChatReattachInput,
		admission: ManagedAdmissionState,
	): Promise<ManagedHubChatSession> {
		this.#assertReady();
		const request = parseHubChatLifecycleWireRequest({
			version: CHAT_LIFECYCLE_WIRE_VERSION,
			command: "chat_lifecycle.resume",
			payload: input,
		});
		const resumeInput =
			request.payload as unknown as ManagedHubChatReattachInput;
		const sessionId = String(request.payload.sessionId ?? "");
		const continuityGeneration = this.#currentConnectionGeneration();
		const continuity = await this.#invokeRuntime(
			"chat_runtime.session.continuity",
			{ sessionId },
			continuityGeneration,
		);
		this.#assertAdmissionActive(admission);
		if (continuity.state === "not_resident") {
			return await this.#admit("chat_lifecycle.resume", resumeInput, admission);
		}
		if (continuity.state === "owned_elsewhere") {
			throw new ManagedHubChatClientError(
				"session_busy",
				"Managed session is active on another connection.",
			);
		}

		this.#reserve(sessionId);
		let controller: ManagedSessionController | undefined;
		let handle: ManagedHubChatSession | undefined;
		let hydration: ManagedHubChatHydration | undefined;
		const bufferedRuntimeEvents: HubEventEnvelope[] = [];
		let bufferedRuntimeEventOverflow = false;
		try {
			controller = new ManagedSessionController({
				transport: this.#transport,
				runtimeClient: this.#runtimeClient,
				sessionId,
				writerGeneration: continuity.writerGeneration,
				initialCursor: continuity.runtimeBaseline,
				initialReclaim: true,
				prepareInitialReclaim: async (preparation) => {
					const nextHydration = await this.#invokeRuntime(
						"chat_runtime.session.hydrate",
						{
							sessionId,
							expectedWriterGeneration: preparation.writerGeneration,
							baseline: preparation.baseline,
						},
						preparation.connectionGeneration,
					);
					if (
						nextHydration.sessionId !== sessionId ||
						nextHydration.writerGeneration !== preparation.writerGeneration ||
						nextHydration.requestedBaseline.streamId !==
							preparation.baseline.streamId ||
						nextHydration.requestedBaseline.sessionSequence !==
							preparation.baseline.sessionSequence ||
						nextHydration.runtimeBaseline.streamId !==
							preparation.baseline.streamId ||
						nextHydration.runtimeBaseline.sessionSequence <
							preparation.baseline.sessionSequence ||
						nextHydration.replayAvailable !== true
					) {
						throw new ManagedHubChatClientError(
							"reattach_failed",
							"Managed session hydration cannot prove continuous replay.",
						);
					}
					hydration = freezeHydration(nextHydration);
				},
				onEvent: (event) => {
					if (handle) handle[SESSION_ACCEPT_RUNTIME_EVENT](event);
					else if (bufferedRuntimeEvents.length < MAX_INITIAL_RUNTIME_EVENTS) {
						bufferedRuntimeEvents.push(event);
					} else if (!bufferedRuntimeEventOverflow) {
						bufferedRuntimeEventOverflow = true;
						this.#reportRuntimeObserverError("observer_overflow");
					}
				},
				readinessTimeoutMs: this.#readinessTimeoutMs,
			});
			admission.controller = controller;
			await controller.start();
			this.#assertAdmissionActive(admission);
			const controllerSnapshot = controller.getSnapshot();
			if (
				!hydration ||
				controllerSnapshot.state !== "ready" ||
				controllerSnapshot.leaseRevision === undefined ||
				hydration.writerGeneration !== controllerSnapshot.writerGeneration
			) {
				throw new ManagedHubChatClientError(
					"reattach_failed",
					"Managed session reattach did not produce correlated ready state.",
				);
			}
			if (bufferedRuntimeEventOverflow) {
				throw new ManagedHubChatClientError(
					"observer_overflow",
					"Managed initial runtime event delivery overflowed.",
				);
			}
			handle = new ManagedHubChatSession({
				controller,
				sessionId,
				chatId: hydration.chatId,
				leaseRevision: controllerSnapshot.leaseRevision,
				profileAuthority: hydration.profileAuthority,
				hydration,
				invokeLifecycle: (nextCommand, payload, requiredGeneration) =>
					this.#invokeLifecycle(nextCommand, payload, requiredGeneration),
				invokeRuntime: (nextCommand, payload, requiredGeneration) =>
					this.#invokeRuntime(nextCommand, payload, requiredGeneration),
				onObserverError: (code) => this.#reportRuntimeObserverError(code),
				release: (session) => this.#releaseSession(session),
			});
			for (const event of bufferedRuntimeEvents) {
				handle[SESSION_ACCEPT_RUNTIME_EVENT](event);
			}
			handle[SESSION_ASSERT_RUNTIME_OBSERVER_READY]();
			handle[SESSION_MARK_READY]();
			this.#resident.set(sessionId, handle);
			admission.controller = undefined;
			return handle;
		} catch (error) {
			if (handle) await handle[SESSION_DISPOSE_FROM_OWNER]();
			else if (controller) await controller.disposeAndWait();
			admission.controller = undefined;
			if (error instanceof ManagedHubChatClientError) throw error;
			if (admission.cancelled || this.#state === "disposed") {
				throw new ManagedHubChatClientError(
					"disposed",
					"Managed session admission was cancelled.",
				);
			}
			if (this.#state === "failed") {
				throw new ManagedHubChatClientError(
					"failed",
					"Managed client lost authority during session reattach.",
				);
			}
			throw new ManagedHubChatClientError(
				"reattach_failed",
				"Managed session reattach failed closed.",
			);
		} finally {
			this.#reservations.delete(sessionId);
		}
	}

	#assertAdmissionActive(admission: ManagedAdmissionState): void {
		if (!admission.cancelled && this.#state === "ready") return;
		throw new ManagedHubChatClientError(
			this.#state === "disposed" || admission.cancelled ? "disposed" : "failed",
			"Managed session admission was cancelled.",
		);
	}

	#startAdmission<Command extends ManagedAdmissionCommand>(
		command: Command,
		input: HubChatLifecycleRequestPayload<Command>,
	): Promise<ManagedHubChatSession> {
		const admission: ManagedAdmissionState = { cancelled: false };
		this.#admissions.add(admission);
		const promise = this.#admit(command, input, admission);
		admission.promise = promise;
		void promise.then(
			() => this.#admissions.delete(admission),
			() => this.#admissions.delete(admission),
		);
		return promise;
	}

	async #admit<Command extends ManagedAdmissionCommand>(
		command: Command,
		input: HubChatLifecycleRequestPayload<Command>,
		admission: ManagedAdmissionState,
	): Promise<ManagedHubChatSession> {
		this.#assertReady();
		const inputRecord = input as Record<string, unknown>;
		const sessionId =
			typeof inputRecord.sessionId === "string"
				? inputRecord.sessionId.trim()
				: "";
		const operationId =
			typeof inputRecord.operationId === "string"
				? inputRecord.operationId.trim()
				: "";
		if (!sessionId) {
			throw new ManagedHubChatClientError(
				"invalid_configuration",
				"Managed admission requires a session identity.",
			);
		}
		this.#reserve(sessionId);
		let controller: ManagedSessionController | undefined;
		let handle: ManagedHubChatSession | undefined;
		let lifecycleAccepted = false;
		try {
			const generation = this.#currentConnectionGeneration();
			const admitted = (await this.#invokeLifecycleOwned(
				command,
				input,
				generation,
				true,
			)) as ManagedAdmissionResult;
			lifecycleAccepted = true;
			if (admitted.sessionId !== sessionId) {
				throw new ManagedHubChatClientError(
					"failed",
					"Managed admission returned a different session identity.",
				);
			}
			if (admission.cancelled || this.#state !== "ready") {
				throw new ManagedHubChatClientError(
					"disposed",
					"Managed session admission was cancelled.",
				);
			}
			controller = new ManagedSessionController({
				transport: this.#transport,
				runtimeClient: this.#runtimeClient,
				sessionId: admitted.sessionId,
				writerGeneration: admitted.writerGeneration,
				leaseRevision: admitted.leaseRevision,
				leaseExpiresAt: admitted.leaseExpiresAt,
				onEvent: (event) => handle?.[SESSION_ACCEPT_RUNTIME_EVENT](event),
				readinessTimeoutMs: this.#readinessTimeoutMs,
			});
			admission.controller = controller;
			handle = new ManagedHubChatSession({
				controller,
				sessionId: admitted.sessionId,
				chatId: admitted.chatId,
				leaseRevision: admitted.leaseRevision,
				profileAuthority: admitted.profileAuthority,
				invokeLifecycle: (nextCommand, payload, requiredGeneration) =>
					this.#invokeLifecycle(nextCommand, payload, requiredGeneration),
				invokeRuntime: (nextCommand, payload, requiredGeneration) =>
					this.#invokeRuntime(nextCommand, payload, requiredGeneration),
				onObserverError: (code) => this.#reportRuntimeObserverError(code),
				release: (session) => this.#releaseSession(session),
			});
			await controller.start();
			if (admission.cancelled || this.#state !== "ready") {
				throw new ManagedHubChatClientError(
					"failed",
					"Managed client lost authority during session admission.",
				);
			}
			handle[SESSION_ASSERT_RUNTIME_OBSERVER_READY]();
			handle[SESSION_MARK_READY]();
			this.#resident.set(sessionId, handle);
			admission.controller = undefined;
			if (operationId) this.#pendingOperations.delete(operationId);
			return handle;
		} catch (error) {
			if (handle) await handle[SESSION_DISPOSE_FROM_OWNER]();
			else if (controller) await controller.disposeAndWait();
			admission.controller = undefined;
			if (lifecycleAccepted && operationId) {
				this.#markOperationUnknown(operationId);
			}
			throw error;
		} finally {
			this.#reservations.delete(sessionId);
		}
	}

	#reserve(sessionId: string): void {
		if (this.#resident.has(sessionId) || this.#reservations.has(sessionId)) {
			throw new ManagedHubChatClientError(
				"operation_conflict",
				"Managed session admission is already resident or in flight.",
			);
		}
		if (
			this.#resident.size + this.#reservations.size >=
			this.#maxResidentSessions
		) {
			throw new ManagedHubChatClientError(
				"capacity_exhausted",
				"Managed resident-session capacity is exhausted.",
			);
		}
		this.#reservations.add(sessionId);
	}

	async #releaseSession(session: ManagedHubChatSession): Promise<void> {
		await session[SESSION_DISPOSE_FROM_OWNER]();
		const current = this.#resident.get(session.sessionId);
		if (current === session) this.#resident.delete(session.sessionId);
	}

	#invokeLifecycle: LifecycleInvoker = (command, payload, generation) =>
		this.#invokeLifecycleOwned(command, payload, generation, false);

	async #invokeLifecycleOwned<Command extends HubChatLifecycleCommandName>(
		command: Command,
		payload: HubChatLifecycleRequestPayload<Command>,
		generation: number,
		retainOperationOnSuccess: boolean,
	): Promise<HubChatLifecycleResult<Command>> {
		this.#assertReady();
		this.#assertConnectionGeneration(generation);
		const request = parseHubChatLifecycleWireRequest({
			version: CHAT_LIFECYCLE_WIRE_VERSION,
			command,
			payload,
		});
		const operationId =
			typeof request.payload.operationId === "string"
				? request.payload.operationId
				: undefined;
		if (operationId)
			this.#beginOperation(operationId, command, request.payload);
		try {
			const result = await this.#lifecycleClient.invoke({
				command,
				payload: request.payload,
				requiredConnectionGeneration: generation,
			});
			if (operationId && !retainOperationOnSuccess) {
				this.#pendingOperations.delete(operationId);
			}
			return result as HubChatLifecycleResult<typeof command>;
		} catch (error) {
			if (operationId) {
				if (error instanceof HubChatLifecycleCommandError) {
					this.#pendingOperations.delete(operationId);
				} else {
					this.#markOperationUnknown(operationId);
				}
			}
			throw error;
		}
	}

	#invokeRuntime: RuntimeInvoker = async (command, payload, generation) => {
		this.#assertReady();
		this.#assertConnectionGeneration(generation);
		const request = parseHubChatRuntimeWireRequest({
			version: CHAT_RUNTIME_WIRE_VERSION,
			command,
			payload,
		});
		const operationId =
			typeof request.payload.operationId === "string"
				? request.payload.operationId
				: undefined;
		if (operationId)
			this.#beginOperation(operationId, command, request.payload);
		try {
			const result = await this.#runtimeClient.invoke({
				command,
				payload: request.payload,
				requiredConnectionGeneration: generation,
			});
			if (operationId) this.#pendingOperations.delete(operationId);
			return result as HubChatRuntimeResult<typeof command>;
		} catch (error) {
			if (operationId) {
				if (error instanceof HubChatRuntimeCommandError) {
					this.#pendingOperations.delete(operationId);
				} else {
					this.#markOperationUnknown(operationId);
				}
			}
			throw error;
		}
	};

	#beginOperation(
		operationId: string,
		command: HubChatLifecycleCommandName | HubChatRuntimeCommandName,
		payload: Record<string, unknown>,
	): void {
		const next: PendingOperation = Object.freeze({
			operationId,
			command,
			intentDigest: intentDigest(command, payload),
			inFlight: true,
		});
		const prior = this.#pendingOperations.get(operationId);
		if (
			prior &&
			(prior.command !== next.command ||
				prior.intentDigest !== next.intentDigest)
		) {
			throw new ManagedHubChatClientError(
				"operation_conflict",
				"Managed operation identity was reused with changed intent.",
			);
		}
		if (prior?.inFlight) {
			throw new ManagedHubChatClientError(
				"operation_conflict",
				"Managed operation identity already has an in-flight attempt.",
			);
		}
		if (!prior && this.#pendingOperations.size >= MAX_PENDING_OPERATIONS) {
			throw new ManagedHubChatClientError(
				"capacity_exhausted",
				"Managed pending-operation capacity is exhausted.",
			);
		}
		this.#pendingOperations.set(operationId, next);
	}

	#markOperationUnknown(operationId: string): void {
		const operation = this.#pendingOperations.get(operationId);
		if (!operation) return;
		this.#pendingOperations.set(
			operationId,
			Object.freeze({ ...operation, inFlight: false }),
		);
	}

	#readyConnectionGeneration(): number {
		this.#assertReady();
		return this.#currentConnectionGeneration();
	}

	#currentConnectionGeneration(): number {
		const generation = this.#transport.getRegisteredConnectionGeneration();
		if (
			!this.#transport.isConnected() ||
			!Number.isSafeInteger(generation) ||
			(generation ?? 0) < 1
		) {
			throw new ManagedHubChatClientError(
				"failed",
				"Managed chat transport has no registered connection generation.",
			);
		}
		return generation as number;
	}

	#assertConnectionGeneration(generation: number): void {
		if (this.#currentConnectionGeneration() !== generation) {
			throw new ManagedHubChatClientError(
				"failed",
				"Managed chat connection generation changed before command admission.",
			);
		}
	}

	#assertReady(): void {
		if (this.#state === "disposed") {
			throw new ManagedHubChatClientError(
				"disposed",
				"Managed chat client is disposed.",
			);
		}
		if (this.#state !== "ready") {
			throw new ManagedHubChatClientError(
				"failed",
				"Managed chat client is not ready.",
			);
		}
	}
}

export interface ManagedHubChatSessionSnapshot {
	readonly state: "starting" | "ready" | "failed" | "disposed";
	readonly sessionId: string;
	readonly chatId: string;
	readonly leaseRevision: number;
	readonly leaseExpiresAt?: string;
	readonly profileAuthority: HubChatLifecycleProfileAuthority;
	readonly hydration?: ManagedHubChatHydration;
	readonly controller: ManagedSessionControllerSnapshot;
}

interface ManagedHubChatSessionOptions {
	readonly controller: ManagedSessionController;
	readonly sessionId: string;
	readonly chatId: string;
	readonly leaseRevision: number;
	readonly profileAuthority: HubChatLifecycleProfileAuthority;
	readonly hydration?: ManagedHubChatHydration;
	readonly invokeLifecycle: LifecycleInvoker;
	readonly invokeRuntime: RuntimeInvoker;
	readonly onObserverError: (
		code: "observer_failed" | "observer_overflow",
	) => void;
	readonly release: (session: ManagedHubChatSession) => Promise<void>;
}

interface ResponseIntent {
	readonly operationId: string;
	readonly digest: string;
}

interface RuntimeEventObserver {
	readonly listener: ManagedHubChatRuntimeEventListener;
	readonly queue: ManagedHubChatRuntimeEvent[];
	active: boolean;
	delivering: boolean;
}

/** One ready, controller-owned managed runtime session. */
export class ManagedHubChatSession {
	readonly sessionId: string;
	readonly chatId: string;
	readonly profileAuthority: HubChatLifecycleProfileAuthority;
	readonly hydration: ManagedHubChatHydration | undefined;
	readonly #leaseRevision: number;
	readonly #controller: ManagedSessionController;
	readonly #invokeLifecycle: LifecycleInvoker;
	readonly #invokeRuntime: RuntimeInvoker;
	readonly #onObserverError: (
		code: "observer_failed" | "observer_overflow",
	) => void;
	readonly #release: (session: ManagedHubChatSession) => Promise<void>;
	readonly #runtimeEventObservers = new Set<RuntimeEventObserver>();
	readonly #initialRuntimeEvents: ManagedHubChatRuntimeEvent[] = [];
	readonly #pendingApprovals = new Map<string, string>();
	readonly #pendingCapabilities = new Map<string, string>();
	readonly #approvalResponses = new Map<string, ResponseIntent>();
	readonly #capabilityResponses = new Map<string, ResponseIntent>();
	readonly #settledApprovals = new Set<string>();
	readonly #settledCapabilities = new Set<string>();
	#usable = false;
	#disposed = false;
	#runtimeObservationStarted = false;
	#initialRuntimeEventOverflow = false;
	#disposeBarrier: Promise<void> | undefined;

	constructor(options: ManagedHubChatSessionOptions) {
		this.sessionId = options.sessionId;
		this.chatId = options.chatId;
		this.profileAuthority = freezeProfileAuthority(options.profileAuthority);
		this.hydration = options.hydration
			? freezeHydration(options.hydration)
			: undefined;
		this.#leaseRevision = options.leaseRevision;
		this.#controller = options.controller;
		this.#invokeLifecycle = options.invokeLifecycle;
		this.#invokeRuntime = options.invokeRuntime;
		this.#onObserverError = options.onObserverError;
		this.#release = options.release;
	}

	getSnapshot(): ManagedHubChatSessionSnapshot {
		const controller = this.#controller.getSnapshot();
		const state = this.#disposed
			? "disposed"
			: this.#usable && controller.state === "ready"
				? "ready"
				: controller.state === "failed"
					? "failed"
					: "starting";
		return Object.freeze({
			state,
			sessionId: this.sessionId,
			chatId: this.chatId,
			leaseRevision: controller.leaseRevision ?? this.#leaseRevision,
			profileAuthority: this.profileAuthority,
			...(this.hydration ? { hydration: this.hydration } : {}),
			...(controller.leaseExpiresAt
				? { leaseExpiresAt: controller.leaseExpiresAt }
				: {}),
			controller,
		});
	}

	runTurn(
		input: Omit<
			HubChatLifecycleRequestPayload<"chat_lifecycle.run_turn">,
			"sessionId"
		>,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.run_turn">> {
		return this.#invokeLifecycle(
			"chat_lifecycle.run_turn",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	abortRun(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.abort">,
			"sessionId"
		>,
	): Promise<HubChatRuntimeResult<"chat_runtime.abort">> {
		return this.#invokeRuntime(
			"chat_runtime.abort",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	async respondToApproval(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.approval.respond">,
			"sessionId"
		>,
	): Promise<HubChatRuntimeResult<"chat_runtime.approval.respond">> {
		const key = `${input.runId}\0${input.approvalId}`;
		if (
			this.#settledApprovals.has(key) ||
			this.#pendingApprovals.get(input.approvalId) !== input.runId
		) {
			throw new ManagedHubChatClientError(
				"correlation_error",
				"Managed approval response does not match a pending request.",
			);
		}
		this.#assertResponseIntent(
			this.#approvalResponses,
			key,
			input.operationId,
			intentDigest("chat_runtime.approval.respond", {
				...input,
				sessionId: this.sessionId,
			}),
		);
		try {
			const result = await this.#invokeRuntime(
				"chat_runtime.approval.respond",
				{ ...input, sessionId: this.sessionId },
				this.#generation(),
			);
			this.#pendingApprovals.delete(input.approvalId);
			this.#approvalResponses.delete(key);
			this.#rememberSettled(this.#settledApprovals, key);
			return result;
		} catch (error) {
			if (error instanceof HubChatRuntimeCommandError) {
				this.#pendingApprovals.delete(input.approvalId);
				this.#approvalResponses.delete(key);
				this.#rememberSettled(this.#settledApprovals, key);
			}
			throw error;
		}
	}

	async respondToCapability(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.capability.respond">,
			"sessionId"
		>,
	): Promise<HubChatRuntimeResult<"chat_runtime.capability.respond">> {
		const key = `${input.runId}\0${input.requestId}`;
		if (
			this.#settledCapabilities.has(key) ||
			this.#pendingCapabilities.get(input.requestId) !== input.runId
		) {
			throw new ManagedHubChatClientError(
				"correlation_error",
				"Managed capability response does not match a pending request.",
			);
		}
		this.#assertResponseIntent(
			this.#capabilityResponses,
			key,
			input.operationId,
			intentDigest("chat_runtime.capability.respond", {
				...input,
				sessionId: this.sessionId,
			}),
		);
		try {
			const result = await this.#invokeRuntime(
				"chat_runtime.capability.respond",
				{ ...input, sessionId: this.sessionId },
				this.#generation(),
			);
			this.#pendingCapabilities.delete(input.requestId);
			this.#capabilityResponses.delete(key);
			this.#rememberSettled(this.#settledCapabilities, key);
			return result;
		} catch (error) {
			if (error instanceof HubChatRuntimeCommandError) {
				this.#pendingCapabilities.delete(input.requestId);
				this.#capabilityResponses.delete(key);
				this.#rememberSettled(this.#settledCapabilities, key);
			}
			throw error;
		}
	}

	listPendingPrompts(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.pending_prompts.list">,
			"sessionId"
		> = {},
	): Promise<HubChatRuntimeResult<"chat_runtime.pending_prompts.list">> {
		return this.#invokeRuntime(
			"chat_runtime.pending_prompts.list",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	updatePendingPrompt(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.pending_prompts.update">,
			"sessionId"
		>,
	): Promise<HubChatRuntimeResult<"chat_runtime.pending_prompts.update">> {
		return this.#invokeRuntime(
			"chat_runtime.pending_prompts.update",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	removePendingPrompt(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.pending_prompts.remove">,
			"sessionId"
		>,
	): Promise<HubChatRuntimeResult<"chat_runtime.pending_prompts.remove">> {
		return this.#invokeRuntime(
			"chat_runtime.pending_prompts.remove",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	listMessages(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.messages.list">,
			"sessionId"
		> = {},
	): Promise<HubChatRuntimeResult<"chat_runtime.messages.list">> {
		return this.#invokeRuntime(
			"chat_runtime.messages.list",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	listCheckpoints(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.checkpoints.list">,
			"sessionId"
		> = {},
	): Promise<HubChatRuntimeResult<"chat_runtime.checkpoints.list">> {
		return this.#invokeRuntime(
			"chat_runtime.checkpoints.list",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	getUsage(): Promise<HubChatRuntimeResult<"chat_runtime.usage.get">> {
		return this.#invokeRuntime(
			"chat_runtime.usage.get",
			{ sessionId: this.sessionId },
			this.#generation(),
		);
	}

	getCompaction(): Promise<
		HubChatRuntimeResult<"chat_runtime.compaction.get">
	> {
		return this.#invokeRuntime(
			"chat_runtime.compaction.get",
			{ sessionId: this.sessionId },
			this.#generation(),
		);
	}

	runCompaction(
		input: Omit<
			HubChatRuntimeRequestPayload<"chat_runtime.compaction.run">,
			"sessionId"
		>,
	): Promise<HubChatRuntimeResult<"chat_runtime.compaction.run">> {
		return this.#invokeRuntime(
			"chat_runtime.compaction.run",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
	}

	async reset(
		input: Omit<
			HubChatLifecycleRequestPayload<"chat_lifecycle.reset">,
			"sessionId"
		>,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.reset">> {
		const result = await this.#invokeLifecycle(
			"chat_lifecycle.reset",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
		await this.disposeAsync();
		return result;
	}

	async stop(
		input: Omit<
			HubChatLifecycleRequestPayload<"chat_lifecycle.stop">,
			"sessionId"
		>,
	): Promise<HubChatLifecycleResult<"chat_lifecycle.stop">> {
		const result = await this.#invokeLifecycle(
			"chat_lifecycle.stop",
			{ ...input, sessionId: this.sessionId },
			this.#generation(),
		);
		await this.disposeAsync();
		return result;
	}

	dispose(): void {
		void this.#release(this).catch(() => undefined);
	}

	/**
	 * Retires all queued and future observer deliveries. A listener already
	 * executing is neither cancelled nor awaited and retains no session authority.
	 */
	async disposeAsync(): Promise<void> {
		await this.#release(this);
	}

	/**
	 * The first subscriber receives the bounded pre-subscription replay. Each
	 * observer then has one in-flight callback and a bounded ordered queue.
	 */
	subscribeRuntimeEvents(
		listener: ManagedHubChatRuntimeEventListener,
	): () => void {
		if (typeof listener !== "function") {
			throw new ManagedHubChatClientError(
				"invalid_configuration",
				"Managed runtime event observer is invalid.",
			);
		}
		this.#generation();
		if (this.#initialRuntimeEventOverflow) {
			throw new ManagedHubChatClientError(
				"observer_overflow",
				"Managed initial runtime event delivery overflowed.",
			);
		}
		if (this.#runtimeEventObservers.size >= MAX_RUNTIME_EVENT_OBSERVERS) {
			throw new ManagedHubChatClientError(
				"capacity_exhausted",
				"Managed runtime event observer capacity is exhausted.",
			);
		}
		const observer: RuntimeEventObserver = {
			listener,
			queue: [],
			active: true,
			delivering: false,
		};
		this.#runtimeEventObservers.add(observer);
		if (!this.#runtimeObservationStarted) {
			this.#runtimeObservationStarted = true;
			for (const event of this.#initialRuntimeEvents.splice(0)) {
				this.#enqueueRuntimeEvent(observer, event);
			}
		}
		return () => {
			this.#retireRuntimeObserver(observer);
		};
	}

	[SESSION_ACCEPT_RUNTIME_EVENT](
		event: Parameters<
			ManagedSessionControllerTransport["subscribe"]
		>[0] extends (event: infer Event) => void
			? Event
			: never,
	): void {
		const runtimeEvent = event as HubChatRuntimeWireEvent;
		const payload = runtimeEvent.payload;
		switch (payload.kind) {
			case "approval.requested":
				this.#pendingApprovals.set(payload.approvalId, payload.runId);
				break;
			case "approval.resolved": {
				const runId = this.#pendingApprovals.get(payload.approvalId);
				this.#pendingApprovals.delete(payload.approvalId);
				if (runId) {
					const key = `${runId}\0${payload.approvalId}`;
					this.#approvalResponses.delete(key);
					this.#rememberSettled(this.#settledApprovals, key);
				}
				break;
			}
			case "capability.requested":
				this.#pendingCapabilities.set(payload.requestId, payload.runId);
				break;
			case "capability.cancelled":
				this.#pendingCapabilities.delete(payload.requestId);
				this.#capabilityResponses.delete(
					`${payload.runId}\0${payload.requestId}`,
				);
				this.#rememberSettled(
					this.#settledCapabilities,
					`${payload.runId}\0${payload.requestId}`,
				);
				break;
		}
		const frozenEvent = freezeRuntimeEvent(runtimeEvent);
		if (!this.#runtimeObservationStarted) {
			if (this.#initialRuntimeEvents.length < MAX_INITIAL_RUNTIME_EVENTS) {
				this.#initialRuntimeEvents.push(frozenEvent);
			} else if (!this.#initialRuntimeEventOverflow) {
				this.#initialRuntimeEventOverflow = true;
				this.#onObserverError("observer_overflow");
			}
			return;
		}
		this.#notifyRuntimeEvent(frozenEvent);
	}

	[SESSION_ASSERT_RUNTIME_OBSERVER_READY](): void {
		if (!this.#initialRuntimeEventOverflow) return;
		throw new ManagedHubChatClientError(
			"observer_overflow",
			"Managed initial runtime event delivery overflowed.",
		);
	}

	[SESSION_MARK_READY](): void {
		if (this.#disposed || this.#controller.getSnapshot().state !== "ready") {
			throw new ManagedHubChatClientError(
				"session_not_ready",
				"Managed session controller did not reach ready.",
			);
		}
		this.#usable = true;
	}

	async [SESSION_DISPOSE_FROM_OWNER](): Promise<void> {
		if (this.#disposeBarrier) return this.#disposeBarrier;
		this.#disposeBarrier = this.#disposeOwned();
		return this.#disposeBarrier;
	}

	async #disposeOwned(): Promise<void> {
		this.#disposed = true;
		this.#usable = false;
		for (const observer of [...this.#runtimeEventObservers]) {
			this.#retireRuntimeObserver(observer);
		}
		this.#initialRuntimeEvents.length = 0;
		this.#pendingApprovals.clear();
		this.#pendingCapabilities.clear();
		this.#approvalResponses.clear();
		this.#capabilityResponses.clear();
		this.#settledApprovals.clear();
		this.#settledCapabilities.clear();
		await this.#controller.disposeAndWait();
	}

	#notifyRuntimeEvent(event: ManagedHubChatRuntimeEvent): void {
		for (const observer of [...this.#runtimeEventObservers]) {
			this.#enqueueRuntimeEvent(observer, event);
		}
	}

	#enqueueRuntimeEvent(
		observer: RuntimeEventObserver,
		event: ManagedHubChatRuntimeEvent,
	): void {
		if (!observer.active || !this.#runtimeEventObservers.has(observer)) return;
		if (observer.delivering) {
			if (observer.queue.length >= MAX_RUNTIME_OBSERVER_PENDING_EVENTS) {
				this.#retireRuntimeObserver(observer);
				this.#onObserverError("observer_overflow");
				return;
			}
			observer.queue.push(event);
			return;
		}
		observer.delivering = true;
		this.#deliverRuntimeEvent(observer, event);
	}

	#deliverRuntimeEvent(
		observer: RuntimeEventObserver,
		event: ManagedHubChatRuntimeEvent,
	): void {
		void Promise.resolve()
			.then(() => {
				if (
					!observer.active ||
					this.#disposed ||
					!this.#usable ||
					!this.#runtimeEventObservers.has(observer)
				) {
					return;
				}
				return observer.listener(event);
			})
			.then(
				() => this.#finishRuntimeEventDelivery(observer),
				() => {
					if (
						observer.active &&
						!this.#disposed &&
						this.#runtimeEventObservers.has(observer)
					) {
						this.#onObserverError("observer_failed");
					}
					this.#finishRuntimeEventDelivery(observer);
				},
			);
	}

	#finishRuntimeEventDelivery(observer: RuntimeEventObserver): void {
		if (
			!observer.active ||
			this.#disposed ||
			!this.#usable ||
			!this.#runtimeEventObservers.has(observer)
		) {
			observer.queue.length = 0;
			observer.delivering = false;
			return;
		}
		const next = observer.queue.shift();
		if (!next) {
			observer.delivering = false;
			return;
		}
		this.#deliverRuntimeEvent(observer, next);
	}

	#retireRuntimeObserver(observer: RuntimeEventObserver): void {
		if (!observer.active) return;
		observer.active = false;
		observer.queue.length = 0;
		this.#runtimeEventObservers.delete(observer);
	}

	#assertResponseIntent(
		responses: Map<string, ResponseIntent>,
		key: string,
		operationId: string,
		digest: string,
	): void {
		const prior = responses.get(key);
		if (
			prior &&
			(prior.operationId !== operationId || prior.digest !== digest)
		) {
			throw new ManagedHubChatClientError(
				"correlation_error",
				"Managed callback response is already owned by another intent.",
			);
		}
		responses.set(key, Object.freeze({ operationId, digest }));
	}

	#rememberSettled(settled: Set<string>, key: string): void {
		settled.add(key);
		while (settled.size > 1024) {
			const oldest = settled.values().next().value;
			if (oldest === undefined) break;
			settled.delete(oldest);
		}
	}

	#generation(): number {
		if (this.#disposed) {
			throw new ManagedHubChatClientError(
				"disposed",
				"Managed session handle is disposed.",
			);
		}
		const snapshot = this.#controller.getSnapshot();
		if (
			!this.#usable ||
			snapshot.state !== "ready" ||
			snapshot.connectionGeneration === undefined
		) {
			throw new ManagedHubChatClientError(
				"session_not_ready",
				"Managed session handle is not ready.",
			);
		}
		return snapshot.connectionGeneration;
	}
}
