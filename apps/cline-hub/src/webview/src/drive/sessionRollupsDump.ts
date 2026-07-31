import { postToHost } from "../vscode";

const TIMEOUT_MS = 3_000;

export type SessionRollupDump = {
	rollups: unknown[];
	dump: string;
};

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
			window.removeEventListener("message", onMessage);
			reject(new Error("drive_session_rollups timed out"));
		}, timeoutMs);

		function onMessage(event: MessageEvent) {
			const message = event.data as {
				type?: string;
				requestId?: string;
				rollups?: unknown[];
				dump?: string;
				text?: string;
			};
			if (
				message.type !== "drive_session_rollups" &&
				message.type !== "drive_session_rollups_error"
			) {
				return;
			}
			if (message.requestId !== requestId) {
				return;
			}
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			if (message.type === "drive_session_rollups_error") {
				reject(
					new Error(
						message.text?.trim() || "drive_session_rollups failed",
					),
				);
				return;
			}
			resolve({
				rollups: Array.isArray(message.rollups) ? message.rollups : [],
				dump: typeof message.dump === "string" ? message.dump : "",
			});
		}

		window.addEventListener("message", onMessage);
		postToHost({
			type: "drive_session_rollups",
			requestId,
			workspaceRoot: root,
			...(typeof options?.limit === "number"
				? { limit: options.limit }
				: {}),
			...(options?.callSessionId?.trim()
				? { callSessionId: options.callSessionId.trim() }
				: {}),
		});
	});
}
