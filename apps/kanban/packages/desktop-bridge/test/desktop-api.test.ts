import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	createDesktopBridge,
	type DesktopHost,
} from "../src/desktop-api.js";
import { DESKTOP_BRIDGE_VERSION } from "../src/contract.js";
import type { UpdaterBackendEvent } from "../src/updater/update-controller.js";

interface Harness {
	host: DesktopHost;
	openProjectWindow: Mock;
	restartRuntime: Mock;
	reveal: Mock;
	pickDirectory: Mock;
	publishMenuActions: Mock;
	menuUnsubscribe: Mock;
	notificationShow: Mock;
	notificationClick: Mock;
	setBadgeCount: Mock;
	requestAttention: Mock;
	setSummary: Mock;
	emitUpdaterEvent: (event: UpdaterBackendEvent) => void;
	setFocused: (focused: boolean) => void;
}

function makeHarness(overrides: Partial<DesktopHost> = {}): Harness {
	let focused = false;
	let emit: (event: UpdaterBackendEvent) => void = () => {};

	const openProjectWindow = vi.fn();
	const restartRuntime = vi.fn();
	const reveal = vi.fn();
	const pickDirectory = vi.fn(async () => "/tmp/picked");
	const publishMenuActions = vi.fn();
	const menuUnsubscribe = vi.fn();
	const notificationShow = vi.fn();
	const notificationClick = vi.fn();
	const setBadgeCount = vi.fn();
	const requestAttention = vi.fn();
	const setSummary = vi.fn();

	const host: DesktopHost = {
		platform: "darwin",
		appVersion: "1.2.3",
		isPackaged: true,
		declaredCapabilities: ["windows", "runtime", "dialogs", "actions"],
		openProjectWindow,
		restartRuntime,
		reveal,
		isAppFocused: () => focused,
		pickDirectory,
		publishMenuActions,
		onMenuActionInvoked: () => menuUnsubscribe,
		updater: {
			subscribe: (fn) => {
				emit = fn;
			},
			checkForUpdates: async () => {},
			quitAndInstall: () => {},
		},
		notifications: {
			isSupported: () => true,
			create: () => ({
				show: notificationShow,
				onClick: notificationClick,
			}),
		},
		presence: { setBadgeCount, requestAttention, setSummary },
		...overrides,
	};

	return {
		host,
		openProjectWindow,
		restartRuntime,
		reveal,
		pickDirectory,
		publishMenuActions,
		menuUnsubscribe,
		notificationShow,
		notificationClick,
		setBadgeCount,
		requestAttention,
		setSummary,
		emitUpdaterEvent: (event) => emit(event),
		setFocused: (next) => {
			focused = next;
		},
	};
}

describe("handshake", () => {
	it("reports the host's identity alongside the current bridge version", () => {
		const { host } = makeHarness();
		const { api } = createDesktopBridge(host);

		expect(api.bridgeVersion).toBe(DESKTOP_BRIDGE_VERSION);
		expect(api.platform).toBe("darwin");
		expect(api.appVersion).toBe("1.2.3");
	});

	it("advertises every capability a fully-equipped host provides", () => {
		const { host } = makeHarness();
		const { api } = createDesktopBridge(host);

		expect([...api.capabilities].sort()).toEqual([
			"actions",
			"dialogs",
			"notifications",
			"presence",
			"runtime",
			"updates",
			"windows",
		]);
	});

	it.each([
		["updater", "updates"],
		["notifications", "notifications"],
		["presence", "presence"],
	] as const)(
		"omits the %s capability when the host supplies none",
		(field, capability) => {
			// A host that couldn't initialise a subsystem — no notification
			// daemon, an unmanageable install — says so by omission rather than
			// by advertising something that will fail on first use.
			const { host } = makeHarness({ [field]: null });
			const { api } = createDesktopBridge(host);

			expect(api.capabilities).not.toContain(capability);
		},
	);

	it("keeps the declared command-backed capabilities on a backend-less host", () => {
		const { host } = makeHarness({
			updater: null,
			notifications: null,
			presence: null,
		});
		const { api } = createDesktopBridge(host);

		expect([...api.capabilities].sort()).toEqual([
			"actions",
			"dialogs",
			"runtime",
			"windows",
		]);
	});

	it("omits a command-backed capability the host does not declare", () => {
		// Nothing in TypeScript can check that a command exists on the other
		// side of the IPC boundary, so an undeclared one must not be assumed.
		const { host } = makeHarness({ declaredCapabilities: ["dialogs"] });
		const { api } = createDesktopBridge(host);

		expect(api.capabilities).not.toContain("windows");
		expect(api.capabilities).not.toContain("runtime");
		expect(api.capabilities).not.toContain("actions");
		expect(api.capabilities).toContain("dialogs");
	});

	it("ignores a declared capability that a supplied backend would have proven", () => {
		// Declaring "updates" without an updater would advertise a namespace
		// backed by nothing; the backend is the only proof that counts.
		const { host } = makeHarness({
			declaredCapabilities: ["windows", "updates"],
			updater: null,
		});
		const { api } = createDesktopBridge(host);

		expect(api.capabilities).not.toContain("updates");
	});
});

