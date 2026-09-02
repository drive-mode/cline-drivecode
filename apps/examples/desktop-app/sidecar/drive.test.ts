import type { NodeHubClient } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const ensureSharedHubClientMock = vi.hoisted(() => vi.fn());

vi.mock("./context", async () => {
	const actual = await vi.importActual<typeof import("./context")>("./context");
	return {
		...actual,
		ensureSharedHubClient: ensureSharedHubClientMock,
	};
});

import {
	DRIVE_HUB_EVENT,
	DriveCommandError,
	forwardDriveHubEvent,
	handleDriveCommand,
	isDriveDesktopCommand,
} from "./drive";

type HubReply = {
	ok: boolean;
	payload?: Record<string, unknown>;
	error?: { code: string; message: string };
};

function createContext(options?: {
	hubClient?: Partial<NodeHubClient> | null;
}) {
	const send = vi.fn();
	const commandMock = vi.fn<(...args: unknown[]) => Promise<HubReply>>();
	const hubClient =
		options?.hubClient === null
			? null
			: ({
					command: commandMock,
					isConnected: () => true,
					getUrl: () => "ws://127.0.0.1:41234",
					getConnectionError: () => null,
					...options?.hubClient,
				} as unknown as NodeHubClient);
	const ctx = {
		wsClients: new Set([{ send }]),
		hubClient,
		workspaceRoot: "/workspace/project",
		liveSessions: new Map(),
		logger: { debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	} as unknown as SidecarContext;
	return { ctx, send, commandMock };
}

function readEvents(send: ReturnType<typeof vi.fn>) {
	return send.mock.calls.map(
		([raw]) =>
			JSON.parse(String(raw)) as {
				type: string;
				event: { name: string; payload: Record<string, unknown> };
			},
	);
}

const SNAPSHOT = {
	roomId: "default",
	participants: [],
	stage: null,
};

beforeEach(() => {
	ensureSharedHubClientMock.mockReset();
	ensureSharedHubClientMock.mockImplementation(async (ctx: SidecarContext) => {
		if (ctx.hubClient) {
			return ctx.hubClient;
		}
		throw new Error("Unable to start or connect to the shared Cline Hub.");
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("isDriveDesktopCommand", () => {
	it("recognizes exactly the ten drive_* desktop commands", () => {
		for (const command of [
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
		]) {
			expect(isDriveDesktopCommand(command)).toBe(true);
		}
		expect(isDriveDesktopCommand("drive_anything")).toBe(false);
		expect(isDriveDesktopCommand("list_routine_schedules")).toBe(false);
	});
});

describe("DriveCommandError", () => {
	it("formats message and toString as <code>: <message>", () => {
		const error = new DriveCommandError("room_not_found:default", {
			code: "room_not_found",
			command: "call_get_room",
			roomId: "default",
		});
		expect(error.message).toBe("room_not_found: room_not_found:default");
		expect(String(error)).toBe("room_not_found: room_not_found:default");
		expect(error.code).toBe("room_not_found");
		expect(error.command).toBe("call_get_room");
		expect(error.roomId).toBe("default");
		expect(error.detail).toBe("room_not_found:default");
		expect(error.name).toBe("DriveCommandError");
	});
});

describe("op allowlists", () => {
	it("rejects an unknown drive_call op without touching the hub", async () => {
		const { ctx, commandMock } = createContext();
		const failure = await handleDriveCommand(ctx, "drive_call", {
			op: "call_record_work",
			roomId: "default",
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(DriveCommandError);
		const error = failure as DriveCommandError;
		expect(error.code).toBe("unsupported_drive_op");
		expect(error.message.startsWith("unsupported_drive_op: ")).toBe(true);
		expect(commandMock).not.toHaveBeenCalled();
	});

	it("never forwards a hub command outside the drive_command allowlist", async () => {
		const { ctx, commandMock } = createContext();
		for (const command of [
			"session.delete",
			"drive.fork.promote",
			"",
			undefined,
		]) {
			const failure = await handleDriveCommand(ctx, "drive_command", {
				command,
				payload: {},
			}).catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(DriveCommandError);
			expect((failure as DriveCommandError).code).toBe("unsupported_drive_op");
		}
		expect(commandMock).not.toHaveBeenCalled();
	});

	it("rejects unknown ops for status, bank, agent home, profiles, and config", async () => {
		const { ctx, commandMock } = createContext();
		const cases: Array<[Parameters<typeof handleDriveCommand>[1], string]> = [
			["drive_status", "publish"],
			["drive_bank", "delete"],
			["drive_agent_home", "delete"],
			["drive_agent_profiles", "list"],
			["drive_config", "delete"],
		];
		for (const [command, op] of cases) {
			const failure = await handleDriveCommand(ctx, command, { op }).catch(
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(DriveCommandError);
			expect((failure as DriveCommandError).code).toBe("unsupported_drive_op");
		}
		expect(commandMock).not.toHaveBeenCalled();
	});
});

describe("drive_call", () => {
	it("projects snapshot, seq and callSessionId like the hub dashboard", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: true,
			payload: {
				roomId: "default",
				snapshot: SNAPSHOT,
				seq: 42,
				callSessionId: "call-1",
				whileAwayNote: "  ",
			},
		});
		const result = await handleDriveCommand(ctx, "drive_call", {
			op: "call_get_room",
			roomId: "default",
		});
		expect(commandMock).toHaveBeenCalledWith("call_get_room", {
			roomId: "default",
		});
		expect(result).toEqual({
			roomId: "default",
			snapshot: SNAPSHOT,
			seq: 42,
			callSessionId: "call-1",
		});
	});

	it("keeps ended only when the hub set it and defaults workspaceRoot on call_end", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: true,
			payload: { snapshot: SNAPSHOT, seq: 7, ended: true },
		});
		const result = await handleDriveCommand(ctx, "drive_call", {
			op: "call_end",
			roomId: "default",
		});
		expect(commandMock).toHaveBeenCalledWith("call_end", {
			roomId: "default",
			workspaceRoot: "/workspace/project",
		});
		expect(result).toEqual({
			roomId: "default",
			snapshot: SNAPSHOT,
			seq: 7,
			ended: true,
		});
	});

	it("forwards extra payload verbatim without workspaceRoot for strict ops", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: true,
			payload: { snapshot: SNAPSHOT },
		});
		await handleDriveCommand(ctx, "drive_call", {
			op: "call_mute",
			roomId: "default",
			participantId: "p1",
			muted: true,
		});
		expect(commandMock).toHaveBeenCalledWith("call_mute", {
			roomId: "default",
			participantId: "p1",
			muted: true,
		});
	});

	it("requires roomId", async () => {
		const { ctx, commandMock } = createContext();
		const failure = await handleDriveCommand(ctx, "drive_call", {
			op: "call_get_room",
		}).catch((error: unknown) => error);
		expect((failure as DriveCommandError).code).toBe("invalid_payload");
		expect(commandMock).not.toHaveBeenCalled();
	});

	it("maps a non-ok hub reply to DriveCommandError with the hub code first", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: false,
			error: { code: "room_not_found", message: "room_not_found:default" },
		});
		const failure = await handleDriveCommand(ctx, "drive_call", {
			op: "call_get_room",
			roomId: "default",
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(DriveCommandError);
		const error = failure as DriveCommandError;
		expect(error.message).toBe("room_not_found: room_not_found:default");
		expect(error.code).toBe("room_not_found");
		expect(error.command).toBe("call_get_room");
		expect(error.roomId).toBe("default");
	});

	it("maps a thrown transport error to hub_command_failed", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockRejectedValue(new Error("socket closed"));
		const failure = await handleDriveCommand(ctx, "drive_call", {
			op: "call_get_room",
			roomId: "default",
		}).catch((error: unknown) => error);
		expect((failure as DriveCommandError).message).toBe(
			"hub_command_failed: socket closed",
		);
	});

	it("reports hub_disconnected when the shared hub client cannot be created", async () => {
		const { ctx, commandMock } = createContext({ hubClient: null });
		const failure = await handleDriveCommand(ctx, "drive_call", {
			op: "call_get_room",
			roomId: "default",
		}).catch((error: unknown) => error);
		expect((failure as DriveCommandError).code).toBe("hub_disconnected");
		expect((failure as DriveCommandError).roomId).toBe("default");
		expect(commandMock).not.toHaveBeenCalled();
	});
});

