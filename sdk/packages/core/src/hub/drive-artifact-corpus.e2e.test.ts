/**
 * Artifact corpus over a real hub (DRV-ARTIFACTS, ADR-0013 lane 1).
 *
 * Drives the real WS protocol against a real `startHubServer`, with real
 * producers, and asserts the three things that make the corpus worth having:
 * artifacts survive a room restart, they survive the room log's trim, and they
 * never carry bytes.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubReplyEnvelope, ShowBacklogItem } from "@cline/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeHubClient } from "./client";
import {
	DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
	getDriveRoomStore,
	resetArtifactLogRetentionCacheForTests,
	resetDriveRoomStoreForTests,
} from "./collaboration";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { type HubServer, startHubServer } from "./daemon/start-shared-server";

const HUB_PORT = 25963;
const DASHBOARD_PORT = 8987;
const ROOM_ID = "room_artifacts_e2e";

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

/** A real producer recipe — `render_mermaid` renders a base64 SVG data URI. */
function mermaidShowItem(
	overrides: Partial<ShowBacklogItem> = {},
): ShowBacklogItem {
	return {
		id: "show_e2e_arch",
		ownerParticipantId: "adam",
		title: "Three-lane state partition",
		intent: "orient the room",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		caption: "Log, live room, facets",
		produce: {
			tool: "render_mermaid",
			templateId: "arch_overview",
			args: { mermaidSource: "graph TD; log-->live; live-->facets;" },
		},
		priority: 20,
		status: "planned",
		scoreReasons: [],
		tags: ["architecture"],
		...overrides,
	};
}

function artifactsJsonlPath(workspaceRoot: string): string {
	return join(workspaceRoot, ".cline", "drive", "artifacts", "events.jsonl");
}

function roomJsonlPath(workspaceRoot: string, roomId: string): string {
	return join(
		workspaceRoot,
		".cline",
		"drive",
		"rooms",
		roomId,
		"events.jsonl",
	);
}

function countLines(path: string): number {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim()).length;
}

function okPayload(reply: HubReplyEnvelope): Record<string, unknown> {
	if (!reply.ok) {
		throw new Error(
			`hub command failed: ${reply.error?.code} ${reply.error?.message}`,
		);
	}
	return reply.payload ?? {};
}

function backlogOf(payload: Record<string, unknown>): ShowBacklogItem[] {
	const room = payload.room as
		| { director?: { showBacklog?: ShowBacklogItem[] } }
		| undefined;
	return room?.director?.showBacklog ?? [];
}

