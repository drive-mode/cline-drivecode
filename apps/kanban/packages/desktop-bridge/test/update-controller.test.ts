import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopUpdateStatus } from "../src/contract.js";
import {
	resolveUpdateSupport,
	UpdateController,
	type UpdaterBackend,
	type UpdaterBackendEvent,
} from "../src/updater/update-controller.js";

class FakeBackend implements UpdaterBackend {
	emit: (event: UpdaterBackendEvent) => void = () => {};
	readonly checkForUpdates = vi.fn(async () => {});
	readonly quitAndInstall = vi.fn();

	subscribe(emit: (event: UpdaterBackendEvent) => void): void {
		this.emit = emit;
	}
}

const SUPPORTED = { supported: true, reason: "" };

let backend: FakeBackend;
let controller: UpdateController;

beforeEach(() => {
	backend = new FakeBackend();
	controller = new UpdateController(backend, SUPPORTED);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("resolveUpdateSupport", () => {
	it("supports a packaged build", () => {
		expect(resolveUpdateSupport({ isPackaged: true })).toEqual({
			supported: true,
			reason: "",
		});
	});

	it("rejects an unpackaged build with an explanation", () => {
		const result = resolveUpdateSupport({ isPackaged: false });

		expect(result.supported).toBe(false);
		expect(result.reason).toMatch(/packaged build/i);
	});
});

describe("unsupported builds", () => {
	it("reports unsupported with the given reason", () => {
		const unsupported = new UpdateController(null, {
			supported: false,
			reason: "no can do",
		});

		expect(unsupported.getStatus()).toEqual({
			kind: "unsupported",
			reason: "no can do",
		});
	});

	it("falls back to a generic reason when none is supplied", () => {
		const unsupported = new UpdateController(null, {
			supported: false,
			reason: "",
		});

		expect(unsupported.getStatus().kind).toBe("unsupported");
		expect((unsupported.getStatus() as { reason: string }).reason).not.toBe("");
	});

	it("never touches the backend", () => {
		// A backend passed alongside unsupported support must stay untouched —
		// the two disagreeing is a wiring bug, and calling through would defeat
		// the point of the guard.
		const unsupported = new UpdateController(backend, {
			supported: false,
			reason: "dev build",
		});

		unsupported.check();
		unsupported.install();

		expect(backend.checkForUpdates).not.toHaveBeenCalled();
		expect(backend.quitAndInstall).not.toHaveBeenCalled();
		expect(unsupported.getStatus().kind).toBe("unsupported");
	});
});

describe("check", () => {
	it("starts in idle", () => {
		expect(controller.getStatus()).toEqual({ kind: "idle" });
	});

	it("moves to checking and calls the backend", () => {
		controller.check();

		expect(controller.getStatus()).toEqual({ kind: "checking" });
		expect(backend.checkForUpdates).toHaveBeenCalledOnce();
	});

	it("collapses concurrent checks into one backend call", () => {
		// Two windows opening settings at once must not fire two provider
		// round-trips, and the second's response would clobber the first's.
		controller.check();
		controller.check();
		controller.check();

		expect(backend.checkForUpdates).toHaveBeenCalledOnce();
	});

	it("allows a new check once the previous one settles", () => {
		controller.check();
		backend.emit({ kind: "up-to-date" });
		controller.check();

		expect(backend.checkForUpdates).toHaveBeenCalledTimes(2);
	});

	it("allows a new check after a failure", () => {
		controller.check();
		backend.emit({ kind: "error", message: "network down" });
		controller.check();

		expect(backend.checkForUpdates).toHaveBeenCalledTimes(2);
	});

	it("does not re-check once an update is downloaded", () => {
		// `ready` is terminal until the user restarts; re-checking would walk
		// the status backwards and drop the install prompt.
		backend.emit({ kind: "ready", version: "2.0.0" });
		controller.check();

		expect(backend.checkForUpdates).not.toHaveBeenCalled();
		expect(controller.getStatus()).toEqual({ kind: "ready", version: "2.0.0" });
	});

	it("surfaces a rejected backend check as an error status", async () => {
		backend.checkForUpdates.mockRejectedValueOnce(new Error("provider 404"));

		controller.check();
		await vi.waitFor(() => {
			expect(controller.getStatus()).toEqual({
				kind: "error",
				message: "provider 404",
			});
		});
	});
});

describe("backend events", () => {
	it.each([
		[{ kind: "checking" } as const, { kind: "checking" }],
		[{ kind: "up-to-date" } as const, { kind: "up-to-date" }],
		[
			{ kind: "available", version: "3.1.0" } as const,
			{ kind: "available", version: "3.1.0" },
		],
		[
			{ kind: "ready", version: "3.1.0" } as const,
			{ kind: "ready", version: "3.1.0" },
		],
		[
			{ kind: "error", message: "boom" } as const,
			{ kind: "error", message: "boom" },
		],
	])("maps %j to the matching status", (event, expected) => {
		backend.emit(event);

		expect(controller.getStatus()).toEqual(expected);
	});

	it("carries the version through download progress", () => {
		backend.emit({ kind: "available", version: "4.0.0" });
		backend.emit({ kind: "progress", percent: 42 });

		expect(controller.getStatus()).toEqual({
			kind: "downloading",
			version: "4.0.0",
			percent: 42,
		});
	});

	it("keeps the version across successive progress ticks", () => {
		backend.emit({ kind: "available", version: "4.0.0" });
		backend.emit({ kind: "progress", percent: 10 });
		backend.emit({ kind: "progress", percent: 90 });

		expect(controller.getStatus()).toEqual({
			kind: "downloading",
			version: "4.0.0",
			percent: 90,
		});
	});

	it("tolerates progress arriving before an available event", () => {
		backend.emit({ kind: "progress", percent: 5 });

		expect(controller.getStatus()).toEqual({
			kind: "downloading",
			version: "",
			percent: 5,
		});
	});

	it.each([
		[-10, 0],
		[0, 0],
		[100, 100],
		[140, 100],
		[Number.NaN, 0],
		[Number.POSITIVE_INFINITY, 100],
	])("clamps a reported percent of %j to %j", (reported, expected) => {
		backend.emit({ kind: "progress", percent: reported });

		expect(
			(controller.getStatus() as { percent: number }).percent,
		).toBe(expected);
	});
});

describe("install", () => {
	it("quits and installs when an update is ready", () => {
		backend.emit({ kind: "ready", version: "2.0.0" });

		controller.install();

		expect(backend.quitAndInstall).toHaveBeenCalledOnce();
	});

	it.each([
		["idle", null],
		["checking", { kind: "checking" } as const],
		["available", { kind: "available", version: "2.0.0" } as const],
		["error", { kind: "error", message: "nope" } as const],
	])("refuses to install from %s", (_label, event) => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		if (event) backend.emit(event);

		controller.install();

		expect(backend.quitAndInstall).not.toHaveBeenCalled();
	});
});

describe("subscribers", () => {
	it("notifies on every status change", () => {
		const seen: DesktopUpdateStatus[] = [];
		controller.subscribe((status) => seen.push(status));

		controller.check();
		backend.emit({ kind: "available", version: "5.0.0" });
		backend.emit({ kind: "ready", version: "5.0.0" });

		expect(seen).toEqual([
			{ kind: "checking" },
			{ kind: "available", version: "5.0.0" },
			{ kind: "ready", version: "5.0.0" },
		]);
	});

	it("stops notifying after unsubscribe", () => {
		const listener = vi.fn();
		const unsubscribe = controller.subscribe(listener);

		unsubscribe();
		backend.emit({ kind: "up-to-date" });

		expect(listener).not.toHaveBeenCalled();
	});

	it("keeps notifying the rest when one subscriber throws", () => {
		// A window torn down mid-broadcast throws on send; the other windows
		// must still get their update.
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const healthy = vi.fn();
		controller.subscribe(() => {
			throw new Error("window destroyed");
		});
		controller.subscribe(healthy);

		backend.emit({ kind: "up-to-date" });

		expect(healthy).toHaveBeenCalledOnce();
	});
});

describe("ready is terminal against unsolicited backend events", () => {
	// The controller refuses to *start* a check from `ready`, but backends
	// also report on their own timers, and those arrive without anyone
	// calling check(). Clearing the prompt then tells the user there is
	// nothing to install while the downloaded artifact sits on disk.
	beforeEach(() => {
		backend.emit({ kind: "ready", version: "2.0.0" });
	});

	it.each([
		["checking", { kind: "checking" } as const],
		["up-to-date", { kind: "up-to-date" } as const],
		["available", { kind: "available", version: "2.1.0" } as const],
		["progress", { kind: "progress", percent: 12 } as const],
		["error", { kind: "error", message: "provider 500" } as const],
	])("ignores a stray %s event", (_label, event) => {
		backend.emit(event);

		expect(controller.getStatus()).toEqual({
			kind: "ready",
			version: "2.0.0",
		});
	});

	it("notifies no subscriber for an ignored event", () => {
		const seen: string[] = [];
		controller.subscribe((status) => seen.push(status.kind));

		backend.emit({ kind: "checking" });

		expect(seen).toEqual([]);
	});

	it("still accepts a newer version finishing its download", () => {
		// The one transition worth applying from `ready`: the prompt should
		// name the version the user would actually get.
		backend.emit({ kind: "ready", version: "2.1.0" });

		expect(controller.getStatus()).toEqual({
			kind: "ready",
			version: "2.1.0",
		});
	});
});
