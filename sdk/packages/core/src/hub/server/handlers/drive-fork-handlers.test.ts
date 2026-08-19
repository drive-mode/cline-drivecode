import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HubTransportContext } from "./context";
import {
	__resetDriveForkRoomsForTests,
	handleDriveForkCommand,
} from "./drive-fork-handlers";

function envelope(
	command: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		command,
		requestId: "req-1",
		payload,
	};
}

function createCtx() {
	const published: HubEventEnvelope[] = [];
	const messagesBySession = new Map<string, unknown[]>();
	const metadataBySession = new Map<
		string,
		Record<string, unknown> | undefined
	>();
	const ctx = {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		pendingDriveToolInputs: new Map(),
		activeRpcTurnCountBySession: new Map(),
		sessionHost: {
			startSession: vi.fn(
				async (input: {
					config?: { sessionId?: string };
					sessionMetadata?: Record<string, unknown>;
				}) => {
					const sessionId = input.config?.sessionId ?? "worker-generated";
					messagesBySession.set(sessionId, [
						{ role: "user", content: "seed" },
						{ role: "assistant", content: "worked" },
					]);
					metadataBySession.set(sessionId, input.sessionMetadata);
					return {
						sessionId,
						manifest: {},
						manifestPath: "",
						messagesPath: "",
					};
				},
			),
			abort: vi.fn(async () => undefined),
			runTurn: vi.fn(async () => undefined),
			deleteSession: vi.fn(async () => true),
			readSessionMessages: vi.fn(async (sessionId: string) => {
				return messagesBySession.get(sessionId) ?? [];
			}),
			/** Simulates the durable (SQLite-backed) session record lookup. */
			getSession: vi.fn(async (sessionId: string) => {
				if (!metadataBySession.has(sessionId)) {
					return undefined;
				}
				return { sessionId, metadata: metadataBySession.get(sessionId) };
			}),
		},
		publish: (event: HubEventEnvelope) => {
			published.push(event);
		},
		buildEvent: (
			event: HubEventEnvelope["event"],
			payload?: Record<string, unknown>,
		) =>
			({
				version: "v1",
				event,
				payload,
			}) as unknown as HubEventEnvelope,
		requestCapability: vi.fn(),
	} as unknown as HubTransportContext;
	return { ctx, published };
}

const doItem = {
	id: "do-1",
	title: "Fix flake",
	goal: "Stabilize auth",
	priority: 10,
	status: "queued" as const,
	dependsOn: [] as string[],
	source: "planner" as const,
};

