/**
 * `kanban://` deep-link parsing and routing.
 *
 * Pure URL work — no host imports — because both halves need it: the desktop
 * host classifies an inbound link before deciding which window to route it
 * to, and the renderer turns the resolved target into a navigation.
 *
 * Registering the scheme is deliberately absent. Electron needed a runtime
 * call (`setAsDefaultProtocolClient`); Tauri declares it in `tauri.conf.json`
 * under `plugins.deep-link`, so there is nothing for TypeScript to do.
 */

export const KANBAN_PROTOCOL = "kanban";
export const OAUTH_CALLBACK_PATH = "/oauth/callback";

export interface ParsedProtocolUrl {
	raw: string;
	pathname: string;
	searchParams: URLSearchParams;
	isOAuthCallback: boolean;
}

export function parseProtocolUrl(raw: string): ParsedProtocolUrl | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}

	if (url.protocol !== `${KANBAN_PROTOCOL}:`) {
		return null;
	}

	// `kanban:` isn't a WHATWG "special" scheme, so `new URL("kanban://oauth/callback")`
	// parses "oauth" as the hostname and "/callback" as the pathname. Re-join
	// so downstream consumers see `/oauth/callback`.
	const pathname = `/${url.hostname}${url.pathname}`.replace(/\/+$/, "") || "/";

	return {
		raw,
		pathname,
		searchParams: url.searchParams,
		isOAuthCallback: pathname === OAUTH_CALLBACK_PATH,
	};
}

/**
 * A `kanban://` link resolved to something the app can act on.
 *
 * The project id is part of the *path* for task links rather than a query
 * parameter, because the web UI addresses a task as `/<projectId>?task=<id>`
 * — a bare `kanban://task/<id>` could not be turned into a URL without first
 * knowing which project owns it.
 */
export type DeepLinkRoute =
	| { kind: "oauth-callback"; searchParams: URLSearchParams }
	| { kind: "project"; projectId: string }
	| { kind: "task"; projectId: string; taskId: string };

/** Where a route lands inside the runtime origin. */
export interface DeepLinkTarget {
	projectId: string;
	pathname: string;
	/** Leading `?` included, or empty. */
	search: string;
}

function decodeSegment(segment: string): string | null {
	if (!segment) return null;
	try {
		const decoded = decodeURIComponent(segment).trim();
		return decoded.length > 0 ? decoded : null;
	} catch {
		return null;
	}
}

/**
 * Classify a parsed `kanban://` URL. Returns `null` for anything this build
 * doesn't recognise, so the caller can log it rather than silently dropping
 * a link the user clicked.
 */
export function resolveDeepLinkRoute(
	parsed: ParsedProtocolUrl,
): DeepLinkRoute | null {
	if (parsed.isOAuthCallback) {
		return { kind: "oauth-callback", searchParams: parsed.searchParams };
	}

	const segments = parsed.pathname.split("/").filter(Boolean);
	if (segments[0] !== "project") return null;

	const projectId = decodeSegment(segments[1] ?? "");
	if (!projectId) return null;

	if (segments.length === 2) {
		return { kind: "project", projectId };
	}

	if (segments.length === 4 && segments[2] === "task") {
		const taskId = decodeSegment(segments[3] ?? "");
		if (!taskId) return null;
		return { kind: "task", projectId, taskId };
	}

	return null;
}

/**
 * Map a navigable route onto a runtime path. OAuth callbacks return `null`:
 * they are relayed to the runtime's HTTP endpoint rather than navigated to.
 */
export function buildDeepLinkTarget(route: DeepLinkRoute): DeepLinkTarget | null {
	switch (route.kind) {
		case "oauth-callback":
			return null;
		case "project":
			return {
				projectId: route.projectId,
				pathname: `/${encodeURIComponent(route.projectId)}`,
				search: "",
			};
		case "task":
			return {
				projectId: route.projectId,
				pathname: `/${encodeURIComponent(route.projectId)}`,
				search: `?task=${encodeURIComponent(route.taskId)}`,
			};
	}
}

export function extractProtocolUrlFromArgv(
	argv: readonly string[],
): string | null {
	const prefix = `${KANBAN_PROTOCOL}://`;
	for (const arg of argv) {
		if (arg.startsWith(prefix)) {
			return arg;
		}
	}
	return null;
}
