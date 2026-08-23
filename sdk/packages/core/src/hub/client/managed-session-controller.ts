import {
	createSessionId,
	type HubChatRuntimeCursor,
	type HubEventEnvelope,
	parseHubChatRuntimeCursor,
	parseHubChatRuntimeEventSubscription,
} from "@cline/shared";
import {
	HubChatRuntimeClient,
	type HubChatRuntimeClientTransport,
} from "./chat-runtime-client";

export type ManagedSessionControllerState =
	| "idle"
	| "starting"
	| "ready"
	| "reclaiming"
	| "failed"
	| "disposed";

export interface ManagedSessionControllerSnapshot {
	readonly state: ManagedSessionControllerState;
	readonly sessionId: string;
	readonly writerGeneration: number;
	readonly leaseRevision?: number;
	readonly leaseExpiresAt?: string;
	readonly connectionGeneration?: number;
	readonly cursor?: HubChatRuntimeCursor;
}

export interface ManagedSessionControllerInitialReclaimPreparation {
	readonly sessionId: string;
	readonly writerGeneration: number;
	readonly leaseRevision: number;
	readonly leaseExpiresAt: string;
	readonly connectionGeneration: number;
	readonly baseline: HubChatRuntimeCursor;
}

export interface ManagedSessionControllerTransport
	extends HubChatRuntimeClientTransport {
	connect(): Promise<void>;
	isConnected(): boolean;
	getRegisteredConnectionGeneration(): number | undefined;
}

export interface ManagedSessionControllerOptions {
	readonly transport: ManagedSessionControllerTransport;
	readonly runtimeClient?: HubChatRuntimeClient;
	readonly sessionId: string;
	readonly writerGeneration: number;
	readonly leaseRevision?: number;
	readonly leaseExpiresAt?: string;
	/** Authoritative server baseline used by a fresh-process reattach. */
	readonly initialCursor?: HubChatRuntimeCursor;
	/** Reclaim durable writer authority before installing the first subscription. */
	readonly initialReclaim?: boolean;
	/** Bounded preparation performed after reclaim and before first subscription. */
	readonly prepareInitialReclaim?: (
		input: ManagedSessionControllerInitialReclaimPreparation,
	) => void | Promise<void>;
	readonly onEvent: (event: HubEventEnvelope) => void;
	readonly onError?: (error: ManagedSessionControllerError) => void;
	readonly onStateChange?: (snapshot: ManagedSessionControllerSnapshot) => void;
	readonly operationIdFactory?: () => string;
	readonly connectAttemptTimeoutMs?: number;
	readonly reclaimCommandTimeoutMs?: number;
	readonly recoveryTimeoutMs?: number;
	readonly readinessTimeoutMs?: number;
	readonly retryDelayMs?: number;
}

export type ManagedSessionControllerErrorCode =
	| "cancelled"
	| "connection_failed"
	| "initial_reclaim_preparation_failed"
	| "invalid_configuration"
	| "invalid_reclaim_receipt"
	| "reclaim_rejected"
	| "recovery_timeout"
	| "stream_failed";

export class ManagedSessionControllerError extends Error {
	constructor(
		readonly code: ManagedSessionControllerErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ManagedSessionControllerError";
	}
}

interface ManagedSessionReclaimReceipt {
	readonly sessionId: string;
	readonly leaseRevision: number;
	readonly writerGeneration: number;
	readonly leaseExpiresAt: string;
	readonly ownerTransferred: boolean;
}

interface ReclaimIntent {
	readonly operationId: string;
	readonly expectedWriterGeneration: number;
}

interface ActiveReclaimIntent {
	readonly epoch: number;
	readonly intent: ReclaimIntent;
	readonly connectionGeneration: number;
}

type SubscriptionOutcome =
	| { readonly kind: "ready" }
	| {
			readonly kind: "reclaim";
			readonly cursor: HubChatRuntimeCursor;
	  };

class AttemptTimeoutError extends Error {}

const DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_RECLAIM_COMMAND_TIMEOUT_MS = 8_000;
const DEFAULT_RECOVERY_TIMEOUT_MS = 45_000;
const DEFAULT_READINESS_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 100;
const MAX_CONTROLLER_TIMEOUT_MS = 300_000;
const MAX_REMEMBERED_OPERATION_IDS = 1024;

