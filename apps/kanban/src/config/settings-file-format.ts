// Which settings file to read, and how to parse it.
//
// Kanban historically stored runtime preferences as `config.json`. Power users
// asked for something hand-editable — comments, no trailing-comma traps — so
// `settings.yaml` is now the preferred format, in the same directories, with the
// same shape. This module owns that choice so `runtime-config.ts` can stay about
// settings rather than serialization.
//
// Precedence is deliberately "YAML wins when it exists" rather than "merge both".
// Two files that disagree is a support burden nobody wants, and a silent merge
// would make it impossible to answer "why is my setting not taking effect?".

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const SETTINGS_YAML_FILENAME = "settings.yaml";
export const SETTINGS_JSON_FILENAME = "config.json";

export type SettingsFileFormat = "yaml" | "json";

/** Filenames in precedence order: the first one that exists wins. */
export const SETTINGS_FILENAMES_BY_PRECEDENCE: ReadonlyArray<{
	filename: string;
	format: SettingsFileFormat;
}> = [
	{ filename: SETTINGS_YAML_FILENAME, format: "yaml" },
	{ filename: SETTINGS_JSON_FILENAME, format: "json" },
];

/**
 * Format implied by a path's extension.
 *
 * Anything that is not `.json` is treated as YAML, because YAML is the format we
 * want new files to be in and JSON is the legacy exception. A caller that hands
 * us `config.json` gets JSON; everything else — including an extensionless path —
 * gets YAML.
 */
export function settingsFormatForPath(path: string): SettingsFileFormat {
	return path.toLowerCase().endsWith(".json") ? "json" : "yaml";
}

/**
 * Parse settings file contents.
 *
 * Returns `null` for unparseable input rather than throwing. A corrupt settings
 * file must not stop Kanban from starting — the caller falls back to defaults,
 * which is recoverable, where a crash on boot is not.
 *
 * Note that YAML is a superset of JSON, so the YAML parser reads legacy
 * `config.json` correctly too. The formats are kept separate anyway so that a
 * `.json` file always round-trips as JSON and never gets rewritten as YAML
 * behind the user's back.
 */
export function parseSettingsFileContent<T>(raw: string, format: SettingsFileFormat): T | null {
	try {
		const parsed = format === "json" ? JSON.parse(raw) : parseYaml(raw);
		// A YAML document containing only comments parses to null, and a scalar
		// document parses to a string or number. Neither is a settings object.
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			return null;
		}
		return parsed as T;
	} catch {
		return null;
	}
}

/** Serialize settings for writing. JSON keeps the 2-space shape files already use. */
export function serializeSettingsFileContent(payload: unknown, format: SettingsFileFormat): string {
	if (format === "json") {
		return JSON.stringify(payload, null, 2);
	}
	// `lineWidth: 0` disables line folding. Folded prompt templates are still
	// valid YAML but are miserable to hand-edit, which defeats the point of
	// offering YAML at all.
	return stringifyYaml(payload, { lineWidth: 0 });
}
