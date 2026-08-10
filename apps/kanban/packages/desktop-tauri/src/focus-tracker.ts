/**
 * Cached window-focus state.
 *
 * The bridge's `isAppFocused()` is synchronous — the notification controller
 * calls it in the middle of deciding whether to post, and an await there would
 * turn a pure policy function into an async one for every consumer. Tauri only
 * offers `isFocused(): Promise<boolean>`, so the gap is closed by subscribing
 * once and caching.
 *
 * The initial value is `false` rather than `true`: before the first answer
 * arrives, assuming unfocused means a notification gets shown. Assuming
 * focused would swallow it, and a swallowed "your agent finished" is the one
 * failure this whole feature exists to prevent.
 */

import type { TauriWindowSurface, UnlistenFn } from "./tauri-surface.js";

export interface FocusTracker {
	isFocused(): boolean;
	dispose(): void;
}

export function createFocusTracker(window: TauriWindowSurface): FocusTracker {
	let focused = false;
	let disposed = false;
	let unlisten: UnlistenFn | null = null;

	window
		.isFocused()
		.then((value) => {
			// A dispose() that lands before this resolves must not revive the
			// tracker with a stale reading.
			if (!disposed) focused = value;
		})
		.catch(() => {
			// Staying with `false` is the safe default; see the module comment.
		});

	window
		.onFocusChanged((event) => {
			if (!disposed) focused = event.payload;
		})
		.then((fn) => {
			if (disposed) {
				fn();
				return;
			}
			unlisten = fn;
		})
		.catch(() => {
			// Without focus events every notification ships, which is noisier
			// than ideal but never silent.
		});

	return {
		isFocused: () => focused,
		dispose() {
			disposed = true;
			unlisten?.();
			unlisten = null;
		},
	};
}
