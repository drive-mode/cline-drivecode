import type { DriveArtifactDirectoryEntry } from "@cline/drive";

/**
 * Port for the Artifacts page. Live hub or demo adapter — the view must not
 * read CLINE_DEMO_* or query params itself (same rule as the Rooms and Status
 * Hub sources; the composition root decides which adapter it gets).
 *
 * The workspace root is passed per call rather than captured at construction,
 * for the same reason the Rooms source does it: the hub learns the root
 * asynchronously, so a source that closed over it would bind whatever was known
 * at mount and never retry.
 *
 * Read-only by design. The corpus is written by the hub as the director
 * presents, and it is bytes-free — the entries carry a produce recipe, never a
 * rendered image (DRV-PRIVACY).
 */
export interface DriveArtifactsSource {
	listArtifacts(workspaceRoot: string): Promise<DriveArtifactDirectoryEntry[]>;
}

/**
 * A list that failed, carrying the hub's error code.
 *
 * The page has to tell two rejections apart. `workspace_not_bound` means the
 * hub has no corpus for this root yet — nothing has been presented, or no Drive
 * call has bound the log — which is an empty page, not a failure. Everything
 * else is a real error and earns the banner. Without the code the page would
 * greet a cold hub with a red "could not load" for the ordinary case of having
 * produced nothing yet.
 */
export class DriveArtifactsListError extends Error {
	readonly code: string | undefined;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "DriveArtifactsListError";
		this.code = code;
	}
}

/** True when the hub simply has no corpus bound for this workspace yet. */
export function isWorkspaceUnboundError(cause: unknown): boolean {
	return (
		cause instanceof DriveArtifactsListError &&
		cause.code === "workspace_not_bound"
	);
}
