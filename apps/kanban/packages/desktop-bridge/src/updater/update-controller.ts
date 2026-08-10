/**
 * Update policy and state, kept free of any updater implementation.
 *
 * The controller owns *what the app does* about updates — when a check is
 * allowed, which transitions are legal, who gets told. Talking to the actual
 * updater is delegated to an injected `UpdaterBackend`, so this whole file is
 * exercisable without a desktop runtime and the one adapter that does touch
 * `tauri-plugin-updater` stays small enough to read in a sitting.
 */

import type { DesktopUpdateStatus } from "../contract.js";

/** Events an updater backend reports upward. Deliberately narrower than any
 * real updater's event set — only what changes user-visible state. */
export type UpdaterBackendEvent =
	| { kind: "checking" }
	| { kind: "up-to-date" }
	| { kind: "available"; version: string }
	| { kind: "progress"; percent: number }
	| { kind: "ready"; version: string }
	| { kind: "error"; message: string };

export interface UpdaterBackend {
	/** Wired once, at construction. */
	subscribe(emit: (event: UpdaterBackendEvent) => void): void;
	checkForUpdates(): Promise<void>;
	quitAndInstall(): void;
}

export interface UpdateSupport {
	supported: boolean;
	reason: string;
}

/**
 * Whether this build can self-update.
 *
 * A dev run has no packaged artifact to replace, so a check would fail with
 * an opaque provider error. Reporting `unsupported` up front turns that into
 * a sentence the user can understand — and keeps developers from filing it
 * as a bug.
 *
 * Linux is deliberately *not* gated here. `tauri-plugin-updater` handles
 * AppImage installs, and which packaging a user is running isn't reliably
 * knowable from the host; a genuinely unmanageable install surfaces as an
 * `error` from the check itself, which is honest.
 */
export function resolveUpdateSupport(input: {
	isPackaged: boolean;
}): UpdateSupport {
	if (!input.isPackaged) {
		return {
			supported: false,
			reason: "Automatic updates are only available in a packaged build.",
		};
	}
	return { supported: true, reason: "" };
}

export type UpdateStatusListener = (status: DesktopUpdateStatus) => void;

export class UpdateController {
	private status: DesktopUpdateStatus;
	private readonly listeners = new Set<UpdateStatusListener>();
	private checking = false;

	constructor(
		private readonly backend: UpdaterBackend | null,
		support: UpdateSupport,
	) {
		if (!support.supported || !backend) {
			this.status = {
				kind: "unsupported",
				reason: support.reason || "Automatic updates are unavailable.",
			};
			return;
		}
		this.status = { kind: "idle" };
		backend.subscribe((event) => this.applyBackendEvent(event));
	}

	getStatus(): DesktopUpdateStatus {
		return this.status;
	}

	subscribe(listener: UpdateStatusListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Start a check. Concurrent calls collapse: two windows opening the
	 * settings dialog at once must not fire two provider round-trips, and the
	 * second would clobber the first's progress state on the way back.
	 */
	check(): void {
		if (!this.backend || this.status.kind === "unsupported") return;
		if (this.checking) return;
		// A downloaded update is terminal until the user restarts. Re-checking
		// would walk the status backwards from `ready` and lose the prompt.
		if (this.status.kind === "ready") return;

		this.checking = true;
		this.setStatus({ kind: "checking" });
		this.backend.checkForUpdates().catch((error: unknown) => {
			this.applyBackendEvent({
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		});
	}

	/** No-op unless an update is downloaded and waiting. */
	install(): void {
		if (!this.backend) return;
		if (this.status.kind !== "ready") {
			console.warn(
				`[desktop] Ignoring install request in status "${this.status.kind}".`,
			);
			return;
		}
		this.backend.quitAndInstall();
	}

	private applyBackendEvent(event: UpdaterBackendEvent): void {
		if (this.status.kind === "unsupported") return;

		// `ready` is terminal until the user restarts. Backends keep reporting
		// on their own timers well after a download finishes, and a stray
		// `checking` / `up-to-date` / `error` arriving here would clear an
		// install prompt for an update already sitting on disk — the user is
		// then told there is nothing to install while the artifact waits.
		//
		// `check()` refuses to leave `ready` for the same reason; this is the
		// other half of that rule, for transitions we did not initiate.
		//
		// A further `ready` is the one event still worth applying: it means a
		// newer version finished downloading, and the prompt should name it.
		if (this.status.kind === "ready" && event.kind !== "ready") return;

		switch (event.kind) {
			case "checking":
				this.checking = true;
				this.setStatus({ kind: "checking" });
				return;
			case "up-to-date":
				this.checking = false;
				this.setStatus({ kind: "up-to-date" });
				return;
			case "available":
				this.checking = false;
				this.setStatus({ kind: "available", version: event.version });
				return;
			case "progress": {
				// Progress before `update-available` would leave us without a
				// version to show; keep the last known one rather than inventing
				// a placeholder the UI would render.
				const version =
					this.status.kind === "downloading" || this.status.kind === "available"
						? this.status.version
						: "";
				this.setStatus({
					kind: "downloading",
					version,
					percent: clampPercent(event.percent),
				});
				return;
			}
			case "ready":
				this.checking = false;
				this.setStatus({ kind: "ready", version: event.version });
				return;
			case "error":
				this.checking = false;
				this.setStatus({ kind: "error", message: event.message });
				return;
		}
	}

	private setStatus(next: DesktopUpdateStatus): void {
		this.status = next;
		for (const listener of this.listeners) {
			try {
				listener(next);
			} catch (err) {
				// One bad subscriber (a torn-down window's event channel, say) must
				// not stop the rest from being notified.
				console.warn(
					"[desktop] Update status listener threw:",
					err instanceof Error ? err.message : err,
				);
			}
		}
	}
}

function clampPercent(percent: number): number {
	// NaN means "no idea", which reads best as 0. Infinities are directional,
	// so let the clamp carry them to the right end rather than collapsing
	// both to 0 and rendering a full download as an empty bar.
	if (Number.isNaN(percent)) return 0;
	return Math.min(100, Math.max(0, percent));
}
