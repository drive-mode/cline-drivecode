import type { HubEventEnvelope, HubReplyEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	HubChatLifecycleClient,
	type HubChatLifecycleClientTransport,
	HubChatLifecycleStreamError,
} from "./chat-lifecycle-client";

const START_RESULT = {
	sessionId: "session-1",
	chatId: "chat-1",
	leaseRevision: 0,
	writerGeneration: 1,
	leaseExpiresAt: "2026-08-15T12:01:00.000Z",
	profileAuthority: {
		profileId: "profile-1",
		profileRevision: 1,
		authorityClassId: "cline.chat.authority.interactive-owner.v1",
		policyEpoch: 0,
		allowedModes: ["act", "plan", "yolo"],
	},
} as const;

function transportFixture(reply?: HubReplyEnvelope): {
	transport: HubChatLifecycleClientTransport;
	command: ReturnType<typeof vi.fn>;
	emit: (event: HubEventEnvelope) => void;
	status: (status: {
		status: "ready" | "rejected";
		errorCode?: string;
		lifecycleReady?: unknown;
	}) => void;
	getSubscriptionOptions: () =>
		| NonNullable<Parameters<HubChatLifecycleClientTransport["subscribe"]>[1]>
		| undefined;
	release: ReturnType<typeof vi.fn>;
} {
	let listener: ((event: HubEventEnvelope) => void) | undefined;
	let subscriptionOptions:
		| NonNullable<Parameters<HubChatLifecycleClientTransport["subscribe"]>[1]>
		| undefined;
	const command = vi.fn(
		async () =>
			(reply ?? {
				version: "v1",
				ok: true,
				payload: { result: START_RESULT },
			}) satisfies HubReplyEnvelope,
	);
	const release = vi.fn();
	return {
		transport: {
			command,
			subscribe: (next, options) => {
				listener = next;
				subscriptionOptions = options;
				return release;
			},
		},
		command,
		emit: (event) => listener?.(event),
		status: (status) => subscriptionOptions?.onStatus?.(status),
		getSubscriptionOptions: () => subscriptionOptions,
		release,
	};
}

