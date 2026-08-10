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
            // Ask before escalating. The loop below was written to "give it a
            // window to exit on its own", but nothing was telling it to go —
            // so the seven seconds always elapsed in full and the `kill()`
            // afterwards (SIGKILL on Unix) was the only signal the runtime
            // ever received. Kanban persists board state and worktree
            // bookkeeping on shutdown, and being killed mid-write is exactly
            // how that gets corrupted, which is what the grace period was
            // supposed to prevent.
            #[cfg(unix)]
            {
                // Safety: `id()` is this child's pid and we own the handle, so
                // it cannot have been reaped and reused underneath us. A pid
                // that has already exited yields ESRCH, which is ignored.
                unsafe {
                    libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
                }
            }
            // Windows has no SIGTERM for a non-console child, so there the
            // wait below remains a plain grace period before `kill()`.
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
        // Stdout closing means the child is gone — clean exit, crash, or kill.
        // Either way the endpoint it announced is dead, and leaving it set
        // makes every later `kanban_open_project_window` open a window against
        // an origin nothing is serving, with no error to explain the blank
        // page. Clearing it here is also what lets the next startup check
        // spawn a replacement instead of handing out a stale address.
        state_for_stdout.set_endpoint(None);
    });

    *process_guard = Some(child);
    Ok(())
}

/// Holds the system awake while Kanban reports work in flight.
///
/// This is the Electron host's `powerSaveBlocker.start("prevent-app-suspension")`,
/// and losing it would quietly undo the product's premise: the whole point of
/// leaving agents running is that you walk away, and a machine that suspends
/// ten minutes later stops them mid-task. It is the one desktop feature whose
/// absence is invisible until it costs someone a run.
///
/// Held as an `Option` because the guard releases on drop — clearing it *is*
/// the release, so the state is the lock.
/// Holder set and OS guard behind **one** mutex, deliberately.
///
/// They were two, and that was a race: `reconcile` read the holder set,
/// released that lock, then took the guard lock. Between those steps another
/// window could claim and acquire, and the first thread would then apply its
/// stale "nobody is holding" snapshot and drop the lock — leaving bookkeeping
/// that says work is in flight and no lock to match. Presence is
/// edge-triggered, so the still-working window never re-sends `true` and the
/// machine sleeps mid-run.
///
/// Lock ordering discipline would have fixed it, but not durably: it survives
/// only as long as everyone touching this remembers. One mutex makes the
/// inconsistent state unrepresentable. The cost is holding it across the
/// acquisition syscall, which is short and uncontended.
#[derive(Default)]
struct WakeLockInner {
    /// Labels of windows currently reporting work in flight.
    ///
    /// The lock is app-wide but the signal is per-window: every project
    /// window runs its own renderer with its own `PresenceController` and its
    /// own running count. Treating the latest `false` as "release" let one
    /// window finishing suspend the machine while another still had agents
    /// working. The lock is therefore held while *any* window claims it.
    holders: std::collections::HashSet<String>,
    /// Labels whose window has been destroyed.
    ///
    /// `release_window` runs on `WindowEvent::Destroyed`, but the renderer's
    /// `kanban_set_wake_lock` is fire-and-forget: a `true` sent moments before
    /// the window went away can still arrive *after* the release, re-inserting
    /// a holder that no renderer is left to clear. The lock would then be held
    /// for the life of the app — the same "awake forever" failure `Destroyed`
    /// exists to prevent, reached through a narrower window. A destroyed label
    /// is remembered so a late claim is dropped instead.
    destroyed: std::collections::HashSet<String>,
    guard: Option<keepawake::KeepAwake>,
}

