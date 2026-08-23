import type {
	HubChatLifecycleTransportCursor,
	HubChatLifecycleTransportReady,
	HubChatRuntimeCursor,
	HubChatRuntimeWireEvent,
	HubClientRegistration,
	HubEventEnvelope,
	HubReplyEnvelope,
	HubTransportFrame,
	ITelemetryService,
} from "@cline/shared";
import {
	captureSdkError,
	getHubChatRuntimeSessionSequenceRange,
	HUB_COMMAND_SLOW_LOG_MS,
	parseHubChatLifecycleReconciliationSubscription,
	parseHubChatRuntimeCursor,
	parseHubChatRuntimeWireEvent,
	resolveHubCommandTimeoutMs,
	safeJsonParse,
} from "@cline/shared";
import {
	BoundedOutboundChannel,
	type BoundedOutboundChannelOptions,
	type OutboundMessageOptions,
} from "./bounded-outbound-channel";
import type { HubSocketCommandTransport } from "./command-transport";
import { logHubMessage } from "./hub-server-logging";

type HubCommandFrame = HubTransportFrame & { kind: "command" };
type HubRuntimeEventFrame = {
	kind: "event";
	envelope: HubChatRuntimeWireEvent;
	subscriptionId?: string;
};

export const DEFAULT_HUB_MAX_ACTIVE_SUBSCRIPTIONS = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSubscriptionId(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		value.length > 512 ||
		value.trim() !== value ||
		!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
	) {
		throw new Error("Malformed Hub subscription ID.");
	}
	return value;
}

function readRuntimeCursor(value: unknown): HubChatRuntimeCursor | undefined {
	if (value === undefined) return undefined;
	try {
		return parseHubChatRuntimeCursor(value);
	} catch {
		throw new Error("Malformed Hub runtime cursor.");
	}
}

function readLifecycleCursor(
	value: unknown,
): HubChatLifecycleTransportCursor | undefined {
	if (value === undefined) return undefined;
	try {
		return parseHubChatLifecycleReconciliationSubscription(value);
	} catch {
		throw new Error("Malformed Hub lifecycle cursor.");
	}
}

function subscriptionKey(input: {
	clientId: string;
	sessionId?: string;
	subscriptionId?: string;
}): string {
	return JSON.stringify([
		input.clientId,
		input.sessionId ?? null,
		input.subscriptionId ?? null,
	]);
}

function parseRuntimeEventFrame(
	data: string,
): HubRuntimeEventFrame | undefined {
	const frame = safeJsonParse<unknown>(data);
	if (!isRecord(frame) || frame.kind !== "event" || !("envelope" in frame)) {
		return undefined;
	}
	try {
		return {
			kind: "event",
			envelope: parseHubChatRuntimeWireEvent(frame.envelope),
			...(readSubscriptionId(frame.subscriptionId)
				? { subscriptionId: frame.subscriptionId as string }
				: {}),
		};
	} catch {
		return undefined;
	}
}

function mergeAssistantDeltaFrames(
	previousData: string,
	incomingData: string,
): string | undefined {
	const previous = parseRuntimeEventFrame(previousData);
	const incoming = parseRuntimeEventFrame(incomingData);
	if (
		!previous ||
		!incoming ||
		previous.envelope.payload.kind !== "assistant.delta" ||
		incoming.envelope.payload.kind !== "assistant.delta" ||
		previous.subscriptionId !== incoming.subscriptionId ||
		previous.envelope.streamId !== incoming.envelope.streamId ||
		previous.envelope.sessionId !== incoming.envelope.sessionId ||
		previous.envelope.payload.runId !== incoming.envelope.payload.runId ||
		incoming.envelope.processSequence <= previous.envelope.processSequence
	) {
		return undefined;
	}
	const previousRange = getHubChatRuntimeSessionSequenceRange(
		previous.envelope,
	);
	const incomingRange = getHubChatRuntimeSessionSequenceRange(
		incoming.envelope,
	);
	if (incomingRange.start !== previousRange.end + 1) return undefined;

	try {
		const merged = parseHubChatRuntimeWireEvent({
			...incoming.envelope,
			sessionSequenceStart: previousRange.start,
			payload: {
				...incoming.envelope.payload,
				text: previous.envelope.payload.text + incoming.envelope.payload.text,
			},
		});
		return JSON.stringify({
			kind: "event",
			envelope: merged,
			...(incoming.subscriptionId
				? { subscriptionId: incoming.subscriptionId }
				: {}),
		});
	} catch {
		return undefined;
	}
}

