import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	DriveRoomStore,
	JsonlRoomEventLog,
	MemoryRoomEventLog,
	rebindJsonlRoomEventLog,
} from "./index";

describe("RoomEventLog + DriveRoomStore", () => {
	let store: DriveRoomStore;

	beforeEach(() => {
		store = new DriveRoomStore();
	});

	it("owns live state on the same store (no second Map)", () => {
		store.create("r1");
		const live = store.getOrCreateLive("r1");
		expect(live.roomId).toBe("r1");
		const bumped = store.setLive({
			...live,
			spotlightParticipantId: "p1",
		});
		expect(bumped.version).toBe(1);
		expect(store.getLive("r1")?.spotlightParticipantId).toBe("p1");
	});

	it("appends to memory log before fold and supports readSince", async () => {
		const log = new MemoryRoomEventLog();
		store.attachEventLog(log);
		store.create("r1");
		const committed = store.join({
			roomId: "r1",
			participant: {
				id: "h1",
				kind: "human",
				displayName: "H",
				role: "host",
				status: "idle",
			},
		});
		expect(committed.seq).toBe(1);
		expect(store.lastSeq("r1")).toBe(1);
		const gaps = await log.readSince("r1", 0);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.event.type).toBe("control.join");
	});

	it("hydrates snapshot from jsonl log after restart", async () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-log-"));
		try {
			const log = new JsonlRoomEventLog(dir);
			store.attachEventLog(log);
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
			store.mute({ roomId: "r1", participantId: "h1", muted: true });

			const restored = new DriveRoomStore();
			restored.attachEventLog(new JsonlRoomEventLog(dir));
			const snap = await restored.hydrateFromLog("r1");
			expect(snap?.participants).toHaveLength(1);
			expect(snap?.muteByParticipantId.h1).toBe(true);
			expect(restored.lastSeq("r1")).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("readSinceSync returns gaps after cursor", () => {
		const log = new MemoryRoomEventLog();
		store.attachEventLog(log);
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
		store.join({
			roomId: "r1",
			participant: {
				id: "a1",
				kind: "agent",
				displayName: "A",
				role: "partner",
				status: "idle",
				seatSources: [],
			},
		});
		const gaps = log.readSinceSync("r1", 1);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.seq).toBe(2);
	});

	it("rebindJsonlRoomEventLog migrates events and keeps seq monotonic", () => {
		const fromDir = mkdtempSync(join(tmpdir(), "drive-room-from-"));
		const toDir = mkdtempSync(join(tmpdir(), "drive-room-to-"));
		try {
			store.attachEventLog(new JsonlRoomEventLog(fromDir));
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
			store.mute({ roomId: "r1", participantId: "h1", muted: true });
			expect(store.lastSeq("r1")).toBe(2);

			rebindJsonlRoomEventLog(store, toDir);

			const rebound = store.getEventLog();
			expect(rebound).toBeInstanceOf(JsonlRoomEventLog);
			expect((rebound as JsonlRoomEventLog).configParent).toBe(toDir);
			expect(rebound?.readSinceSync("r1", 0)).toHaveLength(2);
			expect(store.lastSeq("r1")).toBe(2);

			const next = store.mute({
				roomId: "r1",
				participantId: "h1",
				muted: false,
			});
			expect(next.seq).toBe(3);
			expect(store.lastSeq("r1")).toBe(3);
			expect(rebound?.latestSeq("r1")).toBe(3);
		} finally {
			rmSync(fromDir, { recursive: true, force: true });
			rmSync(toDir, { recursive: true, force: true });
		}
	});

	it("rebindJsonlRoomEventLog migrates only rooms this store holds, never every room on disk under the old parent", () => {
		// Regression: the migration set used to be `store.rooms.keys()` UNION
		// "every directory found under the old config parent" — so a shared or
		// stale source directory (a prior run's tmpdir, another process's test
		// fixtures) could hand a room this process never created to whatever
		// workspace binds next, making it appear as a real, resumable session.
		const fromDir = mkdtempSync(join(tmpdir(), "drive-room-from-"));
		const toDir = mkdtempSync(join(tmpdir(), "drive-room-to-"));
		try {
			const fromLog = new JsonlRoomEventLog(fromDir);
			// A room recorded on disk under fromDir that this store never
			// touched — stands in for a leftover test fixture / another
			// process's room sharing the same directory.
			fromLog.appendSync("stray_fixture", {
				schemaVersion: 1,
				id: "e_stray",
				roomId: "stray_fixture",
				at: new Date().toISOString(),
				type: "control.join",
				track: "control",
				participant: {
					id: "h1",
					kind: "human",
					displayName: "H",
					role: "host",
					status: "idle",
				},
			});
			store.attachEventLog(fromLog);

			// A room this process actually created and holds in memory.
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

			rebindJsonlRoomEventLog(store, toDir);

			const rebound = store.getEventLog();
			expect(rebound).toBeInstanceOf(JsonlRoomEventLog);
			expect(rebound?.listRoomIds()).toEqual(["r1"]);
			expect(rebound?.readSinceSync("stray_fixture", 0)).toHaveLength(0);
		} finally {
			rmSync(fromDir, { recursive: true, force: true });
			rmSync(toDir, { recursive: true, force: true });
		}
	});

	it("flushes the in-memory pre-bind buffer into the durable log when it attaches", () => {
		// Regression (Bugbot on #132): DriveRoomStore starts on a bounded
		// in-memory buffer so commits before a workspace root is known are
		// never silently un-durable. If rebind only migrated from an
		// *existing JsonlRoomEventLog*, the buffer's events had nowhere to
		// go — the durable log would attach having never seen the room's
		// start, and a restart would hydrate an incomplete history.
		const dir = mkdtempSync(join(tmpdir(), "drive-room-buffer-"));
		try {
			// DriveRoomStore's real default, not a fresh MemoryRoomEventLog —
			// this is what a hub actually runs on before a workspace is known.
			expect(store.getEventLog()).toBeInstanceOf(MemoryRoomEventLog);
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
			store.mute({ roomId: "r1", participantId: "h1", muted: true });
			expect(store.lastSeq("r1")).toBe(2);

			rebindJsonlRoomEventLog(store, dir, ["r1"]);

			const log = store.getEventLog();
			expect(log).toBeInstanceOf(JsonlRoomEventLog);
			expect(log?.readSinceSync("r1", 0)).toHaveLength(2);
			expect(store.lastSeq("r1")).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not flush an unrelated buffered room into a differently-scoped bind", () => {
		// Companion to the flush test: a second room this same process
		// happens to have resident (also on the pre-bind buffer) must not
		// ride along just because it is in store.rooms — only the room the
		// caller's operation names may cross into the newly bound workspace.
		const dir = mkdtempSync(join(tmpdir(), "drive-room-scoped-"));
		try {
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

			rebindJsonlRoomEventLog(store, dir, ["r1"]);

			const log = store.getEventLog() as JsonlRoomEventLog;
			expect(log.listRoomIds()).toEqual(["r1"]);
			expect(log.readSinceSync("unrelated", 0)).toHaveLength(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rebindJsonlRoomEventLog is a no-op for the same configParent", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-same-"));
		try {
			const log = new JsonlRoomEventLog(dir);
			store.attachEventLog(log);
			rebindJsonlRoomEventLog(store, dir);
			expect(store.getEventLog()).toBe(log);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