impl WakeLockInner {
    /// Bring the OS guard in line with the holder set. Callers already hold
    /// the mutex, which is what makes this atomic with respect to the set.
    fn reconcile(&mut self) -> Result<(), String> {
        match (!self.holders.is_empty(), self.guard.is_some()) {
            (true, false) => {
                let lock = keepawake::Builder::default()
                    // Idle only: the display may sleep, the machine may not. A
                    // desktop that also refuses to blank the screen for hours
                    // of background work is a battery and burn-in problem, and
                    // is not what the Electron host did either.
                    .idle(true)
                    .reason("Cline Kanban agents are working")
                    .app_name("Cline Code")
                    .create()
                    .map_err(|error| format!("failed to acquire wake lock: {error}"))?;
                self.guard = Some(lock);
            }
            // Dropping the guard releases the lock.
            (false, true) => self.guard = None,
            _ => {}
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct KanbanWakeLockState {
    inner: Mutex<WakeLockInner>,
}

impl KanbanWakeLockState {
    fn set(&self, window_label: &str, active: bool) -> Result<(), String> {
        let Ok(mut inner) = self.inner.lock() else {
            return Err("failed to lock wake-lock state".to_string());
        };
        if active {
            // A claim from a window that is already gone: see `destroyed`.
            // Ok rather than Err — the renderer that sent it no longer exists
            // to receive an error, and nothing is wrong from the caller's
            // point of view.
            if inner.destroyed.contains(window_label) {
                return Ok(());
            }
            inner.holders.insert(window_label.to_string());
        } else {
            inner.holders.remove(window_label);
        }
        inner.reconcile()
    }

    /// Drop a window's claim outright.
    ///
    /// A window closed mid-run never sends its `false`, and without this its
    /// claim would outlive it and hold the machine awake forever — the
    /// mirror-image bug of releasing too early, and the harder one to notice
    /// because nothing visibly breaks.
    pub fn release_window(&self, window_label: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.destroyed.insert(window_label.to_string());
        if inner.holders.remove(window_label) {
            let _ = inner.reconcile();
        }
    }

    /// Forget that a label was destroyed, so a window created under it again
    /// can claim normally.
    ///
    /// Labels are reusable: closing a project window and reopening the same
    /// project produces the same label. Without this the tombstone from the
    /// first window would silently swallow every claim the second one makes,
    /// and the wake lock would never engage for that project again.
    pub fn forget_window(&self, window_label: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.destroyed.remove(window_label);
        }
    }

    /// Whether any window currently claims the lock.
    ///
    /// This, not the OS guard, is what the tests assert on — and the
    /// distinction is load-bearing. A headless box has no session bus, so
    /// `keepawake` fails with ENOENT and the guard is never populated there.
    /// Tests written against the guard passed on such a box by skipping,
    /// which reads as coverage while asserting nothing. The bug this
    /// bookkeeping exists to prevent — one window releasing another's claim —
    /// lives here, so here is where it can be tested honestly.
    #[cfg(test)]
    fn wants_lock(&self) -> bool {
        self.inner
            .lock()
            .map(|inner| !inner.holders.is_empty())
            .unwrap_or(false)
    }
}

/// Called by the bridge's presence controller whenever the in-flight count
/// crosses zero in either direction.
#[tauri::command]
pub fn kanban_set_wake_lock(
    window: tauri::Window,
    state: State<'_, Arc<KanbanWakeLockState>>,
    active: bool,
) -> Result<(), String> {
    // Keyed on the calling window: see `holders` for why a single boolean is
    // not enough once more than one project window exists.
    state.set(window.label(), active)
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

    // Clear any tombstone left by a previous window under this label before
    // the new one can send its first claim; see `forget_window`.
    app.state::<Arc<KanbanWakeLockState>>().forget_window(&label);

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

#[cfg(test)]
mod wake_lock_tests {
    use super::*;

    const WIN_A: &str = "kanban-project-a";
    const WIN_B: &str = "kanban-project-b";

    // These assert on `wants_lock()` rather than on the OS guard on purpose.
    // Acquiring a real lock needs a session bus that CI does not have, so
    // guard-based assertions silently skip exactly where they most need to
    // run. `set` still returns the acquisition error for the caller to log;
    // the bookkeeping it updates is correct either way.

    #[test]
    fn starts_with_no_claim() {
        assert!(!KanbanWakeLockState::default().wants_lock());
    }

    #[test]
    fn a_window_claiming_holds_the_lock() {
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);

        assert!(state.wants_lock());
    }

    #[test]
    fn claiming_twice_still_needs_only_one_release() {
        // Presence is edge-triggered, but a reconnecting renderer replays the
        // edge. Stacking claims would mean two releases before the machine
        // could ever sleep.
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);
        let _ = state.set(WIN_A, true);

        let _ = state.set(WIN_A, false);

        assert!(!state.wants_lock());
    }

    #[test]
    fn a_release_without_a_claim_is_harmless() {
        // The first presence update can report zero running tasks, sending
        // `false` before anything was ever claimed.
        let state = KanbanWakeLockState::default();

        let _ = state.set(WIN_A, false);

        assert!(!state.wants_lock());
    }

    #[test]
    fn one_window_finishing_does_not_release_anothers_claim() {
        // The regression this pins. Every project window runs its own
        // PresenceController with its own running count, so window A hitting
        // zero used to release an app-wide lock window B still needed —
        // suspending the machine with B's agents mid-task.
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);
        let _ = state.set(WIN_B, true);

        let _ = state.set(WIN_A, false);

        assert!(state.wants_lock(), "B still has work in flight");
    }

