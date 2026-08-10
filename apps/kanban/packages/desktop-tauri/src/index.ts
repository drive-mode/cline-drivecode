/**
 * Tauri host adapter for Kanban's desktop bridge.
 *
 * The only package in the Kanban tree that imports `@tauri-apps/api`, and even
 * then only through `real-surface.ts`. Everything else consumes the
 * host-agnostic `@kanban/desktop-bridge`.
 */

export * from "./commands.js";
export * from "./focus-tracker.js";
export * from "./presence-view.js";
export * from "./real-surface.js";
export * from "./tauri-host.js";
export * from "./tauri-surface.js";
