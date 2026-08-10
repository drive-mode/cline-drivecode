/**
 * The one file allowed to import `@tauri-apps/api`.
 *
 * Same boundary discipline as `src/cline-sdk/` in the Kanban runtime: keeping
 * a third-party surface behind a single module is what turned a 34-version
 * SDK scope migration into an eight-file change. A Tauri major upgrade should
 * land here and nowhere else.
 */

import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

import {
	USER_ATTENTION_CRITICAL,
	USER_ATTENTION_INFORMATIONAL,
	type TauriSurface,
	type TauriWindowSurface,
	type UserAttentionLevel,
} from "./tauri-surface.js";

/**
 * Translate our numeric level back to Tauri's enum.
 *
 * The two are the same numbers today — pinned by a test — but going through
 * an explicit switch means a future enum reordering upstream fails to compile
 * here rather than silently bouncing the dock at the wrong urgency.
 */
function toUserAttentionType(
	level: UserAttentionLevel | null,
): UserAttentionType | null {
	switch (level) {
		case USER_ATTENTION_CRITICAL:
			return UserAttentionType.Critical;
		case USER_ATTENTION_INFORMATIONAL:
			return UserAttentionType.Informational;
		default:
			return null;
	}
}

function realWindow(): TauriWindowSurface {
	const window = getCurrentWindow();
	return {
		setBadgeCount: (count) => window.setBadgeCount(count),
		requestUserAttention: (level) =>
			window.requestUserAttention(toUserAttentionType(level)),
		isFocused: () => window.isFocused(),
		onFocusChanged: (handler) => window.onFocusChanged(handler),
		setFocus: () => window.setFocus(),
		show: () => window.show(),
		unminimize: () => window.unminimize(),
	};
}

export function createRealTauriSurface(): TauriSurface {
	return {
		isTauri,
		invoke: (command, args) => invoke(command, args),
		getVersion,
		currentWindow: realWindow,
		listen: (event, handler) => listen(event, handler),
	};
}
