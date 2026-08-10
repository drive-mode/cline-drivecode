/**
 * Canonical contract for the `window.desktop` bridge.
 *
 * This file is the single source of truth shared by three consumers:
 *
 *   - the desktop host, which validates and services requests
 *   - the host adapter, which constructs the exposed object
 *   - the web UI, which consumes it through `useDesktop()`
 *
 * It therefore stays free of host imports — no `@tauri-apps/api`, no `node:` —
 * so the renderer bundle can pull it in through the `@desktop-bridge` alias,
 * the same pattern the web UI already uses for its `@runtime-*` modules.
 *
 * ## Versioning
 *
 * `bridgeVersion` guards the *shape of the handshake itself* — the
 * `bridgeVersion` / `platform` / `appVersion` / `capabilities` fields that
 * every consumer must read before it can safely do anything else. It bumps
 * only when those fields change.
 *
 * Individual features are never gated on the version. They are advertised
 * through `capabilities`, which is purely additive: a host that gains
 * notifications adds `"notifications"`, and a host where a feature failed to
 * initialise (unsupported platform, missing OS support) simply omits it.
 * That split is what lets a packaged desktop host meet a web UI from a
 * different release without either side guessing: the version says "I can
 * still talk to you", the capabilities say "here is what I can do".
 *
 * Calling a namespace method whose capability is absent is a no-op, so a
 * missed check degrades to silence rather than a crash. Consumers should
 * still check — `useDesktop()` exposes `has()` for exactly this.
 */

/** Bumped only on a breaking change to the handshake fields below. */
export const DESKTOP_BRIDGE_VERSION = 1;

/**
 * Oldest handshake the renderer knows how to read. A host older than this is
 * treated as "no desktop bridge at all" and the web UI runs in browser mode,
 * which is always a safe fallback.
 */
export const MIN_SUPPORTED_DESKTOP_BRIDGE_VERSION = 1;

/** The property the host adapter exposes on `window`. */
export const DESKTOP_BRIDGE_GLOBAL = "desktop";

export const DESKTOP_CAPABILITIES = [
	"windows",
	"runtime",
	"updates",
	"notifications",
	"presence",
	"actions",
	"dialogs",
] as const;

export type DesktopCapability = (typeof DESKTOP_CAPABILITIES)[number];

export function isDesktopCapability(value: unknown): value is DesktopCapability {
	return (
		typeof value === "string" &&
		(DESKTOP_CAPABILITIES as readonly string[]).includes(value)
	);
}

/**
 * Platform identifier, normalised away from `NodeJS.Platform` so the web UI
 * can read it without pulling in `@types/node`. Anything the desktop app
 * isn't built for collapses to `"other"` rather than leaking a raw string —
 * consumers branch on the three real targets and treat the rest uniformly.
 *
 * The values stay Node-shaped (`darwin` / `win32`) rather than Tauri-shaped
 * (`macos` / `windows`) because the web UI already branches on them and the
 * runtime server reports them that way; the Tauri adapter normalises at the
 * boundary via {@link toDesktopPlatform}, which accepts both spellings.
 */
export type DesktopPlatform = "darwin" | "win32" | "linux" | "other";

export function toDesktopPlatform(platform: string): DesktopPlatform {
	switch (platform) {
		case "darwin":
		case "win32":
		case "linux":
			return platform;
		// Tauri's `platform()` reports these names for the same three targets.
		case "macos":
			return "darwin";
		case "windows":
			return "win32";
		default:
			return "other";
	}
}

/**
 * Request names. Namespaced so one can never collide with an app-level
 * channel.
 *
 * These double as Tauri command names, which is why they are plain strings
 * rather than an enum: the Rust side declares the same literals, and a
 * mismatch is caught by the contract test rather than at runtime.
 */
export const DesktopChannel = {
	OpenProjectWindow: "desktop:windows:open-project",
	RestartRuntime: "desktop:runtime:restart",
	GetUpdateStatus: "desktop:updates:get-status",
	CheckForUpdates: "desktop:updates:check",
	InstallUpdate: "desktop:updates:install",
	Notify: "desktop:notifications:notify",
	SetPresenceCounts: "desktop:presence:set-counts",
	PublishActions: "desktop:actions:publish",
	PickDirectory: "desktop:dialogs:pick-directory",
	/** Host → renderer pushes. Not accepted as inbound channels. */
	UpdateStatusChanged: "desktop:updates:status-changed",
	InvokeAction: "desktop:actions:invoke",
} as const;

export type DesktopChannelName =
	(typeof DesktopChannel)[keyof typeof DesktopChannel];

/**
 * Fields the renderer reads before touching any namespace. Kept as its own
 * interface because the renderer validates exactly this much before deciding
 * whether the bridge is usable at all.
 */
export interface DesktopBridgeHandshake {
	readonly bridgeVersion: number;
	readonly platform: DesktopPlatform;
	readonly appVersion: string;
	readonly capabilities: readonly DesktopCapability[];
}

export interface DesktopWindowsApi {
	/** Open (or focus) a dedicated window for `projectId`. */
	openProject(projectId: string): void;
}

export interface DesktopRuntimeApi {
	/** Restart the Kanban runtime child process. */
	restart(): void;
}

/**
 * Lifecycle of a desktop self-update.
 *
 * `unsupported` is a first-class state rather than an error: a dev build or
 * an install the updater can't manage has nothing wrong with it, and the UI
 * should say so instead of showing a failure the user can't act on.
 */
