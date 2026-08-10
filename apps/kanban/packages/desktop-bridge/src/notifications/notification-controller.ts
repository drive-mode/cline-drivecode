/**
 * Native OS notifications for agent events.
 *
 * Kept free of host imports behind a `NotificationBackend` so the policy —
 * dedupe, suppression while focused, click routing — is testable without a
 * desktop runtime.
 *
 * Why this exists at all: the "your agent finished" signal is the single most
 * important event in the product, and in browser mode it rides the renderer's
 * web `Notification` API behind a permission prompt. That makes the one thing
 * a user tabs away waiting for the least reliable part of the app.
 */

import type { DeepLinkTarget } from "../deep-links.js";

/**
 * The controller's own request shape.
 *
 * Distinct from the contract's `DesktopNotificationRequest`, which carries a
 * raw `projectId` / `taskId` pair straight off the wire: by the time a request
 * reaches here it has been validated and its click destination already
 * resolved to a `DeepLinkTarget`, so this layer never has to know how the web
 * UI addresses a task.
 */
export interface NotificationRequest {
	/**
	 * Stable identity for the underlying event. Repeat deliveries of the same
	 * key are dropped — the runtime re-emits ready-for-review state on
	 * reconnect, and a user returning from lunch should not get eight copies
	 * of the same notification.
	 */
	key: string;
	title: string;
	body: string;
	/** Where clicking the notification should take the user. */
	target?: DeepLinkTarget;
}

export interface NotificationHandle {
	show(): void;
	onClick(listener: () => void): void;
}

export interface NotificationBackend {
	isSupported(): boolean;
	create(input: { title: string; body: string }): NotificationHandle;
}

export interface NotificationControllerOptions {
	backend: NotificationBackend;
	/**
	 * Whether the user is already looking at the app. A notification for
	 * something visible on screen is noise, so these are dropped.
	 */
	isAppFocused: () => boolean;
	reveal: (target: DeepLinkTarget) => void;
}

/**
 * Bounds the dedupe set. Without a cap this grows for the lifetime of the
 * process, and this app is built for sessions measured in days.
 */
const MAX_REMEMBERED_KEYS = 500;

export class NotificationController {
	private readonly seen = new Set<string>();

	constructor(private readonly opts: NotificationControllerOptions) {}

	notify(request: NotificationRequest): boolean {
		if (!this.opts.backend.isSupported()) return false;
		if (this.seen.has(request.key)) return false;

		this.remember(request.key);

		// Checked after the dedupe bookkeeping: an event the user saw happen
		// in-app is still "handled", and re-notifying about it the moment they
		// switch away would be worse than staying quiet.
		if (this.opts.isAppFocused()) return false;

		let handle: NotificationHandle;
		try {
			handle = this.opts.backend.create({
				title: request.title,
				body: request.body,
			});
		} catch (err) {
			// Notification construction can fail on a Linux box with no
			// notification daemon. Never let that take down the caller.
			console.warn(
				"[desktop] Failed to create notification:",
				err instanceof Error ? err.message : err,
			);
			return false;
		}

		const target = request.target;
		if (target) {
			handle.onClick(() => this.opts.reveal(target));
		}

		try {
			handle.show();
		} catch (err) {
			console.warn(
				"[desktop] Failed to show notification:",
				err instanceof Error ? err.message : err,
			);
			return false;
		}
		return true;
	}

	private remember(key: string): void {
		this.seen.add(key);
		if (this.seen.size <= MAX_REMEMBERED_KEYS) return;
		// Sets iterate in insertion order, so this evicts oldest-first.
		const oldest = this.seen.values().next();
		if (!oldest.done) this.seen.delete(oldest.value);
	}
}
