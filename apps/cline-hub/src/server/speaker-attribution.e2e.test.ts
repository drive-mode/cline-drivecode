/**
 * Feed speaker attribution over a real hub (DRV-ADDRESS).
 *
 * Drives the real WS protocol against a real `startHubServer`: joins a call,
 * seats agents, changes the address, and asserts the byline the feed would
 * actually render from the snapshot the hub returns.
 *
 * The assertions run the real `resolveAddressedSpeakerId` over a real
 * `call_get_room` reply and feed its output to the real `resolveSpeakerByline`
 * — the same two functions the hub and the webview call. A test that built its
 * own roster literal would prove only that the literal was well typed.
 *
 * The case that matters is the absent one: a room with two seated agents and
 * no narrowing address must produce no byline, because seating creates no
 * runtime and nothing distinguishes the two.
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
import type { HubReplyEnvelope, RoomSnapshot } from "@cline/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSpeakerByline } from "../webview/src/components/speakerBylineLogic";
import { resolveAddressedSpeakerId } from "./speaker-attribution";

/**
 * Scratch ports, distinct from every other suite that binds a real hub.
 * `drive-artifact-corpus` holds 25963/8987, `status-tag-filter` 25971/8993 and
 * `drive-agent-appearance` 25983/8999; vitest runs e2e files in parallel, so a
 * shared pair fails whichever file loses the race with EADDRINUSE. Overridable
 * because several worktrees run their suites at once.
 */
const HUB_PORT = Number(process.env.CLINE_TEST_SPEAKER_HUB_PORT ?? 25991);
const DASHBOARD_PORT = Number(
	process.env.CLINE_TEST_SPEAKER_DASHBOARD_PORT ?? 9013,
);
const ROOM_ID = "room_speaker_e2e";

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

describe("feed speaker attribution over a real hub", () => {
	let workspaceRoot: string;
	let server: HubServer | undefined;
	let client: NodeHubClient | undefined;

	function requireClient(): NodeHubClient {
		if (!client) {
			throw new Error("hub client not started");
		}
		return client;
	}

	/** The room exactly as the hub reports it, via the real `call_get_room`. */
	async function readRoom(): Promise<RoomSnapshot> {
		const payload = okPayload(
			await requireClient().command("call_get_room", {
				roomId: ROOM_ID,
				workspaceRoot,
			}),
		);
		return payload.snapshot as RoomSnapshot;
	}

	/** What the feed would render above an assistant message, end to end. */
	async function bylineNow(): Promise<string | null> {
		const snapshot = await readRoom();
		return resolveSpeakerByline(
			resolveAddressedSpeakerId(snapshot),
			snapshot.participants,
		);
	}

	async function joinCall(): Promise<void> {
		okPayload(
			await requireClient().command("call_join", {
				roomId: ROOM_ID,
				human: { id: "you", displayName: "You", role: "host" },
				agent: { id: "adam", displayName: "Cline", role: "partner" },
				workspaceRoot,
				activateDrive: true,
			}),
		);
	}

	async function seatReviewer(): Promise<void> {
		okPayload(
			await requireClient().command("call_seat", {
				roomId: ROOM_ID,
				agent: {
					id: "reviewer",
					displayName: "Reviewer",
					role: "specialist",
				},
			}),
		);
	}

	beforeEach(async () => {
		process.env.CLINE_HUB_PORT = String(HUB_PORT);
		process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);
		process.env.CLINE_DATA_DIR = scratch("speaker-e2e-data-");
		workspaceRoot = scratch("speaker-e2e-ws-");
		resetDriveRoomStoreForTests();
		server = await startHubServer({
			host: "127.0.0.1",
			port: HUB_PORT,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "speaker-attribution-e2e",
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

	it("names the only seated agent", async () => {
		await joinCall();
		expect(await bylineNow()).toBe("Cline");
	}, 60_000);

	it("renders no byline once a second agent is seated", async () => {
		await joinCall();
		expect(await bylineNow()).toBe("Cline");

		await seatReviewer();

		// Two seated agents, one runtime, address still everyone: nothing says
		// which of them produced the reply, so the feed must stay silent.
		const snapshot = await readRoom();
		expect(
			snapshot.participants.filter((p) => p.kind === "agent"),
		).toHaveLength(2);
		expect(resolveAddressedSpeakerId(snapshot)).toBeUndefined();
		expect(await bylineNow()).toBeNull();
	}, 60_000);

	it("names the agent once the address narrows to one", async () => {
		await joinCall();
		await seatReviewer();
		expect(await bylineNow()).toBeNull();

		okPayload(
			await requireClient().command("call_set_address", {
				roomId: ROOM_ID,
				addressSet: { mode: "agents", agentIds: ["reviewer"] },
			}),
		);

		expect(await bylineNow()).toBe("Reviewer");
	}, 60_000);

	it("goes silent again when the address widens back to everyone", async () => {
		await joinCall();
		await seatReviewer();
		okPayload(
			await requireClient().command("call_set_address", {
				roomId: ROOM_ID,
				addressSet: { mode: "agents", agentIds: ["adam"] },
			}),
		);
		expect(await bylineNow()).toBe("Cline");

		okPayload(
			await requireClient().command("call_set_address", {
				roomId: ROOM_ID,
				addressSet: { mode: "everyone" },
			}),
		);

		expect(await bylineNow()).toBeNull();
	}, 60_000);

	it("renders no byline for a message that carries no speaker", async () => {
		// Every hydrated message takes this path — attribution is not persisted
		// on chat history, so history reloads unattributed.
		await joinCall();
		const snapshot = await readRoom();
		expect(resolveSpeakerByline(undefined, snapshot.participants)).toBeNull();
	}, 60_000);
});
