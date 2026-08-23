import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@cline/shared";
import type { HubSocketCommandTransport } from "./command-transport";

export interface NativeHubTransport {
	handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void;
}

export class NativeHubTransportAdapter implements HubSocketCommandTransport {
	constructor(private readonly transport: NativeHubTransport) {}

	command(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		return this.transport.handleCommand(envelope);
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		return this.transport.subscribe(clientId, listener, options);
	}

	closeConnection(): void {
		// Native/unscoped attachment has no authority object to release.
	}
}
