/**
 * Drive call ops over a real hub (ADR-0006 "no second writer", DRV-CALL-STRIP).
 *
 * `driveCallOps` exists so PiP cannot grow its own mute/raise-hand/leave/stage
 * frames. A refactor that quietly changed a payload would be worse than the
 * duplication it replaced, so this suite proves two things at once:
 *
 * 1. Every builder output is byte-identical to the frame `origin/main` inlined
 *    in `useDriveSession` — the GOLDEN_* fixtures below are transcribed from
 *    that file with their pre-refactor line numbers cited.
 * 2. Those exact bytes drive a real `startHubServer` to the expected room
 *    state. The frame's `type` is the hub command name and the rest of the
 *    frame is the payload verbatim (see `handleCallCommand` in
 *    `drive-calls.ts`), so sending a builder's frame here exercises precisely
 *    what the webview would put on the wire.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeHubClient } from "@cline/core/hub/client";
import { resetDriveRoomStoreForTests } from "@cline/core/hub/collaboration";
import { createLocalHubScheduleRuntimeHandlers } from "@cline/core/hub/daemon/runtime-handlers";
import {
	type HubServer,
	startHubServer,
} from "@cline/core/hub/daemon/start-shared-server";
import type {
	HubCommandName,
	HubReplyEnvelope,
	RoomSnapshot,
} from "@cline/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildLeaveFrame,
	buildMuteFrame,
	buildRaiseHandFrame,
	buildSetStageFrame,
} from "../webview/src/drive/driveCallOps";
import {
	DRIVE_PARTICIPANT_HUMAN,
	DRIVE_PARTICIPANT_PARTNER,
} from "../webview/src/drive/types";

/**
 * Scratch ports, distinct from every other suite that binds a real hub:
 * `drive-artifact-corpus` holds 25963/8987, `status-tag-filter` 25971/8993,
 * `drive-agent-appearance` 25983/8999 and `speaker-attribution` 25991/9013.
 * vitest runs e2e files in parallel, so a shared pair fails whichever file
 * loses the race with EADDRINUSE. Overridable because several worktrees run
 * their suites at once.
 */
const HUB_PORT = Number(process.env.CLINE_TEST_CALL_OPS_HUB_PORT ?? 26007);
const DASHBOARD_PORT = Number(
	process.env.CLINE_TEST_CALL_OPS_DASHBOARD_PORT ?? 9027,
);
const ROOM_ID = "room_call_ops_e2e";
// The real ids the strip posts, so a rename cannot silently diverge from the
// suite. `"default"` in the GOLDEN fixtures below stays a literal on purpose:
// it is the wire value, and pinning it catches a change to the constant.
const HUMAN_ID = DRIVE_PARTICIPANT_HUMAN;
const PARTNER_ID = DRIVE_PARTICIPANT_PARTNER;

/**
 * The frames `origin/main` built inline, before `driveCallOps` existed.
 * Line numbers are pre-refactor `useDriveSession.ts`. Key order is preserved
 * so `JSON.stringify` equality is a real byte check, not just a deep-equal.
 */
const GOLDEN_MUTE_SEATED = {
	// useDriveSession.ts:1394-1399 (onMuteToggle, `if (current.roomId)`)
	type: "call_mute",
	roomId: ROOM_ID,
	participantId: HUMAN_ID,
	muted: true,
};
const GOLDEN_MUTE_PRE_JOIN = {
	// useDriveSession.ts:1405-1413 (onMuteToggle, demo / pre-join legacy path)
	type: "driveCommand",
	command: "drive.participant.mute.set",
	payload: { roomId: "default", participantId: HUMAN_ID, muted: true },
};
const GOLDEN_MUTE_PARTNER = {
	// useDriveSession.ts:1448-1453 (onTogglePartnerMute, `if (drive.roomId)`)
	type: "call_mute",
	roomId: ROOM_ID,
	participantId: PARTNER_ID,
	muted: true,
};
const GOLDEN_RAISE_HAND = {
	// useDriveSession.ts:1373-1378 (onHandToggle, `if (current.roomId)`)
	type: "call_raise_hand",
	roomId: ROOM_ID,
	participantId: HUMAN_ID,
	raised: true,
};
const GOLDEN_LEAVE = {
	// useDriveSession.ts:580-584 (leaveDrive)
	type: "call_leave",
	roomId: ROOM_ID,
	participantId: HUMAN_ID,
};
const GOLDEN_LEAVE_UNSEATED = {
	// Same call site with `current.roomId === null`.
	type: "call_leave",
	roomId: "default",
	participantId: HUMAN_ID,
};

