# repo-ownership · one concept, one owner

**Status:** active (plan) — no code has been moved
**Purpose:** for the Cline Drive Mode line specifically, name a single owner for
each shared concept and sequence the deduplication. Delivery status remains
authoritative in
[`claims-registry.yaml`](../../delivery/claims-registry.yaml); this initiative
describes repository topology and ownership, not claim status.

**Related:** [portfolio-now](../portfolio-now/),
[drive-cloud-beta](../drive-cloud-beta/),
[multi-device](../multi-device/),
[DEC-package-location](../../decisions/DEC-package-location.md),
[ADR-0013](../../adr/ADR-0013-state-partition.md)

> **Placement note.** This document describes repository strategy. It lives in
> `docs/drivecode/` and moves with that tree if its visibility changes.

## Scope

**In scope — the Cline Drive Mode line:**

| Repository | Visibility | Role |
|---|---|---|
| `cline-drivecode` | public | Cline host + the vocabulary, port, fold, conformance kit |
| `collaboration-harness` | private | standalone copy of the room kernel and protocol |
| `drivemode-mcp` | private | MCP writer + curated packs |
| `drive-ios` | private | native SwiftUI client |
| `site` | private | marketing surface |

**Parked — other hosts, deliberately not addressed here:** `cursor-drive` and
`claude-drive` implement Drive on the Cursor and Claude Code hosts. They carry
their own duplication (six shared modules, two more MCP servers) and a rival
role vocabulary (`OperatorRole`) that competes with Agent Titles. Parking them
**defers** that collision rather than resolving it — if Agent Titles is
published as a standard while they sit out, reconciling them later means either
migrating both hosts or accepting a permanent split. Record that as a known
debt, not a closed question.

## The problem, stated precisely

This is not "two copies of the kernel exist." The copies are wired in a
direction that makes the drifted one authoritative downstream.

```text
cline-drivecode · @cline/drive          canonical kernel
        ⇅  copied by hand, no dependency
collaboration-harness                    behind: 471-line fold vs 528
        ↓  file dependency on a sibling checkout
drivemode-mcp                            own store, own fold — a second writer
        ↓  HTTP /rpc  events_since
drive-ios · WriterClient.swift           re-declares the title vocabulary in Swift
```

Four consequences follow, in descending severity.

### 1 · The drifted copy is the one that ships

`drivemode-mcp` imports `reduceRoom` from `@drive-mode/collaboration-harness`,
not from `@cline/drive`, and `drive-ios` polls `drivemode-mcp`. The whole iOS
path therefore runs on the older fold. Concretely, the harness copy is missing
exports that the canonical kernel has:

| Export | `@cline/drive` | `collaboration-harness` |
|---|---|---|
| `titleGrantExclusivityKey` | present | **absent** |
| `activeTitleGrantByExclusivityKey` | present | **absent** |
| `activePresenterGrant` | present | present |

The Presenter exclusivity work is live in the canonical kernel and absent from
the copy every downstream consumer actually uses.

### 2 · The dependency is a path link, so drift is silent

`drivemode-mcp` installs `collaboration-harness` as a **file dependency on a
sibling checkout** — its README instructs cloning the two as siblings. There is
no version to pin and no resolution step that could ever fail, so a divergence
between the two kernels produces no signal at install, build, or test time.

### 3 · Two repositories each claim to be the single source of truth

- `cline-drivecode` HANDOFF: *"The Cline hub is the single writer for Drive room state."*
- `drivemode-mcp` AGENTS.md: *"Keep the writer the single room truth."*

Both are reasonable in isolation. Together they are unreconciled, and
`drivemode-mcp` does hold its own `WriterRoomState` and apply `reduceRoom`
itself, so the second writer is real rather than nominal. Either the MCP writer
is a legitimate standalone profile — in which case
[ADR-0013](../../adr/ADR-0013-state-partition.md) should say so and name which
one is authoritative when both are live — or it should project the hub rather
than fold independently.

### 4 · The title vocabulary exists three times, one of them hand-written

`AgentTitle`, `AgentTitleScope`, `AgentTitlePermission`, `AgentTitleGrant`, and
`DirectorPolicyDescriptor` are declared in `@cline/shared/drive/titles.ts` (Zod),
again in the harness protocol, and again by hand in
`drive-ios/Sources/AgentTitles.swift`. Cross-language duplication is
unavoidable — Swift cannot import TypeScript — but a hand-written client copy
drifts silently, and this is precisely the schema intended for publication as a
standard. It should be **generated** from the canonical schema.

### 5 · A legacy fixture duplicates the client

`apps/drive-ios` in this repository is a legacy fixture; the real client is the
`drive-ios` repository. The handoff already says so.

## Ownership rule

> **One concept, one owner. Every other repository consumes it — no repository
> re-implements a concept another one owns.**

A concept is owned where it is *defined*, not where it is *used*. Dependency
direction is one way: **standard → host → writer → clients.** No consumer may
become a second definition site.

## Ownership assignment

| Concept | Owner | Consumers |
|---|---|---|
| Room, event, address, title schemas | `cline-drivecode` | harness, MCP, iOS |
| `DriveHostPort` + conformance kit | `cline-drivecode` | any host |
| Room fold and projections | `cline-drivecode` | MCP writer, iOS projection |
| Agent Title vocabulary | `cline-drivecode` | MCP, iOS (generated bindings) |
| Cline host implementation | `cline-drivecode` (product tier) | — |
| MCP tool surface + curated packs | `drivemode-mcp` | agent hosts |
| Room-state authority | **undecided** — see D2 | — |
| Native client | `drive-ios` | — |
| Marketing surface | `site` | — |
| Standalone kernel distribution | **undecided** — see D1 | — |

## Sequence

Ordered so each step removes duplication permanently rather than relocating it.

1. **Reconcile the fold once, in the direction of the canonical kernel.** Port
   the missing title-grant exports into whatever copy survives, so downstream
   consumers stop running behind. This is the only step with a live correctness
   consequence.
2. **Resolve `collaboration-harness` (D1).** Either fold it back into
   `cline-drivecode` and retire it, or make it the generated distribution of the
   canonical kernel. Either way the hand-maintained copy stops.
3. **Replace the sibling path dependency with a versioned one**, so a future
   divergence fails loudly at install rather than silently at runtime.
4. **Decide room-state authority (D2)** and record it in
   [ADR-0013](../../adr/ADR-0013-state-partition.md), including which side wins
   when both a hub and an MCP writer are live.
5. **Generate the Swift title bindings** from the canonical schema instead of
   maintaining them by hand.
6. **Delete `apps/drive-ios`** from this repository.
7. **Fix licence and visibility pairings** so each repository's terms match its
   tier.

## Open decisions

- **D1 — does `collaboration-harness` become the generated standalone
  distribution, or get retired?** Its zero-dependency shape (only `zod`) makes it
  a better artifact for third parties than `@cline/drive`, which is entangled
  with `@cline/shared`. Single-source discipline argues for retiring it. Both are
  defensible; a hand-maintained second copy is not.
- **D2 — who owns room-state authority when a hub and an MCP writer are both
  live?** Today both repositories claim it in prose and the MCP writer holds real
  state. This needs an ADR answer, not a convention.
- **D3 — when do the parked hosts rejoin?** Every release that ships Agent Titles
  without them widens the gap that reconciling `OperatorRole` will eventually
  have to close.

## Non-goals

- This plan does not move code. It names owners and the order of work.
- It does not create a second status board. The claims registry stays
  authoritative for delivery state.
- It does not address `cursor-drive` or `claude-drive` beyond recording the
  deferred collision above.
