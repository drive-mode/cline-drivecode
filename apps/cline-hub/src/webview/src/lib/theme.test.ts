import { describe, expect, it } from "vitest";
import { resolveSystemHubTheme } from "./theme";

describe("resolveSystemHubTheme", () => {
	it("prefers the VS Code theme kind when present", () => {
		expect(resolveSystemHubTheme("vscode-dark", false)).toBe("dark");
		expect(resolveSystemHubTheme("vscode-light", true)).toBe("light");
		expect(resolveSystemHubTheme("vscode-high-contrast", false)).toBe("dark");
	});

	it("falls back to prefers-color-scheme when no VS Code signal exists", () => {
		expect(resolveSystemHubTheme(undefined, true)).toBe("dark");
		expect(resolveSystemHubTheme(undefined, false)).toBe("light");
		expect(resolveSystemHubTheme("", true)).toBe("dark");
	});
});
