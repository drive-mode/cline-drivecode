# Lessons from the boar book, applied to the wire

*Designing Data-Intensive Applications* (Kleppmann — the O'Reilly boar) is
about systems shaped exactly like this writer: an append-only log as the
source of truth, derived state rebuilt by a fold, cursors instead of clocks,
one writer providing total order. This doc records which of the book's
lessons the Drive Mode wire already embodied, which ones this change
implements, and which ones are deliberately declined. It is the reference
for why `logId`, `opId`, SSE message ids, and consumer shedding exist.

## Already true before this change

These were design decisions, not accidents; the book just names them.

| Lesson | Where it lives |
|---|---|
| Total order from a single writer (ch. 5, 9) | One `WriterStore` per room assigns `seq`; there is no second authority to disagree with (`apps/writer/src/store.ts`) |
| Derived state, rebuildable from the log (ch. 12) | The snapshot is `reduceRoom` folded over the log; the kernel owns the fold, hosts never re-implement it |
| Logical cursors, never wall clocks (ch. 8) | Clients resume with `events_since(seq)`; "never guess from a wall clock" was already the contract |
| Idempotent control flow (ch. 11) | `control.end` is idempotent until a `control.join` reopens the room, mirroring the Cline coordinator so folds agree across hosts |
| Validate before append (ch. 4) | A pack payload that does not parse throws before it can reach the log |
| Bounded derived buffers | The conversation feed caps at 200 entries; the phone client caps its working set |

## Implemented by this change

### Log identity is a fencing token — `logId` (ch. 8)

The writer is in-memory: a restart is a *different log* whose `seq` also
starts at 1. Every client resumed with the heuristic `latestSeq < cursor`,
which detects a restart only while the fresh log is still shorter than the
old cursor. Once the new log grows past it, `events_since(oldCursor)`
happily returns events from a history the client never saw the start of,
and the client folds them onto state derived from the previous history —
two logs spliced into one corrupt view. This is the stale-leader problem
the book fences with epochs.

The store now mints a `logId` per incarnation (`store.ts`), and every read
surface names it: `/health`, `/snapshot`, the `events_since` result, the
SSE `hello`, and the discovery file `~/.drivemode/writer.json`. A cursor is
only meaningful relative to the log that issued it; clients compare `logId`
and hard-resync when it changes. The reference viewer and the demo phone
recreation do this; `drive-ios` adopts the same comparison in
`WriterClient` (the `latestSeq` heuristic stays as a fallback against
writers that predate the field).

### Retries need end-to-end idempotence — `opId` (ch. 11, 12)

MCP hosts deliver at-least-once: an agent whose `stage_publish_work`
response is lost retries a call whose append already landed, and in an
append-only log the duplicate is a permanently visible second card or
message. No transport layer below the caller can deduplicate this — only
the caller knows two requests are the same operation. That is the book's
end-to-end argument, and the fix is the book's fix: the caller attaches an
operation id, and the single writer remembers recorded outcomes.

`stage_publish_work` and `conversation_publish` accept an optional `opId`.
A replay returns the recorded result — same `seq`, same event — without a
second append, and the narration side effect sits inside the idempotency
window so a replayed publish cannot re-narrate either. The memory is
bounded (oldest-recorded evicts first; a real retry arrives seconds after
its original) and shares fate with the log on purpose: a restarted writer
is a new log, and replaying a previous incarnation's responses against it
would be exactly the confusion `logId` exists to stop. Only these two
tools carry the key because they are where duplicates are user-visible
content; the control-plane events are already absorbed idempotently by the
fold.

### The log is its own index (ch. 3)

`eventsSince` scanned the whole log per call — O(log length) for every
poll, and the phone polls at 1s cadence in a session. But `seq` is dense
and 1-based by construction (every append assigns `nextSeq++` and pushes
exactly one entry), so the entry with seq `s` sits at index `s − 1` and
the strictly-after suffix is a slice: O(returned), regardless of how old
the room is.

### A replayable log makes shedding safe (ch. 1, 11)

Every SSE message carries a full snapshot, and a consumer that stopped
reading used to buffer without bound inside its stream queue. The book's
observation is that dropping a stream consumer is safe *precisely when* a
replayable log sits behind it — the client reconnects and resumes from its
cursor, losing nothing. The writer now sheds a consumer once its unread
queue passes a threshold (`sseMaxBufferedMessages`, default 1024 — stuck,
not merely slow), and `/health` reports live `subscribers` so a shed shows
up in diagnostics rather than as silent memory growth.

### The read path resumes by cursor, not by connection (ch. 5)

`EventSource` auto-reconnects with a frozen URL, so a viewer that
connected with `?since=42` replayed everything after 42 on every drop —
duplicate feed entries hours later. Every SSE message now carries
`id: <logId>:<seq>`; on reconnect the browser echoes it as
`Last-Event-ID`, and the writer resumes from the true cursor. The embedded
`logId` fences the header the same way it fences polls: a cursor minted by
a previous incarnation is foreign, so the writer replays this log from the
top and the hello's changed `logId` tells the client to reset. The viewer
additionally folds feed entries idempotently by `seq` — delivery is
at-least-once, so the consumer, not the transport, owns exactly-once
effect (ch. 12).

### Evolve the wire additively (ch. 4)

Every field above is additive: `logId` and `opId` are optional on the
wire, old clients ignore unknown fields (Swift `Codable` included), and a
new client against an old writer falls back to the heuristics it always
had. No event schema changed — the kernel envelope is untouched; identity
rides on responses, not in the log.

## Declined, deliberately

The book also teaches when *not* to build things. These remain v0
non-goals, now with the reasoning recorded:

- **Durability / a SQLite log (ch. 3, 7).** The standalone writer is the
  no-Hub profile; durable room truth is the Hub's job (ADR-0057). A
  half-durable second log here would create the two-authorities problem
  the hard rules forbid.
- **Compaction / snapshot-plus-tail bootstrap (ch. 11).** The log is
  in-memory and session-scoped; the hello already delivers a snapshot.
  Compaction earns its complexity only if room lifetimes grow beyond a
  working session.
- **Partitioning and consensus (ch. 6, 9).** One room, one writer, one
  process. Total order costs nothing here; distributing it would buy
  nothing.
- **Cross-restart `opId` memory.** Idempotence state deliberately dies
  with the log it guards (see above).

## Verifying

`tests/log-identity.test.ts`, `tests/idempotent-publish.test.ts`, and
`tests/sse-wire.test.ts` pin all of the above: incarnation fencing, slice
semantics at every boundary, replay-without-append (narration included),
eviction bounds, `Last-Event-ID` resume, foreign-cursor replay-from-top,
and slow-consumer shedding.