describe("drive_status", () => {
	it("maps op to status.<op> and returns the payload verbatim", async () => {
		const { ctx, commandMock } = createContext();
		const payload = {
			updates: [{ updateId: "u1" }],
			nextCursor: 12,
			tagCounts: [],
		};
		commandMock.mockResolvedValue({ ok: true, payload });
		const result = await handleDriveCommand(ctx, "drive_status", {
			op: "query",
			cursor: 0,
			limit: 50,
		});
		expect(commandMock).toHaveBeenCalledWith("status.query", {
			cursor: 0,
			limit: 50,
		});
		expect(result).toBe(payload);
	});

	it("maps every allowed op", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({ ok: true, payload: {} });
		for (const op of [
			"board",
			"current",
			"subjects",
			"tasks_snapshot",
			"summary",
		]) {
			await handleDriveCommand(ctx, "drive_status", { op });
			expect(commandMock).toHaveBeenLastCalledWith(`status.${op}`, {});
		}
	});
});

describe("drive_command / drive_bank / drive_config / drive_rooms_list", () => {
	it("forwards allowlisted drive.* commands and returns the reply verbatim", async () => {
		const { ctx, commandMock } = createContext();
		const payload = { room: { roomId: "default", version: 3 } };
		commandMock.mockResolvedValue({ ok: true, payload });
		const result = await handleDriveCommand(ctx, "drive_command", {
			command: "drive.room.get",
			payload: { roomId: "default" },
		});
		expect(commandMock).toHaveBeenCalledWith("drive.room.get", {
			roomId: "default",
		});
		expect(result).toBe(payload);
	});

	it("defaults workspaceRoot for drive.artifacts.list only", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({ ok: true, payload: { artifacts: [] } });
		await handleDriveCommand(ctx, "drive_command", {
			command: "drive.artifacts.list",
		});
		expect(commandMock).toHaveBeenLastCalledWith("drive.artifacts.list", {
			workspaceRoot: "/workspace/project",
		});
		await handleDriveCommand(ctx, "drive_command", {
			command: "drive.presenter.status",
		});
		expect(commandMock).toHaveBeenLastCalledWith("drive.presenter.status", {});
	});

	it("maps bank ops to drive_bank_<op> with the sidecar workspaceRoot", async () => {
		const { ctx, commandMock } = createContext();
		const payload = { snapshot: { planId: null } };
		commandMock.mockResolvedValue({ ok: true, payload });
		const result = await handleDriveCommand(ctx, "drive_bank", {
			op: "create_task",
			title: "Ship it",
		});
		expect(commandMock).toHaveBeenCalledWith("drive_bank_create_task", {
			title: "Ship it",
			workspaceRoot: "/workspace/project",
		});
		expect(result).toBe(payload);
	});

	it("maps config ops to drive_config_<op>", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({ ok: true, payload: { profiles: [] } });
		await handleDriveCommand(ctx, "drive_config", {
			op: "upsert_profile",
			workspaceRoot: "/elsewhere",
			profile: { name: "x" },
		});
		expect(commandMock).toHaveBeenCalledWith("drive_config_upsert_profile", {
			workspaceRoot: "/elsewhere",
			profile: { name: "x" },
		});
	});

	it("lists rooms through call_list_rooms", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: true,
			payload: { rooms: [{ roomId: "default" }] },
		});
		const result = await handleDriveCommand(ctx, "drive_rooms_list", {});
		expect(commandMock).toHaveBeenCalledWith("call_list_rooms", {
			workspaceRoot: "/workspace/project",
		});
		expect(result).toEqual({ rooms: [{ roomId: "default" }] });
	});
});

