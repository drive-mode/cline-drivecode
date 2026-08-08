# docs/drivecode — directory skeleton

**Live layout** for this nest. Placement contract for humans and agents.
Enforced by `bun run check:drivecode-docs` (CI: docs-link-check workflow).

## Design rules

1. **Sort by document role**, then by track (product vs harness).
2. **One front door per job.** Nest root: product reference index, agent rules, cold-start handoff, CI contract, this skeleton.
3. **Keep stable track ids.** `plans/cline-drivemode/` and `plans/drivecode-sdk/`.
4. **Initiatives** are multi-file delivery plans under `initiatives/<slug>/` (README required). Single-feature specs stay `features/DRV-*.md`.
5. **Archive** closed session handoffs; do not delete history that still explains a merged PR.
6. **Assets and design split by surface**, not by date.
7. Prefer an existing leaf over inventing a new top-level sibling of `plans/`, `design/`, `assets/`, `meta/`, `reference/`.

## Skeleton

```text
docs/drivecode/
├── README.md                 # shipped product reference (cite live code)
├── AGENTS.md                 # add / edit / maintain rules
├── HANDOFF.md                # sole nest-level cold-start brief
├── CI.md                     # path filters, gate, labels
├── STRUCTURE.md              # this file — placement contract
│
├── reference/                # long shipped reference pages
│   ├── architecture.md
│   ├── native-vs-drivecode.md
│   └── skills-inventory.md
│
├── plans/
│   ├── README.md
│   ├── cline-drivemode/      # product plan track
│   │   ├── README.md
│   │   ├── foundation/       # 00, 01, 05–08
│   │   ├── research/         # 02–04, 12–14
│   │   ├── leadership/       # briefs, systems analysis, gates
│   │   ├── delivery/         # TASK-GRAPH, runbook, active handoff
│   │   ├── decisions/        # DEC-*
│   │   ├── adr/              # ADR-NNNN-* + ADR-0000 board + decision-changelog.md
│   │   ├── prd/
│   │   ├── features/         # DRV-*.md
│   │   ├── initiatives/      # multi-file tracks (README each)
│   │   ├── schemas/
│   │   ├── examples/
│   │   ├── ops/              # runbooks + smoke
│   │   └── archive/          # HANDOFF-pr*
│   └── drivecode-sdk/        # harness track
│       ├── README.md
│       ├── decisions.tsv
│       ├── foundation/       # 00–05
│       └── delivery/         # 06–08
│
├── design/
│   ├── README.md
│   ├── brand/
│   ├── wireframes/           # + variants/
│   └── canvases/
│
├── assets/
│   ├── logos/
│   ├── hub/
│   ├── tui/
│   ├── demos/
│   ├── fonts/                # self-hosted WOFF2 for canvases
│   └── changelog/            # generated repo-history snapshot for the hub
│
└── meta/
    ├── glossary.md
    └── reviews/
```

## Placement matrix

| You are writing… | Put it here |
|---|---|
| Shipped behavior cited to live code | Nest `README.md` or `reference/` |
| Agent rules / CI / skeleton | Nest root |
| Cold-start for any Drive agent | Nest `HANDOFF.md` only |
| Vision / architecture / workflows / platform | `plans/cline-drivemode/foundation/` |
| Research, inventory, audit, “future of X” | `plans/cline-drivemode/research/` |
| SE/PM brief, systems analysis, entry gates | `plans/cline-drivemode/leadership/` |
| Task graph, agent runbook, active track handoff | `plans/cline-drivemode/delivery/` |
| Living satisfaction backlog (W0–W4) | `plans/cline-drivemode/delivery/REMAINING-task-satisfaction.md` |
| Decision (DEC) | `plans/cline-drivemode/decisions/` |
| Architecture decision (ADR) | `plans/cline-drivemode/adr/` |
| Product requirements | `plans/cline-drivemode/prd/` |
| Single feature spec | `plans/cline-drivemode/features/DRV-*.md` |
| Multi-slice delivery plan | `plans/cline-drivemode/initiatives/<slug>/` |
| Schema freeze / index | `plans/cline-drivemode/schemas/` |
| Example agent home / fixture | `plans/cline-drivemode/examples/` |
| Ops runbook or smoke checklist | `plans/cline-drivemode/ops/` |
| Closed PR/session handoff | `plans/cline-drivemode/archive/` |
| Host port / harness / leverage | `plans/drivecode-sdk/` |
| Brand tokens | `design/brand/` |
| HTML IA prototype / DEMO | `design/wireframes/` |
| Overview / share canvases | `design/canvases/` |
| Product screenshot | `assets/{hub,tui,demos,logos}/` |
| Generated data snapshot | `assets/changelog/` (e.g. `repo-changelog.json`, read at runtime — not a screenshot) |
| Self-hosted webfont (WOFF2) | `assets/fonts/` |
| Generated repo-history snapshot | `assets/changelog/` |
| Term definition | `meta/glossary.md` |
| PR review narrative | `meta/reviews/` |

## Initiative convention

```text
plans/cline-drivemode/initiatives/<slug>/
├── README.md          # purpose, linked DRV ids, status (active|reference|done)
├── overview.md        # optional
├── slice-N-*.md       # or phase-N-*.md
└── testing.md         # optional
```

## Enforcement

```sh
bun run check:drivecode-docs
bun run test:drivecode-docs
```

The checker (`sdk/scripts/check-drivecode-structure.ts`) fails on:

- Unknown nest-root files/dirs
- Loose markdown at `plans/cline-drivemode/` or `plans/drivecode-sdk/` roots
- Initiative folders without `README.md`
- Loose files in `assets/` or unknown asset/design buckets
- Revived legacy paths (`design/drive-wireframes/`, nest `reviews/`, old initiative siblings)
- `features/` / `adr/` naming violations
- Missing required role directories or migrated front-door files

Unit tests (`sdk/scripts/check-drivecode-structure.test.ts`) cover valid/invalid fixtures
plus live-nest migration invariants. CI runs both the checker and the tests in
`.github/workflows/docs-link-check.yml`.

## Success criteria

- A new agent can answer “where does this file go?” from the placement matrix alone.
- Nest root stays process/reference entry files only.
- Product plan top level is README + role folders only.
- Screenshots are findable by surface without reading filenames.
- Glossary and reviews live under `meta/`, not beside product plans.
