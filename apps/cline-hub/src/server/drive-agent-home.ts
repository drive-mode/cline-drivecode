import {
	assertDriveagentHomePatch,
	DriveagentHomeWriteError,
} from "@cline/drive";
import type { HubCommandName } from "@cline/shared";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

export type DriveAgentHomeWebviewFrame = {
	type: "drive_agent_home_get";
	workspaceRoot: string;
	slug: string;
	requestId?: string;
	[key: string]: unknown;
};

export type DriveAgentHomePutWebviewFrame = {
	type: "drive_agent_home_put";
	workspaceRoot: string;
	slug: string;
	patch?: unknown;
	requestId?: string;
	[key: string]: unknown;
};

type SanitizedHome = {
	slug: string;
	agent: {
		name: string;
		description: string;
		tools?: string[];
		skills?: string[];
		editable?: boolean;
	};
	permissions: {
		presetIntent: "readonly" | "standard" | "full";
		approvalHooks: string[];
		notes?: string;
	};
};

type SanitizedCompiled = {
	name: string;
	slug: string;
	description: string;
	tools?: string[];
	skills?: string[];
};

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const items = value.filter(
		(entry): entry is string => typeof entry === "string" && entry.length > 0,
	);
	return items.length > 0 ? items : undefined;
}

function sanitizeHome(value: unknown): SanitizedHome | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const slug = typeof record.slug === "string" ? record.slug.trim() : "";
	const agentRaw =
		record.agent && typeof record.agent === "object"
			? (record.agent as Record<string, unknown>)
			: null;
	const permissionsRaw =
		record.permissions && typeof record.permissions === "object"
			? (record.permissions as Record<string, unknown>)
			: null;
	if (!slug || !agentRaw || !permissionsRaw) {
		return undefined;
	}
	const name = typeof agentRaw.name === "string" ? agentRaw.name.trim() : "";
	const description =
		typeof agentRaw.description === "string" ? agentRaw.description.trim() : "";
	const presetIntent = permissionsRaw.presetIntent;
	if (
		!name ||
		!description ||
		(presetIntent !== "readonly" &&
			presetIntent !== "standard" &&
			presetIntent !== "full")
	) {
		return undefined;
	}
	const approvalHooks = Array.isArray(permissionsRaw.approvalHooks)
		? permissionsRaw.approvalHooks.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.length > 0,
			)
		: [];
	const notes =
		typeof permissionsRaw.notes === "string" ? permissionsRaw.notes : undefined;
	const tools = asStringArray(agentRaw.tools);
	const skills = asStringArray(agentRaw.skills);
	const editable =
		typeof agentRaw.editable === "boolean" ? agentRaw.editable : undefined;

	return {
		slug,
		agent: {
			name,
			description,
			...(tools ? { tools } : {}),
			...(skills ? { skills } : {}),
			...(editable !== undefined ? { editable } : {}),
		},
		permissions: {
			presetIntent,
			approvalHooks,
			...(notes !== undefined ? { notes } : {}),
		},
	};
}

function sanitizeCompiled(value: unknown): SanitizedCompiled | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const slug = typeof record.slug === "string" ? record.slug.trim() : "";
	const description =
		typeof record.description === "string" ? record.description.trim() : "";
	if (!name || !slug || !description) {
		return undefined;
	}
	const tools = asStringArray(record.tools);
	const skills = asStringArray(record.skills);
	return {
		name,
		slug,
		description,
		...(tools ? { tools } : {}),
		...(skills ? { skills } : {}),
	};
}

type HomeTarget = { workspaceRoot: string; slug: string };

/**
 * Error codes whose message is safe to show a browser.
 *
 * Every one of these is a sentence this code wrote about a payload the browser
 * sent, so it can only ever repeat what the browser already knew. Everything
 * else — a YAML parse failure, a filesystem error — carries content the browser
 * was deliberately not shown: `yaml` embeds a code frame of the offending
 * source line, which for `agent.yaml` may be the prompt itself, and Node's
 * errno strings carry the absolute path and the user's name. Relaying those
 * would undo, through the error channel, exactly what `sanitizeHome` does on
 * the success channel.
 */
const RELAYABLE_ERROR_CODES = new Set([
	"invalid_payload",
	"unknown_agent",
	"workspace_not_bound",
	"hub_disconnected",
	"not_editable",
	"hidden_field_write",
	"unknown_field",
	"slug_mismatch",
	"immutable_field",
	"plaintext_secret",
	"invalid_patch",
]);

const OPAQUE_ERROR_TEXT =
	"The Driveagent home could not be read or written. Check the hub log for details.";

