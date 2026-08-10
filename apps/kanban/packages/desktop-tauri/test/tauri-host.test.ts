import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	CMD_HANDSHAKE,
	CMD_OPEN_PROJECT_WINDOW,
	CMD_PICK_DIRECTORY,
	CMD_PUBLISH_MENU_ACTIONS,
	CMD_RESTART_RUNTIME,
	CMD_SET_TRAY_SUMMARY,
	EVENT_MENU_ACTION_INVOKED,
} from "../src/commands.js";
import { createTauriDesktopHost } from "../src/tauri-host.js";
import type {
	TauriSurface,
	TauriWindowSurface,
	UnlistenFn,
} from "../src/tauri-surface.js";

interface Fake {
	surface: TauriSurface;
	invoke: Mock;
	navigate: Mock;
	window: { [K in keyof TauriWindowSurface]: Mock };
	unlistenMenu: Mock;
	emitFocus: (focused: boolean) => void;
	emitMenuAction: (actionId: string) => void;
}

const FULL_HANDSHAKE = {
	appVersion: "1.4.0",
	platform: "macos",
	isPackaged: true,
	capabilities: ["presence", "tray"],
};

function makeFake(
	handshake: unknown = FULL_HANDSHAKE,
	overrides: { isTauri?: boolean } = {},
): Fake {
	let focusHandler: ((event: { payload: boolean }) => void) | null = null;
	let menuHandler: ((event: { payload: string }) => void) | null = null;
	const unlistenMenu = vi.fn();

	const invoke = vi.fn(async (command: string) => {
		if (command === CMD_HANDSHAKE) {
			if (handshake instanceof Error) throw handshake;
			return handshake;
		}
		if (command === CMD_PICK_DIRECTORY) return "/home/user/project";
		return undefined;
	});

	const window = {
		setBadgeCount: vi.fn(async () => {}),
		requestUserAttention: vi.fn(async () => {}),
		isFocused: vi.fn(async () => false),
		onFocusChanged: vi.fn(
			async (handler: (event: { payload: boolean }) => void) => {
				focusHandler = handler;
				return (() => {}) as UnlistenFn;
			},
		),
		setFocus: vi.fn(async () => {}),
		show: vi.fn(async () => {}),
		unminimize: vi.fn(async () => {}),
	};

	const surface: TauriSurface = {
		isTauri: () => overrides.isTauri ?? true,
		invoke: invoke as unknown as TauriSurface["invoke"],
		getVersion: async () => "1.4.0",
		currentWindow: () => window as unknown as TauriWindowSurface,
		listen: (async (
			event: string,
			handler: (e: { payload: string }) => void,
		) => {
			if (event === EVENT_MENU_ACTION_INVOKED) menuHandler = handler;
			return unlistenMenu;
		}) as unknown as TauriSurface["listen"],
	};

	return {
		surface,
		invoke,
		navigate: vi.fn(),
		window,
		unlistenMenu,
		emitFocus: (focused) => focusHandler?.({ payload: focused }),
		emitMenuAction: (actionId) => menuHandler?.({ payload: actionId }),
	};
}

