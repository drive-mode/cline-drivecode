import { HubCommandError, type NodeHubClient } from "@cline/core";
import {
	assertDriveagentHomePatch,
	DriveagentHomeWriteError,
	type StatusSessionRow,
	statusSessionRowFromUnknown,
} from "@cline/drive";
import {
	type AgentProfile,
	AgentProfileSchema,
	type HubCommandName,
	type HubReplyEnvelope,
	type RoomSnapshot,
} from "@cline/shared";
import { broadcastEvent, ensureSharedHubClient } from "./context";
import type { JsonRecord, SidecarContext } from "./types";

/**
 * Drive Mode bridge: desktop `drive_*` commands → shared Hub commands.
 *
 * Mirrors the projections in `apps/cline-hub/src/server/drive-*.ts` and
 * `status-calls.ts`. The Hub stays the only writer; this file forwards an
 * allowlisted set of Hub commands and re-broadcasts Hub room/drive/status
 * events as one `drive_hub_event` so the webview folds them itself.
 */

// ── Allowlists ───────────────────────────────────────────────────────

export const DRIVE_CALL_OPS = [
	"call_join",
	"call_leave",
	"call_end",
	"call_mute",
	"call_raise_hand",
	"call_rename_participant",
	"call_set_stage",
	"call_set_address",
	"call_set_mode",
	"call_seat",
	"call_add_roster_pack",
	"call_remove_roster_pack",
	"call_get_room",
] as const;
export type DriveCallOp = (typeof DRIVE_CALL_OPS)[number];

/** Call ops whose Hub payload schema declares an optional `workspaceRoot`. */
const CALL_OPS_WITH_WORKSPACE_ROOT: ReadonlySet<DriveCallOp> =
	new Set<DriveCallOp>([
		"call_join",
		"call_end",
		"call_add_roster_pack",
		"call_remove_roster_pack",
	]);

export const DRIVE_HUB_COMMANDS = [
	"drive.room.get",
	"drive.presenter.grant",
	"drive.presenter.transfer",
	"drive.presenter.revoke",
	"drive.presenter.status",
	"drive.spotlight.set",
	"drive.participant.mute.set",
	"drive.participant.deafen.set",
	"drive.show.present",
	"drive.show.enqueue",
	"drive.show.tick",
	"drive.do.enqueue",
	"drive.planner.set",
	"drive.script.attach",
	"drive.script.advance",
	"drive.artifacts.list",
	"drive.fork.list",
	"drive.fork.audit.get",
	"drive.fork.retain.set",
	"drive.fork.cancel",
] as const;
export type DriveHubCommand = (typeof DRIVE_HUB_COMMANDS)[number];

export const DRIVE_STATUS_OPS = [
	"query",
	"board",
	"current",
	"subjects",
	"tasks_snapshot",
	"summary",
] as const;
export type DriveStatusOp = (typeof DRIVE_STATUS_OPS)[number];

export const DRIVE_BANK_OPS = [
	"get",
	"seed",
	"create_task",
	"edit_plan_tasks",
	"complete_task",
	"bind_now",
	"activate_plan",
	"record_failure",
	"accept_sdlc_freeze",
] as const;
export type DriveBankOp = (typeof DRIVE_BANK_OPS)[number];

export const DRIVE_AGENT_HOME_OPS = ["get", "list", "put"] as const;
export type DriveAgentHomeOp = (typeof DRIVE_AGENT_HOME_OPS)[number];

export const DRIVE_AGENT_PROFILE_OPS = ["get", "put"] as const;
export type DriveAgentProfileOp = (typeof DRIVE_AGENT_PROFILE_OPS)[number];

export const DRIVE_CONFIG_OPS = ["get", "put", "upsert_profile"] as const;
export type DriveConfigOp = (typeof DRIVE_CONFIG_OPS)[number];

export const DRIVE_DESKTOP_COMMANDS = [
	"drive_hub_status",
	"drive_call",
	"drive_rooms_list",
	"drive_command",
	"drive_status",
	"drive_bank",
	"drive_session_rollups",
	"drive_agent_home",
	"drive_agent_profiles",
	"drive_config",
] as const;
export type DriveDesktopCommand = (typeof DRIVE_DESKTOP_COMMANDS)[number];

export function isDriveDesktopCommand(
	command: string,
): command is DriveDesktopCommand {
	return (DRIVE_DESKTOP_COMMANDS as readonly string[]).includes(command);
}

// ── Errors ───────────────────────────────────────────────────────────

export type DriveCommandErrorOptions = {
	code: string;
	command: string;
	roomId?: string;
};

