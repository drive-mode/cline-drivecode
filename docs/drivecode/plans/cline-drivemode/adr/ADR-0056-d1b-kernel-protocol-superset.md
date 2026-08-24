# ADR-0056 · D1b kernel protocol superset

**Status:** Accepted (2026-08-23)
**Owner:** Drivecode SE lead
**Decider:** Harrison
**Initiative:** [repo-ownership](../initiatives/repo-ownership/)
**Constrained by:** [ADR-0013](ADR-0013-state-partition.md),
[DEC-package-location](../decisions/DEC-package-location.md).

## Context

D1 retired `collaboration-harness` as a definition site. D1a publishes a
generated `@drive-mode/drive-kernel` bundle from `@cline/drive`. The attempted
MCP repoint failed because nine harness-only protocol elements (plus two
snapshot fields) were not in the canonical kernel. Until those are classified,
`drivemode-mcp` cannot compile against the bundle and the harness checkout
cannot be archived.

## Decision

1. **Join the standard.** These complete concepts the kernel already
   half-carries. They are log-carried unless noted; `reduceRoom` records the
   event id and otherwise no-ops for session/invite/ack.

   | Element | Fold |
   |---|---|
   | `control.invite` | log-carried |
   | `control.interrupt_ack` | log-carried (completes raise-hand) |
   | `control.session_created` / `_scheduled` / `_started` / `_ended` | log-carried registry |
   | `work.generic` | stage card `other`; required `packId` is the pack escape hatch |
   | `profilesByParticipantId` on `RoomSnapshot` | writer overlay; type is `RoomParticipantProfile` so it does not collide with facet `AgentProfile` |

2. **Keep the kernel names.** MCP callers map `work.plan` → `work.plan_step`
   and `work.test` → `work.test_result`. Do not dual-spell the wire.

3. **Stay product-side.** `packId` does not land on typed work events, address
   sets, or `StageCard`. Pack attribution on the kernel wire exists only on
   `work.generic`. MCP `activePackId` remains writer state.

4. **`LoggedEvent` stays superseded.** Writers use `DriveLogEnvelope`
   (`family: "room"`, positive `seq`, required `roomId`).

## Non-goals

- Importing `@cline/*` from `drivemode-mcp`.
- Making the MCP writer the Cline-line room authority (ADR-0057).
- Generating Swift title bindings (repo-ownership sequence step 5).

## Consequences

- `check:drive-kernel` fails closed if the bundle drifts from this surface.
- `rg reduceRoom` has one Cline-line implementation after MCP consumes the
  generated bundle.
- Existing MCP pack tool names may still say `work.plan` / `work.test`; the
  writer maps them before append.

## Alternatives rejected

- Dual event spellings (`work.plan` and `work.plan_step`) — two names for one
  concept is how the copies drifted.
- Putting `packId` on every work event — pack is an MCP product concept.
- Leaving `work.generic` out — packs have no other publish path.
