import {
	CHAT_LIFECYCLE_WIRE_VERSION,
	HUB_CHAT_LIFECYCLE_REPLAY_UNAVAILABLE_ERROR_CODE,
	type HubChatLifecycleCommandName,
	type HubChatLifecycleReady,
	type HubChatLifecycleReconciledWireEvent,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	parseHubChatLifecycleEventSubscription,
	parseHubChatLifecycleReady,
	parseHubChatLifecycleReconciledWireEvent,
	parseHubChatLifecycleReconciliationSubscription,
	parseHubChatLifecycleWireEvent,
	parseHubChatLifecycleWireReply,
	parseHubChatLifecycleWireRequest,
} from "@cline/shared";
import { readTerminalHubCommandRejectionCode } from "./managed-command-error";

export interface HubChatLifecycleClientTransport {
	command(
		command: HubChatLifecycleCommandName,
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: {
			timeoutMs?: number | null;
			requiredConnectionGeneration?: number;
		},
	): Promise<HubReplyEnvelope>;
	subscribe(
		listener: (event: HubEventEnvelope) => void,
		options?: {
			sessionId?: string;
			fenced?: boolean;
			requiredConnectionGeneration?: number;
			lifecycleCursor?: () => { readonly afterSequence: number };
			onStatus?: (status: {
				readonly status: "ready" | "rejected";
				readonly errorCode?: string;
				readonly lifecycleReady?: unknown;
			}) => void;
		},
	): () => void;
}

export interface HubChatLifecycleInvokeInput {
	readonly command: HubChatLifecycleCommandName;
	readonly payload: Record<string, unknown>;
	readonly timeoutMs?: number | null;
	readonly requiredConnectionGeneration?: number;
}

export interface HubChatLifecycleSubscriptionHandlers {
	readonly onEvent: (event: HubEventEnvelope) => void;
	/** Receives a fixed, pathless error after malformed lifecycle output. */
	readonly onError?: (error: Error) => void;
}

export interface HubChatLifecycleReconciliationHandlers {
	readonly onEvent: (event: HubChatLifecycleReconciledWireEvent) => void;
	readonly onCheckpoint?: (catalogSequence: number) => void;
	readonly onReady?: (ready: HubChatLifecycleReady) => void;
	readonly onReplayUnavailable?: (error: HubChatLifecycleStreamError) => void;
	readonly onError?: (error: HubChatLifecycleStreamError) => void;
}

export interface HubChatLifecycleReconciliationOptions {
	readonly afterSequence: number;
	readonly requiredConnectionGeneration: number;
	readonly readinessTimeoutMs?: number;
}

export interface HubChatLifecycleReconciliationHandle {
	readonly ready: Promise<HubChatLifecycleReady>;
	readonly release: () => void;
	readonly getCheckpoint: () => number;
}

export class HubChatLifecycleCommandError extends Error {
	constructor(
		readonly command: HubChatLifecycleCommandName,
		readonly code: string,
	) {
		super("Managed lifecycle command was rejected.");
		this.name = "HubChatLifecycleCommandError";
	}
}

export type HubChatLifecycleStreamErrorCode =
	| "apply_failed"
	| "cancelled"
	| "invalid_chain"
	| "invalid_configuration"
	| "malformed_event"
	| "malformed_ready"
	| "readiness_timeout"
	| "rejected"
	| "replay_unavailable";

export class HubChatLifecycleStreamError extends Error {
	constructor(
		readonly code: HubChatLifecycleStreamErrorCode,
		message: string,
	) {
		super(message);
		this.name = "HubChatLifecycleStreamError";
	}
}

const LIFECYCLE_READINESS_TIMEOUT_MS = 10_000;
const MAX_LIFECYCLE_READINESS_TIMEOUT_MS = 300_000;

function requiredPositiveInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new HubChatLifecycleStreamError(
			"invalid_configuration",
			`Managed lifecycle ${label} is invalid.`,
		);
	}
	return value;
}

/**
 * Strict client adapter for the authenticated managed-lifecycle wire.
 *
 * This adapter owns wire validation only. The supplied transport must already
 * be connected with a fresh workspace capability; daemon-token or unscoped
 * transports are rejected by the server before reaching this adapter.
 */
export class HubChatLifecycleClient {
	constructor(private readonly transport: HubChatLifecycleClientTransport) {}

