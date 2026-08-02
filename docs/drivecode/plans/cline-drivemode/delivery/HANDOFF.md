# Handoff · cline-drivemode + Driveagent portfolio

> **Historical (2026-07-25).** Do not use as cold-start. Prefer nest [HANDOFF.md](../../../HANDOFF.md) and [SYSTEMS-ANALYSIS.md](../leadership/SYSTEMS-ANALYSIS.md) §13.0. Kernel, hub rooms, harness, Show director, and satisfaction spine have since landed on `main`.

**Terminology (2026-08).** ADRs live under [`adr/`](../adr/) as `ADR-NNNN-*.md` (formerly misspelled ARD). **DEC-*** under [`decisions/`](../decisions/) unchanged. Execution backlog for Phase 0–4 is in drivekanban (`~/.cline/kanban/…`); [TASK-GRAPH.md](TASK-GRAPH.md) remains the phase contract. Re-seed: `bun scripts/seed-drive-kanban.mjs`.

**Reader.** Archive for the early planning wave.
**Repo.** `hhalperin/cline-drivecode` (local: `profiles/hhalperin/active/cline-drivecode`).
**Date.** 2026-07-25.

## Problem

Drivecode needs to feel like joining a call with recruitable agents who have real portfolios (config + knowledge graph), not just a Chat toggle and a nameless pair partner. At the time of this handoff, planning and early UI had landed; the kernel/homes/recruit path had not (that gap is closed on current `main` — see nest HANDOFF).

## Requirements

Must stay true:

- Hub is the single writer of room state (preferred default port; discovery / free-port fallback unless `CLINE_HUB_PORT` is set). No default second MCP on `:7891`.
- Bun only in this repo.
- Privacy-strict. No transcript/audio persistence without an explicit debug flag. No auto-dump of calls into agent knowledge.
- Drive is a Cline mode (Plan/Act-class). Chat is the default work surface; Drive hub activity is optional room IA.
- `Team` is Cline’s runtime word. Drive seating presets are `RosterPack`. Spoken “team” = pack displayName or recruit query text.
- `AgentProfile` is an appearance overlay. Prompts/tools/skills live in `.driveagent/<slug>/` (or compile from it), not in Drive facets.
- Events-first stage. WebRTC later.

Out of scope for the next “continue implementation” slice unless Harrison says otherwise:

- Shipping embeddings / graphify for recruit.
- Merging this into upstream `cline/cline` (this draft targets the fork).
- Committing the Cursor canvas file (lives outside the repo under `.cursor/projects/.../canvases/`).

## State so far

### Plans (canonical)

| Path | What |
|---|---|
| [`docs/drivecode/plans/cline-drivemode/README.md`](../README.md) | Plan index, feature table |
| [`00-vision.md`](../foundation/00-vision.md) … [`06-platform-config.md`](../foundation/06-platform-config.md) | Vision through platform facets |
| [`05-workflows.md`](../foundation/05-workflows.md) | 39 workflows (incl. W-37 sheet, W-38 recruit, W-39 gated learn) |
| [`TASK-GRAPH.md`](TASK-GRAPH.md) | Phases 0–5 gates |
| [`prd/prd-driveagent-portfolio.md`](../prd/prd-driveagent-portfolio.md) | **PRD 6** portfolio / graph / recruit |
| [`adr/`](../adr/) | **ADR-0000…0013** (all Status: Accepted; ADR-0014 (Chat-fork lifecycle) later Accepted on main) |
| [`features/DRV-*.md`](../features/) | Feature specs including `DRV-PARTICIPANT-SHEET`, `DRV-DRIVEAGENT-HOME`, `DRV-AGENT-GRAPH`, `DRV-RECRUIT` |
| [`examples/driveagent-pair-partner/`](../examples/driveagent-pair-partner/) | Example home + BRIEF.md + sample graph |
| [`docs/drivecode/plans/drivecode-sdk/`](../../drivecode-sdk/) | Meta-harness discovery vs Omnigent (sibling plan set) |

### Design / wireframes

