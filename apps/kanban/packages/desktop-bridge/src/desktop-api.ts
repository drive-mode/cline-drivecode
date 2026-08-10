/**
 * Assembly of the `window.desktop` object from a host adapter.
 *
 * This replaces what used to be two files under Electron — a `preload.ts` that
 * built the exposed object and a `main-bridge.ts` that routed `ipcMain`
 * channels back to handlers. Tauri has no preload and no main-process router:
 * the renderer calls commands directly, gated by the capability manifest, so
 * the only thing left to write is the wiring, and it belongs on one side.
 *
 * What that buys is that every policy decision — update state transitions,
 * notification dedupe, badge rules — now runs in a plain module with no host
 * imports, which is why the controllers moved here wholesale rather than being
 * rewritten against Tauri APIs.
 *
 * Everything a host must supply is behind {@link DesktopHost}. Adapters are
 * expected to be thin: translate a call, nothing more.
 */

import {
	DESKTOP_BRIDGE_VERSION,
	type DesktopApi,
	type DesktopCapability,
	type DesktopMenuAction,
	type DesktopNotificationRequest,
	type DesktopPlatform,
	type DesktopPresenceCounts,
	type DesktopUpdateStatus,
} from "./contract.js";
import { buildDeepLinkTarget, type DeepLinkTarget } from "./deep-links.js";
import {
	menuActionsPayloadSchema,
	notifyPayloadSchema,
	openProjectWindowPayloadSchema,
	pickDirectoryPayloadSchema,
	presenceCountsPayloadSchema,
} from "./payload-schemas.js";
import {
	NotificationController,
	type NotificationBackend,
} from "./notifications/notification-controller.js";
import {
	PresenceController,
	type PresenceView,
} from "./presence/presence-controller.js";
import {
	resolveUpdateSupport,
	UpdateController,
	type UpdaterBackend,
} from "./updater/update-controller.js";

/**
 * Everything the bridge needs from whatever desktop host it is running in.
 *
 * A field being `null` is how a host says "I can't do this here" — a Linux
 * box with no notification daemon, a dev build with no updater. The
 * corresponding capability is then omitted from the handshake and the
 * matching namespace method becomes a no-op, which is the documented
 * degradation path in `contract.ts`.
 */
export interface DesktopHost {
	readonly platform: DesktopPlatform;
	readonly appVersion: string;
	/** Drives {@link resolveUpdateSupport}; false in `tauri dev`. */
	readonly isPackaged: boolean;

	/**
	 * Command-backed capabilities the host declares it implements.
	 *
	 * Split from the three below on whether presence can be *proven*. A host
	 * supplying an `updater` object has demonstrably got one; a host claiming
	 * `windows` has only asserted that a command exists on the other side of
	 * an IPC boundary, and nothing in TypeScript can check that.
	 *
	 * So these are declared rather than derived, and declaring one that isn't
	 * really there is the one way to turn a documented no-op into a call that
	 * fails. The Rust side keeps its list next to the commands it registers
	 * for exactly that reason.
	 */
	readonly declaredCapabilities: readonly DesktopCapability[];

	/** Open (or focus) a window for a project. */
	openProjectWindow(projectId: string): void;
	/** Restart the Kanban runtime child process. */
	restartRuntime(): void;
	/** Navigate the current window to a deep-link target. */
	reveal(target: DeepLinkTarget): void;
	/** Whether the app currently has focus, for notification suppression. */
	isAppFocused(): boolean;

	/** Native folder picker. Resolves to `null` when cancelled. */
	pickDirectory(options?: { title?: string }): Promise<string | null>;

	/** Replace the native menu's app-action section. */
	publishMenuActions(actions: readonly DesktopMenuAction[]): void;
	/** Fires when the user picks a published action. Returns an unsubscribe. */
	onMenuActionInvoked(listener: (actionId: string) => void): () => void;

	readonly updater: UpdaterBackend | null;
	readonly notifications: NotificationBackend | null;
	readonly presence: PresenceView | null;
}

function warnInvalidPayload(request: string, error: unknown): void {
	// A dropped message with no diagnostic is close to impossible to debug from
	// a packaged app, where the caller has no idea the bridge refused it.
	console.warn(
		`[desktop] Rejected malformed payload for ${request}:`,
		error instanceof Error ? error.message : error,
	);
}

/**
 * Resolve the notification's click target from its payload.
 *
 * Returns `undefined` for a notification with nowhere to go, which the
 * controller reads as "no click handler" rather than a failure — a
 * notification that only informs is legitimate.
 */
function notificationTarget(payload: {
	projectId?: string;
	taskId?: string;
}): DeepLinkTarget | undefined {
	if (!payload.projectId) return undefined;
	const route = payload.taskId
		? ({
				kind: "task",
				projectId: payload.projectId,
				taskId: payload.taskId,
			} as const)
		: ({ kind: "project", projectId: payload.projectId } as const);
	return buildDeepLinkTarget(route) ?? undefined;
}

