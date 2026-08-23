import { describe, expect, it } from "vitest";
import {
	parseHubChatLifecycleEventSubscription,
	parseHubChatLifecycleReady,
	parseHubChatLifecycleReconciledWireEvent,
	parseHubChatLifecycleReconciliationSubscription,
	parseHubChatLifecycleWireEvent,
} from "./chat-lifecycle-event-wire";

const EVENT = {
	version: "v1",
	event: "chat.changed",
	eventId: "event-1",
	sessionId: "session-1",
	timestamp: 1,
	payload: {
		chatId: "chat-1",
		eventType: "chat.archived",
		aggregateKind: "chat",
		aggregateId: "chat-1",
		previousRevision: 1,
		resultingRevision: 2,
		occurredAt: "2026-08-15T12:00:00.000Z",
		chat: {
			chatId: "chat-1",
			catalogState: "archived",
			headSessionId: "session-1",
			sourceKind: "interactive",
			createdAt: "2026-08-15T11:00:00.000Z",
			lastActivityAt: "2026-08-15T12:00:00.000Z",
			revision: 2,
			sessions: [],
			bindings: [],
		},
	},
} as const;

describe("managed chat lifecycle event wire", () => {
	it("accepts a bounded sanitized workspace event", () => {
		expect(parseHubChatLifecycleWireEvent(EVENT)).toEqual(EVENT);
		expect(
			parseHubChatLifecycleEventSubscription({ sessionId: "session-1" }),
		).toEqual({ sessionId: "session-1" });
	});

	it("rejects workspace paths, credentials, text bodies, and unknown fields", () => {
		for (const forbidden of [
			{ workspaceKey: "/tmp/private" },
			{ leaseToken: "secret" },
			{ prompt: "private prompt" },
			{ text: "assistant body" },
			{ toolCalls: [] },
		]) {
			expect(() =>
				parseHubChatLifecycleWireEvent({
					...EVENT,
					payload: { ...EVENT.payload, ...forbidden },
				}),
			).toThrow();
		}
		expect(() =>
			parseHubChatLifecycleWireEvent({
				...EVENT,
				payload: {
					...EVENT.payload,
					chat: { ...EVENT.payload.chat, workspaceKey: "/tmp/private" },
				},
			}),
		).toThrow();
	});

	it("rejects traversal-shaped session filters and events", () => {
		expect(() =>
			parseHubChatLifecycleEventSubscription({ sessionId: "../../outside" }),
		).toThrow();
		expect(() =>
			parseHubChatLifecycleWireEvent({ ...EVENT, sessionId: "../../outside" }),
		).toThrow();
	});

	it("validates the additive chained replay and fenced ready contracts", () => {
		const reconciled = {
			version: "v1",
			event: "chat.changed",
			eventId: "event-replayed",
			timestamp: 2,
			catalogSequence: 12,
			previousDeliveredSequence: 8,
			payload: {
				...EVENT.payload,
				chat: {
					...EVENT.payload.chat,
					archivedAt: "2026-08-15T12:00:00.000Z",
					sessionCount: 1,
					bindingCount: 0,
					sessions: [
						{
							chatId: "chat-1",
							sessionId: "session-1",
							relationKind: "root",
							ordinal: 0,
							attachedAt: "2026-08-15T11:00:00.000Z",
							executionStatus: "idle",
						},
					],
				},
			},
		} as const;
		expect(parseHubChatLifecycleReconciledWireEvent(reconciled)).toEqual(
			reconciled,
		);
		expect(
			parseHubChatLifecycleReconciliationSubscription({ afterSequence: 8 }),
		).toEqual({ afterSequence: 8 });
		expect(
			parseHubChatLifecycleReady({
				version: "v1",
				stream: "chat.changed",
				afterSequence: 8,
				throughSequence: 12,
			}),
		).toMatchObject({ throughSequence: 12 });
	});

	it("rejects lifecycle chain regressions, mismatched projections, and false readiness", () => {
		const base = {
			version: "v1",
			event: "chat.changed",
			eventId: "event-replayed",
			timestamp: 2,
			catalogSequence: 12,
			previousDeliveredSequence: 8,
			payload: {
				...EVENT.payload,
				chat: null,
			},
		};
		expect(() =>
			parseHubChatLifecycleReconciledWireEvent({
				...base,
				previousDeliveredSequence: 12,
			}),
		).toThrow();
		expect(() =>
			parseHubChatLifecycleReconciledWireEvent({
				...base,
				payload: {
					...base.payload,
					chat: {
						...EVENT.payload.chat,
						chatId: "chat-other",
						headSessionId: "session-other",
						archivedAt: "2026-08-15T12:00:00.000Z",
						sessionCount: 1,
						bindingCount: 0,
						sessions: [
							{
								chatId: "chat-other",
								sessionId: "session-other",
								relationKind: "root",
								ordinal: 0,
								attachedAt: "2026-08-15T11:00:00.000Z",
								executionStatus: "idle",
							},
						],
						bindings: [],
					},
				},
			}),
		).toThrow();
		expect(() =>
			parseHubChatLifecycleReady({
				version: "v1",
				stream: "chat.changed",
				afterSequence: 12,
				throughSequence: 11,
			}),
		).toThrow();
	});
});