function sendHomeError(
	ctx: HubContext,
	peer: BrowserPeer,
	requestId: string | undefined,
	text: string,
	code?: string,
): void {
	ctx.send(peer, {
		type: "drive_agent_home_error",
		text: code && RELAYABLE_ERROR_CODES.has(code) ? text : OPAQUE_ERROR_TEXT,
		code,
		requestId,
	});
}

/**
 * Common preflight for both lanes: hub connected, workspaceRoot and slug set.
 * Returns undefined after emitting the error frame the browser expects.
 */
function resolveHomeTarget(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: { workspaceRoot?: unknown; slug?: unknown },
	requestId: string | undefined,
): HomeTarget | undefined {
	if (!ctx.uiClient) {
		sendHomeError(
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
	const slug = typeof frame.slug === "string" ? frame.slug.trim() : "";
	if (!workspaceRoot) {
		sendHomeError(
			ctx,
			peer,
			requestId,
			"workspaceRoot is required.",
			"invalid_payload",
		);
		return undefined;
	}
	if (!slug) {
		sendHomeError(ctx, peer, requestId, "slug is required.", "invalid_payload");
		return undefined;
	}
	return { workspaceRoot, slug };
}

/**
 * Bridges Chat Drive Profile sheet to hub `drive_agent_home_get`.
 * Strips prompt fields before sending to the browser (DRV-PRIVACY / SoT).
 */
export async function handleDriveAgentHomeWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveAgentHomeWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;
	const target = resolveHomeTarget(ctx, peer, frame, requestId);
	if (!target || !ctx.uiClient) {
		return;
	}

	const command = "drive_agent_home_get" as HubCommandName;
	try {
		const reply = await ctx.uiClient.command(command, target);
		if (!reply.ok) {
			sendHomeError(
				ctx,
				peer,
				requestId,
				reply.error?.message ?? "Drive agent home command failed.",
				reply.error?.code,
			);
			return;
		}
		const home = sanitizeHome(reply.payload?.home);
		const compiled = sanitizeCompiled(reply.payload?.compiled);
		if (!home || !compiled) {
			sendHomeError(
				ctx,
				peer,
				requestId,
				"Drive agent home reply missing home/compiled.",
				"invalid_reply",
			);
			return;
		}
		ctx.send(peer, {
			type: "drive_agent_home",
			home,
			compiled,
			requestId,
		});
	} catch (error) {
		sendHomeError(
			ctx,
			peer,
			requestId,
			error instanceof Error ? error.message : String(error),
			"drive_agent_home_command_failed",
		);
	}
}

/**
 * Bridges the policy editor to hub `drive_agent_home_put`.
 *
 * The patch is validated here before it is forwarded, not because the hub
 * trusts this process — it re-validates and merges against disk — but so a
 * payload naming a field the read path stripped is refused at the first
 * boundary that can see it came from a browser. The reply is sanitized on the
 * way back exactly as the get lane is, so a save can never leak the prompt it
 * just preserved.
 */
export async function handleDriveAgentHomePutWebviewCommand(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: DriveAgentHomePutWebviewFrame,
): Promise<void> {
	const requestId =
		typeof frame.requestId === "string" ? frame.requestId : undefined;
	const target = resolveHomeTarget(ctx, peer, frame, requestId);
	if (!target || !ctx.uiClient) {
		return;
	}

	let patch: ReturnType<typeof assertDriveagentHomePatch>;
	try {
		patch = assertDriveagentHomePatch(frame.patch);
	} catch (error) {
		sendHomeError(
			ctx,
			peer,
			requestId,
			error instanceof Error ? error.message : String(error),
			error instanceof DriveagentHomeWriteError
				? error.code
				: "invalid_payload",
		);
		return;
	}

	const command = "drive_agent_home_put" as HubCommandName;
	try {
		const reply = await ctx.uiClient.command(command, { ...target, patch });
		if (!reply.ok) {
			sendHomeError(
				ctx,
				peer,
				requestId,
				reply.error?.message ?? "Drive agent home save failed.",
				reply.error?.code,
			);
			return;
		}
		const home = sanitizeHome(reply.payload?.home);
		const compiled = sanitizeCompiled(reply.payload?.compiled);
		if (!home || !compiled) {
			sendHomeError(
				ctx,
				peer,
				requestId,
				"Drive agent home save reply missing home/compiled.",
				"invalid_reply",
			);
			return;
		}
		ctx.send(peer, {
			type: "drive_agent_home_saved",
			home,
			compiled,
			// A workspace-shaped request resolves to `~/.driveagent/` when the
			// workspace has no home of its own, and an edit that applies to
			// every workspace on the machine should not read as a local one.
			tier: reply.payload?.tier === "user" ? "user" : "workspace",
			requestId,
		});
	} catch (error) {
		sendHomeError(
			ctx,
			peer,
			requestId,
			error instanceof Error ? error.message : String(error),
			"drive_agent_home_command_failed",
		);
	}
}