describe("HubChatLifecycleClient", () => {
	it("validates requests and authoritative results around transport", async () => {
		const fixture = transportFixture();
		const client = new HubChatLifecycleClient(fixture.transport);

		await expect(
			client.invoke({
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-1",
					sessionId: "session-1",
					start: { profileId: "cline-default", mode: "plan" },
				},
			}),
		).resolves.toEqual(START_RESULT);
		expect(fixture.command).toHaveBeenCalledWith(
			"chat_lifecycle.start_root",
			expect.objectContaining({ sessionId: "session-1" }),
			undefined,
			undefined,
		);
	});

	it("rejects malformed input before opening transport", async () => {
		const fixture = transportFixture();
		const client = new HubChatLifecycleClient(fixture.transport);

		await expect(
			client.invoke({
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-1",
					sessionId: "../escape",
					start: { profileId: "cline-default" },
				},
			}),
		).rejects.toThrow();
		expect(fixture.command).not.toHaveBeenCalled();
	});

	it("rejects malformed success results", async () => {
		const fixture = transportFixture({
			version: "v1",
			ok: true,
			payload: { result: { ...START_RESULT, workspaceRoot: "/secret" } },
		});
		const client = new HubChatLifecycleClient(fixture.transport);

		await expect(
			client.invoke({
				command: "chat_lifecycle.start_root",
				payload: {
					operationId: "operation-1",
					sessionId: "session-1",
					start: { profileId: "cline-default" },
				},
			}),
		).rejects.toThrow();
	});

	it("validates events and permanently releases a malformed stream", () => {
		const fixture = transportFixture();
		const client = new HubChatLifecycleClient(fixture.transport);
		const onEvent = vi.fn();
		const onError = vi.fn();
		client.subscribe({ onEvent, onError }, { sessionId: "session-1" });

		fixture.emit({
			version: "v1",
			event: "chat.changed",
			eventId: "event-1",
			sessionId: "session-1",
			timestamp: Date.parse("2026-08-15T12:00:00.000Z"),
			payload: {
				chatId: "chat-1",
				eventType: "chat.renamed",
				aggregateKind: "chat",
				aggregateId: "chat-1",
				previousRevision: 0,
				resultingRevision: 1,
				occurredAt: "2026-08-15T12:00:00.000Z",
				chat: null,
			},
		});
		expect(onEvent).toHaveBeenCalledTimes(1);

		fixture.emit({
			version: "v1",
			event: "chat.changed",
			eventId: "event-malformed",
			timestamp: 0,
			payload: { workspaceRoot: "/secret" },
		} as unknown as HubEventEnvelope);
		expect(fixture.release).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Managed lifecycle event failed v1 validation.",
			}),
		);
	});

	it("isolates consumer callback failures without releasing a valid stream", () => {
		const fixture = transportFixture();
		const client = new HubChatLifecycleClient(fixture.transport);
		const onError = vi.fn();
		client.subscribe({
			onEvent: () => {
				throw new Error("consumer failed");
			},
			onError,
		});

		fixture.emit({
			version: "v1",
			event: "chat.changed",
			eventId: "event-consumer-failure",
			timestamp: Date.parse("2026-08-15T12:00:00.000Z"),
			payload: {
				chatId: "chat-1",
				eventType: "chat.renamed",
				aggregateKind: "chat",
				aggregateId: "chat-1",
				previousRevision: 0,
				resultingRevision: 1,
				occurredAt: "2026-08-15T12:00:00.000Z",
				chat: null,
			},
		});

		expect(fixture.release).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it("fences lifecycle commands to the exact registered connection", async () => {
		const fixture = transportFixture();
		const client = new HubChatLifecycleClient(fixture.transport);
		await client.invoke({
			command: "chat_lifecycle.start_root",
			payload: {
				operationId: "operation-1",
				sessionId: "session-1",
				start: { profileId: "cline-default" },
			},
			requiredConnectionGeneration: 7,
		});
		expect(fixture.command).toHaveBeenCalledWith(
			"chat_lifecycle.start_root",
			expect.objectContaining({ sessionId: "session-1" }),
			undefined,
			{ requiredConnectionGeneration: 7 },
		);
	});

	it("reconciles an exact lifecycle chain before fenced readiness", async () => {
		const fixture = transportFixture();
		const client = new HubChatLifecycleClient(fixture.transport);
		const onEvent = vi.fn();
		const onCheckpoint = vi.fn();
		const onReady = vi.fn();
		const onError = vi.fn();
		const subscription = client.subscribeReconciled(
			{ onEvent, onCheckpoint, onReady, onError },
			{
				afterSequence: 8,
				requiredConnectionGeneration: 3,
				readinessTimeoutMs: 100,
			},
		);
		expect(fixture.getSubscriptionOptions()).toMatchObject({
			fenced: true,
			requiredConnectionGeneration: 3,
		});
		expect(fixture.getSubscriptionOptions()?.lifecycleCursor?.()).toEqual({
			afterSequence: 8,
		});

		fixture.emit(reconciledEvent(12, 8));
		fixture.emit(reconciledEvent(15, 12));
		fixture.status({
			status: "ready",
			lifecycleReady: {
				version: "v1",
				stream: "chat.changed",
				afterSequence: 8,
				throughSequence: 18,
			},
		});

		await expect(subscription.ready).resolves.toMatchObject({
			throughSequence: 18,
		});
		expect(subscription.getCheckpoint()).toBe(18);
		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(onCheckpoint).toHaveBeenNthCalledWith(1, 12);
		expect(onCheckpoint).toHaveBeenNthCalledWith(2, 15);
		expect(onCheckpoint).toHaveBeenNthCalledWith(3, 18);
		expect(onReady).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();

		fixture.emit(reconciledEvent(21, 18));
		expect(subscription.getCheckpoint()).toBe(21);
		expect(onEvent).toHaveBeenCalledTimes(3);
		expect(fixture.getSubscriptionOptions()?.lifecycleCursor?.()).toEqual({
			afterSequence: 21,
		});
		fixture.status({
			status: "ready",
			lifecycleReady: {
				version: "v1",
				stream: "chat.changed",
				afterSequence: 21,
				throughSequence: 25,
			},
		});
		expect(subscription.getCheckpoint()).toBe(25);
		expect(onError).not.toHaveBeenCalled();
	});

	it("pins reconnect readiness to the cursor sent for that physical subscribe", async () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		const subscription = new HubChatLifecycleClient(
			fixture.transport,
		).subscribeReconciled(
			{ onEvent: vi.fn(), onError },
			{
				afterSequence: 8,
				requiredConnectionGeneration: 3,
				readinessTimeoutMs: 100,
			},
		);
		fixture.status({
			status: "ready",
			lifecycleReady: {
				version: "v1",
				stream: "chat.changed",
				afterSequence: 8,
				throughSequence: 8,
			},
		});
		await subscription.ready;
		fixture.emit(reconciledEvent(12, 8));

		// The transport evaluates this provider for every physical reconnect.
		expect(fixture.getSubscriptionOptions()?.lifecycleCursor?.()).toEqual({
			afterSequence: 12,
		});
		fixture.status({
			status: "ready",
			lifecycleReady: {
				version: "v1",
				stream: "chat.changed",
				afterSequence: 8,
				throughSequence: 12,
			},
		});

		expect(fixture.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "invalid_chain" }),
		);
	});

	it("fails closed on a discontinuous lifecycle chain", async () => {
		const fixture = transportFixture();
		const onError = vi.fn();
		const subscription = new HubChatLifecycleClient(
			fixture.transport,
		).subscribeReconciled(
			{ onEvent: vi.fn(), onError },
			{
				afterSequence: 8,
				requiredConnectionGeneration: 3,
				readinessTimeoutMs: 100,
			},
		);
		fixture.emit(reconciledEvent(12, 7));

		await expect(subscription.ready).rejects.toEqual(
			expect.objectContaining({ code: "invalid_chain" }),
		);
		expect(fixture.release).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "invalid_chain" }),
		);
	});

	it("applies an event before committing its durable checkpoint", async () => {
		const fixture = transportFixture();
		const onCheckpoint = vi.fn();
		const subscription = new HubChatLifecycleClient(
			fixture.transport,
		).subscribeReconciled(
			{
				onEvent: () => {
					throw new Error("projection apply failed");
				},
				onCheckpoint,
			},
			{
				afterSequence: 8,
				requiredConnectionGeneration: 3,
				readinessTimeoutMs: 100,
			},
		);
		fixture.emit(reconciledEvent(12, 8));

		await expect(subscription.ready).rejects.toEqual(
			expect.objectContaining({ code: "apply_failed" }),
		);
		expect(subscription.getCheckpoint()).toBe(8);
		expect(onCheckpoint).not.toHaveBeenCalled();
	});

	it("reports replay unavailability without joining at the current head", async () => {
		const fixture = transportFixture();
		const onReplayUnavailable = vi.fn();
		const onError = vi.fn();
		const subscription = new HubChatLifecycleClient(
			fixture.transport,
		).subscribeReconciled(
			{ onEvent: vi.fn(), onReplayUnavailable, onError },
			{
				afterSequence: 8,
				requiredConnectionGeneration: 3,
				readinessTimeoutMs: 100,
			},
		);
		fixture.status({
			status: "rejected",
			errorCode: "lifecycle_replay_unavailable",
		});

		await expect(subscription.ready).rejects.toBeInstanceOf(
			HubChatLifecycleStreamError,
		);
		expect(onReplayUnavailable).toHaveBeenCalledWith(
			expect.objectContaining({ code: "replay_unavailable" }),
		);
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ code: "replay_unavailable" }),
		);
		expect(fixture.release).toHaveBeenCalledOnce();
	});
});

function reconciledEvent(
	catalogSequence: number,
	previousDeliveredSequence: number,
): HubEventEnvelope {
	return {
		version: "v1",
		event: "chat.changed",
		eventId: `event-${catalogSequence}`,
		timestamp: catalogSequence,
		catalogSequence,
		previousDeliveredSequence,
		payload: {
			chatId: "chat-1",
			eventType: "chat.renamed",
			aggregateKind: "chat",
			aggregateId: "chat-1",
			previousRevision: 1,
			resultingRevision: 2,
			occurredAt: "2026-08-15T12:00:00.000Z",
			chat: null,
		},
	} as unknown as HubEventEnvelope;
}
