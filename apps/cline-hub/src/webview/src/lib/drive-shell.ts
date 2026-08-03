export type DriveShellMode = "lobby" | "call" | "history";

export const DRIVE_PATH = "/drive";
export const DRIVE_SHELL_MODE_QUERY = "mode";
export const DRIVE_SESSION_QUERY = "id";

export type DrivePathOptions = {
	mode?: DriveShellMode;
	sessionId?: string;
	/** Extra search params to keep (demo flags, etc.). */
	preserveSearch?: string | URLSearchParams;
};

/**
 * Build a `/drive` URL for lobby, call, or history.
 * Call mode with a session uses `?id=`; history uses `?mode=history`.
 * Lobby omits mode (default).
 */
export function drivePath(options: DrivePathOptions = {}): string {
	const params = toSearchParams(options.preserveSearch);
	params.delete(DRIVE_SHELL_MODE_QUERY);
	params.delete(DRIVE_SESSION_QUERY);

	const sessionId = options.sessionId?.trim();
	if (sessionId) {
		params.set(DRIVE_SESSION_QUERY, sessionId);
	} else if (options.mode === "history") {
		params.set(DRIVE_SHELL_MODE_QUERY, "history");
	}

	const query = params.toString();
	return query ? `${DRIVE_PATH}?${query}` : DRIVE_PATH;
}

export function parseDriveSessionId(
	search?: string | URLSearchParams,
): string | undefined {
	const id = toSearchParams(search).get(DRIVE_SESSION_QUERY)?.trim();
	return id || undefined;
}

/**
 * Resolve Drive shell mode from the current location.
 * Session id implies call; `mode=history` implies history; otherwise lobby
 * unless `forceCall` (e.g. an in-flight drive launch) is set.
 */
export function parseDriveShellMode(
	search?: string | URLSearchParams,
	options?: { forceCall?: boolean },
): DriveShellMode {
	if (parseDriveSessionId(search)) {
		return "call";
	}
	const mode = toSearchParams(search).get(DRIVE_SHELL_MODE_QUERY)?.trim();
	if (mode === "history") {
		return "history";
	}
	if (options?.forceCall) {
		return "call";
	}
	return "lobby";
}

/**
 * Map legacy `/chat` and `/sessions` URLs onto `/drive`.
 * Returns null when no redirect is needed.
 */
export function legacyChatOrSessionsRedirect(
	pathname: string,
	search?: string | URLSearchParams,
): string | null {
	const params = toSearchParams(search);
	if (pathname === "/chat") {
		const sessionId = params.get(DRIVE_SESSION_QUERY)?.trim();
		return drivePath({
			mode: "call",
			sessionId: sessionId || undefined,
			preserveSearch: params,
		});
	}
	if (pathname === "/sessions") {
		params.delete(DRIVE_SESSION_QUERY);
		return drivePath({ mode: "history", preserveSearch: params });
	}
	return null;
}

function toSearchParams(search?: string | URLSearchParams): URLSearchParams {
	if (search instanceof URLSearchParams) {
		return new URLSearchParams(search);
	}
	if (search === undefined || search === "") {
		return new URLSearchParams();
	}
	const trimmed = search.startsWith("?") ? search.slice(1) : search;
	return new URLSearchParams(trimmed);
}
