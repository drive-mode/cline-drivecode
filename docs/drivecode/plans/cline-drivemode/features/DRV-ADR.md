# DRV-ADR · Architecture decision record

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../delivery/TASK-GRAPH.md).

## Problem / user value

The Drive effort makes several decisions that future contributors will want to relitigate (kernel package, hub as single writer, events-only screen share, no second daemon, buy-not-build SFU). An ADR makes them durable and reviewable, and gives agents a citable constraint document.

## Acceptance criteria

- ADR nest exists at [`plans/cline-drivemode/adr/`](../adr/) with `ADR-NNNN-slug.md` naming and the living board [`ADR-0000-status-board.md`](../adr/ADR-0000-status-board.md).
- Decisions covering, at minimum: `@cline/drive` kernel placement, hub as the single writer (preferred default port with discovery / free-port fallback unless `CLINE_HUB_PORT` is set), room-first domain model with Drive tab as primary UX and `joinCall` / Chat Join as façade/shortcut, events-first agent stage (bidirectional sharer pointer; WebRTC later), phased media strategy with buy-not-build SFU, no default second MCP on `:7891`.
- Each decision names the alternatives rejected and the evidence file that grounds it (include [DRIVE-TAB.md](../../../design/wireframes/DRIVE-TAB.md) for UX IA).
- ADR status is `proposed` until the human accepts it. Plans do not block on acceptance (work proceeds, the ADR records).

## Dependencies

None. Drafts alongside DRV-EVENTS.

## Surfaces touched

- `docs/drivecode/plans/cline-drivemode/adr/` (canonical nest; do **not** create repo-root `docs/adr/`)

## Agent tasks

- [x] Locate or create the ADR directory and copy the numbering convention from any existing records.
  - Owner package: repo docs
  - Files: `docs/drivecode/plans/cline-drivemode/adr/ADR-NNNN-slug.md`
  - Verify: `bun run check:drivecode-docs` accepts the nest
  - Done when: directory and naming convention are settled.
- [x] Draft ADRs from [01-architecture.md](../foundation/01-architecture.md) decisions and related forks; index on [ADR-0000](../adr/ADR-0000-status-board.md).
  - Owner package: repo docs
  - Files likely: `docs/drivecode/plans/cline-drivemode/adr/ADR-*.md`
  - Verify: every decision has a named alternative and a grounding link
  - Done when: board links Accepted / Proposed records and nest README indexes them.

## Risks

- ADR drifts from the plan files as phases execute. Mitigation. The phase gates in TASK-GRAPH include a doc-sync check item when a decision changes.