/**
 * Every Drive failure crosses the transport as the string
 * `"<code>: <message>"` (the server serializes `error.message`), so the
 * webview can split on the first `": "` to recover the Hub's error code.
 */
export class DriveCommandError extends Error {
	readonly code: string;
	readonly command: string;
	readonly roomId?: string;
	/** The message without the `<code>: ` prefix. */
	readonly detail: string;

	constructor(message: string, options: DriveCommandErrorOptions) {
		super(`${options.code}: ${message}`);
		this.name = "DriveCommandError";
		this.code = options.code;
		this.command = options.command;
		this.detail = message;
		if (options.roomId) {
			this.roomId = options.roomId;
		}
	}

	toString(): string {
		return this.message;
	}
}

// ── Result shapes ────────────────────────────────────────────────────

export type DriveHubStatus = {
	connected: boolean;
	url: string | null;
	error: string | null;
	workspaceRoot: string;
};

export type DriveCallReply = {
	roomId: string;
	snapshot: RoomSnapshot;
	seq?: number;
	callSessionId?: string;
	whileAwayNote?: string;
	handoffNarration?: string;
	ended?: true;
};

export type DriveSessionRollupsReply = {
	sessions: StatusSessionRow[];
	dump: string;
};

export const DRIVE_HUB_EVENT = "drive_hub_event";

export type DriveHubEventPayload = {
	event: string;
	payload: JsonRecord;
	seq?: number;
	timestamp?: string;
};

// ── Event fan-out ────────────────────────────────────────────────────

export function isDriveHubEventName(name: string): boolean {
	return (
		name.startsWith("room.") ||
		name.startsWith("drive.") ||
		name === "status.updated"
	);
}

function toIsoTimestamp(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return new Date(value).toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		return value;
	}
	return undefined;
}

/**
 * Re-broadcasts one Hub event as `drive_hub_event` when it belongs to the
 * room / drive / status families. Returns whether it was forwarded.
 */
export function forwardDriveHubEvent(
	ctx: SidecarContext,
	event: {
		event: string;
		payload?: Record<string, unknown>;
		timestamp?: number | string;
	},
): boolean {
	if (!isDriveHubEventName(event.event)) {
		return false;
	}
	const payload: JsonRecord = event.payload ?? {};
	const seq =
		typeof payload.seq === "number" && Number.isFinite(payload.seq)
			? payload.seq
			: undefined;
	const timestamp = toIsoTimestamp(event.timestamp);
	const envelope: DriveHubEventPayload = {
		event: event.event,
		payload,
		...(seq !== undefined ? { seq } : {}),
		...(timestamp ? { timestamp } : {}),
	};
	broadcastEvent(ctx, DRIVE_HUB_EVENT, envelope);
	return true;
}

// ── Helpers ──────────────────────────────────────────────────────────

const HUB_STATUS_TIMEOUT_MS = 3_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asRoomSnapshot(value: unknown): RoomSnapshot | undefined {
	if (!isRecord(value) || typeof value.roomId !== "string") {
		return undefined;
	}
	return value as unknown as RoomSnapshot;
}

function readOp<const T extends readonly string[]>(
	args: JsonRecord | undefined,
	allowed: T,
	command: DriveDesktopCommand,
): T[number] {
	const op = asTrimmedString(args?.op);
	if (!op || !allowed.includes(op)) {
		throw new DriveCommandError(
			`Unsupported ${command} op: ${op ?? "(missing)"}. Expected one of ${allowed.join(", ")}.`,
			{ code: "unsupported_drive_op", command },
		);
	}
	return op;
}

