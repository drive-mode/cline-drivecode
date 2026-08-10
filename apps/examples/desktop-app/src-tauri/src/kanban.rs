//! Host commands backing Kanban's desktop bridge.
//!
//! The TypeScript side lives in `apps/kanban/packages/desktop-tauri`, whose
//! `commands.ts` declares the same names this module registers. A mismatch
//! there fails at runtime with "command not found" inside a packaged app, so
//! the two lists are meant to be read side by side.
//!
//! ## Why the capability list is short
//!
//! `kanban_handshake` advertises only what this host can do today, and every
//! entry has a reachable path end to end. Two are deliberately absent:
//!
//! - `actions` — no native menu carries Kanban's published actions yet, so
//!   there is no way for one to be invoked.
//! - `updates` / `notifications` — those need Tauri plugins this build does
//!   not link.
//!
//! Sleep prevention is not a bridge capability and needs no entry: it hangs
//! off `presence`, which the host already advertises. The bridge signals it
//! when the in-flight count crosses zero.
//!
//! `tray` is absent for a different and more interesting reason: this app's
//! tray already has a "N sessions running" item that Cline's own
//! `set_tray_status` owns. Kanban's presence summary is the same *kind* of
//! information about a different subsystem, and letting both write that one
//! slot would make the tray show whichever wrote last. That needs a decision
//! about what a merged tray says, not a silent race — so until then Kanban's
//! presence drives the dock badge and attention signal only, which are
//! per-window and conflict with nothing.
//!
//! The bridge turns every absent capability into a documented no-op, so
//! nothing here fails loudly at the user. Adding one means implementing the
//! host command first and extending `CAPABILITIES` second — never the
//! reverse, which would turn a documented no-op into a call that fails.

use serde::Serialize;

/// A subset of `DESKTOP_CAPABILITIES` in the bridge contract. Presence needs
/// no command of its own: the dock badge and attention request are window
/// APIs the adapter reaches directly.
///
/// `runtime` and `windows` are absent until the commands behind them exist —
/// this host does not supervise Kanban's runtime yet. Advertising either here
/// would turn a documented no-op into a call that fails.
const CAPABILITIES: &[&str] = &["dialogs", "presence"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanHandshake {
    app_version: String,
    platform: String,
    capabilities: Vec<String>,
    is_packaged: bool,
}

#[tauri::command]
pub fn kanban_handshake(app: tauri::AppHandle) -> KanbanHandshake {
    KanbanHandshake {
        app_version: app.package_info().version.to_string(),
        // Rust's spelling — `macos` / `windows` / `linux`. `toDesktopPlatform`
        // on the TypeScript side normalises it onto the Node spelling
        // (`darwin` / `win32`) that the web UI branches on.
        platform: std::env::consts::OS.to_string(),
        capabilities: CAPABILITIES.iter().map(|name| name.to_string()).collect(),
        // A dev run has no bundle to replace, which is what makes the updater
        // report `unsupported` instead of failing a check the user can't fix.
        is_packaged: !tauri::is_dev(),
    }
}

/// Native folder picker.
///
/// Kanban's runtime has its own picker that shells out to osascript / zenity /
/// kdialog / PowerShell — the only option in a browser, but a documented
/// failure on headless Linux boxes missing those binaries. `rfd` is linked
/// into the binary, so inside the desktop host the picker is always present.
#[tauri::command]
pub fn kanban_pick_directory(title: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(title) = title.as_deref().filter(|value| !value.is_empty()) {
        dialog = dialog.set_title(title);
    }
    dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_only_capabilities_the_bridge_contract_defines() {
        // `DESKTOP_CAPABILITIES` in contract.ts is the source of truth. An
        // entry here that the contract doesn't know is dropped by
        // `parseBridgeBootstrap`'s filter, which would look like the feature
        // silently not working.
        const CONTRACT: &[&str] = &[
            "windows",
            "runtime",
            "updates",
            "notifications",
            "presence",
            "actions",
            "dialogs",
        ];

        for capability in CAPABILITIES {
            assert!(
                CONTRACT.contains(capability),
                "{capability} is not in the bridge contract"
            );
        }
    }

    #[test]
    fn does_not_advertise_capabilities_without_a_reachable_path() {
        // Each of these needs host work that does not exist yet; advertising
        // one would turn a documented no-op into a call that fails.
        //
        // `runtime` and `windows` are listed because this host registers no
        // command behind them yet. They leave this list in the same change
        // that adds `kanban_runtime_endpoint`, `kanban_restart_runtime` and
        // `kanban_open_project_window` — never before it.
        for absent in ["actions", "updates", "notifications", "runtime", "windows"] {
            assert!(
                !CAPABILITIES.contains(&absent),
                "{absent} is advertised but has no host implementation"
            );
        }
    }
}
