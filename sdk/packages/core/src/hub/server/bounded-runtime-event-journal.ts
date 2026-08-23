import type {
	HubChatRuntimeCursor,
	HubChatRuntimeWireEvent,
} from "@cline/shared";

export const DEFAULT_RUNTIME_JOURNAL_MAX_SESSION_EVENTS = 512;
export const DEFAULT_RUNTIME_JOURNAL_MAX_SESSION_BYTES = 2 * 1024 * 1024;
export const DEFAULT_RUNTIME_JOURNAL_MAX_EVENTS = 2_048;
export const DEFAULT_RUNTIME_JOURNAL_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_RUNTIME_JOURNAL_MAX_SESSIONS = 1_024;

export interface BoundedRuntimeEventJournalOptions {
	readonly maxSessionEvents?: number;
	readonly maxSessionBytes?: number;
	readonly maxEvents?: number;
	readonly maxBytes?: number;
	readonly maxSessions?: number;
}

interface JournalEntry {
	readonly event: HubChatRuntimeWireEvent;
	readonly bytes: number;
}

interface SessionJournalStats {
	events: number;
	bytes: number;
}

function positiveBound(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return value;
}

function freezeJournalValue<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const child of Object.values(value)) freezeJournalValue(child);
	return Object.freeze(value);
}

/** Fixed failure used at the transport boundary without reflecting cursor detail. */
export class RuntimeRecoveryUnavailableError extends Error {
	constructor() {
		super("Managed runtime cursor is not available for bounded recovery.");
		this.name = "RuntimeRecoveryUnavailableError";
	}
}

/**
 * Process-local journal of already-sanitized singleton runtime events.
 * Eviction advances a floor; it never turns missing history into success.
 */
export class BoundedRuntimeEventJournal {
	readonly #maxSessionEvents: number;
	readonly #maxSessionBytes: number;
	readonly #maxEvents: number;
	readonly #maxBytes: number;
	readonly #maxSessions: number;
	readonly #entries: JournalEntry[] = [];
	readonly #sessionStats = new Map<string, SessionJournalStats>();
	readonly #sessionFloors = new Map<string, number>();
	readonly #sessionHeads = new Map<string, number>();
	readonly #sessionStreams = new Map<string, string>();
	readonly #sessionReservations = new Map<string, number>();
	#bytes = 0;

