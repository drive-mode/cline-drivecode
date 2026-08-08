# Architecture Decision Records (ADR)

**ADR** = Architecture Decision Record (industry-standard naming; same artifact family as cursor-drive and harrison-site).

**Status board.** [ADR-0000-status-board.md](ADR-0000-status-board.md) — Accepted / Recommended / Proposed / Open, clusters, and **decision coverage gaps** in one place.  
**Coverage inventory.** [decision-coverage.md](decision-coverage.md) — binding clauses, domain tags, and domain matrix for ADR-0001…0029 + DEC-\* + Architecture D1–D10.
**Acceptance.** 2026-07-29 human `accept all`: ADR-0000…0013 + DEC bundle. ADR-0014 Accepted on `main` the same day. **2026-08-08 cleanup:** ADR-0023 reconciled; ADR-0023 / 0027 / 0028 / 0029 Accepted; path H + DEC-mobile on the board.

**Hygiene (unpoisoned context).** Prefer **rewrite-in-place** so each ADR’s
Context/Decision reads as current tip truth. Do not leave a false Finding beside
an “amendment: ignore the above” note — that doubles the claim set and slows
decisions. Out of band: [decision-changelog.md](decision-changelog.md)
(chronology) and [decision-coverage.md](decision-coverage.md) (clause inventory).
Do not put changelogs inside ADRs — keeps the passable context window clean.
Status is one current verdict. New ADR only for a real fork or supersession.
See ADR-0000 § Change control.

