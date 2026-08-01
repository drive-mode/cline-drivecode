import {
	type HostMessage,
	isOptionalString,
	subscribeToHostMessages,
} from "../lib/host-message-gateway";
import { postToHost } from "../vscode";

const TIMEOUT_MS = 3_000;

export type SessionRollupDump = {
	rollups: unknown[];
	dump: string;
};

type SessionRollupsReply = HostMessage & {
	type: "drive_session_rollups" | "drive_session_rollups_error";
	requestId?: string;
	rollups?: unknown[];
	dump?: string;
	text?: string;
};

const SESSION_ROLLUPS_REPLY_TYPES = [
	"drive_session_rollups",
	"drive_session_rollups_error",
] as const;

function isSessionRollupsReply(
	message: HostMessage,
): message is SessionRollupsReply {
	return (
		(message.type === "drive_session_rollups" ||
			message.type === "drive_session_rollups_error") &&
		isOptionalString(message.requestId) &&
		(message.rollups === undefined || Array.isArray(message.rollups)) &&
		isOptionalString(message.dump) &&
		isOptionalString(message.text)
	);
}

/**
 * Request local SessionRollup dump from hub (Drive Settings debug).
 */
export function requestSessionRollupsDump(
	workspaceRoot: string,
	options?: { limit?: number; callSessionId?: string; timeoutMs?: number },
): Promise<SessionRollupDump> {
	const timeoutMs = options?.timeoutMs ?? TIMEOUT_MS;
	const requestId = `drive-rollups-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const root = workspaceRoot.trim();
	if (!root) {
		return Promise.reject(new Error("workspaceRoot is required"));
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("drive_session_rollups timed out"));
		}, timeoutMs);

		const unsubscribe = subscribeToHostMessages({
			types: SESSION_ROLLUPS_REPLY_TYPES,
			guard: isSessionRollupsReply,
			onMessage: (message) => {
				if (message.requestId !== requestId) {
					return;
				}
				clearTimeout(timer);
				unsubscribe();
				if (message.type === "drive_session_rollups_error") {
					reject(
						new Error(message.text?.trim() || "drive_session_rollups failed"),
					);
					return;
				}
				resolve({
					rollups: Array.isArray(message.rollups) ? message.rollups : [],
					dump: typeof message.dump === "string" ? message.dump : "",
				});
			},
		});
		postToHost({
			type: "drive_session_rollups",
			requestId,
			workspaceRoot: root,
			...(typeof options?.limit === "number" ? { limit: options.limit } : {}),
			...(options?.callSessionId?.trim()
				? { callSessionId: options.callSessionId.trim() }
				: {}),
		});
	});
}
