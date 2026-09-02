import { describe, expect, test } from "bun:test";
import { createWriterStore } from "../apps/writer/src/store.ts";

/**
 * A dead SSE stream shows up here as a subscriber whose handler throws:
 * `controller.enqueue` on a closed stream is what actually raises. The append
 * itself has already mutated the log and the snapshot by the time listeners
 * run, so the fan-out must not be able to turn a landed write into an error.
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

describe("store subscriber isolation", () => {
	test("a throwing subscriber does not fail the append", () => {
		const store = createWriterStore({ roomId: "default" });
		store.subscribe(() => {
			throw new Error("stream closed");
		});

		const result = store.append(join("agent:one"));
		expect(result.seq).toBeGreaterThan(0);
		expect(result.snapshot.participants.map((p) => p.id)).toContain(
			"agent:one",
		);
	});

	test("a throwing subscriber does not starve the ones after it", () => {
		const store = createWriterStore({ roomId: "default" });
		const seen: number[] = [];
		store.subscribe(() => {
			throw new Error("stream closed");
		});
		store.subscribe((entry) => {
			seen.push(entry.seq);
		});

		store.append(join("agent:one"));
		expect(seen).toHaveLength(1);
	});

	test("a throwing subscriber is dropped rather than retried forever", () => {
		const store = createWriterStore({ roomId: "default" });
		let calls = 0;
		store.subscribe(() => {
			calls += 1;
			throw new Error("stream closed");
		});

		store.append(join("agent:one"));
		store.append(join("agent:two"));
		store.append(join("agent:three"));

		expect(calls).toBe(1);
	});

	test("a healthy subscriber still receives every append", () => {
		const store = createWriterStore({ roomId: "default" });
		const seen: number[] = [];
		store.subscribe((entry) => {
			seen.push(entry.seq);
		});

		store.append(join("agent:one"));
		store.append(join("agent:two"));

		expect(seen).toHaveLength(2);
		expect(seen[1]).toBeGreaterThan(seen[0]);
	});
});