	async invoke<T = unknown>(input: HubChatLifecycleInvokeInput): Promise<T> {
		if (
			input.requiredConnectionGeneration !== undefined &&
			(!Number.isSafeInteger(input.requiredConnectionGeneration) ||
				input.requiredConnectionGeneration < 1)
		) {
			throw new Error("Managed lifecycle connection generation is invalid.");
		}
		const request = parseHubChatLifecycleWireRequest({
			version: CHAT_LIFECYCLE_WIRE_VERSION,
			command: input.command,
			payload: input.payload,
		});
		let reply: HubReplyEnvelope;
		try {
			reply = await this.transport.command(
				request.command,
				request.payload,
				undefined,
				input.timeoutMs === undefined &&
					input.requiredConnectionGeneration === undefined
					? undefined
					: {
							...(input.timeoutMs === undefined
								? {}
								: { timeoutMs: input.timeoutMs }),
							...(input.requiredConnectionGeneration === undefined
								? {}
								: {
										requiredConnectionGeneration:
											input.requiredConnectionGeneration,
									}),
						},
			);
		} catch (error) {
			const code = readTerminalHubCommandRejectionCode(error);
			if (code) {
				throw new HubChatLifecycleCommandError(request.command, code);
			}
			throw error;
		}
		let parsed: HubReplyEnvelope;
		try {
			parsed = parseHubChatLifecycleWireReply(request.command, reply);
		} catch {
			throw new Error("Managed lifecycle output failed v1 validation.");
		}
		if (!parsed.ok) {
			throw new HubChatLifecycleCommandError(
				request.command,
				parsed.error?.code ?? "lifecycle_rejected",
			);
		}
		return parsed.payload?.result as T;
	}

	subscribe(
		handlers: HubChatLifecycleSubscriptionHandlers,
		options?: { readonly sessionId?: string },
	): () => void {
		const subscription = parseHubChatLifecycleEventSubscription(options);
		let active = true;
		let releaseTransport = (): void => {};
		const release = (): void => {
			if (!active) return;
			active = false;
			releaseTransport();
		};
		releaseTransport = this.transport.subscribe(
			(event) => {
				if (!active || event.event !== "chat.changed") return;
				let parsed: HubEventEnvelope;
				try {
					parsed = parseHubChatLifecycleWireEvent(event);
				} catch {
					release();
					try {
						handlers.onError?.(
							new Error("Managed lifecycle event failed v1 validation."),
						);
					} catch {
						// Consumer error handlers cannot reactivate a failed stream.
					}
					return;
				}
				try {
					handlers.onEvent(parsed);
				} catch {
					// Consumer callbacks are isolated from authoritative stream health.
				}
			},
			subscription.sessionId
				? { sessionId: subscription.sessionId }
				: undefined,
		);
		if (!active) releaseTransport();
		return release;
	}