	constructor(options: BoundedRuntimeEventJournalOptions = {}) {
		this.#maxSessionEvents = positiveBound(
			options.maxSessionEvents ?? DEFAULT_RUNTIME_JOURNAL_MAX_SESSION_EVENTS,
			"runtime journal session event bound",
		);
		this.#maxSessionBytes = positiveBound(
			options.maxSessionBytes ?? DEFAULT_RUNTIME_JOURNAL_MAX_SESSION_BYTES,
			"runtime journal session byte bound",
		);
		this.#maxEvents = positiveBound(
			options.maxEvents ?? DEFAULT_RUNTIME_JOURNAL_MAX_EVENTS,
			"runtime journal event bound",
		);
		this.#maxBytes = positiveBound(
			options.maxBytes ?? DEFAULT_RUNTIME_JOURNAL_MAX_BYTES,
			"runtime journal byte bound",
		);
		this.#maxSessions = positiveBound(
			options.maxSessions ?? DEFAULT_RUNTIME_JOURNAL_MAX_SESSIONS,
			"runtime journal session metadata bound",
		);
		if (
			this.#maxSessionEvents > this.#maxEvents ||
			this.#maxSessionBytes > this.#maxBytes
		) {
			throw new Error(
				"runtime journal per-session bounds exceed global bounds",
			);
		}
	}

	/**
	 * Reserves one metadata slot before a lifecycle operation can create or
	 * resume durable resident state. Reservations are reference-counted by
	 * session so concurrent retries cannot steal or double-count the slot.
	 */
	reserveSession(sessionId: string): () => void {
		const current = this.#sessionReservations.get(sessionId) ?? 0;
		if (
			current === 0 &&
			!this.#sessionStreams.has(sessionId) &&
			this.#occupiedSessionCount() >= this.#maxSessions
		) {
			throw new Error("runtime journal session metadata bound was reached");
		}
		this.#sessionReservations.set(sessionId, current + 1);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			const count = this.#sessionReservations.get(sessionId);
			if (count === undefined) return;
			if (count <= 1) this.#sessionReservations.delete(sessionId);
			else this.#sessionReservations.set(sessionId, count - 1);
		};
	}

	registerSession(sessionId: string, streamId: string): void {
		const current = this.#sessionStreams.get(sessionId);
		if (current) {
			if (current !== streamId) {
				throw new Error(
					"runtime journal session stream cannot change in place",
				);
			}
			return;
		}
		if (
			!this.#sessionReservations.has(sessionId) &&
			this.#occupiedSessionCount() >= this.#maxSessions
		) {
			throw new Error("runtime journal session metadata bound was reached");
		}
		this.#sessionStreams.set(sessionId, streamId);
		this.#sessionHeads.set(sessionId, 0);
	}

	append(eventInput: HubChatRuntimeWireEvent): void {
		const event = freezeJournalValue(eventInput);
		if (!this.#sessionStreams.has(event.sessionId)) {
			this.registerSession(event.sessionId, event.streamId);
		}
		if (
			event.streamId !== this.#sessionStreams.get(event.sessionId) ||
			event.sessionSequenceStart !== undefined
		) {
			throw new Error("runtime journal accepts only its own singleton events");
		}
		const previous = this.#sessionHeads.get(event.sessionId) ?? 0;
		if (event.sessionSequence !== previous + 1) {
			throw new Error("runtime journal event sequence is not contiguous");
		}
		const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
		const entry = { event, bytes } satisfies JournalEntry;
		this.#entries.push(entry);
		this.#bytes += bytes;
		this.#sessionHeads.set(event.sessionId, event.sessionSequence);
		const stats = this.#sessionStats.get(event.sessionId) ?? {
			events: 0,
			bytes: 0,
		};
		stats.events += 1;
		stats.bytes += bytes;
		this.#sessionStats.set(event.sessionId, stats);

		while (
			stats.events > this.#maxSessionEvents ||
			stats.bytes > this.#maxSessionBytes
		) {
			const index = this.#entries.findIndex(
				(candidate) => candidate.event.sessionId === event.sessionId,
			);
			if (index < 0) break;
			this.#evict(index);
		}
		while (
			this.#entries.length > this.#maxEvents ||
			this.#bytes > this.#maxBytes
		) {
			this.#evict(0);
		}
	}

	replay(
		sessionId: string,
		cursor: HubChatRuntimeCursor,
	): readonly HubChatRuntimeWireEvent[] {
		const head = this.#sessionHeads.get(sessionId) ?? 0;
		const floor = this.#sessionFloors.get(sessionId) ?? 0;
		if (
			cursor.streamId !== this.#sessionStreams.get(sessionId) ||
			cursor.sessionSequence > head ||
			cursor.sessionSequence < floor
		) {
			throw new RuntimeRecoveryUnavailableError();
		}
		const replay = this.#entries
			.filter(
				(entry) =>
					entry.event.sessionId === sessionId &&
					entry.event.sessionSequence > cursor.sessionSequence,
			)
			.map((entry) => entry.event);
		let expected = cursor.sessionSequence + 1;
		for (const event of replay) {
			if (event.sessionSequence !== expected) {
				throw new RuntimeRecoveryUnavailableError();
			}
			expected += 1;
		}
		if (expected !== head + 1) {
			throw new RuntimeRecoveryUnavailableError();
		}
		return replay;
	}

	cursor(sessionId: string): HubChatRuntimeCursor {
		const streamId = this.#sessionStreams.get(sessionId);
		if (!streamId) throw new RuntimeRecoveryUnavailableError();
		return {
			streamId,
			sessionSequence: this.#sessionHeads.get(sessionId) ?? 0,
		};
	}

	clearSession(sessionId: string): void {
		for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
			if (this.#entries[index]?.event.sessionId === sessionId) {
				this.#evict(index);
			}
		}
		this.#sessionStats.delete(sessionId);
		this.#sessionFloors.delete(sessionId);
		this.#sessionHeads.delete(sessionId);
		this.#sessionStreams.delete(sessionId);
	}

	clear(): void {
		this.#entries.length = 0;
		this.#sessionStats.clear();
		this.#sessionFloors.clear();
		this.#sessionHeads.clear();
		this.#sessionStreams.clear();
		this.#sessionReservations.clear();
		this.#bytes = 0;
	}

	#occupiedSessionCount(): number {
		let count = this.#sessionStreams.size;
		for (const sessionId of this.#sessionReservations.keys()) {
			if (!this.#sessionStreams.has(sessionId)) count += 1;
		}
		return count;
	}

	#evict(index: number): void {
		const [removed] = this.#entries.splice(index, 1);
		if (!removed) return;
		this.#bytes -= removed.bytes;
		const sessionId = removed.event.sessionId;
		const stats = this.#sessionStats.get(sessionId);
		if (stats) {
			stats.events -= 1;
			stats.bytes -= removed.bytes;
			if (stats.events === 0) this.#sessionStats.delete(sessionId);
		}
		this.#sessionFloors.set(
			sessionId,
			Math.max(
				this.#sessionFloors.get(sessionId) ?? 0,
				removed.event.sessionSequence,
			),
		);
	}
}
