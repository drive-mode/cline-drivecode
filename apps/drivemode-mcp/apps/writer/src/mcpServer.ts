import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PACK_ID_VALUES } from "./packIds.js";
import type { RoomService } from "./roomService.js";
import { listPackIds } from "./roomService.js";

function jsonResult(data: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(data, null, 2),
			},
		],
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

export function createMcpServer(service: RoomService): McpServer {
	const server = new McpServer({
		name: "drivemode-mcp",
		version: "0.1.0",
	});

	server.tool(
		"room_join",
		"Seat a human or agent participant in the room.",
		{
			id: z.string().min(1),
			kind: z.enum(["human", "agent"]),
			displayName: z.string().min(1),
			role: z.string().min(1).optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const participant =
					args.kind === "human"
						? {
								id: args.id,
								kind: "human" as const,
								displayName: args.displayName,
								role:
									(args.role as "host" | "participant" | "observer") ??
									"participant",
								status: "idle" as const,
							}
						: {
								id: args.id,
								kind: "agent" as const,
								displayName: args.displayName,
								role:
									(args.role as "partner" | "specialist" | "recorder") ??
									"partner",
								status: "idle" as const,
								seatSources: [{ kind: "manual" as const }],
							};
				const result = service.join(participant, args.actorId);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"room_leave",
		"Remove a participant from the room.",
		{
			participantId: z.string().min(1),
			reason: z.string().optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.leave(
					args.participantId,
					args.reason,
					args.actorId,
				);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"room_end",
		"End the room: clears roster and stage and revokes every active title grant.",
		{
			reason: z.string().optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.end(args.reason, args.actorId);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"room_snapshot",
		"Return the current room snapshot, seq, active pack, and in-memory conversation feed.",
		{},
		async () => jsonResult(service.snapshot()),
	);

	server.tool("roster_list", "List seated participants.", {}, async () => {
		const snap = service.snapshot();
		return jsonResult({ participants: snap.room.participants, seq: snap.seq });
	});

	server.tool(
		"roster_set_profile",
		"Set persona appearance plus a sanitized runtime family/location badge.",
		{
			participantId: z.string().min(1),
			displayName: z.string().min(1).optional(),
			ink: z.string().min(1).optional(),
			runtimeFamily: z
				.enum(["claude", "codex", "cline", "apple", "other"])
				.optional(),
			executionLocation: z.enum(["host", "device", "managed"]).optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.setProfile(
					args.participantId,
					{
						displayName: args.displayName,
						ink: args.ink,
						runtimeBadge:
							args.runtimeFamily && args.executionLocation
								? {
										family: args.runtimeFamily,
										executionLocation: args.executionLocation,
									}
								: undefined,
					},
					args.actorId,
				);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"address_set",
		"Set who the next send is scoped to.",
		{
			mode: z.enum(["everyone", "agents", "pack"]),
			agentIds: z.array(z.string().min(1)).optional(),
			packId: z.string().min(1).optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const addressSet =
					args.mode === "everyone"
						? { mode: "everyone" as const }
						: args.mode === "agents"
							? {
									mode: "agents" as const,
									agentIds: args.agentIds ?? [],
								}
							: { mode: "pack" as const, packId: args.packId ?? "" };
				const result = service.setAddress(addressSet, args.actorId);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"stage_publish_work",
		"Publish a pack-validated work event to Spotlight.",
		{
			packId: z.string().min(1).optional(),
			type: z.string().min(1),
			payload: z.record(z.string(), z.unknown()),
			actorId: z.string().min(1).optional(),
			narrate: z.boolean().optional(),
			opId: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					"Retry key: reuse the same opId when retrying and the writer replays the recorded result instead of appending a duplicate.",
				),
		},
		async (args) => {
			try {
				const result = service.publishWork({
					packId: args.packId,
					type: args.type,
					payload: args.payload,
					actorId: args.actorId,
					narrate: args.narrate,
					opId: args.opId,
				});
				return jsonResult({
					seq: result.seq,
					event: result.event,
					spotlight: result.snapshot.stage,
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"stage_set_sharer",
		"Point the typed stage at a participant. Agents require Presenter.",
		{
			participantId: z.string().min(1).nullable(),
			kind: z.enum(["human", "agent"]).optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const sharer =
					args.participantId == null
						? null
						: {
								kind: args.kind ?? ("agent" as const),
								participantId: args.participantId,
							};
				const result = service.setSharer(sharer, args.actorId);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"title_grant",
		"Grant a temporary scoped title. Presenter grants stage.present only.",
		{
			grantId: z.string().min(1),
			agentId: z.string().min(1),
			title: z.literal("presenter"),
			scopeKind: z.enum(["room", "session", "stage"]),
			scopeRef: z.string().min(1),
			skillBundleRefs: z.array(z.string().min(1)).max(32).default([]),
			resourceGrantRefs: z.array(z.string().min(1)).max(64).default([]),
			delegatedAgentIds: z.array(z.string().min(1)).max(32).default([]),
			permissions: z
				.array(z.literal("stage.present"))
				.default(["stage.present"]),
			expiresAt: z.string().datetime(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.grantTitle({
					grantId: args.grantId,
					agentId: args.agentId,
					title: args.title,
					scope: { kind: args.scopeKind, ref: args.scopeRef },
					skillBundleRefs: args.skillBundleRefs,
					resourceGrantRefs: args.resourceGrantRefs,
					delegatedAgentIds: args.delegatedAgentIds,
					permissions: args.permissions,
					expiresAt: args.expiresAt,
					actorId: args.actorId,
				});
				return jsonResult({
					seq: result.seq,
					event: result.event,
					room: result.snapshot,
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"title_revoke",
		"Revoke a title grant and release its stage ownership.",
		{
			grantId: z.string().min(1),
			reason: z.enum(["revoked", "expired", "policy"]).default("revoked"),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.revokeTitle(args);
				return jsonResult({
					seq: result.seq,
					event: result.event,
					room: result.snapshot,
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"title_transfer",
		"Atomically transfer Presenter to another seated agent.",
		{
			fromGrantId: z.string().min(1),
			toGrantId: z.string().min(1),
			toAgentId: z.string().min(1),
			title: z.literal("presenter"),
			skillBundleRefs: z.array(z.string().min(1)).max(32).default([]),
			resourceGrantRefs: z.array(z.string().min(1)).max(64).default([]),
			delegatedAgentIds: z.array(z.string().min(1)).max(32).default([]),
			permissions: z
				.array(z.literal("stage.present"))
				.default(["stage.present"]),
			expiresAt: z.string().datetime(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.transferTitle(args);
				return jsonResult({
					seq: result.seq,
					event: result.event,
					room: result.snapshot,
				});
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"mode_set",
		"Soft mode for hosts to interpret: plan | act | ask | debug.",
		{
			subMode: z.enum(["plan", "act", "ask", "debug"]),
			driveActive: z.boolean().optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.setMode(
					args.subMode,
					args.driveActive,
					args.actorId,
				);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool("mode_get", "Get current soft mode.", {}, async () =>
		jsonResult(service.getMode()),
	);

	server.tool(
		"interrupt_raise",
		"Human raise-hand / lower-hand.",
		{
			participantId: z.string().min(1),
			raised: z.boolean().default(true),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.raiseHand(
					args.participantId,
					args.raised,
					args.actorId,
				);
				return jsonResult({ seq: result.seq, room: result.snapshot });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"interrupt_ack",
		"Acknowledge an interrupt (pause-after-tool / hard-cancel / queue-steer).",
		{
			participantId: z.string().min(1),
			intent: z.enum(["stop", "clarify", "redirect", "fresh"]).optional(),
			gist: z.string().optional(),
			turnInFlight: z.boolean().optional(),
			hardCancel: z.boolean().optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.interruptAck(
					args.participantId,
					{
						intent: args.intent,
						gist: args.gist,
						turnInFlight: args.turnInFlight,
						hardCancel: args.hardCancel,
					},
					args.actorId,
				);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"conversation_publish",
		"Publish a short narrated / conversation message (density-capped).",
		{
			text: z.string().min(1).max(500),
			actorId: z.string().min(1).optional(),
			opId: z
				.string()
				.min(1)
				.max(128)
				.optional()
				.describe(
					"Retry key: reuse the same opId when retrying and the writer replays the recorded result instead of appending a duplicate.",
				),
		},
		async (args) => {
			try {
				const result = service.publishConversation(
					args.text,
					args.actorId,
					args.opId,
				);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"room_invite",
		"Invite a participant to a working session.",
		{
			inviterId: z.string().min(1),
			inviteeId: z.string().min(1),
			sessionId: z.string().min(1).optional(),
			title: z.string().min(1).optional(),
			note: z.string().max(280).optional(),
		},
		async (args) => {
			try {
				const result = service.invite(args);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"session_create",
		"Create a working-session registry record.",
		{
			sessionId: z.string().min(1),
			organizerId: z.string().min(1),
			title: z.string().min(1).max(160),
			project: z.string().min(1).max(160),
			participantIds: z.array(z.string().min(1)).min(1).max(32),
			agendaTaskIds: z.array(z.string().min(1)).max(100),
			note: z.string().max(280).optional(),
		},
		async (args) => {
			try {
				const result = service.createSession(args);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"session_schedule",
		"Schedule a created working session at an ISO timestamp.",
		{
			sessionId: z.string().min(1),
			scheduledFor: z.string().datetime(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.scheduleSession(
					args.sessionId,
					args.scheduledFor,
					args.actorId,
				);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"session_start",
		"Mark a working session live and link its directed program.",
		{
			sessionId: z.string().min(1),
			programId: z.string().min(1),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.startSession(
					args.sessionId,
					args.programId,
					args.actorId,
				);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"session_end",
		"End or cancel a working-session registry record.",
		{
			sessionId: z.string().min(1),
			outcome: z.enum(["completed", "cancelled"]).default("completed"),
			replayArtifactId: z.string().min(1).optional(),
			actorId: z.string().min(1).optional(),
		},
		async (args) => {
			try {
				const result = service.endSession(args);
				return jsonResult({ seq: result.seq, event: result.event });
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool(
		"events_since",
		"Resume from a seq cursor without duplicate storm.",
		{
			sinceSeq: z.number().int().nonnegative().default(0),
		},
		async (args) => {
			const events = service.eventsSince(args.sinceSeq);
			const snap = service.snapshot();
			return jsonResult({
				sinceSeq: args.sinceSeq,
				latestSeq: snap.seq,
				logId: snap.logId,
				events,
			});
		},
	);

	server.tool(
		"pack_set",
		"Switch the active work pack (coding | demo-ops | tasks | artifacts | direction).",
		{
			packId: z.enum(PACK_ID_VALUES),
		},
		async (args) => {
			try {
				return jsonResult(service.setActivePack(args.packId));
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.tool("pack_list", "List available work packs.", {}, async () =>
		jsonResult({ packs: listPackIds() }),
	);

	return server;
}