async function makeHost(fake: Fake) {
	return createTauriDesktopHost({
		surface: fake.surface,
		navigate: fake.navigate,
	});
}

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("construction", () => {
	it("returns null outside a Tauri window", async () => {
		const fake = makeFake(FULL_HANDSHAKE, { isTauri: false });

		await expect(makeHost(fake)).resolves.toBeNull();
		// Browser mode must not even attempt the handshake.
		expect(fake.invoke).not.toHaveBeenCalled();
	});

	it("returns null when the handshake command is missing", async () => {
		// An older host that predates Kanban's commands. Browser mode is the
		// honest fallback rather than a window whose features all fail.
		const fake = makeFake(new Error("command kanban_handshake not found"));

		await expect(makeHost(fake)).resolves.toBeNull();
	});

	it.each([
		["a primitive", "nope"],
		["null", null],
		["a missing appVersion", { platform: "linux", isPackaged: true, capabilities: [] }],
		["a missing isPackaged", { appVersion: "1", platform: "linux", capabilities: [] }],
		[
			"a non-array capabilities field",
			{ appVersion: "1", platform: "linux", isPackaged: true, capabilities: 3 },
		],
	])("returns null for a handshake with %s", async (_label, payload) => {
		await expect(makeHost(makeFake(payload))).resolves.toBeNull();
	});

	it("normalises Tauri's platform spelling onto the contract's", async () => {
		const host = await makeHost(makeFake(FULL_HANDSHAKE));

		expect(host?.platform).toBe("darwin");
		expect(host?.appVersion).toBe("1.4.0");
		expect(host?.isPackaged).toBe(true);
	});

	it("omits presence when the host does not advertise it", async () => {
		const host = await makeHost(
			makeFake({ ...FULL_HANDSHAKE, capabilities: [] }),
		);

		expect(host?.presence).toBeNull();
	});

	it("leaves updater and notifications unwired until their plugins land", async () => {
		const host = await makeHost(makeFake());

		// Pinned deliberately: the contract's capability model is what covers
		// this gap, and a future wiring should have to update this test.
		expect(host?.updater).toBeNull();
		expect(host?.notifications).toBeNull();
	});
});

describe("commands", () => {
	it("forwards openProjectWindow", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.openProjectWindow("my-app");

		expect(fake.invoke).toHaveBeenCalledWith(CMD_OPEN_PROJECT_WINDOW, {
			projectId: "my-app",
		});
	});

	it("forwards restartRuntime", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.restartRuntime();

		// Called with no args at all, not with an explicit undefined — Tauri
		// treats a missing payload and an undefined one differently on the
		// Rust side.
		expect(fake.invoke).toHaveBeenCalledWith(CMD_RESTART_RUNTIME);
	});

	it("forwards publishMenuActions", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		const actions = [
			{ id: "a", label: "A", group: "g", accelerator: null, enabled: true },
		];
		host?.publishMenuActions(actions);

		expect(fake.invoke).toHaveBeenCalledWith(CMD_PUBLISH_MENU_ACTIONS, {
			actions,
		});
	});

	it("returns the chosen directory", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);

		await expect(host?.pickDirectory({ title: "Pick" })).resolves.toBe(
			"/home/user/project",
		);
		expect(fake.invoke).toHaveBeenCalledWith(CMD_PICK_DIRECTORY, {
			title: "Pick",
		});
	});

	it("passes a null title when none is given", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		await host?.pickDirectory();

		expect(fake.invoke).toHaveBeenCalledWith(CMD_PICK_DIRECTORY, {
			title: null,
		});
	});

	it("resolves null when the picker fails rather than rejecting", async () => {
		const fake = makeFake();
		fake.invoke.mockImplementation(async (command: string) => {
			if (command === CMD_HANDSHAKE) return FULL_HANDSHAKE;
			throw new Error("no picker available");
		});
		const host = await makeHost(fake);

		// A cancelled picker and a broken one both mean "no directory".
		await expect(host?.pickDirectory()).resolves.toBeNull();
	});

	it("resolves null when the picker returns an empty path", async () => {
		const fake = makeFake();
		fake.invoke.mockImplementation(async (command: string) =>
			command === CMD_HANDSHAKE ? FULL_HANDSHAKE : "",
		);
		const host = await makeHost(fake);

		await expect(host?.pickDirectory()).resolves.toBeNull();
	});

	it("does not reject when a fire-and-forget command fails", async () => {
		const fake = makeFake();
		fake.invoke.mockImplementation(async (command: string) => {
			if (command === CMD_HANDSHAKE) return FULL_HANDSHAKE;
			throw new Error("host is gone");
		});
		const host = await makeHost(fake);

		expect(() => host?.restartRuntime()).not.toThrow();
		// Let the rejection settle; an unhandled one would fail the run.
		await Promise.resolve();
	});
});

describe("reveal", () => {
	it("surfaces the window before navigating", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		const target = { projectId: "my-app", pathname: "/my-app", search: "?task=t-1" };

		host?.reveal(target);

		// A deep link clicked while the app is hidden must not navigate a
		// window the user never sees.
		expect(fake.window.unminimize).toHaveBeenCalled();
		expect(fake.window.show).toHaveBeenCalled();
		expect(fake.window.setFocus).toHaveBeenCalled();
		expect(fake.navigate).toHaveBeenCalledWith(target);
	});
});

