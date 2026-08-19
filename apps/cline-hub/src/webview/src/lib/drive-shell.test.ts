import { describe, expect, it } from "vitest";
import {
	appShellHomeRedirect,
	drivePath,
	legacyChatOrSessionsRedirect,
	parseDriveAppShell,
	parseDriveBrowse,
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
		expect(drivePath({ sessionId: "s1", preserveSearch: "app=1" })).toBe(
			"/drive?app=1&id=s1",
		);
	});
});

describe("parseDriveAppShell", () => {
	it("is true only for app=1", () => {
		expect(parseDriveAppShell("")).toBe(false);
		expect(parseDriveAppShell("?app=0")).toBe(false);
		expect(parseDriveAppShell("?app=1")).toBe(true);
		expect(parseDriveAppShell("?demoPlans=1&app=1")).toBe(true);
	});
});

describe("parseDriveBrowse / drivePath browse", () => {
	it("accepts only known surfaces", () => {
		expect(parseDriveBrowse("?browse=tasks")).toBe("tasks");
		expect(parseDriveBrowse("?browse=status")).toBe("status");
		expect(parseDriveBrowse("?browse=analytics")).toBeUndefined();
		expect(parseDriveBrowse("")).toBeUndefined();
	});

	it("sets and clears browse on lobby URLs", () => {
		expect(drivePath({ browse: "artifacts", preserveSearch: "app=1" })).toBe(
			"/drive?app=1&browse=artifacts",
		);
		expect(
			drivePath({ browse: null, preserveSearch: "app=1&browse=tasks" }),
		).toBe("/drive?app=1");
		expect(
			drivePath({ sessionId: "s1", preserveSearch: "app=1&browse=tasks" }),
		).toBe("/drive?app=1&id=s1");
	});
});

describe("appShellHomeRedirect", () => {
	it("is inert without app=1", () => {
		expect(appShellHomeRedirect("/")).toBeNull();
		expect(appShellHomeRedirect("/", "?demoPlans=1")).toBeNull();
	});

	it("leaves /drive alone and maps home/settings onto lobby", () => {
		expect(appShellHomeRedirect("/drive", "?app=1")).toBeNull();
		expect(appShellHomeRedirect("/drive", "?app=1&id=s1")).toBeNull();
		expect(appShellHomeRedirect("/", "?app=1")).toBe("/drive?app=1");
		expect(appShellHomeRedirect("/status", "?app=1&demoPlans=1")).toBe(
			"/drive?app=1&demoPlans=1",
		);
	});

	it("still maps legacy /chat onto call", () => {
		expect(appShellHomeRedirect("/chat", "?app=1&id=s1")).toBe(
			"/drive?app=1&id=s1",
		);
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
