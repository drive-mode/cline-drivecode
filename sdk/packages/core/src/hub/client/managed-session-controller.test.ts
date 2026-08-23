import type {
	HubChatRuntimeCommandName,
	HubChatRuntimeCursor,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	ManagedSessionController,
	type ManagedSessionControllerTransport,
} from "./managed-session-controller";

type SubscriptionOptions = NonNullable<
	Parameters<ManagedSessionControllerTransport["subscribe"]>[1]
>;
type CommandOptions = NonNullable<
	Parameters<ManagedSessionControllerTransport["command"]>[3]
>;

interface FakeSubscription {
	readonly listener: (event: HubEventEnvelope) => void;
	readonly options: SubscriptionOptions;
	active: boolean;
}

type CommandBehavior = (input: {
	readonly call: number;
	readonly command: HubChatRuntimeCommandName;
	readonly payload: Record<string, unknown> | undefined;
	readonly connectionGeneration: number;
	readonly options: CommandOptions | undefined;
}) => Promise<HubReplyEnvelope>;

class FakeManagedTransport implements ManagedSessionControllerTransport {
	readonly order: string[] = [];
	readonly subscriptions: FakeSubscription[] = [];
	readonly commandInputs: Array<Record<string, unknown> | undefined> = [];
	readonly commandOptions: Array<CommandOptions | undefined> = [];
	connected = false;
	connectionGeneration = 0;
	changeConnectionBeforeNextCommand = false;
	cancelGate: Promise<void> | undefined;
	commandBehavior: CommandBehavior = async ({ payload }) =>
		this.reclaimReply(payload, true);

	async connect(): Promise<void> {
		if (this.connected) return;
		this.connected = true;
		this.connectionGeneration += 1;
		this.order.push(`register:${this.connectionGeneration}`);
	}

	isConnected(): boolean {
		return this.connected;
	}

	getRegisteredConnectionGeneration(): number | undefined {
		return this.connected ? this.connectionGeneration : undefined;
	}

	async command(
		command: HubChatRuntimeCommandName,
		payload?: Record<string, unknown>,
		_sessionId?: string,
		options?: CommandOptions,
	): Promise<HubReplyEnvelope> {
		if (this.changeConnectionBeforeNextCommand) {
			this.changeConnectionBeforeNextCommand = false;
			this.connected = true;
			this.connectionGeneration += 1;
			this.order.push(`replace-before-command:${this.connectionGeneration}`);
		}
		if (
			options?.requiredConnectionGeneration !== undefined &&
			options.requiredConnectionGeneration !== this.connectionGeneration
		) {
			throw Object.assign(new Error("connection changed"), {
				code: "hub_connection_changed",
			});
		}
		const call = this.commandInputs.length;
		this.commandInputs.push(payload);
		this.commandOptions.push(options);
		this.order.push(
			`${command === "chat_runtime.session.reclaim.cancel" ? "cancel" : "reclaim"}:${this.connectionGeneration}:${String(payload?.operationId)}:${String(payload?.expectedWriterGeneration)}`,
		);
		if (command === "chat_runtime.session.reclaim.cancel") {
			await this.cancelGate;
			return {
				version: "v1",
				ok: true,
				payload: {
					result: {
						operationId: String(payload?.operationId),
						sessionId: String(payload?.sessionId),
						writerGeneration: Number(payload?.expectedWriterGeneration),
						cancellationAccepted: true,
					},
				},
			};
		}
		return await this.commandBehavior({
			call,
			command,
			payload,
			connectionGeneration: this.connectionGeneration,
			options,
		});
	}

	subscribe(
		listener: (event: HubEventEnvelope) => void,
		options: SubscriptionOptions = {},
	): () => void {
		if (
			options.requiredConnectionGeneration !== undefined &&
			options.requiredConnectionGeneration !== this.connectionGeneration
		) {
			throw Object.assign(new Error("connection changed"), {
				code: "hub_connection_changed",
			});
		}
		const cursor = options.runtimeCursor?.();
		this.order.push(
			`subscribe:${this.connectionGeneration}:${cursor?.sessionSequence ?? "none"}`,
		);
		const subscription = { listener, options, active: true };
		this.subscriptions.push(subscription);
		return () => {
			if (!subscription.active) return;
			subscription.active = false;
			this.order.push(`release:${this.connectionGeneration}`);
		};
	}

	registeredReplacement(): void {
		this.connected = true;
		this.connectionGeneration += 1;
		this.order.push(`register:${this.connectionGeneration}`);
		this.status({
			status: "rejected",
			errorCode: "session_reclaim_required",
		});
	}

