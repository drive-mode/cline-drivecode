import type { RoomService } from "./roomService.js";
import { listPackIds } from "./roomService.js";
import type { WriterStore } from "./store.js";

export type HttpWriterOptions = {
	store: WriterStore;
	service: RoomService;
	port?: number;
	host?: string;
	/**
	 * Shed an SSE consumer once this many messages sit unread in its stream
	 * queue. Dropping is safe *because* the log is replayable: a shed client
	 * reconnects and resumes from its cursor, whereas buffering for a stuck
	 * one grows without bound (each message carries a full snapshot).
	 */
	sseMaxBufferedMessages?: number;
};

/**
 * Permissive CORS for a loopback, unauthenticated, single-room writer. See the
 * note in `fetch` — this exists so the bundled viewer works, not to widen the
 * writer's reach.
 */
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
} as const;

type RpcBody = {
	tool: string;
	args?: Record<string, unknown>;
};

function requiredString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${key} is required`);
	}
	return value;
}

async function dispatchRpc(
	service: RoomService,
	tool: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	switch (tool) {
		case "room_join": {
			const kind = String(args.kind ?? "agent");
			const id = String(args.id);
			const displayName = String(args.displayName);
			const participant =
				kind === "human"
					? {
							id,
							kind: "human" as const,
							displayName,
							role: String(args.role ?? "participant") as
								| "host"
								| "participant"
								| "observer",
							status: "idle" as const,
						}
					: {
							id,
							kind: "agent" as const,
							displayName,
							role: String(args.role ?? "partner") as
								| "partner"
								| "specialist"
								| "recorder",
							status: "idle" as const,
							seatSources: [{ kind: "manual" as const }],
						};
			const result = service.join(
				participant,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "room_leave": {
			const result = service.leave(
				String(args.participantId),
				args.reason as string | undefined,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "room_end": {
			const result = service.end(
				args.reason as string | undefined,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "room_snapshot":
			return service.snapshot();
		case "roster_list": {
			const snap = service.snapshot();
			return { participants: snap.room.participants, seq: snap.seq };
		}
		case "roster_set_profile": {
			const runtimeFamily = args.runtimeFamily as
				| "claude"
				| "codex"
				| "cline"
				| "apple"
				| "other"
				| undefined;
			const executionLocation = args.executionLocation as
				| "host"
				| "device"
				| "managed"
				| undefined;
			const result = service.setProfile(
				String(args.participantId),
				{
					displayName: args.displayName as string | undefined,
					ink: args.ink as string | undefined,
					runtimeBadge:
						runtimeFamily && executionLocation
							? { family: runtimeFamily, executionLocation }
							: undefined,
				},
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "address_set": {
			const mode = String(args.mode ?? "everyone");
			const addressSet =
				mode === "everyone"
					? { mode: "everyone" as const }
					: mode === "agents"
						? {
								mode: "agents" as const,
								agentIds: (args.agentIds as string[]) ?? [],
							}
						: {
								mode: "pack" as const,
								packId: String(args.packId ?? ""),
							};
			const result = service.setAddress(
				addressSet,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "stage_publish_work": {
			const result = service.publishWork({
				packId: args.packId as string | undefined,
				type: String(args.type),
				payload: (args.payload as Record<string, unknown>) ?? {},
				actorId: args.actorId as string | undefined,
				narrate: args.narrate as boolean | undefined,
				opId: args.opId as string | undefined,
			});
			return {
				seq: result.seq,
				event: result.event,
				spotlight: result.snapshot.stage,
			};
		}
		case "stage_set_sharer": {
			const participantId = args.participantId as string | null;
			const sharer =
				participantId == null
					? null
					: {
							kind: String(args.kind ?? "agent") as "human" | "agent",
							participantId,
						};
			const result = service.setSharer(
				sharer,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "title_grant": {
			const result = service.grantTitle({
				grantId: requiredString(args, "grantId"),
				agentId: requiredString(args, "agentId"),
				title: "presenter",
				scope: {
					kind: args.scopeKind as "room" | "session" | "stage",
					ref: requiredString(args, "scopeRef"),
				},
				skillBundleRefs: (args.skillBundleRefs as string[]) ?? [],
				resourceGrantRefs: (args.resourceGrantRefs as string[]) ?? [],
				delegatedAgentIds: (args.delegatedAgentIds as string[]) ?? [],
				permissions: ["stage.present"],
				expiresAt: requiredString(args, "expiresAt"),
				actorId: args.actorId as string | undefined,
			});
			return { seq: result.seq, event: result.event, room: result.snapshot };
		}
		case "title_revoke": {
			const result = service.revokeTitle({
				grantId: requiredString(args, "grantId"),
				reason: (args.reason as "revoked" | "expired" | "policy") ?? "revoked",
				actorId: args.actorId as string | undefined,
			});
			return { seq: result.seq, event: result.event, room: result.snapshot };
		}
		case "title_transfer": {
			const result = service.transferTitle({
				fromGrantId: requiredString(args, "fromGrantId"),
				toGrantId: requiredString(args, "toGrantId"),
				toAgentId: requiredString(args, "toAgentId"),
				title: "presenter",
				skillBundleRefs: (args.skillBundleRefs as string[]) ?? [],
				resourceGrantRefs: (args.resourceGrantRefs as string[]) ?? [],
				delegatedAgentIds: (args.delegatedAgentIds as string[]) ?? [],
				permissions: ["stage.present"],
				expiresAt: requiredString(args, "expiresAt"),
				actorId: args.actorId as string | undefined,
			});
			return { seq: result.seq, event: result.event, room: result.snapshot };
		}
		case "mode_set": {
			const result = service.setMode(
				args.subMode as "plan" | "act" | "ask" | "debug",
				args.driveActive as boolean | undefined,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "mode_get":
			return service.getMode();
		case "interrupt_raise": {
			const result = service.raiseHand(
				String(args.participantId),
				Boolean(args.raised ?? true),
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "interrupt_ack": {
			const result = service.interruptAck(
				String(args.participantId),
				{
					intent: args.intent as
						| "stop"
						| "clarify"
						| "redirect"
						| "fresh"
						| undefined,
					gist: args.gist as string | undefined,
					turnInFlight: args.turnInFlight as boolean | undefined,
					hardCancel: args.hardCancel as boolean | undefined,
				},
				args.actorId as string | undefined,
			);
			return { seq: result.seq, event: result.event };
		}
		case "conversation_publish": {
			const result = service.publishConversation(
				String(args.text),
				args.actorId as string | undefined,
				args.opId as string | undefined,
			);
			return { seq: result.seq, event: result.event };
		}
		case "room_invite": {
			const result = service.invite({
				inviterId: requiredString(args, "inviterId"),
				inviteeId: requiredString(args, "inviteeId"),
				sessionId: args.sessionId as string | undefined,
				title: args.title as string | undefined,
				note: args.note as string | undefined,
			});
			return { seq: result.seq, event: result.event };
		}
		case "session_create": {
			const result = service.createSession({
				sessionId: requiredString(args, "sessionId"),
				organizerId: requiredString(args, "organizerId"),
				title: requiredString(args, "title"),
				project: requiredString(args, "project"),
				participantIds: (args.participantIds as string[]) ?? [],
				agendaTaskIds: (args.agendaTaskIds as string[]) ?? [],
				note: args.note as string | undefined,
			});
			return { seq: result.seq, event: result.event };
		}
		case "session_schedule": {
			const result = service.scheduleSession(
				requiredString(args, "sessionId"),
				requiredString(args, "scheduledFor"),
				args.actorId as string | undefined,
			);
			return { seq: result.seq, event: result.event };
		}
		case "session_start": {
			const result = service.startSession(
				requiredString(args, "sessionId"),
				requiredString(args, "programId"),
				args.actorId as string | undefined,
			);
			return { seq: result.seq, event: result.event };
		}
		case "session_end": {
			const result = service.endSession({
				sessionId: requiredString(args, "sessionId"),
				outcome: args.outcome as "completed" | "cancelled" | undefined,
				replayArtifactId: args.replayArtifactId as string | undefined,
				actorId: args.actorId as string | undefined,
			});
			return { seq: result.seq, event: result.event };
		}
		case "events_since": {
			const sinceSeq = Number(args.sinceSeq ?? 0);
			const events = service.eventsSince(sinceSeq);
			const snap = service.snapshot();
			return { sinceSeq, latestSeq: snap.seq, logId: snap.logId, events };
		}
		case "pack_set":
			return service.setActivePack(String(args.packId));
		case "pack_list":
			return { packs: listPackIds() };
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

/**
 * Viewer HTTP surface + JSON-RPC bridge so MCP stdio can share the same writer.
 */
export async function startHttpWriter(options: HttpWriterOptions): Promise<{
	server: { port: number | undefined; stop: (closeActive?: boolean) => void };
	port: number;
	url: string;
}> {
	const preferred =
		options.port ?? Number(process.env.DRIVEMODE_HTTP_PORT ?? 0);
	const host = options.host ?? "127.0.0.1";

	/**
	 * The request handler proper. Every response it returns is passed through
	 * `withCors` below, so no individual branch has to remember the headers.
	 */
	const handle = async (req: Request): Promise<Response> => {
		const url = new URL(req.url);

		// The reference viewer is a browser app that is pointed at this
		// writer by URL (`?writer=…`), so it is always a cross-origin
		// caller and every fetch is preflighted. Without these headers
		// the viewer cannot read its own writer at all. The writer binds
		// to loopback, owns one room and has no auth by design (v0
		// non-goal), so there is no credential here for an allow-all
		// origin to leak — but it also never reflects credentials:
		// responses are same-origin-readable data only.
		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		if (url.pathname === "/health") {
			return Response.json({
				ok: true,
				roomId: options.store.roomId,
				logId: options.store.logId,
				latestSeq: options.service.snapshot().seq,
				subscribers: options.store.subscriberCount(),
				idempotency: options.service.idempotencyStats(),
			});
		}

		if (url.pathname === "/snapshot") {
			return Response.json(options.service.snapshot());
		}

		if (url.pathname === "/rpc" && req.method === "POST") {
			try {
				const body = (await req.json()) as RpcBody;
				const result = await dispatchRpc(
					options.service,
					body.tool,
					body.args ?? {},
				);
				return Response.json({ ok: true, result });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return Response.json({ ok: false, error: message }, { status: 400 });
			}
		}

		if (url.pathname === "/events") {
			const requestedSince = Number(url.searchParams.get("since") ?? "0");
			let sinceSeq = Number.isFinite(requestedSince) ? requestedSince : 0;

			// Every message on this stream carries `id: <logId>:<seq>`, and
			// EventSource echoes the last id it saw as `Last-Event-ID` when it
			// auto-reconnects. That header — not the frozen `since` from the
			// connect-time URL — is the client's real cursor, so honoring it is
			// what stops a reconnect from replaying (and double-appending)
			// everything since the session began. The embedded logId fences the
			// cursor to the incarnation that issued it: a cursor minted by a
			// previous writer is foreign here, and resuming it against this log
			// would splice two histories — replay this log from the top instead
			// and let the hello's changed logId tell the client to reset.
			const lastEventId = req.headers.get("Last-Event-ID");
			if (lastEventId) {
				const [idLogId, idSeq] = lastEventId.split(":");
				const parsedSeq = Number(idSeq);
				sinceSeq =
					idLogId === options.store.logId && Number.isFinite(parsedSeq)
						? parsedSeq
						: 0;
			}

			const backlog = options.service.eventsSince(sinceSeq);
			const helloSnapshot = options.service.snapshot();
			const sseId = (seq: number) => `${options.store.logId}:${seq}`;
			const maxBuffered = options.sseMaxBufferedMessages ?? 1024;

			let unsubscribe: (() => void) | null = null;
			let heartbeat: ReturnType<typeof setInterval> | null = null;

			/**
			 * One teardown for the stream, idempotent, reachable from every
			 * place that can notice the consumer is gone. Clearing only the
			 * heartbeat would leave the store subscription registered, and the
			 * next append would then write to a closed stream.
			 */
			const teardown = () => {
				unsubscribe?.();
				unsubscribe = null;
				if (heartbeat) {
					clearInterval(heartbeat);
					heartbeat = null;
				}
			};

			const stream = new ReadableStream({
				start(controller) {
					const encoder = new TextEncoder();
					/** Writes to a closed stream throw; that means the consumer left. */
					const write = (chunk: string) => {
						try {
							controller.enqueue(encoder.encode(chunk));
						} catch {
							teardown();
							return false;
						}
						// desiredSize sinks below zero as enqueued messages sit
						// unread. A consumer that far behind is stuck, not slow —
						// and each queued message holds a full snapshot, so the
						// buffer for one dead reader grows without bound. Shed it:
						// the replayable log is what makes this safe, because a
						// live client reconnects and resumes from its cursor.
						if (
							controller.desiredSize !== null &&
							controller.desiredSize < -maxBuffered
						) {
							teardown();
							try {
								controller.close();
							} catch {
								// Already closed or errored — shedding still holds.
							}
							return false;
						}
						return true;
					};
					const send = (payload: unknown, id?: string) =>
						write(
							`${id ? `id: ${id}\n` : ""}data: ${JSON.stringify(payload)}\n\n`,
						);

					// A room can be quiet for minutes at a time, and the server
					// closes a connection that carries nothing — so without this
					// the viewer loses its stream about ten seconds after the
					// last event and then reconnects in a loop. A comment line
					// keeps it warm, and EventSource ignores comments, so it
					// never reaches `onmessage` and cannot be read as an event.
					heartbeat = setInterval(() => {
						write(": ping\n\n");
					}, 5_000);
					// `snapshot` means one thing on this stream: the
					// RoomSnapshot, exactly as the per-event messages
					// below deliver it. Sending the /snapshot envelope
					// here instead would hand the first message a
					// different shape than every message after it.
					// The hello's id marks the position the backlog folds the
					// client up to, so a drop straight after it still resumes
					// past the delivered backlog instead of replaying it.
					send(
						{
							type: "hello",
							roomId: options.store.roomId,
							logId: options.store.logId,
							snapshot: helloSnapshot.room,
							backlog,
						},
						sseId(helloSnapshot.seq),
					);
					unsubscribe = options.store.subscribe((entry, snapshot) => {
						send({ type: "event", entry, snapshot }, sseId(entry.seq));
					});
				},
				cancel() {
					teardown();
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
				},
			});
		}

		if (url.pathname === "/api/raise-hand" && req.method === "POST") {
			const body = (await req.json()) as {
				participantId?: string;
				raised?: boolean;
			};
			const participantId = body.participantId ?? "drive:human";
			const raised = body.raised ?? true;
			const result = options.service.raiseHand(participantId, raised);
			return Response.json({ seq: result.seq, room: result.snapshot });
		}

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(
				`drivemode writer · room=${options.store.roomId}\n` +
					`GET /snapshot  GET /events?since=0  POST /rpc  POST /api/raise-hand\n`,
				{ headers: { "Content-Type": "text/plain" } },
			);
		}

		return new Response("Not found", { status: 404 });
	};

	const withCors = (res: Response): Response => {
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			res.headers.set(key, value);
		}
		return res;
	};

	const tryListen = (port: number) =>
		Bun.serve({
			hostname: host,
			port,
			fetch: async (req) => withCors(await handle(req)),
		});

	let server: {
		port: number | undefined;
		stop: (closeActive?: boolean) => void;
	};
	try {
		server = tryListen(preferred);
	} catch {
		server = tryListen(0);
	}

	const url = `http://${host}:${server.port}`;
	return { server, port: server.port ?? 0, url };
}

export { dispatchRpc };