| Path | What |
|---|---|
| [`docs/drivecode/design/wireframes/DRIVE-TAB.md`](../../../design/wireframes/DRIVE-TAB.md) | Discord IA in Slack chrome decision |
| [`drive-tab-discord-slack.html`](../../../design/wireframes/drive-tab-discord-slack.html) | Interactive Drive-tab prototype (Cline brand tokens) |
| [`CLINE-BRAND-TOKENS.md`](../../../design/brand/CLINE-BRAND-TOKENS.md) | Measured from cline.bot |
| [`index.html`](../../../design/wireframes/index.html) | Historical A/B/C variants (superseded banner) |

### Implementation note (historical snapshot)

At handoff time (2026-07-25) only early chrome existed. **On current `main` that gap is closed** — hub rooms, harness, Show director, Status Hub, and satisfaction spine are shipped (see nest HANDOFF §13.0). The table below is archive inventory only:

| Path | What (then) |
|---|---|
| `apps/cline-hub/src/webview/src/drive/` | Early `DriveCallChrome` / types |
| `apps/cli/src/tui/...` | Status bar Drive toggle |

**Still open today (not “not done” for rooms):** pack library UI, recruit Add path, DRV-GATES feed UI, CLI `call_join` parity, Discord channels IA.

### Outside this repo (do not expect in the PR tree)

- Canvas: `C:\Users\harri\.cursor\projects\c-Users-harri-Documents-dev-profiles-ai-secretagent-active-cursor-drive\canvases\cline-drivecode-overview.canvas.tsx` (Architecture, Workflows, Platform/Config, Drive-tab demos).
- Sibling prior art: `ai-secretagent/active/{cursor-drive,claude-drive,briefs}`; personal graph pattern: `hhalperin/active/harrison-site`.

### Key decisions already locked in docs (Accepted ADRs)

1. **ADR-0001** — `.driveagent/<slug>/` is the agent home; compile into host runtime; not `.claude/`.
2. **ADR-0002** — Canonical knowledge YAML; derived `.derived/graph.json`.
3. **ADR-0003** — Recruit ranks; RosterPack stays curated; both under Add.
4. **ADR-0004** — Gated learn; no transcript dump.

Roster click = **Transcript | Profile** (W-37). Address-follows-focus only on Transcript.

## Core tension

**Overlay vs home.** Platform config forbade putting prompts in Drive facets. Driveagent homes reintroduce a full agent definition on disk. The compile bridge into Cline must stay the only runtime path, or you get two registries again. Next implementers should land schemas + compile tests before any profile UI that edits prompts in-sheet.

## Decision (Accepted 2026-07-29)

**Accepted.** Human `accept all` for ADR-0000…0013 and the leadership DEC bundle. ADR-0014 (Chat-fork lifecycle) later Accepted on main.

Board: [adr/ADR-0000-status-board.md](../adr/ADR-0000-status-board.md), [CHECKLIST-phase0-entry.md](../leadership/CHECKLIST-phase0-entry.md).

Agent SoT and package location are **Accepted** (compile-from-`.driveagent/`; `@cline/drive` in monorepo).

## Suggested next slices

> **Superseded.** Prefer nest [HANDOFF.md](../../../HANDOFF.md) top gaps and [REMAINING-task-satisfaction.md](REMAINING-task-satisfaction.md). Phase 0 schemas / hub rooms / harness are already on `main`.

Historical planning list (do not execute as greenfield):

1. Clear remaining [CHECKLIST-phase0-entry.md](../leadership/CHECKLIST-phase0-entry.md) TASK-GRAPH placement checkbox.
2. ~~Phase 0 schemas + `@cline/drive`~~ — Done
3. Product gaps: GATES feed UI, recruit Add, pack library, reconnect UX
4. Satisfaction residuals in REMAINING

## How to resume

```text
Read: docs/drivecode/HANDOFF.md
Then:  leadership/SYSTEMS-ANALYSIS.md §13.0 → delivery/REMAINING-task-satisfaction.md
Then:  adr/ADR-0000-status-board.md
```
