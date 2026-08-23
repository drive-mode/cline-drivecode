import {
	CHAT_RUNTIME_WIRE_VERSION,
	getHubChatRuntimeSessionSequenceRange,
	type HubChatRuntimeCommandName,
	type HubChatRuntimeCursor,
	type HubEventEnvelope,
	type HubReplyEnvelope,
	parseHubChatRuntimeCursor,
	parseHubChatRuntimeEventSubscription,
	parseHubChatRuntimeWireEvent,
	parseHubChatRuntimeWireReply,
	parseHubChatRuntimeWireRequest,
} from "@cline/shared";
import { readTerminalHubCommandRejectionCode } from "./managed-command-error";

export interface HubChatRuntimeClientTransport {
	command(
		command: HubChatRuntimeCommandName,
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
			runtimeCursor?: () => HubChatRuntimeCursor | undefined;
			onStatus?: (status: {
				status: "ready" | "rejected";
				errorCode?: string;
				runtimeCursor?: HubChatRuntimeCursor;
			}) => void;
		},
	): () => void;
}

export interface HubChatRuntimeInvokeInput {
	readonly command: HubChatRuntimeCommandName;
	readonly payload: Record<string, unknown>;
	readonly timeoutMs?: number | null;
	readonly requiredConnectionGeneration?: number;
}

export interface HubChatRuntimeSubscriptionHandlers {
	readonly onEvent: (event: HubEventEnvelope) => void;
	readonly onCursor?: (cursor: HubChatRuntimeCursor) => void;
	readonly onReady?: (cursor: HubChatRuntimeCursor) => void;
	readonly onReclaimRequired?: (input: {
		readonly sessionId: string;
		readonly cursor: HubChatRuntimeCursor;
	}) => void;
	/** Receives a fixed, pathless error after malformed runtime output. */
	readonly onError?: (error: Error) => void;
}

export class HubChatRuntimeCommandError extends Error {
	constructor(
		readonly command: HubChatRuntimeCommandName,
		readonly code: string,
	) {
		super("Managed runtime command was rejected.");
		this.name = "HubChatRuntimeCommandError";
	}
}

const RUNTIME_RECOVERY_ACK_TIMEOUT_MS = 10_000;

/** Strict client adapter for the authenticated managed runtime companion. */
export class HubChatRuntimeClient {
	constructor(private readonly transport: HubChatRuntimeClientTransport) {}

