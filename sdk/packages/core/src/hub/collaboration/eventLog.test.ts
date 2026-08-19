import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveDriveRoomEventsPath } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	it("hydrates seated participants after retention trim via fold checkpoint", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-ckpt-"));
		try {
			const log = new JsonlRoomEventLog(dir, { maxRecords: 3 });
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
			// Exceed cap so control.join is trimmed from JSONL.
			store.mute({ roomId: "r1", participantId: "h1", muted: true });
			store.mute({ roomId: "r1", participantId: "h1", muted: false });
			store.mute({ roomId: "r1", participantId: "h1", muted: true });

			const retained = log.readSinceSync("r1", 0);
			expect(retained.every((r) => r.event.type !== "control.join")).toBe(true);
			expect(store.get("r1")?.participants).toHaveLength(1);

			const restored = new DriveRoomStore();
			restored.attachEventLog(new JsonlRoomEventLog(dir, { maxRecords: 3 }));
			const snap = restored.hydrateFromLogSync("r1");
			expect(snap?.participants).toHaveLength(1);
			expect(snap?.participants[0]?.id).toBe("h1");
			expect(snap?.muteByParticipantId.h1).toBe(true);

			// Same process: drop live map but keep appliedEventIds; rehydrate must not blank.
			restored.rooms.delete("r1");
			const again = restored.hydrateFromLogSync("r1");
			expect(again?.participants).toHaveLength(1);
			expect(again?.participants[0]?.id).toBe("h1");
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

describe("JsonlRoomEventLog forward-compatibility", () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
	});

	function writeEvents(dir: string, roomId: string, lines: string[]): void {
		const eventsPath = resolveDriveRoomEventsPath(dir, roomId);
		mkdirSync(dirname(eventsPath), { recursive: true });
		writeFileSync(eventsPath, `${lines.join("\n")}\n`, "utf8");
	}

	function joinLine(seq: number, participantId: string): string {
		return JSON.stringify({
			seq,
			event: {
				schemaVersion: 1,
				id: `evt_${seq}`,
				roomId: "r1",
				at: "2026-07-25T12:00:00.000Z",
				type: "control.join",
				track: "control",
				participant: {
					id: participantId,
					kind: "human",
					displayName: "H",
					role: "host",
					status: "idle",
				},
			},
		});
	}

	it("skips unreadable records instead of failing the whole read", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-bad-"));
		try {
			writeEvents(dir, "r1", [
				joinLine(1, "h1"),
				"{ not json",
				JSON.stringify({ seq: 3, event: { type: "control.from_the_future" } }),
				JSON.stringify({ seq: "not-a-number", event: {} }),
				joinLine(5, "h2"),
			]);
			const log = new JsonlRoomEventLog(dir);
			const records = log.readSinceSync("r1", 0);
			expect(records.map((record) => record.seq)).toEqual([1, 5]);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain("skipped 3 of 5");

			// A stuck bad line must not warn once per read, forever.
			log.readSinceSync("r1", 0);
			log.readSinceSync("r1", 0);
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("says the room cannot be restored when every record is unreadable", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-all-bad-"));
		try {
			writeEvents(dir, "r1", ["{ not json", "also not json"]);
			const records = new JsonlRoomEventLog(dir).readSinceSync("r1", 0);
			expect(records).toEqual([]);
			expect(String(warn.mock.calls[0]?.[0])).toContain("cannot be restored");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not warn when the only skips are records the caller already has", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-cursor-"));
		try {
			writeEvents(dir, "r1", [joinLine(1, "h1"), joinLine(2, "h2")]);
			const records = new JsonlRoomEventLog(dir).readSinceSync("r1", 1);
			expect(records.map((record) => record.seq)).toEqual([2]);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("hydrates a room whose log mixes legacy, malformed, and new records", async () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-room-mixed-"));
		try {
			const legacyAgentJoin = JSON.stringify({
				seq: 2,
				event: {
					schemaVersion: 1,
					id: "evt_2",
					roomId: "r1",
					at: "2026-07-25T12:00:01.000Z",
					type: "control.join",
					track: "control",
					participant: {
						id: "a1",
						kind: "agent",
						displayName: "A",
						role: "partner",
						status: "idle",
						seatSources: [],
					},
				},
			});
			const seatedWithRef = JSON.stringify({
				seq: 4,
				event: {
					schemaVersion: 1,
					id: "evt_4",
					roomId: "r1",
					at: "2026-07-25T12:00:03.000Z",
					type: "control.join",
					track: "control",
					participant: {
						id: "a2",
						kind: "agent",
						displayName: "B",
						role: "specialist",
						status: "idle",
						ref: { kind: "driveagent", slug: "reviewer" },
						capPreset: "readonly",
						seatSources: [{ kind: "pack", packId: "pack_review" }],
					},
				},
			});
			writeEvents(dir, "r1", [
				joinLine(1, "h1"),
				legacyAgentJoin,
				'{"seq":3,"event":{"type":"nope"}}',
				seatedWithRef,
			]);

			const store = new DriveRoomStore();
			store.attachEventLog(new JsonlRoomEventLog(dir));
			const snapshot = await store.hydrateFromLog("r1");

			expect(snapshot?.participants.map((p) => p.id)).toEqual([
				"h1",
				"a1",
				"a2",
			]);
			const legacy = snapshot?.participants.find((p) => p.id === "a1");
			expect(legacy?.kind === "agent" && legacy.ref).toBeUndefined();
			const seated = snapshot?.participants.find((p) => p.id === "a2");
			expect(seated?.kind === "agent" && seated.capPreset).toBe("readonly");
			expect(store.lastSeq("r1")).toBe(4);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