function eventDeliveryOptions(
	envelope: HubEventEnvelope,
	subscriptionEpoch: number,
): OutboundMessageOptions {
	if (envelope.event === "chat.runtime") {
		const required = { priority: "high", closeOnDrop: true } as const;
		let parsed: HubChatRuntimeWireEvent;
		try {
			parsed = parseHubChatRuntimeWireEvent(envelope);
		} catch {
			return required;
		}
		if (parsed.payload.kind !== "assistant.delta") return required;
		return {
			...required,
			additiveMerge: {
				key: JSON.stringify([
					"chat.runtime",
					subscriptionEpoch,
					parsed.sessionId,
					parsed.payload.runId,
					parsed.payload.kind,
				]),
				merge: mergeAssistantDeltaFrames,
			},
		};
	}
	if (envelope.event === "chat.changed") {
		return { priority: "high", closeOnDrop: true };
	}
	const replaceableEvents = new Set([
		"hub.status.updated",
		"session.updated",
		"drive.room.changed",
		"drive.spotlight.changed",
		"room.snapshot",
	]);
	return replaceableEvents.has(envelope.event)
		? {
				priority: "low",
				replaceableKey: `${envelope.event}:${envelope.sessionId ?? "*"}`,
			}
		: { priority: "normal" };
}

function isHubCommandFrame(value: unknown): value is HubCommandFrame {
	if (
		!isRecord(value) ||
		value.kind !== "command" ||
		!isRecord(value.envelope)
	) {
		return false;
	}
	return (
		typeof value.envelope.version === "string" &&
		typeof value.envelope.command === "string"
	);
}

export interface BrowserHubSocketLike {
	send(data: string, callback?: (error?: unknown) => void): void;
	close?(code?: number, reason?: string): void;
	terminate?(): void;
	addEventListener(
		type: "message",
		listener: (event: { data: string }) => void,
	): void;
	addEventListener(type: "close", listener: () => void): void;
	removeEventListener(
		type: "message",
		listener: (event: { data: string }) => void,
	): void;
	removeEventListener(type: "close", listener: () => void): void;
}

function commandLogContext(frame: HubCommandFrame) {
	return {
		command: frame.envelope.command,
		requestId: frame.envelope.requestId,
		clientId: frame.envelope.clientId,
		sessionId: frame.envelope.sessionId,
	};
}

function commandErrorReply(
	frame: HubCommandFrame,
	code: string,
	message: string,
): HubReplyEnvelope {
	return {
		version: frame.envelope.version,
		requestId: frame.envelope.requestId,
		ok: false,
		error: { code, message },
	};
}

function isWorkspaceAuthorityCommand(command: string): boolean {
	return (
		command.startsWith("chat_catalog.") ||
		command.startsWith("chat_lifecycle.") ||
		command.startsWith("chat_projection.") ||
		command.startsWith("chat_runtime.")
	);
}

export class BrowserWebSocketHubAdapter {
	private readonly clientOwners = new Map<string, object>();