/** `args` minus `op`, with `workspaceRoot` defaulted to the sidecar's root. */
function payloadWithWorkspaceRoot(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): JsonRecord {
	const { op: _op, ...rest } = args ?? {};
	return {
		...rest,
		workspaceRoot: asTrimmedString(rest.workspaceRoot) ?? ctx.workspaceRoot,
	};
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			// The Hub may still come up; keep the pending initialization alive
			// (later calls reuse it) but never let it become an unhandled
			// rejection.
			promise.catch(() => undefined);
			reject(
				new Error(
					`The shared Cline Hub did not respond within ${timeoutMs}ms.`,
				),
			);
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

async function requireHubClient(
	ctx: SidecarContext,
	command: string,
	roomId?: string,
): Promise<NodeHubClient> {
	try {
		return await ensureSharedHubClient(ctx);
	} catch (error) {
		throw new DriveCommandError(errorMessage(error), {
			code: "hub_disconnected",
			command,
			roomId,
		});
	}
}

/**
 * Forwards one allowlisted Hub command and returns its payload. A non-ok
 * reply and a thrown transport error both surface as `DriveCommandError`
 * carrying the Hub's own code where it has one.
 */
async function runHubCommand(
	ctx: SidecarContext,
	options: {
		hubCommand: HubCommandName;
		payload: JsonRecord;
		roomId?: string;
	},
): Promise<JsonRecord> {
	const { hubCommand, payload, roomId } = options;
	const hubClient = await requireHubClient(ctx, hubCommand, roomId);
	let reply: HubReplyEnvelope;
	try {
		reply = await hubClient.command(hubCommand, payload);
	} catch (error) {
		if (error instanceof DriveCommandError) {
			throw error;
		}
		throw new DriveCommandError(errorMessage(error), {
			code:
				error instanceof HubCommandError && error.code
					? error.code
					: "hub_command_failed",
			command: hubCommand,
			roomId,
		});
	}
	if (!reply.ok) {
		throw new DriveCommandError(
			reply.error?.message ?? `Hub command ${hubCommand} failed.`,
			{
				code: reply.error?.code ?? "hub_command_failed",
				command: hubCommand,
				roomId,
			},
		);
	}
	return reply.payload ?? {};
}

// ── Agent home / profile sanitizers (DRV-PRIVACY) ────────────────────
// Prompts, tool allowlists, and provider details never cross to the
// webview. Same field set as `apps/cline-hub/src/server/drive-agent-home.ts`.

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

type SanitizedHomeListing = {
	slug: string;
	tier: "workspace" | "user";
	displayName?: string;
	description?: string;
	skills?: string[];
	editable?: boolean;
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
	if (!isRecord(value)) {
		return undefined;
	}
	const slug = asTrimmedString(value.slug);
	const agentRaw = isRecord(value.agent) ? value.agent : null;
	const permissionsRaw = isRecord(value.permissions) ? value.permissions : null;
	if (!slug || !agentRaw || !permissionsRaw) {
		return undefined;
	}
	const name = asTrimmedString(agentRaw.name);
	const description = asTrimmedString(agentRaw.description);
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
	const approvalHooks = asStringArray(permissionsRaw.approvalHooks) ?? [];
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
	if (!isRecord(value)) {
		return undefined;
	}
	const name = asTrimmedString(value.name);
	const slug = asTrimmedString(value.slug);
	const description = asTrimmedString(value.description);
	if (!name || !slug || !description) {
		return undefined;
	}
	const tools = asStringArray(value.tools);
	const skills = asStringArray(value.skills);
	return {
		name,
		slug,
		description,
		...(tools ? { tools } : {}),
		...(skills ? { skills } : {}),
	};
}

function sanitizeHomeListing(value: unknown): SanitizedHomeListing[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const rows: SanitizedHomeListing[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) {
			continue;
		}
		const slug = asTrimmedString(entry.slug);
		if (!slug) {
			continue;
		}
		const displayName = asTrimmedString(entry.displayName);
		const description = asTrimmedString(entry.description);
		const skills = asStringArray(entry.skills);
		rows.push({
			slug,
			tier: entry.tier === "user" ? "user" : "workspace",
			...(displayName ? { displayName } : {}),
			...(description ? { description } : {}),
			...(skills ? { skills } : {}),
			...(typeof entry.editable === "boolean"
				? { editable: entry.editable }
				: {}),
		});
	}
	return rows;
}

/** Re-validates every profile on the way out; malformed rows are dropped. */
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

// ── Command handlers ─────────────────────────────────────────────────

async function handleDriveHubStatus(
	ctx: SidecarContext,
): Promise<DriveHubStatus> {
	const workspaceRoot = ctx.workspaceRoot;
	let client: NodeHubClient;
	try {
		client = await withTimeout(
			ensureSharedHubClient(ctx),
			HUB_STATUS_TIMEOUT_MS,
		);
	} catch (error) {
		return {
			connected: false,
			url: null,
			error: errorMessage(error),
			workspaceRoot,
		};
	}
	const connectionError = client.getConnectionError();
	return {
		connected: client.isConnected(),
		url: client.getUrl(),
		error: connectionError ? errorMessage(connectionError) : null,
		workspaceRoot,
	};
}

