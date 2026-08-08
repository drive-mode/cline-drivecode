# ADR-0029: Room hot-path redesign (checkpoint, deltas, one stage clock)

## Status

**Proposed** (implementation slice 1 shipped in the same change set: fold checkpoint on retention trim).

## Metadata

- Date: 2026-08-06
- Deciders: Drivecode planning (proposed); owner accept/reject pending
- Amends: [ADR-0013](ADR-0013-state-partition.md) (rebuild-from-log guarantee), informs [ADR-0016](ADR-0016-distribution-and-positioning.md) / mobile path H
- Related: [24-scale-and-context](../research/24-scale-and-context.md), [26-request-latency-playbook](../research/26-request-latency-playbook.md), [12-performance](../research/12-performance.md), [mobile-consumer](../initiatives/mobile-consumer/), initiative [drive-hotpath](../initiatives/drive-hotpath/)
- Does **not** reopen: single-writer hub, events-first stage, rejection of MCP `:7891` room daemon

## Context

Measured pure compute on the director path is fine (rank ~24 µs). User-visible and long-session pain comes from four couplings in hard code:

1. **Retention breaks cold hydrate.** `JsonlRoomEventLog.appendSync` trims oldest JSONL lines when past `maxRecords` (~2048). `hydrateFromLogSync` replays `readSince(roomId, 0)` through `reduceRoom` with no checkpoint. After trim, `control.join` is gone → cold restart rebuilds a roster missing people who are still live ([24-scale-and-context](../research/24-scale-and-context.md)).
2. **Full snapshot on every `room.event`.** `publishRoomEvent` ships `{ event, snapshot, seq }` every commit. Tool storms serialize fat envelopes; `room.snapshot` coalesces, `room.event` does not.
3. **Agent → stage is a second hop.** Chat sees `tool_event` immediately; Spotlight waits for `call_record_work` command RTT plus fold plus broadcast. Two clocks for one tool end.
4. **Layout budget is policy-by-CSS.** Historical 624×9 px stage at 1280×640; floor `min-h-[22rem]` mitigates but PlanEditor / bank chrome can still fight Spotlight.

Mobile and hosted runtime need the same wire to stay honest. MCP as a room bus stays rejected; stateless remote MCP remains an optional **agent tool** plane under a future hosted runtime, not phone↔room signaling.

## Decision

### D1 · Fold checkpoint (slice 1 — land now)

When a durable append **trims** the room JSONL, write `checkpoint.json` beside `events.jsonl` / `meta.json`:

```json
{ "schemaVersion": 1, "seq": <seq after append>, "snapshot": <RoomSnapshot> }
```

Cold hydrate:

1. If checkpoint exists → install that snapshot and `seq`.
2. Fold only `readSince(roomId, checkpoint.seq)`.
3. Else → existing from-zero replay.

This restores ADR-0013’s claim that live state is rebuildable after retention. Path helpers: `resolveDriveRoomCheckpointPath`. Store write site: `DriveRoomStore.commit` when `appendSync` reports `trimmed: true`.

### D2 · Delta publish (slice 2 — next)

Default broadcast: `room.delta` = `{ event, seq }` (or event-only envelope clients already fold). Full `room.snapshot` on join, reconnect gap, or idle coalesce. Clients keep `foldIncomingDriveEvent` / hub-ahead reconcile.

### D3 · One stage projector (slice 3)

In-process: tool/session end → `recordWork` in the hub host on the same turn as `tool_event`. Remove the extra `call_record_work` client command from the critical path. Show/wave fan-out stays async side effects, not stage-blocking.

### D4 · Layout contract (slice 4)

Call surface = Spotlight + one strip + sheets. Plan editor, task bank, audit, meters → sheets/drawers. Same composition root for hub wide and mobile `?app=1`.

### D5 · Signaling topology (slice 5 — owner gate)

Extend ADR-0009-style profiles to **where the hub runs**: `local` (today) vs `cloud` (hosted single-writer room service) with the **same Drive wire**. Phone uses cloud. Does not amend ADR-0016 until owner accepts path H. MCP stays off the room wire.

## Consequences

**Positive**

- Long sessions survive restart with correct roster after trim (slice 1).
- Later slices cut tool-storm bandwidth and stage lag; unlock phone as a real client of one protocol.

**Negative**

- Checkpoint is another durable file per room; must stay Zod-parsed (`parseRoomSnapshot`).
- Rooms trimmed **before** this ships remain unrestorable without a live snapshot (acceptable; new trims write checkpoints).
- Delta publish and projector need careful test migration (not in slice 1).

## Alternatives considered

- **Raise retention forever / never trim** → rejected; unbounded disk.
- **Snapshot every append** → works but heavier than trim-triggered write; revisit if hydrate from mid-cap logs is slow.
- **MCP Streamable HTTP as room transport** → rejected; rooms are sequenced sticky state; MCP 2026-07-28 is stateless request/response for tools.
- **CRDT multi-writer** → rejected (D2 / ADR-0013).

## Impl notes

| Slice | Status |
|---|---|
| D1 fold checkpoint | **partial / this PR** — trim → checkpoint; hydrate prefers checkpoint; hydrate ignores process-global `appliedEventIds` skips |
| D2 delta publish | **partial / this PR** — `room.event` omits snapshot; clients fold locally; gap refresh via `call_get_room` |
| D3 one stage projector | **partial / this PR** — daemon projects after `tool.finished`; Hub Chat bridge removed; teammates skipped |
| D4 layout contract | **partial / this PR** — `?app=1` drops hub nav; Plan / worker audit / captions are strip sheets (not Spotlight flex siblings); gate/recruit overlays stay ephemeral on stage |
| D5 cloud signaling | **blocked** on owner ADR-0016 path H (self-hosted beta today) |

## Links

- Code: `sdk/packages/core/src/hub/collaboration/{room,eventLog,roomCheckpoint}.ts`
- Initiative: [drive-hotpath](../initiatives/drive-hotpath/)
