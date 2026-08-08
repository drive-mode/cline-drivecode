# ADR-0000 · Decision status board

**Purpose.** One place to see what is Accepted, Proposed, Recommended-default, or Superseded.
**Owner.** Drivecode SE lead / PM.
**Related.** [decision-changelog.md](decision-changelog.md) (chronology), [decision-coverage.md](decision-coverage.md) (binding-clause inventory), [LEADERSHIP-BRIEF.md](../leadership/LEADERSHIP-BRIEF.md), [HANDOFF.md](../delivery/HANDOFF.md), [../../HANDOFF.md](../../../HANDOFF.md).

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
| **none** | No product path yet |

## Acceptance record

**2026-07-29.** Human instruction: `accept all` for **ADR-0000…0013** and the leadership DEC bundle (`DEC-agent-source-of-truth`, `DEC-package-location`, `DEC-open-product-forks`). **ADR-0014** (Chat-fork lifecycle) landed on `main` the same day as **Accepted** and is included on this board.

**2026-08-02.** ADR-0016 Route B (fork) + self-hosted beta Accepted.

**2026-08-03.** ADR-0025 / ADR-0026 Accepted (authority twins).

**2026-08-07.** Path H + freemium owner defaults ([DEC-mobile-consumer-owner](../decisions/DEC-mobile-consumer-owner.md)); ADR-0016 rewritten in place for dual install paths.

**2026-08-08.** ADR cleanup wave: reconcile ADR-0023; Accept ADR-0023 / 0027 / 0028 / 0029 (H1–H4 shipped, H5 open); fold path H onto main board; rename hotpath slices **H1–H5**; change control → **current truth singular**; chronology → [decision-changelog.md](decision-changelog.md); clause inventory → [decision-coverage.md](decision-coverage.md). Coverage-hole drafts: ADR-0030…0035 + DEC-multi-device-parity + DEC-codebase-map-firewall (**Proposed**).

## Clusters (read together)

| Cluster | Records | One-line |
|---|---|---|
| **Execution stack** | 0008 → 0018 → 0019 | Task bank → run/lease/receipt → Kanban wire |
| **Authority twins** | 0025 ↔ 0026 | Declared limit needs a refusal path (runtime / delivery) |
| **Spawn & role authority** | 0023 + 0027 (+ 0025) | Consult vs delegate; tier = ceiling or prompt; depth stays 1 |
| **Distribution** | 0016 + DEC-mobile (+ 0021, 0029 H5) | Route B self-host + path H hosted single-writer |
| **State / hotpath** | 0013 + 0029 | Three lanes; checkpoint / deltas / one stage clock |

Files stay separate (different change rates). Do not invent a second workflow runtime ([ADR-0028](ADR-0028-adlc-control-plane.md)).

## Architecture decision records