export interface DesktopBridge {
	readonly api: DesktopApi;
	/**
	 * Release host resources. Called on window teardown so a reloaded renderer
	 * doesn't leave menu-action listeners stacked on the host.
	 */
	dispose(): void;
}

/**
 * Capabilities a host must declare, because no object it hands us proves
 * they work. The rest are derived from the backends it supplies.
 */
const COMMAND_BACKED_CAPABILITIES: readonly DesktopCapability[] = [
	"windows",
	"runtime",
	"dialogs",
	"actions",
];

export function createDesktopBridge(host: DesktopHost): DesktopBridge {
	// Intersected rather than trusted wholesale: a host declaring "updates"
	// here must still supply an updater, or the capability would advertise a
	// namespace backed by nothing.
	const capabilities: DesktopCapability[] = COMMAND_BACKED_CAPABILITIES.filter(
		(capability) => host.declaredCapabilities.includes(capability),
	);

	const updates = new UpdateController(
		host.updater,
		resolveUpdateSupport({ isPackaged: host.isPackaged }),
	);
	if (host.updater) capabilities.push("updates");

	const notifications = host.notifications
		? new NotificationController({
				backend: host.notifications,
				isAppFocused: () => host.isAppFocused(),
				reveal: (target) => host.reveal(target),
			})
		: null;
	if (notifications) capabilities.push("notifications");

	const presence = host.presence ? new PresenceController(host.presence) : null;
	if (presence) capabilities.push("presence");

	const has = (capability: DesktopCapability): boolean =>
		capabilities.includes(capability);

	const disposers: Array<() => void> = [];

	const api: DesktopApi = {
		bridgeVersion: DESKTOP_BRIDGE_VERSION,
		platform: host.platform,
		appVersion: host.appVersion,
		capabilities,

		windows: {
			openProject(projectId) {
				if (!has("windows")) return;
				const parsed = openProjectWindowPayloadSchema.safeParse({ projectId });
				if (!parsed.success) {
					warnInvalidPayload("windows.openProject", parsed.error);
					return;
				}
				host.openProjectWindow(parsed.data.projectId);
			},
		},

		runtime: {
			restart() {
				if (!has("runtime")) return;
				host.restartRuntime();
			},
		},

		updates: {
			// Async to match the contract even though the controller holds the
			// status in memory: a future out-of-process host must be able to
			// satisfy the same signature without a breaking change.
			getStatus(): Promise<DesktopUpdateStatus> {
				return Promise.resolve(updates.getStatus());
			},
			check() {
				updates.check();
			},
			install() {
				updates.install();
			},
			subscribe(listener) {
				return updates.subscribe(listener);
			},
		},

		notifications: {
			notify(request: DesktopNotificationRequest) {
				if (!notifications) return;
				const parsed = notifyPayloadSchema.safeParse(request);
				if (!parsed.success) {
					warnInvalidPayload("notifications.notify", parsed.error);
					return;
				}
				notifications.notify({
					key: parsed.data.key,
					title: parsed.data.title,
					body: parsed.data.body,
					target: notificationTarget(parsed.data),
				});
			},
		},

		presence: {
			setCounts(counts: DesktopPresenceCounts) {
				if (!presence) return;
				const parsed = presenceCountsPayloadSchema.safeParse(counts);
				if (!parsed.success) {
					warnInvalidPayload("presence.setCounts", parsed.error);
					return;
				}
				presence.update(parsed.data);
			},
		},

		actions: {
			publish(actions) {
				if (!has("actions")) return;
				const parsed = menuActionsPayloadSchema.safeParse(actions);
				if (!parsed.success) {
					warnInvalidPayload("actions.publish", parsed.error);
					return;
				}
				host.publishMenuActions(parsed.data);
			},
			onInvoke(listener) {
				// Returns a no-op unsubscribe rather than throwing, so a caller
				// can wire this unconditionally in an effect cleanup.
				if (!has("actions")) return () => {};
				const unsubscribe = host.onMenuActionInvoked(listener);
				disposers.push(unsubscribe);
				return unsubscribe;
			},
		},

		dialogs: {
			async pickDirectory(options) {
				if (!has("dialogs")) return null;
				const parsed = pickDirectoryPayloadSchema.safeParse(options);
				if (!parsed.success) {
					warnInvalidPayload("dialogs.pickDirectory", parsed.error);
					// Resolves rather than rejects: the caller treats null as "no
					// directory chosen", which is the right outcome for a rejected
					// request too.
					return null;
				}
				return host.pickDirectory(parsed.data);
			},
		},
	};

	return {
		api,
		dispose() {
			for (const dispose of disposers.splice(0)) {
				try {
					dispose();
				} catch (err) {
					console.warn(
						"[desktop] Bridge disposer threw:",
						err instanceof Error ? err.message : err,
					);
				}
			}
		},
	};
}
