import { describe, expect, it } from "vitest";

import {
	DESKTOP_BRIDGE_VERSION,
	DESKTOP_CAPABILITIES,
	MIN_SUPPORTED_DESKTOP_BRIDGE_VERSION,
	isDesktopCapability,
	parseBridgeBootstrap,
	toDesktopPlatform,
} from "../src/contract.js";

describe("toDesktopPlatform", () => {
	it.each(["darwin", "win32", "linux"] as const)(
		"passes %s through unchanged",
		(platform) => {
			expect(toDesktopPlatform(platform)).toBe(platform);
		},
	);

	it.each([
		["macos", "darwin"],
		["windows", "win32"],
	] as const)("normalises Tauri's %s to %s", (tauriName, expected) => {
		// Tauri's `platform()` and Node's `process.platform` disagree on the
		// spelling of the same two targets. The web UI branches on the Node
		// spelling, so the boundary has to accept both.
		expect(toDesktopPlatform(tauriName)).toBe(expected);
	});

	it.each(["freebsd", "aix", "sunos", "android", ""])(
		"collapses unsupported platform %j to 'other'",
		(platform) => {
			expect(toDesktopPlatform(platform)).toBe("other");
		},
	);
});

describe("isDesktopCapability", () => {
	it("accepts every declared capability", () => {
		for (const capability of DESKTOP_CAPABILITIES) {
			expect(isDesktopCapability(capability)).toBe(true);
		}
	});

	it("rejects unknown strings and non-strings", () => {
		expect(isDesktopCapability("teleportation")).toBe(false);
		expect(isDesktopCapability("")).toBe(false);
		expect(isDesktopCapability(null)).toBe(false);
		expect(isDesktopCapability(42)).toBe(false);
		expect(isDesktopCapability(["windows"])).toBe(false);
	});
});

describe("parseBridgeBootstrap", () => {
	it("accepts a well-formed handshake", () => {
		expect(
			parseBridgeBootstrap({
				appVersion: "1.2.3",
				capabilities: ["windows", "runtime"],
			}),
		).toEqual({ appVersion: "1.2.3", capabilities: ["windows", "runtime"] });
	});

	it("drops capabilities this build does not recognise", () => {
		// Forward compatibility: a newer host advertising a capability we've
		// never heard of must stay usable for the ones we do know.
		expect(
			parseBridgeBootstrap({
				appVersion: "2.0.0",
				capabilities: ["windows", "teleportation", "runtime"],
			}),
		).toEqual({ appVersion: "2.0.0", capabilities: ["windows", "runtime"] });
	});

	it.each([
		["a primitive", "hello"],
		["null", null],
		["undefined", undefined],
		["an array", ["windows"]],
		["a missing appVersion", { capabilities: [] }],
		["a non-string appVersion", { appVersion: 3, capabilities: [] }],
		["a missing capabilities field", { appVersion: "1.0.0" }],
		[
			"a non-array capabilities field",
			{ appVersion: "1.0.0", capabilities: "windows" },
		],
	])("returns null for %s", (_label, payload) => {
		expect(parseBridgeBootstrap(payload)).toBeNull();
	});

	it("preserves a version string containing characters that need escaping", () => {
		// The handshake crosses the host boundary as structured data now rather
		// than a percent-encoded argv entry, so quoting can no longer truncate
		// it — this pins that.
		const appVersion = '1.0.0-beta "one two" =x&y';

		expect(
			parseBridgeBootstrap({ appVersion, capabilities: [] })?.appVersion,
		).toBe(appVersion);
	});
});

describe("version constants", () => {
	it("keeps the minimum supported version reachable by the current build", () => {
		// A minimum above the current version would make every host look
		// unsupported to its own renderer.
		expect(MIN_SUPPORTED_DESKTOP_BRIDGE_VERSION).toBeLessThanOrEqual(
			DESKTOP_BRIDGE_VERSION,
		);
	});
});
