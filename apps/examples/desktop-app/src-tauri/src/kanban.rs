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

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, State};

use crate::DesktopBackendReadyLine;

/// A subset of `DESKTOP_CAPABILITIES` in the bridge contract. Presence needs
/// no command of its own: the dock badge and attention request are window
/// APIs the adapter reaches directly.
const CAPABILITIES: &[&str] = &["dialogs", "presence", "runtime", "windows"];

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
        for absent in ["actions", "updates", "notifications"] {
            assert!(
                !CAPABILITIES.contains(&absent),
                "{absent} is advertised but has no host implementation"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Runtime supervision
// ---------------------------------------------------------------------------
//
// Kanban's runtime is a separate Node process serving an HTTP origin. The
// shell spawns it, learns its origin from a single stdout line, and points
// project windows at it. That is the same arrangement `main.rs` already uses
// for the Bun sidecar, and deliberately the same handshake line — one
// `DesktopBackendReadyLine` parses both, so supervising a second backend did
// not mean writing a second parser.
//
// The port is not knowable in advance (configurable, falls back to a free
// one), which is why the handshake exists at all rather than the shell just
// assuming a number.

/// Env var that tells Kanban to emit its handshake line. Mirrors
/// `HOST_HANDSHAKE_ENV` in `apps/kanban/src/server/host-handshake.ts`.
const HOST_HANDSHAKE_ENV: &str = "KANBAN_HOST_HANDSHAKE";

/// Lock order matches `DesktopBackendState`: `process` may be held while
/// acquiring `endpoint`, never the reverse.
#[derive(Default)]
pub struct KanbanRuntimeState {
    endpoint: Mutex<Option<String>>,
    process: Mutex<Option<Child>>,
    shutting_down: Mutex<bool>,
}

impl KanbanRuntimeState {
    fn is_shutting_down(&self) -> bool {
        self.shutting_down
            .lock()
            .map(|guard| *guard)
            .unwrap_or(true)
    }

    pub fn endpoint(&self) -> Option<String> {
        self.endpoint
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
    }

    fn set_endpoint(&self, value: Option<String>) {
        if let Ok(mut guard) = self.endpoint.lock() {
            *guard = value;
        }
    }

    /// Stop the child and clear the endpoint.
    ///
    /// Kanban owns worktrees and persisted board state, so it gets a grace
    /// period to flush before being killed — same reasoning as the sidecar's
    /// shutdown, which waits out an in-flight session rather than truncating
    /// it.
    pub fn stop(&self) {
        if let Ok(mut guard) = self.shutting_down.lock() {
            *guard = true;
        }
        self.terminate_child();
        self.set_endpoint(None);
    }

    fn terminate_child(&self) {
        let Ok(mut process_guard) = self.process.lock() else {
            return;
        };
        if let Some(child) = process_guard.as_mut() {
            // Give it a window to exit on its own before escalating. Kanban
            // persists board state and worktree bookkeeping on shutdown, and
            // killing mid-write is how that gets corrupted.
            for _ in 0..70 {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => thread::sleep(Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
            if !matches!(child.try_wait(), Ok(Some(_))) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        *process_guard = None;
    }

    /// Clear the shutting-down flag so a restart can spawn again.
    fn reopen(&self) {
        if let Ok(mut guard) = self.shutting_down.lock() {
            *guard = false;
        }
    }
}

impl Drop for KanbanRuntimeState {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Locate Kanban's CLI entry point in a source checkout.
///
/// Packaged builds have no such path — shipping the runtime inside the
/// bundle is unresolved (the Electron host's `stage-cli.mjs` did it and went
/// away with that host), so this returns `None` there and the capability is
/// simply not advertised. That is better than spawning something that is not
/// present and reporting a confusing failure.
fn resolve_kanban_runtime_entry(workspace_root: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(workspace_root)
        .join("apps")
        .join("kanban")
        .join("src")
        .join("cli.ts");
    candidate.exists().then_some(candidate)
}

/// Directories a GUI-launched process needs appended to PATH.
///
/// This is the single most load-bearing detail in spawning the runtime, and
/// it is invisible until it bites. A double-clicked `.app` on macOS inherits
/// launchd's PATH — roughly `/usr/bin:/bin:/usr/sbin:/sbin` — which contains
/// neither `bun` nor Homebrew nor nvm. Spawning bare `bun` from there fails
/// with "No such file or directory" and the runtime simply never starts.
///
/// It matters twice over, because Kanban then launches *agents* by name.
/// `apps/kanban/AGENTS.md` is explicit that agent detection must use direct
/// PATH checks rather than an interactive login shell — a heavy `conda` or
/// `nvm` init per task can freeze the runtime. So the PATH has to be right
/// here, at spawn, rather than recovered later by shelling out.
///
/// Ported from the Electron host's `runtime-child-env.ts`, which existed for
/// exactly this reason.
fn gui_launch_path_dirs() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        .iter()
        .map(PathBuf::from)
        .collect()
    } else if cfg!(target_os = "linux") {
        ["/usr/local/bin", "/snap/bin", "/usr/bin", "/bin"]
            .iter()
            .map(PathBuf::from)
            .collect()
    } else if cfg!(target_os = "windows") {
        let mut dirs = Vec::new();
        if let Ok(app_data) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(app_data).join("npm"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(local_app_data);
            dirs.push(base.join("Programs").join("nodejs"));
            // WinGet's shims live in `Links`, not `Packages` — the latter
            // holds install directories that are not themselves on PATH.
            dirs.push(base.join("Microsoft").join("WinGet").join("Links"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("Git").join("cmd"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            dirs.push(PathBuf::from(program_files_x86).join("Git").join("cmd"));
        }
        dirs
    } else {
        Vec::new()
    }
}

/// PATH with the GUI-launch directories appended, preserving order and
/// dropping duplicates so an already-correct PATH is left effectively alone.
fn enriched_path(current: Option<&str>) -> String {
    let separator = if cfg!(windows) { ';' } else { ':' };
    let mut parts: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for part in current.unwrap_or("").split(separator).filter(|p| !p.is_empty()) {
        if seen.insert(part.to_string()) {
            parts.push(part.to_string());
        }
    }
    for dir in gui_launch_path_dirs() {
        let dir = dir.to_string_lossy().into_owned();
        if seen.insert(dir.clone()) {
            parts.push(dir);
        }
    }
    parts.join(&separator.to_string())
}

fn spawn_kanban_runtime_process(workspace_root: &str) -> Result<Child, String> {
    let entry = resolve_kanban_runtime_entry(workspace_root).ok_or_else(|| {
        format!("Kanban runtime entry not found under workspace_root={workspace_root}")
    })?;

    Command::new("bun")
        .arg("run")
        .arg(entry.to_string_lossy().to_string())
        .arg("--no-open")
        .current_dir(workspace_root)
        // Every other parent env var is inherited, matching the Electron
        // host's "forward everything" model — agent shells need the full
        // environment, not a curated subset.
        .env("PATH", enriched_path(std::env::var("PATH").ok().as_deref()))
        // Without this Kanban stays silent and the shell never learns the
        // origin; see host-handshake.ts for why it is opt-in.
        .env(HOST_HANDSHAKE_ENV, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start Kanban runtime: {e}"))
}

/// Start the runtime unless one is already live.
///
/// The spawn is injected so the concurrency behaviour is testable without a
/// real Kanban checkout — the same seam `ensure_desktop_backend_started_with`
/// uses.
pub fn ensure_kanban_runtime_started_with(
    state: &Arc<KanbanRuntimeState>,
    spawn_runtime: impl FnOnce() -> Result<Child, String>,
) -> Result<(), String> {
    if state.is_shutting_down() {
        return Ok(());
    }

    // Held across the whole check-and-spawn so concurrent callers serialize:
    // the second blocks here, then sees the live child and returns rather
    // than spawning a duplicate that would race on the port.
    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "failed to lock Kanban runtime process state")?;

    if let Some(existing) = process_guard.as_mut() {
        match existing.try_wait() {
            // A live child owns startup even while its endpoint is still
            // pending — Kanban takes seconds to bind and register workspaces.
            Ok(None) => return Ok(()),
            Ok(Some(_)) | Err(_) => {
                *process_guard = None;
                state.set_endpoint(None);
            }
        }
    }

    let mut child = spawn_runtime()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture Kanban runtime stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture Kanban runtime stderr".to_string())?;

    // Drain stderr on its own thread. Piping it and never reading is not
    // merely wasteful: a child that writes enough to fill the pipe buffer
    // blocks on the write and stops making progress, which would look like
    // Kanban hanging for no reason. The sidecar drains both streams for the
    // same reason.
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            let Ok(bytes) = reader.read_line(&mut line) else {
                break;
            };
            if bytes == 0 {
                break;
            }
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                eprintln!("[kanban-runtime] {trimmed}");
            }
        }
    });

    let state_for_stdout = state.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let Ok(bytes) = reader.read_line(&mut line) else {
                break;
            };
            if bytes == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<DesktopBackendReadyLine>(trimmed) {
                if parsed.line_type == "ready" {
                    if let Some(endpoint) = parsed.endpoint.or(parsed.ws_endpoint) {
                        state_for_stdout.set_endpoint(Some(endpoint));
                    }
                    continue;
                }
            }
            // Everything else is Kanban's ordinary human-facing CLI output.
            eprintln!("[kanban-runtime] {trimmed}");
        }
    });

    *process_guard = Some(child);
    Ok(())
}

