/**
 * Hub drive_agent_home_get / drive_agent_home_put over `.driveagent/<slug>/`.
 *
 * The put lane never receives a whole home — only a patch, merged server-side
 * against the file on disk (see `../../drive-home/write`). A payload that
 * names a field the read path strips is refused rather than merged, because
 * the browser it came from was never shown that field's value.
 *
 * `workspaceRoot` on the put lane is pinned to the workspace this hub is bound
 * to — see `assertWorkspaceInBounds`.
 */

import { resolve } from "node:path";
import {
	compileDriveagentHome,
	DriveagentHomeCompileError,
	DriveagentHomeWriteError,
} from "@cline/drive";
import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { getDriveRoomStore } from "../../collaboration";
import {
	DriveagentHomeLoadError,
	loadDriveagentHome,
	writeDriveagentHome,
} from "../../drive-home";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Same workspace, tolerating separator and drive-letter-case differences —
 * matches `sameWorkspaceRoot` in `drive-handlers.ts`.
 */
function sameWorkspaceRoot(a: string, b: string): boolean {
	const normalize = (path: string) => {
		const resolved = resolve(path);
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	};
	return normalize(a) === normalize(b);
}

/**
 * The write must land in the workspace this hub is bound to.
 *
 * `workspaceRoot` arrives in the payload, and on the browser lane it arrives
 * from a page. Unchecked, it names any directory on the host that already
 * holds a `.driveagent/<slug>/agent.yaml`, which turns a config editor into a
 * writer for other people's repositories. The bound root is the same anchor
 * `drive_artifacts_list` uses to keep a *read* inside the workspace.
 *
 * When nothing is bound yet there is no workspace to be outside of, and the
 * write proceeds — refusing instead would break every save made before a room
 * is joined, and the browser cannot influence whether the hub is bound. That
 * makes this a containment check rather than an authorization one; per-peer
 * authority does not exist at this layer yet.
 *
 * Returns an error reply, or undefined when the write may proceed.
 */
function assertWorkspaceInBounds(
	envelope: HubCommandEnvelope,
	workspaceRoot: string,
): HubReplyEnvelope | undefined {
	const boundRoot = getDriveRoomStore().getEventLog().configParent;
	if (boundRoot && !sameWorkspaceRoot(boundRoot, workspaceRoot)) {
		return errorReply(
			envelope,
			"workspace_not_bound",
			"workspaceRoot must be the workspace this hub is bound to",
		);
	}
	return undefined;
}

export async function handleDriveHomeCommand(
	_ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	switch (envelope.command) {
		case "drive_agent_home_get":
			return handleDriveAgentHomeGet(envelope);
		case "drive_agent_home_put":
			return handleDriveAgentHomePut(envelope);
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive home command: ${envelope.command}`,
			);
	}
}

function handleDriveAgentHomeGet(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const workspaceRoot = readString(envelope.payload, "workspaceRoot");
	const slug = readString(envelope.payload, "slug");
	if (!workspaceRoot) {
		return errorReply(envelope, "invalid_payload", "workspaceRoot is required");
	}
	if (!slug) {
		return errorReply(envelope, "invalid_payload", "slug is required");
	}

	try {
		const loaded = loadDriveagentHome({ workspaceRoot, slug });
		const compiled = compileDriveagentHome(loaded.home);
		return okReply(envelope, {
			home: loaded.home,
			compiled,
		});
	} catch (error) {
		return homeErrorReply(envelope, error);
	}
}

function handleDriveAgentHomePut(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const workspaceRoot = readString(envelope.payload, "workspaceRoot");
	const slug = readString(envelope.payload, "slug");
	if (!workspaceRoot) {
		return errorReply(envelope, "invalid_payload", "workspaceRoot is required");
	}
	if (!slug) {
		return errorReply(envelope, "invalid_payload", "slug is required");
	}
	const patch = envelope.payload?.patch;
	if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
		return errorReply(envelope, "invalid_payload", "patch object is required");
	}
	const outOfBounds = assertWorkspaceInBounds(envelope, workspaceRoot);
	if (outOfBounds) {
		return outOfBounds;
	}

	try {
		const written = writeDriveagentHome({ workspaceRoot, slug, patch });
		const compiled = compileDriveagentHome(written.home);
		return okReply(envelope, {
			home: written.home,
			compiled,
			changedFiles: written.changedFiles,
			// Which tier the write landed in. A workspace-shaped request can
			// resolve to `~/.driveagent/` when the workspace has no home of its
			// own, and a machine-wide edit should not look like a local one.
			tier: written.tier,
		});
	} catch (error) {
		return homeErrorReply(envelope, error);
	}
}

function homeErrorReply(
	envelope: HubCommandEnvelope,
	error: unknown,
): HubReplyEnvelope {
	if (
		error instanceof DriveagentHomeLoadError ||
		error instanceof DriveagentHomeCompileError ||
		error instanceof DriveagentHomeWriteError
	) {
		return errorReply(envelope, error.code, error.message);
	}
	return errorReply(
		envelope,
		"invalid_home",
		error instanceof Error ? error.message : String(error),
	);
}
