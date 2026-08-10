import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	DEFAULT_SUMMON_ACCELERATOR,
	GlobalShortcuts,
	type GlobalShortcutLike,
} from "../src/shortcuts/global-shortcuts.js";

class FakeGlobalShortcut implements GlobalShortcutLike {
	taken = new Set<string>();
	refuse = false;
	throwOnRegister = false;
	readonly bound = new Map<string, () => void>();

	register(accelerator: string, callback: () => void): boolean {
		if (this.throwOnRegister) throw new Error("no global shortcut support");
		if (this.refuse) return false;
		this.bound.set(accelerator, callback);
		return true;
	}

	isRegistered(accelerator: string): boolean {
		return this.taken.has(accelerator);
	}

	unregister(accelerator: string): void {
		this.bound.delete(accelerator);
	}
}

let api: FakeGlobalShortcut;
let onSummon: Mock<() => void>;
let shortcuts: GlobalShortcuts;

beforeEach(() => {
	api = new FakeGlobalShortcut();
	onSummon = vi.fn();
	shortcuts = new GlobalShortcuts({ globalShortcut: api, onSummon });
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("register", () => {
	it("binds the default accelerator", () => {
		expect(shortcuts.register()).toBe(true);
		expect(shortcuts.activeAccelerator).toBe(DEFAULT_SUMMON_ACCELERATOR);
	});

	it("summons when the shortcut fires", () => {
		shortcuts.register("CmdOrCtrl+Alt+K");

		api.bound.get("CmdOrCtrl+Alt+K")?.();

		expect(onSummon).toHaveBeenCalledOnce();
	});

	it("reports failure when another app owns the combo", () => {
		// The common case, not an error — the caller should say so, not throw.
		api.taken.add(DEFAULT_SUMMON_ACCELERATOR);

		expect(shortcuts.register()).toBe(false);
		expect(shortcuts.activeAccelerator).toBeNull();
	});

	it("reports failure when registration is refused", () => {
		api.refuse = true;

		expect(shortcuts.register()).toBe(false);
		expect(shortcuts.activeAccelerator).toBeNull();
	});

	it("survives a platform with no global-shortcut support", () => {
		// Some Linux desktops throw rather than returning false.
		api.throwOnRegister = true;

		expect(() => shortcuts.register()).not.toThrow();
		expect(shortcuts.register()).toBe(false);
	});

	it("replaces a previous binding", () => {
		shortcuts.register("CmdOrCtrl+Alt+1");
		shortcuts.register("CmdOrCtrl+Alt+2");

		expect(shortcuts.activeAccelerator).toBe("CmdOrCtrl+Alt+2");
		expect(api.bound.has("CmdOrCtrl+Alt+1")).toBe(false);
	});
});

describe("unregister", () => {
	it("releases the binding", () => {
		// Leaving it held would make the combo dead for every other app.
		shortcuts.register("CmdOrCtrl+Alt+K");

		shortcuts.unregister();

		expect(api.bound.size).toBe(0);
		expect(shortcuts.activeAccelerator).toBeNull();
	});

	it("is a no-op when nothing is bound", () => {
		expect(() => shortcuts.unregister()).not.toThrow();
	});

	it("clears state even when the platform throws on release", () => {
		shortcuts.register("CmdOrCtrl+Alt+K");
		vi.spyOn(api, "unregister").mockImplementation(() => {
			throw new Error("nope");
		});

		shortcuts.unregister();

		expect(shortcuts.activeAccelerator).toBeNull();
	});
});
