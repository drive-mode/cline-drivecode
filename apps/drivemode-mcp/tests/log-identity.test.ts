import { describe, expect, test } from "bun:test";
import { createRoomService } from "../apps/writer/src/roomService.ts";
import { createWriterStore } from "../apps/writer/src/store.ts";

/**
 * The writer is in-memory: a restart is a different log whose `seq` also
 * starts at 1, so a client's cursor is only meaningful relative to the log
 * incarnation that issued it. `logId` is the fence — clients compare it and
 * resync on change instead of trusting the `latestSeq < cursor` heuristic,
 * which goes blind once a fresh log grows past the old cursor.
 */

const join = (id: string) =>
	({
		schemaVersion: 1,
		id: `evt_${id}`,
		roomId: "default",
		at: new Date().toISOString(),
		type: "control.join",
		track: "control",
		participant: {
			id,
			kind: "agent",
			displayName: id,
			role: "partner",
			status: "idle",
			seatSources: [{ kind: "manual" }],
		},
		// biome-ignore lint/suspicious/noExplicitAny: test fixture
	}) as any;

describe("log identity", () => {
	test("a store mints one stable logId per incarnation", () => {
		const store = createWriterStore({ roomId: "default" });
		expect(store.logId.length).toBeGreaterThan(0);
		store.append(join("agent:one"));
		expect(store.logId).toBe(store.logId);
	});

	test("two incarnations are distinguishable even with identical logs", () => {
		const first = createWriterStore({ roomId: "default" });
		const second = createWriterStore({ roomId: "default" });
		first.append(join("agent:one"));
		second.append(join("agent:one"));
		// Same roomId, same events, same seq — only logId tells them apart,
		// which is exactly the restarted-writer situation clients must detect.
		expect(first.eventsSince(0).length).toBe(second.eventsSince(0).length);
		expect(first.logId).not.toBe(second.logId);
	});

	test("service snapshot names the log it describes", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		expect(service.snapshot().logId).toBe(store.logId);
	});
});

describe("eventsSince suffix reads", () => {
	const seed = () => {
		const store = createWriterStore({ roomId: "default" });
		for (const id of ["a", "b", "c", "d", "e"]) {
			store.append(join(`agent:${id}`));
		}
		return store;
	};

	test("matches the strictly-after contract at every boundary", () => {
		const store = seed();
		const all = store.eventsSince(0);
		expect(all.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
		expect(store.eventsSince(3).map((entry) => entry.seq)).toEqual([4, 5]);
		expect(store.eventsSince(5)).toEqual([]);
		expect(store.eventsSince(7)).toEqual([]);
	});

	test("tolerates cursors no real client should send", () => {
		const store = seed();
		expect(store.eventsSince(-2).length).toBe(5);
		expect(store.eventsSince(2.5).map((entry) => entry.seq)).toEqual([3, 4, 5]);
		expect(store.eventsSince(Number.NaN)).toEqual([]);
		expect(store.eventsSince(Number.POSITIVE_INFINITY)).toEqual([]);
	});

	test("agrees with a full-log filter, entry for entry", () => {
		const store = seed();
		for (const since of [0, 1, 2, 3, 4, 5, 6]) {
			expect(store.eventsSince(since)).toEqual(
				store.eventsSince(0).filter((entry) => entry.seq > since),
			);
		}
	});
});