export type DesktopUpdateStatus =
	| { readonly kind: "unsupported"; readonly reason: string }
	| { readonly kind: "idle" }
	| { readonly kind: "checking" }
	| { readonly kind: "up-to-date" }
	| { readonly kind: "available"; readonly version: string }
	| {
			readonly kind: "downloading";
			readonly version: string;
			readonly percent: number;
	  }
	| { readonly kind: "ready"; readonly version: string }
	| { readonly kind: "error"; readonly message: string };

export interface DesktopUpdatesApi {
	/** Current status. Resolves immediately — the host holds it in memory. */
	getStatus(): Promise<DesktopUpdateStatus>;
	/** Ask the host to check now. Progress arrives through `subscribe`. */
	check(): void;
	/**
	 * Quit and install a downloaded update. Only meaningful in the `ready`
	 * state; the host ignores it otherwise.
	 */
	install(): void;
	/** Returns an unsubscribe function. */
	subscribe(listener: (status: DesktopUpdateStatus) => void): () => void;
}

export interface DesktopNotificationRequest {
	/**
	 * Stable identity for the underlying event. Repeat deliveries of the same
	 * key are dropped by the host — the runtime re-emits ready-for-review
	 * state on reconnect, and a user returning from lunch should not get eight
	 * copies of the same notification.
	 */
	readonly key: string;
	readonly title: string;
	readonly body: string;
	/** Clicking the notification opens this task. Both or neither. */
	readonly projectId?: string;
	readonly taskId?: string;
}

export interface DesktopNotificationsApi {
	/**
	 * Post an OS notification. Fire-and-forget: the host decides whether it is
	 * a duplicate, or whether the app is already focused and the user has
	 * therefore seen the event.
	 */
	notify(request: DesktopNotificationRequest): void;
}

export interface DesktopPresenceCounts {
	/** Agent sessions currently working. */
	readonly running: number;
	/** Tasks finished and waiting on a human. */
	readonly readyForReview: number;
}

export interface DesktopPresenceApi {
	/**
	 * Report current activity so the host can drive the dock badge, tray and
	 * attention signals, and warn before a quit that would interrupt work.
	 *
	 * Push the full counts rather than deltas: a dropped or duplicated message
	 * then self-corrects on the next update instead of drifting permanently.
	 */
	setCounts(counts: DesktopPresenceCounts): void;
}

/**
 * An app action as the host needs to see it: enough to render a menu item,
 * and an id to send back when it is chosen. Handlers stay in the renderer,
 * which owns the domain logic.
 */
export interface DesktopMenuAction {
	readonly id: string;
	readonly label: string;
	/** Menu section. Actions sharing a group are rendered together. */
	readonly group: string;
	/** `react-hotkeys-hook` syntax; the host translates it. */
	readonly accelerator: string | null;
	readonly enabled: boolean;
}

export interface DesktopActionsApi {
	/**
	 * Replace the host's menu contents. Sends the full list rather than deltas
	 * so a dropped message self-corrects on the next publish.
	 */
	publish(actions: readonly DesktopMenuAction[]): void;
	/**
	 * Called when the user picks one of the published actions from the native
	 * menu. Returns an unsubscribe function.
	 */
	onInvoke(listener: (actionId: string) => void): () => void;
}

export interface DesktopDialogsApi {
	/**
	 * Show the OS folder picker. Resolves to the chosen absolute path, or
	 * `null` if the user cancelled.
	 *
	 * The runtime has its own picker that shells out to osascript / zenity /
	 * kdialog / PowerShell, which is the only option in a browser but fails
	 * outright on machines missing those binaries — a documented pain point on
	 * headless Linux. Inside the desktop host the native picker is always
	 * present, because Tauri links `rfd` rather than shelling out.
	 */
	pickDirectory(options?: { title?: string }): Promise<string | null>;
}

export interface DesktopApi extends DesktopBridgeHandshake {
	readonly windows: DesktopWindowsApi;
	readonly runtime: DesktopRuntimeApi;
	readonly updates: DesktopUpdatesApi;
	readonly notifications: DesktopNotificationsApi;
	readonly presence: DesktopPresenceApi;
	readonly actions: DesktopActionsApi;
	readonly dialogs: DesktopDialogsApi;
}

/**
 * Values the host hands the adapter when the window comes up. `platform` is
 * read from the host's own API, but these two are only knowable by the
 * process that owns the app bundle, so they ride in through the handshake.
 */
export interface DesktopBridgeBootstrap {
	readonly appVersion: string;
	readonly capabilities: readonly DesktopCapability[];
}

/** Command the adapter calls once, before exposing anything on `window`. */
export const DESKTOP_HANDSHAKE_COMMAND = "desktop_handshake";

/**
 * Validate a handshake payload coming across the host boundary.
 *
 * Parsing rather than casting matters here even though the host is our own
 * code: the renderer may be a different release than the host it is talking
 * to, and this is the function that decides whether the two are compatible at
 * all. A malformed payload yields `null`, which the adapter reads as "no
 * desktop bridge" and falls back to browser mode.
 */
export function parseBridgeBootstrap(
	payload: unknown,
): DesktopBridgeBootstrap | null {
	if (typeof payload !== "object" || payload === null) return null;

	const record = payload as Record<string, unknown>;
	if (typeof record.appVersion !== "string") return null;
	if (!Array.isArray(record.capabilities)) return null;

	return {
		appVersion: record.appVersion,
		// Drop anything this build doesn't recognise rather than failing the
		// whole handshake — a newer host advertising a capability we've never
		// heard of should still be usable for everything we *do* know.
		capabilities: record.capabilities.filter(isDesktopCapability),
	};
}
