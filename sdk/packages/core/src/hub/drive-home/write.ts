/**
 * Persist a Driveagent home patch to disk (FS boundary for DRV-DRIVEAGENT-HOME).
 *
 * The merge target is always the home re-read from disk here, never anything
 * the caller supplied. That is the whole point: the browser is shown a home
 * with its prompt, provider and model stripped (DRV-PRIVACY), so a payload
 * built from what the browser saw is missing fields whose absence would make
 * `agent.yaml` fail its own schema on the next read. Merging server-side
 * against the real file is what turns "the editor did not send it" back into
 * "it did not change".
 *
 * The merged home is re-parsed through the shared zod schemas before a single
 * byte is written, and then the rendered YAML is parsed back and compared to
 * it — see `assertRendersBackTo`. Validating the merged object alone would
 * only prove the intent was sound; the bytes are what the loader reads.
 */

import {
	chmodSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type DriveagentHomeFileTexts,
	DriveagentHomeWriteError,
	mergeDriveagentHomePatch,
	serializeDriveagentHome,
} from "@cline/drive";
import { type DriveagentHome, parseDriveagentHome } from "@cline/shared";
import YAML from "yaml";
import { DriveagentHomeLoadError, loadDriveagentHome } from "./load";
import {
	DRIVEAGENT_AGENT_YAML,
	DRIVEAGENT_ENV_YAML,
	DRIVEAGENT_PERMISSIONS_YAML,
	type DriveagentHomeTier,
} from "./resolve";

export type WrittenDriveagentHome = {
	readonly home: DriveagentHome;
	readonly homePath: string;
	readonly tier: DriveagentHomeTier;
	/** File names actually rewritten; unchanged files are left alone. */
	readonly changedFiles: readonly string[];
};