async function handleDriveCall(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<DriveCallReply> {
	const op = readOp(args, DRIVE_CALL_OPS, "drive_call");
	const roomId = asTrimmedString(args?.roomId);
	if (!roomId) {
		throw new DriveCommandError("roomId is required.", {
			code: "invalid_payload",
			command: op,
		});
	}
	const { op: _op, ...rest } = args ?? {};
	const payload: JsonRecord = { ...rest, roomId };
	if (
		CALL_OPS_WITH_WORKSPACE_ROOT.has(op) &&
		asTrimmedString(payload.workspaceRoot) === undefined
	) {
		payload.workspaceRoot = ctx.workspaceRoot;
	}
	const reply = await runHubCommand(ctx, {
		hubCommand: op,
		payload,
		roomId,
	});
	const snapshot = asRoomSnapshot(reply.snapshot);
	if (!snapshot) {
		throw new DriveCommandError(
			`Hub reply for ${op} did not include a room snapshot.`,
			{ code: "invalid_reply", command: op, roomId },
		);
	}
	const seq = typeof reply.seq === "number" ? reply.seq : undefined;
	const callSessionId = asTrimmedString(reply.callSessionId);
	const whileAwayNote = asTrimmedString(reply.whileAwayNote);
	const handoffNarration = asTrimmedString(reply.handoffNarration);
	// Only call_end sets `ended` (normal and idempotent double-end paths);
	// broadcast snapshots never carry it.
	const ended = reply.ended === true;
	return {
		roomId: asTrimmedString(reply.roomId) ?? snapshot.roomId,
		snapshot,
		...(seq !== undefined ? { seq } : {}),
		...(callSessionId ? { callSessionId } : {}),
		...(whileAwayNote ? { whileAwayNote } : {}),
		...(handoffNarration ? { handoffNarration } : {}),
		...(ended ? { ended: true as const } : {}),
	};
}

async function handleDriveRoomsList(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<{ rooms: unknown[] }> {
	const reply = await runHubCommand(ctx, {
		hubCommand: "call_list_rooms",
		payload: {
			workspaceRoot: asTrimmedString(args?.workspaceRoot) ?? ctx.workspaceRoot,
		},
	});
	return { rooms: Array.isArray(reply.rooms) ? reply.rooms : [] };
}

async function handleDriveHubCommand(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<JsonRecord> {
	const command = asTrimmedString(args?.command);
	if (
		!command ||
		!(DRIVE_HUB_COMMANDS as readonly string[]).includes(command)
	) {
		throw new DriveCommandError(
			`Unsupported drive_command: ${command ?? "(missing)"}.`,
			{ code: "unsupported_drive_op", command: "drive_command" },
		);
	}
	const hubCommand = command as DriveHubCommand;
	const payload: JsonRecord = isRecord(args?.payload)
		? { ...args.payload }
		: {};
	if (
		hubCommand === "drive.artifacts.list" &&
		asTrimmedString(payload.workspaceRoot) === undefined
	) {
		payload.workspaceRoot = ctx.workspaceRoot;
	}
	return await runHubCommand(ctx, {
		hubCommand,
		payload,
		roomId: asTrimmedString(payload.roomId),
	});
}

async function handleDriveStatus(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<JsonRecord> {
	const op = readOp(args, DRIVE_STATUS_OPS, "drive_status");
	const { op: _op, ...payload } = args ?? {};
	return await runHubCommand(ctx, {
		hubCommand: `status.${op}`,
		payload,
	});
}

async function handleDriveBank(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<JsonRecord> {
	const op = readOp(args, DRIVE_BANK_OPS, "drive_bank");
	const payload = payloadWithWorkspaceRoot(ctx, args);
	return await runHubCommand(ctx, {
		hubCommand: `drive_bank_${op}`,
		payload,
		roomId: asTrimmedString(payload.roomId),
	});
}

async function handleDriveSessionRollups(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<DriveSessionRollupsReply> {
	const payload: JsonRecord = {
		workspaceRoot: asTrimmedString(args?.workspaceRoot) ?? ctx.workspaceRoot,
	};
	if (typeof args?.limit === "number" && args.limit > 0) {
		payload.limit = Math.floor(args.limit);
	}
	const callSessionId = asTrimmedString(args?.callSessionId);
	if (callSessionId) {
		payload.callSessionId = callSessionId;
	}
	const reply = await runHubCommand(ctx, {
		hubCommand: "drive_session_rollups",
		payload,
	});
	const sessions: StatusSessionRow[] = [];
	if (Array.isArray(reply.rollups)) {
		for (const raw of reply.rollups) {
			const row = statusSessionRowFromUnknown(raw);
			if (row) {
				sessions.push(row);
			}
		}
	}
	return {
		sessions,
		dump: typeof reply.dump === "string" ? reply.dump : "",
	};
}

async function handleDriveAgentHome(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<JsonRecord> {
	const op = readOp(args, DRIVE_AGENT_HOME_OPS, "drive_agent_home");
	const hubCommand: HubCommandName = `drive_agent_home_${op}`;
	const payload = payloadWithWorkspaceRoot(ctx, args);
	if (op === "list") {
		const reply = await runHubCommand(ctx, {
			hubCommand,
			payload: { workspaceRoot: payload.workspaceRoot },
		});
		return { homes: sanitizeHomeListing(reply.homes) };
	}
	const slug = asTrimmedString(payload.slug);
	if (!slug) {
		throw new DriveCommandError("slug is required.", {
			code: "invalid_payload",
			command: hubCommand,
		});
	}
	const target: JsonRecord = { workspaceRoot: payload.workspaceRoot, slug };
	if (op === "put") {
		try {
			target.patch = assertDriveagentHomePatch(payload.patch);
		} catch (error) {
			throw new DriveCommandError(errorMessage(error), {
				code:
					error instanceof DriveagentHomeWriteError
						? error.code
						: "invalid_payload",
				command: hubCommand,
			});
		}
	}
	const reply = await runHubCommand(ctx, { hubCommand, payload: target });
	const home = sanitizeHome(reply.home);
	const compiled = sanitizeCompiled(reply.compiled);
	if (!home || !compiled) {
		throw new DriveCommandError(
			"Drive agent home reply missing home/compiled.",
			{ code: "invalid_reply", command: hubCommand },
		);
	}
	return {
		home,
		compiled,
		...(op === "put"
			? { tier: reply.tier === "user" ? "user" : "workspace" }
			: {}),
	};
}

async function handleDriveAgentProfiles(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<{ profiles: AgentProfile[] }> {
	const op = readOp(args, DRIVE_AGENT_PROFILE_OPS, "drive_agent_profiles");
	const workspaceRoot =
		asTrimmedString(args?.workspaceRoot) ?? ctx.workspaceRoot;
	if (op === "get") {
		const reply = await runHubCommand(ctx, {
			hubCommand: "drive_config_get",
			payload: { workspaceRoot },
		});
		return { profiles: sanitizeProfiles(reply.profiles) };
	}
	const parsed = AgentProfileSchema.omit({ id: true }).safeParse(args?.profile);
	if (!parsed.success) {
		throw new DriveCommandError(
			parsed.error.issues[0]?.message ?? "profile is invalid.",
			{ code: "invalid_payload", command: "drive_config_upsert_profile" },
		);
	}
	const upserted = await runHubCommand(ctx, {
		hubCommand: "drive_config_upsert_profile",
		payload: { workspaceRoot, profile: parsed.data },
	});
	// Read back so the reply describes what was stored. If the read fails the
	// write still happened, so fall back to the profile the upsert returned.
	try {
		const readBack = await runHubCommand(ctx, {
			hubCommand: "drive_config_get",
			payload: { workspaceRoot },
		});
		return { profiles: sanitizeProfiles(readBack.profiles) };
	} catch {
		return { profiles: sanitizeProfiles([upserted.profile]) };
	}
}

async function handleDriveConfig(
	ctx: SidecarContext,
	args: JsonRecord | undefined,
): Promise<JsonRecord> {
	const op = readOp(args, DRIVE_CONFIG_OPS, "drive_config");
	return await runHubCommand(ctx, {
		hubCommand: `drive_config_${op}`,
		payload: payloadWithWorkspaceRoot(ctx, args),
	});
}

export async function handleDriveCommand(
	ctx: SidecarContext,
	command: DriveDesktopCommand,
	args?: Record<string, unknown>,
): Promise<unknown> {
	switch (command) {
		case "drive_hub_status":
			return await handleDriveHubStatus(ctx);
		case "drive_call":
			return await handleDriveCall(ctx, args);
		case "drive_rooms_list":
			return await handleDriveRoomsList(ctx, args);
		case "drive_command":
			return await handleDriveHubCommand(ctx, args);
		case "drive_status":
			return await handleDriveStatus(ctx, args);
		case "drive_bank":
			return await handleDriveBank(ctx, args);
		case "drive_session_rollups":
			return await handleDriveSessionRollups(ctx, args);
		case "drive_agent_home":
			return await handleDriveAgentHome(ctx, args);
		case "drive_agent_profiles":
			return await handleDriveAgentProfiles(ctx, args);
		case "drive_config":
			return await handleDriveConfig(ctx, args);
		default: {
			const exhaustive: never = command;
			throw new Error(`unsupported drive command: ${String(exhaustive)}`);
		}
	}
}
