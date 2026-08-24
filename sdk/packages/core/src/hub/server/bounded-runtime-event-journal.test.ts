import type { HubChatRuntimeWireEvent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	BoundedRuntimeEventJournal,
	RuntimeRecoveryUnavailableError,
} from "./bounded-runtime-event-journal";

const STREAM_ID = "runtime-stream-1";

function event(
	sessionId: string,
	sessionSequence: number,
	text = `delta-${sessionSequence}`,
): HubChatRuntimeWireEvent {
	return {
		version: "v1",
		event: "chat.runtime",
		eventId: `${sessionId}-event-${sessionSequence}`,
		streamId: STREAM_ID,
		sessionId,
		timestamp: sessionSequence,
		processSequence: sessionSequence,
		sessionSequence,
		payload: {
			kind: "assistant.delta",
			runId: `${sessionId}-run`,
			text,
		},
	};
}

describe("BoundedRuntimeEventJournal", () => {
	it("exposes a sequence-zero cursor for a registered quiet session", () => {
		const journal = new BoundedRuntimeEventJournal();
		journal.registerSession("session-1", STREAM_ID);
		expect(journal.cursor("session-1")).toEqual({
			streamId: STREAM_ID,
			sessionSequence: 0,
		});
		expect(
			journal.replay("session-1", {
				streamId: STREAM_ID,
				sessionSequence: 0,
			}),
		).toEqual([]);
	});

	it("bounds quiet-session metadata and releases capacity on clear", () => {
		const journal = new BoundedRuntimeEventJournal({ maxSessions: 1 });
		journal.registerSession("session-1", STREAM_ID);
		expect(() =>
			journal.registerSession("session-2", "runtime-stream-2"),
		).toThrow("metadata bound");
		journal.clearSession("session-1");
		expect(() =>
			journal.registerSession("session-2", "runtime-stream-2"),
		).not.toThrow();
	});

	it("reserves metadata capacity before durable session creation", () => {
		const journal = new BoundedRuntimeEventJournal({ maxSessions: 1 });
		const release = journal.reserveSession("session-1");
		expect(() => journal.reserveSession("session-2")).toThrow("metadata bound");
		journal.registerSession("session-1", STREAM_ID);
		release();
		expect(journal.cursor("session-1")).toEqual({
			streamId: STREAM_ID,
			sessionSequence: 0,
		});
	});

	it("keeps a reserved slot occupied if an existing stream clears", () => {
		const journal = new BoundedRuntimeEventJournal({ maxSessions: 1 });
		journal.registerSession("session-1", STREAM_ID);
		const release = journal.reserveSession("session-1");
		journal.clearSession("session-1");
		expect(() => journal.reserveSession("session-2")).toThrow("metadata bound");
		journal.registerSession("session-1", "runtime-stream-2");
		release();
	});

	it("reference-counts concurrent reservations for one session", () => {
		const journal = new BoundedRuntimeEventJournal({ maxSessions: 1 });
		const releaseFirst = journal.reserveSession("session-1");
		const releaseSecond = journal.reserveSession("session-1");
		releaseFirst();
		expect(() => journal.reserveSession("session-2")).toThrow("metadata bound");
		releaseSecond();
		const releaseReplacement = journal.reserveSession("session-2");
		releaseReplacement();
	});

	it("stores immutable canonical events", () => {
		const journal = new BoundedRuntimeEventJournal();
		journal.append(event("session-1", 1));
		const [replayed] = journal.replay("session-1", {
			streamId: STREAM_ID,
			sessionSequence: 0,
		});
		expect(Object.isFrozen(replayed)).toBe(true);
		expect(Object.isFrozen(replayed?.payload)).toBe(true);
		expect(Reflect.set(replayed?.payload as object, "text", "mutated")).toBe(
			false,
		);
	});

	it("returns the exact contiguous suffix after an epoch-bearing cursor", () => {
		const journal = new BoundedRuntimeEventJournal();
		for (let sequence = 1; sequence <= 3; sequence += 1) {
			journal.append(event("session-1", sequence));
		}
		expect(
			journal
				.replay("session-1", {
					streamId: STREAM_ID,
					sessionSequence: 1,
				})
				.map((item) => item.sessionSequence),
		).toEqual([2, 3]);
	});

	it("rejects stale epochs and cursors ahead of the stream", () => {
		const journal = new BoundedRuntimeEventJournal();
		journal.append(event("session-1", 1));
		for (const cursor of [
			{ streamId: "runtime-stream-old", sessionSequence: 1 },
			{ streamId: STREAM_ID, sessionSequence: 2 },
		]) {
			expect(() => journal.replay("session-1", cursor)).toThrow(
				RuntimeRecoveryUnavailableError,
			);
		}
	});

	it("advances a session floor when its count bound evicts history", () => {
		const journal = new BoundedRuntimeEventJournal({
			maxSessionEvents: 2,
			maxSessionBytes: 1_000_000,
			maxEvents: 4,
			maxBytes: 2_000_000,
		});
		for (let sequence = 1; sequence <= 4; sequence += 1) {
			journal.append(event("session-1", sequence));
		}
		expect(() =>
			journal.replay("session-1", {
				streamId: STREAM_ID,
				sessionSequence: 1,
			}),
		).toThrow(RuntimeRecoveryUnavailableError);
		expect(
			journal
				.replay("session-1", {
					streamId: STREAM_ID,
					sessionSequence: 2,
				})
				.map((item) => item.sessionSequence),
		).toEqual([3, 4]);
	});

	it("keeps global eviction fail-closed and session-specific", () => {
		const journal = new BoundedRuntimeEventJournal({
			maxSessionEvents: 3,
			maxSessionBytes: 1_000_000,
			maxEvents: 3,
			maxBytes: 2_000_000,
		});
		journal.append(event("session-1", 1));
		journal.append(event("session-2", 1));
		journal.append(event("session-1", 2));
		journal.append(event("session-2", 2));
		expect(
			journal
				.replay("session-1", {
					streamId: STREAM_ID,
					sessionSequence: 1,
				})
				.map((item) => item.sessionSequence),
		).toEqual([2]);
		expect(
			journal
				.replay("session-2", {
					streamId: STREAM_ID,
					sessionSequence: 1,
				})
				.map((item) => item.sessionSequence),
		).toEqual([2]);
	});

	it("rejects a cursor once byte pressure evicts its missing suffix", () => {
		const journal = new BoundedRuntimeEventJournal({
			maxSessionEvents: 4,
			maxSessionBytes: 256,
			maxEvents: 4,
			maxBytes: 256,
		});
		journal.append(event("session-1", 1, "x".repeat(512)));
		journal.append(event("session-1", 2, "y".repeat(512)));
		expect(() =>
			journal.replay("session-1", {
				streamId: STREAM_ID,
				sessionSequence: 1,
			}),
		).toThrow(RuntimeRecoveryUnavailableError);
	});
});