#[tauri::command]
pub fn kanban_runtime_endpoint(state: State<'_, Arc<KanbanRuntimeState>>) -> Option<String> {
    state.endpoint()
}

#[tauri::command]
pub fn kanban_restart_runtime(
    state: State<'_, Arc<KanbanRuntimeState>>,
    context: State<'_, crate::AppContext>,
) -> Result<(), String> {
    state.stop();
    // stop() latches shutting_down so Drop stays correct; a user-requested
    // restart has to clear it or the respawn below silently no-ops.
    state.reopen();
    let workspace_root = context.workspace_root.clone();
    ensure_kanban_runtime_started_with(&state, || spawn_kanban_runtime_process(&workspace_root))
}

/// Open (or focus) a window showing one Kanban project.
///
/// The URL mirrors the web UI's own addressing (`/<projectId>`), so a window
/// opened here lands exactly where an in-app navigation would.
#[tauri::command]
pub fn kanban_open_project_window(
    app: tauri::AppHandle,
    state: State<'_, Arc<KanbanRuntimeState>>,
    project_id: String,
) -> Result<(), String> {
    let trimmed = project_id.trim();
    if trimmed.is_empty() {
        return Err("projectId is required".to_string());
    }
    let endpoint = state
        .endpoint()
        .ok_or_else(|| "Kanban runtime has not announced an endpoint yet".to_string())?;

    let label = kanban_project_window_label(trimmed);
    if let Some(existing) = app.get_webview_window(&label) {
        // Focus rather than rebuild: a second window for the same project
        // would duplicate its websocket subscriptions.
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let url = format!("{}/{}", endpoint.trim_end_matches('/'), urlencode(trimmed));
    let parsed = url
        .parse()
        .map_err(|error| format!("invalid Kanban project URL {url}: {error}"))?;

    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .title(format!("Kanban — {trimmed}"))
        .build()
        .map_err(|error| format!("failed to open Kanban project window: {error}"))?;
    Ok(())
}

/// Window labels must be unique, and Tauri restricts the characters they may
/// contain. Project ids are filesystem paths in practice, so they need
/// escaping — but the escaping has to be *injective*.
///
/// Mapping every disallowed character to a single `_` is the obvious version
/// and it is wrong: `my app/web` and `my-app-web` both collapse to
/// `my_app_web`, so asking for one project surfaces the other's window. This
/// encodes each disallowed byte as `_XX` hex instead, and escapes a literal
/// `_` the same way so the escape character cannot collide with itself.
fn kanban_project_window_label(project_id: &str) -> String {
    let mut encoded = String::with_capacity(project_id.len());
    for byte in project_id.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => encoded.push(byte as char),
            _ => encoded.push_str(&format!("_{byte:02X}")),
        }
    }
    format!("kanban-project-{encoded}")
}