describe("drive_session_rollups", () => {
	it("privacy-gates rollups into StatusSessionRow entries", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: true,
			payload: {
				rollups: [
					{
						callSessionId: "call-1",
						roomId: "default",
						tasksCompleted: 2,
						completedTaskIds: ["t1", "t2"],
						planCleanDrain: true,
						postSuccessPlanContinue: false,
						failureStickyCount: 0,
						durationMs: 1200,
					},
					{ callSessionId: "call-2", transcript: "never" },
					{ transcript: "never" },
				],
				dump: "dump text",
				limit: 10,
			},
		});
		const result = (await handleDriveCommand(ctx, "drive_session_rollups", {
			limit: 10.7,
			callSessionId: " call-1 ",
		})) as { sessions: Array<{ callSessionId: string }>; dump: string };
		expect(commandMock).toHaveBeenCalledWith("drive_session_rollups", {
			workspaceRoot: "/workspace/project",
			limit: 10,
			callSessionId: "call-1",
		});
		expect(result.dump).toBe("dump text");
		// The projection keeps only StatusSessionRow fields, so the forbidden
		// transcript key never reaches the webview; rows without a
		// callSessionId are dropped outright.
		expect(result.sessions.map((row) => row.callSessionId)).toEqual([
			"call-1",
			"call-2",
		]);
		expect(JSON.stringify(result)).not.toContain("never");
	});
});

