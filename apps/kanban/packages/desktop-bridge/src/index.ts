/**
 * Host-agnostic desktop bridge for Kanban.
 *
 * Everything here runs identically in a Tauri window, in a unit test, and in
 * a browser tab that has no desktop host at all. Host-specific code lives in
 * the adapter that implements {@link DesktopHost}, which is the only place
 * `@tauri-apps/api` is allowed to appear.
 */

export * from "./contract.js";
export * from "./deep-links.js";
export * from "./desktop-api.js";
export * from "./payload-schemas.js";
export * from "./notifications/notification-controller.js";
export * from "./presence/presence-controller.js";
export * from "./shortcuts/global-shortcuts.js";
export * from "./updater/update-controller.js";