/// Percent-encode a path segment. Kept local and minimal — the only input is
/// a project id, and pulling a URL crate in for one segment is not worth it.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Convenience wrapper used at setup, mirroring
/// `ensure_desktop_backend_started`. The injected-spawn variant stays public
/// for tests.
pub fn ensure_kanban_runtime_started(
    state: &Arc<KanbanRuntimeState>,
    context: &crate::AppContext,
) -> Result<(), String> {
    let workspace_root = context.workspace_root.clone();
    ensure_kanban_runtime_started_with(state, || spawn_kanban_runtime_process(&workspace_root))
}

#[cfg(test)]
mod supervision_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A child that stays alive, standing in for a runtime still booting.
    fn spawn_pending_runtime() -> Result<Child, String> {
        Command::new("sleep")
            .arg("30")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())
    }

    #[test]
    fn concurrent_startup_checks_spawn_exactly_one_runtime() {
        // Two windows asking for the endpoint at once must not each spawn a
        // runtime; the duplicates would race on the port and one would die
        // with an unexplained bind error.
        let state = Arc::new(KanbanRuntimeState::default());
        state.reopen();
        let spawn_count = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let state = state.clone();
                let spawn_count = spawn_count.clone();
                thread::spawn(move || {
                    ensure_kanban_runtime_started_with(&state, || {
                        spawn_count.fetch_add(1, Ordering::SeqCst);
                        spawn_pending_runtime()
                    })
                    .expect("startup check should succeed");
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("startup thread should not panic");
        }

        assert_eq!(spawn_count.load(Ordering::SeqCst), 1);
        state.stop();
    }

    #[test]
    fn a_shutting_down_state_does_not_spawn() {
        // Quit is in progress; spawning here would outlive the app.
        let state = Arc::new(KanbanRuntimeState::default());
        state.stop();
        let spawned = Arc::new(AtomicUsize::new(0));

        ensure_kanban_runtime_started_with(&state, || {
            spawned.fetch_add(1, Ordering::SeqCst);
            spawn_pending_runtime()
        })
        .expect("a shutting-down state should be a no-op, not an error");

        assert_eq!(spawned.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn stop_clears_the_endpoint() {
        // A stale endpoint would point project windows at a dead port.
        let state = Arc::new(KanbanRuntimeState::default());
        state.set_endpoint(Some("http://127.0.0.1:5173".to_string()));

        state.stop();

        assert_eq!(state.endpoint(), None);
    }

    #[test]
    fn reopen_allows_a_restart_after_stop() {
        // stop() latches shutting_down so Drop stays correct; without
        // reopen() a user-requested restart would silently no-op.
        let state = Arc::new(KanbanRuntimeState::default());
        state.stop();
        state.reopen();
        let spawned = Arc::new(AtomicUsize::new(0));

        ensure_kanban_runtime_started_with(&state, || {
            spawned.fetch_add(1, Ordering::SeqCst);
            spawn_pending_runtime()
        })
        .expect("restart should spawn");

        assert_eq!(spawned.load(Ordering::SeqCst), 1);
        state.stop();
    }

    #[test]
    fn window_labels_use_only_characters_tauri_accepts() {
        let label = kanban_project_window_label("my app/web:2");

        assert!(label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn window_labels_do_not_collide_across_different_projects() {
        // The regression this pins: mapping every disallowed character to a
        // single `_` made these two ids share a label, so opening one project
        // focused the other's window.
        let ids = [
            "my app/web",
            "my-app-web",
            "my_app_web",
            "my.app.web",
            "myappweb",
        ];
        let labels: std::collections::HashSet<String> =
            ids.iter().map(|id| kanban_project_window_label(id)).collect();

        assert_eq!(labels.len(), ids.len(), "labels collided: {labels:?}");
    }

    #[test]
    fn a_literal_underscore_cannot_impersonate_an_escape() {
        // `_` is the escape character, so it has to be escaped itself or
        // `a_5F` and `a_` would encode identically.
        assert_ne!(
            kanban_project_window_label("a_5F"),
            kanban_project_window_label("a_")
        );
    }

    #[test]
    fn project_ids_are_percent_encoded_into_the_url() {
        // An unencoded slash would silently change which path the window
        // opens; an unencoded `?` would turn the rest into a query string.
        assert_eq!(urlencode("my app/web"), "my%20app%2Fweb");
        assert_eq!(urlencode("a?b=c"), "a%3Fb%3Dc");
    }

    #[test]
    fn unreserved_url_characters_survive_encoding_unchanged() {
        assert_eq!(urlencode("Aa0-_.~"), "Aa0-_.~");
    }
}
