import { describe, expect, it } from "vitest";
import {
	drivePath,
	legacyChatOrSessionsRedirect,
	parseDriveSessionId,
	parseDriveShellMode,
} from "./drive-shell";

describe("drivePath", () => {
	it("defaults to lobby /drive", () => {
		expect(drivePath()).toBe("/drive");
		expect(drivePath({ mode: "lobby" })).toBe("/drive");
		expect(drivePath({ mode: "call" })).toBe("/drive");
	});

	it("encodes history and session id", () => {
		expect(drivePath({ mode: "history" })).toBe("/drive?mode=history");
		expect(drivePath({ sessionId: "abc" })).toBe("/drive?id=abc");
		expect(drivePath({ mode: "history", sessionId: "abc" })).toBe(
			"/drive?id=abc",
		);
	});

	it("preserves unrelated search params", () => {
		expect(drivePath({ preserveSearch: "demoSessions=1" })).toBe(
			"/drive?demoSessions=1",
		);
		expect(
			drivePath({ mode: "history", preserveSearch: "?demoSessions=1&id=x" }),
		).toBe("/drive?demoSessions=1&mode=history");
	});
});

describe("parseDriveShellMode", () => {
	it("reads session id as call and mode=history as history", () => {
		expect(parseDriveShellMode("")).toBe("lobby");
		expect(parseDriveShellMode("?id=s1")).toBe("call");
		expect(parseDriveShellMode("?mode=history")).toBe("history");
		expect(parseDriveShellMode("?mode=history&id=s1")).toBe("call");
		expect(parseDriveShellMode("", { forceCall: true })).toBe("call");
	});
});

describe("parseDriveSessionId", () => {
	it("returns trimmed id or undefined", () => {
		expect(parseDriveSessionId("?id=  s1  ")).toBe("s1");
		expect(parseDriveSessionId("")).toBeUndefined();
	});
});

describe("legacyChatOrSessionsRedirect", () => {
	it("maps /chat and /sessions onto /drive", () => {
		expect(legacyChatOrSessionsRedirect("/chat")).toBe("/drive");
		expect(legacyChatOrSessionsRedirect("/chat", "?id=s1")).toBe(
			"/drive?id=s1",
		);
		expect(legacyChatOrSessionsRedirect("/sessions")).toBe(
			"/drive?mode=history",
		);
		expect(legacyChatOrSessionsRedirect("/sessions", "?demoPlans=1")).toBe(
			"/drive?demoPlans=1&mode=history",
		);
		expect(legacyChatOrSessionsRedirect("/drive")).toBeNull();
		expect(legacyChatOrSessionsRedirect("/")).toBeNull();
	});
});
