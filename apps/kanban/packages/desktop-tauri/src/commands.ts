/**
 * Command and event names shared with the Rust host.
 *
 * Kept in one file because they are a contract with code TypeScript cannot
 * see: a typo here fails at runtime with `command not found`, in a packaged
 * app, on someone else's machine. The Rust side declares the same literals,
 * and `src-tauri/src/kanban.rs` carries the matching list.
 *
 * ## Not every name here is registered yet
 *
 * `kanban.rs` currently registers only `kanban_handshake` and
 * `kanban_pick_directory`. The rest are declared here because the adapter
 * implements them and the host will grow them — but nothing calls an
 * unregistered one, because the handshake omits its capability and the bridge
 * turns the whole namespace into a no-op. That is the capability model doing
 * its job: the constant existing is not a claim that the command does.
 *
 * The order to add one is host first, then `CAPABILITIES` in `kanban.rs` —
 * never the reverse, or the bridge will start making calls that fail.
 */

/** Handshake. Returns {@link KanbanHandshakePayload}. */
export const CMD_HANDSHAKE = "kanban_handshake";

/** Open (or focus) a window for a project. */
export const CMD_OPEN_PROJECT_WINDOW = "kanban_open_project_window";

/** Restart the Kanban runtime child process. */
export const CMD_RESTART_RUNTIME = "kanban_restart_runtime";

/** Native folder picker. Returns the chosen path or null. */
export const CMD_PICK_DIRECTORY = "kanban_pick_directory";

/** Replace the app-actions section of the native menu. */
export const CMD_PUBLISH_MENU_ACTIONS = "kanban_publish_menu_actions";

/** One-line presence summary for the tray tooltip. */
export const CMD_SET_TRAY_SUMMARY = "kanban_set_tray_summary";

/** Host → renderer: the user picked a published menu action. */
export const EVENT_MENU_ACTION_INVOKED = "kanban://menu-action-invoked";

/** Host → renderer: a `kanban://` deep link arrived while running. */
export const EVENT_DEEP_LINK = "kanban://deep-link";

/**
 * Shape the host returns from {@link CMD_HANDSHAKE}.
 *
 * `platform` uses Rust's `std::env::consts::OS` spelling (`macos`, `windows`,
 * `linux`), which `toDesktopPlatform` normalises. Reading it from the host
 * rather than a JS API is what lets this package avoid depending on
 * `@tauri-apps/plugin-os` for one string.
 */
export interface KanbanHandshakePayload {
	appVersion: string;
	platform: string;
	capabilities: string[];
	/** False under `tauri dev`; gates the updater. */
	isPackaged: boolean;
}
