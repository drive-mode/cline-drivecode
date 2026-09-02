import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PACK_ID_VALUES } from "./packIds.js";

/**
 * Stdio MCP façade that proxies tool calls to a running writer HTTP `/rpc`.
 * Set DRIVEMODE_WRITER_URL (printed by `bun run writer`).
 */

const writerUrl = (
	process.env.DRIVEMODE_WRITER_URL ?? "http://127.0.0.1:0"
).replace(/\/$/, "");

async function rpc(tool: string, args: Record<string, unknown> = {}) {
	const res = await fetch(`${writerUrl}/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ tool, args }),
	});
	const body = (await res.json()) as {
		ok: boolean;
		result?: unknown;
		error?: string;
	};
	if (!body.ok) {
		throw new Error(body.error ?? `RPC failed for ${tool}`);
	}
	return body.result;
}

function jsonResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

function errorResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [
			{ type: "text" as const, text: JSON.stringify({ error: message }) },
		],
		isError: true as const,
	};
}

function tool(
	server: McpServer,
	name: string,
	description: string,
	schema: Record<string, z.ZodTypeAny>,
) {
	server.tool(name, description, schema, async (args) => {
		try {
			return jsonResult(await rpc(name, args as Record<string, unknown>));
		} catch (error) {
			return errorResult(error);
		}
	});
}

async function main() {
	if (!process.env.DRIVEMODE_WRITER_URL) {
		console.error(
			"[drivemode-mcp] DRIVEMODE_WRITER_URL is required (start the writer first).",
		);
		process.exit(1);
	}

	const health = await fetch(`${writerUrl}/health`).catch(() => null);
	if (!health?.ok) {
		console.error(`[drivemode-mcp] Writer not reachable at ${writerUrl}`);
		process.exit(1);
	}

	const server = new McpServer({
		name: "drivemode-mcp",
		version: "0.1.0",
	});

	tool(server, "room_join", "Seat a human or agent participant.", {
		id: z.string().min(1),
		kind: z.enum(["human", "agent"]),
		displayName: z.string().min(1),
		role: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "room_leave", "Remove a participant.", {
		participantId: z.string().min(1),
		reason: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(
		server,
		"room_end",
		"End the room: clears roster and stage, revokes active titles.",
		{
			reason: z.string().optional(),
			actorId: z.string().optional(),
		},
	);
	tool(server, "room_snapshot", "Current room snapshot + seq.", {});
	tool(server, "roster_list", "List participants.", {});
	tool(server, "roster_set_profile", "Appearance overlay only.", {
		participantId: z.string().min(1),
		displayName: z.string().optional(),
		ink: z.string().optional(),
		runtimeFamily: z
			.enum(["claude", "codex", "cline", "apple", "other"])
			.optional(),
		executionLocation: z.enum(["host", "device", "managed"]).optional(),
		actorId: z.string().optional(),
	});
	tool(server, "address_set", "Set address scope.", {
		mode: z.enum(["everyone", "agents", "pack"]),
		agentIds: z.array(z.string()).optional(),
		packId: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(
		server,
		"stage_publish_work",
		"Publish pack-validated work to Spotlight.",
		{
			packId: z.string().optional(),
			type: z.string().min(1),
			payload: z.record(z.string(), z.unknown()),
			actorId: z.string().optional(),
			narrate: z.boolean().optional(),
		},
	);
	tool(
		server,
		"stage_set_sharer",
		"Point typed stage at an eligible participant.",
		{
			participantId: z.string().nullable(),
			kind: z.enum(["human", "agent"]).optional(),
			actorId: z.string().optional(),
		},
	);
	tool(server, "title_grant", "Grant a temporary Presenter title.", {
		grantId: z.string().min(1),
		agentId: z.string().min(1),
		title: z.literal("presenter"),
		scopeKind: z.enum(["room", "session", "stage"]),
		scopeRef: z.string().min(1),
		skillBundleRefs: z.array(z.string().min(1)).max(32).default([]),
		resourceGrantRefs: z.array(z.string().min(1)).max(64).default([]),
		delegatedAgentIds: z.array(z.string().min(1)).max(32).default([]),
		permissions: z.array(z.literal("stage.present")).default(["stage.present"]),
		expiresAt: z.string().datetime(),
		actorId: z.string().optional(),
	});
	tool(server, "title_revoke", "Revoke a title grant.", {
		grantId: z.string().min(1),
		reason: z.enum(["revoked", "expired", "policy"]).default("revoked"),
		actorId: z.string().optional(),
	});
	tool(server, "title_transfer", "Atomically transfer Presenter.", {
		fromGrantId: z.string().min(1),
		toGrantId: z.string().min(1),
		toAgentId: z.string().min(1),
		title: z.literal("presenter"),
		skillBundleRefs: z.array(z.string().min(1)).max(32).default([]),
		resourceGrantRefs: z.array(z.string().min(1)).max(64).default([]),
		delegatedAgentIds: z.array(z.string().min(1)).max(32).default([]),
		permissions: z.array(z.literal("stage.present")).default(["stage.present"]),
		expiresAt: z.string().datetime(),
		actorId: z.string().optional(),
	});
	tool(server, "mode_set", "Set soft mode.", {
		subMode: z.enum(["plan", "act", "ask", "debug"]),
		driveActive: z.boolean().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "mode_get", "Get soft mode.", {});
	tool(server, "interrupt_raise", "Raise or lower hand.", {
		participantId: z.string().min(1),
		raised: z.boolean().default(true),
		actorId: z.string().optional(),
	});
	tool(server, "interrupt_ack", "Acknowledge interrupt.", {
		participantId: z.string().min(1),
		intent: z.enum(["stop", "clarify", "redirect", "fresh"]).optional(),
		gist: z.string().optional(),
		turnInFlight: z.boolean().optional(),
		hardCancel: z.boolean().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "conversation_publish", "Short conversation / narration.", {
		text: z.string().min(1).max(500),
		actorId: z.string().optional(),
	});
	tool(server, "room_invite", "Invite a participant to a working session.", {
		inviterId: z.string().min(1),
		inviteeId: z.string().min(1),
		sessionId: z.string().min(1).optional(),
		title: z.string().min(1).optional(),
		note: z.string().max(280).optional(),
	});
	tool(server, "session_create", "Create a working-session registry record.", {
		sessionId: z.string().min(1),
		organizerId: z.string().min(1),
		title: z.string().min(1).max(160),
		project: z.string().min(1).max(160),
		participantIds: z.array(z.string().min(1)).min(1).max(32),
		agendaTaskIds: z.array(z.string().min(1)).max(100),
		note: z.string().max(280).optional(),
	});
	tool(server, "session_schedule", "Schedule a working session.", {
		sessionId: z.string().min(1),
		scheduledFor: z.string().datetime(),
		actorId: z.string().optional(),
	});
	tool(server, "session_start", "Mark a working session live.", {
		sessionId: z.string().min(1),
		programId: z.string().min(1),
		actorId: z.string().optional(),
	});
	tool(server, "session_end", "End or cancel a working session.", {
		sessionId: z.string().min(1),
		outcome: z.enum(["completed", "cancelled"]).default("completed"),
		replayArtifactId: z.string().min(1).optional(),
		actorId: z.string().optional(),
	});
	tool(server, "events_since", "Resume from seq.", {
		sinceSeq: z.number().int().nonnegative().default(0),
	});
	tool(server, "pack_set", "Switch active pack.", {
		packId: z.enum(PACK_ID_VALUES),
	});
	tool(server, "pack_list", "List packs.", {});

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