	subscribeReconciled(
		handlers: HubChatLifecycleReconciliationHandlers,
		options: HubChatLifecycleReconciliationOptions,
	): HubChatLifecycleReconciliationHandle {
		const cursor = parseHubChatLifecycleReconciliationSubscription({
			afterSequence: options.afterSequence,
		});
		const connectionGeneration = requiredPositiveInteger(
			options.requiredConnectionGeneration,
			"connection generation",
		);
		const readinessTimeoutMs =
			options.readinessTimeoutMs ?? LIFECYCLE_READINESS_TIMEOUT_MS;
		if (
			!Number.isSafeInteger(readinessTimeoutMs) ||
			readinessTimeoutMs < 1 ||
			readinessTimeoutMs > MAX_LIFECYCLE_READINESS_TIMEOUT_MS
		) {
			throw new HubChatLifecycleStreamError(
				"invalid_configuration",
				"Managed lifecycle readiness timeout is invalid.",
			);
		}

		let active = true;
		let readySettled = false;
		let checkpoint = cursor.afterSequence;
		let expectedReadyAfterSequence = cursor.afterSequence;
		let releaseTransport = (): void => {};
		let resolveReady: (ready: HubChatLifecycleReady) => void = () => {};
		let rejectReady: (error: HubChatLifecycleStreamError) => void = () => {};
		const ready = new Promise<HubChatLifecycleReady>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		void ready.catch(() => undefined);
		const readinessTimer = setTimeout(() => {
			fail(
				new HubChatLifecycleStreamError(
					"readiness_timeout",
					"Managed lifecycle replay readiness timed out.",
				),
			);
		}, readinessTimeoutMs);
		(readinessTimer as { unref?: () => void }).unref?.();

		const close = (): void => {
			if (!active) return;
			active = false;
			clearTimeout(readinessTimer);
			releaseTransport();
		};
		const notifyError = (error: HubChatLifecycleStreamError): void => {
			try {
				handlers.onError?.(error);
			} catch {
				// Consumer error observers cannot reactivate a failed stream.
			}
		};
		function fail(error: HubChatLifecycleStreamError): void {
			if (!active) return;
			close();
			if (!readySettled) {
				readySettled = true;
				rejectReady(error);
			}
			notifyError(error);
		}
		const release = (): void => {
			if (!active) return;
			close();
			if (!readySettled) {
				readySettled = true;
				rejectReady(
					new HubChatLifecycleStreamError(
						"cancelled",
						"Managed lifecycle reconciliation was released.",
					),
				);
			}
		};

		try {
			releaseTransport = this.transport.subscribe(
				(event) => {
					if (!active || event.event !== "chat.changed") return;
					let parsed: HubChatLifecycleReconciledWireEvent;
					try {
						parsed = parseHubChatLifecycleReconciledWireEvent(event);
					} catch {
						fail(
							new HubChatLifecycleStreamError(
								"malformed_event",
								"Managed lifecycle event failed reconciled v1 validation.",
							),
						);
						return;
					}
					if (parsed.previousDeliveredSequence !== checkpoint) {
						fail(
							new HubChatLifecycleStreamError(
								"invalid_chain",
								"Managed lifecycle delivery chain is discontinuous.",
							),
						);
						return;
					}
					try {
						handlers.onEvent(parsed);
					} catch {
						fail(
							new HubChatLifecycleStreamError(
								"apply_failed",
								"Managed lifecycle event application failed closed.",
							),
						);
						return;
					}
					checkpoint = parsed.catalogSequence;
					try {
						handlers.onCheckpoint?.(checkpoint);
					} catch {
						// Consumer checkpoint observers cannot affect stream health.
					}
				},
				{
					fenced: true,
					requiredConnectionGeneration: connectionGeneration,
					lifecycleCursor: () => {
						expectedReadyAfterSequence = checkpoint;
						return { afterSequence: expectedReadyAfterSequence };
					},
					onStatus: (status) => {
						if (!active) return;
						if (status.status === "rejected") {
							const replayUnavailable =
								status.errorCode ===
								HUB_CHAT_LIFECYCLE_REPLAY_UNAVAILABLE_ERROR_CODE;
							const error = new HubChatLifecycleStreamError(
								replayUnavailable ? "replay_unavailable" : "rejected",
								replayUnavailable
									? "Managed lifecycle replay is unavailable."
									: "Managed lifecycle replay subscription was rejected.",
							);
							if (replayUnavailable) {
								try {
									handlers.onReplayUnavailable?.(error);
								} catch {
									// Replay observers cannot affect terminal stream cleanup.
								}
							}
							fail(error);
							return;
						}
						let accepted: HubChatLifecycleReady;
						try {
							accepted = parseHubChatLifecycleReady(status.lifecycleReady);
						} catch {
							fail(
								new HubChatLifecycleStreamError(
									"malformed_ready",
									"Managed lifecycle ready acknowledgement failed v1 validation.",
								),
							);
							return;
						}
						if (
							accepted.afterSequence !== expectedReadyAfterSequence ||
							accepted.afterSequence > checkpoint ||
							accepted.throughSequence < checkpoint
						) {
							fail(
								new HubChatLifecycleStreamError(
									"invalid_chain",
									"Managed lifecycle ready acknowledgement mismatched replay state.",
								),
							);
							return;
						}
						checkpoint = accepted.throughSequence;
						clearTimeout(readinessTimer);
						if (!readySettled) {
							readySettled = true;
							resolveReady(accepted);
						}
						try {
							handlers.onCheckpoint?.(checkpoint);
						} catch {
							// Consumer checkpoint observers cannot affect stream health.
						}
						try {
							handlers.onReady?.(accepted);
						} catch {
							// Consumer readiness observers cannot affect stream health.
						}
					},
				},
			);
		} catch {
			fail(
				new HubChatLifecycleStreamError(
					"rejected",
					"Managed lifecycle replay subscription setup failed.",
				),
			);
		}
		if (!active) releaseTransport();
		return Object.freeze({
			ready,
			release,
			getCheckpoint: () => checkpoint,
		});
	}
}