| ID | Title | Status | Features |
|---|---|---|---|
| [ADR-0000](ADR-0000-status-board.md) | Decision status board | Living | — |
| [ADR-0001](ADR-0001-driveagent-home.md) | `.driveagent/` is the agent home | Accepted | [DRV-DRIVEAGENT-HOME](../features/DRV-DRIVEAGENT-HOME.md), [DRV-PARTICIPANT-SHEET](../features/DRV-PARTICIPANT-SHEET.md) |
| [ADR-0002](ADR-0002-agent-graph-canonical-derived.md) | Canonical knowledge YAML; derived graph projection | Accepted | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md) |
| [ADR-0003](ADR-0003-recruit-and-roster-pack.md) | Recruit ranks agents; RosterPack remains curated seating | Accepted | [DRV-RECRUIT](../features/DRV-RECRUIT.md), [DRV-ROSTER-PACK](../features/DRV-ROSTER-PACK.md) |
| [ADR-0004](ADR-0004-gated-learn-privacy.md) | Gated learn; no transcript dump into agent knowledge | Accepted | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md) |
| [ADR-0005](ADR-0005-status-hub.md) | Status Hub: SQLite append-only status log in the Cline SDK | Accepted — implemented | — (SDK-scope; Drive is first consumer) |
| [ADR-0006](ADR-0006-pip-partner-companion.md) | PiP Partner is a companion surface, not primary IA | Accepted | [DRV-PIP](../features/DRV-PIP.md) |
| [ADR-0007](ADR-0007-drive-as-cline-mode.md) | Drive is a Cline mode, not a separate product | Accepted | [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md), [DRV-TOGGLE](../features/DRV-TOGGLE.md) |
| [ADR-0008](ADR-0008-task-bank.md) | Task bank is Drive’s execution primitive | Accepted | [DRV-TASK-BANK](../features/DRV-TASK-BANK.md), [DRV-NOWNEXT](../features/DRV-NOWNEXT.md), [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md) |
| [ADR-0009](ADR-0009-runtime-topology-local-cloud.md) | Runtime topology for local and cloud Drive | Accepted | [DRV-MIC](../features/DRV-MIC.md), [DRV-TTS](../features/DRV-TTS.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md) |
| [ADR-0010](ADR-0010-provider-harness-byok.md) | Drive provider harness (BYOK) with OOTB packs | Accepted | [DRV-PLATFORM-CONFIG](../features/DRV-PLATFORM-CONFIG.md), [DRV-MIC](../features/DRV-MIC.md), [DRV-TTS](../features/DRV-TTS.md) |
| [ADR-0011](ADR-0011-demo-share-track.md) | Demo share track (Cursor-like proof on stage) | Accepted | [DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md), [DRV-SHARE](../features/DRV-SHARE.md), [DRV-STAGE](../features/DRV-STAGE.md) |
| [ADR-0012](ADR-0012-agent-router.md) | Agent router for multi-agent rooms | Accepted | [DRV-AGENT-ROUTER](../features/DRV-AGENT-ROUTER.md), [DRV-ADDRESS](../features/DRV-ADDRESS.md) |
| [ADR-0013](ADR-0013-state-partition.md) | Three-lane state partition (event log / live room / facets) | Accepted | [DRV-KERNEL](../features/DRV-KERNEL.md) |
| [ADR-0014](ADR-0014-chat-fork-lifecycle.md) | Chat-fork lifecycle (invisible auditable workers) | Accepted | [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md), [DRV-TRANSCRIPT](../features/DRV-TRANSCRIPT.md), [DRV-PARALLEL-WAVES](../features/DRV-PARALLEL-WAVES.md) |
| [ADR-0015](ADR-0015-task-session-observability.md) | Local task-session observability; tasks as satisfaction unit | Accepted | [DRV-CALL-SESSION](../features/DRV-CALL-SESSION.md), [DRV-TASK-METRICS](../features/DRV-TASK-METRICS.md), [DRV-PLAN-IMPROVE](../features/DRV-PLAN-IMPROVE.md) |
| [ADR-0016](ADR-0016-distribution-and-positioning.md) | Drive mode distribution & positioning | **Accepted** — Route B + path H | — |
| [ADR-0017](ADR-0017-narration-bound-presentation-cues.md) | Narration-bound presentation cues | Proposed — **deferred behind S9** | [DRV-NARRATION](../features/DRV-NARRATION.md), [DRV-TTS](../features/DRV-TTS.md) |
| [ADR-0018](ADR-0018-agent-runtime-contract.md) | Agent runtime contract (DriveTask v1) | Accepted — Impl **partial** | [DRV-TASK-BANK](../features/DRV-TASK-BANK.md), [driveplan-agent-runtime](../initiatives/driveplan-agent-runtime/) |
| [ADR-0019](ADR-0019-driveplan-kanban-interop-wire.md) | DrivePlan–Kanban Interop wire | Accepted | — |
| [ADR-0020](ADR-0020-session-delivery-cicd.md) | Session delivery CI/CD (ledger + projected stack) | **Proposed** | [DRV-CALL-SESSION](../features/DRV-CALL-SESSION.md), [DRV-ISOLATION](../features/DRV-ISOLATION.md) |
| [ADR-0021](ADR-0021-drive-credential-onboarding.md) | Drive credential onboarding (device-code first) | **Proposed** | [DRV-PLATFORM-CONFIG](../features/DRV-PLATFORM-CONFIG.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md) |
| [ADR-0022](ADR-0022-agent-economics.md) | Agent economics — context, model, spend per agent | **Proposed** | [DRV-PLATFORM-CONFIG](../features/DRV-PLATFORM-CONFIG.md), [DRV-TASK-METRICS](../features/DRV-TASK-METRICS.md) |
| [ADR-0023](ADR-0023-agent-spawn-governance.md) | Agent spawn governance (consult vs delegate) | **Accepted** — Impl partial | [DRV-TEAM-OPT](../features/DRV-TEAM-OPT.md), [DRV-GATES](../features/DRV-GATES.md), [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md) |
| [ADR-0024](ADR-0024-drive-web-runtime.md) | Drive web runtime — conformant browser host behind a transport port | **Proposed** | [DRV-KERNEL](../features/DRV-KERNEL.md), [DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md) |
| [ADR-0025](ADR-0025-enforced-authority.md) | Declared authority must be enforced authority | **Accepted** | [DRV-GATES](../features/DRV-GATES.md), [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md) |
| [ADR-0026](ADR-0026-evidence-backed-done.md) | Evidence-backed Done needs a refusal path | **Accepted** | — |
| [ADR-0027](ADR-0027-role-tiers.md) | A role tier is a permission ceiling, or it is a prompt | **Accepted** — Impl decision | [DRV-TEAM-OPT](../features/DRV-TEAM-OPT.md), [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md) |
| [ADR-0028](ADR-0028-adlc-control-plane.md) | Drive Mode is the ADLC control plane | **Accepted** — Impl decision | [adlc-drive-factory](../initiatives/adlc-drive-factory/) |
| [ADR-0029](ADR-0029-room-hotpath-redesign.md) | Room hot-path redesign (H1–H5) | **Accepted** — Impl partial (H5 open) | [mobile-consumer](../initiatives/mobile-consumer/) |

Impl honesty lives on the [status board](ADR-0000-status-board.md) (**Impl** column). Accepted ≠ shipped.

Product requirements: [../prd/prd-driveagent-portfolio.md](../prd/prd-driveagent-portfolio.md), [../prd/prd-pip-partner.md](../prd/prd-pip-partner.md), [../prd/prd-drive-as-cline-mode.md](../prd/prd-drive-as-cline-mode.md), [../prd/prd-task-bank-drive-loop.md](../prd/prd-task-bank-drive-loop.md), [../prd/prd-task-satisfaction-observability.md](../prd/prd-task-satisfaction-observability.md).
Success metrics: [../prd/prd-success-metrics.md](../prd/prd-success-metrics.md) (phase/CI). Session satisfaction: [PRD 10](../prd/prd-task-satisfaction-observability.md).

Example home: [../examples/driveagent-pair-partner/](../examples/driveagent-pair-partner/).

Related DECs: [../decisions/](../decisions/).
