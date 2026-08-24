import {
	type HubEventEnvelope,
	parseHubChatRuntimeCursor,
	parseHubChatRuntimeEventSubscription,
	parseHubChatRuntimeWireEvent,
} from "@cline/shared";
import { ChatCatalogError } from "../../../chat-catalog/sqlite-chat-catalog-service";
import type { HubEventSubscriptionOptions } from "../command-transport";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "../workspace-capability-authority";
import type { HubWorkspaceManagedCorePool } from "../workspace-managed-core-pool";

export async function subscribeChatRuntimeEvents(
	identity: HubAuthenticatedConnection,
	authority: HubWorkspaceCapabilityAuthority,
	pool: HubWorkspaceManagedCorePool,
	options: HubEventSubscriptionOptions | undefined,
	listener: (event: HubEventEnvelope) => void,
): Promise<(() => void) | undefined> {
	let filter: ReturnType<typeof parseHubChatRuntimeEventSubscription>;
	try {
		filter = parseHubChatRuntimeEventSubscription({
			...(options?.sessionId ? { sessionId: options.sessionId } : {}),
			...(options?.runtimeCursor ? { cursor: options.runtimeCursor } : {}),
		});
	} catch {
		throw new ChatCatalogError(
			"invalid_input",
			"managed runtime event subscription is invalid",
		);
	}
	authority.assertActive(identity);
	const signal = authority.signal(identity);
	const core = await pool.get(identity);
	if (!core.runtimeEventWire) return undefined;
	authority.assertActive(identity);
	let active = true;
	let unsubscribe: (() => void) | undefined;
	const release = () => {
		if (!active) return;
		active = false;
		try {
			unsubscribe?.();
		} catch {
			// Connection cleanup and authority release must continue fail closed.
		}
	};
	let subscribed: (() => void) | undefined;
	try {
		subscribed = core.runtimeEventWire.subscribe(
			Object.freeze({
				identity,
				signal,
				...filter,
				ready: (input: unknown) => {
					if (!active || signal.aborted) {
						throw new Error("managed runtime readiness arrived after release");
					}
					authority.assertActive(identity);
					const cursor = parseHubChatRuntimeCursor(input);
					options?.onRuntimeReady?.(cursor);
				},
				emit: (input: unknown) => {
					if (!active || signal.aborted) return;
					let event:
						| ReturnType<typeof parseHubChatRuntimeWireEvent>
						| undefined;
					try {
						authority.assertActive(identity);
						event = parseHubChatRuntimeWireEvent(input);
					} catch {
						// Malformed, revoked, or late output never reaches clients.
					}
					if (
						!event ||
						(filter.sessionId && event.sessionId !== filter.sessionId)
					) {
						return;
					}
					// Delivery admission failure must propagate during cursor replay so the
					// source cannot acknowledge a partially admitted suffix as ready.
					listener(event);
				},
			}),
		);
	} catch (error) {
		release();
		throw error;
	}
	if (typeof subscribed !== "function") {
		release();
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed runtime event wire returned an invalid subscription",
		);
	}
	unsubscribe = subscribed;
	try {
		authority.assertActive(identity);
	} catch (error) {
		release();
		throw error;
	}
	return release;
}