describe("focus tracking", () => {
	it("starts unfocused so the first notification is never swallowed", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);

		expect(host?.isAppFocused()).toBe(false);
	});

	it("tracks focus changes", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);

		fake.emitFocus(true);
		expect(host?.isAppFocused()).toBe(true);

		fake.emitFocus(false);
		expect(host?.isAppFocused()).toBe(false);
	});

	it("stops tracking after dispose", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.dispose();

		fake.emitFocus(true);
		expect(host?.isAppFocused()).toBe(false);
	});
});

describe("menu actions", () => {
	it("delivers invoked action ids to the listener", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		const seen: string[] = [];
		host?.onMenuActionInvoked((id) => seen.push(id));
		await Promise.resolve();

		fake.emitMenuAction("new-task");

		expect(seen).toEqual(["new-task"]);
	});

	it("stops delivering after unsubscribe", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		const seen: string[] = [];
		const unsubscribe = host?.onMenuActionInvoked((id) => seen.push(id));
		await Promise.resolve();

		unsubscribe?.();
		fake.emitMenuAction("new-task");

		expect(seen).toEqual([]);
		expect(fake.unlistenMenu).toHaveBeenCalled();
	});

	it("releases a subscription cancelled before registration completes", async () => {
		// React StrictMode mounts and unmounts once before the real mount, so
		// this ordering is the common case, not an edge case.
		const fake = makeFake();
		const host = await makeHost(fake);

		host?.onMenuActionInvoked(() => {})();
		await Promise.resolve();
		await Promise.resolve();

		expect(fake.unlistenMenu).toHaveBeenCalled();
	});
});

describe("presence", () => {
	it("sets a badge for a positive count", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.presence?.setBadgeCount(3);

		expect(fake.window.setBadgeCount).toHaveBeenCalledWith(3);
	});

	it("clears the badge with undefined rather than zero", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.presence?.setBadgeCount(0);

		expect(fake.window.setBadgeCount).toHaveBeenCalledWith(undefined);
	});

	it("bounces the dock once rather than until focused", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.presence?.requestAttention();

		// 2 is Informational. Critical (1) bounces until the app is focused,
		// which is unusable for a queue the user has chosen to leave.
		expect(fake.window.requestUserAttention).toHaveBeenCalledWith(2);
	});

	it("sends the summary to the tray when the host has one", async () => {
		const fake = makeFake();
		const host = await makeHost(fake);
		host?.presence?.setSummary("2 running");

		expect(fake.invoke).toHaveBeenCalledWith(CMD_SET_TRAY_SUMMARY, {
			summary: "2 running",
		});
	});

	it("skips the tray call on a host without one", async () => {
		const fake = makeFake({ ...FULL_HANDSHAKE, capabilities: ["presence"] });
		const host = await makeHost(fake);
		host?.presence?.setSummary("2 running");

		// The badge still works; only the tray signal degrades.
		expect(fake.invoke).not.toHaveBeenCalledWith(
			CMD_SET_TRAY_SUMMARY,
			expect.anything(),
		);
	});
});

describe("declared capabilities", () => {
	it("passes the host's contract capabilities through to the bridge", async () => {
		const host = await makeHost(
			makeFake({
				...FULL_HANDSHAKE,
				capabilities: ["dialogs", "presence"],
			}),
		);

		expect([...(host?.declaredCapabilities ?? [])].sort()).toEqual([
			"dialogs",
			"presence",
		]);
	});

	it("drops host capabilities the contract does not define", async () => {
		// `tray` is a real hint the Rust side sends, but it is not one of the
		// contract's capabilities — passing it through would make the bridge
		// advertise something `isDesktopCapability` would later reject.
		const host = await makeHost(
			makeFake({ ...FULL_HANDSHAKE, capabilities: ["presence", "tray"] }),
		);

		expect(host?.declaredCapabilities).toEqual(["presence"]);
	});
});