describe("drive_agent_home", () => {
	it("strips everything but the sanitized home/compiled fields", async () => {
		const { ctx, commandMock } = createContext();
		commandMock.mockResolvedValue({
			ok: true,
			payload: {
				home: {
					slug: "builder",
					agent: {
						name: "Builder",
						description: "Builds",
						prompt: "SECRET SYSTEM PROMPT",
						tools: ["bash"],
					},
					permissions: { presetIntent: "standard", approvalHooks: [] },
					promptPath: "/home/x/agent.md",
				},
				compiled: {
					name: "Builder",
					slug: "builder",
					description: "Builds",
					systemPrompt: "SECRET",
				},
			},
		});
		const result = await handleDriveCommand(ctx, "drive_agent_home", {
			op: "get",
			slug: "builder",
		});
		expect(commandMock).toHaveBeenCalledWith("drive_agent_home_get", {
			workspaceRoot: "/workspace/project",
			slug: "builder",
		});
		expect(JSON.stringify(result)).not.toContain("SECRET");
		expect(result).toEqual({
			home: {
				slug: "builder",
				agent: { name: "Builder", description: "Builds", tools: ["bash"] },
				permissions: { presetIntent: "standard", approvalHooks: [] },
			},
			compiled: { name: "Builder", slug: "builder", description: "Builds" },
		});
	});
});

describe("drive_hub_status", () => {
	it("reports the connected shared hub", async () => {
		const { ctx } = createContext();
		const result = await handleDriveCommand(ctx, "drive_hub_status");
		expect(result).toEqual({
			connected: true,
			url: "ws://127.0.0.1:41234",
			error: null,
			workspaceRoot: "/workspace/project",
		});
	});

	it("returns unreachable instead of throwing when the hub cannot start", async () => {
		const { ctx } = createContext({ hubClient: null });
		const result = await handleDriveCommand(ctx, "drive_hub_status");
		expect(result).toEqual({
			connected: false,
			url: null,
			error: "Unable to start or connect to the shared Cline Hub.",
			workspaceRoot: "/workspace/project",
		});
	});

	it("gives up after the short timeout while the hub is still starting", async () => {
		vi.useFakeTimers();
		const { ctx } = createContext({ hubClient: null });
		ensureSharedHubClientMock.mockImplementation(
			() => new Promise<never>(() => undefined),
		);
		const pending = handleDriveCommand(ctx, "drive_hub_status");
		await vi.advanceTimersByTimeAsync(3_000);
		const result = (await pending) as { connected: boolean; error: string };
		expect(result.connected).toBe(false);
		expect(result.error).toContain("did not respond within 3000ms");
	});
});

describe("forwardDriveHubEvent", () => {
	it("forwards room.*, drive.* and status.updated with seq lifted from the payload", () => {
		const { ctx, send } = createContext();
		expect(
			forwardDriveHubEvent(ctx, {
				event: "room.snapshot",
				payload: { roomId: "default", snapshot: SNAPSHOT, seq: 9 },
				timestamp: Date.UTC(2026, 8, 2, 12, 0, 0),
			}),
		).toBe(true);
		expect(
			forwardDriveHubEvent(ctx, {
				event: "drive.spotlight.changed",
				payload: { from: null, to: "p1" },
			}),
		).toBe(true);
		expect(
			forwardDriveHubEvent(ctx, {
				event: "status.updated",
				payload: { updateId: "u1", seq: "not-a-number" },
			}),
		).toBe(true);
		const events = readEvents(send);
		expect(events.map((entry) => entry.event.name)).toEqual([
			DRIVE_HUB_EVENT,
			DRIVE_HUB_EVENT,
			DRIVE_HUB_EVENT,
		]);
		expect(events[0]?.event.payload).toEqual({
			event: "room.snapshot",
			payload: { roomId: "default", snapshot: SNAPSHOT, seq: 9 },
			seq: 9,
			timestamp: "2026-09-02T12:00:00.000Z",
		});
		expect(events[1]?.event.payload).toEqual({
			event: "drive.spotlight.changed",
			payload: { from: null, to: "p1" },
		});
		expect(events[2]?.event.payload).toEqual({
			event: "status.updated",
			payload: { updateId: "u1", seq: "not-a-number" },
		});
	});

	it("ignores session-scoped and other hub events", () => {
		const { ctx, send } = createContext();
		for (const event of [
			"assistant.delta",
			"session.updated",
			"status.published",
			"schedule.created",
			"hub.client.updated",
		]) {
			expect(forwardDriveHubEvent(ctx, { event, payload: {} })).toBe(false);
		}
		expect(send).not.toHaveBeenCalled();
	});
});
