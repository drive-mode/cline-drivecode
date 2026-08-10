import { describe, expect, it } from "vitest";

import {
	parseSettingsFileContent,
	SETTINGS_FILENAMES_BY_PRECEDENCE,
	serializeSettingsFileContent,
	settingsFormatForPath,
} from "../../../src/config/settings-file-format";

describe("settingsFormatForPath", () => {
	it("treats .json as json and everything else as yaml", () => {
		expect(settingsFormatForPath("/a/b/config.json")).toBe("json");
		expect(settingsFormatForPath("/a/b/settings.yaml")).toBe("yaml");
		expect(settingsFormatForPath("/a/b/settings.yml")).toBe("yaml");
	});

	it("is case-insensitive about the extension", () => {
		expect(settingsFormatForPath("/a/b/CONFIG.JSON")).toBe("json");
	});
});

describe("SETTINGS_FILENAMES_BY_PRECEDENCE", () => {
	it("prefers yaml over the legacy json file", () => {
		expect(SETTINGS_FILENAMES_BY_PRECEDENCE.map((entry) => entry.filename)).toEqual(["settings.yaml", "config.json"]);
	});
});

describe("parseSettingsFileContent", () => {
	it("parses yaml", () => {
		const parsed = parseSettingsFileContent<{ selectedAgentId: string }>("selectedAgentId: claude\n", "yaml");
		expect(parsed).toEqual({ selectedAgentId: "claude" });
	});

	it("parses json", () => {
		const parsed = parseSettingsFileContent<{ selectedAgentId: string }>('{"selectedAgentId":"codex"}', "json");
		expect(parsed).toEqual({ selectedAgentId: "codex" });
	});

	it("keeps comments out of the parsed result", () => {
		const parsed = parseSettingsFileContent<{ agentAutonomousModeEnabled: boolean }>(
			"# why this is off\nagentAutonomousModeEnabled: false\n",
			"yaml",
		);
		expect(parsed).toEqual({ agentAutonomousModeEnabled: false });
	});

	// A corrupt settings file must not stop the runtime from starting. Returning
	// null lets the caller fall back to defaults, which is recoverable; throwing
	// on boot is not.
	it("returns null for malformed input rather than throwing", () => {
		expect(parseSettingsFileContent("{ not: valid: yaml: at: all", "yaml")).toBeNull();
		expect(parseSettingsFileContent("{oops", "json")).toBeNull();
	});

	it("returns null for documents that are not settings objects", () => {
		expect(parseSettingsFileContent("# only a comment\n", "yaml")).toBeNull();
		expect(parseSettingsFileContent("just a string", "yaml")).toBeNull();
		expect(parseSettingsFileContent("[1, 2, 3]", "yaml")).toBeNull();
		expect(parseSettingsFileContent("null", "json")).toBeNull();
	});
});

describe("serializeSettingsFileContent", () => {
	it("round-trips through yaml", () => {
		const value = { selectedAgentId: "claude", agentAutonomousModeEnabled: false };
		const raw = serializeSettingsFileContent(value, "yaml");
		expect(parseSettingsFileContent(raw, "yaml")).toEqual(value);
	});

	it("round-trips through json", () => {
		const value = { shortcuts: [{ label: "dev", command: "npm run dev" }] };
		const raw = serializeSettingsFileContent(value, "json");
		expect(parseSettingsFileContent(raw, "json")).toEqual(value);
	});

	it("keeps json at the two-space shape existing files use", () => {
		expect(serializeSettingsFileContent({ a: 1 }, "json")).toBe('{\n  "a": 1\n}');
	});

	// Folded lines are valid YAML but miserable to hand-edit, which defeats the
	// point of offering YAML. Prompt templates are the long values in practice.
	it("does not fold long values onto continuation lines", () => {
		const longTemplate = `Commit the working changes onto {{base_ref}}. ${"word ".repeat(60)}`;
		const raw = serializeSettingsFileContent({ commitPromptTemplate: longTemplate }, "yaml");
		const valueLines = raw.split("\n").filter((line) => line.trim().length > 0);
		expect(valueLines).toHaveLength(1);
		expect(parseSettingsFileContent<{ commitPromptTemplate: string }>(raw, "yaml")?.commitPromptTemplate).toBe(
			longTemplate,
		);
	});

	it("round-trips multi-line prompt templates", () => {
		const value = { commitPromptTemplate: "line one\nline two\n\nline four" };
		const raw = serializeSettingsFileContent(value, "yaml");
		expect(parseSettingsFileContent(raw, "yaml")).toEqual(value);
	});
});
