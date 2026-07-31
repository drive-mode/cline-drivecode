import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubCommandEnvelope, HubEventEnvelope } from "@cline/shared";
import { resolveDriveRoomEventsPath, resolveDriveRoomsDir } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendBankLogEvent } from "../../collaboration/bankEventLog";
import type { HubTransportContext } from "./context";
import { handleDriveSessionRollupsCommand } from "./drive-session-rollups-handlers";

function command(
	name: HubCommandEnvelope["command"],
	payload?: Record<string, unknown>,
): HubCommandEnvelope {
	return {
		version: "v1",
		requestId: "req_rollups",
		clientId: "test",
		command: name,
		payload,
	};
}

function ctx(): HubTransportContext {
	return {
		clients: new Map(),
		sessionState: new Map(),
		pendingApprovals: new Map(),
		pendingCapabilityRequests: new Map(),
		suppressNextTerminalEventBySession: new Map(),
		sessionHost: {} as HubTransportContext["sessionHost"],
		publish: () => {},
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
}

describe("handleDriveSessionRollupsCommand", () => {
	const dirs: string[] = [];

	afterEach(async () => {
		for (const dir of dirs.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("requires workspaceRoot", async () => {
		const reply = await handleDriveSessionRollupsCommand(
			ctx(),
			command("drive_session_rollups"),
		);
		expect(reply.ok).toBe(false);
		expect(reply.error?.code).toBe("invalid_payload");
	});

	it("returns empty rollups when logs missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "hub-rollups-empty-"));
		dirs.push(root);
		const reply = await handleDriveSessionRollupsCommand(
			ctx(),
			command("drive_session_rollups", { workspaceRoot: root }),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.rollups).toEqual([]);
		expect(String(reply.payload?.dump)).toContain("No session rollups");
	});

	it("returns derived rollups from local JSONL", async () => {
		const root = await mkdtemp(join(tmpdir(), "hub-rollups-data-"));
		dirs.push(root);
		const roomId = "room-1";
		const callSessionId = "cs-hub";
		await mkdir(join(resolveDriveRoomsDir(root), roomId), {
			recursive: true,
		});
		const joinEv = {
			schemaVersion: 1,
			id: "j1",
			roomId,
			at: "2026-07-30T10:00:00.000Z",
			callSessionId,
			type: "control.join",
			track: "control",
			participant: {
				id: "human",
				kind: "human",
				displayName: "You",
				role: "host",
				status: "idle",
			},
		};
		const leaveEv = {
			schemaVersion: 1,
			id: "l1",
			roomId,
			at: "2026-07-30T10:10:00.000Z",
			callSessionId,
			type: "control.leave",
			track: "control",
			participantId: "human",
			durationMs: 600_000,
		};
		await writeFile(
			resolveDriveRoomEventsPath(root, roomId),
			`${JSON.stringify({ seq: 1, event: joinEv })}\n${JSON.stringify({ seq: 2, event: leaveEv })}\n`,
			"utf8",
		);
		appendBankLogEvent(root, {
			schemaVersion: 1,
			id: "c1",
			at: "2026-07-30T10:05:00.000Z",
			roomId,
			callSessionId,
			type: "drive_task_completed",
			taskId: "t1",
		});

		const reply = await handleDriveSessionRollupsCommand(
			ctx(),
			command("drive_session_rollups", {
				workspaceRoot: root,
				limit: 5,
			}),
		);
		expect(reply.ok).toBe(true);
		const rollups = reply.payload?.rollups as Array<{
			callSessionId: string;
			tasksCompleted: number;
		}>;
		expect(rollups).toHaveLength(1);
		expect(rollups[0]?.callSessionId).toBe(callSessionId);
		expect(rollups[0]?.tasksCompleted).toBe(1);
		expect(String(reply.payload?.dump)).toContain(callSessionId);
	});
});