	constructor(
		private readonly telemetry?: ITelemetryService,
		private readonly deliveryOptions: BoundedOutboundChannelOptions = {},
		private readonly maxActiveSubscriptions = DEFAULT_HUB_MAX_ACTIVE_SUBSCRIPTIONS,
	) {
		if (
			!Number.isSafeInteger(this.maxActiveSubscriptions) ||
			this.maxActiveSubscriptions < 1
		) {
			throw new Error(
				"Hub active subscription bound must be a positive safe integer.",
			);
		}
	}

	attach(
		socket: BrowserHubSocketLike,
		transport: HubSocketCommandTransport,
	): () => void {
		const connectionOwner = {};
		type DesiredSubscription = {
			readonly intent: string;
			readonly clientId: string;
			readonly sessionId?: string;
			readonly subscriptionId?: string;
			readonly requestedRuntimeCursor?: HubChatRuntimeCursor;
			readonly requestedLifecycleCursor?: HubChatLifecycleTransportCursor;
			readonly completion: Promise<void>;
			readonly settle: () => void;
			state: "pending" | "active";
			runtimeCursor?: HubChatRuntimeCursor;
			lifecycleReady?: HubChatLifecycleTransportReady;
		};
		const subscriptions = new Map<
			string,
			{
				release: () => void;
				admission: DesiredSubscription;
				runtimeCursor?: HubChatRuntimeCursor;
				lifecycleReady?: HubChatLifecycleTransportReady;
			}
		>();
		const desiredSubscriptions = new Map<string, DesiredSubscription>();
		const registeredClientIds = new Set<string>();
		let subscriptionBarrier = Promise.resolve();
		let subscriptionReconciliationRequested = false;
		let subscriptionReconciliationRunning = false;
		let subscriptionEpoch = 0;
		let closed = false;
		const outbound = new BoundedOutboundChannel(
			{
				write(data, complete) {
					socket.send(data, complete);
				},
				close(code, reason) {
					socket.close?.(code, reason);
				},
				terminate() {
					socket.terminate?.();
				},
			},
			this.deliveryOptions,
		);

		const sendFrame = (
			frame: HubTransportFrame,
			options: OutboundMessageOptions = { priority: "high" },
		): boolean => {
			return outbound.send(JSON.stringify(frame), options);
		};
		const sendReply = (
			commandFrame: HubCommandFrame,
			envelope: HubReplyEnvelope,
		): void => {
			sendFrame(
				{ kind: "reply", envelope },
				commandFrame.envelope.command.startsWith("chat_runtime.")
					? { priority: "high", closeOnDrop: true }
					: { priority: "high" },
			);
		};
		const sendSubscriptionStatus = (input: {
			clientId: string;
			sessionId?: string;
			subscriptionId: string;
			status: "ready" | "rejected";
			runtimeCursor?: HubChatRuntimeCursor;
			lifecycleReady?: HubChatLifecycleTransportReady;
		}): void => {
			sendFrame(
				{
					kind: "stream.status",
					clientId: input.clientId,
					...(input.sessionId ? { sessionId: input.sessionId } : {}),
					subscriptionId: input.subscriptionId,
					status: input.status,
					...(input.status === "rejected"
						? { errorCode: "subscription_rejected" }
						: {}),
					...(input.runtimeCursor
						? { runtimeCursor: input.runtimeCursor }
						: {}),
					...(input.lifecycleReady
						? { lifecycleReady: input.lifecycleReady }
						: {}),
				},
				{ priority: "high", closeOnDrop: true },
			);
		};

		const sendSubscriptionEvent = (
			envelope: HubEventEnvelope,
			epoch: number,
			subscriptionId?: string,
		): void => {
			const accepted = sendFrame(
				{
					kind: "event",
					envelope,
					...(subscriptionId ? { subscriptionId } : {}),
				},
				eventDeliveryOptions(envelope, epoch),
			);
			if (!accepted) {
				throw new Error("Runtime subscription output was not admitted.");
			}
		};
		const scheduleSubscriptionReconciliation = (): void => {
			subscriptionReconciliationRequested = true;
			if (subscriptionReconciliationRunning) return;

			subscriptionReconciliationRunning = true;
			const operation = (async () => {
				try {
					reconcile: do {
						subscriptionReconciliationRequested = false;

						for (const [key, subscription] of subscriptions) {
							const desired = desiredSubscriptions.get(key);
							if (desired !== subscription.admission) {
								subscription.release();
								subscriptions.delete(key);
							}
						}

						for (const [key, admission] of desiredSubscriptions) {
							if (closed) return;
							const existing = subscriptions.get(key);
							if (existing?.admission === admission) {
								admission.state = "active";
								admission.runtimeCursor = existing.runtimeCursor;
								admission.lifecycleReady = existing.lifecycleReady;
								admission.settle();
								continue;
							}
							if (subscriptions.size >= this.maxActiveSubscriptions) {
								if (desiredSubscriptions.get(key) === admission) {
									desiredSubscriptions.delete(key);
									if (admission.subscriptionId && !closed) {
										sendSubscriptionStatus({
											clientId: admission.clientId,
											...(admission.sessionId
												? { sessionId: admission.sessionId }
												: {}),
											subscriptionId: admission.subscriptionId,
											status: "rejected",
										});
									}
								}
								admission.settle();
								continue;
							}

							subscriptionEpoch += 1;
							const epoch = subscriptionEpoch;
							let acceptedCursor: HubChatRuntimeCursor | undefined;
							let acceptedLifecycleReady:
								| HubChatLifecycleTransportReady
								| undefined;
							try {
								const unsubscribe = await transport.subscribe(
									admission.clientId,
									(envelope) => {
										if (closed || desiredSubscriptions.get(key) !== admission) {
											return;
										}
										sendSubscriptionEvent(
											envelope,
											epoch,
											admission.subscriptionId,
										);
									},
									{
										...(admission.sessionId
											? { sessionId: admission.sessionId }
											: {}),
										...(admission.requestedRuntimeCursor
											? {
													runtimeCursor: admission.requestedRuntimeCursor,
												}
											: {}),
										...(admission.requestedLifecycleCursor
											? {
													lifecycleCursor: admission.requestedLifecycleCursor,
												}
											: {}),
										onRuntimeReady: (cursor) => {
											if (
												acceptedCursor &&
												JSON.stringify(acceptedCursor) !==
													JSON.stringify(cursor)
											) {
												throw new Error(
													"Runtime source changed its accepted cursor.",
												);
											}
											acceptedCursor = cursor;
										},
										onLifecycleReady: (ready) => {
											if (
												acceptedLifecycleReady &&
												JSON.stringify(acceptedLifecycleReady) !==
													JSON.stringify(ready)
											) {
												throw new Error(
													"Lifecycle source changed its accepted replay cut.",
												);
											}
											acceptedLifecycleReady = ready;
										},
									},
								);
								if (closed || desiredSubscriptions.get(key) !== admission) {
									unsubscribe();
									admission.settle();
									if (subscriptionReconciliationRequested) continue reconcile;
									continue;
								}
								if (
									admission.requestedLifecycleCursor &&
									!acceptedLifecycleReady
								) {
									unsubscribe();
									throw new Error(
										"Lifecycle source did not acknowledge its replay cut.",
									);
								}
								subscriptions.set(key, {
									release: unsubscribe,
									admission,
									...(acceptedCursor ? { runtimeCursor: acceptedCursor } : {}),
									...(acceptedLifecycleReady
										? { lifecycleReady: acceptedLifecycleReady }
										: {}),
								});
								admission.state = "active";
								if (acceptedCursor) admission.runtimeCursor = acceptedCursor;
								if (acceptedLifecycleReady)
									admission.lifecycleReady = acceptedLifecycleReady;
								if (admission.subscriptionId && !closed) {
									sendSubscriptionStatus({
										clientId: admission.clientId,
										...(admission.sessionId
											? { sessionId: admission.sessionId }
											: {}),
										subscriptionId: admission.subscriptionId,
										status: "ready",
										...(acceptedCursor
											? { runtimeCursor: acceptedCursor }
											: {}),
										...(acceptedLifecycleReady
											? { lifecycleReady: acceptedLifecycleReady }
											: {}),
									});
								}
								admission.settle();
								if (subscriptionReconciliationRequested) continue reconcile;
							} catch {
								if (desiredSubscriptions.get(key) === admission) {
									desiredSubscriptions.delete(key);
									if (admission.subscriptionId && !closed) {
										sendSubscriptionStatus({
											clientId: admission.clientId,
											...(admission.sessionId
												? { sessionId: admission.sessionId }
												: {}),
											subscriptionId: admission.subscriptionId,
											status: "rejected",
										});
									}
								}
								admission.settle();
								if (subscriptionReconciliationRequested) continue reconcile;
							}
						}
					} while (subscriptionReconciliationRequested);
				} finally {
					subscriptionReconciliationRunning = false;
				}
			})();
			subscriptionBarrier = operation;
		};
		const onMessage = async (event: { data: string }): Promise<void> => {
			try {
				const parsedFrame = JSON.parse(event.data) as unknown;
				if (
					isRecord(parsedFrame) &&
					parsedFrame.kind === "command" &&
					!isHubCommandFrame(parsedFrame)
				) {
					throw new Error("Malformed Hub command frame.");
				}
				const frame = parsedFrame as HubTransportFrame;
				switch (frame.kind) {
					case "command": {
						await subscriptionBarrier;
						if (closed) break;
						const registration = (frame.envelope.payload ??
							{}) as unknown as HubClientRegistration;
						const registrationClientId =
							frame.envelope.command === "client.register"
								? registration.clientId?.trim() ||
									frame.envelope.clientId?.trim()
								: undefined;
						if (registrationClientId) {
							const owner = this.clientOwners.get(registrationClientId);
							if (owner && owner !== connectionOwner) {
								sendReply(
									frame,
									commandErrorReply(
										frame,
										"client_conflict",
										"Client ID is already registered on another connection.",
									),
								);
								break;
							}
							this.clientOwners.set(registrationClientId, connectionOwner);
						}
						if (isWorkspaceAuthorityCommand(frame.envelope.command)) {
							const clientId = frame.envelope.clientId?.trim();
							if (
								!clientId ||
								this.clientOwners.get(clientId) !== connectionOwner ||
								!registeredClientIds.has(clientId)
							) {
								sendReply(
									frame,
									commandErrorReply(
										frame,
										"client_not_registered",
										"Workspace authority commands require this connection's registered client identity.",
									),
								);
								break;
							}
						}
						const startedAt = performance.now();
						let settled = false;
						const context = commandLogContext(frame);
						logHubMessage("info", "command.start", context);
						const slowTimer = setTimeout(() => {
							if (settled) return;
							logHubMessage("warn", "command.slow", {
								...context,
								elapsedMs: Math.round(performance.now() - startedAt),
							});
						}, HUB_COMMAND_SLOW_LOG_MS);
						const commandPromise = transport.command(frame.envelope);
						commandPromise.then(
							(lateReply) => {
								if (!settled) return;
								logHubMessage(
									lateReply.ok ? "warn" : "error",
									"command.late_end",
									{
										...context,
										elapsedMs: Math.round(performance.now() - startedAt),
										ok: lateReply.ok,
										errorCode: lateReply.error?.code,
										errorMessage: lateReply.error?.message,
									},
								);
							},
							(error) => {
								if (!settled) return;
								logHubMessage("error", "command.late_error", {
									...context,
									elapsedMs: Math.round(performance.now() - startedAt),
									error,
								});
							},
						);
						let timedOut = false;
						let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
						let reply: HubReplyEnvelope;
						const timeoutMs = resolveHubCommandTimeoutMs(
							frame.envelope.command,
							frame.envelope.timeoutMs,
						);
						try {
							reply =
								timeoutMs === null
									? await commandPromise
									: await Promise.race([
											commandPromise,
											new Promise<HubReplyEnvelope>((resolve) => {
												timeoutTimer = setTimeout(() => {
													timedOut = true;
													captureSdkError(this.telemetry, {
														component: "core",
														operation: "hub.command_timeout",
														error: new Error(
															`Hub command ${frame.envelope.command} did not complete within ${timeoutMs}ms.`,
														),
														severity: "error",
														handled: true,
														context: {
															...context,
															timeoutMs,
														},
													});
													resolve(
														commandErrorReply(
															frame,
															"hub_command_timeout",
															`Hub command ${frame.envelope.command} did not complete within ${timeoutMs}ms. Check hub-daemon.log for command.start/command.slow logs with requestId ${frame.envelope.requestId}.`,
														),
													);
												}, timeoutMs);
											}),
										]);
						} catch (error) {
							if (
								registrationClientId &&
								this.clientOwners.get(registrationClientId) === connectionOwner
							) {
								this.clientOwners.delete(registrationClientId);
							}
							clearTimeout(slowTimer);
							if (timeoutTimer) clearTimeout(timeoutTimer);
							throw error;
						}
						settled = timedOut;
						clearTimeout(slowTimer);
						if (timeoutTimer) clearTimeout(timeoutTimer);
						const durationMs = Math.round(performance.now() - startedAt);
						if (timedOut) {
							logHubMessage("error", "command.timeout", {
								...context,
								durationMs,
								timeoutMs,
							});
						} else {
							logHubMessage(reply.ok ? "info" : "warn", "command.end", {
								...context,
								durationMs,
								ok: reply.ok,
								errorCode: reply.error?.code,
								errorMessage: reply.error?.message,
							});
						}
						if (frame.envelope.command === "client.register") {
							if (reply.ok && registrationClientId) {
								registeredClientIds.add(registrationClientId);
							} else if (
								registrationClientId &&
								this.clientOwners.get(registrationClientId) === connectionOwner
							) {
								this.clientOwners.delete(registrationClientId);
							}
						} else if (
							frame.envelope.command === "client.unregister" &&
							reply.ok
						) {
							const clientId = frame.envelope.clientId?.trim();
							if (clientId) {
								registeredClientIds.delete(clientId);
								if (this.clientOwners.get(clientId) === connectionOwner) {
									this.clientOwners.delete(clientId);
								}
							}
						}
						sendReply(frame, reply satisfies HubReplyEnvelope);
						break;
					}
					case "stream.subscribe": {
						const subscriptionId = readSubscriptionId(frame.subscriptionId);
						try {
							const runtimeCursor = readRuntimeCursor(frame.runtimeCursor);
							const lifecycleCursor = readLifecycleCursor(
								frame.lifecycleCursor,
							);
							if (runtimeCursor && (!subscriptionId || !frame.sessionId)) {
								throw new Error(
									"Runtime cursor requires a fenced session subscription.",
								);
							}
							if (
								lifecycleCursor &&
								(!subscriptionId || frame.sessionId || runtimeCursor)
							) {
								throw new Error(
									"Lifecycle cursor requires a fenced global subscription.",
								);
							}
							const key = subscriptionKey({
								clientId: frame.clientId,
								sessionId: frame.sessionId,
								subscriptionId,
							});
							const intent = JSON.stringify({
								sessionId: frame.sessionId ?? null,
								runtimeCursor: runtimeCursor ?? null,
								lifecycleCursor: lifecycleCursor ?? null,
							});
							const desired = desiredSubscriptions.get(key);
							if (desired) {
								if (desired.intent !== intent) {
									throw new Error(
										"Subscription token was reused with changed intent.",
									);
								}
								if (desired.state === "active" && subscriptionId && !closed) {
									sendSubscriptionStatus({
										clientId: frame.clientId,
										...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
										subscriptionId,
										status: "ready",
										...(desired.runtimeCursor
											? { runtimeCursor: desired.runtimeCursor }
											: {}),
										...(desired.lifecycleReady
											? { lifecycleReady: desired.lifecycleReady }
											: {}),
									});
								}
								// A pending exact retry is acknowledged by its original admission.
								// Neither active nor pending duplicates append barrier work.
								return;
							}
							if (desiredSubscriptions.size >= this.maxActiveSubscriptions) {
								throw new Error("Hub active subscription bound was reached.");
							}
							let settled = false;
							let resolveCompletion: () => void = () => undefined;
							const completion = new Promise<void>((resolve) => {
								resolveCompletion = resolve;
							});
							const admission: DesiredSubscription = {
								intent,
								clientId: frame.clientId,
								...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
								...(subscriptionId ? { subscriptionId } : {}),
								...(runtimeCursor
									? { requestedRuntimeCursor: runtimeCursor }
									: {}),
								...(lifecycleCursor
									? { requestedLifecycleCursor: lifecycleCursor }
									: {}),
								completion,
								settle: () => {
									if (settled) return;
									settled = true;
									resolveCompletion();
								},
								state: "pending",
							};
							desiredSubscriptions.set(key, admission);
							scheduleSubscriptionReconciliation();
							await admission.completion;
						} catch {
							if (subscriptionId && !closed) {
								sendSubscriptionStatus({
									clientId: frame.clientId,
									...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
									subscriptionId,
									status: "rejected",
								});
							}
						}
						break;
					}
					case "stream.unsubscribe": {
						const subscriptionId = readSubscriptionId(frame.subscriptionId);
						const key = subscriptionKey({
							clientId: frame.clientId,
							sessionId: frame.sessionId,
							subscriptionId,
						});
						// Virtual intent is bounded and authoritative at ingress. Reconciliation
						// coalesces churn while one source setup is unresolved, so an unsubscribe
						// frees capacity without appending an unbounded barrier operation.
						const removed = desiredSubscriptions.get(key);
						if (!removed) return;
						desiredSubscriptions.delete(key);
						removed.settle();
						scheduleSubscriptionReconciliation();
						break;
					}
					case "reply":
					case "event":
					case "stream.status":
						break;
				}
			} catch (error) {
				const parsed =
					typeof event.data === "string"
						? safeJsonParse<unknown>(event.data)
						: undefined;
				if (!isHubCommandFrame(parsed)) {
					logHubMessage("error", "rejected malformed websocket frame", {
						error,
					});
					return;
				}
				logHubMessage("error", "command.error", {
					...commandLogContext(parsed),
					error,
				});
				captureSdkError(this.telemetry, {
					component: "core",
					operation: "hub.websocket_command",
					error,
					severity: "error",
					handled: true,
					context: commandLogContext(parsed),
				});
				sendReply(
					parsed,
					commandErrorReply(
						parsed,
						"command_failed",
						error instanceof Error ? error.message : "Unknown hub error",
					),
				);
			}
		};

		const onClose = (): void => {
			if (closed) {
				return;
			}
			closed = true;
			for (const subscription of subscriptions.values()) {
				subscription.release();
			}
			subscriptions.clear();
			for (const admission of desiredSubscriptions.values()) {
				admission.settle();
			}
			desiredSubscriptions.clear();
			for (const [clientId, owner] of this.clientOwners) {
				if (owner === connectionOwner) this.clientOwners.delete(clientId);
			}
			for (const clientId of registeredClientIds) {
				void transport.command({
					version: "v1",
					command: "client.unregister",
					clientId,
				});
			}
			registeredClientIds.clear();
			transport.closeConnection();
			outbound.dispose();
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
		};

		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);

		return onClose;
	}
}
