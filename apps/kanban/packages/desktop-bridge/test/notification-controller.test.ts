import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	NotificationController,
	type NotificationBackend,
	type NotificationHandle,
} from "../src/notifications/notification-controller.js";
import type { DeepLinkTarget } from "../src/deep-links.js";

interface RecordedNotification {
	title: string;
	body: string;
	shown: boolean;
	click(): void;
}

class FakeBackend implements NotificationBackend {
	supported = true;
	createThrows = false;
	showThrows = false;
	readonly created: RecordedNotification[] = [];

	isSupported(): boolean {
		return this.supported;
	}

	create(input: { title: string; body: string }): NotificationHandle {
		if (this.createThrows) throw new Error("no notification daemon");
		let onClick: (() => void) | null = null;
		const record: RecordedNotification = {
			title: input.title,
			body: input.body,
			shown: false,
			click: () => onClick?.(),
		};
		this.created.push(record);
		const showThrows = this.showThrows;
		return {
			show: () => {
				if (showThrows) throw new Error("show failed");
				record.shown = true;
			},
			onClick: (listener) => {
				onClick = listener;
			},
		};
	}
}

const TARGET: DeepLinkTarget = {
	projectId: "my-app",
	pathname: "/my-app",
	search: "?task=t-1",
};

let backend: FakeBackend;
let reveal: Mock<(target: DeepLinkTarget) => void>;
let focused: boolean;
let controller: NotificationController;

beforeEach(() => {
	backend = new FakeBackend();
	reveal = vi.fn();
	focused = false;
	controller = new NotificationController({
		backend,
		isAppFocused: () => focused,
		reveal,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("delivery", () => {
	it("shows a notification", () => {
		const shown = controller.notify({ key: "k1", title: "Ready", body: "Task 1" });

		expect(shown).toBe(true);
		expect(backend.created).toHaveLength(1);
		expect(backend.created[0]).toMatchObject({
			title: "Ready",
			body: "Task 1",
			shown: true,
		});
	});

	it("does nothing when the platform has no notification support", () => {
		backend.supported = false;

		expect(controller.notify({ key: "k1", title: "Ready", body: "b" })).toBe(false);
		expect(backend.created).toHaveLength(0);
	});

	it("stays silent while the app is focused", () => {
		// The user is looking at the event happen in-app; a toast about it is
		// pure noise.
		focused = true;

		expect(controller.notify({ key: "k1", title: "Ready", body: "b" })).toBe(false);
		expect(backend.created).toHaveLength(0);
	});

	it("does not re-notify a focus-suppressed event once the app blurs", () => {
		// The event was already seen. Re-raising it the moment the user
		// switches away would be worse than staying quiet.
		focused = true;
		controller.notify({ key: "k1", title: "Ready", body: "b" });

		focused = false;
		expect(controller.notify({ key: "k1", title: "Ready", body: "b" })).toBe(false);
		expect(backend.created).toHaveLength(0);
	});
});

describe("deduplication", () => {
	it("drops a repeat of the same key", () => {
		// The runtime re-emits ready-for-review state on reconnect; a user back
		// from lunch should not find eight copies of one notification.
		controller.notify({ key: "k1", title: "Ready", body: "b" });
		const second = controller.notify({ key: "k1", title: "Ready", body: "b" });

		expect(second).toBe(false);
		expect(backend.created).toHaveLength(1);
	});

	it("treats a different key as a new event", () => {
		controller.notify({ key: "k1", title: "Ready", body: "b" });
		controller.notify({ key: "k2", title: "Ready", body: "b" });

		expect(backend.created).toHaveLength(2);
	});

	it("bounds how many keys it remembers", () => {
		// Sessions here are measured in days, so an unbounded set is a slow leak.
		for (let i = 0; i < 600; i += 1) {
			controller.notify({ key: `k${i}`, title: "t", body: "b" });
		}
		// The oldest key has been evicted, so it is deliverable again.
		const redelivered = controller.notify({ key: "k0", title: "t", body: "b" });

		expect(redelivered).toBe(true);
	});
});

describe("click routing", () => {
	it("reveals the target when clicked", () => {
		controller.notify({ key: "k1", title: "Ready", body: "b", target: TARGET });

		backend.created[0]?.click();

		expect(reveal).toHaveBeenCalledExactlyOnceWith(TARGET);
	});

	it("is inert when clicked with no target", () => {
		controller.notify({ key: "k1", title: "Ready", body: "b" });

		expect(() => backend.created[0]?.click()).not.toThrow();
		expect(reveal).not.toHaveBeenCalled();
	});
});

describe("backend failures", () => {
	it("survives a backend that cannot construct a notification", () => {
		// A Linux box with no notification daemon. Never take down the caller.
		vi.spyOn(console, "warn").mockImplementation(() => {});
		backend.createThrows = true;

		expect(() => controller.notify({ key: "k1", title: "t", body: "b" })).not.toThrow();
		expect(controller.notify({ key: "k2", title: "t", body: "b" })).toBe(false);
	});

	it("survives a backend that cannot show a notification", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		backend.showThrows = true;

		expect(controller.notify({ key: "k1", title: "t", body: "b" })).toBe(false);
	});
});
