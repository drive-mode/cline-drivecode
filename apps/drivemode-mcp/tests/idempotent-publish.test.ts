import { describe, expect, test } from "bun:test";
import { createRoomService } from "../apps/writer/src/roomService.ts";
import { createWriterStore } from "../apps/writer/src/store.ts";

/**
 * MCP hosts deliver at-least-once: a call whose response is lost gets
 * retried after the append already landed, and in an append-only log that
 * duplicate is a permanently visible second card or message. Only the caller
 * knows two requests are the same operation, so the retry key (`opId`) rides
 * end-to-end and the single writer replays the recorded outcome instead of
 * appending again.
 */

const setup = () => {
	const store = createWriterStore({ roomId: "default" });
	const service = createRoomService(store);
	const logLength = () => store.eventsSince(0).length;
	return { store, service, logLength };
};

describe("idempotent publish", () => {
	test("replaying a work publish appends nothing and returns the recorded result", () => {
		const { service, logLength } = setup();
		const publish = () =>
			service.publishWork({
				packId: "coding",
				type: "work.decision",
				payload: { title: "Ship v0?", choice: "yes" },
				actorId: "drive:partner",
				opId: "op-decision-1",
			});

		const first = publish();
		const appended = logLength();
		expect(appended).toBeGreaterThanOrEqual(1);

		const replay = publish();
		expect(logLength()).toBe(appended);
		expect(replay.seq).toBe(first.seq);
		expect(replay.event.id).toBe(first.event.id);
	});

	test("the narration side effect is inside the idempotency window", () => {
		const { service, logLength } = setup();
		service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title: "Ship v0?", choice: "yes" },
			opId: "op-narrated",
		});
		const afterFirst = logLength();
		service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title: "Ship v0?", choice: "yes" },
			opId: "op-narrated",
		});
		// However many events the first publish appended (work + optional
		// narration), the replay appends none of them again.
		expect(logLength()).toBe(afterFirst);
	});

	test("distinct opIds are distinct operations", () => {
		const { service } = setup();
		const first = service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title: "Ship v0?", choice: "yes" },
			opId: "op-a",
		});
		const second = service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title: "Ship v0?", choice: "yes" },
			opId: "op-b",
		});
		expect(second.seq).toBeGreaterThan(first.seq);
	});

	test("publishes without an opId never dedupe", () => {
		const { service } = setup();
		const first = service.publishConversation("same text", "drive:partner");
		const second = service.publishConversation("same text", "drive:partner");
		expect(second.seq).toBeGreaterThan(first.seq);
	});

	test("conversation replays return the recorded message", () => {
		const { service, logLength } = setup();
		const first = service.publishConversation(
			"one message",
			"drive:partner",
			"op-msg",
		);
		const afterFirst = logLength();
		const replay = service.publishConversation(
			"one message",
			"drive:partner",
			"op-msg",
		);
		expect(logLength()).toBe(afterFirst);
		expect(replay.seq).toBe(first.seq);
	});

	test("work and conversation opIds live in separate namespaces", () => {
		const { service } = setup();
		const work = service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title: "Ship v0?", choice: "yes" },
			opId: "op-shared",
		});
		const conversation = service.publishConversation(
			"unrelated",
			"drive:partner",
			"op-shared",
		);
		expect(conversation.seq).not.toBe(work.seq);
		expect(conversation.event.type).toBe("conversation.message");
	});

	test("a failed publish is not recorded, so the retry can succeed", () => {
		const { service } = setup();
		expect(() =>
			service.publishWork({
				packId: "coding",
				type: "work.decision",
				payload: { nope: true },
				opId: "op-retryable",
			}),
		).toThrow();
		const retry = service.publishWork({
			packId: "coding",
			type: "work.decision",
			payload: { title: "Ship v0?", choice: "yes" },
			opId: "op-retryable",
		});
		expect(retry.event.type).toBe("work.decision");
	});

	test("the recorded window is bounded and evicts oldest-first", () => {
		const { service, logLength } = setup();
		const publish = (opId: string) =>
			service.publishConversation(`msg ${opId}`, "drive:partner", opId);

		publish("op-oldest");
		for (let i = 0; i < 512; i++) {
			publish(`op-fill-${i}`);
		}
		const beforeRetry = logLength();
		// op-oldest has been evicted, so this "retry" appends anew — the cap
		// trades perfect dedup for bounded memory, and a real retry arrives
		// seconds after its original, not 512 publishes later.
		publish("op-oldest");
		expect(logLength()).toBe(beforeRetry + 1);

		// A recent key is still recorded.
		publish("op-fill-511");
		expect(logLength()).toBe(beforeRetry + 1);
	});

	test("replays are visible in the idempotency stats", () => {
		const { service } = setup();
		service.publishConversation("counted", "drive:partner", "op-count");
		service.publishConversation("counted", "drive:partner", "op-count");
		const stats = service.idempotencyStats();
		expect(stats.recorded).toBe(1);
		expect(stats.replays).toBe(1);
	});
});
