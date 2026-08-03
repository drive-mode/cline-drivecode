/**
 * Webview bridge for the durable per-agent appearance map (DRV-AGENT-PROFILE).
 *
 * `agent.appearance` already persists in `catalog-facets.v1.json`, and the hub
 * already reads it back through `drive_config_get` and writes it through
 * `drive_config_upsert_profile`. Neither had a caller outside the hub, so a
 * colour a user picked in the browser lived in that browser's localStorage and
 * nowhere else — it did not survive a different machine, and a cleared profile
 * lost it. These two lanes are the missing wire.
 */

import {
	type AgentProfile,
	AgentProfileSchema,
	type HubCommandName,
} from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DriveAgentProfilesGetWebviewFrame = {
	type: "drive_agent_profiles_get";
	workspaceRoot: string;
	requestId?: string;
	[key: string]: unknown;
};

export type DriveAgentProfilePutWebviewFrame = {
	type: "drive_agent_profile_put";
	workspaceRoot: string;
	profile?: unknown;
	requestId?: string;
	[key: string]: unknown;
};

/**
 * Error codes whose message repeats something the browser already sent.
 *
 * Same reasoning as the Driveagent home lane: anything else can quote disk
 * content or an absolute path, and relaying it through the error channel would
 * undo what the success channel is careful about.
 */
const RELAYABLE_ERROR_CODES = new Set([
	"invalid_payload",
	"hub_disconnected",
	"map_facet_rejected",
	"unknown_facet",
]);

const OPAQUE_ERROR_TEXT =
	"Agent appearance could not be read or written. Check the hub log for details.";

function sendProfilesError(
	ctx: HubContext,
	peer: BrowserPeer,
	requestId: string | undefined,
	text: string,
	code?: string,
): void {
	ctx.send(peer, {
		type: "drive_agent_profiles_error",
		text: code && RELAYABLE_ERROR_CODES.has(code) ? text : OPAQUE_ERROR_TEXT,
		code,
		requestId,
	});
}

/**
 * Re-validate every profile on the way out.
 *
 * `catalog-facets.v1.json` is hand-editable, git-mergeable JSON, so a trusted
 * relay would hand whatever a merge conflict left behind straight to a browser
 * that then paints with it. Rows that fail are dropped, not repaired — a
 * half-parsed appearance is not an appearance.
 */
function sanitizeProfiles(value: unknown): AgentProfile[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const profiles: AgentProfile[] = [];
	for (const entry of value) {
		const parsed = AgentProfileSchema.safeParse(entry);
		if (parsed.success) {
			profiles.push(parsed.data);
		}
	}
	return profiles;
}

function resolveWorkspaceRoot(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: { workspaceRoot?: unknown },
	requestId: string | undefined,
): string | undefined {
	if (!ctx.uiClient) {
		sendProfilesError(
			ctx,
			peer,
			requestId,
			"Hub is not connected.",
			"hub_disconnected",
		);
		return undefined;
	}
	const workspaceRoot =
		typeof frame.workspaceRoot === "string" ? frame.workspaceRoot.trim() : "";
	if (!workspaceRoot) {
		sendProfilesError(
			ctx,
			peer,
			requestId,
			"workspaceRoot is required.",
			"invalid_payload",
		);
		return undefined;
	}
	return workspaceRoot;
}

/** Bridges the Drive surfaces to hub `drive_config_get`, profiles lane only. */
export async function handleDriveAgentProfilesGetWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveAgentProfilesGetWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;
	const workspaceRoot = resolveWorkspaceRoot(ctx, peer, frame, requestId);
	if (!workspaceRoot || !ctx.uiClient) {
		return;
	}

	try {
		const reply = await ctx.uiClient.command(
			"drive_config_get" as HubCommandName,
			{ workspaceRoot },
		);
		if (!reply.ok) {
			sendProfilesError(
				ctx,
				peer,
				requestId,
				reply.error?.message ?? "Agent appearance read failed.",
				reply.error?.code,
			);
			return;
		}
		ctx.send(peer, {
			type: "drive_agent_profiles",
			profiles: sanitizeProfiles(reply.payload?.profiles),
			requestId,
		});
	} catch (error) {
		sendProfilesError(
			ctx,
			peer,
			requestId,
			error instanceof Error ? error.message : String(error),
			"drive_config_get_failed",
		);
	}
}

/**
 * Bridges an appearance edit to hub `drive_config_upsert_profile`.
 *
 * The reply carries the whole map rather than the one profile that changed, so
 * a browser that saves and a browser that only reloaded converge on the same
 * state without a second round trip.
 */
export async function handleDriveAgentProfilePutWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveAgentProfilePutWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;
	const workspaceRoot = resolveWorkspaceRoot(ctx, peer, frame, requestId);
	if (!workspaceRoot || !ctx.uiClient) {
		return;
	}

	// Validated here so a malformed ink is refused at the first boundary that
	// can see it came from a browser; the hub re-parses it regardless.
	const parsed = AgentProfileSchema.omit({ id: true }).safeParse(frame.profile);
	if (!parsed.success) {
		sendProfilesError(
			ctx,
			peer,
			requestId,
			parsed.error.issues[0]?.message ?? "profile is invalid.",
			"invalid_payload",
		);
		return;
	}

	try {
		const reply = await ctx.uiClient.command(
			"drive_config_upsert_profile" as HubCommandName,
			{ workspaceRoot, profile: parsed.data },
		);
		if (!reply.ok) {
			sendProfilesError(
				ctx,
				peer,
				requestId,
				reply.error?.message ?? "Agent appearance save failed.",
				reply.error?.code,
			);
			return;
		}
		// Read back so the reply describes what was stored rather than what was
		// asked for — the whole point of a durable appearance is that the disk
		// answers, not the request. If the read fails the write still happened,
		// so fall back to the profile the upsert returned: an empty list would
		// read to the browser as "nothing is stored", which is the opposite of
		// what just occurred.
		const readBack = await ctx.uiClient.command(
			"drive_config_get" as HubCommandName,
			{ workspaceRoot },
		);
		ctx.send(peer, {
			type: "drive_agent_profiles",
			profiles: readBack.ok
				? sanitizeProfiles(readBack.payload?.profiles)
				: sanitizeProfiles([reply.payload?.profile]),
			requestId,
		});
	} catch (error) {
		sendProfilesError(
			ctx,
			peer,
			requestId,
			error instanceof Error ? error.message : String(error),
			"drive_config_upsert_profile_failed",
		);
	}
}
