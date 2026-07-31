# DRV-DEP-MAP · Interactive Status Hub dependency graph

Back to [README](../README.md). Initiative: [status-dependency-graph](../initiatives/status-dependency-graph/). Wireframe: [status-dependency-graph.html](../../../design/wireframes/status-dependency-graph.html).

Status Hub already ships a **Dependency map** lens that projects team tasks into layers (`buildDependencyMap`). Today that lens is a **semantic card grid**, not a spatial graph. This feature upgrades the lens into an interactive map: pan / zoom / scroll, clickable task nodes, labeled edges for artifacts passed between tasks, and a **Plans rail** on the right that colors tasks by plan membership.

## Problem / user value

Operators asking “what blocks what?” get a layered list and a text “Blocked by / Unblocks” aside. They cannot:

- See the graph topology at a glance
- Trace the **artifact or result** flowing along an edge
- Tell which **plan** a task belongs to without reading descriptions
- Explore large graphs without drowning in a two-column card wall

The map should answer three questions in one composition: **order**, **payload**, **plan**.

## Acceptance criteria

- Dependency map remains a Status Hub lens (`board` | `changelog` | `dependency-map`); it does not become a second task store.
- The primary surface is a **viewport graph**: drag to pan, wheel / pinch / buttons to zoom, native scroll when content overflows the viewport.
- **First paint and `Fit` always frame every task** inside the viewport (padding). Zoom may leave content off-screen afterward; Fit restores the full-graph frame. Layout follows the fit/density ladder in the initiative UX (viewport-fit gaps → LOD → adaptive LR/TD → plan hulls / stacks as escape).
- Each task is a **node**; `dependsOn` relationships are **edges**. Edge labels show the artifact / result passed when known; unlabeled edges still draw when only the dependency exists.
- Clicking (or activating) a node selects it, highlights incident edges, and opens a **task detail** panel (status, description, blockers, dependents, artifacts, plan membership).
- Every task and plan exposes a **progressive display ID** (`T001`… / `P001`…) that is immutable, monotonic, and searchable; nodes and the Plans rail show the ID; bank-backed entities mint these ids at create time (see initiative UX).
- Plans appear in a fixed **rail on the right** of the graph. Selecting a plan highlights its tasks in that plan’s color and dims non-members. Nodes carry a plan-color accent when they belong to a plan.
- Keyboard and screen-reader paths from the current map are preserved or improved (focusable nodes, live region for selection, no bare-letter hotkeys that steal host shortcuts).
- Empty / loading / integrity (cycle, missing ref) states remain explicit; the UI never invents edges or plan membership.
- Demo bootstrap (`?demoPlans=1`) continues to work via composition-root adapters only.

## Dependencies

- Existing Status Hub Dependency map model (`buildDependencyMap` in `@cline/shared`).
- Team task snapshot transport (`status.tasks_snapshot` / `StatusTeamsSource`).
- Plan membership prefers [DRV-TASK-BANK](DRV-TASK-BANK.md) `DrivePlan.taskIds` when a bank snapshot is available; demo may project phase/plan groups until the bank is wired into this lens.
- Artifact labels on edges need a declared projection source (see initiative [UX.md](../initiatives/status-dependency-graph/UX.md) data contract) — do not scrape free text as truth.

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/views/dependency-map.tsx` (+ graph viewport / plans rail)
- Optional model extension beside `sdk/packages/shared/src/status/dependency-map.ts` for plan ids and edge payloads (pure projection only)
- Demo fixture / plans source in `@cline/drivecode-demo` when demo needs explicit plan groups and edge artifacts
- Docs screenshots under `docs/drivecode/assets/hub/`

## Agent tasks

- [ ] Lock UX composition and interaction model in the initiative UX doc + HTML wireframe.
  - Owner package: repo docs / design wireframes
  - Verify: `bun run check:drivecode-docs`; Mermaid parse via `bun sdk/scripts/validate-mermaid.ts`
  - Done when: UX.md and wireframe are linked from this DRV and the initiatives index.
- [ ] Extend the pure dependency projection with optional `planIds` and edge artifact labels without mutating team runtime.
  - Owner package: `@cline/shared`
  - Verify: `bun -F @cline/shared test`
  - Done when: unit tests cover layered layout + plan/edge annotations; `bun run build:sdk` succeeds.
- [ ] Replace the hub Dependency map card grid with the graph viewport + plans rail + task detail, keeping a11y contracts.
  - Owner package: `@cline/cline-hub`
  - Verify: `bun -F @cline/cline-hub test` and typecheck
  - Done when: selection, pan/zoom smoke, plan highlight, and empty/integrity states are covered.
- [ ] Refresh hub demo screenshots and DEMO runbook paths for the graph lens.
  - Owner package: repo docs
  - Verify: assets under `docs/drivecode/assets/hub/`; DEMO.md cites live URL query
  - Done when: selected + overview shots match the new composition.

## Risks

- Canvas-only graphs that strand keyboard users. Mitigation. Nodes remain focusable controls; viewport is an enhancement, not the only path.
- Inventing artifact labels from titles. Mitigation. Edges stay unlabeled unless the projection has an explicit artifact/result field.
- Confusing Status Dependency map with Drive Show / agent portfolio graphs. Mitigation. Keep `DepMap` naming; no Show backlog coupling ([diagram conventions](../../../../../.claude/diagram-conventions.md)).
- Plan color overload on multi-plan tasks. Mitigation. Primary plan accent + rail multi-select; stripe/dual-accent only if membership is common (open question in UX.md).
