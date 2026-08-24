import type {
	HubChatLifecycleTransportCursor,
	HubChatLifecycleTransportReady,
	HubChatRuntimeCursor,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";

export interface HubEventSubscriptionOptions {
	readonly sessionId?: string;
	readonly runtimeCursor?: HubChatRuntimeCursor;
	readonly lifecycleCursor?: HubChatLifecycleTransportCursor;
	/** Trusted in-process acknowledgement from the managed runtime source. */
	readonly onRuntimeReady?: (cursor: HubChatRuntimeCursor) => void;
	readonly onLifecycleReady?: (ready: HubChatLifecycleTransportReady) => void;
}

export interface HubCommandTransport {
	command(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: HubEventSubscriptionOptions,
	): Promise<() => void> | (() => void);
}

/** One explicit WebSocket attachment. Closing it must release only that scope. */
export interface HubSocketCommandTransport extends HubCommandTransport {
	closeConnection(): void;
}