    #[test]
    fn the_claim_drops_once_the_last_window_finishes() {
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);
        let _ = state.set(WIN_B, true);

        let _ = state.set(WIN_A, false);
        let _ = state.set(WIN_B, false);

        assert!(!state.wants_lock());
    }

    #[test]
    fn a_closed_window_does_not_claim_the_lock_forever() {
        // The mirror-image bug, and the harder one to notice: a window closed
        // mid-run never sends its `false`, so without an explicit release its
        // claim would outlive it and keep the machine awake indefinitely with
        // nothing visibly wrong.
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);

        state.release_window(WIN_A);

        assert!(!state.wants_lock());
    }

    #[test]
    fn concurrent_claims_and_releases_leave_consistent_state() {
        // The race this pins: holder set and OS guard used to sit behind
        // separate mutexes, so a thread could read "nobody holding", lose the
        // CPU while another window claimed and acquired, then apply its stale
        // snapshot and drop the lock. Bookkeeping would say work was in
        // flight with no lock to match, and edge-triggered presence would
        // never re-send.
        //
        // One mutex makes that unrepresentable. This exercises the interleave
        // it would have needed, and asserts the invariant afterwards.
        let state = Arc::new(KanbanWakeLockState::default());
        let handles: Vec<_> = (0..16)
            .map(|i| {
                let state = state.clone();
                let label = format!("kanban-project-{}", i % 4);
                thread::spawn(move || {
                    for _ in 0..50 {
                        let _ = state.set(&label, true);
                        let _ = state.set(&label, false);
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("no thread should panic");
        }

        // Every claim was paired with a release, so nothing may be left held.
        assert!(!state.wants_lock());
    }

    #[test]
    fn a_surviving_claim_outlives_a_concurrent_release_storm() {
        // The asymmetric case, which is the one that actually bites: one
        // window keeps working while others churn. Its claim must still stand
        // at the end.
        let state = Arc::new(KanbanWakeLockState::default());
        let _ = state.set("kanban-project-long-runner", true);

        let handles: Vec<_> = (0..8)
            .map(|i| {
                let state = state.clone();
                let label = format!("kanban-project-churn-{i}");
                thread::spawn(move || {
                    for _ in 0..50 {
                        let _ = state.set(&label, true);
                        let _ = state.set(&label, false);
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("no thread should panic");
        }

        assert!(
            state.wants_lock(),
            "the long-running window's claim must survive the churn"
        );
    }

    #[test]
    fn closing_an_unrelated_window_leaves_other_claims_alone() {
        // Every window destroy calls this, including windows that never ran
        // anything.
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);

        state.release_window("kanban-project-never-claimed");

        assert!(state.wants_lock(), "A's claim must survive an unrelated close");
    }

    #[test]
    fn a_claim_arriving_after_the_window_died_is_dropped() {
        // `kanban_set_wake_lock` is fire-and-forget from the renderer, so a
        // `true` sent just before the window went away can land after
        // `Destroyed` already released it. Re-inserting the holder there would
        // hold the machine awake for the life of the app, with no renderer
        // left to ever send the matching `false`.
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);

        state.release_window(WIN_A);
        let _ = state.set(WIN_A, true);

        assert!(
            !state.wants_lock(),
            "a late claim must not resurrect a destroyed window's hold"
        );
    }

    #[test]
    fn a_destroyed_window_does_not_block_its_replacement() {
        // Labels are reusable: reopening the same project produces the same
        // label. If the tombstone outlived the window, the wake lock would
        // silently never engage for that project again — trading a permanent
        // hold for a permanent failure to hold.
        let state = KanbanWakeLockState::default();
        state.release_window(WIN_A);

        state.forget_window(WIN_A);
        let _ = state.set(WIN_A, true);

        assert!(state.wants_lock(), "a new window under a reused label must claim normally");
    }

    #[test]
    fn one_windows_death_does_not_silence_another() {
        let state = KanbanWakeLockState::default();
        let _ = state.set(WIN_A, true);
        state.release_window(WIN_A);

        let _ = state.set(WIN_B, true);

        assert!(state.wants_lock(), "B's claim is unaffected by A being destroyed");
    }
}