describe("payload validation", () => {
	let harness: Harness;

	beforeEach(() => {
		harness = makeHarness();
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("forwards a valid project id", () => {
		const { api } = createDesktopBridge(harness.host);
		api.windows.openProject("my-app");

		expect(harness.openProjectWindow).toHaveBeenCalledWith("my-app");
	});

	it.each(["", "   "])(
		"drops an open-project request with a blank id (%j)",
		(projectId) => {
			const { api } = createDesktopBridge(harness.host);
			api.windows.openProject(projectId);

			expect(harness.openProjectWindow).not.toHaveBeenCalled();
		},
	);

	it("trims a project id before handing it on", () => {
		const { api } = createDesktopBridge(harness.host);
		api.windows.openProject("  my-app  ");

		expect(harness.openProjectWindow).toHaveBeenCalledWith("my-app");
	});

	it("clamps presence counts rather than passing a runaway number to the badge", () => {
		const { api } = createDesktopBridge(harness.host);
		api.presence.setCounts({ running: 1, readyForReview: 9_000_000 });

		// The schema's `.catch(0)` turns an out-of-range count into 0 rather
		// than rejecting the whole message, so `running` still lands.
		expect(harness.setBadgeCount).toHaveBeenCalledWith(0);
		expect(harness.setSummary).toHaveBeenCalledWith("1 running");
	});

	it("rejects a notification carrying a task id with no project", () => {
		const { api } = createDesktopBridge(harness.host);
		api.notifications.notify({
			key: "k",
			title: "Done",
			body: "",
			taskId: "t-1",
		});

		// A click on this could not be turned into a URL, so it never ships.
		expect(harness.notificationShow).not.toHaveBeenCalled();
	});

	it("drops a menu publish that exceeds the item cap", () => {
		const { api } = createDesktopBridge(harness.host);
		api.actions.publish(
			Array.from({ length: 101 }, (_, index) => ({
				id: `a${index}`,
				label: `Action ${index}`,
				group: "g",
				accelerator: null,
				enabled: true,
			})),
		);

		expect(harness.publishMenuActions).not.toHaveBeenCalled();
	});

	it("resolves null for a malformed pickDirectory payload instead of rejecting", async () => {
		const { api } = createDesktopBridge(harness.host);

		// The caller's "no directory chosen" branch is the right outcome for a
		// refused request too, so this must not become a rejected promise.
		await expect(
			api.dialogs.pickDirectory({ title: "" } as { title: string }),
		).resolves.toBeNull();
		expect(harness.pickDirectory).not.toHaveBeenCalled();
	});

	it("passes a valid pickDirectory payload through to the host", async () => {
		const { api } = createDesktopBridge(harness.host);

		await expect(api.dialogs.pickDirectory({ title: "Pick" })).resolves.toBe(
			"/tmp/picked",
		);
	});
});

describe("notification click routing", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("reveals the task a notification points at", () => {
		const harness = makeHarness();
		const { api } = createDesktopBridge(harness.host);

		api.notifications.notify({
			key: "task-done-1",
			title: "Agent finished",
			body: "review please",
			projectId: "my-app",
			taskId: "t-42",
		});

		expect(harness.notificationShow).toHaveBeenCalled();
		// Fire the click the backend registered.
		harness.notificationClick.mock.calls[0]?.[0]();

		expect(harness.reveal).toHaveBeenCalledWith({
			projectId: "my-app",
			pathname: "/my-app",
			search: "?task=t-42",
		});
	});

	it("stays silent while the app is focused", () => {
		const harness = makeHarness();
		harness.setFocused(true);
		const { api } = createDesktopBridge(harness.host);

		api.notifications.notify({ key: "k", title: "Done", body: "" });

		expect(harness.notificationShow).not.toHaveBeenCalled();
	});

	it("is a no-op when the host has no notification backend", () => {
		const harness = makeHarness({ notifications: null });
		const { api } = createDesktopBridge(harness.host);

		// Documented degradation: calling a namespace whose capability is
		// absent must be silent, not a crash.
		expect(() =>
			api.notifications.notify({ key: "k", title: "t", body: "" }),
		).not.toThrow();
	});
});

describe("updates", () => {
	it("starts unsupported in an unpackaged build even with a backend present", async () => {
		const harness = makeHarness({ isPackaged: false });
		const { api } = createDesktopBridge(harness.host);

		await expect(api.updates.getStatus()).resolves.toEqual({
			kind: "unsupported",
			reason: "Automatic updates are only available in a packaged build.",
		});
	});

	it("pushes backend events through to subscribers", async () => {
		const harness = makeHarness();
		const { api } = createDesktopBridge(harness.host);
		const seen: string[] = [];
		api.updates.subscribe((status) => seen.push(status.kind));

		harness.emitUpdaterEvent({ kind: "available", version: "2.0.0" });
		harness.emitUpdaterEvent({ kind: "ready", version: "2.0.0" });

		expect(seen).toEqual(["available", "ready"]);
		await expect(api.updates.getStatus()).resolves.toEqual({
			kind: "ready",
			version: "2.0.0",
		});
	});
});

describe("dispose", () => {
	it("releases menu-action listeners registered through the bridge", () => {
		const harness = makeHarness();
		const bridge = createDesktopBridge(harness.host);

		bridge.api.actions.onInvoke(() => {});
		bridge.dispose();

		// A reloaded renderer re-registers; without this the host would stack a
		// listener per reload and invoke stale handlers.
		expect(harness.menuUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it("keeps disposing after one disposer throws", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const second = vi.fn();
		let call = 0;
		const harness = makeHarness({
			onMenuActionInvoked: () => {
				call += 1;
				return call === 1
					? () => {
							throw new Error("boom");
						}
					: second;
			},
		});
		const bridge = createDesktopBridge(harness.host);

		bridge.api.actions.onInvoke(() => {});
		bridge.api.actions.onInvoke(() => {});
		bridge.dispose();

		expect(second).toHaveBeenCalledTimes(1);
	});
});

describe("undeclared namespaces are no-ops", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("does not reach the host for any undeclared command", async () => {
		const harness = makeHarness({ declaredCapabilities: [] });
		const { api } = createDesktopBridge(harness.host);

		api.windows.openProject("my-app");
		api.runtime.restart();
		api.actions.publish([]);
		await expect(api.dialogs.pickDirectory()).resolves.toBeNull();

		expect(harness.openProjectWindow).not.toHaveBeenCalled();
		expect(harness.restartRuntime).not.toHaveBeenCalled();
		expect(harness.publishMenuActions).not.toHaveBeenCalled();
		expect(harness.pickDirectory).not.toHaveBeenCalled();
	});

	it("returns a usable unsubscribe from an undeclared onInvoke", () => {
		// Callers wire this in an effect cleanup unconditionally, so it has to
		// hand back something callable rather than throwing.
		const harness = makeHarness({ declaredCapabilities: [] });
		const { api } = createDesktopBridge(harness.host);

		expect(() => api.actions.onInvoke(() => {})()).not.toThrow();
		expect(harness.menuUnsubscribe).not.toHaveBeenCalled();
	});
});
