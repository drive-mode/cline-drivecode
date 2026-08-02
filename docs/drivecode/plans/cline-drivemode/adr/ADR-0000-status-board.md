# ADR-0000 · Decision status board

**Purpose.** One place to see what is Accepted, Proposed, Recommended-default, or Superseded.
**Owner.** Drivecode SE lead / PM.
**Related.** [LEADERSHIP-BRIEF.md](../leadership/LEADERSHIP-BRIEF.md), [HANDOFF.md](../delivery/HANDOFF.md), [../../HANDOFF.md](../../../HANDOFF.md).

## Status legend

| Status | Meaning |
|---|---|
| **Accepted** | Binding decision. Implementers may rely on it. |
| **Recommended** | Leadership default pending formal accept / `change: …`. Treat as Accepted for planning continuity unless overturned. |
| **Proposed** | Written; not yet leadership-endorsed. |
| **Superseded** | Replaced by a newer decision. Do not implement. |
| **Open** | Needs an explicit answer before Phase 0 schemas freeze. |

**Impl column** (decision hygiene — Accepted ≠ shipped):

| Impl | Meaning |
|---|---|
| **shipped** | Tip matches the decision end-to-end for the named surface |
| **partial** | Schemas / some paths landed; decision still has open enforcement or UI |
| **decision** | Binding intent; little or no product path yet |
| **deferred** | Explicitly off critical path |

## Acceptance record

**2026-07-29.** Human instruction: `accept all` for **ADR-0000…0013** and the leadership DEC bundle (`DEC-agent-source-of-truth`, `DEC-package-location`, `DEC-open-product-forks`). **ADR-0014** (Chat-fork lifecycle) landed on `main` the same day as **Accepted** and is included on this board.

## Architecture decision records

| ID | Title | Status | Impl | Notes |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-driveagent-home.md) | `.driveagent/` is the agent home | **Accepted** | partial | Resolve/load/compile + get; no hub home write |
| [ADR-0002](ADR-0002-agent-graph-canonical-derived.md) | Canonical YAML → derived graph | **Accepted** | decision | Schemas + fixture; no `@cline/drive` graph compile |
| [ADR-0003](ADR-0003-recruit-and-roster-pack.md) | Recruit ranks; packs stay curated | **Accepted** | partial | RosterPack expand + seat ops; lexical recruit ≠ full recruit |
| [ADR-0004](ADR-0004-gated-learn-privacy.md) | Gated learn; no transcript dump | **Accepted** | partial | Event privacy yes; knowledge learn UI open |
| [ADR-0005](ADR-0005-status-hub.md) | Status Hub: SQLite status log in the Cline SDK | **Accepted** | shipped | Store, service, hub ops, `report_status`, dashboard |
| [ADR-0006](ADR-0006-pip-partner-companion.md) | PiP Partner is a companion surface | **Accepted** | decision | Companion IA; no PipPartner UI yet |
| [ADR-0007](ADR-0007-drive-as-cline-mode.md) | Drive is a Cline mode | **Accepted** | partial | Join/Leave + postures; not Plan\|Act peer pill yet |
| [ADR-0008](ADR-0008-task-bank.md) | Task bank is Drive’s execution primitive | **Accepted** | partial | Workspace bank shipped; receipt / covered-check → ADR-0018 |
| [ADR-0009](ADR-0009-runtime-topology-local-cloud.md) | Runtime topology local / cloud / hybrid | **Accepted** | partial | `assertTopologyLegal` + seeds; cap name drift noted |
| [ADR-0010](ADR-0010-provider-harness-byok.md) | Provider harness (BYOK) | **Accepted** | partial | Facets + secrets forbid; adapters not fully registry-wired |
| [ADR-0011](ADR-0011-demo-share-track.md) | Demo share track | **Accepted** | partial | Schemas + snapshot stub; no demo events/track yet |
| [ADR-0012](ADR-0012-agent-router.md) | Agent router for multi-agent rooms | **Accepted** | shipped | `planRoute` + addressSet |
| [ADR-0013](ADR-0013-state-partition.md) | Three-lane state partition | **Accepted** | partial | Log + live + facets; two live maps wording soft |
| [ADR-0014](ADR-0014-chat-fork-lifecycle.md) | Chat-fork lifecycle | **Accepted** | shipped | Hub `drive.fork.*` + PromotePacket |
| [ADR-0015](ADR-0015-task-session-observability.md) | Local task-session observability | **Proposed** | partial | Slices landed; leadership accept pending |
| [ADR-0016](ADR-0016-distribution-and-positioning.md) | Drive mode distribution & positioning | **Accepted** | decision | Route B fork; public self-hosted beta |
| [ADR-0017](ADR-0017-narration-bound-presentation-cues.md) | Narration-bound presentation cues | **Proposed — deferred** | deferred | Demo canvas only; behind S9 |
| [ADR-0018](ADR-0018-agent-runtime-contract.md) | Agent runtime contract (DriveTask v1) | **Accepted** | partial | `run.ts` + interop stub + Kanban `externalRef`; tools/guards follow-on |
| ADR-0019 | DrivePlan–Kanban Interop wire | **Reserved** | — | Named by ADR-0018; not drafted yet |
| [ADR-0020](ADR-0020-session-delivery-cicd.md) | Session delivery CI/CD (ledger + projected stack) | **Proposed** | decision | Hold + rewind; coalesce projection; wire `run_expensive` |
| [ADR-0021](ADR-0021-drive-credential-onboarding.md) | Drive credential onboarding (device-code first) | **Proposed** | none | Blocks the beta's credentialed-call gate. Credentials stay in Cline's `ProviderSettingsManager` per ADR-0010; Drive consumes a readiness boolean, never a key. Ships with three secret-hygiene fixes: the provider catalog broadcasts **plaintext API keys** today (`local-provider-service.ts:709`), the desktop-command OAuth reply returns a **raw token** (`desktop-commands.ts:194`), and Drive reports ready when unconfigured (`driveVoiceUi.ts:89` substitutes `anthropic`) |

