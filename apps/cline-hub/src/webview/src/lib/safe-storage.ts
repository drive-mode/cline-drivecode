/**
 * Every `localStorage` read and write in the webview goes through here.
 *
 * A blocked store *throws* rather than returning null — Chrome under a
 * block-third-party-cookies policy, Safari private mode, and locked-down
 * enterprise profiles all raise `SecurityError` on plain property access. An
 * unguarded call during render therefore takes the whole app down to a blank
 * page, which is how a self-hosted tester experiences it: no error, no UI.
 *
 * Persisted webview state is preference data, never correctness data, so the
 * degraded mode is simply session-only: reads report "nothing stored" and
 * writes are dropped.
 */

export function readStoredValue(key: string): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeStoredValue(key: string, value: string): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// Best-effort: the preference stays in memory for this session only.
	}
}
