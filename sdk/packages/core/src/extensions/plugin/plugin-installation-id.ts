import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";

/**
 * Derive a host-owned identity for one installed plugin entry. The path and
 * entry bytes bind state to this installation and prevent a same-name
 * replacement from inheriting state automatically.
 */
export function resolvePluginInstallationId(
	pluginPath: string,
	displayName: string,
): string {
	const canonicalPath = realpathSync(pluginPath);
	const digest = createHash("sha256")
		.update(canonicalPath)
		.update("\0")
		.update(readFileSync(canonicalPath))
		.update("\0")
		.update(displayName)
		.digest("hex");
	return `plugin-${digest}`;
}