describe("handleDriveForkCommand", () => {
	beforeEach(() => {
		__resetDriveForkRoomsForTests();
	});

	it("claims and spawns a path_disjoint worker", async () => {
		const { ctx, published } = createCtx();
		const reply = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				parentBriefing: "Keep auth green",
				doItem,
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth"],
				reason: "do_claim",
			}),
		);
		expect(reply.ok).toBe(true);
		const room = reply.payload?.room as {
			chatForks: Array<{ lifecycle: string; seed: { doItemId: string } }>;
		};
		expect(room.chatForks).toHaveLength(1);
		expect(room.chatForks[0]?.lifecycle).toBe("running");
		expect(room.chatForks[0]?.seed.doItemId).toBe("do-1");
		expect(
			published.some((event) => event.event === "drive.fork.changed"),
		).toBe(true);
	});

	it("rejects overlapping path_disjoint claims", async () => {
		const { ctx } = createCtx();
		const first = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth"],
			}),
		);
		expect(first.ok).toBe(true);
		const second = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-2",
				doItem: { ...doItem, id: "do-2", title: "Other" },
				workspace: { mode: "path_disjoint" },
				allowedPathPrefixes: ["src/auth/login"],
			}),
		);
		expect(second.ok).toBe(false);
		expect(second.error?.code).toBe("path_overlap");
	});

	it("promotes into director and injects parent summary", async () => {
		const { ctx, published } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		const promote = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.promote", {
				roomId: "r1",
				promote: {
					workerSessionId: fork.workerSessionId,
					doItemId: "do-1",
					status: "done",
					summary: "Flake fixed",
					decisions: ["Prefer waitFor"],
					showItemIds: [],
					eventRefs: [],
					auditHandle: fork.workerSessionId,
					retainForAudit: false,
				},
			}),
		);
		expect(promote.ok).toBe(true);
		const room = promote.payload?.room as {
			director: { doBacklog: Array<{ status: string }> };
			chatForks: Array<{ lifecycle: string }>;
		};
		expect(room.director.doBacklog[0]?.status).toBe("done");
		expect(room.chatForks[0]?.lifecycle).toBe("dropped");
		expect(promote.payload?.mainContextInjection).toContain("Flake fixed");
		expect(
			published.some((event) => event.event === "drive.fork.promoted"),
		).toBe(true);
		expect(ctx.sessionHost.runTurn).toHaveBeenCalled();
		expect(ctx.sessionHost.deleteSession).toHaveBeenCalledWith(
			fork.workerSessionId,
		);
	});

	it("creates show backlog rows from seed linkedShowTemplateIds on promote", async () => {
		const { ctx } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r-show",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem: {
					...doItem,
					id: "do-show",
					linkedShowTemplateIds: ["arch.overview"],
				},
				workspace: { mode: "shared_readonly" },
			}),
		);
		expect(claim.ok).toBe(true);
		const fork = claim.payload?.fork as {
			workerSessionId: string;
			seed: { linkedShowTemplateIds: string[] };
		};
		expect(fork.seed.linkedShowTemplateIds).toEqual(["arch.overview"]);
		const promote = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.promote", {
				roomId: "r-show",
				promote: {
					workerSessionId: fork.workerSessionId,
					doItemId: "do-show",
					status: "done",
					summary: "Architecture drafted",
					decisions: [],
					showItemIds: [],
					eventRefs: [],
					auditHandle: fork.workerSessionId,
					retainForAudit: true,
				},
			}),
		);
		expect(promote.ok).toBe(true);
		expect(promote.payload?.createdShowItemIds).toEqual([
			"show_arch.overview_do-show",
		]);
		const room = promote.payload?.room as {
			director: {
				showBacklog: Array<{
					id: string;
					status: string;
					linkedDoItemId?: string;
					artifactKind: string;
				}>;
			};
		};
		expect(room.director.showBacklog).toEqual([
			expect.objectContaining({
				id: "show_arch.overview_do-show",
				status: "ready",
				linkedDoItemId: "do-show",
				artifactKind: "diagram.architecture",
			}),
		]);
	});

	it("optionally ticks the show director after promote creates shows", async () => {
		const { ctx, published } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r-tick-show",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem: {
					...doItem,
					id: "do-tick",
					linkedShowTemplateIds: ["doc.plan"],
				},
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		const promote = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.promote", {
				roomId: "r-tick-show",
				tickShow: true,
				promote: {
					workerSessionId: fork.workerSessionId,
					doItemId: "do-tick",
					status: "done",
					summary: "Plan card ready",
					decisions: [],
					showItemIds: [],
					eventRefs: [],
					auditHandle: fork.workerSessionId,
					retainForAudit: true,
				},
			}),
		);
		expect(promote.ok).toBe(true);
		expect(promote.payload?.presentedShowId).toBe("show_doc.plan_do-tick");
		const room = promote.payload?.room as {
			director: {
				activeShowId: string | null;
				showBacklog: Array<{ status: string }>;
			};
		};
		expect(room.director.activeShowId).toBe("show_doc.plan_do-tick");
		expect(room.director.showBacklog[0]?.status).toBe("showing");
		expect(
			published.some((event) => event.event === "drive.show.presented"),
		).toBe(true);
	});

	it("cancels via promote cancelled", async () => {
		const { ctx } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		const cancel = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.cancel", {
				roomId: "r1",
				workerSessionId: fork.workerSessionId,
			}),
		);
		expect(cancel.ok).toBe(true);
		const room = cancel.payload?.room as {
			director: { doBacklog: Array<{ status: string }> };
		};
		expect(room.director.doBacklog[0]?.status).toBe("blocked");
	});

	it("returns audit messages while retained", async () => {
		const { ctx } = createCtx();
		const claim = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.claim", {
				roomId: "r1",
				parentSessionId: "sess-main",
				assigneeParticipantId: "agent-1",
				doItem,
				workspace: { mode: "shared_readonly" },
			}),
		);
		const fork = claim.payload?.fork as { workerSessionId: string };
		await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.promote", {
				roomId: "r1",
				promote: {
					workerSessionId: fork.workerSessionId,
					doItemId: "do-1",
					status: "done",
					summary: "ok",
					decisions: [],
					showItemIds: [],
					eventRefs: [],
					auditHandle: fork.workerSessionId,
					retainForAudit: true,
				},
			}),
		);
		const audit = await handleDriveForkCommand(
			ctx,
			envelope("drive.fork.audit.get", {
				roomId: "r1",
				auditHandle: fork.workerSessionId,
			}),
		);
		expect(audit.ok).toBe(true);
		expect(audit.payload?.summaryOnly).toBe(false);
		expect((audit.payload?.messages as unknown[]).length).toBeGreaterThan(0);
	});

	describe("fork depth bound", () => {
		it("allows a first-generation fork spawned by a non-fork session", async () => {
			const { ctx } = createCtx();
			const claim = await handleDriveForkCommand(
				ctx,
				envelope("drive.fork.claim", {
					roomId: "r-depth",
					parentSessionId: "sess-main",
					assigneeParticipantId: "agent-1",
					doItem,
					workspace: { mode: "shared_readonly" },
				}),
			);
			expect(claim.ok).toBe(true);
			const fork = claim.payload?.fork as { seed: { depth: number } };
			expect(fork.seed.depth).toBe(1);
		});

		it("refuses a second-generation fork spawned by a worker session, visibly", async () => {
			const { ctx } = createCtx();
			const firstGen = await handleDriveForkCommand(
				ctx,
				envelope("drive.fork.claim", {
					roomId: "r-depth",
					parentSessionId: "sess-main",
					assigneeParticipantId: "agent-1",
					doItem,
					workspace: { mode: "shared_readonly" },
				}),
			);
			expect(firstGen.ok).toBe(true);
			const worker = firstGen.payload?.fork as { workerSessionId: string };

			// The worker itself now tries to claim a second Do item, i.e. cause
			// a worker of its own — this is exactly the recursion the depth
			// bound exists to stop.
			const secondGen = await handleDriveForkCommand(
				ctx,
				envelope("drive.fork.claim", {
					roomId: "r-depth",
					parentSessionId: worker.workerSessionId,
					assigneeParticipantId: "agent-1",
					doItem: { ...doItem, id: "do-2", title: "Second gen" },
					workspace: { mode: "shared_readonly" },
				}),
			);
			expect(secondGen.ok).toBe(false);
			expect(secondGen.error?.code).toBe("depth_exceeded");

			// Suppression must be visible: a refused record appears in the
			// room's chatForks (what the Workers panel renders from), not just
			// a swallowed reply.
			const room = secondGen.payload?.room as
				| { chatForks?: unknown[] }
				| undefined;
			const list = await handleDriveForkCommand(
				ctx,
				envelope("drive.fork.list", { roomId: "r-depth" }),
			);
			const chatForks = list.payload?.chatForks as Array<{
				lifecycle: string;
				seed: { doItemId: string; depth?: number };
				visibleToHuman: boolean;
				refusal?: { code: string; message: string };
			}>;
			expect(room).toBeUndefined(); // errorReply carries no room payload
			expect(chatForks.some((entry) => entry.lifecycle === "refused")).toBe(
				true,
			);
			const refused = chatForks.find((entry) => entry.lifecycle === "refused");
			expect(refused?.seed.doItemId).toBe("do-2");
			expect(refused?.seed.depth).toBe(2);
			expect(refused?.visibleToHuman).toBe(true);
			expect(refused?.refusal?.code).toBe("depth_exceeded");
		});

		it("allows a second-generation fork when maxDepth is raised", async () => {
			const { ctx } = createCtx();
			const firstGen = await handleDriveForkCommand(
				ctx,
				envelope("drive.fork.claim", {
					roomId: "r-depth-2",
					parentSessionId: "sess-main",
					assigneeParticipantId: "agent-1",
					doItem,
					workspace: { mode: "shared_readonly" },
				}),
			);
			const worker = firstGen.payload?.fork as { workerSessionId: string };
			const secondGen = await handleDriveForkCommand(
				ctx,
				envelope("drive.fork.claim", {
					roomId: "r-depth-2",
					parentSessionId: worker.workerSessionId,
					assigneeParticipantId: "agent-1",
					doItem: { ...doItem, id: "do-2", title: "Second gen" },
					workspace: { mode: "shared_readonly" },
					maxDepth: 2,
				}),
			);
			expect(secondGen.ok).toBe(true);
			const fork = secondGen.payload?.fork as { seed: { depth: number } };
			expect(fork.seed.depth).toBe(2);
		});
	});
});