function requiredTimeout(
	value: number | undefined,
	fallback: number,
	label: string,
	allowZero = false,
): number {
	const resolved = value ?? fallback;
	if (
		!Number.isSafeInteger(resolved) ||
		resolved < (allowZero ? 0 : 1) ||
		resolved > MAX_CONTROLLER_TIMEOUT_MS
	) {
		throw new ManagedSessionControllerError(
			"invalid_configuration",
			`Managed session ${label} is invalid.`,
		);
	}
	return resolved;
}

function readErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return undefined;
	}
	return typeof error.code === "string" ? error.code : undefined;
}

function waitBounded<T>(
	promise: Promise<T>,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			callback();
		};
		const onAbort = (): void =>
			finish(() =>
				reject(
					signal.reason instanceof Error
						? signal.reason
						: new ManagedSessionControllerError(
								"cancelled",
								"Managed session controller was cancelled.",
							),
				),
			);
		const timer = setTimeout(
			() => finish(() => reject(new AttemptTimeoutError())),
			timeoutMs,
		);
		(timer as { unref?: () => void }).unref?.();
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error)),
		);
	});
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	if (ms === 0) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const onAbort = (): void => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new ManagedSessionControllerError(
							"cancelled",
							"Managed session controller was cancelled.",
						),
			);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		(timer as { unref?: () => void }).unref?.();
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Owns strict runtime continuity for one managed session. It retains only
 * sanitized cursor/generation state and never receives a lease credential.
 */
