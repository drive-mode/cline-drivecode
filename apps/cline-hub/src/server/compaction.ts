import type { CoreCompactionConfig, GlobalCompactionMode } from "@cline/core";
import { readCompactionModeGlobally } from "@cline/core";

/**
 * Maps a CLI/global compaction mode onto Core session config.
 *
 * When `mode` is undefined (neither flag nor persisted setting), returns
 * `{ enabled: true }` — the same CLI-ish default as
 * `buildCliCompactionConfig(undefined)`, so Core applies its agentic strategy.
 */
export function buildHubCompactionConfig(
	mode?: GlobalCompactionMode,
): CoreCompactionConfig {
	if (mode === undefined) {
		return { enabled: true };
	}
	if (mode === "off") {
		return { enabled: false };
	}
	return { enabled: true, strategy: mode };
}

/**
 * Hub Chat session compaction: honor the shared global setting when set,
 * otherwise the CLI-ish enabled default.
 */
export function resolveHubSessionCompaction(): CoreCompactionConfig {
	return buildHubCompactionConfig(readCompactionModeGlobally());
}
