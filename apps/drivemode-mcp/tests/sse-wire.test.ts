import { describe, expect, test } from "bun:test";
import { startHttpWriter } from "../apps/writer/src/http.ts";
import { createRoomService } from "../apps/writer/src/roomService.ts";
import { createWriterStore } from "../apps/writer/src/store.ts";

/**
 * The SSE stream's delivery contract: every message is addressed by
 * `id: <logId>:<seq>`, so EventSource's own reconnect (which echoes the last
 * id as `Last-Event-ID`) resumes at the true cursor instead of replaying the
 * connect-time backlog — and a cursor minted by a previous writer incarnation
 * is recognized as foreign rather than spliced into the wrong log. Slow
 * consumers are shed instead of buffered without bound, which the replayable
 * log makes safe.
 */

type Frame = { id?: string; data?: Record<string, unknown> };

async function readFrames(res: Response, count: number): Promise<Frame[]> {
	const body = res.body;
	if (!body) {
		throw new Error("SSE response has no body");
	}
	const reader = body.getReader();
	const decoder = new TextDecoder();
	const frames: Frame[] = [];
	let buffer = "";
	const deadline = Date.now() + 5_000;
	try {
		while (frames.length < count && Date.now() < deadline) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			let boundary = buffer.indexOf("\n\n");
			while (boundary !== -1 && frames.length < count) {
				const raw = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const idLine = raw.split("\n").find((line) => line.startsWith("id: "));
				const dataLine = raw
					.split("\n")
					.find((line) => line.startsWith("data: "));
				if (dataLine) {
					frames.push({
						id: idLine?.slice("id: ".length),
						data: JSON.parse(dataLine.slice("data: ".length)),
					});
				}
				boundary = buffer.indexOf("\n\n");
			}
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	if (frames.length < count) {
		throw new Error(`Expected ${count} SSE frames, got ${frames.length}`);
	}
	return frames;
}

const boot = async (sseMaxBufferedMessages?: number) => {
	const store = createWriterStore({ roomId: "default" });
	const service = createRoomService(store);
	const { server, url } = await startHttpWriter({
		store,
		service,
		port: 0,
		sseMaxBufferedMessages,
	});
	const publish = (title: string) =>
		service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title, choice: "yes" },
			narrate: false,
		});
	return { store, service, server, url, publish };
};

describe("SSE stream identity and resume", () => {
	test("hello names the log and marks the position the backlog reaches", async () => {
		const { store, server, url, publish } = await boot();
		try {
			publish("one");
			publish("two");
			const res = await fetch(`${url}/events?since=0`);
			const [hello] = await readFrames(res, 1);
			expect(hello.data?.type).toBe("hello");
			expect(hello.data?.logId).toBe(store.logId);
			expect((hello.data?.backlog as unknown[] | undefined)?.length).toBe(2);
			expect(hello.id).toBe(`${store.logId}:2`);
		} finally {
			server.stop(true);
		}
	});

	test("every event message is addressed by logId:seq", async () => {
		const { store, server, url, publish } = await boot();
		try {
			const res = await fetch(`${url}/events?since=0`);
			const framesPromise = readFrames(res, 2);
			// Give the subscription a beat to register before appending.
			await new Promise((resolve) => setTimeout(resolve, 20));
			publish("first");
			const [, event] = await framesPromise;
			expect(event.data?.type).toBe("event");
			expect(event.id).toBe(`${store.logId}:1`);
		} finally {
			server.stop(true);
		}
	});

	test("Last-Event-ID from this log wins over the connect-time cursor", async () => {
		const { store, server, url, publish } = await boot();
		try {
			publish("one");
			publish("two");
			publish("three");
			// The URL says "from the top" — a frozen connect-time cursor — but
			// the reconnect header carries the true position.
			const res = await fetch(`${url}/events?since=0`, {
				headers: { "Last-Event-ID": `${store.logId}:2` },
			});
			const [hello] = await readFrames(res, 1);
			const backlog = hello.data?.backlog as Array<{ seq: number }>;
			expect(backlog.map((entry) => entry.seq)).toEqual([3]);
		} finally {
			server.stop(true);
		}
	});

	test("a cursor minted by another log incarnation is foreign — replay from the top", async () => {
		const { server, url, publish } = await boot();
		try {
			publish("one");
			publish("two");
			const res = await fetch(`${url}/events?since=2`, {
				headers: { "Last-Event-ID": `${crypto.randomUUID()}:2` },
			});
			const [hello] = await readFrames(res, 1);
			const backlog = hello.data?.backlog as Array<{ seq: number }>;
			expect(backlog.map((entry) => entry.seq)).toEqual([1, 2]);
		} finally {
			server.stop(true);
		}
	});
});

