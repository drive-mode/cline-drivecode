/**
 * The exact slice of `@tauri-apps/api` this adapter uses.
 *
 * Declaring it as a port rather than importing the modules directly at each
 * call site buys two things. Tests get a plain object instead of a mocked
 * module graph — which matters because AGENTS.md rules out the dynamic
 * imports that module mocking usually leans on. And the surface area we
 * depend on becomes a list you can read in twenty seconds, so a Tauri upgrade
 * has one file to diff against the changelog instead of a grep.
 *
 * `real-surface.ts` is the only place the real modules are imported.
 */

/**
 * Mirrors Tauri's `UserAttentionType`. Redeclared as a numeric union rather
 * than imported because the real enum is a runtime value: importing it would
 * drag `@tauri-apps/api` into every consumer of this file, including the
 * tests, which is the coupling the port exists to avoid. The values are
 * pinned by a test against the real enum.
 */
export const USER_ATTENTION_CRITICAL = 1;
export const USER_ATTENTION_INFORMATIONAL = 2;

export type UserAttentionLevel =
	| typeof USER_ATTENTION_CRITICAL
	| typeof USER_ATTENTION_INFORMATIONAL;

export type UnlistenFn = () => void;

export interface TauriWindowSurface {
	/** `undefined` clears the badge; Tauri treats 0 and undefined alike. */
	setBadgeCount(count?: number): Promise<void>;
	requestUserAttention(level: UserAttentionLevel | null): Promise<void>;
	isFocused(): Promise<boolean>;
	onFocusChanged(
		handler: (event: { payload: boolean }) => void,
	): Promise<UnlistenFn>;
	setFocus(): Promise<void>;
	show(): Promise<void>;
	unminimize(): Promise<void>;
}

export interface TauriSurface {
	/** False in a plain browser tab, which is how the adapter bows out. */
	isTauri(): boolean;
	invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
	getVersion(): Promise<string>;
	currentWindow(): TauriWindowSurface;
	listen<T>(
		event: string,
		handler: (event: { payload: T }) => void,
	): Promise<UnlistenFn>;
}
