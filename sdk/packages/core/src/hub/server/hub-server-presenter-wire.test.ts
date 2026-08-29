import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { __resetDriveRoomsForTests } from "./handlers/drive-handlers";
import { HubServerTransport } from "./hub-server-transport";
import { HubWorkspaceCapabilityAuthority } from "./workspace-capability-authority";

function fakeSessionHost() {
	return {
		subscribe: vi.fn(() => () => {}),
		startSession: vi.fn(),
		stopSession: vi.fn(),
		runTurn: vi.fn(),
		abort: vi.fn(),
		dispose: vi.fn(),
		getSession: vi.fn(),
		getAccumulatedUsage: vi.fn(),
		listSessions: vi.fn(async () => []),
		deleteSession: vi.fn(),
		updateSession: vi.fn(),
		dispatchHookEvent: vi.fn(),
		readSessionMessages: vi.fn(),
	} as never;
}

function createTransport() {
	return new HubServerTransport(
		{
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			sessionHost: fakeSessionHost(),
		},
		new HubWorkspaceCapabilityAuthority(),
	);
}

function command(
	name:
		| "drive.presenter.grant"
		| "drive.presenter.transfer"
		| "drive.presenter.revoke"
		| "drive.presenter.status"
		| "drive.spotlight.set",
	payload?: Record<string, unknown>,
) {
	return {
		version: "v1" as const,
		command: name,
		requestId: `req-${name}`,
		payload,
	};
}

describe("HubServerTransport Presenter wire", () => {
	const transports: HubServerTransport[] = [];

	beforeEach(() => {
		__resetDriveRoomsForTests();
	});

	afterEach(async () => {
		for (const transport of transports.splice(0)) await transport.stop();
		__resetDriveRoomsForTests();
	});

	it("grants, reports, transfers, and revokes Presenter on the command switch", async () => {
		const transport = createTransport();
		transports.push(transport);

		const granted = await transport.handleCommand(
			command("drive.presenter.grant", {
				roomId: "r-wire",
				agentId: "maya",
				durationMs: 120_000,
			}),
		);
		expect(granted.ok).toBe(true);
		expect(granted.payload?.presenter).toMatchObject({
			agentId: "maya",
			title: "presenter",
			permissions: ["stage.present"],
		});

		const status = await transport.handleCommand(
			command("drive.presenter.status", { roomId: "r-wire" }),
		);
		expect(status.ok).toBe(true);
		expect(status.payload?.presenter).toMatchObject({ agentId: "maya" });
		expect(status.payload?.directorPolicy).toMatchObject({
			exportable: false,
			overlayKeys: ["pace", "handoffs"],
		});

		const transferred = await transport.handleCommand(
			command("drive.presenter.transfer", {
				roomId: "r-wire",
				agentId: "scout",
			}),
		);
		expect(transferred.ok).toBe(true);
		expect(transferred.payload?.presenter).toMatchObject({ agentId: "scout" });

		const revoked = await transport.handleCommand(
			command("drive.presenter.revoke", { roomId: "r-wire" }),
		);
		expect(revoked.ok).toBe(true);
		expect(revoked.payload?.presenter).toBeNull();
	});

	it("keeps drive.spotlight.set as the compatibility alias", async () => {
		const transport = createTransport();
		transports.push(transport);

		const reply = await transport.handleCommand(
			command("drive.spotlight.set", {
				roomId: "r-alias",
				participantId: "agent-1",
				reason: "human",
			}),
		);
		expect(reply.ok).toBe(true);
		expect(reply.payload?.snapshot).toMatchObject({
			stage: { sharer: { kind: "agent", participantId: "agent-1" } },
		});
	});
});