describe("SSE backpressure", () => {
	const waitForSubscribers = async (url: string, want: number) => {
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline) {
			const health = (await fetch(`${url}/health`).then((res) =>
				res.json(),
			)) as { subscribers: number };
			if (health.subscribers === want) {
				return true;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return false;
	};

	test("a consumer that stops reading is shed instead of buffered forever", async () => {
		const { server, url, publish } = await boot(0);
		const res = await fetch(`${url}/events?since=0`);
		try {
			expect(await waitForSubscribers(url, 1)).toBe(true);
			// A synchronous burst queues messages faster than any consumer can
			// drain them; with the shed threshold at zero the second queued
			// message trips it.
			for (let i = 0; i < 10; i++) {
				publish(`burst ${i}`);
			}
			expect(await waitForSubscribers(url, 0)).toBe(true);
		} finally {
			await res.body?.cancel().catch(() => {});
			server.stop(true);
		}
	});

	test("the default threshold leaves briefly-behind consumers attached", async () => {
		const { server, url, publish } = await boot();
		const res = await fetch(`${url}/events?since=0`);
		try {
			expect(await waitForSubscribers(url, 1)).toBe(true);
			for (let i = 0; i < 10; i++) {
				publish(`burst ${i}`);
			}
			const health = (await fetch(`${url}/health`).then((r) => r.json())) as {
				subscribers: number;
			};
			expect(health.subscribers).toBe(1);
		} finally {
			await res.body?.cancel().catch(() => {});
			server.stop(true);
		}
	});
});

describe("wire surfaces carry the log identity", () => {
	test("health, snapshot, and events_since all name the log", async () => {
		const { store, server, url } = await boot();
		try {
			const health = (await fetch(`${url}/health`).then((res) =>
				res.json(),
			)) as Record<string, unknown>;
			expect(health.logId).toBe(store.logId);
			expect(health.subscribers).toBe(0);
			expect(health.latestSeq).toBe(0);
			expect(health.idempotency).toEqual({ recorded: 0, replays: 0 });

			const snapshot = (await fetch(`${url}/snapshot`).then((res) =>
				res.json(),
			)) as Record<string, unknown>;
			expect(snapshot.logId).toBe(store.logId);

			const since = (await fetch(`${url}/rpc`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tool: "events_since", args: { sinceSeq: 0 } }),
			}).then((res) => res.json())) as {
				result: Record<string, unknown>;
			};
			expect(since.result.logId).toBe(store.logId);
		} finally {
			server.stop(true);
		}
	});

	test("opId rides /rpc end-to-end for both publish tools", async () => {
		const { server, url } = await boot();
		try {
			const call = (tool: string, args: Record<string, unknown>) =>
				fetch(`${url}/rpc`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ tool, args }),
				}).then((res) => res.json()) as Promise<{
					ok: boolean;
					result: { seq: number };
				}>;

			const work = {
				packId: "coding",
				type: "work.decision",
				payload: { title: "Ship?", choice: "yes" },
				narrate: false,
				opId: "op-rpc-work",
			};
			const first = await call("stage_publish_work", work);
			const replay = await call("stage_publish_work", work);
			expect(replay.result.seq).toBe(first.result.seq);

			const message = { text: "hello once", opId: "op-rpc-msg" };
			const firstMsg = await call("conversation_publish", message);
			const replayMsg = await call("conversation_publish", message);
			expect(replayMsg.result.seq).toBe(firstMsg.result.seq);
		} finally {
			server.stop(true);
		}
	});
});