	disconnect(): void {
		this.order.push(`disconnect:${this.connectionGeneration}`);
		this.connected = false;
	}

	emit(sequence: number): void {
		this.order.push(`event:${sequence}`);
		this.latest()?.listener(runtimeEvent(sequence));
	}

	status(status: {
		status: "ready" | "rejected";
		errorCode?: string;
		runtimeCursor?: HubChatRuntimeCursor;
	}): void {
		this.order.push(
			status.status === "ready"
				? `ready:${status.runtimeCursor?.sessionSequence ?? "none"}`
				: `status:${status.errorCode ?? "rejected"}`,
		);
		this.latest()?.options.onStatus?.(status);
	}

	reclaimReply(
		payload: Record<string, unknown> | undefined,
		ownerTransferred: boolean,
		generationDelta = 1,
	): HubReplyEnvelope {
		const expected = Number(payload?.expectedWriterGeneration);
		const writerGeneration = expected + generationDelta;
		return {
			version: "v1",
			ok: true,
			payload: {
				result: {
					sessionId: String(payload?.sessionId),
					leaseRevision: writerGeneration,
					writerGeneration,
					leaseExpiresAt: "2026-08-17T12:05:00.000Z",
					ownerTransferred,
				},
			},
		};
	}

	latest(): FakeSubscription | undefined {
		return [...this.subscriptions].reverse().find((entry) => entry.active);
	}
}

function runtimeEvent(sequence: number): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.runtime",
		eventId: `event-${sequence}`,
		streamId: "runtime-stream-1",
		sessionId: "session-1",
		timestamp: sequence,
		processSequence: sequence,
		sessionSequence: sequence,
		payload: {
			kind: "assistant.delta",
			runId: "run-1",
			text: `text-${sequence}`,
		},
	} as HubEventEnvelope;
}

async function startReady(
	transport: FakeManagedTransport,
	controller: ManagedSessionController,
): Promise<void> {
	const started = controller.start();
	await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(1));
	transport.status({
		status: "ready",
		runtimeCursor: {
			streamId: "runtime-stream-1",
			sessionSequence: 0,
		},
	});
	await started;
}

