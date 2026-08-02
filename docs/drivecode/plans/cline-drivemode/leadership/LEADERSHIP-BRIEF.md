# Leadership brief · Drivecode planning wave

> **Status note (2026-07-30).** ADR-0000…0014 + DEC bundle are **Accepted** (2026-07-29 `accept all`; ADR-0014 on main). The three “load-bearing forks” below are **closed**. Treat this brief as the planning-wave record; current as-is is [SYSTEMS-ANALYSIS.md](SYSTEMS-ANALYSIS.md) §13.0 and nest [HANDOFF.md](../../../HANDOFF.md).

**Role lens.** Software engineering lead + product manager.
**Purpose.** Close contradictions, force decisions, freeze Phase 0 entry, and leave implementers a single source of truth.
**Date.** 2026-07-25 (wave); status note 2026-07-30.
**Builds on.** Draft PRs [#1](https://github.com/hhalperin/cline-drivecode/pull/1) / [#2](https://github.com/hhalperin/cline-drivecode/pull/2) and review [#3](https://github.com/hhalperin/cline-drivecode/pull/3).

## Executive summary

Drivecode’s planning set is strong on **call IA, privacy posture, RosterPack naming, and facet/lane mechanics**. At wave time it was not ready for schema freeze because three load-bearing forks disagreed across docs (**since closed** — see status note):

1. **Agent source of truth** — ~~vision vs PRD~~ → **Accepted** [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md): author in `.driveagent/`; compile into host.
2. **Package location** — ~~handoff open~~ → **Accepted** [DEC-package-location](../decisions/DEC-package-location.md): `@cline/drive` in-monorepo.
3. **TASK-GRAPH lag** — sheet / home / graph / recruit placement still has one unchecked box on [CHECKLIST-phase0-entry](CHECKLIST-phase0-entry.md); features exist in the table.

This wave recommended **defaults**, recorded them as decisions, patched contradictory docs, and added missing artifacts (`DRV-GATES`, `DRV-ISOLATION`, success metrics, hub ops catalog, phase-0 entry checklist).

## Product north star (unchanged)

Make Cline feel like joining a Discord-style call inside Slack-like chrome: recruitable agents, shared stage of structured work, addressable partners, interruptible turns, privacy-strict by default. Drive tab is home. Chat Join is a shortcut.

**Productized in-call.** The SE/PM discipline in this brief is not only a planning-wave artifact. It is Group I of the workflow catalog ([05-workflows.md](../foundation/05-workflows.md) W-40–W-45) and [DRV-SDLC-GUIDE](../features/DRV-SDLC-GUIDE.md): discovery, requirements, decision facilitation, coverage mapping, phase-entry freeze, and teach-while-doing — so less-experienced builders get senior leadership on the call without a mandatory wizard.

## What “done planning” means for Phase 0 entry

Phase 0 schema work may start only when [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md) is green. That checklist is the planning gate — not a calendar.

## Recommended decision package (default if Harrison replies `accept all`)

| ID | Recommendation | Rationale |
|---|---|---|
| ADR-0001…0004 | **Accept as written** | Portfolio/recruit is the differentiator; compile bridge preserves single runtime |
| DEC-agent-SoT | **Author in `.driveagent/`; compile into host; never dual-write prompts into Drive facets** | Resolves vision vs PRD without a second registry |
| DEC-package | **`@cline/drive` in this monorepo for phase 1** | Matches SDK arena; avoids syncTypes failure mode |
| DEC-focusPolicy | **MVP: one active runtime room; unfocused rooms are view-only (no background turns)** | Cheap, predictable cost; multi-room IA still ships |
| DEC-agentStream | **Filtered projection of room events for MVP; dedicated private log later if needed** | Smaller event surface; privacy-easier |
| DEC-userShare | **Structured share only in MVP** | Matches architecture D4; closes wireframe fork |
| DEC-accent | **Violet edge** | Matches cline.bot spend of accent; stage stays brightest |
| DEC-gates-v1 | **Ship DRV-GATES taxonomy over existing `approval.requested`; feed-card UI** | Unblocks W-24/W-25 without inventing a second approval plane |
| DEC-isolation | **`teamOpt` hard-requires DRV-ISOLATION** | Prevents multi-agent footgun |

Human override format (from existing handoffs): `accept all` | `change: <id and new default>`.

## Planning artifacts in this wave

| Artifact | Purpose |
|---|---|
| [adr/ADR-0000-status-board.md](../adr/ADR-0000-status-board.md) | Single status board for ADRs + open decisions |
| [decisions/DEC-agent-source-of-truth.md](../decisions/DEC-agent-source-of-truth.md) | Resolve vision vs Driveagent home |
| [decisions/DEC-package-location.md](../decisions/DEC-package-location.md) | Close monorepo vs separate repo |
| [decisions/DEC-open-product-forks.md](../decisions/DEC-open-product-forks.md) | Focus, streams, share, accent, revise-not-restart |
| [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md) | Gate before schemas |
| [features/DRV-GATES.md](../features/DRV-GATES.md) | Approval taxonomy + UI owner |
| [features/DRV-ISOLATION.md](../features/DRV-ISOLATION.md) | Worktree isolation for teamOpt |
| [prd/prd-success-metrics.md](../prd/prd-success-metrics.md) | Measurable MVP + privacy KPIs (phase gates) |
| [prd/prd-task-satisfaction-observability.md](../prd/prd-task-satisfaction-observability.md) | PRD 10 — task-centric session satisfaction (local) |
| [BRIEF-task-satisfaction.md](BRIEF-task-satisfaction.md) | Session satisfaction / closed-loop improve brief |
| [ops/hub-drive-ops.md](../ops/hub-drive-ops.md) | Canonical hub op catalog + failure modes |
| [schemas/README.md](../../../design/wireframes/README.md) | Phase-0 schema index |
| [MATRIX-workflow-coverage.md](MATRIX-workflow-coverage.md) | Workflow ↔ feature coverage |
| [../drivecode-sdk/05-alignment-with-driveagent.md](../../drivecode-sdk/foundation/05-alignment-with-driveagent.md) | Host port + home compile coexistence |

## Requirements priorities (MoSCoW for the believable call)

### Must (Phase 1 call feel)

- Open Drive tab → join room → narrated task → mode change → leave → Chat rejoin → end with handoff (W-02, W-08, W-09, W-04, W-03, W-05).
- Rename/ink partner without reseat; no prompts in Drive facet files (W-35).
- Hub single-writer; no `:7891`.
- Privacy-strict defaults enforced in schemas.
- On-demand discovery + teach-while-doing (W-40, W-45); “just build X” escapes to the work loop.

### Should (Phase 1–2 without blocking join)

- Participant sheet chooser (Transcript | Profile) with classifier strip (W-19 / W-37).
- Builtin / example Driveagent home loadable as fixture (ADR-0001 compile path).
- Stage + address + steer + interrupt (Phase 2 gate).
- Gates v1 for high-impact tools (W-24 / W-25).
- Requirements / decision / phase-entry stage cards (W-41, W-42, W-44).

### Could (Phase 2+)

- Lexical recruit + pack suggestions (W-38).
- Gated learn accept queue (W-39).
- Multi-member RosterPack under teamOpt (Phase 4).

### Won’t (this plan set)

- Multi-human WebRTC media plane.
- Embeddings / graphify as recruit SoT.
- Silent transcript retention.
- Second agent runtime beside Cline.

## Architecture principles we will not renegotiate in implementation PRs

1. Hub is the only writer of room state (`:25463`).
2. Harness proposes → host commits → apps project.
3. Events-first stage; no pixel agent stage in MVP.
4. `RosterPack` ≠ Cline `Team`.
5. `AgentProfile` is appearance; definitions live in homes and compile.
6. Privacy is structural (schemas + tests), not a settings hope.
7. Bun only in this repo.

## Risks the lead owns

| Risk | Mitigation in this wave |
|---|---|
| Dual registries (facet prompts + home prompts) | DEC-agent-SoT + no-prompt CI assertion targets |
| Runbook agents skip portfolio work | TASK-GRAPH patch |
| Scaffold Chat state mistaken for hub rooms | ops catalog + Phase 1 ACs on DRV-ROOM-MVP reconnect |
| teamOpt without isolation | DRV-ISOLATION hard dependency |
| Metric-free “MVP done” debates | prd-success-metrics |

## How to use this brief

Treat decisions in this document and the ADR board as defaults for Phase 0 unless a later ADR supersedes them. Implementation of the three-lane state partition ([ADR-0013](../adr/ADR-0013-state-partition.md)) is the local durability seam: remote rooms, org config, and audit export arrive later as adapters on the same log and `DriveHostPort` — not a rewrite.

For day-to-day sequencing, prefer feature docs under `features/` and the hub ops catalog ([ops/hub-drive-ops.md](../ops/hub-drive-ops.md)).

1. Read [ADR-0000-status-board.md](../adr/ADR-0000-status-board.md).
2. Read [SYSTEMS-ANALYSIS.md](SYSTEMS-ANALYSIS.md) for the E2E product/systems map.
3. Accept or amend the recommended package.
4. Run [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md).
5. Only then open schema / `@cline/drive` implementation PRs.