const envSnapshot = {
	CLINE_HUB_PORT: process.env.CLINE_HUB_PORT,
	CLINE_HUB_DASHBOARD_PORT: process.env.CLINE_HUB_DASHBOARD_PORT,
	CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
};

const scratchDirs: string[] = [];

function scratch(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratchDirs.push(dir);
	return dir;
}

function okPayload(reply: HubReplyEnvelope): Record<string, unknown> {
	if (!reply.ok) {
		throw new Error(
			`hub command failed: ${reply.error?.code} ${reply.error?.message}`,
		);
	}
	return reply.payload ?? {};
}

describe("Drive call ops over a real hub", () => {
	let workspaceRoot: string;
	let server: HubServer | undefined;
	let client: NodeHubClient | undefined;

	function requireClient(): NodeHubClient {
		if (!client) {
			throw new Error("hub client not started");
		}
		return client;
	}

	/**
	 * Put a builder's frame on the wire exactly as `handleCallCommand` would:
	 * `type` becomes the command, everything else is the payload verbatim.
	 */
	async function sendFrame(frame: {
		type: string;
		[key: string]: unknown;
	}): Promise<Record<string, unknown>> {
		const { type, ...payload } = frame;
		return okPayload(
			await requireClient().command(type as HubCommandName, payload),
		);
	}

	async function readRoom(): Promise<RoomSnapshot> {
		const payload = okPayload(
			await requireClient().command("call_get_room", {
				roomId: ROOM_ID,
				workspaceRoot,
			}),
		);
		return payload.snapshot as RoomSnapshot;
	}

	async function joinCall(): Promise<void> {
		okPayload(
			await requireClient().command("call_join", {
				roomId: ROOM_ID,
				human: { id: HUMAN_ID, displayName: "You", role: "host" },
				agent: { id: PARTNER_ID, displayName: "Cline", role: "partner" },
				workspaceRoot,
				activateDrive: true,
			}),
		);
	}

	beforeEach(async () => {
		process.env.CLINE_HUB_PORT = String(HUB_PORT);
		process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);
		process.env.CLINE_DATA_DIR = scratch("call-ops-e2e-data-");
		workspaceRoot = scratch("call-ops-e2e-ws-");
		resetDriveRoomStoreForTests();
		server = await startHubServer({
			host: "127.0.0.1",
			port: HUB_PORT,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "drive-call-ops-e2e",
			workspaceRoot,
		});
	}, 60_000);

	afterEach(async () => {
		client?.close();
		client = undefined;
		await server?.close().catch(() => undefined);
		server = undefined;
		resetDriveRoomStoreForTests();
	}, 60_000);

	afterAll(() => {
		for (const [key, value] of Object.entries(envSnapshot)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		for (const dir of scratchDirs.splice(0)) {
			// The hub's sqlite handle can outlive close() on Windows.
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// Scratch dir leak is not a test failure.
			}
		}
	});

	describe("builders emit the bytes main emitted", () => {
		it("mute, seated and pre-join, for human and partner", () => {
			expect(
				JSON.stringify(
					buildMuteFrame({
						roomId: ROOM_ID,
						participantId: HUMAN_ID,
						muted: true,
					}),
				),
			).toBe(JSON.stringify(GOLDEN_MUTE_SEATED));
			expect(
				JSON.stringify(
					buildMuteFrame({
						roomId: null,
						participantId: HUMAN_ID,
						muted: true,
					}),
				),
			).toBe(JSON.stringify(GOLDEN_MUTE_PRE_JOIN));
			expect(
				JSON.stringify(
					buildMuteFrame({
						roomId: ROOM_ID,
						participantId: PARTNER_ID,
						muted: true,
					}),
				),
			).toBe(JSON.stringify(GOLDEN_MUTE_PARTNER));
		});

		it("raise hand, and nothing at all before a room exists", () => {
			expect(
				JSON.stringify(
					buildRaiseHandFrame({
						roomId: ROOM_ID,
						participantId: HUMAN_ID,
						raised: true,
					}),
				),
			).toBe(JSON.stringify(GOLDEN_RAISE_HAND));
			// main guarded the post with `if (current.roomId)`; null is that guard.
			expect(
				buildRaiseHandFrame({
					roomId: null,
					participantId: HUMAN_ID,
					raised: true,
				}),
			).toBeNull();
		});

		it("leave, seated and unseated", () => {
			expect(
				JSON.stringify(
					buildLeaveFrame({ roomId: ROOM_ID, participantId: HUMAN_ID }),
				),
			).toBe(JSON.stringify(GOLDEN_LEAVE));
			expect(
				JSON.stringify(
					buildLeaveFrame({ roomId: null, participantId: HUMAN_ID }),
				),
			).toBe(JSON.stringify(GOLDEN_LEAVE_UNSEATED));
		});
	});

	it("drives the human's mute both ways through the builder's frame", async () => {
		// The hub seats the human muted, so assert the transitions rather than
		// an assumed starting value.
		await joinCall();

		await sendFrame(
			buildMuteFrame({
				roomId: ROOM_ID,
				participantId: HUMAN_ID,
				muted: false,
			}),
		);
		expect((await readRoom()).muteByParticipantId[HUMAN_ID]).toBe(false);

		await sendFrame(
			buildMuteFrame({ roomId: ROOM_ID, participantId: HUMAN_ID, muted: true }),
		);
		expect((await readRoom()).muteByParticipantId[HUMAN_ID]).toBe(true);
	}, 60_000);

	it("mutes the partner through the same builder", async () => {
		await joinCall();
		const before = (await readRoom()).muteByParticipantId[HUMAN_ID];

		await sendFrame(
			buildMuteFrame({
				roomId: ROOM_ID,
				participantId: PARTNER_ID,
				muted: true,
			}),
		);

		const snapshot = await readRoom();
		expect(snapshot.muteByParticipantId[PARTNER_ID]).toBe(true);
		// One op, two participants: muting the partner is the same frame shape
		// with a different id, and it must not touch the human's mute.
		expect(snapshot.muteByParticipantId[HUMAN_ID]).toBe(before);
	}, 60_000);

	it("raises and lowers the hand through the builder's frame", async () => {
		await joinCall();

		const raise = buildRaiseHandFrame({
			roomId: ROOM_ID,
			participantId: HUMAN_ID,
			raised: true,
		});
		if (!raise) {
			throw new Error("seated raise-hand must build a frame");
		}
		await sendFrame(raise);
		expect((await readRoom()).raisedHandByParticipantId[HUMAN_ID]).toBe(true);

		const lower = buildRaiseHandFrame({
			roomId: ROOM_ID,
			participantId: HUMAN_ID,
			raised: false,
		});
		if (!lower) {
			throw new Error("seated lower-hand must build a frame");
		}
		await sendFrame(lower);
		expect((await readRoom()).raisedHandByParticipantId[HUMAN_ID]).toBeFalsy();
	}, 60_000);

	it("sets the stage through the shared share-pin builder", async () => {
		await joinCall();

		await sendFrame(
			buildSetStageFrame({
				roomId: ROOM_ID,
				sharer: { kind: "human", participantId: HUMAN_ID },
				pin: { kind: "file", label: "router.ts", ref: "src/router.ts" },
			}),
		);

		const snapshot = await readRoom();
		expect(snapshot.stage.sharer).toEqual({
			kind: "human",
			participantId: HUMAN_ID,
		});
		expect(snapshot.stage.pin).toEqual({
			kind: "file",
			label: "router.ts",
			ref: "src/router.ts",
		});
	}, 60_000);

	it("leaves the room through the builder's frame", async () => {
		await joinCall();
		expect((await readRoom()).participants.some((p) => p.id === HUMAN_ID)).toBe(
			true,
		);

		await sendFrame(
			buildLeaveFrame({ roomId: ROOM_ID, participantId: HUMAN_ID }),
		);

		const snapshot = await readRoom();
		expect(snapshot.participants.some((p) => p.id === HUMAN_ID)).toBe(false);
		// Leave removes the human and keeps the work: the agent stays seated.
		expect(snapshot.participants.some((p) => p.id === PARTNER_ID)).toBe(true);
	}, 60_000);
});
