export type DriveShellMode = "lobby" | "call" | "history";

/** Browse lite surfaces on `?app=1` (not full hub Status / Analytics). */
export type DriveBrowseSurface = "rooms" | "tasks" | "artifacts" | "status";

export const DRIVE_PATH = "/drive";
export const DRIVE_SHELL_MODE_QUERY = "mode";
export const DRIVE_SESSION_QUERY = "id";
/** Consumer composition — omit hub nav rail (MC1 / ADR-0029 D4). */
export const DRIVE_APP_QUERY = "app";
/** Consumer Browse lite page — `?browse=rooms|tasks|artifacts|status`. */
export const DRIVE_BROWSE_QUERY = "browse";

const BROWSE_SURFACES = new Set<DriveBrowseSurface>([
	"rooms",
	"tasks",
	"artifacts",
	"status",
]);

export type DrivePathOptions = {
	mode?: DriveShellMode;
	sessionId?: string;
	/**
	 * Browse lite surface. `null` clears `browse` from the URL.
	 * Omitted = leave whatever `preserveSearch` already has (unless call/history).
	 */
	browse?: DriveBrowseSurface | null;
	/** Extra search params to keep (demo flags, `app=1`, etc.). */
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
		params.delete(DRIVE_BROWSE_QUERY);
	} else if (options.mode === "history") {
		params.set(DRIVE_SHELL_MODE_QUERY, "history");
		params.delete(DRIVE_BROWSE_QUERY);
	}

	if (options.browse === null) {
		params.delete(DRIVE_BROWSE_QUERY);
	} else if (options.browse) {
		params.set(DRIVE_BROWSE_QUERY, options.browse);
	}

	const query = params.toString();
	return query ? `${DRIVE_PATH}?${query}` : DRIVE_PATH;
}

/** Parse `?browse=` — only valid surfaces; else undefined. */
export function parseDriveBrowse(
	search?: string | URLSearchParams,
): DriveBrowseSurface | undefined {
	const raw = toSearchParams(search).get(DRIVE_BROWSE_QUERY)?.trim();
	if (!raw || !BROWSE_SURFACES.has(raw as DriveBrowseSurface)) {
		return undefined;
	}
	return raw as DriveBrowseSurface;
}

export function parseDriveSessionId(
	search?: string | URLSearchParams,
): string | undefined {
	const id = toSearchParams(search).get(DRIVE_SESSION_QUERY)?.trim();
	return id || undefined;
}

/** `?app=1` — phone/PWA shell without hub nav (mobile-consumer MC1). */
export function parseDriveAppShell(
	search?: string | URLSearchParams,
): boolean {
	return toSearchParams(search).get(DRIVE_APP_QUERY) === "1";
}

/**
 * Consumer composition: anything that is not already a Drive URL becomes the
 * Join/Continue lobby. Call/history query on `/drive` is left alone.
 * Returns null when no redirect is needed (or `app` is not set).
 */
export function appShellHomeRedirect(
	pathname: string,
	search?: string | URLSearchParams,
): string | null {
	if (!parseDriveAppShell(search)) {
		return null;
	}
	if (pathname === DRIVE_PATH) {
		return null;
	}
	const legacy = legacyChatOrSessionsRedirect(pathname, search);
	if (legacy) {
		return legacy;
	}
	return drivePath({ mode: "lobby", preserveSearch: search, browse: null });
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
