import { describe, expect, it, vi } from "vitest";
import { handleCallCommand } from "./drive-calls";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

const SNAPSHOT = {
	schemaVersion: 1,
	roomId: "demo-polish",
	createdAt: "2026-08-02T11:45:08.369Z",
	driveActive: false,
	subMode: "act",
	participants: [],
	stage: { sharer: null, pin: null, cards: [] },
	addressSet: { mode: "everyone" },
	muteByParticipantId: {},
	raisedHandByParticipantId: {},
	appliedEventIds: [],
};

function harness(reply: unknown) {
	const send = vi.fn();
	const command = vi.fn().mockResolvedValue(reply);
	const ctx = { uiClient: { command }, send } as unknown as HubContext;
	return { ctx, peer: {} as BrowserPeer, send, command };
}

/**
 * A client awaiting `call_end` picks its reply out of the shared host-message
 * stream, so both failure and success replies have to say which room they are
 * about — and a success has to be distinguishable from the roster snapshots
 * that broadcast for the same room throughout a call.
 */
describe("handleCallCommand correlation fields", () => {
	it("stamps the target roomId on a failed call", async () => {
		const { ctx, peer, send } = harness({
			ok: false,
			error: { message: "room_not_found", code: "room_not_found" },
		});
		await handleCallCommand(ctx, peer, {
			type: "call_end",
			roomId: "demo-polish",
			actorId: "drive:human",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "call_error",
				command: "call_end",
				roomId: "demo-polish",
			}),
		);
	});

	it("stamps the target roomId when the hub is disconnected", async () => {
		const send = vi.fn();
		const ctx = { uiClient: null, send } as unknown as HubContext;
		const peer = {} as BrowserPeer;
		await handleCallCommand(ctx, peer, {
			type: "call_end",
			roomId: "demo-polish",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "call_error",
				code: "hub_disconnected",
				roomId: "demo-polish",
			}),
		);
	});

	it("stamps the target roomId when the command throws", async () => {
		const send = vi.fn();
		const command = vi.fn().mockRejectedValue(new Error("socket closed"));
		const ctx = { uiClient: { command }, send } as unknown as HubContext;
		const peer = {} as BrowserPeer;
		await handleCallCommand(ctx, peer, {
			type: "call_end",
			roomId: "demo-polish",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "call_error",
				code: "call_command_failed",
				roomId: "demo-polish",
			}),
		);
	});

	it("marks the call_end snapshot as ended", async () => {
		const { ctx, peer, send } = harness({
			ok: true,
			payload: {
				snapshot: SNAPSHOT,
				seq: 9,
				ended: true,
				handoffNarration: "Session handoff: Done: (none).",
			},
		});
		await handleCallCommand(ctx, peer, {
			type: "call_end",
			roomId: "demo-polish",
		});
		expect(send).toHaveBeenCalledWith(
			peer,
			expect.objectContaining({
				type: "room_snapshot",
				roomId: "demo-polish",
				ended: true,
			}),
		);
	});

	it("marks an idempotent double-end as ended even without narration", async () => {
		const { ctx, peer, send } = harness({
			ok: true,
			payload: { snapshot: SNAPSHOT, seq: 9, ended: true, idempotent: true },
		});
		await handleCallCommand(ctx, peer, {
			type: "call_end",
			roomId: "demo-polish",
		});
		const sent = send.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(sent.ended).toBe(true);
		expect(sent.handoffNarration).toBeUndefined();
	});

	it("leaves ended off snapshots from other call commands", async () => {
		const { ctx, peer, send } = harness({
			ok: true,
			payload: { snapshot: SNAPSHOT, seq: 4 },
		});
		await handleCallCommand(ctx, peer, {
			type: "call_mute",
			roomId: "demo-polish",
			participantId: "drive:human",
			muted: true,
		});
		const sent = send.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(sent.type).toBe("room_snapshot");
		expect(sent.ended).toBeUndefined();
	});
});
