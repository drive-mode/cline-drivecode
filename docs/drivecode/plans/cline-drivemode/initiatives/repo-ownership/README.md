# repo-ownership · one concept, one owner

**Status:** active (plan) — no code has been moved
**Purpose:** map every repository in the `drive-mode` organization, name a single
owner for each shared concept, and sequence the deduplication. Delivery status
remains authoritative in
[`claims-registry.yaml`](../../delivery/claims-registry.yaml); this initiative
describes repository topology and ownership, not claim status.

**Related:** [portfolio-now](../portfolio-now/),
[drive-cloud-beta](../drive-cloud-beta/),
[DEC-package-location](../../decisions/DEC-package-location.md),
[ADR-0018](../../adr/ADR-0018-agent-runtime-contract.md)

> **Placement note.** This document describes repository strategy. It lives in
> `docs/drivecode/` and moves with that tree if and when the documentation set
> changes visibility.

## Problem

Seven repositories implement overlapping concepts with no declared owner. The
same domain — a session where several agents work with a human on a shared
surface — has been modelled three separate times, and the room kernel has been
copied a fourth. Nothing is wrong with any single implementation; the cost is
that every behavioural change needs making in two to four places, by hand, and
they have already drifted.

This is not a hypothetical. Merged
[collaboration-harness#4](https://github.com/drive-mode/collaboration-harness/pull/4)
exists purely to reconcile one copy of the room fold back to another.

## Repository map

Measured 2026-08-19. Line counts exclude tests.

| Repository | Visibility | Licence | What it is | Size |
|---|---|---|---|---|
| `cline-drivecode` | public (fork of `cline/cline`) | Apache-2.0 | Drive on the Cline host + the vocabulary, port, fold, and conformance kit | kernel 13,103 · vocabulary 4,028 · hub Drive 7,825 |
| `collaboration-harness` | private | Apache-2.0 | A standalone copy of the room kernel and protocol | 15 source files |
| `cursor-drive` | **public** | **Proprietary — All Rights Reserved** | Drive on the Cursor host | 11,990 |
| `claude-drive` | **private** | **MIT** | Drive on the Claude Code host | 14,070 |
| `drivemode-mcp` | private | Apache-2.0 | MCP writer façade + curated packs | writer + 5 pack packages |
| `drive-ios` | private | — | Native SwiftUI client | 41 Swift files |
| `site` | private | — | Marketing static site | built output only |

Two of these pairings are inverted: `cursor-drive` carries a proprietary licence
on a public repository, and `claude-drive` carries MIT on a private one. Neither
is what the tier intends.

## Duplication found

### 1 · The room kernel exists twice

`collaboration-harness` re-implements seven `@cline/drive` modules. Every copy is
behind the original, and the exported surfaces have diverged.

| Module | collaboration-harness | cline-drivecode |
|---|---|---|
| `reduceRoom` | 471 | 528 |
| `hostPort` | 106 | 220 |
| `memoryHost` | 280 | 365 |
| `driveMode` | 49 | 73 |
| `resolveAddress` | 79 | 86 |
| `interruptPolicy` | 89 | 130 |
| `narrationPolicy` | 104 | 93 |

`cline-drivecode` additionally exports `titleGrantExclusivityKey`,
`activeTitleGrantByExclusivityKey`, and `activePresenterGrant`, which the
harness copy does not have.

### 2 · The host layer exists three times

`cursor-drive` and `claude-drive` are copy-paste forks that have drifted. These
modules carry the same types and classes in both:

| Module | cursor-drive | claude-drive |
|---|---|---|
| `mcpServer` | 1,756 | 1,518 |
| `operatorRegistry` | 490 | 536 |
| `sessionMemory` | 258 | 327 |
| `stateSyncCoordinator` | 258 | 311 |
| `persistentMemory` | 211 | 224 |
| `governance/entropy` | 422 | 266 |

`OperatorStatus`, `OperatorRole`, `RoleTemplate`, `ROLE_TEMPLATES`,
`EscalationEvent`, and `OperatorVisibility` are declared identically in both
`operatorRegistry` files; `MemoryEntry`, `SessionMemoryState`, `SessionMemory`,
`MemorySearchResult`, `PersistentMemory`, and `StateSyncCoordinator` likewise.

### 3 · Three MCP servers with incompatible vocabularies

| Repository | Lines | Tool prefix |
|---|---|---|
| `cursor-drive` | 1,756 | `agent_*`, `agent_screen_*` |
| `claude-drive` | 1,518 | `agent_screen_*`, `drive_get_*` |
| `drivemode-mcp` | 553 | `room_*`, `agent`/`agents` |

`agent_screen_activity` and `agent_screen_decision` are defined in two of them.

### 4 · Two competing role vocabularies

The most consequential duplication is conceptual rather than textual.

| Concept | `cline-drivecode` | `cursor-drive` / `claude-drive` |
|---|---|---|
| an agent in the session | participant / seat | operator |
| its role | Agent Title — presenter, researcher, builder, reviewer, verifier, scribe | `OperatorRole` — implementer, reviewer, tester, researcher, planner |
| shared surface | stage / Spotlight | Agent Screen |
| durable memory | task bank, session rollup | `sessionMemory`, `persistentMemory` |
| state convergence | `reduceRoom` fold | `stateSyncCoordinator` |

Agent Titles cannot be offered as an interoperability vocabulary while two
repositories in the same organization ship a different, incompatible role model.
Unifying these is a prerequisite for publishing the title standard, not a
follow-up to it.

## Ownership rule

> **One concept, one owner. Every other repository consumes it — no repository
> re-implements a concept another one owns.**

A concept is owned where it is *defined*, not where it is *used*. Host
repositories are adapters: they translate their host's primitives into the owned
vocabulary and back. They do not get their own copy of the vocabulary.

## Ownership assignment

| Concept | Owner | Consumers |
|---|---|---|
| Room, event, address, and title schemas | `cline-drivecode` | every host, MCP, iOS |
| `DriveHostPort` + `HostCapabilities` | `cline-drivecode` | every host |
| Room fold (`reduceRoom`) and projections | `cline-drivecode` | every host, iOS |
| Conformance kit | `cline-drivecode` | every host |
| Agent Title vocabulary — **unified with `OperatorRole`** | `cline-drivecode` | every host |
| Session and persistent memory model | **one owner, to be chosen** — currently duplicated | `cursor-drive`, `claude-drive` |
| State convergence | `cline-drivecode` (`reduceRoom`) — retire `stateSyncCoordinator` | `cursor-drive`, `claude-drive` |
| Governance / entropy reporting | **one owner, to be chosen** — currently duplicated | `cursor-drive`, `claude-drive` |
| MCP tool surface | `drivemode-mcp` — hosts stop shipping their own servers | `cursor-drive`, `claude-drive`, Cline host |
| Curated packs and show content | `drivemode-mcp` | — |
| Cline host implementation | private product repo | — |
| Cursor host adapter | `cursor-drive` | — |
| Claude Code host adapter | `claude-drive` | — |
| Native client | `drive-ios` | — |
| Marketing surface | `site` | — |

Dependency direction is strictly one way: **standard → host adapters → clients.**
No host adapter may be a dependency of the standard, and no two host adapters
may depend on each other.

## Sequence

Ordered so each step removes duplication permanently rather than moving it.

1. **Unify the role vocabulary.** Reconcile `OperatorRole` and Agent Titles into
   one model in `cline-drivecode`. Everything else in this plan is cheaper once
   the vocabulary is settled, and the title standard is blocked until it is.
2. **Resolve `collaboration-harness`.** Reconcile the drifted fold once, then
   either fold it back into `cline-drivecode` and retire it, or make it the
   generated standalone distribution of the standard. A hand-maintained second
   copy stops either way.
3. **Collapse the MCP surface.** One server, one tool vocabulary, consumed by all
   three hosts.
4. **Extract the shared host modules.** `sessionMemory`, `persistentMemory`,
   `governance/entropy` — one owner each, consumed by both host adapters.
5. **Retire `stateSyncCoordinator`** in favour of the owned fold.
6. **Fix the licence and visibility pairings** so each repository's terms match
   its tier.
7. **Remove `apps/drive-ios`** from `cline-drivecode` — it is a legacy fixture
   duplicating the `drive-ios` repository.

## Open decisions

- **D1 — Which role model wins?** Agent Titles are richer (obligations, risk
  tiers, concurrency rules); `OperatorRole` is simpler and already shipping in
  two hosts. The unified model is likely Titles with an `OperatorRole`
  compatibility mapping, but this is a product call.
- **D2 — Where do the shared host modules live?** They are not standard material
  (they are implementation), yet two private hosts need them. Either a shared
  private package or one host owning them and the other depending on it.
- **D3 — Does `collaboration-harness` become the published standard package or
  get retired?** Its zero-dependency shape argues for the former; single-source
  discipline argues for the latter.
- **D4 — Do all three host adapters stay?** Three hosts is three maintenance
  surfaces. Worth an explicit yes rather than an accident.

## Non-goals

- This plan does not move code. It names owners and the order of work.
- It does not create a second status board. The claims registry stays
  authoritative for delivery state.
- It does not decide licensing terms; it only records where current terms
  contradict the intended tier.