	async invoke<T = unknown>(input: HubChatRuntimeInvokeInput): Promise<T> {
		const request = parseHubChatRuntimeWireRequest({
			version: CHAT_RUNTIME_WIRE_VERSION,
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
			if (code) throw new HubChatRuntimeCommandError(request.command, code);
			throw error;
		}
		let parsed: HubReplyEnvelope;
		try {
			parsed = parseHubChatRuntimeWireReply(request.command, reply);
		} catch {
			throw new Error("Managed runtime output failed v1 validation.");
		}
		if (!parsed.ok) {
			throw new HubChatRuntimeCommandError(
				request.command,
				parsed.error?.code ?? "runtime_rejected",
			);
		}
		return parsed.payload?.result as T;
	}

	subscribe(
		handlers: HubChatRuntimeSubscriptionHandlers,
		options: {
			readonly sessionId: string;
			readonly initialCursor?: HubChatRuntimeCursor;
			readonly readinessTimeoutMs?: number;
			readonly requiredConnectionGeneration?: number;
		},
	): () => void {
		const subscription = parseHubChatRuntimeEventSubscription({
			sessionId: options?.sessionId,
		});
		const sessionId = subscription.sessionId;
		if (!sessionId) {
			throw new Error(
				"Strict managed runtime subscriptions require a session scope.",
			);
		}
		const initialCursor = options?.initialCursor
			? parseHubChatRuntimeCursor(options.initialCursor)
			: undefined;
		const readinessTimeoutMs =
			options?.readinessTimeoutMs ?? RUNTIME_RECOVERY_ACK_TIMEOUT_MS;
		if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs < 1) {
			throw new Error("Managed runtime readiness timeout is invalid.");
		}
		let active = true;
		let transportGeneration = 0;
		let recoveryUsed = false;
		let recovering = false;
		let recoveryRequestedCursor: HubChatRuntimeCursor | undefined;
		let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const cursors = new Map<string, HubChatRuntimeCursor>();
		if (initialCursor) {
			cursors.set(sessionId, { ...initialCursor });
			recovering = true;
			recoveryRequestedCursor = { ...initialCursor };
		}
		let releaseTransport = (): void => {};
		const clearRecoveryTimer = (): void => {
			if (!recoveryTimer) return;
			clearTimeout(recoveryTimer);
			recoveryTimer = undefined;
		};
		const release = (): void => {
			if (!active) return;
			active = false;
			transportGeneration += 1;
			clearRecoveryTimer();
			releaseTransport();
		};
		const failStream = (message: string): void => {
			if (!active) return;
			release();
			try {
				handlers.onError?.(new Error(message));
			} catch {
				// Consumer error handlers cannot reactivate a failed stream.
			}
		};
		const notifyCursor = (cursor: HubChatRuntimeCursor): void => {
			try {
				handlers.onCursor?.({ ...cursor });
			} catch {
				// Consumer cursor observers cannot affect stream health.
			}
		};
		let installTransport: (recovery: boolean) => void;
		const beginRecovery = (): void => {
			if (recoveryUsed || recovering) {
				failStream(
					"Managed runtime event sequence has a repeated or unrecoverable gap.",
				);
				return;
			}
			const requestedCursor = cursors.get(sessionId);
			if (!requestedCursor) {
				failStream("Managed runtime event sequence has no recovery cursor.");
				return;
			}
			recoveryUsed = true;
			recovering = true;
			recoveryRequestedCursor = { ...requestedCursor };
			transportGeneration += 1;
			const releaseFailedTransport = releaseTransport;
			releaseTransport = (): void => {};
			releaseFailedTransport();
			installTransport(true);
		};
		installTransport = (recovery: boolean): void => {
			if (!active) return;
			const generation = ++transportGeneration;
			let installedRelease = (): void => {};
			try {
				installedRelease = this.transport.subscribe(
					(event) => {
						if (
							!active ||
							generation !== transportGeneration ||
							event.event !== "chat.runtime"
						) {
							return;
						}
						let parsed: ReturnType<typeof parseHubChatRuntimeWireEvent>;
						try {
							parsed = parseHubChatRuntimeWireEvent(event);
						} catch {
							failStream("Managed runtime event failed v1 validation.");
							return;
						}
						if (parsed.sessionId !== sessionId || !parsed.sessionId) {
							failStream("Managed runtime event escaped its session scope.");
							return;
						}
						const sequenceRange = getHubChatRuntimeSessionSequenceRange(parsed);
						const previous = cursors.get(parsed.sessionId);
						if (previous && parsed.streamId !== previous.streamId) {
							failStream(
								"Managed runtime event stream epoch changed; bounded recovery is unavailable.",
							);
							return;
						}
						if (previous && sequenceRange.start <= previous.sessionSequence) {
							failStream(
								"Managed runtime event sequence overlaps or regresses; refresh session state.",
							);
							return;
						}
						if (
							previous &&
							sequenceRange.start !== previous.sessionSequence + 1
						) {
							beginRecovery();
							return;
						}
						const nextCursor = {
							streamId: parsed.streamId,
							sessionSequence: sequenceRange.end,
						};
						cursors.set(parsed.sessionId, nextCursor);
						notifyCursor(nextCursor);
						try {
							handlers.onEvent(parsed);
						} catch {
							// Consumer callbacks are isolated from authoritative stream health.
						}
					},
					{
						sessionId,
						fenced: true,
						...(options?.requiredConnectionGeneration === undefined
							? {}
							: {
									requiredConnectionGeneration:
										options.requiredConnectionGeneration,
								}),
						runtimeCursor: () => cursors.get(sessionId),
						onStatus: (status) => {
							if (!active || generation !== transportGeneration) return;
							if (status.status === "rejected") {
								if (
									status.errorCode === "session_reclaim_required" &&
									handlers.onReclaimRequired
								) {
									const cursor = cursors.get(sessionId);
									if (!cursor) {
										failStream(
											"Managed runtime reconnect has no retained cursor.",
										);
										return;
									}
									release();
									try {
										handlers.onReclaimRequired({
											sessionId,
											cursor: { ...cursor },
										});
									} catch {
										try {
											handlers.onError?.(
												new Error("Managed runtime reconnect observer failed."),
											);
										} catch {
											// Error observers remain isolated.
										}
									}
									return;
								}
								failStream("Managed runtime cursor subscription was rejected.");
								return;
							}
							const accepted = status.runtimeCursor;
							if (!accepted) {
								failStream(
									"Managed runtime subscription omitted its accepted cursor.",
								);
								return;
							}
							const delivered = cursors.get(sessionId);
							const requested = recoveryRequestedCursor;
							const mismatched = recovery
								? !requested ||
									!delivered ||
									requested.streamId !== accepted.streamId ||
									delivered.streamId !== accepted.streamId ||
									accepted.sessionSequence < requested.sessionSequence ||
									accepted.sessionSequence > delivered.sessionSequence
								: Boolean(
										delivered &&
											(delivered.streamId !== accepted.streamId ||
												accepted.sessionSequence > delivered.sessionSequence),
									);
							if (mismatched) {
								failStream(
									"Managed runtime subscription acknowledged a mismatched cursor.",
								);
								return;
							}
							if (!delivered) {
								cursors.set(sessionId, accepted);
								notifyCursor(accepted);
							}
							if (recovery) {
								recovering = false;
								recoveryRequestedCursor = undefined;
								clearRecoveryTimer();
							}
							const readyCursor = cursors.get(sessionId);
							if (!readyCursor) {
								failStream(
									"Managed runtime subscription omitted its ready cursor.",
								);
								return;
							}
							try {
								handlers.onReady?.({ ...readyCursor });
							} catch {
								// Consumer readiness observers cannot affect stream health.
							}
						},
					},
				);
			} catch {
				failStream("Managed runtime subscription setup failed.");
				return;
			}
			if (!active || generation !== transportGeneration) {
				installedRelease();
				return;
			}
			releaseTransport = installedRelease;
			if (recovery && recovering) {
				clearRecoveryTimer();
				recoveryTimer = setTimeout(() => {
					if (!active || generation !== transportGeneration || !recovering) {
						return;
					}
					failStream(
						"Managed runtime cursor subscription acknowledgement timed out.",
					);
				}, readinessTimeoutMs);
			}
		};
		installTransport(Boolean(initialCursor));
		return release;
	}
}