describe("drive artifact corpus over a real hub", () => {
	let workspaceRoot: string;
	let server: HubServer | undefined;
	let client: NodeHubClient | undefined;

	async function startHub(): Promise<void> {
		server = await startHubServer({
			host: "127.0.0.1",
			port: HUB_PORT,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "artifact-corpus-e2e",
			workspaceRoot,
		});
	}

	async function stopHub(): Promise<void> {
		client?.close();
		client = undefined;
		await server?.close().catch(() => undefined);
		server = undefined;
	}

	/** Hub restart: same disk, brand-new process state. */
	async function restartHub(): Promise<void> {
		await stopHub();
		resetDriveRoomStoreForTests();
		resetArtifactLogRetentionCacheForTests();
		await startHub();
	}

	async function joinRoom(): Promise<Record<string, unknown>> {
		const reply = await requireClient().command("call_join", {
			roomId: ROOM_ID,
			human: { id: "you", displayName: "You", role: "host" },
			agent: { id: "adam", displayName: "Cline", role: "partner" },
			workspaceRoot,
			activateDrive: true,
		});
		return okPayload(reply);
	}

	function requireClient(): NodeHubClient {
		if (!client) {
			throw new Error("hub client not started");
		}
		return client;
	}

	beforeEach(async () => {
		process.env.CLINE_HUB_PORT = String(HUB_PORT);
		process.env.CLINE_HUB_DASHBOARD_PORT = String(DASHBOARD_PORT);
		process.env.CLINE_DATA_DIR = scratch("drive-e2e-data-");
		workspaceRoot = scratch("drive-e2e-workspace-");
		resetDriveRoomStoreForTests();
		resetArtifactLogRetentionCacheForTests();
		await startHub();
	});

	afterEach(async () => {
		await stopHub();
		resetDriveRoomStoreForTests();
		resetArtifactLogRetentionCacheForTests();
	});

	afterAll(() => {
		for (const dir of scratchDirs.splice(0)) {
			// The hub's sqlite handle can outlive close() on Windows; a scratch
			// tmpdir left behind is not worth failing the suite over.
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort
			}
		}
		process.env.CLINE_HUB_PORT = envSnapshot.CLINE_HUB_PORT;
		process.env.CLINE_HUB_DASHBOARD_PORT = envSnapshot.CLINE_HUB_DASHBOARD_PORT;
		process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
	});

	it("rehydrates a presented artifact after the room stops and restarts", async () => {
		await joinRoom();

		const presented = okPayload(
			await requireClient().command("drive.show.enqueue", {
				roomId: ROOM_ID,
				presentNow: true,
				showItem: mermaidShowItem(),
			}),
		);
		// The real producer ran: the live item carries a rendered data URI.
		const live = backlogOf(presented).find(
			(item) => item.id === "show_e2e_arch",
		);
		expect(live?.uri).toMatch(/^data:image\/svg\+xml/);
		expect(live?.status).toBe("showing");

		// Stop the room, then restart the hub against the same workspace.
		okPayload(
			await requireClient().command("call_leave", {
				roomId: ROOM_ID,
				participantId: "you",
			}),
		);
		await restartHub();

		const rejoined = await joinRoom();
		expect(rejoined.roomId ?? ROOM_ID).toBeTruthy();

		const room = okPayload(
			await requireClient().command("drive.room.get", { roomId: ROOM_ID }),
		);
		const restored = backlogOf(room).find(
			(item) => item.id === "show_e2e_arch",
		);
		expect(restored).toBeDefined();
		expect(restored?.title).toBe("Three-lane state partition");
		expect(restored?.produce.args.mermaidSource).toBe(
			"graph TD; log-->live; live-->facets;",
		);
		// Bytes never reached the log, so the restored item re-materializes.
		expect(restored?.uri).toBeUndefined();
		expect(restored?.scoreReasons).toContain("restored_from_artifact_log");

		const listed = okPayload(
			await requireClient().command("drive.artifacts.list", {
				workspaceRoot,
			}),
		);
		expect(
			(listed.artifacts as Array<{ showItemId: string; roomId: string }>).map(
				(entry) => `${entry.roomId}/${entry.showItemId}`,
			),
		).toEqual([`${ROOM_ID}/show_e2e_arch`]);
		expect(listed.tags).toEqual(["architecture"]);
	}, 60_000);

	it("keeps the artifact when the room log trims past its cap", async () => {
		await joinRoom();
		okPayload(
			await requireClient().command("drive.show.enqueue", {
				roomId: ROOM_ID,
				presentNow: true,
				showItem: mermaidShowItem(),
			}),
		);

		// Flood the room log with unrelated work well past its 2,048-record cap.
		// Same store the hub server writes through, same bound JSONL.
		const store = getDriveRoomStore();
		const overflow = DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS + 200;
		for (let i = 0; i < overflow; i += 1) {
			store.recordWork({
				roomId: ROOM_ID,
				work: { kind: "edit", path: `src/file-${i}.ts`, summary: `edit ${i}` },
				actorId: "adam",
			});
		}

		// The room log really did trim, oldest first.
		const roomEvents = readFileSync(
			roomJsonlPath(workspaceRoot, ROOM_ID),
			"utf8",
		);
		expect(countLines(roomJsonlPath(workspaceRoot, ROOM_ID))).toBe(
			DEFAULT_ROOM_EVENT_LOG_MAX_RECORDS,
		);
		expect(roomEvents).not.toContain('"src/file-0.ts"');
		expect(roomEvents).not.toContain("control.join");

		// The artifact is untouched — that is what a separate family buys.
		await restartHub();
		await joinRoom();
		const room = okPayload(
			await requireClient().command("drive.room.get", { roomId: ROOM_ID }),
		);
		expect(
			backlogOf(room).find((item) => item.id === "show_e2e_arch")?.title,
		).toBe("Three-lane state partition");
	}, 120_000);

	it("writes no byte key to the artifact jsonl", async () => {
		await joinRoom();
		okPayload(
			await requireClient().command("drive.show.enqueue", {
				roomId: ROOM_ID,
				presentNow: true,
				showItem: mermaidShowItem({
					produce: {
						tool: "render_mermaid",
						templateId: "arch_overview",
						args: {
							mermaidSource: "graph TD; a-->b;",
							render: { dataUri: "data:image/png;base64,NESTEDLEAK" },
						},
					},
				}),
			}),
		);

		const raw = readFileSync(artifactsJsonlPath(workspaceRoot), "utf8");
		expect(raw.length).toBeGreaterThan(0);
		expect(raw).not.toContain("data:image/svg+xml");
		expect(raw).not.toContain("NESTEDLEAK");
		for (const key of [
			"uri",
			"dataUri",
			"svg",
			"image",
			"bytes",
			"thumbnail",
		]) {
			expect(raw).not.toContain(`"${key}":`);
		}
		// The recipe that reproduces it did survive.
		expect(raw).toContain('"mermaidSource":');
	}, 60_000);
});