function readTextOrUndefined(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Stage every changed file, then swap them all in — all or nothing.
 *
 * A home is three files that have to agree, so the risky moment is the gap
 * between the first write and the last. Staging every file first shrinks that
 * gap to a run of renames, the operations least likely to fail once the content
 * is already on the volume, and a failure while staging aborts before anything
 * user-visible has moved.
 *
 * A rename can still fail partway — on Windows an editor or indexer holding the
 * target open is enough. That would leave a new `agent.yaml` beside a stale
 * `permissions.yaml`, each valid alone and wrong together. So the previous text
 * of every file travels with it, and a failed rename puts the ones that already
 * landed back the way they were. Temp files are cleaned up on every path, so a
 * failed save leaves no litter in a directory the user has checked into git.
 */
function commitFiles(
	files: readonly { path: string; text: string; previousText?: string }[],
): void {
	const staged: { tempPath: string; path: string }[] = [];
	const discardStaged = (from: number): void => {
		for (const entry of staged.slice(from)) {
			try {
				rmSync(entry.tempPath, { force: true });
			} catch {
				// best-effort
			}
		}
	};

	try {
		for (const file of files) {
			const tempPath = `${file.path}.tmp-${process.pid}-${Date.now()}-${staged.length}`;
			writeFileSync(tempPath, file.text, "utf8");
			// Carry the original's mode across. The temp is a fresh file, so
			// without this a `chmod 600` on a home file silently widens to the
			// directory default on the first save.
			try {
				chmodSync(tempPath, statSync(file.path).mode);
			} catch {
				// No original to copy from, or a platform that does not care.
			}
			staged.push({ tempPath, path: file.path });
		}
	} catch (error) {
		discardStaged(0);
		throw error;
	}

	for (let index = 0; index < staged.length; index += 1) {
		try {
			renameSync(staged[index].tempPath, staged[index].path);
		} catch (error) {
			// Put back the ones that already landed, so the three files stay
			// mutually consistent, then clear the temps still waiting.
			for (let done = 0; done < index; done += 1) {
				const previous = files[done].previousText;
				if (previous === undefined) {
					continue;
				}
				try {
					writeFileSync(files[done].path, previous, "utf8");
				} catch {
					// best-effort; the throw below still reports the failure
				}
			}
			discardStaged(index);
			throw error;
		}
	}
}

/**
 * Read the rendered YAML back and require it to mean what the merge decided.
 *
 * Validating the merged object proves the *intent* was sound. It says nothing
 * about the bytes, and the bytes are what the loader reads — so a serializer
 * that drops a key, resolves an alias to the wrong scalar, or emits a value it
 * cannot parse back would sail past a check on the object and corrupt the file
 * silently. Comparing the round trip turns that entire class of bug into a
 * refusal with nothing written.
 */
function assertRendersBackTo(
	texts: DriveagentHomeFileTexts,
	expected: DriveagentHome,
): void {
	let reparsed: DriveagentHome;
	try {
		reparsed = parseDriveagentHome({
			slug: expected.slug,
			agent: YAML.parse(texts.agentYaml),
			permissions: YAML.parse(texts.permissionsYaml),
			env: YAML.parse(texts.envYaml),
		});
	} catch (error) {
		// `invalid_home`, not `invalid_patch`: a YAML parse failure embeds a
		// code frame of the offending source line, which here is a line of the
		// home being written — plausibly the prompt. That message must not be
		// relayable to a browser, and the code is what marks it.
		throw new DriveagentHomeWriteError(
			"invalid_home",
			`refusing to write a home that does not parse back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (JSON.stringify(reparsed) !== JSON.stringify(expected)) {
		throw new DriveagentHomeWriteError(
			"invalid_home",
			"refusing to write: the rendered YAML does not read back as the merged home",
		);
	}
}

/**
 * Merge `patch` onto the on-disk home for `slug` and persist the result.
 *
 * Throws {@link DriveagentHomeLoadError} when the home is missing or already
 * invalid, and {@link DriveagentHomeWriteError} when the patch is refused —
 * a non-editable agent, a field the read path never showed, or a plaintext
 * secret. Nothing is written on either path.
 */
export function writeDriveagentHome(input: {
	workspaceRoot: string;
	slug: string;
	patch: unknown;
	userHomeDir?: string;
}): WrittenDriveagentHome {
	const loaded = loadDriveagentHome({
		workspaceRoot: input.workspaceRoot,
		slug: input.slug,
		userHomeDir: input.userHomeDir,
	});

	const merged = mergeDriveagentHomePatch({
		current: loaded.home,
		patch: input.patch,
	});

	// Re-parse through the shared schemas rather than trusting the merge: this
	// is the assertion that the bytes about to be written will load again,
	// including the `systemPrompt || promptPath` refinement and the plaintext
	// secret ban in env.yaml.
	let validated: DriveagentHome;
	try {
		validated = parseDriveagentHome(merged);
	} catch (error) {
		// Also `invalid_home` — zod's message names the failing field of the
		// merged home, and the merge is mostly on-disk content.
		throw new DriveagentHomeWriteError(
			"invalid_home",
			`merged home is not a valid Driveagent home: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const paths = {
		agentYaml: join(loaded.homePath, DRIVEAGENT_AGENT_YAML),
		permissionsYaml: join(loaded.homePath, DRIVEAGENT_PERMISSIONS_YAML),
		envYaml: join(loaded.homePath, DRIVEAGENT_ENV_YAML),
	} as const;
	const previous = {
		agentYaml: readTextOrUndefined(paths.agentYaml),
		permissionsYaml: readTextOrUndefined(paths.permissionsYaml),
		envYaml: readTextOrUndefined(paths.envYaml),
	};

	const next = serializeDriveagentHome(validated, previous);
	assertRendersBackTo(next, validated);

	// Render all three before writing any, so a serialisation failure leaves
	// disk exactly as it was rather than half-updated. Files whose bytes did
	// not change are skipped, which is what lets a comment in an untouched
	// permissions.yaml survive an agent.yaml edit.
	const changedFiles: string[] = [];
	const pending: { path: string; text: string; previousText?: string }[] = [];
	const files: [keyof DriveagentHomeFileTexts, string, string][] = [
		["agentYaml", paths.agentYaml, DRIVEAGENT_AGENT_YAML],
		["permissionsYaml", paths.permissionsYaml, DRIVEAGENT_PERMISSIONS_YAML],
		["envYaml", paths.envYaml, DRIVEAGENT_ENV_YAML],
	];
	for (const [key, path, fileName] of files) {
		const text = next[key];
		if (previous[key] === text) {
			continue;
		}
		// The previous text travels with the write so a rename that fails
		// partway can put the files that already landed back.
		pending.push({ path, text, previousText: previous[key] });
		changedFiles.push(fileName);
	}
	commitFiles(pending);

	return {
		home: validated,
		homePath: loaded.homePath,
		tier: loaded.tier,
		changedFiles,
	};
}
