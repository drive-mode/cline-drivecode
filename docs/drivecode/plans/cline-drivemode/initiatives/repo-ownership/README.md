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

### 1 · The drifted copy is the one that ships — and the drift runs both ways

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

The drift is **not one-way**. Three symbols existed only in the harness, so the
canonical kernel was not a superset of it:

| Harness-only symbol | Resolution |
|---|---|
| `AgentRuntimeBadgeSchema` / `AgentRuntimeBadge` | **Ported** to `@cline/shared/drive/room.ts`. `docs/drivecode/README.md` already documents a sanitized runtime badge as distinct from persona, Agent Title, and activity — the concept was described in this repository while only implemented in the one being retired. |
| `allowNarrationByRate` | **Ported** to `@cline/drive/narrationPolicy.ts` and exported from the barrel. |
| `LoggedEventSchema` / `LoggedEvent` | **Not ported — superseded.** `DriveLogEnvelope` ([ADR-0013](../../adr/ADR-0013-state-partition.md) phase 6) is the later model: a `family` union over room/bank/artifact carrying `roomId`, where `LoggedEvent` is room-only. Porting it would reintroduce a retired concept. `drivemode-mcp` migrates to the envelope instead; note `seq` moves from non-negative to positive, and `roomId` becomes required. |

Those three were the divergence in the *exported kernel API*. Attempting the
repoint on 2026-08-20 surfaced a second, larger one in the **protocol** — nine
event types and two snapshot/event fields that `drivemode-mcp` uses and the
canonical kernel does not define. Measured by pointing `drivemode-mcp` at the
generated distribution and reading the compiler: 26 errors, all in
`roomService.ts`, in three groups.

| Harness-only protocol element | Uses | Reading |
|---|---|---|
| `work.generic` | 10 | The escape hatch every pack publishes through. The kernel has no generic work event. |
| `control.session_created` / `_scheduled` / `_started` / `_ended` | 4 | Call-session lifecycle. The kernel already carries `callSessionId` on events and a `callSession` protocol module, so this is a half-built concept here, not a foreign one. |
| `control.invite` | 1 | Room membership. |
| `control.interrupt_ack` | 1 | Completes the raise-hand handshake the kernel implements only one side of. |
| `work.plan`, `work.test` | 2 | The kernel spells these `work.plan_step` and `work.test_result` — the same concepts under different names, which is a naming reconciliation rather than a gap. |
| `profilesByParticipantId` on `RoomSnapshot` | 5 | Carries the `runtimeBadge` whose *type* was already ported above. The field that holds it was not, so the ported type is currently unreachable from a snapshot. |
| `packId` on work/address/room | 3 | Pack attribution. The packs (`coding`, `tasks`, `artifacts`, `direction`, `demo-ops`) are a `drivemode-mcp` product concept, so this is the one element that most likely should *not* move into the kernel. |

`store.ts` — the `LoggedEvent` → `DriveLogEnvelope` migration — typechecks
clean against the distribution. The blockers are entirely in `roomService.ts`
and entirely protocol-level.

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

1. **Reconcile the kernels.** *Partly done:* the two harness-only symbols worth
   keeping are ported into `cline-drivecode` and the third is recorded as
   superseded, so the canonical kernel is now a superset. What remains is
   repointing `drivemode-mcp` — blocked on D1a — after which the title-grant
   exclusivity work reaches the iOS path for the first time.
2. **Retire `collaboration-harness`** (D1 decided). Archive the repository once
   `drivemode-mcp` no longer imports it.
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

- **D1 — resolved 2026-08-19: retire `collaboration-harness` and fold it back
  into `cline-drivecode`.** `@cline/drive` is the single kernel. The
  harness-only *exported symbols* have been reconciled (see finding 1). The
  canonical kernel is **not** yet a superset at the protocol level: nine event
  types and two fields remain harness-only, inventoried in finding 1.
- **D1a — resolved 2026-08-20: a generated bundle, published under a scope the
  organization owns.** `@drive-mode/drive-kernel` is emitted by
  `sdk/scripts/build-drive-kernel-bundle.ts` as the transitive closure of the
  kernel entries — 32 protocol modules, 3 kernel modules, 22 exports, `zod` as
  its only runtime dependency — and published by `drive-kernel-publish.yml` to
  GitHub Packages. `check:drive-kernel` regenerates, compiles, imports the
  compiled output under Node and fails on drift, so the copy cannot fall behind
  the way the harness did. Retiring the *repository* stays compatible with
  publishing a *generated artifact* from the canonical source.

  The distribution owns its version in `sdk/drive-kernel.version.json`. It first
  shipped inheriting `@cline/drive`'s, which was wrong: `sdk/scripts/version.ts`
  rewrites every `sdk/packages/*` version to one value during an SDK release, so
  the bundle had no version it could move between releases and any kernel change
  regenerated at an already-published number. The publish workflow skipped and
  stayed green — a run that reported success while shipping nothing. Bump that
  file to publish a change; a real publish at a version already on the registry
  now fails.

  Two consequences worth recording. The `zod` major mismatch turned out not to
  matter: `drivemode-mcp` pins `zod` 3 for `@modelcontextprotocol/sdk` while the
  kernel needs `zod` 4, and both install side by side because only plain data
  crosses the boundary — the two kernel schemas `drivemode-mcp` imports are
  `.parse()`d internally and never handed to the MCP server. What does block the
  repoint is the protocol divergence inventoried in finding 1.
- **D1b — do the nine harness-only protocol elements belong in the standard?**
  Opened 2026-08-20 by the attempted repoint. This is the ownership question of
  this plan applied to concrete symbols: the session lifecycle, `control.invite`
  and `control.interrupt_ack` complete concepts the kernel already half-carries
  and read as standard; `work.plan`/`work.test` need reconciling against the
  kernel's `work.plan_step`/`work.test_result`; `packId` is pack attribution and
  reads as product. Until this is answered, `drivemode-mcp` cannot compile
  against the kernel and the harness cannot be archived.
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
