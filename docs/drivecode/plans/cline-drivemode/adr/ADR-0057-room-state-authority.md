# ADR-0057 · Room-state authority when Hub and MCP writer are both live

**Status:** Accepted (2026-08-23)
**Owner:** Drivecode SE lead
**Decider:** Harrison
**Amends:** [ADR-0013](ADR-0013-state-partition.md)
**Initiative:** [repo-ownership](../initiatives/repo-ownership/) D2

## Context

`cline-drivecode` HANDOFF: the Cline hub is the single writer for Drive room
state. `drivemode-mcp` AGENTS.md: keep the writer the single room truth. Both
were reasonable in isolation. The MCP writer holds a real `WriterRoomState` and
applies `reduceRoom` itself, so the second writer is real rather than nominal.

## Decision

1. **Cline-line authority is the Hub daemon.** When a Hub is live for a room,
   it is the only writer. MCP tools in that topology are clients: they propose
   events; they do not fold a competing snapshot.
2. **MCP writer is a standalone profile** for hosts that have no Hub (today:
   native iOS preview via `/rpc`). It may fold locally in that profile only.
3. **If both are live, Hub wins.** Do not merge snapshots. Do not CRDT. Clients
   attached to Hub ignore MCP writer room state for the same `roomId`.
4. **One fold.** Both profiles call the generated `@drive-mode/drive-kernel`
   `reduceRoom` (MCP) or `@cline/drive` (Hub). There is not a second algorithm.

## Non-goals

- Shipping Hub-backed iOS in this change.
- Porting cursor-drive MCP `:7891`.
- Dual-writer conflict resolution.

## Alternatives rejected

- MCP as a second Cline-line writer — violates ADR-0013 and creates two
  Presenter-exclusivity clocks.
- Immediate deletion of the MCP writer — iOS preview still consumes `/rpc`.
- Convention-only ("just don't run both") — needs this ADR so agents cannot
  treat AGENTS.md as equal authority.

## Consequences

- HANDOFF remains: no second daemon, no hardcoded hub port.
- iOS golden path stays MCP until a Hub-backed native client lands.
- ADR-0013 lock "Hub remains the only writer of room state for local MVP"
  now names the collision case instead of assuming MCP is absent.
