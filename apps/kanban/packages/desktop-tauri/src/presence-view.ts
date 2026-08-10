/**
 * Tauri implementation of the bridge's `PresenceView`.
 *
 * Every method here is synchronous by contract and asynchronous in Tauri, so
 * each call is fire-and-forget with the rejection swallowed. That is
 * deliberate rather than lazy: the badge is an ambient hint, and a window torn
 * down mid-update rejects these promises routinely. Surfacing that as an
 * unhandled rejection would fill the console with noise about something no
 * user can perceive and no caller can act on.
 */

import type { PresenceView } from "@kanban/desktop-bridge";

import { CMD_SET_TRAY_SUMMARY, CMD_SET_WAKE_LOCK } from "./commands.js";
import {
	USER_ATTENTION_INFORMATIONAL,
	type TauriSurface,
	type TauriWindowSurface,
} from "./tauri-surface.js";

export interface TauriPresenceOptions {
	surface: TauriSurface;
	window: TauriWindowSurface;
	/**
	 * Whether the host implements the tray-summary command. A build without a
	 * tray still wants the badge, so this degrades per-signal rather than
	 * dropping presence support wholesale.
	 */
	hasTray: boolean;
}

/**
 * Backoff between wake-lock attempts. Short enough that a transient failure is
 * corrected long before an idle timer could fire, few enough that a host which
 * genuinely cannot acquire one — a headless box with no session bus — settles
 * into a single warning rather than retrying forever.
 */
const WAKE_LOCK_RETRY_DELAYS_MS = [250, 1_000, 3_000];

export function createTauriPresenceView(
	opts: TauriPresenceOptions,
): PresenceView {
	// Distinguishes "this attempt is still the current intent" from "a newer
	// call has superseded it", so a release arriving mid-retry wins instead of
	// being overwritten by a retry of the acquire it replaced.
	let wakeLockGeneration = 0;

	async function assertWakeLock(active: boolean): Promise<void> {
		const generation = ++wakeLockGeneration;
		for (let attempt = 0; ; attempt += 1) {
			try {
				await opts.surface.invoke(CMD_SET_WAKE_LOCK, { active });
				return;
			} catch (err: unknown) {
				if (generation !== wakeLockGeneration) return;
				if (attempt >= WAKE_LOCK_RETRY_DELAYS_MS.length) {
					console.warn(
						`[desktop] Failed to ${active ? "acquire" : "release"} the wake lock:`,
						err instanceof Error ? err.message : err,
					);
					return;
				}
				await new Promise((resolve) =>
					setTimeout(resolve, WAKE_LOCK_RETRY_DELAYS_MS[attempt]),
				);
				if (generation !== wakeLockGeneration) return;
			}
		}
	}

	return {
		setBadgeCount(count) {
			// Tauri clears the badge for 0 and undefined alike; passing
			// undefined explicitly is the documented "clear it" spelling.
			void opts.window.setBadgeCount(count > 0 ? count : undefined).catch(
				() => {},
			);
		},
		requestAttention() {
			// Informational, not Critical: on macOS this bounces the dock once
			// instead of bouncing until focused. The controller already fires
			// only on an increase, and a permanent bounce for a queue the user
			// has decided to leave alone is the behaviour that trains people to
			// move the app to another Space.
			void opts.window
				.requestUserAttention(USER_ATTENTION_INFORMATIONAL)
				.catch(() => {});
		},
		setSummary(summary) {
			if (!opts.hasTray) return;
			void opts.surface
				.invoke(CMD_SET_TRAY_SUMMARY, { summary })
				.catch(() => {});
		},
		setWorkInFlight(active) {
			// Neither swallowed nor attempted once. A badge that fails to update
			// is cosmetic; a wake lock that fails to take means the machine
			// suspends mid-run.
			//
			// Retrying is the part that matters. Presence is edge-triggered by
			// design — the controller calls this only when the in-flight count
			// crosses zero — so a single failed acquire is never revisited while
			// the agents that needed it keep running. The bookkeeping goes on
			// insisting work is in flight, nothing re-asserts, and the machine
			// sleeps anyway. The edge-triggering is right for a syscall we do
			// not want on every board refresh; the missing piece was making a
			// failed edge try again rather than be lost.
			void assertWakeLock(active);
		},
	};
}
