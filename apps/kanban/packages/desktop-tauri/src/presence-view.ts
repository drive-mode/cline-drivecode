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

import { CMD_SET_TRAY_SUMMARY } from "./commands.js";
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

export function createTauriPresenceView(
	opts: TauriPresenceOptions,
): PresenceView {
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
	};
}