## Leadership decisions (this wave)

| ID | Title | Status |
|---|---|---|
| [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md) | Author in `.driveagent/`; compile into host | **Accepted** |
| [DEC-package-location](../decisions/DEC-package-location.md) | `@cline/drive` in monorepo for phase 1 | **Accepted** |
| [DEC-open-product-forks](../decisions/DEC-open-product-forks.md) | Focus / streams / share / accent / revise | **Accepted** (bundle) |

## Architecture D1–D10

| ID | Title | Status |
|---|---|---|
| D1 | Kernel package `@cline/drive` | Accepted (architecture) |
| D2 | Hub single writer `:25463` | Accepted |
| D3 | Room-first; Drive tab primary | Accepted |
| D4 | Events-first stage; bidirectional sharer | Accepted |
| D5 | Hooks are the interception path | Accepted |
| D6 | Surfaces render typed events | Accepted |
| D7 | Facet catalog + lanes + hub durable writes | Accepted |
| D8 | Runtime topology local / cloud / hybrid | Accepted |
| D9 | Provider harness (BYOK) | Accepted |
| D10 | Three-lane state partition | Accepted ([ADR-0013](ADR-0013-state-partition.md)) |

SDK amendments (reducer/projection in `@cline/drive`; host port + conformance kit) must be reflected in `DRV-KERNEL` ACs before Phase 0 gate.

## Still Open (product gaps)

| Topic | Blocking artifact | Notes |
|---|---|---|
| Approval UI owner detail | [DRV-GATES](../features/DRV-GATES.md) | Feed card over existing approval plumbing. **Taxonomy enums landed** in `sdk/packages/shared/src/drive/gates.ts` (UI / expiry / hub projection still open) |
| Catch-up orientation copy owner | DRV-LEAVE-END | One factual “since you left” line from stage reducer |
| One-shot fork vs specialist | Later; not Phase 0 | Out of Phase 0; track under W-33 |
| Session satisfaction metrics accept | [ADR-0015](ADR-0015-task-session-observability.md), [PRD 10](../prd/prd-task-satisfaction-observability.md) | Local rollups + gated plan improve; leadership dual-proxy defaults in [BRIEF-task-satisfaction](../leadership/BRIEF-task-satisfaction.md) |
| Voice backend for the beta | [drive-audio](../initiatives/drive-audio/overview.md) | MVP ships on the shipped `browser-speechSynthesis` backend so no tester needs API keys; BYOK providers are already modelled in `drive/src/topology/` and land immediately after. Owner: Harrison — confirm the robotic-but-zero-config tradeoff is acceptable for beta. |
| Beta support path | MVP Phase 5 | GitHub issues on the fork vs something more managed. Owner: Harrison. |

## Explicitly not open anymore (closed by this wave’s defaults)

- Formal ADR accept (ADR-0000…0013 + DEC bundle) → **Accepted** (2026-07-29 `accept all`). ADR-0014 (Chat-fork lifecycle) Accepted on `main` and indexed above.
- Separate `drivecode-sdk` repository for phase 1 → **Rejected** ([DEC-package-location](../decisions/DEC-package-location.md)).
- Pixel user-share in MVP → **Rejected** ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md)).
- Dual prompt stores (facets + homes) → **Rejected** ([DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md)).
- Background turns in unfocused rooms (MVP) → **Rejected**.
- Distribution route (upstream vs fork vs hybrid) → **Route B, fork** ([ADR-0016](ADR-0016-distribution-and-positioning.md), 2026-08-02). Revisitable after the beta.
- Hosted beta → **Rejected** for the MVP: the beta is public but **self-hosted**. A hosted hub would require multi-human rooms and a hosted-hub initiative, both explicit non-goals today.
- Narration cue schema accept ([ADR-0017](ADR-0017-narration-bound-presentation-cues.md)) → **deferred**, not open: spotlight S9 is outside the MVP cut, so this is off the beta's critical path.

## Change control

1. New architectural fork → new ADR or DEC, linked here.
2. Do not silently edit Accepted decisions in feature files.
3. Supersessions require a one-line “Supersedes X” in the new record and a status flip here.