describe("ManagedSessionController", () => {
	it("reconciles an unknown initial reclaim outcome, prepares, then subscribes", async () => {
		const transport = new FakeManagedTransport();
		transport.commandBehavior = async ({ call, payload }) => {
			if (call === 0) {
				throw Object.assign(new Error("reply outcome unknown"), {
					code: "hub_command_timeout",
				});
			}
			return transport.reclaimReply(payload, true);
		};
		const prepareInitialReclaim = vi.fn((input) => {
			transport.order.push(
				`prepare:${input.connectionGeneration}:${input.writerGeneration}:${input.baseline.sessionSequence}`,
			);
		});
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 2,
			initialCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 7,
			},
			initialReclaim: true,
			prepareInitialReclaim,
			onEvent: vi.fn(),
			operationIdFactory: () => "reclaim-fresh-process",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
		});

		const started = controller.start();
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(2));
		await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(1));

		expect(transport.commandInputs).toEqual([
			{
				operationId: "reclaim-fresh-process",
				sessionId: "session-1",
				expectedWriterGeneration: 2,
			},
			{
				operationId: "reclaim-fresh-process",
				sessionId: "session-1",
				expectedWriterGeneration: 2,
			},
		]);
		expect(prepareInitialReclaim).toHaveBeenCalledWith({
			sessionId: "session-1",
			writerGeneration: 3,
			leaseRevision: 3,
			leaseExpiresAt: "2026-08-17T12:05:00.000Z",
			connectionGeneration: 1,
			baseline: {
				streamId: "runtime-stream-1",
				sessionSequence: 7,
			},
		});
		expect(transport.order).toEqual([
			"register:1",
			"reclaim:1:reclaim-fresh-process:2",
			"reclaim:1:reclaim-fresh-process:2",
			"prepare:1:3:7",
			"subscribe:1:7",
		]);

		transport.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 7,
			},
		});
		await started;
		expect(controller.getSnapshot()).toMatchObject({
			state: "ready",
			writerGeneration: 3,
			leaseRevision: 3,
			connectionGeneration: 1,
		});
		controller.dispose();
	});

	it("starts from an authoritative fresh-process baseline and reclaims if that first socket changes", async () => {
		const transport = new FakeManagedTransport();
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 2,
			leaseRevision: 2,
			leaseExpiresAt: "2026-08-17T12:05:00.000Z",
			initialCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 7,
			},
			onEvent: vi.fn(),
			operationIdFactory: () => "reclaim-initial-baseline",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
		});
		const started = controller.start();
		await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(1));
		expect(transport.subscriptions[0]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 7,
		});

		transport.registeredReplacement();
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(1));
		await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(2));
		expect(transport.commandInputs[0]).toMatchObject({
			operationId: "reclaim-initial-baseline",
			expectedWriterGeneration: 2,
		});
		expect(transport.subscriptions[1]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 7,
		});
		transport.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 7,
			},
		});
		await started;
		expect(controller.getSnapshot()).toMatchObject({
			state: "ready",
			writerGeneration: 3,
			leaseRevision: 3,
			connectionGeneration: 2,
			cursor: { streamId: "runtime-stream-1", sessionSequence: 7 },
		});
		controller.dispose();
	});

	it("registers, reconciles a lost reply, durably rekeys the replacement, then replays from its cursor", async () => {
		const transport = new FakeManagedTransport();
		const delivered: number[] = [];
		const operationIds = ["reclaim-a", "reclaim-b", "reclaim-c"];
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 1,
			onEvent: (event) =>
				delivered.push(
					(event as HubEventEnvelope & { sessionSequence?: number })
						.sessionSequence ?? -1,
				),
			operationIdFactory: () => operationIds.shift() ?? "reclaim-extra",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
			recoveryTimeoutMs: 5_000,
		});
		await startReady(transport, controller);
		transport.emit(1);
		transport.commandBehavior = async ({ call, payload }) => {
			if (call === 0) {
				transport.disconnect();
				throw Object.assign(new Error("reply lost"), {
					code: "hub_connection_closed",
				});
			}
			return transport.reclaimReply(payload, call !== 1);
		};

		transport.registeredReplacement();
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(3));
		await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(2));
		expect(transport.subscriptions[1]?.options.runtimeCursor?.()).toEqual({
			streamId: "runtime-stream-1",
			sessionSequence: 1,
		});
		transport.emit(2);
		transport.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 2,
			},
		});
		await vi.waitFor(() =>
			expect(controller.getSnapshot()).toMatchObject({
				state: "ready",
				writerGeneration: 3,
				connectionGeneration: 3,
			}),
		);

		expect(
			transport.commandInputs.map((payload) => ({
				operationId: payload?.operationId,
				expectedWriterGeneration: payload?.expectedWriterGeneration,
			})),
		).toEqual([
			{ operationId: "reclaim-a", expectedWriterGeneration: 1 },
			{ operationId: "reclaim-a", expectedWriterGeneration: 1 },
			{ operationId: "reclaim-b", expectedWriterGeneration: 2 },
		]);
		expect(
			transport.commandOptions.map(
				(options) => options?.requiredConnectionGeneration,
			),
		).toEqual([2, 3, 3]);
		expect(delivered).toEqual([1, 2]);
		expect(
			transport.order.filter((entry) => !entry.startsWith("release:")),
		).toEqual([
			"register:1",
			"subscribe:1:none",
			"ready:0",
			"event:1",
			"register:2",
			"status:session_reclaim_required",
			"reclaim:2:reclaim-a:1",
			"disconnect:2",
			"register:3",
			"reclaim:3:reclaim-a:1",
			"reclaim:3:reclaim-b:2",
			"subscribe:3:1",
			"event:2",
			"ready:2",
		]);
		controller.dispose();
	});

	it("cancels an in-flight reclaim and ignores its late committed reply", async () => {
		const transport = new FakeManagedTransport();
		const onError = vi.fn();
		let finishReclaim: ((reply: HubReplyEnvelope) => void) | undefined;
		transport.commandBehavior = ({ payload }) =>
			new Promise<HubReplyEnvelope>((resolve) => {
				finishReclaim = () => resolve(transport.reclaimReply(payload, true));
			});
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 1,
			onEvent: vi.fn(),
			onError,
			operationIdFactory: () => "reclaim-cancelled",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
		});
		await startReady(transport, controller);
		transport.registeredReplacement();
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(1));

		controller.dispose();
		expect(controller.getSnapshot().state).toBe("disposed");
		expect(transport.subscriptions[0]?.active).toBe(false);
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(2));
		expect(transport.commandInputs[1]).toMatchObject({
			operationId: "reclaim-cancelled",
			sessionId: "session-1",
			expectedWriterGeneration: 1,
		});
		expect(transport.commandOptions[1]).toMatchObject({
			requiredConnectionGeneration: 2,
		});
		finishReclaim?.(transport.reclaimReply(transport.commandInputs[0], true));
		await Promise.resolve();
		await Promise.resolve();

		expect(transport.subscriptions).toHaveLength(1);
		expect(controller.getSnapshot()).toMatchObject({
			state: "disposed",
			writerGeneration: 1,
		});
		expect(onError).not.toHaveBeenCalled();
	});

	it("cancels the exact committed reclaim when replacement readiness times out", async () => {
		const transport = new FakeManagedTransport();
		const onError = vi.fn();
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 1,
			onEvent: vi.fn(),
			onError,
			operationIdFactory: () => "reclaim-readiness-timeout",
			retryDelayMs: 0,
			readinessTimeoutMs: 100,
			recoveryTimeoutMs: 1_000,
		});
		await startReady(transport, controller);

		transport.registeredReplacement();
		await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(2));
		await vi.waitFor(() =>
			expect(controller.getSnapshot().state).toBe("failed"),
		);
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(2));

		expect(transport.commandInputs).toEqual([
			{
				operationId: "reclaim-readiness-timeout",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
			},
			{
				operationId: "reclaim-readiness-timeout",
				sessionId: "session-1",
				expectedWriterGeneration: 1,
			},
		]);
		expect(
			transport.commandOptions.map(
				(options) => options?.requiredConnectionGeneration,
			),
		).toEqual([2, 2]);
		expect(transport.order).toContain("cancel:2:reclaim-readiness-timeout:1");
		expect(transport.subscriptions[1]?.active).toBe(false);
		expect(controller.getSnapshot()).toMatchObject({
			state: "failed",
			writerGeneration: 2,
		});
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "stream_failed" }),
		);
	});

	it("never sends reclaim on a physical generation newer than the captured registration", async () => {
		const transport = new FakeManagedTransport();
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 1,
			onEvent: vi.fn(),
			operationIdFactory: () => "reclaim-generation-fenced",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
		});
		await startReady(transport, controller);
		transport.changeConnectionBeforeNextCommand = true;
		transport.registeredReplacement();

		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(1));
		await vi.waitFor(() => expect(transport.subscriptions).toHaveLength(2));
		expect(transport.commandInputs[0]).toMatchObject({
			operationId: "reclaim-generation-fenced",
			expectedWriterGeneration: 1,
		});
		expect(transport.commandOptions[0]).toMatchObject({
			requiredConnectionGeneration: 3,
		});
		expect(transport.order).not.toContain(
			"reclaim:2:reclaim-generation-fenced:1",
		);
		transport.status({
			status: "ready",
			runtimeCursor: {
				streamId: "runtime-stream-1",
				sessionSequence: 0,
			},
		});
		await vi.waitFor(() =>
			expect(controller.getSnapshot()).toMatchObject({
				state: "ready",
				writerGeneration: 2,
				connectionGeneration: 3,
			}),
		);
		controller.dispose();
	});

	it("fails closed when reclaim does not advance exactly one writer generation", async () => {
		const transport = new FakeManagedTransport();
		const onError = vi.fn();
		transport.commandBehavior = async ({ payload }) =>
			transport.reclaimReply(payload, true, 2);
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 1,
			onEvent: vi.fn(),
			onError,
			operationIdFactory: () => "reclaim-invalid",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
		});
		await startReady(transport, controller);
		transport.registeredReplacement();

		await vi.waitFor(() =>
			expect(controller.getSnapshot().state).toBe("failed"),
		);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "invalid_reclaim_receipt" }),
		);
		expect(transport.subscriptions).toHaveLength(1);
	});

	it("keeps failed-reclaim cancellation in the disposal completion barrier", async () => {
		const transport = new FakeManagedTransport();
		let releaseCancel = (): void => {};
		transport.cancelGate = new Promise<void>((resolve) => {
			releaseCancel = resolve;
		});
		transport.commandBehavior = async ({ payload }) =>
			transport.reclaimReply(payload, true, 2);
		const controller = new ManagedSessionController({
			transport,
			sessionId: "session-1",
			writerGeneration: 1,
			onEvent: vi.fn(),
			operationIdFactory: () => "reclaim-failed-barrier",
			retryDelayMs: 0,
			readinessTimeoutMs: 1_000,
		});
		await startReady(transport, controller);
		transport.registeredReplacement();
		await vi.waitFor(() =>
			expect(controller.getSnapshot().state).toBe("failed"),
		);
		await vi.waitFor(() => expect(transport.commandInputs).toHaveLength(2));

		let disposeSettled = false;
		const disposing = controller.disposeAndWait().then(() => {
			disposeSettled = true;
		});
		await Promise.resolve();
		expect(disposeSettled).toBe(false);

		releaseCancel();
		await disposing;
		expect(controller.getSnapshot().state).toBe("disposed");
		expect(transport.order).toContain("cancel:2:reclaim-failed-barrier:1");
	});
});
