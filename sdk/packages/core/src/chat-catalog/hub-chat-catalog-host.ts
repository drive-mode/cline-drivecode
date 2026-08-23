import type { HubChatCatalogCommandName } from "@cline/shared";
import type { HubAuthenticatedConnection } from "../hub/server/workspace-capability-authority";
import type {
	ChatCatalogAuthorityContext,
	ChatCatalogConfirmationGrant,
	ChatCatalogMutationFence,
} from "./chat-catalog-authority";
import type { ChatCatalogPort } from "./chat-catalog-port";
import type { HubChatCatalogConfirmationBroker } from "./hub-chat-catalog-confirmation-broker";

export interface HubChatCatalogAuthorityRequest {
	/**
	 * Server-minted, socket-bound identity. The provider may choose actor
	 * presentation, but principal, tenant, workspace, connection id, and
	 * transport are verified again by core before catalog dispatch.
	 */
	readonly authenticatedConnection: HubAuthenticatedConnection;
	/** Connection id retained under the historical broker field name. */
	readonly authenticatedClientId: string;
	readonly command: HubChatCatalogCommandName;
	readonly requestId?: string;
	/** Present only after the core-owned broker atomically consumes it. */
	readonly confirmationGrant?: ChatCatalogConfirmationGrant;
	/** Server-owned final mutation fence for the authenticated socket. */
	readonly mutationFence: ChatCatalogMutationFence;
}

/**
 * Trusted host wiring for hub catalog commands. The authority callback receives
 * neither arbitrary operation payload nor self-attested registration metadata;
 * model/plugin arguments cannot manufacture actor, workspace, tenant, or
 * lifecycle-confirmation claims. Lifecycle commands use a separate, host-owned
 * broker method so request-derived target fields alone never mint authority.
 */
export interface HubChatCatalogHost {
	readonly port: ChatCatalogPort;
	readonly confirmationBroker: HubChatCatalogConfirmationBroker;
	authorize(
		request: HubChatCatalogAuthorityRequest,
	): ChatCatalogAuthorityContext | Promise<ChatCatalogAuthorityContext>;
	/** Called once after managed admissions and Cores have stopped. */
	dispose?(): void | Promise<void>;
}