export class ManagedSessionController {
	readonly #transport: ManagedSessionControllerTransport;
	readonly #runtime: HubChatRuntimeClient;
	readonly #sessionId: string;
	readonly #initialCursor: HubChatRuntimeCursor | undefined;
	readonly #initialReclaim: boolean;
	readonly #prepareInitialReclaim:
		| ((
				input: ManagedSessionControllerInitialReclaimPreparation,
		  ) => void | Promise<void>)
		| undefined;
	readonly #onEvent: (event: HubEventEnvelope) => void;
	readonly #onError?: (error: ManagedSessionControllerError) => void;
	readonly #onStateChange?: (
		snapshot: ManagedSessionControllerSnapshot,
	) => void;
	readonly #operationIdFactory: () => string;
	readonly #connectAttemptTimeoutMs: number;
	readonly #reclaimCommandTimeoutMs: number;
	readonly #recoveryTimeoutMs: number;
	readonly #readinessTimeoutMs: number;
	readonly #retryDelayMs: number;
	readonly #lifecycle = new AbortController();
	readonly #usedOperationIds = new Set<string>();
	#state: ManagedSessionControllerState = "idle";
	#writerGeneration: number;
	#leaseRevision: number | undefined;
	#leaseExpiresAt: string | undefined;
	#connectionGeneration: number | undefined;
	#cursor: HubChatRuntimeCursor | undefined;
	#epoch = 0;
	#startPromise: Promise<void> | undefined;
	#recoveryPromise: Promise<void> | undefined;
	#releaseRuntime: (() => void) | undefined;
	#activeReclaim: ActiveReclaimIntent | undefined;
	#cancelSubscriptionWait:
		| ((error: ManagedSessionControllerError) => void)
		| undefined;
	#disposeBarrier: Promise<void> = Promise.resolve();

	constructor(options: ManagedSessionControllerOptions) {
		const subscription = parseHubChatRuntimeEventSubscription({
			sessionId: options.sessionId,
		});
		if (!subscription.sessionId) {
			throw new ManagedSessionControllerError(
				"invalid_configuration",
				"Managed session controller requires a session scope.",
			);
		}
		if (
			!Number.isSafeInteger(options.writerGeneration) ||
			options.writerGeneration < 1
		) {
			throw new ManagedSessionControllerError(
				"invalid_configuration",
				"Managed session writer generation is invalid.",
			);
		}
		if (
			(options.leaseRevision === undefined) !==
				(options.leaseExpiresAt === undefined) ||
			(options.leaseRevision !== undefined &&
				(!Number.isSafeInteger(options.leaseRevision) ||
					options.leaseRevision < 0)) ||
			(options.leaseExpiresAt !== undefined &&
				!Number.isFinite(Date.parse(options.leaseExpiresAt)))
		) {
			throw new ManagedSessionControllerError(
				"invalid_configuration",
				"Managed session lease snapshot is invalid.",
			);
		}
		this.#transport = options.transport;
		this.#runtime =
			options.runtimeClient ?? new HubChatRuntimeClient(options.transport);
		this.#sessionId = subscription.sessionId;
		try {
			this.#initialCursor = options.initialCursor
				? Object.freeze({ ...parseHubChatRuntimeCursor(options.initialCursor) })
				: undefined;
		} catch {
			throw new ManagedSessionControllerError(
				"invalid_configuration",
				"Managed session initial runtime cursor is invalid.",
			);
		}
		this.#initialReclaim = options.initialReclaim === true;
		this.#prepareInitialReclaim = options.prepareInitialReclaim;
		if (
			(this.#initialReclaim && !this.#initialCursor) ||
			(!this.#initialReclaim && this.#prepareInitialReclaim)
		) {
			throw new ManagedSessionControllerError(
				"invalid_configuration",
				"Managed session initial reclaim configuration is invalid.",
			);
		}
		this.#writerGeneration = options.writerGeneration;
		this.#leaseRevision = options.leaseRevision;
		this.#leaseExpiresAt = options.leaseExpiresAt;
		this.#onEvent = options.onEvent;
		this.#onError = options.onError;
		this.#onStateChange = options.onStateChange;
		this.#operationIdFactory =
			options.operationIdFactory ?? (() => createSessionId("runtime_reclaim_"));
		this.#connectAttemptTimeoutMs = requiredTimeout(
			options.connectAttemptTimeoutMs,
			DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS,
			"connect timeout",
		);
		this.#reclaimCommandTimeoutMs = requiredTimeout(
			options.reclaimCommandTimeoutMs,
			DEFAULT_RECLAIM_COMMAND_TIMEOUT_MS,
			"reclaim timeout",
		);
		this.#recoveryTimeoutMs = requiredTimeout(
			options.recoveryTimeoutMs,
			DEFAULT_RECOVERY_TIMEOUT_MS,
			"recovery timeout",
		);
		this.#readinessTimeoutMs = requiredTimeout(
			options.readinessTimeoutMs,
			DEFAULT_READINESS_TIMEOUT_MS,
			"readiness timeout",
		);
		this.#retryDelayMs = requiredTimeout(
			options.retryDelayMs,
			DEFAULT_RETRY_DELAY_MS,
			"retry delay",
			true,
		);
		this.#cursor = this.#initialCursor ? { ...this.#initialCursor } : undefined;
	}

	getSnapshot(): ManagedSessionControllerSnapshot {
		return Object.freeze({
			state: this.#state,
			sessionId: this.#sessionId,
			writerGeneration: this.#writerGeneration,
			...(this.#leaseRevision === undefined
				? {}
				: { leaseRevision: this.#leaseRevision }),
			...(this.#leaseExpiresAt === undefined
				? {}
				: { leaseExpiresAt: this.#leaseExpiresAt }),
			...(this.#connectionGeneration === undefined
				? {}
				: { connectionGeneration: this.#connectionGeneration }),
			...(this.#cursor ? { cursor: { ...this.#cursor } } : {}),
		});
	}

	start(): Promise<void> {
		if (this.#state === "disposed") {
			return Promise.reject(
				new ManagedSessionControllerError(
					"cancelled",
					"Managed session controller was disposed.",
				),
			);
		}
		if (this.#state === "failed") {
			return Promise.reject(
				new ManagedSessionControllerError(
					"stream_failed",
					"Managed session controller has failed closed.",
				),
			);
		}
		if (this.#startPromise) return this.#startPromise;
		const epoch = ++this.#epoch;
		this.#setState("starting");
		const deadline = Date.now() + this.#recoveryTimeoutMs;
		const work = (async () => {
			const connectionGeneration = await this.#connectRegistered(
				epoch,
				deadline,
			);
			if (this.#initialReclaim && this.#initialCursor) {
				this.#setState("reclaiming");
				await this.#runRecovery(
					epoch,
					this.#initialCursor,
					this.#prepareInitialReclaim,
				);
				return;
			}
			const outcome = await this.#installSubscription(
				epoch,
				connectionGeneration,
				this.#initialCursor,
				Math.min(this.#readinessTimeoutMs, this.#remaining(deadline)),
			);
			if (outcome.kind === "reclaim") {
				this.#setState("reclaiming");
				await this.#runRecovery(epoch, outcome.cursor);
			}
		})();
		this.#startPromise = work.catch((error) => {
			const normalized = this.#normalizeError(error, "stream_failed");
			if (this.#epoch === epoch && this.#state !== "disposed") {
				this.#fail(normalized);
			}
			throw normalized;
		});
		return this.#startPromise;
	}

	dispose(): void {
		if (this.#state === "disposed") return;
		const cancellation = new ManagedSessionControllerError(
			"cancelled",
			"Managed session controller was disposed.",
		);
		this.#epoch += 1;
		this.#connectionGeneration = undefined;
		this.#extendDisposeBarrier(this.#cancelActiveReclaim());
		this.#lifecycle.abort(cancellation);
		this.#cancelSubscriptionWait?.(cancellation);
		this.#cancelSubscriptionWait = undefined;
		const release = this.#releaseRuntime;
		this.#releaseRuntime = undefined;
		release?.();
		this.#setState("disposed");
	}

	async disposeAndWait(): Promise<void> {
		this.dispose();
		await this.#disposeBarrier;
	}

	async #runRecovery(
		epoch: number,
		initialCursor: HubChatRuntimeCursor,
		prepare?: (
			input: ManagedSessionControllerInitialReclaimPreparation,
		) => void | Promise<void>,
	): Promise<void> {
		const deadline = Date.now() + this.#recoveryTimeoutMs;
		let cursor = { ...initialCursor };
		let intent = this.#createIntent(this.#writerGeneration);
		while (true) {
			this.#assertEpoch(epoch);
			const connectionGeneration = await this.#connectRegistered(
				epoch,
				deadline,
			);
			let receipt: ManagedSessionReclaimReceipt;
			try {
				const timeoutMs = Math.min(
					this.#reclaimCommandTimeoutMs,
					this.#remaining(deadline),
				);
				this.#activeReclaim = {
					epoch,
					intent,
					connectionGeneration,
				};
				receipt = await waitBounded(
					this.#runtime.invoke<ManagedSessionReclaimReceipt>({
						command: "chat_runtime.session.reclaim",
						payload: {
							operationId: intent.operationId,
							sessionId: this.#sessionId,
							expectedWriterGeneration: intent.expectedWriterGeneration,
						},
						timeoutMs,
						requiredConnectionGeneration: connectionGeneration,
					}),
					timeoutMs,
					this.#lifecycle.signal,
				);
			} catch (error) {
				this.#assertEpoch(epoch);
				if (!this.#isRetryableReclaimError(error)) {
					throw new ManagedSessionControllerError(
						"reclaim_rejected",
						"Managed session reclaim was rejected.",
					);
				}
				await this.#retry(epoch, deadline);
				continue;
			}
			this.#assertEpoch(epoch);
			if (
				receipt.sessionId !== this.#sessionId ||
				receipt.writerGeneration !== intent.expectedWriterGeneration + 1
			) {
				throw new ManagedSessionControllerError(
					"invalid_reclaim_receipt",
					"Managed session reclaim returned an invalid generation.",
				);
			}
			this.#writerGeneration = receipt.writerGeneration;
			this.#leaseRevision = receipt.leaseRevision;
			this.#leaseExpiresAt = receipt.leaseExpiresAt;
			this.#notifyState();
			if (!receipt.ownerTransferred) {
				this.#clearActiveReclaim(epoch, intent);
				intent = this.#createIntent(this.#writerGeneration);
				continue;
			}
			if (
				!this.#transport.isConnected() ||
				this.#transport.getRegisteredConnectionGeneration() !==
					connectionGeneration
			) {
				this.#clearActiveReclaim(epoch, intent);
				intent = this.#createIntent(this.#writerGeneration);
				continue;
			}
			if (prepare) {
				try {
					await waitBounded(
						Promise.resolve(
							prepare(
								Object.freeze({
									sessionId: this.#sessionId,
									writerGeneration: receipt.writerGeneration,
									leaseRevision: receipt.leaseRevision,
									leaseExpiresAt: receipt.leaseExpiresAt,
									connectionGeneration,
									baseline: Object.freeze({ ...cursor }),
								}),
							),
						),
						Math.min(this.#readinessTimeoutMs, this.#remaining(deadline)),
						this.#lifecycle.signal,
					);
				} catch (error) {
					this.#assertEpoch(epoch);
					if (
						!this.#transport.isConnected() ||
						this.#transport.getRegisteredConnectionGeneration() !==
							connectionGeneration
					) {
						this.#clearActiveReclaim(epoch, intent);
						intent = this.#createIntent(this.#writerGeneration);
						continue;
					}
					throw new ManagedSessionControllerError(
						"initial_reclaim_preparation_failed",
						error instanceof AttemptTimeoutError
							? "Managed session initial reclaim preparation timed out."
							: "Managed session initial reclaim preparation failed closed.",
					);
				}
				this.#assertEpoch(epoch);
				if (
					!this.#transport.isConnected() ||
					this.#transport.getRegisteredConnectionGeneration() !==
						connectionGeneration
				) {
					this.#clearActiveReclaim(epoch, intent);
					intent = this.#createIntent(this.#writerGeneration);
					continue;
				}
			}
			const outcome = await this.#installSubscription(
				epoch,
				connectionGeneration,
				cursor,
				Math.min(this.#readinessTimeoutMs, this.#remaining(deadline)),
			);
			if (outcome.kind === "ready") {
				this.#clearActiveReclaim(epoch, intent);
				return;
			}
			this.#clearActiveReclaim(epoch, intent);
			cursor = { ...outcome.cursor };
			this.#cursor = cursor;
			intent = this.#createIntent(this.#writerGeneration);
		}
	}

	#beginRecovery(epoch: number, cursor: HubChatRuntimeCursor): void {
		if (
			this.#epoch !== epoch ||
			this.#state !== "ready" ||
			this.#lifecycle.signal.aborted
		) {
			return;
		}
		const release = this.#releaseRuntime;
		this.#releaseRuntime = undefined;
		release?.();
		this.#cursor = { ...cursor };
		this.#connectionGeneration = undefined;
		const recoveryEpoch = ++this.#epoch;
		this.#setState("reclaiming");
		const work = this.#runRecovery(recoveryEpoch, cursor);
		this.#recoveryPromise = work;
		void work
			.catch((error) => {
				if (this.#epoch === recoveryEpoch && this.#state !== "disposed") {
					this.#fail(this.#normalizeError(error, "reclaim_rejected"));
				}
			})
			.finally(() => {
				if (this.#recoveryPromise === work) {
					this.#recoveryPromise = undefined;
				}
			});
	}

	#installSubscription(
		epoch: number,
		connectionGeneration: number,
		initialCursor: HubChatRuntimeCursor | undefined,
		readinessTimeoutMs: number,
	): Promise<SubscriptionOutcome> {
		this.#assertEpoch(epoch);
		return new Promise<SubscriptionOutcome>((resolve, reject) => {
			let settled = false;
			let physicalRelease: (() => void) | undefined;
			let releaseRequested = false;
			const release = (): void => {
				if (releaseRequested) return;
				releaseRequested = true;
				physicalRelease?.();
			};
			const clearWait = (): void => {
				clearTimeout(readinessTimer);
				if (this.#cancelSubscriptionWait === cancelWait) {
					this.#cancelSubscriptionWait = undefined;
				}
			};
			const finish = (outcome: SubscriptionOutcome): void => {
				if (settled) return;
				settled = true;
				clearWait();
				resolve(outcome);
			};
			const fail = (error: ManagedSessionControllerError): void => {
				if (settled) return;
				settled = true;
				clearWait();
				if (this.#releaseRuntime === release) {
					this.#releaseRuntime = undefined;
				}
				release();
				reject(error);
			};
			const cancelWait = (error: ManagedSessionControllerError): void =>
				fail(error);
			const readinessTimer = setTimeout(
				() =>
					fail(
						new ManagedSessionControllerError(
							"stream_failed",
							"Managed session subscription readiness timed out.",
						),
					),
				readinessTimeoutMs,
			);
			(readinessTimer as { unref?: () => void }).unref?.();
			this.#cancelSubscriptionWait = cancelWait;
			const priorRelease = this.#releaseRuntime;
			this.#releaseRuntime = release;
			priorRelease?.();
			physicalRelease = this.#runtime.subscribe(
				{
					onEvent: (event) => {
						if (this.#epoch !== epoch || this.#lifecycle.signal.aborted) {
							return;
						}
						try {
							this.#onEvent(event);
						} catch {
							// Consumer event handlers cannot affect authority state.
						}
					},
					onCursor: (cursor) => {
						if (this.#epoch === epoch && !this.#lifecycle.signal.aborted) {
							this.#cursor = { ...cursor };
						}
					},
					onReady: (cursor) => {
						if (this.#epoch !== epoch || this.#lifecycle.signal.aborted) {
							return;
						}
						if (
							!this.#transport.isConnected() ||
							this.#transport.getRegisteredConnectionGeneration() !==
								connectionGeneration
						) {
							if (this.#releaseRuntime === release) {
								this.#releaseRuntime = undefined;
							}
							release();
							finish({ kind: "reclaim", cursor: { ...cursor } });
							return;
						}
						this.#cursor = { ...cursor };
						this.#connectionGeneration = connectionGeneration;
						this.#setState("ready");
						if (
							this.#epoch !== epoch ||
							this.#state !== "ready" ||
							this.#lifecycle.signal.aborted
						) {
							return;
						}
						finish({ kind: "ready" });
					},
					onReclaimRequired: ({ cursor }) => {
						if (this.#epoch !== epoch || this.#lifecycle.signal.aborted) {
							return;
						}
						if (this.#releaseRuntime === release) {
							this.#releaseRuntime = undefined;
						}
						if (!settled) {
							release();
							finish({ kind: "reclaim", cursor: { ...cursor } });
							return;
						}
						this.#beginRecovery(epoch, cursor);
					},
					onError: () => {
						const error = new ManagedSessionControllerError(
							"stream_failed",
							"Managed session runtime stream failed closed.",
						);
						if (!settled) {
							fail(error);
							return;
						}
						if (this.#epoch === epoch && this.#state !== "disposed") {
							this.#fail(error);
						}
					},
				},
				{
					sessionId: this.#sessionId,
					...(initialCursor ? { initialCursor: { ...initialCursor } } : {}),
					readinessTimeoutMs,
					requiredConnectionGeneration: connectionGeneration,
				},
			);
			if (releaseRequested) physicalRelease();
		});
	}

	async #connectRegistered(epoch: number, deadline: number): Promise<number> {
		while (true) {
			this.#assertEpoch(epoch);
			try {
				const timeoutMs = Math.min(
					this.#connectAttemptTimeoutMs,
					this.#remaining(deadline),
				);
				await waitBounded(
					this.#transport.connect(),
					timeoutMs,
					this.#lifecycle.signal,
				);
			} catch (error) {
				this.#assertEpoch(epoch);
				if (!this.#isRetryableConnectionError(error)) {
					throw new ManagedSessionControllerError(
						"connection_failed",
						"Managed session connection failed closed.",
					);
				}
				await this.#retry(epoch, deadline);
				continue;
			}
			this.#assertEpoch(epoch);
			const generation = this.#transport.getRegisteredConnectionGeneration();
			if (
				this.#transport.isConnected() &&
				Number.isSafeInteger(generation) &&
				(generation ?? 0) > 0
			) {
				return generation as number;
			}
			await this.#retry(epoch, deadline);
		}
	}

	#createIntent(expectedWriterGeneration: number): ReclaimIntent {
		const operationId = this.#operationIdFactory().trim();
		if (
			operationId.length < 1 ||
			operationId.length > 512 ||
			!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(operationId) ||
			this.#usedOperationIds.has(operationId)
		) {
			throw new ManagedSessionControllerError(
				"invalid_configuration",
				"Managed session reclaim operation identity is invalid.",
			);
		}
		this.#usedOperationIds.add(operationId);
		while (this.#usedOperationIds.size > MAX_REMEMBERED_OPERATION_IDS) {
			const oldest = this.#usedOperationIds.values().next().value;
			if (oldest === undefined) break;
			this.#usedOperationIds.delete(oldest);
		}
		return { operationId, expectedWriterGeneration };
	}

	#clearActiveReclaim(epoch: number, intent: ReclaimIntent): void {
		if (
			this.#activeReclaim?.epoch === epoch &&
			this.#activeReclaim.intent === intent
		) {
			this.#activeReclaim = undefined;
		}
	}

	#cancelActiveReclaim(): Promise<void> {
		const active = this.#activeReclaim;
		this.#activeReclaim = undefined;
		if (
			!active ||
			!this.#transport.isConnected() ||
			this.#transport.getRegisteredConnectionGeneration() !==
				active.connectionGeneration
		) {
			return Promise.resolve();
		}
		return this.#runtime
			.invoke({
				command: "chat_runtime.session.reclaim.cancel",
				payload: {
					operationId: active.intent.operationId,
					sessionId: this.#sessionId,
					expectedWriterGeneration: active.intent.expectedWriterGeneration,
				},
				timeoutMs: Math.min(this.#reclaimCommandTimeoutMs, 2_000),
				requiredConnectionGeneration: active.connectionGeneration,
			})
			.then(
				() => undefined,
				() => undefined,
			);
	}

	#extendDisposeBarrier(work: Promise<void>): void {
		this.#disposeBarrier = Promise.all([this.#disposeBarrier, work]).then(
			() => undefined,
		);
	}

	#remaining(deadline: number): number {
		const remaining = deadline - Date.now();
		if (remaining < 1) {
			throw new ManagedSessionControllerError(
				"recovery_timeout",
				"Managed session recovery timed out.",
			);
		}
		return remaining;
	}

	async #retry(epoch: number, deadline: number): Promise<void> {
		this.#assertEpoch(epoch);
		const delayMs = Math.min(this.#retryDelayMs, this.#remaining(deadline));
		await abortableDelay(delayMs, this.#lifecycle.signal);
		this.#assertEpoch(epoch);
	}

	#isRetryableConnectionError(error: unknown): boolean {
		if (error instanceof AttemptTimeoutError) return true;
		return new Set([
			"hub_connect_timeout",
			"hub_connect_failed",
			"hub_connection_changed",
			"hub_connection_closed",
			"hub_connection_not_open",
			"hub_registration_connection_lost",
		]).has(readErrorCode(error) ?? "");
	}

	#isRetryableReclaimError(error: unknown): boolean {
		if (error instanceof AttemptTimeoutError) return true;
		return new Set([
			"hub_command_timeout",
			"hub_connect_timeout",
			"hub_connect_failed",
			"hub_connection_changed",
			"hub_connection_closed",
			"hub_connection_not_open",
			"hub_registration_connection_lost",
			"lease_conflict",
		]).has(readErrorCode(error) ?? "");
	}

	#assertEpoch(epoch: number): void {
		if (
			this.#epoch !== epoch ||
			this.#lifecycle.signal.aborted ||
			this.#state === "failed" ||
			this.#state === "disposed"
		) {
			throw new ManagedSessionControllerError(
				"cancelled",
				"Managed session controller operation was cancelled.",
			);
		}
	}

	#normalizeError(
		error: unknown,
		fallback: ManagedSessionControllerErrorCode,
	): ManagedSessionControllerError {
		return error instanceof ManagedSessionControllerError
			? error
			: new ManagedSessionControllerError(
					fallback,
					"Managed session controller failed closed.",
				);
	}

	#fail(error: ManagedSessionControllerError): void {
		if (this.#state === "failed" || this.#state === "disposed") return;
		this.#epoch += 1;
		this.#connectionGeneration = undefined;
		this.#extendDisposeBarrier(this.#cancelActiveReclaim());
		this.#lifecycle.abort(error);
		this.#cancelSubscriptionWait?.(error);
		this.#cancelSubscriptionWait = undefined;
		const release = this.#releaseRuntime;
		this.#releaseRuntime = undefined;
		release?.();
		this.#setState("failed");
		try {
			this.#onError?.(error);
		} catch {
			// Consumer error observers cannot reactivate a failed controller.
		}
	}

	#setState(state: ManagedSessionControllerState): void {
		this.#state = state;
		this.#notifyState();
	}

	#notifyState(): void {
		try {
			this.#onStateChange?.(this.getSnapshot());
		} catch {
			// Consumer state observers cannot affect controller authority.
		}
	}
}