| ID | Title | Status | Impl | Notes |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-driveagent-home.md) | `.driveagent/` is the agent home | **Accepted** | partial | Resolve/load/compile + get; no hub home write |
| [ADR-0002](ADR-0002-agent-graph-canonical-derived.md) | Canonical YAML → derived graph | **Accepted** | decision | Schemas + fixture; no `@cline/drive` graph compile |
| [ADR-0003](ADR-0003-recruit-and-roster-pack.md) | Recruit ranks; packs stay curated | **Accepted** | partial | RosterPack expand + seat ops; lexical recruit ≠ full recruit |
| [ADR-0004](ADR-0004-gated-learn-privacy.md) | Gated learn; no transcript dump | **Accepted** | partial | Event privacy yes; knowledge learn UI open |
| [ADR-0005](ADR-0005-status-hub.md) | Status Hub: SQLite status log in the Cline SDK | **Accepted** | shipped | Store, service, hub ops, `report_status`, dashboard |
| [ADR-0006](ADR-0006-pip-partner-companion.md) | PiP Partner is a companion surface | **Accepted** | decision | Companion IA; no PipPartner UI yet |
| [ADR-0007](ADR-0007-drive-as-cline-mode.md) | Drive is a Cline mode | **Accepted** | partial | Drive owns work surface (hub IA); Join/Leave + postures; not Plan\|Act peer pill yet |
| [ADR-0008](ADR-0008-task-bank.md) | Task bank is Drive’s execution primitive | **Accepted** | partial | Workspace bank shipped; receipt / covered-check → ADR-0018 |
| [ADR-0009](ADR-0009-runtime-topology-local-cloud.md) | Runtime topology local / cloud / hybrid | **Accepted** | partial | `assertTopologyLegal` + seeds; cap name drift noted |
| [ADR-0010](ADR-0010-provider-harness-byok.md) | Provider harness (BYOK) | **Accepted** | partial | Facets + secrets forbid; adapters not fully registry-wired |
| [ADR-0011](ADR-0011-demo-share-track.md) | Demo share track | **Accepted** | partial | Schemas + snapshot stub; no demo events/track yet |
| [ADR-0012](ADR-0012-agent-router.md) | Agent router for multi-agent rooms | **Accepted** | shipped | `planRoute` + addressSet |
| [ADR-0013](ADR-0013-state-partition.md) | Three-lane state partition | **Accepted** | partial | Log + live + facets; hydrate after trim → ADR-0029 H1 |
| [ADR-0014](ADR-0014-chat-fork-lifecycle.md) | Chat-fork lifecycle | **Accepted** | shipped | Hub `drive.fork.*` + PromotePacket |
| [ADR-0015](ADR-0015-task-session-observability.md) | Local task-session observability | **Accepted** | partial | Slices + privacy UI + host compile enqueue; materialize into `.driveagent/` still host |
| [ADR-0016](ADR-0016-distribution-and-positioning.md) | Drive mode distribution & positioning | **Accepted** | decision | Route B fork + **path H** hosted single-writer (2026-08-07); freemium via DEC-mobile |
| [ADR-0017](ADR-0017-narration-bound-presentation-cues.md) | Narration-bound presentation cues | **Proposed — deferred** | deferred | Demo canvas only; behind S9 |
| [ADR-0018](ADR-0018-agent-runtime-contract.md) | Agent runtime contract (DriveTask v1) | **Accepted** | partial | `run.ts` + interop + Agent Control hub tools + completion guard; see ADR-0019 |
| [ADR-0019](ADR-0019-driveplan-kanban-interop-wire.md) | DrivePlan–Kanban Interop wire | **Accepted** | partial | `execute` / `collectReceipt` + `KanbanInteropHost`; Kanban/hub host adapters still thin |
| [ADR-0020](ADR-0020-session-delivery-cicd.md) | Session delivery CI/CD (ledger + projected stack) | **Proposed** | decision | Hold + rewind; coalesce projection; wire `run_expensive` |
| [ADR-0021](ADR-0021-drive-credential-onboarding.md) | Drive credential onboarding (device-code first) | **Proposed** | none | Blocks credentialed-call gate for beta + path H. Drive never stores keys (ADR-0010). Secret-hygiene fixes listed in the ADR body. |
| [ADR-0022](ADR-0022-agent-economics.md) | Agent economics — context, model, spend per agent | **Proposed** | none | Per-message measurement exists; no Drive surface shows or controls it. Per-agent model dead-ends at read-only compile. |
| [ADR-0023](ADR-0023-agent-spawn-governance.md) | Agent spawn governance (consult vs delegate) | **Accepted** | partial | Body reconciled 2026-08-08. Depth guard shipped (#146). Consult vs delegate + live `capPreset` seat path still open (→ delivery D1). Cluster with 0027. |
| [ADR-0024](ADR-0024-drive-web-runtime.md) | Drive web runtime — conformant browser host behind a transport port | **Proposed** | none | Transport port at composition root; browser host must pass same conformance suite as daemon. |
| [ADR-0025](ADR-0025-enforced-authority.md) | Declared authority must be enforced authority | **Accepted** | partial | Runtime twin of 0026. E1 L1 consumer landed; Finding 1 rows remain open. |
| [ADR-0026](ADR-0026-evidence-backed-done.md) | Evidence-backed Done needs a refusal path | **Accepted** | partial | Delivery twin of 0025. Registry + `check-drivecode-done.ts`; cold-start `claim:<id>`. |
| [ADR-0027](ADR-0027-role-tiers.md) | A role tier is a permission ceiling, or it is a prompt | **Accepted** | decision | No third tier until `capPreset` on `call_seat`. Depth stays 1. Three role vocabularies named as debt. |
| [ADR-0028](ADR-0028-adlc-control-plane.md) | Drive Mode is the ADLC control plane | **Accepted** | decision | No second workflow runtime. Map factory properties onto room/bank/gates/status/receipt planes. Initiative: [adlc-drive-factory](../initiatives/adlc-drive-factory/). |
| [ADR-0029](ADR-0029-room-hotpath-redesign.md) | Room hot-path redesign (checkpoint, deltas, one stage clock) | **Accepted** | partial | Amends ADR-0013. Slices **H1–H4** shipped; **H5** cloud signaling open (path H). Slice ids are H\* so they never collide with Architecture D1–D10. |
| [ADR-0030](ADR-0030-plane-naming.md) | Plane naming for agent-facing code | **Proposed** | none | room/show/status (+ stage/visual); ban Engine ownership nouns; docs-first |
| [ADR-0031](ADR-0031-visual-layout.md) | Client visual layout; producers viewport-blind | **Proposed** | none | `visual/layout`; ResizeObserver host frame; pairs with H4 |
| [ADR-0032](ADR-0032-path-h-ops.md) | Path H hosted writer operations | **Proposed** | none | Auth/tenancy/residency/freemium failure; unblocks honest H5 |
| [ADR-0033](ADR-0033-managed-execution-boundary.md) | Managed execution boundary (DrivePlan owns truth) | **Proposed** | none | Kanban = workbench; bank/gates/receipts = Drive |
| [ADR-0034](ADR-0034-role-vocabulary.md) | Converge role vocabularies | **Proposed** | none | Blocked on delivery D1 (`capPreset` on `call_seat`) |
| [ADR-0035](ADR-0035-late-join-catch-up.md) | Late-join and return catch-up | **Proposed** | none | Wire snapshot/delta + one factual catch-up line |

## Leadership decisions

| ID | Title | Status |
|---|---|---|
| [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md) | Author in `.driveagent/`; compile into host | **Accepted** |
| [DEC-package-location](../decisions/DEC-package-location.md) | `@cline/drive` in monorepo for phase 1 | **Accepted** |
| [DEC-open-product-forks](../decisions/DEC-open-product-forks.md) | Focus / streams / share / accent / revise | **Accepted** (bundle) |
| [DEC-mobile-consumer-owner](../decisions/DEC-mobile-consumer-owner.md) | Path H, muted mic, Cline Drive name, MC3, freemium | **Accepted** (2026-08-07) |
| [DEC-drive-mark-official](../decisions/DEC-drive-mark-official.md) | Official Drive mark + motion axes | **Accepted** |
| [DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md) | Shared semantics across hub/pwa/ios/tui | **Proposed** |
| [DEC-codebase-map-firewall](../decisions/DEC-codebase-map-firewall.md) | Codebase-map explain-only; no portfolio/Status writes | **Proposed** |

## Architecture D1–D10

Foundation defaults in [01-architecture.md](../foundation/01-architecture.md). **Not** the same ids as ADR-0029 hotpath slices (**H1–H5**).

| ID | Title | Status |
|---|---|---|
| D1 | Kernel package `@cline/drive` | Accepted (architecture) |
| D2 | Hub single writer (discovery / preferred default port) | Accepted |
| D3 | Room-first; Drive mode primary activation; Chat default surface | Accepted ([ADR-0007](ADR-0007-drive-as-cline-mode.md)) |
| D4 | Events-first stage; bidirectional sharer | Accepted |
| D5 | Hooks are the interception path | Accepted |
| D6 | Surfaces render typed events | Accepted |
| D7 | Facet catalog + lanes + hub durable writes | Accepted |
| D8 | Runtime topology local / cloud / hybrid | Accepted ([ADR-0009](ADR-0009-runtime-topology-local-cloud.md)) |
| D9 | Provider harness (BYOK) | Accepted ([ADR-0010](ADR-0010-provider-harness-byok.md)) |
| D10 | Three-lane state partition | Accepted ([ADR-0013](ADR-0013-state-partition.md)) |

SDK amendments (reducer/projection in `@cline/drive`; host port + conformance kit) must be reflected in `DRV-KERNEL` ACs before Phase 0 gate.

## Decision coverage gaps

**Full clause inventory** (every ADR/DEC + Architecture D1–D10 + domain matrix): [decision-coverage.md](decision-coverage.md). Chronology: [decision-changelog.md](decision-changelog.md).

Where product / platform work is advancing **without** a binding ADR (or with only Proposed paper). Prioritized for next decision writing — not a feature backlog.

| Gap | Draft | Notes |
|---|---|---|
| Agent-facing plane naming (+ show/stage nouns) | [ADR-0030](ADR-0030-plane-naming.md) **Proposed** | Docs-first; ban Engine ownership nouns |
| Client visual / layout adaptation | [ADR-0031](ADR-0031-visual-layout.md) **Proposed** | Producers viewport-blind |
| Path H ops model | [ADR-0032](ADR-0032-path-h-ops.md) **Proposed** | Auth/tenancy/freemium failure |
| DriveKanban managed-execution boundary | [ADR-0033](ADR-0033-managed-execution-boundary.md) **Proposed** | DrivePlan owns truth |
| Role vocabulary convergence | [ADR-0034](ADR-0034-role-vocabulary.md) **Proposed** | Blocked on delivery D1 |
| Multi-device product contract | [DEC-multi-device-parity](../decisions/DEC-multi-device-parity.md) **Proposed** | Semantics parity, not pixel parity |
| Codebase-map firewall | [DEC-codebase-map-firewall](../decisions/DEC-codebase-map-firewall.md) **Proposed** | Explain-only |
| Late-join / return catch-up | [ADR-0035](ADR-0035-late-join-catch-up.md) **Proposed** | One factual line + wire snapshot |

### Proposed ADRs — accept when shipped, not sooner

| ADR | Gate to Accept |
|---|---|
| **0020** | Worktree ledger + `DriveDelivery` identity on tip |
| **0021** | Device-code path + three secret-hygiene fixes |
| **0022** | Room usage events + per-agent model/budget surface |
| **0024** | Browser host passes `runHostConformance` |
| **0017** | Keep deferred until Spotlight S9 |
| **0030** | AGENTS plane table + first rename proof (`visual/layout`) |
| **0031** | Layout module on tip with host-frame ResizeObserver |
| **0032** | H5 writer + entitlement failure path honest |
| **0033** | Managed cards refuse bank archive from Kanban Done |
| **0034** | After delivery D1; unified seat role writes only |
| **0035** | Catch-up line on leave/return + snapshot gap path |

## Still Open (product gaps)

| Topic | Blocking artifact | Notes |
|---|---|---|
| Approval UI owner detail | [DRV-GATES](../features/DRV-GATES.md) | Feed card over existing approval plumbing. Taxonomy enums landed; UI / expiry / hub projection open |
| Catch-up orientation copy owner | DRV-LEAVE-END | One factual “since you left” line from stage reducer |
| One-shot fork vs specialist | Later; not Phase 0 | Out of Phase 0; track under WDK |
| Session satisfaction metrics accept | [ADR-0015](ADR-0015-task-session-observability.md), [PRD 10](../prd/prd-task-satisfaction-observability.md) | Local rollups + gated plan improve |
| Voice backend for the beta | [drive-audio](../initiatives/drive-audio/overview.md) | MVP on `browser-speechSynthesis`; BYOK after |
| Beta support path | MVP Phase 5 | GitHub issues on the fork vs managed. Owner: Harrison. |
| Live `capPreset` on `call_seat` | [defaults-delivery](../delivery/defaults-delivery.md) D1 | Blocks consult/delegate product + role tiers (0023/0027) |
| Hosted signaling writer | [ADR-0029](ADR-0029-room-hotpath-redesign.md) H5 | Unblocked by path H; after MC1 call verbs unless demo forces |

## Explicitly not open anymore (closed)

- Formal ADR accept (ADR-0000…0013 + DEC bundle) → **Accepted** (2026-07-29 `accept all`). ADR-0014 Accepted on `main`.
- Separate `drivecode-sdk` repository for phase 1 → **Rejected** ([DEC-package-location](../decisions/DEC-package-location.md)).
- Pixel user-share in MVP → **Rejected** ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md)).
- Dual prompt stores (facets + homes) → **Rejected** ([DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md)).
- Background turns in unfocused rooms (MVP) → **Rejected**.
- Distribution route → **Route B, fork** ([ADR-0016](ADR-0016-distribution-and-positioning.md)). Revisitable after the beta.
- Hosted **multi-human** rooms → **Rejected** (still). **Path H** (hosted single-writer, same wire, phone/PWA) → **Accepted 2026-08-07**.
- Narration cue schema ([ADR-0017](ADR-0017-narration-bound-presentation-cues.md)) → **deferred**, not open.
- Second workflow / Cloudflare Workflows-shaped runtime → **Rejected** ([ADR-0028](ADR-0028-adlc-control-plane.md)).
- Unbounded chat-fork generations → **Closed** (#146 / ADR-0023 reconciled).

## Change control

**Current truth is singular.** The ADR body an agent (or human) reads must not
contain two opposing claims about tip. Stale Findings + “amendment: ignore that”
paragraphs poison the context window and slow decisions.

1. **Prefer rewrite-in-place** when a decision’s substance changes or tip makes
   a Finding false. Edit Context / Decision so the main text is true *now*.
2. **Chronology lives in
   [decision-changelog.md](decision-changelog.md)** — not inside the ADR.
   Every substantive rewrite appends one line under that record’s heading
   there (`- YYYY-MM-DD — …`, newest last). Passing an ADR into a context
   window should load only current truth. Status stays a single current
   verdict, not a stack of “Amended …” banners.
3. **New ADR / DEC** only for a real architectural fork (new plane, new writer,
   supersession). Link it here; old record flips to Superseded with one line
   “Superseded by ADR-NNNN”.
4. Do not silently edit Accepted decisions **in feature files** — change the
   ADR/DEC, then point features at it.
5. Board (this file) stays the index; Impl column tracks shipped vs decision.
6. Hotpath implementation slices use **H1–H5** only. Architecture defaults keep
   **D1–D10**.
