/**
 * System-wide shortcut for summoning the app.
 *
 * The point is reaching Kanban without first finding its window: an agent
 * finishes, the tray or a notification says so, and one key brings the board
 * up from whatever the user was doing instead.
 *
 * Registration genuinely fails — another app may already own the combo, and
 * on some Linux desktops the whole API is unavailable — so failure is a
 * first-class outcome rather than an exception. Nothing else about the app
 * depends on this working.
 */

export const DEFAULT_SUMMON_ACCELERATOR = "CmdOrCtrl+Shift+K";

/**
 * The slice of a host's global-shortcut API this module needs.
 *
 * Structural rather than tied to one host: `tauri-plugin-global-shortcut`
 * exposes the same three operations, with the async parts adapted at the
 * boundary so the policy here stays synchronous and testable.
 */
export interface GlobalShortcutLike {
	register(accelerator: string, callback: () => void): boolean;
	isRegistered(accelerator: string): boolean;
	unregister(accelerator: string): void;
}

export interface GlobalShortcutOptions {
	globalShortcut: GlobalShortcutLike;
	onSummon: () => void;
}

export class GlobalShortcuts {
	private registered: string | null = null;

	constructor(private readonly opts: GlobalShortcutOptions) {}

	get activeAccelerator(): string | null {
		return this.registered;
	}

	/**
	 * Bind `accelerator`, replacing any previous binding.
	 *
	 * Returns whether it took. A false here is normal — another app owning the
	 * combo is the common case — so callers should report it, not treat it as
	 * an error.
	 */
	register(accelerator: string = DEFAULT_SUMMON_ACCELERATOR): boolean {
		this.unregister();

		// `isRegistered` catches the case where another *process* holds it, in
		// which case `register` would return false anyway — but checking first
		// keeps the log message accurate about why.
		if (this.opts.globalShortcut.isRegistered(accelerator)) {
			console.warn(
				`[desktop] Global shortcut ${accelerator} is already taken by another application.`,
			);
			return false;
		}

		let ok = false;
		try {
			ok = this.opts.globalShortcut.register(accelerator, () =>
				this.opts.onSummon(),
			);
		} catch (err) {
			// Some Linux desktops have no global-shortcut support at all and
			// throw rather than returning false.
			console.warn(
				`[desktop] Could not register global shortcut ${accelerator}:`,
				err instanceof Error ? err.message : err,
			);
			return false;
		}

		if (!ok) {
			console.warn(`[desktop] Global shortcut ${accelerator} was refused.`);
			return false;
		}

		this.registered = accelerator;
		return true;
	}

	/**
	 * Release the binding.
	 *
	 * Must run before quit: a global shortcut outlives the process on some
	 * platforms, and leaving it held would make the combo dead for every other
	 * app until reboot.
	 */
	unregister(): void {
		if (!this.registered) return;
		try {
			this.opts.globalShortcut.unregister(this.registered);
		} catch (err) {
			console.warn(
				"[desktop] Failed to unregister global shortcut:",
				err instanceof Error ? err.message : err,
			);
		}
		this.registered = null;
	}
}
