# ADR-0039 · A room has one writer, and the room says who

**Status:** Proposed (2026-08-20)  
**Owner:** Drivecode SE lead / PM  
**Answers:** D2 in the
[repo-ownership initiative](../initiatives/repo-ownership/README.md) — *who owns
room-state authority when a hub and an MCP writer are both live?*  
**Amends:** [ADR-0013](ADR-0013-state-partition.md) lock 1 ("Hub remains the only
writer of room state for local MVP"). The three lanes, the
[ADR-0029](ADR-0029-room-hotpath-redesign.md) checkpoint amendment, the purity of
`reduceRoom`, the privacy-strict lock and the cursor-drive `:7891` lock are
**unchanged and binding**.  
**Constrained by:** [ADR-0025](ADR-0025-enforced-authority.md) (a declared
authority with no enforcement-path consumer is a defect),
[ADR-0035](ADR-0035-late-join-catch-up.md) (snapshot then delta; clients never
invent missing seq), [ADR-0026](ADR-0026-evidence-backed-done.md).  
**Related:** [ADR-0038](ADR-0038-standard-extension-boundary.md) answers D1b —
what the kernel *contains*. This answers who may *write* it. Both are needed
before `drivemode-mcp` repoints.

## Context

[ADR-0013](ADR-0013-state-partition.md) lock 1 reads:

> Hub remains the only writer of room state **for local MVP**.

That scope qualifier matters. The lock was never stated as permanent — it was
stated as sufficient for local MVP, and this is the decision it deferred.

Two facts make deferring it further untenable.

**First, a second writer already exists.** `drivemode-mcp` holds its own
`WriterRoomState` and applies `reduceRoom` itself. It is not an adapter reading
the hub's room; it folds independently. ADR-0013's adapter clause anticipated
bridges that "bind to the log + `DriveHostPort`, **not to a second room model**"
— and this is a second room model. Meanwhile both repositories assert primacy in
prose: `cline-drivecode`'s HANDOFF says *"The Cline hub is the single writer for
Drive room state"*; `drivemode-mcp`'s AGENTS.md says *"Keep the writer the single
room truth."* Each is reasonable alone; together they are unreconciled.

**Second, and more seriously, the lock is unenforceable.** Verified at
[`1d0d001b9`](https://github.com/drive-mode/cline-drivecode/commit/1d0d001b981a04c0678b3be04adba96de1f2dfb7):

- `RoomSnapshotSchema` carries **no writer or owner identity** of any kind.
- `DriveHostPort` carries a `harnessId` and capability flags including
  `roomOps`, but nothing binds a *room* to a *harness*.
- Searching `@cline/core/hub` and `@cline/drive` for the lock finds only source
  comments and test captions. There is no type expressing it and no path that
  can refuse a write.

By [ADR-0025](ADR-0025-enforced-authority.md) decision 1 — *"a declared
authority type with no enforcement-path consumer is a defect, and CI says so"* —
the single-writer lock is, today, exactly that defect. `drivemode-mcp` did not
circumvent an enforced rule; it demonstrated that nothing could have stopped it.

So D2 cannot be answered by restating the lock more firmly in prose. Whatever
this ADR decides has to be a type with a refusal path, or it fails ADR-0025 the
same way.

## Decision

1. **The invariant is per-room, not per-topology.** A room has exactly one
   writer at any time. This is what ADR-0013 lane 2 was actually protecting —
   "dual live Maps forbidden" is a statement about one room's state, not about
   how many processes may exist in the world. Two independent rooms with
   different writers were never the hazard.

2. **The room names its writer.** `RoomSnapshot` gains `writerHarnessId`,
   populated from the existing `DriveHostPort.harnessId`. The identity primitive
   already exists; only the room-side binding is missing. A room whose writer is
   unnamed is invalid, not permissive.

3. **Two conformance profiles, both first-class.**
   - **Hub-attached.** A hub is present and owns the rooms it creates. Any other
     participant — including an MCP server — binds to `DriveHostPort` and
     *projects*; it does not fold independently. This is ADR-0013's adapter
     clause, unchanged.
   - **Standalone.** No hub is present. The MCP server is the writer for rooms
     it creates, folds them itself, and says so in `writerHarnessId`.

   `drivemode-mcp` shipping as an MCP server people run on its own is the reason
   the standalone profile has to exist. Requiring a hub daemon to be running
   before an MCP server can hold a room would defeat what it is for.

4. **Enforcement, so this is not more prose.** The write path refuses an event
   whose originating harness is not the room's `writerHarnessId`. Per ADR-0025
   decision 1 this needs at least one non-test consumer on a path that can
   refuse, and a test asserting the count never drops to zero. **This ADR is not
   satisfied by the field alone** — an unenforced `writerHarnessId` reproduces
   the defect it exists to fix, with more ceremony.

5. **ADR-0013 lock 1 is amended** from *"Hub remains the only writer of room
   state for local MVP"* to *"The hub is the writer for rooms it creates; a room
   has one writer and names it."* Lanes 1–3, the checkpoint amendment, the
   `reduceRoom` purity lock, the privacy-strict lock and the cursor-drive
   `:7891` lock stand unchanged.

6. **No cross-writer merge, ever.** If two harnesses claim the same room, that
   is an error surfaced to the operator — never a merge, a last-write-wins, or a
   reconciliation heuristic. Rooms carry Agent Title grants and Presenter
   exclusivity; silently merging divergent authority state is worse than
   refusing.

7. **`drivemode-mcp` declares standalone** until it repoints, which makes the
   status quo legal and named rather than an unreconciled contradiction, and
   removes the prose conflict in both repositories.

## Non-goals

- **This does not design hub ↔ MCP federation.** Two live writers converging on
  one room is out of scope; decision 6 refuses it rather than solving it.
- This does not answer D1b — what the kernel contains is
  [ADR-0038](ADR-0038-standard-extension-boundary.md).
- This does not permit a fourth store. Both profiles use the same three lanes.
- This does not move `drivemode-mcp` code or archive `collaboration-harness`.

## Open

1. **Writer handoff.** A hub starts while an MCP server holds a room: does the
   room transfer, does the hub refuse, or does it create its own? Decision 6
   refuses silent merge but does not name the handoff. Likely a follow-on.
2. **Does the event log need writer identity too**, or is the snapshot field
   enough? A log replayed under a different writer than it was written by is a
   case worth naming before audit bundles exist.
3. **Where enforcement lives** — the kernel fold (pure, so refusal is a return
   value) or the host port (IO-side, can throw). ADR-0013 keeps `reduceRoom`
   pure, which argues for the port, but the fold is where an unauthorized event
   would actually apply.
4. **Does `drive-ios` need to know which profile it is talking to?** Today it
   reads `events_since` over HTTP from `drivemode-mcp` and cannot tell.

## Alternatives rejected

- **The hub is always authoritative when both are live.** Simplest to state, and
  it makes `drivemode-mcp` unusable without a hub daemon — which is what it is
  for. It also does not describe today's deployment, where the two are not
  connected at all.
- **The MCP writer always projects the hub.** Same defect, and it would require
  `drivemode-mcp` to acquire a hub dependency purely to satisfy a rule that no
  code enforces.
- **Leave it to convention and document the intent more clearly.** This is
  precisely what produced two repositories each claiming to be the single truth,
  and ADR-0025 already ruled that a limit without a refusal path is a defect.
- **Allow merge via CRDT or last-write-wins.** Large machinery for a problem
  that does not exist yet — the two writers hold different rooms — and it would
  silently reconcile Agent Title grants, which is the one place in the model
  where a wrong merge is a security answer rather than a data answer.
