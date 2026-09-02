import type { ProcessContext } from "@/hooks/chat-session/types";
import { productNameForVersion, STABLE_PRODUCT_NAME } from "@/lib/app-channel";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export const DEFAULT_DESKTOP_WINDOW_TITLE = STABLE_PRODUCT_NAME;

export function buildDesktopWindowTitle(version: string | undefined): string {
	const trimmed = version?.trim();
	return trimmed
		? `${productNameForVersion(trimmed)} v${trimmed}`
		: DEFAULT_DESKTOP_WINDOW_TITLE;
}

async function readAppVersion(): Promise<string | undefined> {
	const ctx = await desktopClient.invoke<ProcessContext>("get_process_context");
	return ctx.appVersion?.trim() || undefined;
}

/**
 * Tauri's window title is static in tauri.conf.json; append the running app
 * version once the sidecar reports it. No-op outside the Tauri shell (e.g.
 * sidecar/web dev mode), where there is no native window to retitle.
 */
export async function syncDesktopWindowTitle(): Promise<void> {
	if (!isTauriAvailable()) {
		return;
	}
	try {
		const version = await readAppVersion();
		if (!version) {
			return;
		}
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		await getCurrentWindow().setTitle(buildDesktopWindowTitle(version));
	} catch {
		// Keep the default static title if the sidecar or window API is unavailable.
	}
}

/**
 * Show a surface-specific title (e.g. `Drive · Call`), or restore the app
 * default with `null`. `document.title` is set in every mode so the web/dev
 * build and headless screenshots see it too; the native window follows
 * inside the Tauri shell.
 */
export async function applyDesktopWindowTitle(
	title: string | null,
): Promise<void> {
	if (typeof document !== "undefined") {
		document.title = title ?? DEFAULT_DESKTOP_WINDOW_TITLE;
	}
	if (!isTauriAvailable()) {
		return;
	}
	if (title === null) {
		await syncDesktopWindowTitle();
		return;
	}
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		await getCurrentWindow().setTitle(title);
	} catch {
		// The window API is unavailable; the document title still changed.
	}
}

/**
 * Hold `document.title` at `title` until released.
 *
 * Next streams the route metadata after hydration and React re-asserts its
 * hoisted `<title>` text once when it lands, which silently undoes a plain
 * `document.title` write made earlier. Watching `<head>` and re-applying keeps
 * the surface title in charge; a title that already matches is a no-op, so
 * the observer never feeds itself.
 */
export function keepDocumentTitle(title: string): () => void {
	if (typeof document === "undefined") {
		return () => undefined;
	}
	const apply = () => {
		if (document.title !== title) {
			document.title = title;
		}
	};
	apply();
	if (typeof MutationObserver !== "function") {
		return () => undefined;
	}
	const observer = new MutationObserver(apply);
	observer.observe(document.head, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	return () => observer.disconnect();
}
