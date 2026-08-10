/**
 * Tauri implementation of the bridge's `DesktopHost`.
 *
 * Thin by design: every method translates one call and returns. All the policy
 * — update transitions, notification dedupe, badge rules — lives in
 * `@kanban/desktop-bridge` and runs unchanged here, which is what made
 * swapping Electron for Tauri a matter of replacing this layer rather than
 * rewriting the feature set.
 *
 * ## What is deliberately absent
 *
 * `updater` and `notifications` resolve to `null` until the host declares the
 * matching capability. Both need Tauri plugins that this build does not link
 * yet (`tauri-plugin-updater` is present but not wired to Kanban's window,
 * `tauri-plugin-notification` is not a dependency at all). The contract's
 * capability model already covers exactly this case: the capability is omitted
 * from the handshake, `useDesktop().has()` reports false, and the namespace
 * method is a documented no-op. Wiring a plugin later is additive and changes
 * nothing else.
 */

import {
	isDesktopCapability,
	toDesktopPlatform,
	type DeepLinkTarget,
	type DesktopCapability,
	type DesktopHost,
	type DesktopMenuAction,
} from "@kanban/desktop-bridge";

import {
	CMD_HANDSHAKE,
	CMD_OPEN_PROJECT_WINDOW,
	CMD_PICK_DIRECTORY,
	CMD_PUBLISH_MENU_ACTIONS,
	CMD_RESTART_RUNTIME,
	EVENT_MENU_ACTION_INVOKED,
	type KanbanHandshakePayload,
} from "./commands.js";
import { createFocusTracker, type FocusTracker } from "./focus-tracker.js";
import { createTauriPresenceView } from "./presence-view.js";
import type { TauriSurface, UnlistenFn } from "./tauri-surface.js";

export interface TauriDesktopHost extends DesktopHost {
	/** Releases the focus subscription. Call on window teardown. */
	dispose(): void;
}

export interface CreateTauriHostOptions {
	surface: TauriSurface;
	/**
	 * Navigate the current window to a deep-link target. Supplied by the
	 * renderer because routing is the web UI's concern, not the host's.
	 */
	navigate: (target: DeepLinkTarget) => void;
}

function parseHandshake(payload: unknown): KanbanHandshakePayload | null {
	if (typeof payload !== "object" || payload === null) return null;
	const record = payload as Record<string, unknown>;
	if (typeof record.appVersion !== "string") return null;
	if (typeof record.platform !== "string") return null;
	if (typeof record.isPackaged !== "boolean") return null;
	if (!Array.isArray(record.capabilities)) return null;

	return {
		appVersion: record.appVersion,
		platform: record.platform,
		isPackaged: record.isPackaged,
		capabilities: record.capabilities.filter(
			(value): value is string => typeof value === "string",
		),
	};
}

/**
 * Build a host, or return `null` when this isn't a Tauri window at all.
 *
 * A null here is the normal path in a browser tab and in tests — the web UI
 * falls back to browser mode, which is always safe.
 */
export async function createTauriDesktopHost(
	opts: CreateTauriHostOptions,
): Promise<TauriDesktopHost | null> {
	const { surface } = opts;
	if (!surface.isTauri()) return null;

	let handshake: KanbanHandshakePayload | null = null;
	try {
		handshake = parseHandshake(await surface.invoke(CMD_HANDSHAKE));
	} catch (err) {
		// A host too old to know the command, or one that failed to start its
		// Kanban half. Browser mode is the honest fallback — better than a
		// window whose desktop features all silently fail.
		console.warn(
			"[desktop] Kanban handshake failed; running without a desktop bridge:",
			err instanceof Error ? err.message : err,
		);
		return null;
	}
	if (!handshake) {
		console.warn("[desktop] Kanban handshake returned an unusable payload.");
		return null;
	}

	// Anything this build doesn't recognise is dropped rather than failing
	// the handshake, matching parseBridgeBootstrap: a newer host advertising
	// an unknown capability should stay usable for the ones we do know.
	const declaredCapabilities: DesktopCapability[] =
		handshake.capabilities.filter(isDesktopCapability);
	const hostCapabilities = new Set(handshake.capabilities);
	const window = surface.currentWindow();
	const focus: FocusTracker = createFocusTracker(window);

	const presence = hostCapabilities.has("presence")
		? createTauriPresenceView({
				surface,
				window,
				hasTray: hostCapabilities.has("tray"),
			})
		: null;

	return {
		platform: toDesktopPlatform(handshake.platform),
		appVersion: handshake.appVersion,
		isPackaged: handshake.isPackaged,
		declaredCapabilities,

		openProjectWindow(projectId) {
			void surface
				.invoke(CMD_OPEN_PROJECT_WINDOW, { projectId })
				.catch((err: unknown) => {
					console.warn(
						"[desktop] Failed to open project window:",
						err instanceof Error ? err.message : err,
					);
				});
		},

		restartRuntime() {
			void surface.invoke(CMD_RESTART_RUNTIME).catch((err: unknown) => {
				console.warn(
					"[desktop] Failed to restart the runtime:",
					err instanceof Error ? err.message : err,
				);
			});
		},

		reveal(target) {
			// Bring the window forward first: a deep link clicked from a
			// notification while the app is hidden would otherwise navigate a
			// window the user never sees.
			void window.unminimize().catch(() => {});
			void window.show().catch(() => {});
			void window.setFocus().catch(() => {});
			opts.navigate(target);
		},

		isAppFocused: () => focus.isFocused(),

		async pickDirectory(options) {
			try {
				const chosen = await surface.invoke<string | null>(
					CMD_PICK_DIRECTORY,
					{ title: options?.title ?? null },
				);
				return typeof chosen === "string" && chosen.length > 0 ? chosen : null;
			} catch (err) {
				// A cancelled picker and a broken one both mean "no directory",
				// and the caller has one branch for that.
				console.warn(
					"[desktop] Directory picker failed:",
					err instanceof Error ? err.message : err,
				);
				return null;
			}
		},

		publishMenuActions(actions: readonly DesktopMenuAction[]) {
			void surface
				.invoke(CMD_PUBLISH_MENU_ACTIONS, { actions })
				.catch((err: unknown) => {
					console.warn(
						"[desktop] Failed to publish menu actions:",
						err instanceof Error ? err.message : err,
					);
				});
		},

		onMenuActionInvoked(listener) {
			let unlisten: UnlistenFn | null = null;
			let cancelled = false;

			void surface
				.listen<string>(EVENT_MENU_ACTION_INVOKED, (event) => {
					if (!cancelled) listener(event.payload);
				})
				.then((fn) => {
					// Unsubscribing before the listener is even registered is
					// normal in React StrictMode, which mounts and unmounts once
					// before the real mount.
					if (cancelled) {
						fn();
						return;
					}
					unlisten = fn;
				})
				.catch(() => {});

			return () => {
				cancelled = true;
				unlisten?.();
				unlisten = null;
			};
		},

		// See the module comment: null until the plugins are linked.
		updater: null,
		notifications: null,
		presence,

		dispose() {
			focus.dispose();
		},
	};
}
