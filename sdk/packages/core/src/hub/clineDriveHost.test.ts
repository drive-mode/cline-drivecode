/**
 * Local DriveHostPort adapter tests (ADR-0013 phase 5).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLINE_HOST_CAPABILITIES, createDriveHarness, runHostConformance } from "@cline/drive";
import { afterEach, describe, expect, it } from "vitest";
import { createClineDriveHost } from "./clineDriveHost";
import {
	DriveRoomStore,
	JsonlRoomEventLog,
	rebindJsonlRoomEventLog,
} from "./collaboration";

describe("createClineDriveHost", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("passes local capability conformance", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const report = await runHostConformance(host, {
			localOnly: true,
			remoteBridge: false,
			orgConfig: false,
			auditExport: false,
			promptRewrite: false,
			worktreeIsolation: false,
		});
		expect(report.ok).toBe(true);
	});

	it("advertises only implemented capabilities by default", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const host = createClineDriveHost({
			configParent: dir,
			store: new DriveRoomStore(),
		});
		expect(host.capabilities).toMatchObject({
			...CLINE_HOST_CAPABILITIES,
			promptRewrite: false,
			worktreeIsolation: false,
		});
		await expect(
			host.applyPromptRewrite({ turnId: "t1", rewrite: "x" }),
		).rejects.toThrow(/promptRewrite not advertised/);
	});

	it("advertises promptRewrite only when rewrite fn is wired", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const seen: string[] = [];
		const host = createClineDriveHost({
			configParent: dir,
			store: new DriveRoomStore(),
			promptRewriteFn: async (decision) => {
				seen.push(decision.rewrite);
			},
		});
		expect(host.capabilities.promptRewrite).toBe(true);
		expect(host.capabilities.worktreeIsolation).toBe(false);
		await host.applyPromptRewrite({ turnId: "t1", rewrite: "rewritten" });
		expect(seen).toEqual(["rewritten"]);
	});

	it("commits join through the store + log", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		await host.commitRoomOp({
			type: "create",
			roomId: "r1",
			hostParticipantId: "h1",
		});
		const snap = await host.commitRoomOp({
			type: "join",
			roomId: "r1",
			participant: {
				id: "h1",
				kind: "human",
				displayName: "H",
				role: "host",
				status: "idle",
			},
		});
		expect(snap.participants).toHaveLength(1);
		expect(store.lastSeq("r1")).toBe(1);
	});

	it("createDriveHarness createOrAttach works on the Cline host", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const drive = createDriveHarness({ host });
		await drive.start();
		const room = await drive.rooms.createOrAttach({
			roomId: "call-1",
			humanId: "drive:human",
			humanDisplayName: "You",
		});
		expect(room.driveActive).toBe(true);
		expect(room.participants).toHaveLength(2);
		expect(await host.getRoom?.("call-1")).toMatchObject({
			roomId: "call-1",
			driveActive: true,
		});
	});

	it("round-trips durable facets", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const host = createClineDriveHost({
			configParent: dir,
			store: new DriveRoomStore(),
		});
		const facets = await host.readDurableFacets(dir);
		expect(facets).toMatchObject({ "runtime.profile": "cloud" });
		await host.writeDurableFacets(dir, facets);
		const again = await host.readDurableFacets(dir);
		expect(again).toMatchObject({ "runtime.profile": "cloud" });
	});

	it("createDriveHarness shows.enqueue commits via DirectorOp", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "show-room",
			humanId: "drive:human",
		});
		const result = await drive.shows.enqueue("show-room", {
			id: "show-1",
			ownerParticipantId: "drive:partner",
			title: "Diagram",
			intent: "Explain",
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			caption: "cap",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; A-->B;" },
			},
			priority: 10,
			status: "planned",
			scoreReasons: [],
		});
		expect(result.planned?.id).toBe("show-1");
		const live = result.liveRoom as {
			director: { showBacklog: Array<{ id: string }> };
		};
		expect(live.director.showBacklog.some((item) => item.id === "show-1")).toBe(
			true,
		);
	});

	it("does not bind a durable event log when no workspace root is known", () => {
		// Regression: createClineDriveHost used to fall back to tmpdir() and
		// eagerly attach a JsonlRoomEventLog there whenever a command reached
		// the harness before any workspaceRoot was known. Every process on the
		// machine shares tmpdir(), so that made any command issued pre-join
		// (or the test suite's own no-workspaceRoot commands) durably write
		// under a path a later real workspace's first join would read from.
		// The store always has *a* log (its in-memory pre-bind buffer, so
		// commits are never silently un-durable), but it must not be a
		// JsonlRoomEventLog until a real configParent is given.
		const store = new DriveRoomStore();
		createClineDriveHost({ store });
		expect(store.getEventLog()).not.toBeInstanceOf(JsonlRoomEventLog);
	});

	it("attaches the durable log once configParent is provided, not before", () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		// First touch with no workspace root known yet: stays on the buffer.
		createClineDriveHost({ store });
		expect(store.getEventLog()).not.toBeInstanceOf(JsonlRoomEventLog);
		// Workspace root arrives: now it binds, under the real root only.
		createClineDriveHost({ configParent: dir, store });
		expect(store.getEventLog()).toBeInstanceOf(JsonlRoomEventLog);
	});

	it("flushes events committed before the workspace root was known into the durable log", () => {
		// Regression (Bugbot on #132): removing the eager tmpdir() bind means
		// commits before a workspace root is known land only on the in-memory
		// buffer. If the first real bind doesn't replay that buffer, those
		// events are durably lost the moment the log finally attaches — the
		// room hydrates later from a log that never saw its start. Only the
		// bound room may flush; an unrelated room resident in the same store
		// (e.g. another buffered, never-bound room) must not ride along.
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		createClineDriveHost({ store });
		store.create("r1");
		store.join({
			roomId: "r1",
			participant: {
				id: "h1",
				kind: "human",
				displayName: "H",
				role: "host",
				status: "idle",
			},
		});
		store.create("unrelated");
		store.join({
			roomId: "unrelated",
			participant: {
				id: "h2",
				kind: "human",
				displayName: "H2",
				role: "host",
				status: "idle",
			},
		});
		expect(store.getEventLog()).not.toBeInstanceOf(JsonlRoomEventLog);

		rebindJsonlRoomEventLog(store, dir, ["r1"]);

		const log = store.getEventLog();
		expect(log).toBeInstanceOf(JsonlRoomEventLog);
		expect(log?.readSinceSync("r1", 0)).toHaveLength(1);
		expect((log as JsonlRoomEventLog).listRoomIds()).toEqual(["r1"]);
		expect(log?.readSinceSync("unrelated", 0)).toHaveLength(0);
	});

	it("createDriveHarness scripts.attach commits via DirectorOp", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-drive-host-"));
		dirs.push(dir);
		const store = new DriveRoomStore();
		const host = createClineDriveHost({ configParent: dir, store });
		const drive = createDriveHarness({ host });
		await drive.rooms.createOrAttach({
			roomId: "script-room",
			humanId: "drive:human",
		});
		const showItem = {
			id: "show-script",
			ownerParticipantId: "drive:partner",
			title: "Hold",
			intent: "Explain",
			artifactKind: "diagram.architecture" as const,
			mediaClass: "still" as const,
			caption: "diagram",
			produce: {
				tool: "render_mermaid",
				args: { mermaidSource: "graph TD; A-->B;" },
			},
			priority: 10,
			status: "ready" as const,
			scoreReasons: [] as string[],
		};
		const attached = await drive.scripts.attach(
			"script-room",
			{
				scriptId: "s1",
				ownerParticipantId: "drive:partner",
				title: "Hold script",
				stickyShowIds: ["show-script"],
				beats: [
					{
						beatId: "b1",
						say: "First say",
						showItemId: "show-script",
						sticky: { mode: "hold" },
						advance: "on_human",
					},
					{
						beatId: "b2",
						say: "Second say",
						showItemId: "show-script",
						sticky: { mode: "hold" },
						advance: "on_human",
					},
				],
			},
			{ showItems: [showItem] },
		);
		expect(attached.beatId).toBe("b1");
		expect(attached.presented?.id).toBe("show-script");
		const advanced = await drive.scripts.advance("script-room");
		expect(advanced.beatId).toBe("b2");
		expect(advanced.say).toBe("Second say");
		expect(advanced.errorCode).toBeUndefined();
	});
});
