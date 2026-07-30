# docs/drivecode — agent guide

All Drive / drivecode / cline-drivemode documentation lives under this directory.
Do not create parallel trees at `docs/plans/`, `docs/design/`, `docs/reviews/`,
or `docs/assets/drivecode/`.

| Front door | Role |
|---|---|
| [README.md](README.md) | Shipped product reference (cite live code) |
| [HANDOFF.md](HANDOFF.md) | Sole nest-level cold-start brief |
| [CI.md](CI.md) | Path filters, gate, labels |
| [STRUCTURE.md](STRUCTURE.md) | Directory skeleton + placement matrix |
| This file | How to add / edit / maintain |

**Enforcement:** `bun run check:drivecode-docs` (also runs in docs-link-check CI).
Fix failures before merging Drive doc changes.

## Layout (live)

| Path | Put here |
|---|---|
| Nest root process files above | Indexes and contracts only — no feature notes |
| `reference/` | Long shipped reference pages (`architecture`, `native-vs-drivecode`, `skills-inventory`) |
| `plans/cline-drivemode/foundation/` | Vision, architecture, workflows, platform, runtime, provider |
| `plans/cline-drivemode/research/` | Prior art, inventory, audits, futures |
| `plans/cline-drivemode/leadership/` | SE/PM briefs, systems analysis, entry gates |
| `plans/cline-drivemode/delivery/` | TASK-GRAPH, AGENT-RUNBOOK, active track handoff |
| `plans/cline-drivemode/decisions/` | `DEC-*` |
| `plans/cline-drivemode/ard/` | `ARD-NNNN-*` + status board |
| `plans/cline-drivemode/prd/` | Product requirements |
| `plans/cline-drivemode/features/` | `DRV-*.md` one-pagers only |
| `plans/cline-drivemode/initiatives/<slug>/` | Multi-file delivery plans (README required) |
| `plans/cline-drivemode/schemas/` | Schema freeze / index |
| `plans/cline-drivemode/examples/` | Fixtures (e.g. `.driveagent` homes) |
| `plans/cline-drivemode/ops/` | Runbooks + smoke checklists |
| `plans/cline-drivemode/archive/` | Closed session handoffs (`HANDOFF-pr*`) |
| `plans/drivecode-sdk/foundation/` | Harness numbered series 00–05 |
| `plans/drivecode-sdk/delivery/` | Leverage, agent handoff, follow-on |
| `design/brand/` | Brand tokens |
| `design/wireframes/` | HTML IA prototypes, DEMO runbook, variants |
| `design/canvases/` | Overview / share canvases |
| `assets/{logos,hub,tui,demos}/` | Screenshots by surface |
| `meta/glossary.md` | Terminology |
| `meta/reviews/` | PR review writeups |

Mintlify product docs (`docs/sdk/`, `docs/cli/`, `docs/features/`, …) stay outside
this nest. Brand source files under repo-root `assets/drive/` are not docs.

## Adding

1. Open [STRUCTURE.md](STRUCTURE.md) placement matrix. Prefer an existing leaf over a new nest-root sibling.
2. New product work: `features/DRV-*.md` and/or `initiatives/<slug>/` (plus ARD/PRD as needed). Update `delivery/TASK-GRAPH.md` when sequencing changes.
3. New harness / host-port work: `plans/drivecode-sdk/`.
4. New screenshots: `assets/{hub,tui,demos,logos}/` — never loose files in `assets/`.
5. New wireframes: `design/wireframes/`; brand tokens → `design/brand/`; canvases → `design/canvases/`.
6. Closed PR handoffs → `archive/`. Keep nest `HANDOFF.md` as the only cold-start front door.
7. Link new docs from the nearest index (`plans/.../README.md`, nest `README.md`, or `HANDOFF.md` when it changes the front door).
8. Run `bun run check:drivecode-docs` (and `bun run test:drivecode-docs` after changing the gate) before finishing.

## Editing

- Keep product-reference pages tied to code paths that exist in this repo.
- Prefer relative links inside the nest; use absolute `docs/drivecode/...` in handoffs and external callouts.
- When renaming or moving a file, update absolute `docs/drivecode/...` strings and relative links that cross folder boundaries. Grep for the old path before finishing.
- Do not leave stubs at old locations (`docs/plans/...`, `design/drive-wireframes/`, flat `reviews/`, etc.).

## Maintaining

- After shared SDK edits that docs cite, rebuild with `bun run build:sdk` before claiming behavior in reference pages.
- Screenshot refresh: write under `docs/drivecode/assets/{hub,tui,demos,logos}/` (see root `AGENTS.md` TUI / hub screenshot notes).
- Decision status stays on the ARD board: `plans/cline-drivemode/ard/ARD-0000-status-board.md`.
- Keep `HANDOFF.md` short; deep detail belongs in plans / ARDs / initiatives, not duplicated here.
- Structure drift is a CI failure — do not bypass `check:drivecode-docs`.

## Out of scope here

- Shipping Mintlify user docs (use the existing `docs/*.mdx` trees).
- Implementation code under `apps/` or `sdk/` — docs describe it; they do not replace it.
