import type { HubEventEnvelope } from "@cline/shared";
import { ChatCatalogError } from "../../../chat-catalog/sqlite-chat-catalog-service";
import type { HubEventSubscriptionOptions } from "../command-transport";
import type {
	HubAuthenticatedConnection,
	HubWorkspaceCapabilityAuthority,
} from "../workspace-capability-authority";
import type { HubWorkspaceManagedCorePool } from "../workspace-managed-core-pool";
import { subscribeChatLifecycleEvents } from "./chat-lifecycle-event-handlers";
import { subscribeChatRuntimeEvents } from "./chat-runtime-event-handlers";

export async function subscribeChatManagedEvents(
	identity: HubAuthenticatedConnection,
	authority: HubWorkspaceCapabilityAuthority,
	pool: HubWorkspaceManagedCorePool,
	options: HubEventSubscriptionOptions | undefined,
	listener: (event: HubEventEnvelope) => void,
): Promise<() => void> {
	const releases: Array<() => void> = [];
	try {
		if (options?.lifecycleCursor) {
			if (options.sessionId || options.runtimeCursor) {
				throw new ChatCatalogError(
					"invalid_input",
					"managed lifecycle and runtime subscription lanes are exclusive",
				);
			}
			releases.push(
				await subscribeChatLifecycleEvents(
					identity,
					authority,
					pool,
					options,
					listener,
				),
			);
		} else if (options?.sessionId) {
			const releaseRuntime = await subscribeChatRuntimeEvents(
				identity,
				authority,
				pool,
				options,
				listener,
			);
			if (releaseRuntime) releases.push(releaseRuntime);
		} else {
			throw new ChatCatalogError(
				"invalid_input",
				"managed subscription requires one explicit lifecycle or runtime cursor lane",
			);
		}
	} catch (error) {
		for (const release of releases.reverse()) release();
		throw error;
	}
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		for (const release of releases.reverse()) release();
	};
}
