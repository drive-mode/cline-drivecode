import {
	type HubEventEnvelope,
	parseHubChatLifecycleEventSubscription,
	parseHubChatLifecycleReady,
	parseHubChatLifecycleReconciledWireEvent,
	parseHubChatLifecycleReconciliationSubscription,
	parseHubChatLifecycleWireEvent,
} from "@cline/shared";
import { ChatCatalogError } from "../../../chat-catalog/sqlite-chat-catalog-service";
import type { HubEventSubscriptionOptions } from "../command-transport";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "../workspace-capability-authority";
import type { HubWorkspaceManagedCorePool } from "../workspace-managed-core-pool";

export async function subscribeChatLifecycleEvents(
	identity: HubAuthenticatedConnection,
	authority: HubWorkspaceCapabilityAuthority,
	pool: HubWorkspaceManagedCorePool,
	options: HubEventSubscriptionOptions | undefined,
	listener: (event: HubEventEnvelope) => void,
): Promise<() => void> {
	let filter: ReturnType<typeof parseHubChatLifecycleEventSubscription>;
	let reconciliation:
		| ReturnType<typeof parseHubChatLifecycleReconciliationSubscription>
		| undefined;
	try {
		filter = parseHubChatLifecycleEventSubscription(
			options?.sessionId ? { sessionId: options.sessionId } : {},
		);
		reconciliation = options?.lifecycleCursor
			? parseHubChatLifecycleReconciliationSubscription(options.lifecycleCursor)
			: undefined;
		if (reconciliation && filter.sessionId) throw new Error("ambiguous lane");
	} catch {
		throw new ChatCatalogError(
			"invalid_input",
			"managed lifecycle event subscription is invalid",
		);
	}
	authority.assertActive(identity);
	const signal = authority.signal(identity);
	const core = await pool.get(identity);
	authority.assertActive(identity);
	if (!core.eventWire) {
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed lifecycle event wire is not configured",
		);
	}
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
	const subscribed = core.eventWire.subscribe(
		Object.freeze({
			identity,
			signal,
			...filter,
			...(reconciliation
				? {
						afterSequence: reconciliation.afterSequence,
						ready: (throughSequence: number) => {
							if (!active || signal.aborted) return;
							authority.assertActive(identity);
							const ready = parseHubChatLifecycleReady({
								version: "v1",
								stream: "chat.changed",
								afterSequence: reconciliation?.afterSequence,
								throughSequence,
							});
							options?.onLifecycleReady?.(ready);
						},
					}
				: {}),
			emit: (input: unknown) => {
				if (!active || signal.aborted) return;
				authority.assertActive(identity);
				const event = reconciliation
					? (parseHubChatLifecycleReconciledWireEvent(
							input,
						) as HubEventEnvelope)
					: parseHubChatLifecycleWireEvent(input);
				if (
					!reconciliation &&
					filter.sessionId &&
					event.sessionId !== filter.sessionId
				)
					return;
				listener(event);
			},
		}),
	);
	if (typeof subscribed !== "function") {
		release();
		throw new ChatCatalogError(
			"unsupported_capability",
			"managed lifecycle event wire returned an invalid subscription",
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
